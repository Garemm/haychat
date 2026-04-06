/**
 * src/sockets/chatSocket.js
 *
 * SOCKET.IO — Chat Event Handlers.
 *
 * Delegates all NLP processing to messagePipeline.js.
 * This file only handles:
 *   - Socket.io connection/disconnection
 *   - Room join/leave
 *   - Message persistence and emission
 *   - Typing indicators
 *   - Idle-timeout reengagement message
 *
 * MESSAGE HISTORY:
 *   Stored in Redis under hist:<businessId>:<sessionId> (TTL: 24 h).
 *   The in-memory MessageModel is used ONLY as a per-process write-through
 *   cache for messages emitted during the current connection (so that the
 *   bot reply can be emitted back without an extra Redis round-trip).
 *   On join_room the authoritative history is always fetched from Redis so
 *   that messages persist across page reloads and reconnects.
 */

const { Server } = require('socket.io');
const MessageService    = require('../services/messageService');
const { processMessage } = require('../services/messagePipeline');
const { CLIENT_URL }    = require('../config/env');
const { getContext, updateContext, SESSION_TTL_SECONDS } = require('../services/sessionContextService');
const { getHistory, saveMessage: redisSaveMessage } = require('../services/redisService');
const { getCategories } = require('../services/businessInfoService');
const { formatList }    = require('../services/intentResponseFormatter');
const BusinessModel     = require('../models/businessModel');

/** Milliseconds of inactivity before sending the re-engagement message.
 *  Matches SESSION_TTL_SECONDS so the message fires exactly when Redis context expires. */
const IDLE_TIMEOUT_MS = SESSION_TTL_SECONDS * 1000;

// ─── Idle timer tracking ──────────────────────────────────────────────────────
// sessionTimers: sessionId → { roomId, businessId, timerId }
// socketSessions: socket.id → sessionId   (needed to clear timer on disconnect)
const sessionTimers  = new Map();
const socketSessions = new Map();

/**
 * Clears any running idle timer for the session and schedules a new one.
 * On expiry: fetches categories, emits re-engagement message, sets context.
 *
 * @param {string} sessionId
 * @param {string} roomId
 * @param {number} businessId
 */
function resetIdleTimer(sessionId, roomId, businessId) {
  // Cancel existing timer
  const existing = sessionTimers.get(sessionId);
  if (existing) clearTimeout(existing.timerId);

  const timerId = setTimeout(async () => {
    sessionTimers.delete(sessionId);
    try {
      const categories = await getCategories(businessId);
      if (!categories || categories.length === 0) return;

      const catList    = formatList('📂 Categorías disponibles:', categories);
      const replyText  =
        `Hola, noté que te tomaste una pausa ☕\n¿Tienes alguna otra duda?\n\n` +
        `Te envío nuestro catálogo de categorías:\n\n${catList}`;

      // Set category_selection context so the next message routes correctly
      await updateContext(businessId, sessionId, {
        lastIntent:          'category_selection',
        availableCategories: categories,
      });

      const botTimestamp = new Date().toISOString();
      const botMsg = {
        id:        require('crypto').randomUUID(),
        roomId,
        sender:    'Bot',
        text:      replyText,
        timestamp: botTimestamp,
      };
      // Persist re-engagement message to Redis history
      await redisSaveMessage(businessId, sessionId, {
        id:        botMsg.id,
        role:      'assistant',
        sender:    'Bot',
        text:      replyText,
        timestamp: botTimestamp,
      });
      if (io) io.to(roomId).emit('receive_message', botMsg);
    } catch (err) {
      console.warn('[Idle] Error al enviar mensaje de pausa:', err.message);
    }
  }, IDLE_TIMEOUT_MS);

  sessionTimers.set(sessionId, { roomId, businessId, timerId });
}

let io;

/**
 * Inicializa Socket.io y lo adjunta al servidor HTTP.
 * Llamar desde server.js antes de httpServer.listen().
 * @param {import('http').Server} httpServer
 */
const initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: CLIENT_URL,
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket) => {
    console.log(`[Socket] Connected:    ${socket.id}`);

    // ── Join a room ──────────────────────────────────────────────────────────
    socket.on('join_room', async ({ roomId, businessId, sessionId } = {}) => {
      if (!roomId) return;
      socket.join(roomId);
      console.log(`[Socket] ${socket.id} joined room: ${roomId}`);

      // Load history from Redis when sessionId is available; fall back to
      // in-process MessageModel for clients that haven't migrated yet.
      let history = [];
      if (sessionId && businessId) {
        history = await getHistory(businessId, sessionId);
      } else {
        history = MessageService.getRoomMessages(roomId);
      }

      socket.emit('message_history', history);

      // Send welcome message only for brand-new sessions (no history yet)
      if (history.length === 0 && businessId) {
        try {
          const name = await BusinessModel.getName(businessId);
          const bizLabel = name || 'nuestro negocio';
          const welcomeText =
            `¡Hola! Bienvenido a ${bizLabel} 👋\n\n` +
            `¿En qué te puedo ayudar? Puedes preguntarme por:\n` +
            `• Disponibilidad de productos y precios\n` +
            `• Servicios que ofrecemos\n` +
            `• Horarios de atención\n` +
            `• Cómo contactarnos o comprar\n\n` +
            `¡Es un placer atenderte! 😊`;
          const welcomeMsg = {
            id:        require('crypto').randomUUID(),
            sender:    'Bot',
            text:      welcomeText,
            timestamp: new Date().toISOString(),
          };
          // Persist welcome message to history (include id for React key)
          if (sessionId && businessId) {
            await redisSaveMessage(businessId, sessionId, {
              id:        welcomeMsg.id,
              role:      'assistant',
              sender:    welcomeMsg.sender,
              text:      welcomeMsg.text,
              timestamp: welcomeMsg.timestamp,
            });
          }
          socket.emit('receive_message', welcomeMsg);
        } catch (err) {
          console.warn('[Welcome] Error al enviar mensaje de bienvenida:', err.message);
        }
      }
    });

    // ── Send a message ───────────────────────────────────────────────────────
    socket.on('send_message', async ({ roomId, sender, text, sessionId, businessId }) => {
      try {
        if (!sessionId || typeof sessionId !== 'string') {
          socket.emit('error', { message: 'sessionId requerido' });
          return;
        }

        if (!businessId || typeof businessId !== 'number') {
          socket.emit('error', { message: 'businessId requerido' });
          return;
        }

        // Track which sessionId this socket is using (needed for disconnect cleanup)
        socketSessions.set(socket.id, sessionId);

        const userTimestamp = new Date().toISOString();

        // 1. Build and emit user message (shape matches history entries)
        const message = {
          id:        require('crypto').randomUUID(),
          roomId,
          sender,
          text,
          timestamp: userTimestamp,
        };
        io.to(roomId).emit('receive_message', message);

        // 2. Persist user message to Redis history (include id for React key)
        await redisSaveMessage(businessId, sessionId, {
          id:        message.id,
          role:      'user',
          sender,
          text,
          timestamp: userTimestamp,
        });

        // 3. Process through NLP pipeline
        const { replyText } = await processMessage({
          text,
          sessionId,
          businessId,
        });

        const botTimestamp = new Date().toISOString();

        // 4. Build and emit bot response
        const botMsg = {
          id:        require('crypto').randomUUID(),
          roomId,
          sender:    'Bot',
          text:      replyText,
          timestamp: botTimestamp,
        };
        io.to(roomId).emit('receive_message', botMsg);

        // 5. Persist bot response to Redis history (include id for React key)
        await redisSaveMessage(businessId, sessionId, {
          id:        botMsg.id,
          role:      'assistant',
          sender:    'Bot',
          text:      replyText,
          timestamp: botTimestamp,
        });

        // 6. Reset idle timer — clock starts from the last bot reply
        resetIdleTimer(sessionId, roomId, businessId);

      } catch (err) {
        socket.emit('error', { message: err.message });
      }
    });

    // ── Typing indicators ────────────────────────────────────────────────────
    socket.on('typing', ({ roomId, sender }) => {
      socket.to(roomId).emit('user_typing', { sender });
    });

    socket.on('stop_typing', ({ roomId, sender }) => {
      socket.to(roomId).emit('user_stop_typing', { sender });
    });

    // ── Disconnect ───────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      console.log(`[Socket] Disconnected: ${socket.id}`);
      // Clear idle timer so we don't send a message to an empty room
      const sessionId = socketSessions.get(socket.id);
      if (sessionId) {
        const entry = sessionTimers.get(sessionId);
        if (entry) {
          clearTimeout(entry.timerId);
          sessionTimers.delete(sessionId);
        }
        socketSessions.delete(socket.id);
      }
    });
  });

  return io;
};

/**
 * Returns the initialized io instance.
 * Use this to emit events from services (e.g. after an AI response is ready).
 */
const getIO = () => {
  if (!io) throw new Error('Socket.io not initialized. Call initSocket() first.');
  return io;
};

module.exports = { initSocket, getIO };


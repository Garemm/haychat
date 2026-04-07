/**
 * hooks/useSocket.js
 *
 * Manages the socket lifecycle for a component tree.
 * Registers event listeners on mount, cleans them up on unmount.
 *
 * MANEJO DE SESIÓN:
 *   socketService.getSessionId() lee (o genera) el sessionId desde localStorage,
 *   garantizando que el mismo usuario vea su historial de mensajes al recargar la
 *   página dentro de las 24 h que dura el TTL de hist:<businessId>:<sessionId>
 *   en Redis.
 *
 *   El sessionId se envía tanto en 'join_room' (para cargar historial) como en
 *   'send_message' (para leer/escribir contexto NLP).
 *
 * Exposes:
 *   sendMessage    — emits 'send_message' con { roomId, sender, text, sessionId, businessId }
 *   emitTyping     — emits indicador 'typing'
 *   emitStopTyping — emits 'stop_typing'
 */

import { useEffect, useRef } from 'react';
import socketService from '../services/socketService';
import { useChat } from '../context/ChatContext';

const useSocket = () => {
  const {
    roomId,
    username,
    businessId,
    addMessage,
    setHistory,
    addTypingUser,
    removeTypingUser,
  } = useChat();

  const joinedRoom = useRef(null);

  useEffect(() => {
    const socket = socketService.connect();
    const sessionId = socketService.getSessionId();

    const doJoin = () => {
      socket.emit('join_room', { roomId, businessId, sessionId });
      joinedRoom.current = roomId;
    };

    // ── Initial join ─────────────────────────────────────────────────────────
    // Join the room exactly once. If the socket is already connected (e.g. the
    // effect is re-running after a dep change), join synchronously.
    // If not yet connected, use .once() so it fires only on the FIRST connect.
    if (joinedRoom.current !== roomId) {
      if (socket.connected) {
        doJoin();
      } else {
        socket.once('connect', doJoin);
      }
    }

    // ── Reconnection join ────────────────────────────────────────────────────
    // 'reconnect' fires ONLY on re-connections, never on the initial one.
    // After a disconnect socket.id changes and room membership is lost.
    const onReconnect = () => doJoin();
    socket.io.on('reconnect', onReconnect);

    socket.on('message_history', setHistory);
    socket.on('receive_message', addMessage);
    socket.on('user_typing', ({ sender }) => {
      if (sender !== username) addTypingUser(sender);
    });
    socket.on('user_stop_typing', ({ sender }) => removeTypingUser(sender));

    return () => {
      socket.off('connect', doJoin);       // clear pending .once if it never fired
      socket.io.off('reconnect', onReconnect);
      socket.off('message_history', setHistory);
      socket.off('receive_message', addMessage);
      socket.off('user_typing');
      socket.off('user_stop_typing');
    };
  }, [roomId, username, addMessage, setHistory, addTypingUser, removeTypingUser]);

  /**
   * Envía el mensaje del usuario incluyendo el sessionId persistente.
   * El backend usa el sessionId para recuperar el contexto NLP de Redis y
   * para persistir el mensaje en hist:<businessId>:<sessionId>.
   */
  const sendMessage = (text) => {
    const sessionId = socketService.getSessionId();
    socketService.getSocket().emit('send_message', { roomId, sender: username, text, sessionId, businessId });
  };

  const emitTyping = () => {
    socketService.getSocket().emit('typing', { roomId, sender: username });
  };

  const emitStopTyping = () => {
    socketService.getSocket().emit('stop_typing', { roomId, sender: username });
  };

  return { sendMessage, emitTyping, emitStopTyping };
};

export default useSocket;


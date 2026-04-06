/**
 * services/socketService.js — Singleton socket.io-client + gestión de sessionId.
 *
 * MANEJO DE SESIÓN ANÓNIMA:
 *   No hay autenticación. Cada usuario genera un sessionId único
 *   (crypto.getRandomValues, compatible con HTTP y HTTPS) que se guarda en
 *   localStorage para persistir durante 24 horas — alineado con el TTL de
 *   hist:<businessId>:<sessionId> en Redis.
 *
 *   El sessionId se envía en join_room y en cada send_message para que el
 *   backend pueda:
 *     - Cargar el historial de mensajes de Redis al reconectar (join_room)
 *     - Recuperar el contexto NLP de Redis (send_message)
 *
 *   Colisiones imposibles: dos usuarios con el mismo nombre tienen UUIDs distintos.
 *
 * POR QUÉ localStorage Y NO sessionStorage:
 *   sessionStorage se limpia al cerrar la pestaña.
 *   localStorage persiste 24 h (alineado con el TTL de historial en Redis),
 *   permitiendo al usuario recargar la página y ver sus mensajes anteriores.
 */

import { io } from 'socket.io-client';

let socket = null;

/**
 * UUID v4 generator compatible with ALL browser contexts (HTTP + HTTPS).
 * crypto.randomUUID() is restricted to secure contexts only (throws on iPhone
 * over plain HTTP). crypto.getRandomValues() has no such restriction.
 */
function generateUUID() {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  buf[6] = (buf[6] & 0x0f) | 0x40; // version 4
  buf[8] = (buf[8] & 0x3f) | 0x80; // variant RFC 4122
  const h = [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

const STORAGE_KEY = 'chat_session_id';

const socketService = {
  /**
   * Returns the user's persistent sessionId.
   * Created once with a UUID v4 and stored in localStorage.
   * Persists across page reloads for up to 24 h (matching Redis hist TTL).
   * @returns {string} UUID v4
   */
  getSessionId() {
    let sessionId = localStorage.getItem(STORAGE_KEY);
    if (!sessionId) {
      sessionId = generateUUID();
      localStorage.setItem(STORAGE_KEY, sessionId);
    }
    return sessionId;
  },

  /**
   * Establece (o reutiliza) la conexión WebSocket.
   * La conexión es compartida por toda la pestaña — un solo socket por pestaña.
   * @returns {import('socket.io-client').Socket}
   */
  connect() {
    if (!socket) {
      socket = io(window.location.origin, {
        autoConnect: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
      });
    }
    return socket;
  },

  disconnect() {
    if (socket) {
      socket.disconnect();
      socket = null;
    }
  },

  getSocket() {
    if (!socket) return this.connect();
    return socket;
  },
};

export default socketService;


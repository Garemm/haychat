/**
 * src/models/messageModel.js
 *
 * MESSAGE MODEL — In-memory store (swap for DB queries when PostgreSQL is ready).
 *
 * MIGRATION GUIDE (when adding PostgreSQL):
 *   1. Import your pg pool or Sequelize instance from '../config/database'
 *   2. Replace each method body with the equivalent SQL query or ORM call
 *   3. Make methods async/return Promises — services already await them
 *   4. Nothing above this layer (services, controllers) needs to change
 *
 * This separation is intentional: the Model layer is the ONLY place that
 * knows how data is stored. The rest of the app doesn't care.
 */

import { v4 as uuidv4 } from 'uuid';

/** @type {Array<{id: string, roomId: string, sender: string, text: string, createdAt: string}>} */
let messages = [];

const MessageModel = {
  /**
   * Returns all messages for a given room.
   * SQL equivalent: SELECT * FROM messages WHERE room_id = $1 ORDER BY created_at ASC
   * @param {string} roomId
   */
  findByRoom(roomId) {
    return messages.filter((m) => m.roomId === roomId);
  },

  /**
   * Persists a new message and returns it.
   * SQL equivalent: INSERT INTO messages (id, room_id, sender, text, created_at) VALUES (...)
   * @param {{ roomId: string, sender: string, text: string }} data
   */
  create({ roomId, sender, text }) {
    const message = {
      id: uuidv4(),
      roomId,
      sender,
      text,
      createdAt: new Date().toISOString(),
    };
    messages.push(message);
    return message;
  },

  /** Dev utility — wipes the in-memory store (useful for tests) */
  clear() {
    messages = [];
  },
};

export default MessageModel;

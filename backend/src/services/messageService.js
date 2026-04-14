/**
 * src/services/messageService.js
 *
 * MESSAGE SERVICE — Business logic layer.
 *
 * WHY A SERVICE LAYER?
 *   Controllers only handle HTTP (req/res). Services hold the real logic.
 *   This makes logic reusable from both HTTP controllers AND socket handlers.
 *
 * FUTURE INTEGRATIONS:
 *   - OpenAI: call the AI API here before/after saving a message
 *     e.g. const aiReply = await openaiService.chat(text);
 *          const botMessage = MessageModel.create({ roomId, sender: 'AI', text: aiReply });
 *
 *   - PostgreSQL: when MessageModel methods become async, make these async too
 *     and await them. The controller/socket handler already wraps calls in try/catch.
 *
 *   - Validation: add Zod or Joi schemas here to validate payloads at the
 *     service boundary (not in the controller).
 */

import MessageModel from '../models/messageModel.js';

const MessageService = {
  /**
   * Retrieves message history for a room.
   * @param {string} roomId
   */
  getRoomMessages(roomId) {
    return MessageModel.findByRoom(roomId);
  },

  /**
   * Saves a new message.
   * @param {{ roomId: string, sender: string, text: string }} payload
   */
  saveMessage({ roomId, sender, text }) {
    if (!roomId || !sender || !text) {
      const err = new Error('roomId, sender, and text are required');
      err.status = 400;
      throw err;
    }
    return MessageModel.create({ roomId, sender, text });
  },
};

export default MessageService;

/**
 * src/routes/messageRoutes.js
 *
 * El flujo principal de mensajería es por Socket.io (chatSocket.js).
 * Esta ruta GET es un endpoint de utilidad para consultar el historial
 * de una sala sin necesidad de conectarse por socket.
 *
 * POST /api/messages fue eliminado — los mensajes se envían por socket
 * desde chatSocket.js, que llama directamente a MessageService.
 */
import { Router } from 'express';
import MessageService from '../services/messageService.js';

const router = Router();

// GET /api/messages/:roomId — Historial de mensajes de una sala
router.get('/:roomId', (req, res, next) => {
  try {
    const messages = MessageService.getRoomMessages(req.params.roomId);
    res.json({ success: true, data: messages });
  } catch (err) {
    next(err);
  }
});

export default router;

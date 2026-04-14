/**
 * src/routes/pedidoRoutes.js
 *
 * Admin REST endpoints for managing purchase orders (pedidos).
 *
 * PUT /api/pedidos/:id
 *   Updates status / notes on a pedido.
 *   After saving, emits 'pedido_actualizado' via Socket.io to the customer's
 *   room (businessId:sessionId) so the receipt card updates in real-time.
 */

import { Router } from 'express';
import PedidoModel from '../models/pedidoModel.js';
import { getIO } from '../sockets/chatSocket.js';

const router = Router();

/**
 * PUT /api/pedidos/:id
 * Body (JSON):
 *   aceptado?      boolean
 *   detallePedido? string
 *   horaRecogida?  string
 *   notasAdmin?    string
 */
router.put('/:id', async (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ success: false, message: 'ID de pedido inválido' });
  }

  const { aceptado, detallePedido, horaRecogida, notasAdmin, liberado, nombreCliente, telefono, rechazado, pedidoListo } = req.body;

  // At least one field must be provided
  if (aceptado === undefined && detallePedido === undefined &&
      horaRecogida === undefined && notasAdmin === undefined && liberado === undefined &&
      nombreCliente === undefined && telefono === undefined && rechazado === undefined &&
      pedidoListo === undefined) {
    return res.status(400).json({ success: false, message: 'No se enviaron cambios' });
  }

  try {
    const updated = await PedidoModel.updatePedido(id, {
      aceptado,
      detallePedido,
      horaRecogida,
      notasAdmin,
      liberado,
      nombreCliente,
      telefono,
      rechazado,
      pedidoListo,
    });

    if (!updated) {
      return res.status(404).json({ success: false, message: 'Pedido no encontrado' });
    }

    // Notify the customer's chat room in real-time
    if (updated.session_id) {
      const room = `${updated.business_id}:${updated.session_id}`;
      try {
        getIO().to(room).emit('pedido_actualizado', {
          id:            updated.id,
          aceptado:      updated.aceptado,
          nombreCliente: updated.nombre_cliente,
          telefono:      updated.telefono,
          detallePedido: updated.detalle_pedido,
          horaRecogida:  updated.hora_recogida,
          notasAdmin:    updated.notas_admin ?? null,
          liberado:      updated.liberado,
          rechazado:     updated.rechazado,
          pedidoListo:   updated.pedido_listo,
        });
      } catch (socketErr) {
        // Socket not initialized or room empty — non-fatal
        console.warn('[PedidoRoutes] Could not emit pedido_actualizado:', socketErr.message);
      }
    }

    return res.json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/pedidos/:id
 * Returns the full pedido row (useful for admin panel polling).
 */
router.get('/:id', async (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ success: false, message: 'ID de pedido inválido' });
  }
  try {
    const pedido = await PedidoModel.getPedidoById(id);
    if (!pedido) return res.status(404).json({ success: false, message: 'Pedido no encontrado' });
    return res.json({ success: true, data: pedido });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/pedidos/:id
 * Customer cancels their own unconfirmed order.
 */
router.delete('/:id', async (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ success: false, message: 'ID de pedido inválido' });
  }
  try {
    const deleted = await PedidoModel.deletePedido(id);
    if (!deleted) return res.status(404).json({ success: false, message: 'Pedido no encontrado' });
    return res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;

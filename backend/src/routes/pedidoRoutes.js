'use strict';

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

const { Router }   = require('express');
const PedidoModel  = require('../models/pedidoModel');
const { getIO }    = require('../sockets/chatSocket');

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

  const { aceptado, detallePedido, horaRecogida, notasAdmin } = req.body;

  // At least one field must be provided
  if (aceptado === undefined && detallePedido === undefined &&
      horaRecogida === undefined && notasAdmin === undefined) {
    return res.status(400).json({ success: false, message: 'No se enviaron cambios' });
  }

  try {
    const updated = await PedidoModel.updatePedido(id, {
      aceptado,
      detallePedido,
      horaRecogida,
      notasAdmin,
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
          detallePedido: updated.detalle_pedido,
          horaRecogida:  updated.hora_recogida,
          notasAdmin:    updated.notas_admin ?? null,
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

module.exports = router;

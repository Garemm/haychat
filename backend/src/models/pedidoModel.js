'use strict';

/**
 * src/models/pedidoModel.js
 *
 * PEDIDO MODEL — PostgreSQL queries for the purchase flow.
 *
 * Methods:
 *   getOrderStatus(businessId)          — Returns acepto_pedidos, phone, email.
 *   createPedido(data)                  — Inserts a new pedido row.
 *   getPedidoById(id)                   — Returns full pedido row.
 *   updatePedido(id, fields)            — Admin updates status / notes.
 */

import db from '../config/database.js';

const PedidoModel = {
  /**
   * Returns { acepto_pedidos, phone, email } for the given business.
   * Returns null when the business does not exist.
   * @param {number} businessId
   */
  async getOrderStatus(businessId) {
    const result = await db.query(
      `SELECT acepto_pedidos, phone, email
       FROM businesses
       WHERE id = $1`,
      [businessId]
    );
    return result.rows[0] ?? null;
  },

  /**
   * Inserts a new pedido and returns the full row.
   * @param {{ businessId: number, sessionId: string, nombreCliente: string, telefono: string, detallePedido: string }} data
   */
  async createPedido({ businessId, sessionId, nombreCliente, telefono, detallePedido }) {
    const result = await db.query(
      `INSERT INTO pedidos
         (business_id, session_id, nombre_cliente, telefono, detalle_pedido)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, session_id, nombre_cliente, telefono, detalle_pedido, hora_recogida, fecha, aceptado, notas_admin, liberado, rechazado, pedido_listo`,
      [businessId, sessionId ?? null, nombreCliente, telefono, detallePedido]
    );
    return result.rows[0];
  },

  /**
   * Returns the full pedido row by id, or null if not found.
   * @param {number} id
   */
  async getPedidoById(id) {
    const result = await db.query(
      `SELECT id, business_id, session_id, nombre_cliente, telefono,
              detalle_pedido, hora_recogida, fecha, aceptado, notas_admin, liberado, rechazado, pedido_listo, created_at
       FROM pedidos
       WHERE id = $1`,
      [id]
    );
    return result.rows[0] ?? null;
  },

  /**
   * Admin updates status / notes on a pedido.
   * Only columns explicitly provided are changed.
   * @param {number} id
   * @param {{ aceptado?: boolean, detallePedido?: string, horaRecogida?: string, notasAdmin?: string }} fields
   * @returns {object|null} Updated row, or null if not found.
   */
  async updatePedido(id, { aceptado, detallePedido, horaRecogida, notasAdmin, liberado, nombreCliente, telefono, rechazado, pedidoListo } = {}) {
    const sets   = [];
    const params = [];
    let   idx    = 1;

    if (aceptado      !== undefined) { sets.push(`aceptado = $${idx++}`);        params.push(aceptado); }
    if (detallePedido !== undefined) { sets.push(`detalle_pedido = $${idx++}`);  params.push(detallePedido); }
    if (horaRecogida  !== undefined) { sets.push(`hora_recogida = $${idx++}`);   params.push(horaRecogida); }
    if (notasAdmin    !== undefined) { sets.push(`notas_admin = $${idx++}`);     params.push(notasAdmin); }
    if (liberado      !== undefined) { sets.push(`liberado = $${idx++}`);        params.push(liberado); }
    if (nombreCliente !== undefined) { sets.push(`nombre_cliente = $${idx++}`);  params.push(nombreCliente); }
    if (telefono      !== undefined) { sets.push(`telefono = $${idx++}`);        params.push(telefono); }
    if (rechazado     !== undefined) { sets.push(`rechazado = $${idx++}`);       params.push(rechazado); }
    if (pedidoListo   !== undefined) { sets.push(`pedido_listo = $${idx++}`);    params.push(pedidoListo); }

    if (sets.length === 0) return null;

    params.push(id);
    const result = await db.query(
      `UPDATE pedidos
       SET ${sets.join(', ')}
       WHERE id = $${idx}
       RETURNING id, business_id, session_id, nombre_cliente, telefono,
                 detalle_pedido, hora_recogida, fecha, aceptado, notas_admin, liberado, rechazado, pedido_listo`,

      params
    );
    return result.rows[0] ?? null;
  },

  /**
   * Deletes a pedido by id. Returns true if deleted, false if not found.
   * @param {number} id
   */
  async deletePedido(id) {
    const result = await db.query(
      `DELETE FROM pedidos WHERE id = $1`,
      [id]
    );
    return (result.rowCount ?? 0) > 0;
  },
};

export default PedidoModel;

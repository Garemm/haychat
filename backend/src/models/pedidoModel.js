'use strict';

/**
 * src/models/pedidoModel.js
 *
 * PEDIDO MODEL — PostgreSQL queries for the purchase flow.
 *
 * Methods:
 *   getOrderStatus(businessId)  — Returns acepto_pedidos, phone, email.
 *   createPedido(data)          — Inserts a new pedido row.
 */

const db = require('../config/database');

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
   * Inserts a new pedido and returns { id, fecha, aceptado }.
   * @param {{ businessId: number, nombreCliente: string, telefono: string, detallePedido: string, horaRecogida: string }} data
   */
  async createPedido({ businessId, nombreCliente, telefono, detallePedido, horaRecogida }) {
    const result = await db.query(
      `INSERT INTO pedidos
         (business_id, nombre_cliente, telefono, detalle_pedido, hora_recogida)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, fecha, aceptado`,
      [businessId, nombreCliente, telefono, detallePedido, horaRecogida]
    );
    return result.rows[0];
  },
};

module.exports = PedidoModel;

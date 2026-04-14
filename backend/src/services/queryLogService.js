'use strict';

/**
 * src/services/queryLogService.js
 *
 * Logs product query events to product_query_logs for analytics.
 * Each call inserts an independent row — one per product per consultation.
 * No counters, no UPSERT: every query is a distinct event record.
 *
 * Non-fatal: errors are logged to console only — never throw to callers.
 */

import db from '../config/database.js';

/**
 * Inserts one log row per product for the current consultation.
 * Fire-and-forget: call without await where performance matters.
 *
 * @param {number}   businessId
 * @param {number[]} productIds  Array of product ids returned in the response
 */
async function logProductQuery(businessId, productIds) {
  if (!businessId || !productIds || productIds.length === 0) return;
  try {
    for (const productId of productIds) {
      await db.query(
        `INSERT INTO product_query_logs (business_id, product_id, query_date, created_at)
         VALUES ($1, $2, CURRENT_DATE, NOW())`,
        [businessId, productId]
      );
    }
  } catch (err) {
    console.warn('[QueryLog] Error logging product query:', err.message);
    if (err.code === '23505') {
      console.error(
        '[QueryLog] Unique constraint violation — run migration 002_refactor_product_query_logs.sql ' +
        'to drop the (business_id, product_id, query_date) constraint before repeated inserts will work.'
      );
    }
  }
}

export { logProductQuery };

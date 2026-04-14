'use strict';

/**
 * src/services/queryLogService.js
 *
 * Logs product query events to product_query_logs for analytics.
 * Uses UPSERT to increment the daily counter per (business_id, product_id, date).
 *
 * Non-fatal: errors are logged to console only — never throw to callers.
 */

import db from '../config/database.js';

/**
 * Increments the query counter for one or more products.
 * Fire-and-forget: call without await where performance matters.
 *
 * @param {number}   businessId
 * @param {number[]} productIds  Array of product ids that were returned in response
 */
async function logProductQuery(businessId, productIds) {
  if (!businessId || !productIds || productIds.length === 0) return;
  try {
    for (const productId of productIds) {
      await db.query(
        `INSERT INTO product_query_logs (business_id, product_id, query_date, query_count)
         VALUES ($1, $2, CURRENT_DATE, 1)
         ON CONFLICT (business_id, product_id, query_date)
         DO UPDATE SET query_count = product_query_logs.query_count + 1`,
        [businessId, productId]
      );
    }
  } catch (err) {
    console.warn('[QueryLog] Error logging product query:', err.message);
  }
}

export { logProductQuery };

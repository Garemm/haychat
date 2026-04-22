'use strict';

/**
 * src/models/businessModel.js
 *
 * BUSINESS MODEL — PostgreSQL queries organized by intent.
 * Each method accepts a businessId and returns rows from the relevant table.
 *
 * ADD NEW INTENTS: add a new method here and register it in businessInfoService.js.
 */

import db from '../config/database.js';

const BusinessModel = {
  /**
   * Returns just the business name — used for the welcome message on join.
   * @param {number} businessId
   */
  async getName(businessId) {
    const result = await db.query(
      'SELECT name FROM businesses WHERE id = $1',
      [businessId]
    );
    return result.rows[0]?.name || null;
  },

  /**
   * Returns the full business profile used to build AI (Ollama) system prompts.
   * Includes name, category (giro), description, city, email, phone, webpage_link.
   * @param {number} businessId
   * @returns {Promise<{id, name, category, description, city, email, phone, webpage_link}|null>}
   */
  async getProfile(businessId) {
    const result = await db.query(
      `SELECT id, name, category, description, city, email, phone, webpage_link
       FROM businesses
       WHERE id = $1`,
      [businessId]
    );
    return result.rows[0] ?? null;
  },

  /**
   * Intent: horarios
   * Returns all weekly schedule rows for the business.
   * @param {number} businessId
   */
  async getHorarios(businessId) {
    const result = await db.query(
      `SELECT
         day_of_week,
         open_time,
         close_time,
         is_closed
       FROM business_hours
       WHERE business_id = $1
       ORDER BY day_of_week ASC`,
      [businessId]
    );
    return result.rows;
  },

  /**
   * Intent: productos
   * Returns all available products with stock info for the business.
   * @param {number} businessId
   */
  async getProductos(businessId) {
    const result = await db.query(
      `SELECT
         p.id,
         p.name,
         p.description,
         p.price,
         p.is_available,
         c.name AS category,
         pi.stock_quantity
       FROM products p
       LEFT JOIN product_inventory pi ON p.id = pi.product_id
       LEFT JOIN categories         c  ON p.category_id = c.id
       WHERE p.business_id = $1
         AND p.is_available = TRUE
       ORDER BY p.name ASC`,
      [businessId]
    );
    return result.rows;
  },

  /**
   * Intent: precios
   * Returns product names and prices for the business.
   * @param {number} businessId
   */
  async getPrecios(businessId) {
    const result = await db.query(
      `SELECT
         name,
         price
       FROM products
       WHERE business_id = $1
         AND is_available = TRUE
       ORDER BY price ASC`,
      [businessId]
    );
    return result.rows;
  },

  /**
   * Intent: promociones
   * Returns active (non-expired) promotions for the business.
   * @param {number} businessId
   */
  async getPromociones(businessId) {
    const result = await db.query(
      `SELECT
         title,
         description,
         discount_type,
         discount_value,
         start_date,
         end_date
       FROM promotions
       WHERE business_id = $1
         AND end_date >= CURRENT_DATE
       ORDER BY end_date ASC`,
      [businessId]
    );
    return result.rows;
  },

  /**
   * Returns the schedule row for a specific day of the week.
   * @param {number} businessId
   * @param {number} dayOfWeek   0 (Sunday) – 6 (Saturday)
   */
  async getHorariosByDay(businessId, dayOfWeek) {
    const result = await db.query(
      `SELECT
         day_of_week,
         open_time,
         close_time,
         is_closed
       FROM business_hours
       WHERE business_id = $1
         AND day_of_week = $2`,
      [businessId, dayOfWeek]
    );
    return result.rows[0] ?? null;
  },

  /**
   * Returns distinct category names available for a business.
   * @param {number} businessId
   */
  async getCategories(businessId) {
    const result = await db.query(
      `SELECT DISTINCT c.name AS category
       FROM products p
       JOIN categories c ON p.category_id = c.id
       WHERE p.business_id = $1
         AND p.is_available = TRUE
       ORDER BY c.name ASC`,
      [businessId]
    );
    return result.rows.map((r) => r.category);
  },

  /**
   * Returns available products filtered by category name, with pagination.
   * @param {number} businessId
   * @param {string} categoryName
   * @param {number} limit
   * @param {number} offset
   */
  async getProductosByCategory(businessId, categoryName, limit = 15, offset = 0) {
    const result = await db.query(
      `SELECT
         p.id,
         p.name,
         p.description,
         p.price,
         p.is_available,
         c.name AS category,
         pi.stock_quantity
       FROM products p
       LEFT JOIN product_inventory pi ON p.id = pi.product_id
       LEFT JOIN categories         c  ON p.category_id = c.id
       WHERE p.business_id = $1
         AND c.name ILIKE $2
         AND p.is_available = TRUE
       ORDER BY p.name ASC
       LIMIT $3 OFFSET $4`,
      [businessId, `%${categoryName}%`, limit, offset]
    );
    return result.rows;
  },

  /**
   * Counts available products in a category.
   * @param {number} businessId
   * @param {string} categoryName
   */
  async countProductosByCategory(businessId, categoryName) {
    const result = await db.query(
      `SELECT COUNT(*) AS total
       FROM products p
       JOIN categories c ON p.category_id = c.id
       WHERE p.business_id = $1
         AND c.name ILIKE $2
         AND p.is_available = TRUE`,
      [businessId, `%${categoryName}%`]
    );
    return parseInt(result.rows[0]?.total ?? '0', 10);
  },

  /**
   * Intent: ubicacion
   * Returns general business location info.
   * @param {number} businessId
   */
  async getUbicacion(businessId) {
    const result = await db.query(
      `SELECT
         name,
         description,
         city,
         webpage_link,
         google_maps_url
       FROM businesses
       WHERE id = $1`,
      [businessId]
    );
    return result.rows[0] || null;
  },

  /**
   * Intent: comprar
   * Returns business contact/location info for purchase guidance.
   * @param {number} businessId
   */
  async getComprarInfo(businessId) {
    const result = await db.query(
      `SELECT
         name,
         description,
         city,
         webpage_link,
         phone,
         email,
         acepto_pedidos
       FROM businesses
       WHERE id = $1`,
      [businessId]
    );
    return result.rows[0] || null;
  },

  /**
   * Intent: contacto
   * Returns phone, email and webpage_link for the business.
   * @param {number} businessId
   */
  async getContactoInfo(businessId) {
    const result = await db.query(
      `SELECT
         name,
         phone,
         email,
         webpage_link
       FROM businesses
       WHERE id = $1`,
      [businessId]
    );
    return result.rows[0] || null;
  },

  /**
   * Returns key/value attributes for an array of product IDs.
   * Result is grouped by product_id: { [productId]: [{ key, value }, ...] }
   * @param {number[]} productIds
   * @returns {Promise<Record<number, {key:string,value:string}[]>>}
   */
  async getProductAttributes(productIds) {
    if (!productIds || productIds.length === 0) return {};
    const placeholders = productIds.map((_, i) => `$${i + 1}`).join(', ');
    const result = await db.query(
      `SELECT product_id, key, value
       FROM product_attributes
       WHERE product_id IN (${placeholders})
       ORDER BY key ASC`,
      productIds
    );
    const map = {};
    for (const row of result.rows) {
      if (!map[row.product_id]) map[row.product_id] = [];
      map[row.product_id].push({ key: row.key, value: row.value });
    }
    return map;
  },

  /**
   * Intent: servicios
   * Returns all services offered by a business.
   * @param {number} businessId
   * @returns {Promise<{id,name,description,price}[]>}
   */
  async getServices(businessId) {
    const result = await db.query(
      `SELECT id, name, description, price
       FROM business_services
       WHERE business_id = $1
       ORDER BY name ASC`,
      [businessId]
    );
    return result.rows;
  },

  /**
   * Searches business services by name keyword.
   * @param {number} businessId
   * @param {string} name  Partial name to match (ILIKE).
   * @returns {Promise<{id,name,description,price}[]>}
   */
  async getServiceByName(businessId, name) {
    const result = await db.query(
      `SELECT id, name, description, price
       FROM business_services
       WHERE business_id = $1
         AND name ILIKE $2
       ORDER BY name ASC
       LIMIT 5`,
      [businessId, `%${name}%`]
    );
    return result.rows;
  },

  /**
   * Returns all registered businesses (id, chat_uuid, name, type, city).
   * Used by the frontend BusinessSelector to populate the selection screen.
   */
  async getAllBusinesses() {
    const result = await db.query(
      `SELECT id, chat_uuid, name, category, city
       FROM businesses
       ORDER BY id ASC`
    );
    return result.rows;
  },

  /**
   * Looks up a business by its public chat_uuid.
   * @param {string} chatUuid
   * @returns {Promise<{id, name, city}|null>}
   */
  async getByUuid(chatUuid) {
    const result = await db.query(
      `SELECT id, name, city, acepto_pedidos
       FROM businesses
       WHERE chat_uuid = $1`,
      [chatUuid]
    );
    return result.rows[0] ?? null;
  },

  /**
   * Returns the subscription plan ID for a business.
   *   1 = Lite    → no AI, placeholder response
   *   2 = Premium → full AI via llama3 (Ollama)
   * Returns null when the business row is not found.
   * @param {number} businessId
   * @returns {Promise<number|null>}
   */
  async getSubscriptionId(businessId) {
    const result = await db.query(
      'SELECT subscription_id FROM businesses WHERE id = $1',
      [businessId]
    );
    return result.rows[0]?.subscription_id ?? null;
  },
};

export default BusinessModel;

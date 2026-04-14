'use strict';

/**
 * src/services/businessInfoService.js
 *
 * BUSINESS INFO SERVICE — Maps a detected intent to the correct DB query
 * and returns the results.
 *
 * ADD NEW INTENTS: add a new entry to QUERY_MAP pointing to the BusinessModel
 * method that handles it.
 */

import BusinessModel from '../models/businessModel.js';

/**
 * Maps each intent key to the BusinessModel method that handles it.
 * @type {Record<string, (businessId: number) => Promise<any>>}
 */
const QUERY_MAP = {
  horarios:    (businessId) => BusinessModel.getHorarios(businessId),
  productos:   (businessId) => BusinessModel.getProductos(businessId),
  precios:     (businessId) => BusinessModel.getPrecios(businessId),
  promociones: (businessId) => BusinessModel.getPromociones(businessId),
  ubicacion:   (businessId) => BusinessModel.getUbicacion(businessId),
  servicios:   (businessId) => BusinessModel.getServices(businessId),
  comprar:     (businessId) => BusinessModel.getComprarInfo(businessId),
  contacto:    (businessId) => BusinessModel.getContactoInfo(businessId),
};

/**
 * Fetches the relevant business information from the DB based on a detected intent.
 * @param {string} intentName   Intent key (must exist in QUERY_MAP).
 * @param {number} businessId   The business to query.
 * @returns {Promise<any>}      Rows or object from the database.
 */
async function getBusinessInfoByIntent(intentName, businessId) {
  const queryFn = QUERY_MAP[intentName];
  if (!queryFn) {
    throw new Error(`[BusinessInfoService] No query mapped for intent: "${intentName}"`);
  }
  return queryFn(businessId);
}

/**
 * Fetches the schedule for a specific day of the week.
 * @param {number} businessId
 * @param {number} dayOfWeek  0=Sunday … 6=Saturday
 * @returns {Promise<object|null>}
 */
async function getHorariosByDay(businessId, dayOfWeek) {
  return BusinessModel.getHorariosByDay(businessId, dayOfWeek);
}

/**
 * Returns distinct category names for a business.
 * @param {number} businessId
 * @returns {Promise<string[]>}
 */
async function getCategories(businessId) {
  return BusinessModel.getCategories(businessId);
}

/**
 * Returns paginated products for a given category.
 * @param {number} businessId
 * @param {string} categoryName
 * @param {number} limit
 * @param {number} offset
 * @returns {Promise<object[]>}
 */
async function getProductosByCategory(businessId, categoryName, limit = 15, offset = 0) {
  return BusinessModel.getProductosByCategory(businessId, categoryName, limit, offset);
}

/**
 * Counts products in a given category.
 * @param {number} businessId
 * @param {string} categoryName
 * @returns {Promise<number>}
 */
async function countProductosByCategory(businessId, categoryName) {
  return BusinessModel.countProductosByCategory(businessId, categoryName);
}

/**
 * Returns key/value attributes grouped by product_id.
 * @param {number[]} productIds
 * @returns {Promise<Record<number, {key:string,value:string}[]>>}
 */
async function getProductAttributes(productIds) {
  return BusinessModel.getProductAttributes(productIds);
}

/**
 * Searches services by partial name for a business.
 * @param {number} businessId
 * @param {string} name
 * @returns {Promise<{id,name,description,price}[]>}
 */
async function getServiceByName(businessId, name) {
  return BusinessModel.getServiceByName(businessId, name);
}

export {
  getBusinessInfoByIntent,
  getHorariosByDay,
  getCategories,
  getProductosByCategory,
  countProductosByCategory,
  getProductAttributes,
  getServiceByName,
};

'use strict';

/**
 * src/services/attributeSearchService.js
 *
 * ATTRIBUTE SEARCH SERVICE — Searches products by semantic attributes.
 *
 * Searches across:
 *   1. product.name       (ILIKE)
 *   2. product.description (ILIKE)
 *   3. product_attributes  key/value (ILIKE)
 *   4. category.name       (ILIKE)
 *
 * Uses wordVariants() from normalize.js to handle singular/plural.
 * Does NOT depend on OpenAI.
 *
 * Multi-attribute search:
 *   Pass an array of { value, type } objects to combine conditions with AND.
 *   e.g. [{ value: "queso" }, { value: "pollo" }] → products with BOTH.
 */

import db from '../config/database.js';
import { wordVariants } from './normalize.js';
import { isMaterial } from './attributeExtractor.js';

/** Maximum results to return per attribute search. */
const ATTR_SEARCH_LIMIT = 20;

// ─── Single-attribute query ───────────────────────────────────────────────────

/**
 * Builds ILIKE conditions + params for one attribute value using wordVariants.
 *
 * Returns { conditions: string[], params: any[] }
 * Caller is responsible for building the full WHERE clause and merging params.
 *
 * @param {string} attrValue         Normalized attribute value
 * @param {number} paramStartIndex   1-based index of the next $N parameter
 * @returns {{ conditions: string[], params: string[], nextIndex: number }}
 */
function buildAttributeConditions(attrValue, paramStartIndex) {
  const variants = wordVariants(attrValue);
  const conditions = [];
  const params = [];
  let idx = paramStartIndex;

  for (const v of variants) {
    const like = `%${v}%`;
    conditions.push(
      `(p.name ILIKE $${idx} OR p.description ILIKE $${idx + 1} OR ` +
      `EXISTS (SELECT 1 FROM product_attributes pa WHERE pa.product_id = p.id AND ` +
      `(pa.value ILIKE $${idx + 2} OR pa.key ILIKE $${idx + 3})) OR ` +
      `c.name ILIKE $${idx + 4})`
    );
    params.push(like, like, like, like, like);
    idx += 5;
  }

  return { conditions, params, nextIndex: idx };
}

/**
 * Searches products matching a single attribute value.
 *
 * @param {string} attrValue  Normalized attribute value (e.g. "queso", "bluetooth")
 * @param {number} businessId
 * @returns {Promise<Array>}  Product rows
 */
async function searchByAttribute(attrValue, businessId) {
  const { conditions, params } = buildAttributeConditions(attrValue, 2);
  const whereAttr = conditions.map((c) => `(${c})`).join(' OR ');

  const result = await db.query(
    `SELECT
       p.id, p.name, p.description, p.price, p.is_available,
       pi.stock_quantity, c.name AS category
     FROM products p
     LEFT JOIN product_inventory pi ON p.id = pi.product_id
     LEFT JOIN categories c ON p.category_id = c.id
     WHERE p.business_id = $1
       AND (${whereAttr})
     ORDER BY p.name ASC
     LIMIT ${ATTR_SEARCH_LIMIT}`,
    [businessId, ...params]
  );
  return result.rows;
}

// ─── Multi-attribute query ────────────────────────────────────────────────────

/**
 * Searches products matching ALL supplied attributes (AND logic).
 * Falls back to OR logic when no products match all conditions.
 *
 * @param {Array<{ value: string }>} attributes  Array of extracted attributes
 * @param {number}                   businessId
 * @returns {Promise<{ rows: Array, strategy: 'AND'|'OR' }>}
 */
async function searchByAttributes(attributes, businessId) {
  if (!attributes || attributes.length === 0) {
    return { rows: [], strategy: 'AND' };
  }

  if (attributes.length === 1) {
    const rows = await searchByAttribute(attributes[0].value, businessId);
    return { rows, strategy: 'AND' };
  }

  // Try AND first (more precise)
  const andRows = await _searchMultiAND(attributes, businessId);
  if (andRows.length > 0) return { rows: andRows, strategy: 'AND' };

  // Fallback: OR (at least one attribute matches)
  const orRows = await _searchMultiOR(attributes, businessId);
  return { rows: orRows, strategy: 'OR' };
}

async function _searchMultiAND(attributes, businessId) {
  let idx = 2;
  const allParams = [businessId];
  const andClauses = [];

  for (const attr of attributes) {
    const { conditions, params, nextIndex } = buildAttributeConditions(attr.value, idx);
    const attrClause = conditions.map((c) => `(${c})`).join(' OR ');
    andClauses.push(`(${attrClause})`);
    allParams.push(...params);
    idx = nextIndex;
  }

  const result = await db.query(
    `SELECT
       p.id, p.name, p.description, p.price, p.is_available,
       pi.stock_quantity, c.name AS category
     FROM products p
     LEFT JOIN product_inventory pi ON p.id = pi.product_id
     LEFT JOIN categories c ON p.category_id = c.id
     WHERE p.business_id = $1
       AND ${andClauses.join(' AND ')}
     ORDER BY p.name ASC
     LIMIT ${ATTR_SEARCH_LIMIT}`,
    allParams
  );
  return result.rows;
}

async function _searchMultiOR(attributes, businessId) {
  let idx = 2;
  const allParams = [businessId];
  const orClauses = [];

  for (const attr of attributes) {
    const { conditions, params, nextIndex } = buildAttributeConditions(attr.value, idx);
    const attrClause = conditions.map((c) => `(${c})`).join(' OR ');
    orClauses.push(`(${attrClause})`);
    allParams.push(...params);
    idx = nextIndex;
  }

  const result = await db.query(
    `SELECT
       p.id, p.name, p.description, p.price, p.is_available,
       pi.stock_quantity, c.name AS category
     FROM products p
     LEFT JOIN product_inventory pi ON p.id = pi.product_id
     LEFT JOIN categories c ON p.category_id = c.id
     WHERE p.business_id = $1
       AND (${orClauses.join(' OR ')})
     ORDER BY p.name ASC
     LIMIT ${ATTR_SEARCH_LIMIT}`,
    allParams
  );
  return result.rows;
}

// ─── Compound query (entity + "de" + attribute) ───────────────────────────────

/**
 * Builds a word-boundary-safe condition for a single term across name and description.
 * For single-word terms, uses PostgreSQL regex (~*) with \m...\M word boundaries
 * to prevent substring false positives (e.g. 'res' matching inside 'fresca').
 * For multi-word terms (phrases), falls back to ILIKE since \m/\M don't span spaces.
 * Includes all wordVariants (singular/plural) joined with OR.
 *
 * @param {string} term
 * @param {number} paramStartIndex  1-based index for the next $N param
 * @returns {{ clause: string, params: string[], nextIndex: number }}
 */
function buildTermClause(term, paramStartIndex) {
  const variants = wordVariants(term);
  const parts = [];
  const params = [];
  let idx = paramStartIndex;

  for (const v of variants) {
    if (/\s/.test(v)) {
      // Multi-word phrase: ILIKE substring (phrase itself is already distinct)
      const like = `%${v}%`;
      parts.push(
        `(p.name ILIKE $${idx} OR p.description ILIKE $${idx + 1} OR ` +
        `EXISTS (SELECT 1 FROM product_attributes pa_t WHERE pa_t.product_id = p.id AND pa_t.value ILIKE $${idx + 2}))`
      );
      params.push(like, like, like);
      idx += 3;
    } else {
      // Single word: word-boundary regex so 'res' does NOT match 'fresca'
      const pattern = `\\m${v}\\M`;
      parts.push(
        `(p.name ~* $${idx} OR p.description ~* $${idx + 1} OR ` +
        `EXISTS (SELECT 1 FROM product_attributes pa_t WHERE pa_t.product_id = p.id AND pa_t.value ~* $${idx + 2}))`
      );
      params.push(pattern, pattern, pattern);
      idx += 3;
    }
  }

  return { clause: `(${parts.join(' OR ')})`, params, nextIndex: idx };
}

/** Reusable SELECT + FROM + JOINs block for product queries. */
const PRODUCT_SELECT =
  `SELECT p.id, p.name, p.description, p.price, p.is_available, ` +
  `pi.stock_quantity, c.name AS category ` +
  `FROM products p ` +
  `LEFT JOIN product_inventory pi ON p.id = pi.product_id ` +
  `LEFT JOIN categories c ON p.category_id = c.id`;

/**
 * 3-layer compound query search for "ENTITY de ATTRIBUTE" phrases.
 *
 * Layer 1 — Exact phrase match (highest priority):
 *   WHERE name ILIKE '%tornillos de madera%' OR description ILIKE '%tornillos de madera%'
 *
 * Layer 2 — Entity AND attribute (strict, no false positives):
 *   WHERE (name ILIKE '%tornillo%' OR …) AND (name ILIKE '%madera%' OR …)
 *   Prevents "martillo de madera" from appearing when asking for "tornillos de madera".
 *
 * Layer 3 — Entity-only fallback (safe):
 *   WHERE name ILIKE '%tornillo%' OR description ILIKE '%tornillo%'
 *   Never falls back to attribute-only; the entity is always required.
 *
 * @param {{ entity: string, attribute: string, fullPhrase: string }} compound
 * @param {number} businessId
 * @returns {Promise<{ rows: Array, strategy: 'exact'|'entity+attribute'|'entity-only' }>}
 */
async function searchByCompoundQuery({ entity, attribute, fullPhrase }, businessId) {
  // ── Layer 1: exact phrase ──────────────────────────────────────────────────
  // Searches name, description AND product_attributes.value for the full phrase.
  const phraseVariants = wordVariants(fullPhrase);
  {
    const parts = [];
    const params = [businessId];
    let idx = 2;
    for (const v of phraseVariants) {
      const like = `%${v}%`;
      parts.push(
        `(p.name ILIKE $${idx} OR p.description ILIKE $${idx + 1} OR ` +
        `EXISTS (SELECT 1 FROM product_attributes pa_l1 WHERE pa_l1.product_id = p.id AND pa_l1.value ILIKE $${idx + 2}))`
      );
      params.push(like, like, like);
      idx += 3;
    }
    const result = await db.query(
      `${PRODUCT_SELECT} WHERE p.business_id = $1 AND (${parts.join(' OR ')}) ` +
      `ORDER BY p.name ASC LIMIT ${ATTR_SEARCH_LIMIT}`,
      params
    );
    if (result.rows.length > 0) return { rows: result.rows, strategy: 'exact' };
  }

  // ── Layer 2: entity AND attribute ─────────────────────────────────────────
  // Both terms must appear somewhere (name / description / product_attributes).
  // Includes product_attributes so hamburguesas with 'res' in attrs are found.
  const entityClause    = buildTermClause(entity,    2);
  const attributeClause = buildTermClause(attribute, entityClause.nextIndex);
  {
    const params = [businessId, ...entityClause.params, ...attributeClause.params];
    const result = await db.query(
      `${PRODUCT_SELECT} WHERE p.business_id = $1 ` +
      `AND ${entityClause.clause} AND ${attributeClause.clause} ` +
      `ORDER BY p.name ASC LIMIT ${ATTR_SEARCH_LIMIT}`,
      params
    );
    if (result.rows.length > 0) return { rows: result.rows, strategy: 'entity+attribute' };
  }

  // ── Layer 2c: base-noun + attribute ─────────────────────────────────────
  // Activated when entity is multi-word (e.g. "hamburguesa doble") and Layer 2
  // found nothing. Strips adjective/modifier words and retries with just the
  // first meaningful noun ("hamburguesa") + attribute.
  // Prevents "hamburguesa doble + queso" from leaking into attribute-only results
  // that include unrelated products (pizza con queso, tacos con queso, etc.).
  if (/\s/.test(entity)) {
    const PREP_ART = new Set(['de', 'del', 'con', 'sin', 'al', 'a', 'en', 'el', 'la', 'los', 'las', 'un', 'una']);
    const baseNoun = entity.split(/\s+/).find((w) => !PREP_ART.has(w)) || entity.split(/\s+/)[0];
    if (baseNoun !== entity) {
      const baseClause    = buildTermClause(baseNoun, 2);
      const attrClause2c  = buildTermClause(attribute, baseClause.nextIndex);
      const params2c = [businessId, ...baseClause.params, ...attrClause2c.params];
      const result2c = await db.query(
        `${PRODUCT_SELECT} WHERE p.business_id = $1 ` +
        `AND ${baseClause.clause} AND ${attrClause2c.clause} ` +
        `ORDER BY p.name ASC LIMIT ${ATTR_SEARCH_LIMIT}`,
        params2c
      );
      if (result2c.rows.length > 0) return { rows: result2c.rows, strategy: 'base+attribute' };
    }
  }

  // ── Layer 2b: attribute-only with word boundary ───────────────────────────
  // Activated ONLY when the attribute is NOT a material word.
  //
  // Rationale:
  //   • Non-material attributes like 'res' act as a category identifier.
  //     Any product tagged with that word (in name, desc, or attrs) is valid
  //     even if the entity word ('carne') doesn't appear literally.
  //     Example: 'caldo de res', 'chiles en nogada', 'hamburguesa clásica'
  //     all have 'res' but not 'carne' → still correct results.
  //
  //   • Material attributes (madera, cobre, acero…) are qualifiers, not
  //     category identifiers. Without the entity, 'madera' alone would match
  //     'martillo de madera' when asking for 'tornillos de madera' → skipped.
  if (!isMaterial(attribute)) {
    const ac = buildTermClause(attribute, 2);
    const params = [businessId, ...ac.params];
    const result = await db.query(
      `${PRODUCT_SELECT} WHERE p.business_id = $1 AND ${ac.clause} ` +
      `ORDER BY p.name ASC LIMIT ${ATTR_SEARCH_LIMIT}`,
      params
    );
    if (result.rows.length > 0) return { rows: result.rows, strategy: 'attribute-only' };
  }

  // ── Layer 3: entity-only fallback ─────────────────────────────────────────
  {
    const ec = buildTermClause(entity, 2);
    const params = [businessId, ...ec.params];
    const result = await db.query(
      `${PRODUCT_SELECT} WHERE p.business_id = $1 AND ${ec.clause} ` +
      `ORDER BY p.name ASC LIMIT ${ATTR_SEARCH_LIMIT}`,
      params
    );
    return { rows: result.rows, strategy: 'entity-only' };
  }
}

// ─── Category + attribute query ─────────────────────────────────────────────────────────────────────────

/**
 * Searches products filtered by category name AND a term present in the
 * product’s name / description / product_attributes.
 *
 * Used for queries like:
 *   "alguna bebida con chocolate"  → category=bebida, attribute=chocolate
 *   "algun postre de arroz"        → category=postre,  attribute=arroz
 *
 * Strategy:
 *   Layer 1 — category name matches AND attribute term present in product
 *   Layer 2 — attribute-only fallback (when category name doesn’t match any row)
 *
 * @param {{ categoryWord: string, attribute: string }} query
 * @param {number} businessId
 * @returns {Promise<{ rows: Array, strategy: string }>}
 */
async function searchByCategoryAttribute({ categoryWord, attribute }, businessId) {
  const catVariants  = wordVariants(categoryWord);
  const catParts     = [];
  const catParams    = [];
  let   catIdx       = 2;

  for (const v of catVariants) {
    catParts.push(`c.name ILIKE $${catIdx}`);
    catParams.push(`%${v}%`);
    catIdx += 1;
  }
  const catClause = catParts.join(' OR ');

  // Attribute conditions start after all category params
  const attrResult = buildTermClause(attribute, catIdx);

  // Layer 1: products whose category matches AND contain the attribute
  {
    const params = [businessId, ...catParams, ...attrResult.params];
    const result = await db.query(
      `${PRODUCT_SELECT} WHERE p.business_id = $1 ` +
      `AND (${catClause}) AND ${attrResult.clause} ` +
      `ORDER BY p.name ASC LIMIT ${ATTR_SEARCH_LIMIT}`,
      params
    );
    if (result.rows.length > 0) return { rows: result.rows, strategy: 'category+attribute' };
  }

  // Layer 2: attribute-only fallback (category name didn’t match in DB)
  {
    const ac     = buildTermClause(attribute, 2);
    const params = [businessId, ...ac.params];
    const result = await db.query(
      `${PRODUCT_SELECT} WHERE p.business_id = $1 AND ${ac.clause} ` +
      `ORDER BY p.name ASC LIMIT ${ATTR_SEARCH_LIMIT}`,
      params
    );
    return { rows: result.rows, strategy: 'attribute-only' };
  }
}

/**
 * Formats category+attribute search results into natural, voice-friendly Spanish.
 *
 * @param {{ categoryWord: string, attribute: string }} query
 * @param {Array}  rows
 * @param {string} strategy
 * @returns {string}
 */
function formatCategoryAttributeResponse(query, rows, strategy) {
  const catLabel  = query.categoryWord;
  const attrLabel = query.attribute;
  const label     = `${catLabel} con ${attrLabel}`;

  if (!rows || rows.length === 0) {
    return `Lo siento, no encontré productos de ${label}. ¿Quieres ver el catálogo completo o buscar algo diferente?`;
  }

  const fallbackNote =
    strategy === 'attribute-only'
      ? ` No encontré una categoría "${catLabel}" exactamente, pero te muestro opciones con "${attrLabel}".`
      : '';

  const items   = _buildVoiceList(rows);
  const hasMore = rows.length > VOICE_PREVIEW;
  const listed  = _enumList(items);

  if (rows.length === 1) {
    return `Sí 😊, tenemos ${listed}.${fallbackNote} ¿Te interesa o buscas algo más?`;
  }
  if (hasMore) {
    return `Sí 😊, tenemos varias opciones de ${label}, como ${listed}, entre otras.${fallbackNote} ¿Buscas algo en específico?`;
  }
  return `Sí 😊, tenemos varias opciones de ${label}: ${listed}.${fallbackNote} ¿Cuál te interesa?`;
}

// ─── Voice-friendly response helpers ─────────────────────────────────────────

/** Max products to name in a conversational list (voice-optimized). */
const VOICE_PREVIEW = 3;

/** "A, B y C" natural enumeration. */
function _enumList(items) {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
}

/** Returns the first VOICE_PREVIEW products as "Name a $X" strings. */
function _buildVoiceList(rows) {
  return rows.slice(0, VOICE_PREVIEW).map((p) =>
    p.is_available !== false
      ? `${p.name} a $${Number(p.price).toFixed(2)}`
      : `${p.name} (no disponible)`
  );
}

// ─── Compound query response formatter ───────────────────────────────────────

/**
 * Formats compound query search results into a natural, voice-friendly Spanish response.
 *
 * @param {{ entity: string, attribute: string, fullPhrase: string }} compound
 * @param {Array}  rows
 * @param {'exact'|'entity+attribute'|'entity-only'} strategy
 * @returns {string}
 */
function formatCompoundQueryResponse(compound, rows, strategy) {
  const label = compound.fullPhrase;

  if (!rows || rows.length === 0) {
    return `Lo siento, no encontré productos relacionados con "${label}". ¿Quieres ver el catálogo completo o buscar algo diferente?`;
  }

  const prefix =
    strategy === 'entity-only'
      ? `No encontré "${compound.fullPhrase}" exactamente, pero aquí tienes opciones de "${compound.entity}": `
      : strategy === 'attribute-only'
      ? `No encontré "${compound.entity}" específicamente, pero te muestro opciones con "${compound.attribute}": `
      : '';

  const items   = _buildVoiceList(rows);
  const hasMore = rows.length > VOICE_PREVIEW;
  const listed  = _enumList(items);

  if (rows.length === 1) {
    return prefix
      ? `${prefix}${listed}. ¿Te interesa o buscas algo más?`
      : `Sí 😊, tenemos ${listed}. ¿Te interesa o buscas algo más?`;
  }
  if (hasMore) {
    return prefix
      ? `${prefix}${listed}, entre otras. Si buscas algo en específico, dime y te ayudo.`
      : `Sí 😊, tenemos varias opciones con ${label}, como ${listed}, entre otras. Si buscas algo en específico, dime y te ayudo.`;
  }
  return prefix
    ? `${prefix}${listed}. ¿Cuál te interesa?`
    : `Sí 😊, tenemos varias opciones con ${label}: ${listed}. ¿Cuál te interesa?`;
}

// ─── Response formatter ───────────────────────────────────────────────────────

/**
 * Formats attribute search results into a natural, voice-friendly Spanish response.
 *
 * @param {Array<{ value: string }>} attributes
 * @param {Array}  rows
 * @param {'AND'|'OR'} strategy
 * @returns {string}
 */
function formatAttributeResponse(attributes, rows, strategy = 'AND') {
  const label = _enumList(attributes.map((a) => a.value));

  if (!rows || rows.length === 0) {
    return `Lo siento, no encontré productos relacionados con ${label}. ¿Quieres ver el catálogo completo o buscar algo diferente?`;
  }

  const strategyNote =
    strategy === 'OR' && attributes.length > 1
      ? ` Algunos no tienen todos los criterios, pero son las opciones más cercanas.`
      : '';

  const items   = _buildVoiceList(rows);
  const hasMore = rows.length > VOICE_PREVIEW;
  const listed  = _enumList(items);

  if (rows.length === 1) {
    return `Sí 😊, tenemos ${listed}.${strategyNote} ¿Quieres saber algo más?`;
  }
  if (hasMore) {
    return `Sí 😊, tenemos varias opciones con ${label}, como ${listed}, entre otras.${strategyNote} ¿Buscas algo en específico?`;
  }
  return `Sí 😊, tenemos ${rows.length} opciones con ${label}: ${listed}.${strategyNote} ¿Cuál te interesa?`;
}

export {
  searchByAttribute,
  searchByAttributes,
  searchByCompoundQuery,
  searchByCategoryAttribute,
  formatAttributeResponse,
  formatCompoundQueryResponse,
  formatCategoryAttributeResponse,
  buildAttributeConditions,
  ATTR_SEARCH_LIMIT,
};

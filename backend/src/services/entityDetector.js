'use strict';

/**
 * src/services/entityDetector.js
 *
 * ENTITY DETECTOR — Multi-type entity extraction from user messages.
 *
 * Detects four entity types:
 *   - product:   a specific product name ("laptop gamer", "hamburguesa doble")
 *   - category:  a product category ("herramientas", "bebidas", "cuadernos")
 *   - promotion: a reference to a specific promotion ("2x1 en pizzas")
 *   - attribute: a semantic attribute query ("algo con queso", "para madera")
 *
 * DESIGN:
 *   - Does NOT hardcode product/category names — queries the DB dynamically
 *   - Uses regex patterns to extract candidate entities from Spanish phrases
 *   - The patterns are industry-agnostic (work for restaurant, hardware, stationery, etc.)
 *   - Falls back to Compromise NLP noun-phrase extraction as last resort
 *
 * PIPELINE POSITION:
 *   Runs AFTER intentDetector. The intent result helps disambiguate:
 *   - "tienen descuentos?" → intent=promociones, entity=null (no specific promo)
 *   - "tienen laptop?"     → intent=null (no strong phrase), entity=product:"laptop"
 *   - "algo con queso?"     → intent=productos, entity=attribute:"queso"
 */

const nlp = require('compromise');
const db  = require('../config/database');
const { normalize, toSingular, wordVariants } = require('./normalize');
const { extractAttribute, extractCompoundQuery, extractCategoryAttributeQuery, isMaterial } = require('./attributeExtractor');

// ─── Stopwords ────────────────────────────────────────────────────────────────

const ENTITY_STOPWORDS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas',
  'de', 'del', 'al', 'en', 'por', 'para', 'con', 'sin',
  'disponible', 'disponibles', 'ese', 'esa', 'esos', 'esas',
  'algun', 'alguna', 'tambien', 'mas', 'otro', 'otra',
  'ese', 'aqui', 'ahi', 'alli', 'eso', 'esto',
  // Prepositions that lead entity fragments but are never part of an entity name
  'sobre', 'acerca',
  // Affirmation that precedes a real query ("si sobre el menu...") — never entity name
  'si',
]);

/**
 * Generic / meta words that are NEVER valid entity names.
 * If the entire extracted entity is one of these → reject.
 */
const ENTITY_BLOCKLIST = new Set([
  'producto', 'productos', 'articulo', 'articulos',
  'item', 'items', 'cosa', 'cosas', 'mercancia',
  'catalogo', 'lista', 'menu',
  'servicio', 'servicios', 'oferta', 'ofertas',
  'algo', 'todo', 'nada', 'mucho', 'poco',
  'promocion', 'promociones', 'descuento', 'descuentos',
  // Intent-domain words — these are intent names, not valid product entities.
  // Without blocking them, "que horarios tienen?" would extract "horarios" as
  // a false product entity and override the correct intent routing.
  'horario', 'horarios',
  'precios',          // singular 'precio' already covered below
  'ubicacion', 'ubicaciones',
  // Verb forms — Compromise NLP can extract conjugated verb stems as nouns
  // (e.g. "tienen" from "que promociones tienen"). Block all common forms.
  'tiene', 'tienen', 'tienes', 'tener',
  'hay', 'haber',
  // Question words — never entity names
  'cuanto', 'cuanta', 'cuantos', 'cuantas',
  'cuando', 'donde', 'como', 'cual', 'cuales', 'quien',
  'que', 'precio', 'costo', 'tarifa',
  // Command verbs — imperative forms that trigger actions but are never entities
  'muestrame', 'dame', 'pasame', 'mandame', 'enviame',
  // Freestanding prepositions / affirmations that NLP misidentifies as nouns
  'sobre', 'acerca', 'si',
]);

function isBlocklisted(entity) {
  if (ENTITY_BLOCKLIST.has(entity)) return true;
  return entity.split(/\s+/).some((w) => ENTITY_BLOCKLIST.has(w));
}

function stripLeadingStopwords(entity) {
  const words = entity.trim().split(/\s+/);
  let start = 0;
  while (start < words.length - 1 && ENTITY_STOPWORDS.has(words[start])) {
    start++;
  }
  return words.slice(start).join(' ').trim();
}

// ─── Trigger words for NLP fallback ───────────────────────────────────────────

const PRODUCT_TRIGGER_WORDS = new Set([
  'tiene', 'tienen', 'tienes', 'hay', 'busco', 'quiero', 'existe', 'existen',
  'disponible', 'disponibles', 'stock',
  'conseguir', 'comprar', 'pedir', 'ordenar', 'solicitar',
  'informacion', 'info', 'detalle', 'detalles',
  'vende', 'vendes', 'venden',
  'ofrece', 'ofrecen', 'necesito',
  // Price-query trigger words
  'precio', 'precios', 'cuesta', 'cuanto', 'vale', 'cobran', 'costo',
  // Description-query trigger words
  'contiene', 'incluye', 'trae', 'lleva', 'llevan', 'caracteristicas', 'especificaciones', 'descripcion',
  // Catalog/menu trigger words
  'catalogo', 'menu', 'lista', 'dame', 'muestrame',
]);

function hasProductTrigger(normalizedText) {
  return normalizedText.split(/\s+/).some((w) => PRODUCT_TRIGGER_WORDS.has(w));
}

// ─── Extraction regex patterns (industry-agnostic Spanish) ────────────────────

const PRODUCT_QUERY_PATTERNS = [
  // "cuantas/cuantos X tienes/tienen/hay" — verb AFTER entity
  /cu[ae]n(?:to|ta)s?\s+(?:de\s+)?(?<entity>[\wñ\s]+?)\s+(?:tienes?|tienen|hay)(?:\?|$)/,
  /tienen\s+disponible\s+(?<entity>[\wñ\s]+?)(?:\?|$)/,
  /hay\s+disponibilidad\s+de\s+(?<entity>[\wñ\s]+?)(?:\?|$)/,
  /cu[ae]nto\s+(?:cuesta|vale|sale|cobran\s+por)\s+(?:el\s+|la\s+|los\s+|las\s+|un\s+|una\s+)?(?<entity>[\wñ\s]+?)(?:\?|$)/,
  // "que precio tiene la hamburguesa" / "cual es el precio de la pizza"
  /(?:que\s+|cual\s+es\s+(?:el\s+)?)?precio\s+(?:tiene[n]?|cuesta|cobran|vale|sale)\s+(?:el\s+|la\s+|los\s+|las\s+|un\s+|una\s+)?(?<entity>[\wñ\s]+?)(?:\?|$)/,
  // "precio hamburguesa" / "precio agua de horchata" (bare price query, starts with "precio")
  /^precio\s+(?:de\s+)?(?:el\s+|la\s+|los\s+|las\s+|un\s+|una\s+)?(?<entity>[\wñ\s]+?)(?:\?|$)/,
  /precio\s+de\s+(?:el\s+|la\s+|los\s+|un\s+|una\s+)?(?<entity>[\wñ\s]+?)(?:\?|$)/,
  // ─── Catalog / menu queries — "dame el catálogo de X", "el menú de Y" ──────
  // Must appear BEFORE the generic "me (pueden dar|das|traes) X" pattern so that
  // "me das el catálogo de pizzas" is intercepted here (skipping the blocklisted
  // word "catalogo") rather than below (where "catalogo" would kill the match).
  /(?:dame?|muestrame?|pasame?)\s+(?:el\s+|la\s+)?(?:catalogo|menu|lista)\s+de\s+(?:el\s+|la\s+|los\s+|las\s+)?(?<entity>[\wñ\s]+?)(?:\?|$|\s+por\s+favor)/,
  /me\s+(?:pueden\s+dar|das?|traes?)\s+(?:el\s+|la\s+)?(?:catalogo|menu|lista)\s+de\s+(?:el\s+|la\s+|los\s+|las\s+)?(?<entity>[\wñ\s]+?)(?:\?|$|\s+por\s+favor)/,
  /(?:el\s+|la\s+)?(?:catalogo|menu|lista)\s+de\s+(?:el\s+|la\s+|los\s+|las\s+)?(?<entity>[\wñ\s]+?)(?:\?|$)/,
  /me\s+(?:pueden\s+dar|das?|traes?)\s+(?:el\s+|la\s+|un\s+|una\s+)?(?<entity>[\wñ\s]+?)(?:\?|$)/,
  // "puedes decirme si tienen X" / "me puedes decir si tienen X"
  /(?:me\s+)?puedes?\s+(?:decirme\s+)?(?:si\s+)?(?:tienen?|hay)\s+(?<entity>[\wñ\s]+?)(?:\?|$)/,
  // Availability phrases
  /esta(?:s|n)?\s+disponible[s]?\s+(?:el\s+|la\s+|los\s+|las\s+|un\s+|una\s+)?(?<entity>[\wñ\s]+?)(?:\?|$)/,
  /hay\s+stock\s+de\s+(?:el\s+|la\s+|los\s+|las\s+|un\s+|una\s+)?(?<entity>[\wñ\s]+?)(?:\?|$)/,
  /tiene(?:s|n)?\s+disponibilidad\s+(?:de\s+)?(?:el\s+|la\s+|los\s+|las\s+)?(?<entity>[\wñ\s]+?)(?:\?|$)/,
  // "que tipo(s) de X tienen/tienes/tiene/hay/vende/venden" — entity inside "que tipo de … verb"
  // MUST appear before the generic "que X tienen" pattern below.
  /^que\s+tipos?\s+de\s+(?<entity>[\wñ]+(?:\s+[\wñ]+){0,3})\s+(?:tiene[sn]?|tienen|hay|vende[sn]?|venden|ofrece[n]?|maneja[n]?)\s*\??$/,
  /que\s+tipos?\s+de\s+(?<entity>[\wñ]+(?:\s+[\wñ]+){0,3})\s+(?:tiene[sn]?|tienen|hay|vende[sn]?|venden|ofrece[n]?|maneja[n]?)/,
  // "que [entity] tienen/tienes/hay?" — entity BETWEEN "que" and trailing verb.
  // Must run BEFORE the generic tiene[sn]? pattern which would otherwise grab
  // whatever follows "tienen" (e.g. "disponibles") as the entity.
  // Distinct from description patterns where verb follows IMMEDIATELY after "que".
  /^que\s+(?<entity>[\wñ]+(?:\s+[\wñ]+){0,4})\s+(?:tiene[sn]?|tienen|hay)\s*(?:[\wñ]+\s*)?\??$/,
  /tiene[sn]?\s+(?:el\s+|la\s+|los\s+|las\s+|un\s+|una\s+)?(?<entity>[\wñ\s]+?)(?:\?|$)/,
  /hay\s+(?:el\s+|la\s+|los\s+|las\s+|un\s+|una\s+)?(?<entity>[\wñ\s]+?)(?:\?|$)/,
  /existe[n]?\s+(?:el\s+|la\s+|los\s+|las\s+|un\s+|una\s+)?(?<entity>[\wñ\s]+?)(?:\?|$)/,
  /busco\s+(?:un\s+|una\s+|el\s+|la\s+)?(?<entity>[\wñ\s]+?)(?:\?|$)/,
  /quiero\s+(?:un\s+|una\s+|el\s+|la\s+)?(?<entity>[\wñ\s]+?)(?:\?|$)/,
  /me\s+interesa\s+(?:el\s+|la\s+|los\s+|las\s+)?(?<entity>[\wñ\s]+?)(?:\?|$)/,

  // "informacion sobre/de/acerca de X" — descriptions requested via preposition
  /info(?:rmacion)?\s+(?:(?:sobre|acerca\s+de|de)\s+)?(?:el\s+|la\s+|los\s+|las\s+)?(?<entity>[\wñ\s]+?)(?:\?|$)/,
  // "que es/son X" — definition queries that also target product/service names
  /^que\s+(?:es|son)\s+(?:el\s+|la\s+|los\s+|las\s+|un\s+|una\s+)?(?<entity>[\wñ\s]+?)(?:\?|$)/,
  // "sobre X" / "acerca de X" — direct topic follow-up (e.g. after a service list)
  /^(?:sobre|acerca\s+de)\s+(?:el\s+|la\s+|los\s+|las\s+)?(?<entity>[\wñ\s]+?)(?:\?|$)/,
  /vende[ns]?\s+(?:el\s+|la\s+|los\s+|las\s+|un\s+|una\s+)?(?<entity>[\wñ\s]+?)(?:\?|$)/,,
  /ofrece[ns]?\s+(?:el\s+|la\s+|los\s+|las\s+|un\s+|una\s+)?(?<entity>[\wñ\s]+?)(?:\?|$)/,
  /necesito\s+(?:un\s+|una\s+|el\s+|la\s+)?(?<entity>[\wñ\s]+?)(?:\?|$)/,
  // Reversed-order: entity before verb — "X tienes?" / "X hay?" / "X venden?"
  /(?<entity>[\wñ]+(?:\s+[\wñ]+){0,3})\s+(?:tienes?|tienen|hay|vende[sn]?|venden)\s*\?$/,
  // Description-intent phrases: "que contiene X", "que incluye X", "que trae X"
  // singular and plural forms, optional article el/la/los/las before entity
  /(?:que\s+)?contiene[n]?\s+(?:el\s+|la\s+|los\s+|las\s+|un\s+|una\s+|este\s+|esta\s+)?(?<entity>[\wñ\s]+?)(?:\?|$)/,
  /(?:que\s+)?incluye[n]?\s+(?:el\s+|la\s+|los\s+|las\s+|un\s+|una\s+|este\s+|esta\s+)?(?<entity>[\wñ\s]+?)(?:\?|$)/,
  /(?:que\s+)?trae[n]?\s+(?:el\s+|la\s+|los\s+|las\s+|un\s+|una\s+|este\s+|esta\s+)?(?<entity>[\wñ\s]+?)(?:\?|$)/,
  /(?:que\s+)?lleva[n]?\s+(?:el\s+|la\s+|los\s+|las\s+|un\s+|una\s+|este\s+|esta\s+)?(?<entity>[\wñ\s]+?)(?:\?|$)/,
  /de\s+que\s+esta[n]?\s+hech[oa]s?\s+(?:el\s+|la\s+|los\s+|las\s+)?(?<entity>[\wñ\s]+?)(?:\?|$)/,
  // "que tiene/tienen los/las X" — description of entity with article
  /que\s+tiene[n]?\s+(?:el\s+|la\s+|los\s+|las\s+)?(?<entity>[\wñ\s]+?)(?:\?|$)/,
  // "caracteristicas de X" / "especificaciones de X" / "descripcion de X"
  /(?:caracteristicas|especificaciones|descripcion)\s+(?:de[l]?\s+)?(?:el\s+|la\s+|los\s+|las\s+|un\s+|una\s+)?(?<entity>[\wñ\s]+?)(?:\?|$)/,
];

// ─── Entity candidate cleanup ────────────────────────────────────────────────

/**
 * Strips trailing noise words from an entity candidate.
 * These words appear at the end of extracted candidates but are not part
 * of the entity name (e.g. "cables disponibles" → "cables").
 *
 * @param {string} entity  Candidate string (normalized, stopwords stripped from start)
 * @returns {string}
 */
function cleanEntityCandidate(entity) {
  return entity
    .replace(/\s+disponibles?\s*$/, '')
    .replace(/\s+en\s+stock\s*$/, '')
    .replace(/\s+que\s+(?:tengas?|tienen|hay)\s*$/, '')
    .replace(/\s+para\s+(?:comprar|vender)\s*$/, '')
    // Strip trailing conjugated sell/offer verbs that are never part of the
    // product name but get attached by the NLP fallback (e.g. "pizza vende").
    .replace(/\s+vende[sn]?\s*$/, '')
    .replace(/\s+venden\s*$/, '')
    .replace(/\s+ofrece[n]?\s*$/, '')
    .replace(/\s+manejan?\s*$/, '')
    .trim();
}

// ─── Core extraction logic ────────────────────────────────────────────────────

/**
 * Extracts a raw entity candidate from the normalized message text.
 * Uses regex patterns first, then falls back to NLP noun phrases.
 * Applies singularization to the extracted candidate so that plurals
 * like "cables" still match product records named "cable".
 *
 * @param {string} normalizedText
 * @returns {string|null}
 */
function extractEntityCandidate(normalizedText) {
  // Step 1: regex patterns
  for (const pattern of PRODUCT_QUERY_PATTERNS) {
    const match = normalizedText.match(pattern);
    if (match?.groups?.entity) {
      const raw = match.groups.entity.trim();
      const stripped = stripLeadingStopwords(raw);
      const cleaned = cleanEntityCandidate(stripped);
      if (cleaned.length >= 2 && !isBlocklisted(cleaned)) {
        return cleaned;
      }
    }
  }

  // Step 2: NLP fallback — only when a trigger word is present
  if (!hasProductTrigger(normalizedText)) return null;

  const doc = nlp(normalizedText);
  const nouns = doc.nouns().out('array');

  if (nouns.length > 0) {
    const best = nouns
      .map((n) => {
        const stripped = stripLeadingStopwords(normalize(n));
        return cleanEntityCandidate(stripped);
      })
      .filter((n) => n.length >= 2 && !isBlocklisted(n))
      .sort((a, b) => b.length - a.length)[0];
    if (best) return best;
  }

  return null;
}

// ─── DB lookups ───────────────────────────────────────────────────────────────

/**
 * Searches products table. Returns matching rows.
 * @param {string} entity
 * @param {number} businessId
 * @returns {Promise<Array>}
 */
async function queryProducts(entity, businessId) {
  // Build variants: "cuadernos" → "cuaderno" (single-word singularization).
  // Also singularize each word in multi-word phrases so "tacos de pastor"
  // also matches a DB record named "taco de pastor".
  const singularPhrase = entity.split(' ').map((w) => toSingular(w)).join(' ');
  const variants = [...new Set([...wordVariants(entity), singularPhrase])];

  // Each variant searches: name OR description OR product_attributes (key/value).
  // Name matches are ranked first via ORDER BY so the most relevant result
  // appears at the top when multiple products are returned.
  let idx = 2;
  const conditions = [];
  const params = [businessId];

  // Accent-strip macro reused across all text columns.
  // Maps: á→a é→e í→i ó→o ú→u ü→u ñ→n  (7 source chars → 7 replacement chars)
  // NOTE: 'ñ' is mapped to 'n' (not space). The replacement string must have
  // the same length as the source so PostgreSQL translate maps each char 1-to-1.
  const TR = "translate(%s, '\u00e1\u00e9\u00ed\u00f3\u00fa\u00fc\u00f1', 'aeiooun')";
  const trCol = (col) => TR.replace('%s', `LOWER(${col})`);

  // Apply the SAME ñ→n substitution to every search param so both sides match.
  // (Other accents are already stripped by normalize() before reaching here.)
  const sqlParam = (s) => s.replace(/ñ/g, 'n');

  for (const v of variants) {
    const like = `%${sqlParam(v)}%`;
    conditions.push(
      `(${trCol('p.name')} ILIKE $${idx}` +
      ` OR ${trCol('p.description')} ILIKE $${idx + 1}` +
      ` OR EXISTS (SELECT 1 FROM product_attributes pa WHERE pa.product_id = p.id` +
      ` AND (${trCol('pa.value')} ILIKE $${idx + 2} OR ${trCol('pa.key')} ILIKE $${idx + 3})))`
    );
    params.push(like, like, like, like);
    idx += 4;
  }

  // Multi-word fallback: "cuaderno sin lineas" won't match "cuaderno de dibujo sin lineas"
  // as a substring, so we also require each word to appear ANYWHERE in the text fields.
  // This is added as an extra OR condition (AND across words, OR across fields per word).
  for (const v of variants) {
    const words = v.split(' ').filter((w) => w.length >= 2);
    if (words.length < 2) continue; // single-word already covered above
    const wordClauses = [];
    for (const w of words) {
      const like = `%${sqlParam(w)}%`;
      wordClauses.push(
        `(${trCol('p.name')} ILIKE $${idx}` +
        ` OR ${trCol('p.description')} ILIKE $${idx + 1}` +
        ` OR EXISTS (SELECT 1 FROM product_attributes pa2 WHERE pa2.product_id = p.id` +
        ` AND (${trCol('pa2.value')} ILIKE $${idx + 2} OR ${trCol('pa2.key')} ILIKE $${idx + 3})))`
      );
      params.push(like, like, like, like);
      idx += 4;
    }
    conditions.push(`(${wordClauses.join(' AND ')})`);
  }

  // Exact name match → rank 0; partial name match → rank 1; desc/attr match → rank 2
  const nameMatchConditions = variants.map((_, i) =>
    `${trCol('p.name')} ILIKE $${idx + i}`
  );
  params.push(...variants.map((v) => `%${sqlParam(v)}%`));
  const exactMatchParam = idx + variants.length;
  params.push(sqlParam(entity)); // exact match

  const result = await db.query(
    `SELECT
       p.id, p.name, p.description, p.price, p.is_available,
       pi.stock_quantity, c.name AS category
     FROM products p
     LEFT JOIN product_inventory pi ON p.id = pi.product_id
     LEFT JOIN categories c ON p.category_id = c.id
     WHERE p.business_id = $1
       AND (${conditions.join(' OR ')})
     ORDER BY
       CASE WHEN ${trCol('p.name')} = $${exactMatchParam} THEN 0
            WHEN (${nameMatchConditions.join(' OR ')}) THEN 1
            ELSE 2
       END,
       p.name ASC
     LIMIT 10`,
    params
  );
  return result.rows;
}

/**
 * Searches categories table. Returns matching category rows.
 * @param {string} entity
 * @param {number} businessId
 * @returns {Promise<Array>}
 */
async function queryCategories(entity, businessId) {
  const variants = wordVariants(entity);
  const conditions = variants.map((_, i) => `translate(LOWER(c.name), '\u00e1\u00e9\u00ed\u00f3\u00fa\u00fc', 'aeiouu') ILIKE $${i + 2}`);
  const params = [businessId, ...variants.map((v) => `%${v}%`)];

  const result = await db.query(
    `SELECT DISTINCT c.id, c.name
     FROM categories c
     JOIN products p ON p.category_id = c.id
     WHERE p.business_id = $1
       AND (${conditions.join(' OR ')})
     LIMIT 5`,
    params
  );
  return result.rows;
}

/**
 * Searches promotions table by keyword in title/description.
 * @param {string} entity
 * @param {number} businessId
 * @returns {Promise<Array>}
 */
async function queryPromotions(entity, businessId) {
  const result = await db.query(
    `SELECT id, title, description, discount_type, discount_value, start_date, end_date
     FROM promotions
     WHERE business_id = $1
       AND end_date >= CURRENT_DATE
       AND (title ILIKE $2 OR description ILIKE $2)
     ORDER BY end_date ASC
     LIMIT 5`,
    [businessId, `%${entity}%`]
  );
  return result.rows;
}

// ─── Entity type classification ───────────────────────────────────────────────

/**
 * @typedef {Object} DetectedEntity
 * @property {string|null} product   - Product name or null
 * @property {string|null} category  - Category name or null
 * @property {string|null} promotion - Promotion reference or null
 * @property {'product'|'category'|'promotion'|null} type - Primary entity type
 * @property {string|null} value     - The raw value of the primary entity
 */

/**
 * Detects entities of multiple types from a user message.
 *
 * Strategy:
 *   1. Extract candidate entity from the message text
 *   2. If the detected intent is a strong standalone (horarios, ubicacion) → skip entity detection
 *   3. Query DB in priority order: product → category → promotion
 *   4. Return the first match found with its type
 *
 * @param {string} message          Raw user message
 * @param {number} businessId       Active business
 * @param {{ intent: string|null, score: number }} intentResult  From intentDetector
 * @returns {Promise<DetectedEntity>}
 */
async function detectEntities(message, businessId, intentResult = { intent: null, score: 0 }) {
  const empty = { product: null, category: null, promotion: null, type: null, value: null };

  const normalizedText = normalize(message);

  // ── Compound query ("entity de attribute") — runs before attribute check ─────
  // Handles "tornillos de madera", "carne de res", "cables de cobre", etc.
  // Requires BOTH entity and attribute to be meaningful; blocked for meta-words.
  //
  // ── Category + attribute query ("algún/alguna CATEGORY con|de ATTRIBUTE") ────
  // Fires before the compound/skipCompound guard so that
  // "tiene alguna bebida con chocolate" is routed to category+attribute search
  // instead of falling through to product-name extraction.
  const catAttrExtracted = extractCategoryAttributeQuery(normalizedText);
  if (catAttrExtracted) {
    return {
      ...empty,
      type: 'attribute',
      value: `${catAttrExtracted.categoryWord} con ${catAttrExtracted.attribute}`,
      categoryTerm: catAttrExtracted.categoryWord,
      attributeTerm: catAttrExtracted.attribute,
      attributeType: 'feature',
    };
  }

  // Guard: skip compound detection when the message starts with an
  // existence-question verb (tiene / tienes / tienen).  In those messages the
  // full phrase after the verb is the PRODUCT NAME, not a compound type+attr
  // query.  e.g. "tienen agua de limon" → entity="agua de limon" (product),
  // NOT compound entity="agua" + attribute="limon".
  // Note: "tiene algo con carne de res" is NOT guarded (extractAttribute fires
  // first) and its embedded compound is promoted via the inner-compound check.
  const skipCompound = /^tiene[sn]?\s/.test(normalizedText);
  const compoundExtracted = skipCompound ? null : extractCompoundQuery(normalizedText);
  if (compoundExtracted) {
    const attrType = isMaterial(compoundExtracted.attribute) ? 'material' : 'feature';
    return {
      ...empty,
      type: 'attribute',
      value: compoundExtracted.fullPhrase,
      entityTerm: compoundExtracted.entity,
      attributeTerm: compoundExtracted.attribute,
      attributeType: attrType,
    };
  }

  // ── Attribute query (highest priority for "algo con X", "para X", etc.) ─────
  // Must run before candidate extraction so "algo con queso" isn't mis-routed
  // as a generic product query for the word "queso".
  const attrExtracted = extractAttribute(normalizedText);
  if (attrExtracted) {
    // If the extracted attribute value itself contains a "de" compound
    // (e.g. "carne de res" extracted from "tiene algo con carne de res"),
    // promote it to the compound query path for strict entity+attribute search.
    if (attrExtracted.value.includes(' de ')) {
      const innerCompound = extractCompoundQuery(attrExtracted.value);
      if (innerCompound) {
        const attrType = isMaterial(innerCompound.attribute) ? 'material' : 'feature';
        return {
          ...empty,
          type: 'attribute',
          value: innerCompound.fullPhrase,
          entityTerm: innerCompound.entity,
          attributeTerm: innerCompound.attribute,
          attributeType: attrType,
        };
      }
    }
    return {
      ...empty,
      type: 'attribute',
      value: attrExtracted.value,
      attributeType: attrExtracted.type,
    };
  }

  // ── "que tipo(s) de X tienen" — check category first, then product ──────────
  // This pattern signals the user wants a type/kind of product, so a category
  // match is preferred over an individual-product match.
  const TIPO_DE_RE = /que\s+tipos?\s+de\s+(?<entity>[\w]+(?:\s+[\w]+){0,3})\s+(?:tiene[sn]?|tienen|hay)/;
  const tipoMatch = normalizedText.match(TIPO_DE_RE);
  if (tipoMatch?.groups?.entity) {
    const tipoCand = cleanEntityCandidate(stripLeadingStopwords(tipoMatch.groups.entity.trim()));
    if (tipoCand && tipoCand.length >= 2 && !isBlocklisted(tipoCand)) {
      try {
        const categoryRows = await queryCategories(tipoCand, businessId);
        if (categoryRows.length > 0) {
          return { ...empty, category: tipoCand, type: 'category', value: tipoCand };
        }
      } catch (err) {
        console.error('[EntityDetector] Error querying categories for tipo-de:', err.message);
      }
      try {
        const productRows = await queryProducts(tipoCand, businessId);
        if (productRows.length > 0) {
          return { ...empty, product: tipoCand, type: 'product', value: tipoCand, _rows: productRows };
        }
      } catch (err) {
        console.error('[EntityDetector] Error querying products for tipo-de:', err.message);
      }
      return { ...empty, product: tipoCand, type: 'product', value: tipoCand, _rows: [] };
    }
  }

  // ── "que X tienen/tienes/tiene/hay" — entity precedes verb (catalog queries) ─
  // "que bebidas tiene?" / "que pizzas hay?" signal a category browse, not a
  // specific product lookup. Check categories FIRST so "bebidas" doesn't match
  // a product whose description happens to contain the word.
  // Must run after TIPO_DE_RE ("que tipo de X") to avoid double-processing.
  const QUE_ENTITY_TIENEN_RE = /^que\s+(?<entity>[\wñ]+(?:\s+[\wñ]+){0,4})\s+(?:tiene[sn]?|tienen|hay)\s*\??$/;
  const queMatch = normalizedText.match(QUE_ENTITY_TIENEN_RE);
  if (queMatch?.groups?.entity) {
    const queCand = cleanEntityCandidate(stripLeadingStopwords(queMatch.groups.entity.trim()));
    if (queCand && queCand.length >= 2 && !isBlocklisted(queCand)) {
      try {
        const categoryRows = await queryCategories(queCand, businessId);
        if (categoryRows.length > 0) {
          return { ...empty, category: queCand, type: 'category', value: queCand };
        }
      } catch (err) {
        console.error('[EntityDetector] Error querying categories for que-entity-tienen:', err.message);
      }
      // Not a category → fall through to the normal candidate extraction below
    }
  }

  // ── Short bare noun without trigger word — single-word category name typed directly ──
  // Covers: "postres?", "bebidas?" after browsing a category; "pizzas?" as a topic switch.
  // hasProductTrigger() returns false for these so extractEntityCandidate skips them.
  // extractFollowUpEntity (in decide()) requires ≥ 2 tokens for bare-noun shape, so
  // single-word nouns are its blind spot → check category then product here.
  // NOTE: length === 1 is intentional — 2+ token bare nouns ("pizza mexicana", "y de X")
  // are handled downstream by extractFollowUpEntity, which needs context to enrich them.
  const BARE_NOUN_NOPE = new Set([
    'si', 'no', 'ok', 'ya', 'bien', 'mal', 'dale', 'vale',
    'hola', 'gracias', 'adios', 'claro', 'perfecto', 'bueno', 'mande',
  ]);
  const bareTokens = normalizedText.split(/\s+/);
  if (bareTokens.length === 1 && !hasProductTrigger(normalizedText)) {
    const bareCand = cleanEntityCandidate(bareTokens[0]);
    if (bareCand && bareCand.length >= 2 && !isBlocklisted(bareCand) && !BARE_NOUN_NOPE.has(bareCand)) {
      try {
        const categoryRows = await queryCategories(bareCand, businessId);
        if (categoryRows.length > 0) {
          return { ...empty, category: bareCand, type: 'category', value: bareCand };
        }
      } catch (err) {
        console.error('[EntityDetector] Error querying categories for bare noun:', err.message);
      }
      try {
        const productRows = await queryProducts(bareCand, businessId);
        if (productRows.length > 0) {
          return { ...empty, product: bareCand, type: 'product', value: bareCand, _rows: productRows };
        }
      } catch (err) {
        console.error('[EntityDetector] Error querying products for bare noun:', err.message);
      }
    }
  }

  const candidate = extractEntityCandidate(normalizedText);

  if (!candidate) return empty;

  // Try product first (most common case)
  try {
    const productRows = await queryProducts(candidate, businessId);
    if (productRows.length > 0) {
      return { ...empty, product: candidate, type: 'product', value: candidate, _rows: productRows };
    }
  } catch (err) {
    console.error('[EntityDetector] Error querying products:', err.message);
  }

  // Try category
  try {
    const categoryRows = await queryCategories(candidate, businessId);
    if (categoryRows.length > 0) {
      return { ...empty, category: candidate, type: 'category', value: candidate, _categoryRows: categoryRows };
    }
  } catch (err) {
    console.error('[EntityDetector] Error querying categories:', err.message);
  }

  // Try promotion
  try {
    const promoRows = await queryPromotions(candidate, businessId);
    if (promoRows.length > 0) {
      return { ...empty, promotion: candidate, type: 'promotion', value: candidate, _promoRows: promoRows };
    }
  } catch (err) {
    console.error('[EntityDetector] Error querying promotions:', err.message);
  }

  // Candidate found in text but no DB match — still return candidate as product attempt
  return { ...empty, product: candidate, type: 'product', value: candidate, _rows: [] };
}

// ─── Response formatters ──────────────────────────────────────────────────────

/**
 * Formats product query results into readable text.
 * @param {string} entity
 * @param {Array} products
 * @returns {string}
 */
/** Max products to name in a conversational list. */
const VOICE_LIST_LIMIT = 3;

/** "A, B y C" natural enumeration (voice-friendly). */
function _enumList(items) {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
}

function formatProductResponse(entity, products) {
  if (!products || products.length === 0) {
    return `Lo siento, no encontré ningún producto relacionado con "${entity}". ¿Quieres ver el catálogo completo?`;
  }

  if (products.length === 1) {
    const p = products[0];
    const available = p.is_available !== false;
    if (available) {
      return `Sí 😊, tenemos ${p.name} a $${Number(p.price).toFixed(2)}. ¿Te interesa o quieres saber algo más?`;
    }
    return `Tenemos ${p.name} registrado, pero no está disponible en este momento. ¿Te gustaría ver otras opciones?`;
  }

  const available = products.filter((p) => p.is_available !== false);
  const pool      = available.length > 0 ? available : products;
  const sample    = pool.slice(0, VOICE_LIST_LIMIT);
  const hasMore   = pool.length > VOICE_LIST_LIMIT;
  const names     = sample.map((p) => `${p.name} a $${Number(p.price).toFixed(2)}`);
  const listed    = _enumList(names);

  if (hasMore) {
    return `Sí 😊, tenemos varias opciones de ${entity}, como ${listed}, entre otras. ¿Buscas algo en particular?`;
  }
  return `Sí 😊, tenemos ${pool.length} opciones de ${entity}: ${listed}. ¿Cuál te interesa?`;
}

/**
 * Formats category query results — lists products in that category.
 * @param {string} categoryName
 * @param {Array} rows  Product rows from the category
 * @returns {string}
 */
function formatCategoryResponse(categoryName, rows) {
  if (!rows || rows.length === 0) {
    return `No encontré productos en la categoría "${categoryName}".`;
  }
  const sample  = rows.slice(0, VOICE_LIST_LIMIT);
  const hasMore = rows.length > VOICE_LIST_LIMIT;
  const names   = sample.map((p) =>
    p.is_available !== false
      ? `${p.name} a $${Number(p.price).toFixed(2)}`
      : `${p.name} (no disponible)`
  );
  const listed = _enumList(names);

  if (hasMore) {
    return `En ${categoryName} tenemos ${rows.length} productos, como ${listed}, entre otros. ¿Quieres saber más de alguno?`;
  }
  return `En ${categoryName} tenemos ${listed}. ¿Quieres más información de alguno?`;
}

module.exports = {
  detectEntities,
  extractEntityCandidate,
  queryProducts,
  queryCategories,
  queryPromotions,
  formatProductResponse,
  formatCategoryResponse,
  // Exported for testing
  isBlocklisted,
  stripLeadingStopwords,
  hasProductTrigger,
  PRODUCT_QUERY_PATTERNS,
};

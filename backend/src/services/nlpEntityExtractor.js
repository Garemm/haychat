/**
 * src/services/nlpEntityExtractor.js
 *
 * NLP ENTITY EXTRACTOR — Specific product-query detection with entity
 * extraction and dynamic DB lookup.
 *
 * ─── PIPELINE POSITION ────────────────────────────────────────────────────────
 *
 *   Message
 *     │
 *     ▼
 *   [1] nlpEntityExtractor   ← THIS FILE (runs first)
 *       Handles: "tienen hamburguesa doble?", "hay pozole?",
 *                "cuanto cuesta la pizza?", "busco agua mineral"
 *       Why first: resolves parameterized queries with a SPECIFIC product
 *                  name, which is more precise than a broad topic intent.
 *     │ null (no entity found)
 *     ▼
 *   [2] intentService (intents.js)
 *       Handles: "a que hora abren?", "que productos tienen?", "hay ofertas?"
 *       Why second: catches broad topic queries without a named entity.
 *     │ null (no keyword match)
 *     ▼
 *   [3] keywordResponses / mockAI  (last fallback)
 *
 * ─── DESIGN DECISIONS ─────────────────────────────────────────────────────────
 *
 *   • Regex patterns are PRIMARY: they handle well-known Spanish phrase
 *     structures reliably and with no model overhead.
 *   • Compromise (NLP) is FALLBACK: extracts the longest noun phrase from
 *     messages that don't match a pattern but still contain a product name.
 *   • DB query uses ILIKE with wildcards to support partial/case-insensitive
 *     matches (e.g. "hamburguesa" matches "Hamburguesa Doble").
 *   • Returns null when no entity is detected — callers treat null as
 *     "pass to next handler" without any further processing here.
 *
 * ─── ADDING NEW ENTITY TYPES ──────────────────────────────────────────────────
 *
 *   1. Add more patterns to PRODUCT_QUERY_PATTERNS, or
 *   2. Create a parallel extractor (e.g. nlpOrderExtractor.js) following
 *      the same extractAndRespond(message) → string|null contract.
 */

import nlp from 'compromise';
import db from '../config/database.js';

// Default business — change per conversation once multi-tenant is implemented
const DEFAULT_BUSINESS_ID = 1;

// ─── Text normalization ───────────────────────────────────────────────────────

/**
 * Lowercases text and strips Unicode accent marks so comparisons are
 * accent-insensitive ("qué" === "que", "está" === "esta").
 * Exported so other services can reuse the same normalization step.
 * @param {string} text
 * @returns {string}
 */
function normalize(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[¿¡]/g, '')   // strip inverted punctuation
    .trim();
}

// ─── Stopwords to strip from extracted entities ───────────────────────────────

/**
 * Words that often appear right after a trigger verb but are NOT part of
 * the product name. Stripped before the DB query.
 */
const ENTITY_STOPWORDS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas',
  'de', 'del', 'al', 'en', 'por', 'para', 'con', 'sin',
  'disponible', 'disponibles', 'ese', 'esa', 'esos', 'esas',
  'ese', 'algun', 'alguna', 'algún', 'también', 'tambien',
]);

/**
 * Generic category/meta words that users say when browsing the whole catalog,
 * NOT when asking about a specific product. If the final entity resolves to
 * one of these, return null so intents.js handles the broad query instead.
 */
const ENTITY_BLOCKLIST = new Set([
  'producto', 'productos', 'articulo', 'articulos', 'artículo', 'artículos',
  'item', 'items', 'cosa', 'cosas', 'mercancia', 'mercancía',
  'catalogo', 'catálogo', 'lista', 'menu', 'menú',
  'servicio', 'servicios', 'oferta', 'ofertas',
  'algo', 'todo', 'nada', 'mucho', 'poco',
  // Palabras interrogativas — nunca son nombres de producto.
  // Previenen que el fallback NLP extraiga frases como "cuanto cuesta" cuando
  // no hay un producto específico (ej: "¿y cuánto cuesta?" sin contexto).
  // Los patrones regex SÍ manejan "cuánto cuesta la hamburguesa" correctamente
  // porque captoran el nombre del producto DESPUÉS de la palabra interrogativa.
  'cuanto', 'cuanta', 'cuantos', 'cuantas',
]);

/**
 * Returns true if the entity string IS a blocklisted word or CONTAINS one.
 * Prevents "cuantos productos" from slipping through as a product entity
 * ("productos" alone is blocklisted, so a phrase containing it should be too).
 * @param {string} entity
 * @returns {boolean}
 */
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

// ─── Trigger words that signal a product-query context ───────────────────────

/**
 * The Compromise NLP fallback only runs when AT LEAST ONE of these words
 * is present in the normalized message. Without a trigger word the message
 * is unlikely to be a specific product query, so we return null and let
 * the next handler (intentService) process it instead.
 */
const PRODUCT_TRIGGER_WORDS = new Set([
  'tienen', 'tienes', 'hay', 'busco', 'quiero', 'existe', 'existen',
  'precio', 'cuanto', 'cuánto', 'vale', 'cuesta', 'cobran',
  'disponible', 'disponibles', 'stock', 'inventario',
  'informacion', 'información', 'info', 'detalle', 'detalles',
  'conseguir', 'comprar', 'pedir', 'ordenar', 'solicitar',
]);

/**
 * Returns true if the normalized text contains at least one product-query
 * trigger word. Used to guard the Compromise NLP fallback.
 * @param {string} normalizedText
 * @returns {boolean}
 */
function hasProductTrigger(normalizedText) {
  const words = normalizedText.split(/\s+/);
  return words.some((w) => PRODUCT_TRIGGER_WORDS.has(w));
}

/**
 * Spanish phrase patterns that signal a product-specific query.
 *
 * Each pattern uses a named capture group `entity` to isolate the product
 * term. Patterns are tested in order — put the most specific first.
 *
 * The trailing `[\w\s]+?` is non-greedy to stop before punctuation/end.
 * `[\w\sáéíóúüñ]+?` is used after normalization so accents are already stripped.
 */
const PRODUCT_QUERY_PATTERNS = [
  // "tienen disponible la hamburguesa?"
  /tienen\s+disponible\s+(?<entity>[\w\s]+?)(?:\?|$)/,
  // "hay disponibilidad de pozole"
  /hay\s+disponibilidad\s+de\s+(?<entity>[\w\s]+?)(?:\?|$)/,
  // "cuanto cuesta la pizza margherita"
  /cu[ae]nto\s+(?:cuesta|vale|sale|cobran\s+por)\s+(?:el\s+|la\s+|los\s+|las\s+|un\s+|una\s+)?(?<entity>[\w\s]+?)(?:\?|$)/,
  // "precio de la hamburguesa doble"
  /precio\s+de\s+(?:el\s+|la\s+|los\s+|un\s+|una\s+)?(?<entity>[\w\s]+?)(?:\?|$)/,
  // "me pueden dar el mole"
  /me\s+(?:pueden\s+dar|das?|traes?)\s+(?:el\s+|la\s+|un\s+|una\s+)?(?<entity>[\w\s]+?)(?:\?|$)/,
  // "tienen hamburguesa?" / "tienen la hamburguesa doble?"
  /tienen\s+(?:el\s+|la\s+|los\s+|las\s+|un\s+|una\s+)?(?<entity>[\w\s]+?)(?:\?|$)/,
  // "tienes pizza?"
  /tienes\s+(?:el\s+|la\s+|los\s+|las\s+|un\s+|una\s+)?(?<entity>[\w\s]+?)(?:\?|$)/,
  // "hay pozole?"
  /hay\s+(?:el\s+|la\s+|los\s+|las\s+|un\s+|una\s+)?(?<entity>[\w\s]+?)(?:\?|$)/,
  // "existe el pozole rojo?"
  /existe[n]?\s+(?:el\s+|la\s+|los\s+|las\s+|un\s+|una\s+)?(?<entity>[\w\s]+?)(?:\?|$)/,
  // "busco agua mineral"
  /busco\s+(?:un\s+|una\s+|el\s+|la\s+)?(?<entity>[\w\s]+?)(?:\?|$)/,
  // "quiero una hamburguesa"
  /quiero\s+(?:un\s+|una\s+|el\s+|la\s+)?(?<entity>[\w\s]+?)(?:\?|$)/,
  // "me interesa el pozole"
  /me\s+interesa\s+(?:el\s+|la\s+|los\s+|las\s+)?(?<entity>[\w\s]+?)(?:\?|$)/,
  // "informacion de la pizza"
  /info(?:rmacion)?\s+(?:de\s+)?(?:el\s+|la\s+|los\s+)?(?<entity>[\w\s]+?)(?:\?|$)/,
];

/**
 * Tries to extract a product entity from the normalized user message.
 *
 * Strategy:
 *   1. Test each regex pattern; return the first captured `entity` group.
 *   2. If no pattern matches, fall back to Compromise noun-phrase extraction
 *      and return the longest found noun phrase (most likely the product).
 *
 * @param {string} normalizedText  Already lowercased + accent-stripped text.
 * @returns {string|null}          Cleaned entity string, or null if not found.
 */
function extractProductEntity(normalizedText) {
  // ── Step 1: Regex patterns ──────────────────────────────────────────────
  for (const pattern of PRODUCT_QUERY_PATTERNS) {
    const match = normalizedText.match(pattern);
    if (match?.groups?.entity) {
      const raw = match.groups.entity.trim();
      const cleaned = stripLeadingStopwords(raw);
      if (cleaned.length >= 2 && !isBlocklisted(cleaned)) return cleaned;
    }
  }

  // ── Step 2: Compromise noun-phrase fallback ─────────────────────────────
  // Only attempt NLP extraction when the message contains a known product-
  // query trigger word.  Without this guard, Compromise would extract nouns
  // from completely unrelated messages ("cuando abren", "hola que tal")
  // and produce false-positive product lookups.
  if (!hasProductTrigger(normalizedText)) return null;

  const doc = nlp(normalizedText);
  const nouns = doc.nouns().out('array');

  if (nouns.length > 0) {
    // Pick the longest noun phrase — most likely to be the product name
    const best = nouns
      .map((n) => stripLeadingStopwords(n))
      .filter((n) => n.length >= 2 && !isBlocklisted(n))
      .sort((a, b) => b.length - a.length)[0];
    if (best) return best;
  }

  return null;
}

// ─── Database query ───────────────────────────────────────────────────────────

/**
 * Searches the products table for rows whose name partially matches the
 * extracted entity. Uses ILIKE (case-insensitive LIKE) with % wildcards.
 *
 * Returns at most 5 results to keep responses concise.
 * Includes stock info via LEFT JOIN so availability is accurate.
 *
 * @param {string} entity      The product term to search for.
 * @param {number} businessId  Scopes the query to a single business.
 * @returns {Promise<Array>}
 */
async function queryProductByEntity(entity, businessId) {
  const result = await db.query(
    `SELECT
       p.id,
       p.name,
       p.description,
       p.price,
       p.is_available,
       pi.stock_quantity
     FROM products p
     LEFT JOIN product_inventory pi ON p.id = pi.product_id
     WHERE p.business_id = $1
       AND translate(LOWER(p.name), '\u00e1\u00e9\u00ed\u00f3\u00fa\u00fc', 'aeiouu') ILIKE $2
     ORDER BY
       -- Exact (normalized) match first, then partial
       CASE WHEN translate(LOWER(p.name), '\u00e1\u00e9\u00ed\u00f3\u00fa\u00fc', 'aeiouu') = $3 THEN 0 ELSE 1 END,
       p.name ASC
     LIMIT 5`,
    [businessId, `%${entity}%`, entity]
  );
  return result.rows;
}

// ─── Response formatter ───────────────────────────────────────────────────────

/**
 * Converts matched product rows into a human-readable Spanish string.
 *
 * Handles three cases:
 *   • No results    → polite "not found" message
 *   • 1 result      → shows full detail (description, price, availability)
 *   • 2-5 results   → compact list so the response isn't overwhelming
 *
 * @param {string} entity    The search term (for display).
 * @param {Array}  products  Rows returned by queryProductByEntity.
 * @returns {string}
 */
function formatProductResponse(entity, products) {
  if (products.length === 0) {
    return `Lo siento, no encontré ningún producto relacionado con "*${entity}*". ¿Quieres ver el catálogo completo?`;
  }

  if (products.length === 1) {
    const p = products[0];
    const status = p.is_available ? '✅ Disponible' : '❌ No disponible';
    const stock  = p.stock_quantity != null ? ` | Stock: ${p.stock_quantity} uds.` : '';
    const desc   = p.description ? `\n  ${p.description}` : '';
    return (
      `🔍 *${p.name}*\n` +
      `  Precio: $${Number(p.price).toFixed(2)}\n` +
      `  Estado: ${status}${stock}` +
      desc
    );
  }

  // Multiple results — compact list
  const lines = products.map((p) => {
    const status = p.is_available ? '✅' : '❌';
    return `  • ${status} *${p.name}* — $${Number(p.price).toFixed(2)}`;
  });
  return (
    `🔍 Sí, encontré ${products.length} productos relacionados con "*${entity}*":\n` +
    lines.join('\n')
  );
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Orchestrates the full NLP → DB → format pipeline.
 *
 * Returns a formatted string if a product entity was found in the message,
 * or null if the message does not appear to be a specific product query.
 * Callers should treat null as "pass this message to the next handler".
 *
 * @param {string} message               Raw user message.
 * @param {number} [businessId]          Defaults to DEFAULT_BUSINESS_ID.
 * @returns {Promise<string|null>}
 */
async function extractAndRespond(message, businessId = DEFAULT_BUSINESS_ID) {
  // Step 1 — Normalize (lowercase + strip accents)
  const normalized = normalize(message);

  // Step 2 — Extract entity from message
  const entity = extractProductEntity(normalized);
  if (!entity) {
    // No product entity found; let the next handler (intentService) take over
    return null;
  }

  console.log(`[NLP] Entidad detectada: "${entity}" | Mensaje original: "${message}"`);

  // Step 3 — Query DB with partial match
  const products = await queryProductByEntity(entity, businessId);
  console.log(
    `[NLP] Productos encontrados (${products.length}):`,
    products.map((p) => p.name)
  );

  // Step 4 — Format and return (even "no results" is a valid final response)
  return formatProductResponse(entity, products);
}

export {
  extractAndRespond,
  // Exported for reuse: context-aware pipeline in chatSocket.js
  normalize,
  extractProductEntity,
  queryProductByEntity,
  formatProductResponse,
};

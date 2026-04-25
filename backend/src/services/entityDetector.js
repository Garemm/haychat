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

import nlp from 'compromise';
import db from '../config/database.js';
import { normalize, toSingular, wordVariants } from './normalize.js';
import { extractAttribute, extractCompoundQuery, extractCategoryAttributeQuery, isMaterial } from './attributeExtractor.js';

// ─── Stopwords ────────────────────────────────────────────────────────────────

/**
 * Single article/pronoun words that should NEVER be returned as a standalone
 * entity candidate. They can appear inside multi-word entity names (e.g. "tacos
 * de la casa") but alone they are meaningless and cause ILIKE '%una%' queries
 * that match every product description containing the Spanish article "una".
 *
 * Also includes standalone demonstrative / object pronouns that appear in
 * purchase-pronoun phrases ("quiero uno", "quiero ese", "lo quiero") where the
 * real product lives in context, not in the current message.
 */
const BARE_ARTICLES = new Set([
  // Definite / indefinite articles
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'uno',
  // Demonstrative pronouns — standalone never a product name
  'ese', 'esa', 'esos', 'esas', 'eso', 'esto', 'esta', 'estos', 'estas',
  // Object pronouns
  'lo',
]);

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
 *
 * NOTE: words in this set block only when they ARE the complete entity value.
 * They do NOT block multi-word phrases that contain them as a sub-token
 * (e.g. "menu especial empresarial" is a valid service name even though
 * standalone "menu" is blocked). Per-token blocking is handled separately
 * by ENTITY_TOKEN_BLOCKLIST below.
 */
const ENTITY_BLOCKLIST = new Set([
  'producto', 'productos', 'articulo', 'articulos',
  'item', 'items', 'cosa', 'cosas', 'mercancia',
  'catalogo', 'lista', 'menu',
  'servicio', 'servicios', 'oferta', 'ofertas',
  'algo', 'todo', 'nada', 'mucho', 'poco',
  'promocion', 'promociones', 'descuento', 'descuentos',
  'horario', 'horarios',
  'precios',
  'ubicacion', 'ubicaciones',
  'tiene', 'tienen', 'tienes', 'tener',
  'hay', 'haber',
  'cuanto', 'cuanta', 'cuantos', 'cuantas',
  'cuando', 'donde', 'como', 'cual', 'cuales', 'quien',
  'que', 'precio', 'costo', 'tarifa',
  'muestrame', 'dame', 'pasame', 'mandame', 'enviame',
  'sobre', 'acerca', 'si',
  'y',
]);

/**
 * Words that poison a candidate even when they appear as a single TOKEN
 * within a multi-word phrase. These are grammar glue, intent-domain keywords,
 * verbs, and question words that can never be part of a valid product or
 * service name.
 *
 * Words that CAN appear as a prefix in legitimate names (e.g. "menu especial
 * empresarial", "servicio de renta", "catalogo de herramientas") must NOT be
 * included here — they stay in ENTITY_BLOCKLIST as standalone-only guards.
 */
const ENTITY_TOKEN_BLOCKLIST = new Set([
  // Generic commodity nouns — always meta-references, never actual item names
  'producto', 'productos', 'articulo', 'articulos',
  'item', 'items', 'cosa', 'cosas', 'mercancia',
  'algo', 'todo', 'nada', 'mucho', 'poco',
  // Conjunction indicating two items were captured together ("hamburguesa y soda")
  'y',
  // Intent-domain / meta words
  'precio', 'precios', 'tarifa', 'costo',
  'horario', 'horarios',
  'ubicacion', 'ubicaciones',
  'descuento', 'descuentos',
  'promocion', 'promociones',
  // Question words
  'cuanto', 'cuanta', 'cuantos', 'cuantas',
  'cuando', 'donde', 'como', 'cual', 'cuales', 'quien',
  'que',
  // Verb forms
  'tiene', 'tienen', 'tienes', 'tener',
  'hay', 'haber',
  // Command verbs
  'muestrame', 'dame', 'pasame', 'mandame', 'enviame',
  // Particles
  'sobre', 'acerca', 'si',
]);

function isBlocklisted(entity) {
  if (ENTITY_BLOCKLIST.has(entity)) return true;
  return entity.split(/\s+/).some((w) => ENTITY_TOKEN_BLOCKLIST.has(w));
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
  // "cuenta con X" / "cuentan con X" — existence query equivalent to tiene/tienen
  'cuenta', 'cuentan',
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
  // "en cuanto tiene/tienes/tienen [las] tortas de carnitas" / "a cuanto tiene X"
  // Mexican price query — placed before generic tiene[sn]? so it takes priority when "en/a cuanto" is present.
  /\b(?:en|a)\s+cuanto\s+tiene[sn]?\s+(?:el\s+|la\s+|los\s+|las\s+|un\s+|una\s+)?(?<entity>[\wñ\s]+?)(?:\?|$)/,
  // "que precio tiene la hamburguesa" / "cual es el precio de la pizza" / "cual es el precio del arroz"
  // The second form handles "del" (contracted de+el) directly after "precio".
  /(?:que\s+|cual\s+es\s+(?:el\s+)?)?precio\s+(?:tiene[n]?|cuesta|cobran|vale|sale)\s+(?:el\s+|la\s+|los\s+|las\s+|un\s+|una\s+)?(?<entity>[\wñ\s]+?)(?:\?|$)/,
  /(?:cual\s+es\s+(?:el\s+)?)?precio\s+(?:del?\s+(?:el\s+|la\s+|los\s+|las\s+)?|de\s+(?:la\s+|los\s+|las\s+|un\s+|una\s+))(?<entity>[\wñ\s]+?)(?:\?|$)/,
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
  // "recomiéndame una hamburguesa picante" / "sugíreme unos tacos al pastor"
  // Extracts the product noun phrase that follows a recommendation/suggestion verb.
  // Placed before generic patterns so the specific verb takes priority.
  /\b(?:recomiend[ao](?:me|nos)?|sugier[eo](?:me|nos)?)\s+(?:un[ao]s?\s+)?(?<entity>[\wñ]+(?:\s+[\wñ]+){0,3}?)(?:\s*\?|\s*$)/,
  // "que tipo(s) de X tienen/tienes/tiene/hay/vende/venden" — entity inside "que tipo de … verb"
  // MUST appear before the generic "que X tienen" pattern below.
  /^que\s+tipos?\s+de\s+(?<entity>[\wñ]+(?:\s+[\wñ]+){0,3})\s+(?:tiene[sn]?|tienen|hay|vende[sn]?|venden|ofrece[n]?|maneja[n]?)\s*\??$/,
  /que\s+tipos?\s+de\s+(?<entity>[\wñ]+(?:\s+[\wñ]+){0,3})\s+(?:tiene[sn]?|tienen|hay|vende[sn]?|venden|ofrece[n]?|maneja[n]?)/,
  // Fronted-PP interrogative: "de X que tienes/tienen/hay?" — PP precedes the verb.
  // e.g. "de postres que tienes" → entity=postres
  //      "de hamburguesas que tienen" → entity=hamburguesas
  // Must run BEFORE the generic tiene[sn]? pattern.
  /^de\s+(?<entity>[\wñ]+(?:\s+[\wñ]+){0,3})\s+que\s+(?:tienes?|tienen|hay|vende[sn]?|ofrecen?)\s*\??$/,
  // "que [entity] tienen/tienes/hay/vende/venden/ofrece/maneja?" — entity BETWEEN "que" and trailing verb.
  // Must run BEFORE the generic tiene[sn]? pattern which would otherwise grab
  // whatever follows "tienen" (e.g. "disponibles") as the entity.
  // Distinct from description patterns where verb follows IMMEDIATELY after "que".
  /^que\s+(?<entity>[\wñ]+(?:\s+[\wñ]+){0,4})\s+(?:tiene[sn]?|tienen|hay|vende[sn]?|venden|ofrece[n]?|maneja[n]?)\s*(?:[\wñ]+\s*)?\??$/,
  // Bare "que <noun>" — verbless clause from a multi-intent split where the user
  // omitted the verb (e.g. right side of "vende y tambien que refrescos" → "que refrescos").
  // Matches ONLY when the ENTIRE segment is "que <1-4 word noun phrase>" with no verb.
  // Negative lookahead prevents matching when the noun IS a known verb/query word
  // (e.g. "que venden" must not extract "venden" as an entity here).
  // Must appear AFTER all "que X verb" patterns; this is the final fallback.
  /^que\s+(?!(?:vende[nsn]?|tienes?|tienen|hay|ofrece[n]?|maneja[n]?|contiene[n]?|incluye[n]?|es\b|son\b|tipo[s]?\b|precio[s]?\b|horario[s]?\b|servicio[s]?\b|promo(?:cion(?:es)?)?\b)(?:\s|$))(?<entity>[\wñ]+)\s*\??$/,
  /tiene[sn]?\s+(?:el\s+|la\s+|los\s+|las\s+|un\s+|una\s+)?(?<entity>[\wñ\s]+?)(?:\?|$)/,
  // "cuenta con pizza hawaiana" / "cuentan con la michelada" — equivalent to tiene/tienen
  /cuentan?\s+con\s+(?:el\s+|la\s+|los\s+|las\s+|un\s+|una\s+)?(?<entity>[\wñ\s]+?)(?:\?|$)/,
  /hay\s+(?:el\s+|la\s+|los\s+|las\s+|un\s+|una\s+)?(?<entity>[\wñ\s]+?)(?:\?|$)/,
  /existe[n]?\s+(?:el\s+|la\s+|los\s+|las\s+|un\s+|una\s+)?(?<entity>[\wñ\s]+?)(?:\?|$)/,
  /busco\s+(?:un\s+|una\s+|el\s+|la\s+)?(?<entity>[\wñ\s]+?)(?:\?|$)/,
  /quiero\s+(?:un\s+|una\s+|el\s+|la\s+)?(?<entity>[\wñ\s]+?)(?:\?|$)/,
  // Purchase imperatives: "dame una hamburguesa doble", "dame un taco al pastor"
  // "dame el catálogo/menú de X" is intercepted by the catalog pattern above.
  // This pattern captures direct product requests: "dame (un/una) <product>".
  /\bdame\s+(?:un[ao]\s+)?(?<entity>[\wñ\s]+?)(?:\?|$)/,
  // Past-tense order: "pedí una pizza hawaiana" — common in Mexican informal speech
  /\bped[ií]\s+(?:un[ao]\s+)?(?<entity>[\wñ\s]+?)(?:\?|$)/,
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
      if (cleaned.length >= 2 && !isBlocklisted(cleaned) && !BARE_ARTICLES.has(cleaned)) {
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
      .filter((n) => n.length >= 2 && !isBlocklisted(n) && !BARE_ARTICLES.has(n))
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
  // as a substring, so we also require each word to appear in the PRODUCT NAME.
  //
  // IMPORTANT: We search p.name ONLY (not description/attributes) here because
  // combining individual words OR'd across description+attrs produces false positives:
  //   "agua natural" → "agua" in description + "natural" in description of an unrelated
  //   product ("Hamburguesa Vegetariana — ingredientes naturales en agua purificada")
  //   would match, returning completely wrong results.
  // The full-phrase ILIKE in the first loop already covers description/attr matches for the
  // exact phrase. This fallback only adds value for product NAMES that contain all the words
  // but not as a consecutive substring.
  for (const v of variants) {
    const words = v.split(' ').filter((w) => w.length >= 2);
    if (words.length < 2) continue; // single-word already covered above
    const wordClauses = [];
    for (const w of words) {
      const like = `%${sqlParam(w)}%`;
      wordClauses.push(`${trCol('p.name')} ILIKE $${idx}`);
      params.push(like);
      idx += 1;
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

/**
 * Searches business_services by ILIKE on name and description.
 * Also tries each word of a multi-word candidate so "servicio a domicilio"
 * matches a service simply named "Domicilio" or "Entrega a domicilio".
 *
 * @param {string} entity
 * @param {number} businessId
 * @returns {Promise<Array>}
 */
async function queryServices(entity, businessId) {
  // Build a list of variants: full phrase + individual meaningful words (len > 2)
  const words = entity.split(/\s+/).filter((w) => w.length > 2);
  const variants = [...new Set([entity, ...words])];

  for (const v of variants) {
    const result = await db.query(
      `SELECT id, name, description, price
       FROM business_services
       WHERE business_id = $1
         AND (name ILIKE $2 OR description ILIKE $2)
       ORDER BY name ASC
       LIMIT 5`,
      [businessId, `%${v}%`]
    );
    if (result.rows.length > 0) return result.rows;
  }
  return [];
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
  // existence-question verb (tiene / tienes / tienen / hay).  In those messages
  // the full phrase after the verb is the PRODUCT NAME, not a compound type+attr
  // query.  e.g. "tienen agua de limon" → entity="agua de limon" (product),
  // NOT compound entity="agua" + attribute="limon".
  // Similarly "tienes hamburguesa con queso?" → entity="hamburguesa con queso"
  // (product search), not compound entity="hamburguesa" + attribute="queso".
  // "cuenta con pizza hawaiana?" / "cuentan con X?" — same guard: the whole
  // phrase after "cuenta con" is the product name, not a compound entity+attr.
  // Note: "tiene algo con carne de res" is NOT guarded (extractAttribute fires
  // first) and its embedded compound is promoted via the inner-compound check.
  const skipCompound = /^(?:tiene[sn]?|hay|cuentan?)\s/.test(normalizedText);
  const compoundExtracted = skipCompound ? null : extractCompoundQuery(normalizedText);
  if (compoundExtracted) {
    const attrType = isMaterial(compoundExtracted.attribute) ? 'material' : 'feature';
    // Check if the entity part resolves to a category → use category+attribute path
    // so the pipeline searches within that category for products with the attribute,
    // instead of doing a raw compound product search.
    // e.g. "bebida de chocolate" → entity="bebida" is a category → categoryTerm set
    try {
      const catRows = await queryCategories(compoundExtracted.entity, businessId);
      if (catRows.length > 0) {
        return {
          ...empty,
          type: 'attribute',
          value: compoundExtracted.fullPhrase,
          categoryTerm: compoundExtracted.entity,
          attributeTerm: compoundExtracted.attribute,
          attributeType: attrType,
        };
      }
    } catch (err) {
      console.error('[EntityDetector] Error querying categories for compound entity:', err.message);
    }
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
          return { ...empty, category: tipoCand, type: 'category', value: tipoCand, _categoryRows: categoryRows };
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
          return { ...empty, category: queCand, type: 'category', value: queCand, _categoryRows: categoryRows };
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
          return { ...empty, category: bareCand, type: 'category', value: bareCand, _categoryRows: categoryRows };
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

  // ── "entity CON attribute" candidate resolution ───────────────────────────
  // When the regex extracted a phrase containing "con" (e.g. "bebida con chocolate"),
  // check whether the part BEFORE "con" is a category (or its singular/plural form).
  // If it resolves to a category, return an attribute result so the pipeline
  // searches products in that category that have the given attribute — giving
  // "bebidas con chocolate" rather than a raw product full-text search.
  // Falls through to normal product/category search only when no category matches.
  if (candidate.includes(' con ')) {
    const conIdx = candidate.indexOf(' con ');
    const entityPart = candidate.slice(0, conIdx).trim();
    const attrPart   = candidate.slice(conIdx + 5).trim();
    if (entityPart.length >= 2 && attrPart.length >= 2) {
      try {
        const catRows = await queryCategories(entityPart, businessId);
        if (catRows.length > 0) {
          return {
            ...empty,
            type: 'attribute',
            value: `${entityPart} con ${attrPart}`,
            categoryTerm: entityPart,
            attributeTerm: attrPart,
            attributeType: 'feature',
          };
        }
      } catch (err) {
        console.error('[EntityDetector] Error querying categories for entity-con-attr:', err.message);
      }
      // Category not found — try exact product match with full "entity con attr" before
      // falling back to the broad product search below.
      try {
        const exactRows = await queryProducts(candidate, businessId);
        if (exactRows.length > 0) {
          return { ...empty, product: candidate, type: 'product', value: candidate, _rows: exactRows };
        }
      } catch (err) {
        console.error('[EntityDetector] Error querying products for entity-con-attr:', err.message);
      }
      // If neither category nor exact product found, try the entity part alone as a product
      try {
        const entityRows = await queryProducts(entityPart, businessId);
        if (entityRows.length > 0) {
          // Return attribute so the pipeline filters by both entity + attribute
          return {
            ...empty,
            type: 'attribute',
            value: `${entityPart} con ${attrPart}`,
            categoryTerm: null,
            entityTerm: entityPart,
            attributeTerm: attrPart,
            attributeType: 'feature',
          };
        }
      } catch (err) {
        console.error('[EntityDetector] Error querying products for entity part:', err.message);
      }
    }
  }

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

  // Try service — checked last so product/category/promotion take priority.
  // Handles queries like "tiene servicio a domicilio?" where the candidate is
  // not a product but resolves to a business service.
  try {
    const serviceRows = await queryServices(candidate, businessId);
    if (serviceRows.length > 0) {
      return { ...empty, type: 'service', value: candidate, _serviceRows: serviceRows };
    }
  } catch (err) {
    console.error('[EntityDetector] Error querying services:', err.message);
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

/**
 * Formats results when the exact search phrase had no match but individual
 * keywords did (partial / related match).
 * @param {string} originalEntity  The full user search phrase (e.g. "escuadra metalica")
 * @param {Array}  products        Related products found via word fallback
 * @returns {string}
 */
function formatPartialMatchResponse(originalEntity, products) {
  if (!products || products.length === 0) {
    return `Lo siento, no encontré ningún producto relacionado con "${originalEntity}". ¿Quieres ver el catálogo completo?`;
  }
  if (products.length === 1) {
    const p = products[0];
    const priceTag = p.is_available !== false
      ? ` a $${Number(p.price).toFixed(2)}`
      : ` (no disponible)`;
    return `Encontré un producto relacionado con lo que buscas: ${p.name}${priceTag}. ¿Es lo que necesitas? 😊`;
  }
  const available = products.filter((p) => p.is_available !== false);
  const pool   = available.length > 0 ? available : products;
  const sample = pool.slice(0, VOICE_LIST_LIMIT);
  const names  = sample.map((p) => `${p.name} a $${Number(p.price).toFixed(2)}`);
  return `Encontré productos relacionados con lo que buscas: ${_enumList(names)}. ¿Alguno te interesa?`;
}

export {
  detectEntities,
  extractEntityCandidate,
  queryProducts,
  queryCategories,
  queryPromotions,
  queryServices,
  formatProductResponse,
  formatPartialMatchResponse,
  formatCategoryResponse,
  // Exported for testing
  isBlocklisted,
  stripLeadingStopwords,
  hasProductTrigger,
  PRODUCT_QUERY_PATTERNS,
};

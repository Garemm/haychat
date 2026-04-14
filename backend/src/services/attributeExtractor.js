'use strict';

/**
 * src/services/attributeExtractor.js
 *
 * ATTRIBUTE EXTRACTOR — Extracts semantic attributes from user queries.
 *
 * Handles patterns like:
 *   "tienes algo con queso"          → { value: "queso",     type: "ingredient" }
 *   "algo que tenga bluetooth"       → { value: "bluetooth", type: "feature" }
 *   "tornillos para madera"          → { value: "madera",    type: "use" }
 *   "cables de 2 metros"             → { value: "2 metros",  type: "measure" }
 *   "tornillos de 10 milimetros"     → { value: "10 milimetros", type: "measure" }
 *   "productos de acero inoxidable"  → { value: "acero inoxidable", type: "material" }
 *
 * DESIGN:
 *   - NO hardcoded domain knowledge (works for any industry)
 *   - Dynamic classification based on structural patterns
 *   - Returns null when no attribute-style pattern found
 *   - Works on already-normalized text (lowercase, no accents)
 */

import { normalize } from './normalize.js';

// ─── Measure detection ────────────────────────────────────────────────────────

/** Units that indicate a measure attribute. */
const MEASURE_UNITS = new Set([
  // length
  'metros', 'metro', 'cm', 'centimetros', 'centimetro',
  'mm', 'milimetros', 'milimetro', 'km', 'kilometros', 'pulgadas', 'pulgada',
  // weight
  'kg', 'kilos', 'kilo', 'kilogramos', 'gramos', 'gramo', 'g', 'mg', 'toneladas',
  // volume
  'litros', 'litro', 'lt', 'lts', 'ml', 'mililitros',
  // capacity/power
  'watts', 'watt', 'w', 'kw', 'volts', 'volt', 'v', 'amp', 'amperes', 'ah',
  // size
  'pies', 'pie', 'inch', 'inches', 'talla', 'tallas', 'numero', 'numeros',
  // count/pack
  'unidades', 'piezas', 'pieza', 'pack', 'paquete',
]);

/**
 * Returns true if candidate looks like a measurement (e.g. "10 milimetros", "2 metros").
 * @param {string} candidate
 * @returns {boolean}
 */
function isMeasure(candidate) {
  const tokens = candidate.trim().split(/\s+/);
  // "2 metros", "10 mm", "1.5 litros"
  if (tokens.length >= 2 && /^\d+([.,]\d+)?$/.test(tokens[0])) {
    return MEASURE_UNITS.has(tokens[tokens.length - 1]);
  }
  // single unit token like "xl", "talla 10" already handled above
  return MEASURE_UNITS.has(candidate);
}

// ─── Material keywords ────────────────────────────────────────────────────────

/**
 * Common material-related word suffixes / patterns.
 * Kept minimal — the classifier is intentionally generic.
 */
const MATERIAL_WORDS = new Set([
  'acero', 'hierro', 'aluminio', 'madera', 'plastico', 'goma', 'caucho',
  'hule', 'fibra', 'vidrio', 'cristal', 'ceramica', 'tela', 'cuero',
  'cobre', 'bronce', 'titanio', 'nylon', 'pvc', 'latex', 'silicona',
  'concreto', 'cemento', 'marmol', 'granito', 'carbon', 'grafito',
]);

function isMaterial(candidate) {
  const tokens = candidate.split(/\s+/);
  return tokens.some((t) => MATERIAL_WORDS.has(t));
}

// ─── Classify attribute type ──────────────────────────────────────────────────

/**
 * Classifies the semantic type of an extracted attribute value.
 *
 * Priority:
 *   1. measure  — numeric + unit ("10 milimetros")
 *   2. use      — extracted with "para" preposition (takes precedence over material)
 *   3. material — known material word ("acero inoxidable")
 *   4. feature  — default fallback
 *
 * @param {string} value     Normalized attribute value
 * @param {string} [hint]    Preposition that triggered extraction ("con"|"para"|"de"|"que tenga")
 * @returns {'measure'|'material'|'use'|'feature'|'ingredient'|'price_filter'}
 */
function classifyAttributeType(value, hint) {
  if (hint === 'price_filter') return 'price_filter';
  if (isMeasure(value)) return 'measure';
  // "para" always signals intended USE, even if the word is also a material
  if (hint === 'para') return 'use';
  if (isMaterial(value)) return 'material';
  // "con" often signals ingredient in food context; but we keep it generic
  // by calling it "feature" unless the business is restaurant-specific.
  // The pipeline doesn't care about sub-type for DB queries.
  if (hint === 'con') return 'feature';
  return 'feature';
}

// ─── Attribute extraction patterns ───────────────────────────────────────────

/**
 * Each entry has:
 *   - pattern: regex with named group `attr`
 *   - hint:    preposition/phrase used → passed to classifyAttributeType
 *
 * Order matters: more specific patterns first.
 */
const ATTRIBUTE_PATTERNS = [
  // "algo que tenga X" / "que tengan X" / "algo que tenga X"
  { pattern: /\bque\s+teng[ao][n]?\s+(?<attr>[\wñ]+(?:\s+[\wñ]+){0,4})/, hint: 'que tenga' },
  // "algo con X" / "productos con X" / "con X"
  { pattern: /\bcon\s+(?<attr>[\wñ]+(?:\s+[\wñ]+){0,4})/, hint: 'con' },
  // "algo picante" / "algo dulce" / "algo frio" — bare adjective after "algo"
  // Runs after "que tenga" and "con" so "algo que tenga X" / "algo con X" are handled first.
  // Negative lookahead skips prepositions (para/de/con/que/sin) so they fall through
  // to their own dedicated patterns and get the correct attributeType (e.g. "use" for para).
  { pattern: /\balgo\s+(?!(?:con|para|de|que|sin)\b)(?<attr>[\wñ]+(?:\s+[\wñ]+){0,3})/, hint: 'con' },
  // "para X" — after trigger words or standalone
  { pattern: /\bpara\s+(?<attr>[\wñ]+(?:\s+[\wñ]+){0,3})/, hint: 'para' },
  // "de X metros/cm/mm...etc" — measure only (number + unit)
  { pattern: /\bde\s+(?<attr>\d+(?:[.,]\d+)?\s+[\wñ]+)/, hint: 'de' },
  // "de X" — after "tornillos de madera", "cables de cobre" (not standalone 'de')
  { pattern: /\bde\s+(?<attr>[\wñ]+(?:\s+[\wñ]+){0,3})/, hint: 'de' },
  // price-filter adjectives at end of message:
  //   "dame opciones baratas" → { value: 'baratas', type: 'price_filter' }
  //   "algo más barato" / "lo más económico"
  // Lower priority — only reached when no other ATTRIBUTE_PATTERNS matched.
  { pattern: /\b(?<attr>(?:m[aá]s\s+|lo\s+m[aá]s\s+)?(?:barat[ao]s?|econ[oó]mic[ao]s?|accesibles?))\s*$/, hint: 'price_filter' },
];

/**
 * Stopwords that must not become an attribute value on their own.
 * These are generic query words, not actual attributes.
 */
const ATTR_BLOCKLIST = new Set([
  'algo', 'algun', 'alguna', 'algunos', 'algunas',
  'ese', 'esa', 'esos', 'esas', 'este', 'esta', 'estos', 'estas',
  'cual', 'cuales', 'que', 'como', 'donde', 'cuando',
  'todo', 'todos', 'toda', 'todas', 'nada',
  'nosotros', 'ustedes', 'ellos', 'ellas',
  'precio', 'precios', 'costo', 'costos',
  'info', 'informacion', 'detalle', 'detalles',
  'producto', 'productos', 'articulo', 'articulos',
  'catalogo', 'lista', 'menu',
  // Availability / inventory meta-words — never a compound entity
  'stock', 'disponibilidad', 'disponible', 'disponibles',
  // Description-query meta-words — never a compound entity
  'descripcion', 'especificaciones', 'especificacion', 'caracteristicas', 'caracteristica',
  // Avoid extracting pure article-like fragments
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas',
]);

function isAttrBlocked(value) {
  if (!value || value.length < 2) return true;
  return ATTR_BLOCKLIST.has(value.split(/\s+/)[0]);
}

// ─── Trigger words for attribute queries ──────────────────────────────────────

/**
 * A message is considered an attribute-style query when it contains at least
 * one of these trigger expressions.
 *
 * Prevents false positives on plain product queries ("tienen pizza con horno"
 * would otherwise be hijacked by the "con" pattern).
 *
 * The trigger is intentionally loose: it fires when the user asks about
 * "something with X" rather than a specific named product.
 */
const ATTRIBUTE_TRIGGER_RE =
  /\b(?:algo|alguna?\s+cosa|alguno?|productos?\s+con|productos?\s+de|productos?\s+para|algo\s+que\s+teng[ao]|que\s+teng[ao]|que\s+tenga[n]?)\b/;

/**
 * Checks whether the normalized message is an attribute-style search query.
 *
 * Detects two classes:
 *   1. Explicit trigger words ("algo con X", "productos con X", "algo que tenga X")
 *   2. Structural patterns — self-identifying regardless of trigger words:
 *      a. "NOUN para NOUN" → use-intent ("tornillos para madera")
 *      b. "NOUN de NUMBER UNIT" → measure ("cables de 2 metros")
 *
 * The structural patterns are intentionally narrow to avoid false positives
 * like "agua de jamaica" (product name) or "pregunta para ti" (chat phrase).
 *
 * @param {string} normalizedText
 * @returns {boolean}
 */
function isAttributeQuery(normalizedText) {
  // Class 1: explicit trigger words
  if (ATTRIBUTE_TRIGGER_RE.test(normalizedText)) return true;

  // Class 2a: "NOUN para NOUN" structural pattern
  // Only fires when the "para" phrase appears at or near the START of the sentence
  // (after optional short lead-in words). This prevents false positives when "para"
  // is embedded inside a longer price/info query about a service or product whose
  // NAME contains "para" — e.g. "que precio tiene la renta de salon para eventos"
  // should NOT be treated as an attribute query for "eventos".
  // Anchor: the para-phrase must be within the first ~4 tokens.
  if (/^(?:(?:busco|quiero|necesito|hay|tiene[sn]?|tienen|dame)\s+)?(?:[\wñ]+\s+){0,2}[\wñ]+\s+para\s+\w/.test(normalizedText)) return true;

  // Class 2b: "de NUMBER UNIT" measure pattern ("de 2 metros", "de 10 mm")
  if (/\bde\s+\d+(?:[.,]\d+)?\s+\w/.test(normalizedText)) return true;

  // Class 3: price-filter adjectives ("algo barato", "dame opciones baratas", "lo más económico")
  if (/\b(?:m[aá]s\s+)?(?:barat[ao]s?|econ[oó]mic[ao]s?|accesibles?)\b/.test(normalizedText)) return true;

  return false;
}

// ─── Main extractor ───────────────────────────────────────────────────────────

/**
 * @typedef {Object} ExtractedAttribute
 * @property {string} value  - Normalized attribute value (e.g. "queso", "2 metros")
 * @property {'measure'|'material'|'use'|'feature'|'price_filter'} type  - Semantic type
 */

/**
 * Attempts to extract a semantic attribute from the normalized user message.
 *
 * Returns `null` when:
 *   - The message is not an attribute-style query
 *   - No pattern matches
 *   - The extracted value is in the blocklist
 *
 * @param {string} message  Raw or pre-normalized user message
 * @returns {ExtractedAttribute|null}
 */
function extractAttribute(message) {
  const text = normalize(message);

  if (!isAttributeQuery(text)) return null;

  for (const { pattern, hint } of ATTRIBUTE_PATTERNS) {
    const match = text.match(pattern);
    if (!match?.groups?.attr) continue;

    const raw = match.groups.attr.trim();
    if (isAttrBlocked(raw)) continue;

    // Trim trailing noise (trailing stopwords / question particles)
    const cleaned = raw
      .replace(/\s+(?:hay|hay\?|tienen|tienes|tiene|ok|por\s+favor)\s*$/, '')
      .trim();

    if (cleaned.length < 2) continue;

    const type = classifyAttributeType(cleaned, hint);
    return { value: cleaned, type };
  }

  return null;
}

// ─── Compound query extraction ────────────────────────────────────────────────

/**
 * Regex to strip common leading trigger words + optional article before matching
 * the compound "entity de attribute" core pattern.
 */
const COMPOUND_TRIGGER_STRIP_RE =
  /^(?:busco|quiero|tienes?|tienen|hay|necesito|venden?|tiene|dame|muestrame)\s+(?:un\s+|una\s+|el\s+|la\s+|los\s+|las\s+)?/;

/**
 * @typedef {Object} CompoundQuery
 * @property {string} entity      - Main product type, e.g. "tornillos"
 * @property {string} attribute   - Modifier / material / type, e.g. "madera"
 * @property {string} fullPhrase  - Reconstructed phrase, e.g. "tornillos de madera"
 */

/**
 * Detects compound "ENTITY de ATTRIBUTE" queries such as:
 *   "tornillos de madera"  → entity: "tornillos", attribute: "madera"
 *   "carne de res"         → entity: "carne",     attribute: "res"
 *   "cables de cobre"      → entity: "cables",    attribute: "cobre"
 *   "tienes tornillos de madera?" → same result after stripping trigger
 *
 * Returns null when:
 *   - No "de" separator found
 *   - Entity is a generic/meta word (in ATTR_BLOCKLIST)
 *   - Attribute part is a numeric measure (handled by existing flow)
 *
 * @param {string} message  Raw or pre-normalized user message
 * @returns {CompoundQuery|null}
 */
function extractCompoundQuery(message) {
  const text = normalize(message);

  // Strip leading trigger words and optional article to expose the core phrase
  const stripped = text.replace(COMPOUND_TRIGGER_STRIP_RE, '').trim();

  // Try "entity DE attribute" first (e.g. "tornillos de madera", "carne de res")
  let match = stripped.match(
    /^(?<entity>[\wñ]+(?:\s+[\wñ]+){0,2})\s+de\s+(?<attribute>[\wñ]+(?:\s+[\wñ]+){0,3})\s*\??$/
  );
  let separator = 'de';

  // Fallback: "entity CON attribute" — explicit product + ingredient/feature
  // e.g. "hamburguesa con queso", "pizza con extra queso", "agua con gas"
  // Only when the "de" pattern does not match, to avoid false positives.
  if (!match?.groups) {
    match = stripped.match(
      /^(?<entity>[\wñ]+(?:\s+[\wñ]+){0,2})\s+con\s+(?<attribute>[\wñ]+(?:\s+[\wñ]+){0,3})\s*\??$/
    );
    separator = 'con';
  }

  if (!match?.groups) return null;

  const entity = match.groups.entity.trim();
  const attribute = match.groups.attribute.trim();

  // Entity must not be a generic/meta word
  if (isAttrBlocked(entity)) return null;

  // Skip if entity itself is a single stopword (e.g. "el", "la", "un")
  if (entity.length < 2) return null;

  // Attribute must not be a numeric measure — those go through the existing measure path
  if (isMeasure(attribute)) return null;

  const fullPhrase = `${entity} ${separator} ${attribute}`;
  return { entity, attribute, fullPhrase };
}

// ─── Category + attribute query extraction ─────────────────────────────────────────────────────────────────────────

/**
 * Pattern that signals the user is asking for "any product of a category that
 * has a certain attribute".
 *
 * Anchored to the END of the normalized message so the attribute is always the
 * trailing part. The leading trigger (tiene/hay/busco/…) does not need to be
 * captured — only the algún/alguna marker and the two content words matter.
 *
 * Examples (normalized):
 *   "tiene alguna bebida con chocolate"  → categoryWord="bebida",  attribute="chocolate"
 *   "hay algun postre de arroz"          → categoryWord="postre",   attribute="arroz"
 *   "tienes alguna bebida de chocolate"  → categoryWord="bebida",  attribute="chocolate"
 *   "busco algun postre con arroz"       → categoryWord="postre",   attribute="arroz"
 */
const CATEGORY_ATTR_RE =
  /\balgun[ao]?\s+(?<cat>[\wñ]+(?:\s+[\wñ]+){0,2})\s+(?:con|de)\s+(?<attr>[\wñ]+(?:\s+[\wñ]+){0,3})\s*$/;

/**
 * Detects queries of the form "algún/alguna CATEGORY_WORD con|de ATTRIBUTE".
 *
 * Distinct from extractCompoundQuery (which handles "X de Y" product-name pairs
 * like "carne de res") because here "algún/alguna" signals the user wants
 * ANY product from a general category that possesses the attribute.
 *
 * @param {string} message  Raw or pre-normalized message
 * @returns {{ categoryWord: string, attribute: string }|null}
 */
function extractCategoryAttributeQuery(message) {
  const text = normalize(message);
  const match = text.match(CATEGORY_ATTR_RE);
  if (!match?.groups) return null;

  const categoryWord = match.groups.cat.trim();
  const attribute    = match.groups.attr.trim();

  if (isAttrBlocked(categoryWord)) return null;
  if (isAttrBlocked(attribute))    return null;
  if (categoryWord.length < 2)     return null;
  if (attribute.length < 2)        return null;
  if (isMeasure(attribute))        return null;

  return { categoryWord, attribute };
}

export {
  extractAttribute,
  extractCompoundQuery,
  extractCategoryAttributeQuery,
  isAttributeQuery,
  classifyAttributeType,
  isMeasure,
  isMaterial,
  // exposed for testing
  MEASURE_UNITS,
  ATTRIBUTE_TRIGGER_RE,
};

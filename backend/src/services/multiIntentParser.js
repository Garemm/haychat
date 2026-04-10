'use strict';

/**
 * src/services/multiIntentParser.js
 *
 * MULTI-INTENT PARSER — Detects and splits compound Spanish messages into
 * independent query segments when connectors are present.
 *
 * WHY THIS EXISTS:
 *   Real users regularly combine two questions in one message:
 *     "cuánto cuesta la pizza y a qué hora abren?"
 *     "tienen hamburguesas pero sin carne? también quiero ver postres"
 *     "dónde están ubicados y tienen estacionamiento?"
 *
 *   The single-pass pipeline answers only the first detectable intent.
 *   This module splits those messages so each sub-query is answered
 *   independently, then the pipeline joins the responses.
 *
 * SAFETY RULES (conservative by design):
 *   – A split only occurs when the right-side segment has an independent
 *     semantic signal (intent keyword, question word, or action verb).
 *   – Weak connectors ("y", "o") only split when BOTH sides have signals.
 *   – Product-name compounds like "sal y pimienta", "pan y mantequilla"
 *     are NOT split (neither side has a signal word).
 *   – Short messages (≤ 7 words) require stricter signal evidence.
 *   – Maximum of MAX_SPLITS recursive splits to prevent runaway splitting.
 *
 * OUTPUT SHAPE:
 *   [{ segment: string, connectorType: 'primary' | 'additive' | 'alternative' | 'contrastive' }]
 *   – Always ≥ 1 element.
 *   – First element always has connectorType = 'primary'.
 *   – Subsequent elements carry the type of connector that joins them to
 *     the preceding segment.
 *
 * PIPELINE POSITION:
 *   Called BEFORE detectIntent() and detectEntities() in processMessage().
 *   Input must be already preprocessed (normalize + typo-correct) text.
 */

// ─── Intent-signal vocabulary ──────────────────────────────────────────────────

/**
 * Words that indicate an independent sub-query.
 * A segment "has a signal" when it contains at least one of these.
 *
 * Intentionally conservative — common short Spanish words that appear inside
 * product names (e.g. "por", "con", "de") are excluded to avoid false splits.
 */
const SIGNAL_WORDS = new Set([
  // Price / cost
  'precio', 'precios', 'cuesta', 'cuanto', 'cuanta', 'cuantos', 'cuantas',
  'vale', 'cobran', 'costo', 'tarifa', 'cobras', 'cobras',
  // Schedule / location
  'horario', 'horarios', 'hora', 'horas', 'abren', 'cierran', 'atienden', 'abres', 'abre',
  'donde', 'ubicacion', 'direccion', 'llegar', 'llegan', 'mapa',
  // Catalog / search
  'tienen', 'tienes', 'hay', 'venden', 'vende', 'vendes',
  'existe', 'existen', 'disponible', 'disponibles', 'stock',
  'busco', 'buscar', 'quiero', 'necesito', 'catalogo', 'menu', 'lista',
  // Promotions
  'promocion', 'promociones', 'descuento', 'descuentos', 'oferta', 'ofertas', 'promo', 'promos',
  // Product description
  'contiene', 'incluye', 'incluyen', 'trae', 'traen', 'lleva', 'llevan',
  'ingredientes', 'descripcion', 'detalle', 'detalles', 'especificaciones',
  // Purchase intent
  'comprar', 'pedir', 'ordenar', 'adquirir', 'reservar', 'pedido',
  // Contact
  'contacto', 'telefono', 'whatsapp', 'correo', 'email',
  // Services
  'servicio', 'servicios',
  // Question openers that clearly head a new clause
  'cuando', 'como', 'cual', 'cuales',
  // Food / beverage categories — treating these as real semantic signals prevents
  // "comida y bebidas" from being treated as a product-compound and not split.
  'comida', 'comer', 'snacks', 'alimentos', 'bebidas', 'bebida',
  // Price-filter words — "dame algo barato y también una bebida" should split
  'barato', 'baratos', 'barata', 'baratas', 'economico', 'economicos',
]);

/**
 * Returns true when a normalized segment contains at least one signal word.
 * @param {string} segment
 * @returns {boolean}
 */
function hasSignal(segment) {
  return segment.split(/\s+/).some((w) => SIGNAL_WORDS.has(w));
}

// ─── Connector definitions ────────────────────────────────────────────────────

/**
 * Ordered connector rules — checked top-to-bottom, first match wins.
 *
 * strength:
 *   'strong' — always a valid split point (minimum: both sides ≥ 3 chars).
 *   'weak'   — only splits when BOTH sides of the connector have signal words.
 *
 * The regex patterns match the connector WITH surrounding whitespace so the
 * captured left/right sides are clean (no leading/trailing whitespace to trim).
 */
const CONNECTORS = [
  // ── Strong additive ───────────────────────────────────────────────────────
  // "y también" / "también y" — always a clause boundary
  { re: /\s+(?:y\s+también|también\s+y)\s+/,           type: 'additive',    strength: 'strong' },
  // "además" (+ optional "de eso") — always a clause boundary
  { re: /\s+además(?:\s+de\s+eso)?\s+/,                type: 'additive',    strength: 'strong' },
  // "también quiero/necesito/me interesa/quisiera" — explicit desire continuation
  { re: /\s+también\s+(?:quiero|necesito|quisiera|me\s+interesa|me\s+gustaria)\s+/, type: 'additive', strength: 'strong' },
  // "aparte (de eso)" — informal connector meaning "additionally"
  { re: /\s+aparte(?:\s+de\s+eso)?\s+/,                type: 'additive',    strength: 'strong' },

  // ── Strong additive: "pero también" ───────────────────────────────────────
  // "En Monterrey, pero también en San Pedro" — additive despite contrastive start
  { re: /\s+pero\s+tambien\s+/,                          type: 'additive',    strength: 'strong' },

  // ── Strong contrastive ────────────────────────────────────────────────────
  // "sino" — corrective contrast ("no quiero X sino Y")
  { re: /\s+sino\s+/,                                  type: 'contrastive', strength: 'strong' },
  // "pero más/mas barato/económico/sin" — adds a constraint.
  // Lookahead preserves the trigger word on the right side:
  //   "tienen hamburguesas pero sin carne" → right = "sin carne"
  { re: /\s+pero\s+(?=(?:m[aá]s\s+|mas\s+)?(?:barat|econom|sin\s))/,  type: 'contrastive', strength: 'strong' },

  // ── Strong alternative ────────────────────────────────────────────────────
  { re: /\s+o\s+bien\s+/,                              type: 'alternative', strength: 'strong' },
  { re: /\s+ya\s+sea\s+/,                              type: 'alternative', strength: 'strong' },

  // ── Weak additive ("y", "también", "pero") ───────────────────────────────
  // These are only split when BOTH sides independently have signal words.
  { re: /\s+y\s+/,               type: 'additive',    strength: 'weak' },
  { re: /\s+también\s+/,         type: 'additive',    strength: 'weak' },
  { re: /\s+pero\s+/,            type: 'contrastive', strength: 'weak' },

  // ── Weak alternative ─────────────────────────────────────────────────────
  { re: /\s+o\s+/,               type: 'alternative', strength: 'weak' },
];

// ─── Split logic ──────────────────────────────────────────────────────────────

/**
 * Tries to find the first safe connector split in `text`.
 * Returns `{ left, right, type }` or `null` when no safe split is found.
 *
 * @param {string} text  Normalized message (no accents, lowercase, no punctuation)
 * @returns {{ left: string, right: string, type: string } | null}
 */
function findSplit(text) {
  const wordCount = text.split(/\s+/).length;

  for (const { re, type, strength } of CONNECTORS) {
    const idx = text.search(re);
    if (idx === -1) continue;

    const match = text.match(re);
    if (!match) continue;

    const left  = text.slice(0, idx).trim();
    const right = text.slice(idx + match[0].length).trim();

    // Minimum viable segment length
    if (left.length < 3 || right.length < 3) continue;

    if (strength === 'strong') {
      return { left, right, type };
    }

    // Weak connector — require signal presence
    const leftHas  = hasSignal(left);
    const rightHas = hasSignal(right);

    // For short messages (≤ 7 words) both sides must have signals
    if (wordCount <= 7 && !(leftHas && rightHas)) continue;

    // For longer messages at least the right side must have a signal
    // (handles "quiero X y también quiero Y" where left already has signals)
    if (wordCount > 7 && !rightHas) continue;

    // Neither side has a signal AND both sides are very short → product-name
    // compound ("sal y pimienta", "pan y queso") — do not split.
    const lWords = left.split(/\s+/).length;
    const rWords = right.split(/\s+/).length;
    if (!leftHas && !rightHas && lWords <= 3 && rWords <= 3) continue;

    return { left, right, type };
  }

  return null;
}

/** Maximum recursive splits per message. */
const MAX_SPLITS = 3;

/**
 * Recursively splits a segment into labelled sub-segments.
 *
 * @param {string} text   Normalized text to split
 * @param {number} depth  Recursion depth (starts at 0)
 * @returns {{ segment: string, connectorType: string }[]}
 */
function _recursiveSplit(text, depth) {
  if (depth >= MAX_SPLITS) {
    return [{ segment: text, connectorType: 'primary' }];
  }

  const found = findSplit(text);
  if (!found) {
    return [{ segment: text, connectorType: 'primary' }];
  }

  const leftParts  = _recursiveSplit(found.left, depth + 1);
  const rightParts = _recursiveSplit(found.right, depth + 1);

  // Tag the first right part with the connector type that introduced it
  if (rightParts.length > 0) {
    rightParts[0].connectorType = found.type;
  }

  return [...leftParts, ...rightParts];
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parses a normalized message into an array of typed segments.
 *
 * When no safe split is found, returns the original text as a single
 * 'primary' segment (always at least one element).
 *
 * @param {string} normalizedText  Already preprocessed (lowercase, no accents, no punctuation)
 * @returns {{ segment: string, connectorType: 'primary' | 'additive' | 'alternative' | 'contrastive' }[]}
 *
 * @example
 * parseMultiIntent('cuanto cuesta la pizza y que horarios tienen')
 * // [
 * //   { segment: 'cuanto cuesta la pizza', connectorType: 'primary' },
 * //   { segment: 'que horarios tienen',    connectorType: 'additive' },
 * // ]
 *
 * @example
 * parseMultiIntent('sal y pimienta')
 * // [{ segment: 'sal y pimienta', connectorType: 'primary' }]  ← not split
 */
function parseMultiIntent(normalizedText) {
  if (!normalizedText || normalizedText.length < 6) {
    return [{ segment: normalizedText || '', connectorType: 'primary' }];
  }

  const parts = _recursiveSplit(normalizedText, 0);

  // First segment is always 'primary' regardless of internal recursion labels
  if (parts.length > 0) {
    parts[0].connectorType = 'primary';
  }

  return parts;
}

// ─── Response joining ─────────────────────────────────────────────────────────

/**
 * Joining pools for each connector type.
 * Each entry is a natural Spanish bridge phrase with a trailing space.
 */
const JOIN_BRIDGES = {
  additive: [
    'Además, ',
    'Por otro lado, ',
    'También te cuento que ',
    'Y sobre lo otro: ',
  ],
  alternative: [
    'Ahora bien, ',
    'Como alternativa: ',
    'O si prefieres: ',
  ],
  contrastive: [
    'Dicho esto, ',
    'Eso sí, ',
    'Ahora bien, ',
  ],
};

/**
 * Joins two response strings with a connector phrase that matches the
 * connector type used between the original query segments.
 *
 * The second response starts with a lower-case character (unless it is
 * an emoji or digit, in which case it is left as-is).
 *
 * @param {string} first
 * @param {string} second
 * @param {'primary' | 'additive' | 'alternative' | 'contrastive'} connectorType
 * @returns {string}
 */
function joinResponses(first, second, connectorType) {
  if (!first) return second;
  if (!second) return first;

  const pool   = JOIN_BRIDGES[connectorType] ?? JOIN_BRIDGES.additive;
  const bridge = pool[Math.floor(Math.random() * pool.length)];

  // Lower-case the start of the second response when it begins with a letter
  const secondFormatted = /^[A-Za-záéíóúÁÉÍÓÚüÜñÑ]/.test(second)
    ? second.charAt(0).toLowerCase() + second.slice(1)
    : second;

  return `${first}\n\n${bridge}${secondFormatted}`;
}

module.exports = { parseMultiIntent, joinResponses, hasSignal };

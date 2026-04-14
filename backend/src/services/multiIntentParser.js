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
  'tiene', 'tienen', 'tienes', 'hay', 'venden', 'vende', 'vendes',
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
  'barato', 'baratos', 'barata', 'baratas', 'economico', 'economicos', 'economica', 'economicas',
]);

/**
 * Returns true when a normalized segment contains at least one signal word.
 * @param {string} segment
 * @returns {boolean}
 */
function hasSignal(segment) {
  return segment.split(/\s+/).some((w) => SIGNAL_WORDS.has(w));
}

/**
 * Interrogative words that, when they start a segment of ≥ 2 tokens, indicate
 * the segment is an independent sub-query clause — even with no SIGNAL_WORDS.
 * e.g. "que refrescos", "que postres", "cuantos modelos"
 *
 * Using a separate helper (rather than adding "que" to SIGNAL_WORDS) avoids
 * false positives on product-name fragments like "agua de que" or
 * compound nouns that happen to contain "que".
 */
const _INTERROGATIVES_START = new Set([
  'que', 'cual', 'cuales', 'cuanto', 'cuantos', 'cuanta', 'cuantas',
  'donde', 'cuando', 'como',
]);

/**
 * Returns true when the segment begins with an interrogative word AND has at
 * least one additional token (i.e. it forms a real clause, not a lone "que").
 *
 * @param {string} segment  Normalized text
 * @returns {boolean}
 */
function startsWithInterrogative(segment) {
  const tokens = segment.split(/\s+/);
  return tokens.length >= 2 && _INTERROGATIVES_START.has(tokens[0]);
}

/**
 * A segment "has a right-side signal" when it either contains a signal word OR
 * begins with an interrogative word followed by at least one more token.
 * Used specifically to evaluate the right side of a weak connector.
 *
 * @param {string} segment
 * @returns {boolean}
 */
function hasSignalOrClause(segment) {
  return hasSignal(segment) || startsWithInterrogative(segment);
}

/**
 * Existence-query verbs — the user is asking whether a product/item exists.
 * When a left segment contains one of these, a bare noun phrase on the right
 * is an implied parallel existence query ("tienen X y Y?" = "tienen X? y tienen Y?").
 */
const EXISTENCE_VERBS = new Set([
  'tiene', 'tienes', 'tienen',
  'hay',
  'vende', 'vendes', 'venden',
  'existe', 'existen',
]);

/** Articles that should not count as "meaningful" tokens in a noun phrase. */
const _NP_ARTICLES = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas']);

/**
 * Returns true when `segment` contains an existence-query verb.
 * Works for both leading position ("tienen X") and embedded ("de casualidad tienen X").
 * @param {string} segment
 * @returns {boolean}
 */
function isExistenceQuery(segment) {
  return segment.split(/\s+/).some((w) => EXISTENCE_VERBS.has(w));
}

/**
 * Returns true when `segment` is a plausible bare noun phrase with at least
 * 2 non-article tokens — indicating the user meant to list a second item
 * rather than complete a compound product name.
 *
 * Single-word right sides (e.g. "pimienta" in "tienen sal y pimienta") return
 * false so compound product names are never accidentally split.
 *
 * @param {string} segment
 * @returns {boolean}
 */
function isMultiWordNounPhrase(segment) {
  const tokens = segment.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length < 2) return false;
  const meaningful = tokens.filter((t) => !_NP_ARTICLES.has(t));
  return meaningful.length >= 2;
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
  // "y tambien" / "tambien y" — always a clause boundary
  // NOTE: input is normalized (no accents), so match 'tambien' not 'también'
  { re: /\s+(?:y\s+tambien|tambien\s+y)\s+/,           type: 'additive',    strength: 'strong' },
  // "ademas" (+ optional "de eso") — always a clause boundary
  // NOTE: input is normalized (no accents), so we match 'ademas' not 'además'
  { re: /\s+ademas(?:\s+de\s+eso)?\s+/,                type: 'additive',    strength: 'strong' },
  // "tambien quiero/necesito/me interesa/quisiera" — explicit desire continuation
  { re: /\s+tambien\s+(?:quiero|necesito|quisiera|me\s+interesa|me\s+gustaria)\s+/, type: 'additive', strength: 'strong' },
  // "aparte (de eso)" — informal connector meaning "additionally"
  { re: /\s+aparte(?:\s+de\s+eso)?\s+/,                type: 'additive',    strength: 'strong' },

  // ── Strong additive: "pero tambien" ────────────────────────────────────────
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

  // ── Weak additive ("y", "tambien", "pero") ────────────────────────────────
  // These are only split when BOTH sides independently have signal words.
  // NOTE: input is normalized (no accents), so match 'tambien' not 'también'
  { re: /\s+y\s+/,               type: 'additive',    strength: 'weak' },
  { re: /\s+tambien\s+/,         type: 'additive',    strength: 'weak' },
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
    const rightHas = hasSignalOrClause(right);

    // Implied-existence exception:
    //   "tienen hamburguesa doble y agua de jamaica?"
    //   Left has an existence verb → the verb is implicit for the right side too.
    //   Guard: right must be a multi-word noun phrase (≥ 2 meaningful tokens) so
    //   single-word continuations like "tienen sal y pimienta" are never split.
    if (leftHas && !rightHas && isExistenceQuery(left) && isMultiWordNounPhrase(right)) {
      return { left, right, type };
    }

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

export { parseMultiIntent, joinResponses, hasSignal, startsWithInterrogative, hasSignalOrClause };

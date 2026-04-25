'use strict';

/**
 * src/services/textPreprocessor.js
 *
 * MESSAGE PREPROCESSOR — Runs before intent detection and entity extraction.
 *
 * Provides a generic (domain-agnostic) preprocessing pipeline for Spanish NLP:
 *
 *   Pipeline (in order):
 *     1. normalize()        — lowercase, strip accents, strip punctuation
 *     2. expandAbbreviations() — "xq" → "porque", "q" → "que"
 *     3. correctTypos()     — explicit typo dict + conservative Levenshtein (≤2)
 *
 *   Singularization is NOT applied to the full message (would corrupt verb forms).
 *   Use singularizeTokens() only on extracted entity candidates.
 *
 * SECURITY / SAFETY:
 *   - Typo correction is opt-out: any word in validSet is never modified.
 *   - Levenshtein correction fires only when EXACTLY ONE match exists (no ambiguity).
 *   - Short tokens (≤2 chars) and tokens in validSet are always preserved.
 *   - singularizeTokens() protects verbs and function words via SINGULARIZE_STOPWORDS.
 */

import { normalize, toSingular } from './normalize.js';

// ─── Abbreviation map ─────────────────────────────────────────────────────────

/**
 * Exact-token abbreviation expansions for informal Spanish.
 * Keys are already-normalized tokens (no accents, lowercase).
 */
const ABBREVIATIONS = new Map([
  ['xq',     'porque'],
  ['pq',     'porque'],
  ['porq',   'porque'],
  ['q',      'que'],
  ['k',      'que'],
  ['tb',     'tambien'],
  ['tmb',    'tambien'],
  ['tbm',    'tambien'],
  ['dnd',    'donde'],
  ['dnde',   'donde'],
  ['xfa',    'por favor'],
  ['pf',     'por favor'],
  ['pfv',    'por favor'],
  ['porfis', 'por favor'],
  ['tdo',    'todo'],
  ['td',     'todo'],
  ['xa',     'para'],
  ['pa',     'para'],
  ['ntp',    'no te preocupes'],
  ['bn',     'bien'],
  ['grs',    'gracias'],
  ['grax',   'gracias'],
  ['tel',    'telefono'],
  ['dir',    'direccion'],
  ['stk',    'stock'],
]);

/**
 * Expands abbreviations in an already-normalized string.
 * Replaces exact token matches only — never partial-word replacements.
 *
 * @param {string} text  Already normalized (lowercase, no accents, no punctuation)
 * @returns {string}
 */
function expandAbbreviations(text) {
  return text
    .split(/\s+/)
    .map((token) => ABBREVIATIONS.get(token) ?? token)
    .join(' ');
}

// ─── Typo dictionary ──────────────────────────────────────────────────────────

/**
 * ~100 common Spanish misspellings in normalized form (no accents, lowercase).
 * These are explicit mappings — no guessing involved.
 */
const TYPO_DICT = new Map([
  // tener / tienen / tienes
  ['tiennen',    'tienen'],
  ['tienenm',    'tienen'],
  ['tienenn',    'tienen'],
  ['tienn',      'tienen'],
  ['tiense',     'tienes'],
  ['tienee',     'tiene'],
  // cuánto / cuántas / cuántos
  ['cauntas',    'cuantas'],
  ['cuanats',    'cuantas'],
  ['cauanto',    'cuanto'],
  ['cuannto',    'cuanto'],
  ['cuantoo',    'cuanto'],
  ['cuanots',    'cuantos'],
  ['cuantass',   'cuantas'],
  // hora / horario
  ['ora',        'hora'],
  ['oraio',      'horario'],
  ['horaro',     'horario'],
  ['oraios',     'horarios'],
  ['horiario',   'horario'],
  ['orario',     'horario'],
  // hacer
  ['aser',       'hacer'],
  ['acer',       'hacer'],
  ['hasr',       'hacer'],
  ['hacr',       'hacer'],
  // quiero
  ['kiero',      'quiero'],
  ['quero',      'quiero'],
  ['quieroo',    'quiero'],
  ['kero',       'quiero'],
  // precio
  ['preico',     'precio'],
  ['presio',     'precio'],
  ['percio',     'precio'],
  ['prseio',     'precio'],
  ['preco',      'precio'],
  // buscar / busco
  ['vusco',      'busco'],
  ['bsuco',      'busco'],
  ['bucso',      'busco'],
  ['buskar',     'buscar'],
  // producto / productos
  ['proudcto',   'producto'],
  ['prodcuto',   'producto'],
  ['produnto',   'producto'],
  ['proucto',    'producto'],
  ['producos',   'productos'],
  ['proudctos',  'productos'],
  ['prodcutos',  'productos'],
  // hay
  ['hai',        'hay'],
  // disponible
  ['disponile',  'disponible'],
  ['diponible',  'disponible'],
  ['disponibe',  'disponible'],
  ['disponbles', 'disponibles'],
  ['disposible', 'disponible'],
  // venden
  ['bendem',     'venden'],
  ['vemden',     'venden'],
  ['vandeen',    'venden'],
  ['vendenn',    'venden'],
  // comprar
  ['conprar',    'comprar'],
  ['conmprar',   'comprar'],
  ['conpra',     'compra'],
  // servicio
  ['serbisio',   'servicio'],
  ['servico',    'servicio'],
  ['servisio',   'servicio'],
  ['serbicio',   'servicio'],
  // abrir / abren
  ['habren',     'abren'],
  ['habre',      'abre'],
  ['habrn',      'abren'],
  // cierran
  ['sierran',    'cierran'],
  ['cierram',    'cierran'],
  ['cierrna',    'cierran'],
  // necesito
  ['neceisto',   'necesito'],
  ['necessito',  'necesito'],
  ['nesesito',   'necesito'],
  ['nesecito',   'necesito'],
  ['necisito',   'necesito'],
  // gracias
  ['garcias',    'gracias'],
  ['grasias',    'gracias'],
  ['gratcias',   'gracias'],
  // hola
  ['ola',        'hola'],
  ['holaa',      'hola'],
  // cuando
  ['cuandoo',    'cuando'],
  ['caundo',     'cuando'],
  ['cuado',      'cuando'],
  // donde
  ['dondee',     'donde'],
  ['donede',     'donde'],
  ['doned',      'donde'],
  // catalogo
  ['catatlogo',  'catalogo'],
  ['catalogoo',  'catalogo'],
  ['calalogo',   'catalogo'],
  // direccion
  ['drieccion',  'direccion'],
  ['dieccion',   'direccion'],
  ['dirrecion',  'direccion'],
  // telefono
  ['telfono',    'telefono'],
  ['telelfono',  'telefono'],
  ['telfeno',    'telefono'],
  // promocion
  ['promoicon',  'promocion'],
  ['promoion',   'promocion'],
  ['prmocion',   'promocion'],
  // descuento
  ['descunto',   'descuento'],
  ['descueno',   'descuento'],
  // cuales
  ['cueles',     'cuales'],
  ['cuels',      'cuales'],
  // oferta
  ['oferat',     'oferta'],
  ['oferts',     'ofertas'],
  ['ofretas',    'ofertas'],
  // envio
  ['envoi',      'envio'],
  ['emvio',      'envio'],
  ['envoi',      'envio'],
  // stock
  ['stokc',      'stock'],
  ['sotck',      'stock'],
  ['stoce',      'stock'],
  ['stcok',      'stock'],
  // existen / existe
  ['exsiten',    'existen'],
  ['exsite',     'existe'],
  ['existem',    'existen'],
  // lista
  ['listta',     'lista'],
  ['lissta',     'lista'],
  // ubicacion
  ['ubcacion',   'ubicacion'],
  ['ubiacion',   'ubicacion'],
  // informacion
  ['imformacion','informacion'],
  ['infromacion','informacion'],
  // pago
  ['pagro',      'pago'],
  ['pagor',      'pago'],
  // quieres
  ['quierre',    'quieres'],
  ['quierees',   'quieres'],
]);

// ─── Levenshtein distance ─────────────────────────────────────────────────────

/**
 * Iterative Levenshtein distance between two strings.
 * Uses two-row DP approach for O(n) space.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function levenshtein(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const lenB = b.length;
  let prev = Array.from({ length: lenB + 1 }, (_, i) => i);
  const curr = new Array(lenB + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= lenB; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= lenB; j++) prev[j] = curr[j];
  }
  return prev[lenB];
}

// ─── Valid-word set builder ───────────────────────────────────────────────────

/**
 * Builds a Set of domain-specific words that MUST NOT be corrected.
 * Tokens from product names and category names are safe from typo correction,
 * preventing "aser4000" → "hacer" when "aser4000" is a real product.
 *
 * @param {string[]} [products=[]]    Normalized product name strings
 * @param {string[]} [categories=[]] Normalized category name strings
 * @returns {Set<string>}
 */
function buildValidSet(products = [], categories = []) {
  const set = new Set();
  for (const p of products) normalize(p).split(/\s+/).forEach((w) => set.add(w));
  for (const c of categories) normalize(c).split(/\s+/).forEach((w) => set.add(w));
  return set;
}

// ─── Correction target corpus ─────────────────────────────────────────────────

/**
 * Common Spanish NLP words used as Levenshtein correction targets.
 * These are words that appear frequently in user messages and intent keywords.
 */
const CORRECT_WORDS = new Set([
  'tienen', 'tienes', 'tiene', 'tenemos',
  'cuenta', 'cuentan', 'cuentas',
  'cuantas', 'cuantos', 'cuanto', 'cuanta',
  'cuesta', 'cuestan',
  'donde', 'cuando', 'como', 'cual', 'cuales', 'quien',
  'horario', 'horarios', 'hora', 'horas',
  'precio', 'precios', 'costo',
  'producto', 'productos', 'catalogo',
  'disponible', 'disponibles', 'stock',
  'servicio', 'servicios', 'oferta', 'ofertas',
  'promocion', 'promociones', 'descuento', 'descuentos',
  'necesito', 'quiero', 'busco', 'buscar',
  'comprar', 'venden', 'vende', 'vendes', 'hay',
  'abren', 'cierran', 'abre', 'cierra',
  'informacion', 'detalle', 'detalles',
  'hacer', 'hola', 'gracias',
  'telefono', 'direccion', 'ubicacion',
  'existe', 'existen', 'lista',
]);

// ─── Single-token correction ──────────────────────────────────────────────────

/**
 * Attempts to correct a single normalized token.
 *
 * Strategy (in order):
 *   1. Skip if token is ≤2 chars (too short to meaningfully correct)
 *   2. Skip if token is in validSet (domain word — do not touch)
 *   3. Check TYPO_DICT (explicit misspelling map)
 *   4. Levenshtein ==1 against CORRECT_WORDS — only if exactly ONE candidate
 *      exists AND minimum token length is 5. Distance capped at 1 to prevent
 *      false positives (e.g. "cables"→"cuales" at distance 2).
 *   5. Return token unchanged
 *
 * @param {string}      token     Single normalized word
 * @param {Set<string>} validSet  Domain words to protect
 * @returns {string}
 */
function correctWord(token, validSet) {
  if (token.length <= 2) return token;
  if (validSet.has(token)) return token;
  if (CORRECT_WORDS.has(token)) return token; // already correct
  if (TYPO_DICT.has(token)) return TYPO_DICT.get(token);

  // Levenshtein pass — very conservative: only distance==1, tokens ≥5 chars, exactly one match
  if (token.length >= 5) {
    const matches = [];
    for (const correct of CORRECT_WORDS) {
      if (Math.abs(correct.length - token.length) > 1) continue;
      const dist = levenshtein(token, correct);
      if (dist === 1) matches.push(correct);
    }
    if (matches.length === 1) return matches[0];
  }

  return token;
}

/**
 * Corrects typos in all tokens of a normalized text.
 *
 * @param {string}      text      Normalized text
 * @param {Set<string>} validSet  Domain words to protect (optional)
 * @returns {string}
 */
function correctTypos(text, validSet = new Set()) {
  return text
    .split(/\s+/)
    .map((token) => correctWord(token, validSet))
    .join(' ');
}

// ─── Singularization for entity candidates ───────────────────────────────────

/**
 * Spanish verb forms and function words that must NOT be singularized.
 * Applied only when singularizeTokens() is called on entity candidate phrases.
 */
const SINGULARIZE_STOPWORDS = new Set([
  // Articles / prepositions
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas',
  'de', 'del', 'al', 'en', 'por', 'para', 'con', 'sin',
  // Conjunctions / pronouns
  'que', 'donde', 'cuando', 'como', 'cual', 'cuales', 'sus',
  'hay', 'son', 'mas', 'muy', 'nos', 'si', 'no',
  // Question words
  'cuantas', 'cuantos', 'cuanto', 'cuanta',
  // Verbs — protect conjugated forms from singular stripping
  'tienen', 'tienes', 'tiene', 'tenemos',
  'venden', 'vende', 'vendes',
  'busco', 'buscar', 'quiero', 'necesito',
  'existen', 'existe',
]);

/**
 * Singularizes content-word tokens in a short entity candidate phrase.
 * Skips stopwords, function words, and tokens ≤3 chars.
 *
 * Examples:
 *   "cables usb"           → "cable usb"
 *   "productos electronicos" → "producto electronico"
 *   "tienen cables"        → "tienen cable"   (verb preserved)
 *
 * NOTE: Do NOT call this on full messages — only on extracted entity candidates.
 *
 * @param {string} text  Short candidate phrase (already normalized)
 * @returns {string}
 */
function singularizeTokens(text) {
  return text
    .split(/\s+/)
    .map((token) => {
      if (token.length <= 3) return token;
      if (SINGULARIZE_STOPWORDS.has(token)) return token;
      return toSingular(token);
    })
    .join(' ');
}

// ─── Negation detection ──────────────────────────────────────────────────────

/**
 * Spanish negation patterns for detecting what a user explicitly does NOT want.
 * Applied to already-normalized text (no accents, lowercase, no punctuation).
 * Each pattern exposes a named capture group `term` for the negated fragment.
 *
 * Handles:
 *   "no quiero carne"               → "carne"
 *   "sin gluten"                    → "gluten"
 *   "que no tenga picante"          → "picante"
 *   "nada de lácteos"               → "lacteos"
 *   "ningún ingrediente artificial" → "ingrediente artificial"
 */
const NEGATION_PATTERNS = [
  // "no quiero/necesito/busco/pido/deseo X"
  /\bno\s+(?:quiero|necesito|busco|deseo|pido|queria)\s+(?<term>[\wñ][\wñ\s]{1,30}?)(?=\s+(?:y|pero|o)|$)/g,
  // "sin X" — explicit exclusion without a verb
  /\bsin\s+(?<term>[\wñ][\wñ\s]{1,25}?)(?=\s+(?:y|pero|o)|$)/g,
  // "que no tenga/contenga/lleve/incluya X"
  /\bque\s+no\s+(?:tenga[n]?|contenga[n]?|lleve[n]?|incluya[n]?|traiga[n]?)\s+(?<term>[\wñ][\wñ\s]{1,25}?)(?=\s+(?:y|pero|o)|$)/g,
  // "nada de X"
  /\bnada\s+de\s+(?<term>[\wñ][\wñ\s]{1,25}?)(?=\s+(?:y|pero|o)|$)/g,
  // "ningún/ninguna X"
  /\bning[uú]n[ao]?\s+(?<term>[\wñ][\wñ\s]{1,20}?)(?=\s+(?:y|pero|o)|$)/g,
];

/**
 * Detects Spanish negation in a normalized message string
 * and returns all negated terms found.
 *
 * Results are stored in Redis context (`rejectedEntities`) so subsequent
 * turns can exclude those terms from attribute searches and recommendations.
 *
 * @param {string} normalizedText  Already preprocessed (no accents, lowercase)
 * @returns {{ hasNegation: boolean, negatedTerms: string[] }}
 *
 * @example
 * detectNegation('quiero pizza sin gluten y sin cebolla')
 * // { hasNegation: true, negatedTerms: ['gluten', 'cebolla'] }
 *
 * @example
 * detectNegation('tienen hamburguesas')
 * // { hasNegation: false, negatedTerms: [] }
 */
function detectNegation(normalizedText) {
  if (!normalizedText) return { hasNegation: false, negatedTerms: [] };

  const negatedTerms = [];

  for (const pattern of NEGATION_PATTERNS) {
    // Reset lastIndex each iteration since patterns carry the /g flag
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(normalizedText)) !== null) {
      const term = match.groups?.term?.trim();
      if (term && term.length >= 2 && !negatedTerms.includes(term)) {
        negatedTerms.push(term);
      }
    }
  }

  return { hasNegation: negatedTerms.length > 0, negatedTerms };
}

// ─── Leading connector stripping ───────────────────────────────────────────────

/**
 * Casual connectors at the start of a message carry no semantic value for NLP
 * but break entity/attribute extraction patterns.
 * e.g. "pero hamburguesa con queso" → "hamburguesa con queso"
 *      "aunque tienes tacos?" → "tienes tacos?"
 */
// Discourse fillers and connectors at message start that carry no semantic value.
// Includes informal Mexican fillers: "va" (= ok), "dale" (= sure), "perfecto", etc.
const LEADING_CONNECTOR_RE = /^(?:y|pero|aunque|pues(?:\s+bien)?|o\s+sea|oye|vaya|va|perfecto|mira|claro|bueno|dale|ok)\s*[,.]?\s*/;

// "también tienes/tienen/venden X" at the start of a message — the verb phrase
// adds no new semantic content; strip it so entity/attribute extraction sees "X" cleanly.
// Works on already-normalized text (no accents → "tambien").
const LEADING_TAMB_RE = /^tambien\s+(?:tienes?|tienen|venden?|vendes?|hay|ofrecen?|manejan?)\s*/;

/**
 * Strips a leading casual connector or filler phrase (if present) from an
 * already-normalized (lowercase, no-accent) string.
 *
 * Two passes are applied in sequence:
 *   1. Discourse fillers: "pero", "y", "va", "perfecto", "mira", "claro", etc.
 *   2. Leading "también tienes/tienen/venden" — content-free intro phrase.
 *
 * @param {string} text  Normalized text
 * @returns {string}
 */
function stripLeadingConnector(text) {
  const pass1 = text.replace(LEADING_CONNECTOR_RE, '').trim();
  return pass1.replace(LEADING_TAMB_RE, '').trim();
}

// ─── Filler phrase stripping ─────────────────────────────────────────────────

/**
 * Spanish filler / politeness phrases that carry no semantic value for
 * intent or entity detection. All entries are pre-normalized
 * (lowercase, no accents). Sorted longest-first so that multi-word
 * phrases are matched before their component words.
 */
const FILLER_PHRASES_ES = [
  // Politeness / soft requests
  'Hola',
  'si no es mucha molestia',
  'si no es molestia',
  'perdona la molestia',
  'me podrias decir si',
  'me puede decir si',
  'me puedes decir si',
  'podrias decirme si',
  'por favor dime si',
  'por',
  'favor',
  'si me puedes ayudar',
  'quiero saber si',
  'quiero preguntarte si',
  'quisiera saber si',
  'me gustaria saber si',
  'quisiera saber',
  'quiero saber',
  'me gustaria saber',
  'me podrias decir',
  'me puede decir',
  'me puedes decir',
  'podrias decirme',
  'por favor dime',
  'dime',
  // Hedges / discourse markers
  'la verdad es que',
  'la neta es que',
  'o algo por el estilo',
  'aprovechando que',
  'de ser posible',
  'fijate que',
  'resulta que',
  'digamos que',
  'supongo que',
  'si es posible',
  'si pueden',
  'si puedes',
  'de casualidad',
  'por casualidad',
  'a lo mejor',
  'mas o menos',
  'a proposito',
  'por cierto',
  'en realidad',
  'en verdad',
  'de hecho',
  'es decir',
  'o sea que',
  'igual y',
  'de paso',
  'la verdad',
  'la neta',
  'es que',
  'o sea',
  // Single-word softeners / fillers
  'basicamente',
  'practicamente',
  'probablemente',
  'seguramente',
  'simplemente',
  'solamente',
  'ademas',
  'digamos',
  'fijate',
  'resulta',
  'quizas',
  'quiza',
  'disculpa',
  'disculpe',
  'perdona',
  'perdone',
  'nomas',
  'creo',
  'osea',
  'tipo',
  'hey',
].sort((a, b) => b.length - a.length);

// Matches any FILLER_PHRASES_ES entry at the current start of the string,
// followed by whitespace or end-of-string (prevents stripping word prefixes).
const _FILLER_LEADING_RE = new RegExp(
  `^(?:${FILLER_PHRASES_ES
    .map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')})(?=\\s+|$)`,
  'i'
);

/**
 * Strips leading filler / politeness phrases from an already‑normalized
 * (lowercase, no‑accent, no‑punctuation) string.
 *
 * Multiple passes handle stacked fillers such as:
 *   "pues quisiera saber si tienen pizza" → "tienen pizza"
 *
 * Fallback: returns the original input when the stripped result is empty
 * or shorter than 20% of the original (prevents over-cleaning).
 *
 * @param {string} input  Already normalized text
 * @returns {string}
 */
function cleanUserInput(input) {
  if (!input) return input;

  let result = input;
  let prev;

  do {
    prev = result;
    result = result.replace(_FILLER_LEADING_RE, '').trim();
  } while (result !== prev);

  // Never over-clean: return original if result would be too short
  const minLen = Math.max(3, Math.ceil(input.length * 0.2));
  if (!result || result.length < minLen) return input;

  return result;
}

// ─── Inverted-sentence restructuring ─────────────────────────────────────────

/**
 * Common verbs used in a product-search / ordering chat context.
 * All entries must be already normalized (lowercase, no accents).
 * These are the words that legitimately appear as the main verb of a question
 * but end up at the END of the sentence in informal inverted word-order.
 *
 * e.g. "hamburguesa tienes" → "tienes hamburguesa"
 */
const BUSINESS_VERBS = new Set([
  'tienes', 'tiene', 'tienen', 'teneis',
  'hay', 'habia', 'hubiera',
  'manejan', 'maneja', 'manejas',
  'venden', 'vende', 'vendes',
  'ofrecen', 'ofrece', 'ofreces',
  'hacen', 'hace', 'haces',
  'preparan', 'prepara', 'preparas',
  'sirven', 'sirve', 'sirves',
  'traen', 'trae', 'traes',
  'dan', 'da',
  'incluyen', 'incluye',
  'aceptan', 'acepta',
  'entregan', 'entrega',
  'cuentan', 'cuenta',
  'manejan', 'consiguen', 'consigue',
]);

/**
 * Tokens that should be silently dropped before inversion detection
 * (they are not the object, not the verb, just mid-sentence filler).
 * Must be pre-normalized (no accents).
 */
const _INVERSION_SKIP = new Set(['tambien', 'igual', 'asi', 'ya']);

/**
 * Interrogative/relative words that begin well-formed Spanish questions.
 * When tokens[0] is one of these the sentence is NOT an inversion — leave it alone.
 */
const _INTERROGATIVES = new Set([
  'que', 'quien', 'quienes', 'como', 'cuando', 'donde', 'adonde',
  'cuanto', 'cuantos', 'cuanta', 'cuantas', 'cual', 'cuales',
]);

/**
 * Re-orders a simple OV (object–verb) sentence into VO (verb–object) form
 * when a known business verb appears at the END after zero or more skip tokens.
 *
 * Handles two surface patterns:
 *   A) "OBJECT VERB"           → "VERB OBJECT"
 *      "hamburguesa tienes"    → "tienes hamburguesa"
 *
 *   B) "OBJECT SKIP* VERB"     → "VERB OBJECT"
 *      "envios tambien hacen"  → "hacen envios"
 *
 * Safety guards (returns input unchanged when any are triggered):
 *  - Sentence is longer than 10 tokens (too complex to restructure safely)
 *  - Detected verb is at position 0 (already VO — don't touch)
 *  - Verb has a "de/con/sin" modifier right before it (e.g. "carne de res")
 *  - Object segment is empty after removing skip tokens
 *
 * @param {string} text  Already normalized (lowercase, no accents, no punctuation)
 * @returns {string}
 */
function restructureSentence(text) {
  if (!text) return text;

  const tokens = text.trim().split(/\s+/);
  if (tokens.length < 2 || tokens.length > 10) return text;

  // Never restructure sentences starting with an interrogative word —
  // they are proper questions, not inverted constructions.
  // (e.g. "que hamburguesas tienen" is correct; don't swap to "tienen que hamburguesas")
  if (_INTERROGATIVES.has(tokens[0])) return text;

  // Find last token that is a known business verb
  let verbIdx = -1;
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (BUSINESS_VERBS.has(tokens[i])) { verbIdx = i; break; }
  }

  // No known verb found, or verb is already first → nothing to do
  if (verbIdx <= 0) return text;

  // Collect the "object" tokens: everything before verbIdx, minus skip words
  const objectTokens = tokens.slice(0, verbIdx).filter(t => !_INVERSION_SKIP.has(t));
  if (objectTokens.length === 0) return text;

  // Guard: if an interrogative word appears ANYWHERE in the object-token slice
  // (not just at position 0), the sentence is a well-formed fronted‑PP question,
  // not an inversion.  e.g. "de postres que tienes" — "que" sits between the
  // prepositional phrase and the verb; restructuring would produce nonsense.
  if (objectTokens.some(t => _INTERROGATIVES.has(t))) return text;

  // Safety: don't restructure if a "de/con/sin" appears just before the verb
  // (indicates the verb might be embedded inside a phrase like "carne de res tienes")
  // — allow it; that's exactly a valid inversion we want to fix.
  // But refuse if the last object token IS "de", "con", or "sin" (dangling preposition).
  const lastObj = objectTokens[objectTokens.length - 1];
  if (lastObj === 'de' || lastObj === 'con' || lastObj === 'sin') return text;

  // Collect any skip tokens and tokens between verbIdx+1 and end (suffix)
  const suffix = tokens.slice(verbIdx + 1);

  // Rebuild: verb + object [+ suffix]
  const verb = tokens[verbIdx];
  const parts = [verb, ...objectTokens];
  if (suffix.length) parts.push(...suffix);

  return parts.join(' ');
}

// ─── Full preprocessing pipeline ─────────────────────────────────────────────

/**
 * Full message preprocessing pipeline.
 *
 * Runs BEFORE intent detection and entity extraction.
 * The output is a clean, normalized string that:
 *   - Has no accents, no punctuation, no inverted chars
 *   - Has leading casual connectors stripped ("pero" → "")
 *   - Has abbreviations expanded ("xq" → "porque")
 *   - Has common typos corrected ("ora" → "hora")
 *
 * Passing this output to detectIntent() and detectEntities() is safe because
 * both functions call normalize() internally — normalize() is idempotent on
 * already-normalized text.
 *
 * @param {string}   text
 * @param {object}   [opts]
 * @param {string[]} [opts.products=[]]    Product names for valid-word protection
 * @param {string[]} [opts.categories=[]] Category names for valid-word protection
 * @returns {string}
 */
function preprocessMessage(text, { products = [], categories = [] } = {}) {
  const normalized    = normalize(text);
  const cleaned       = cleanUserInput(normalized);
  const expanded      = expandAbbreviations(cleaned);
  const stripped      = stripLeadingConnector(expanded);
  const restructured  = restructureSentence(stripped);
  const validSet      = buildValidSet(products, categories);
  return correctTypos(restructured, validSet);
}

export {
  preprocessMessage,
  expandAbbreviations,
  correctTypos,
  correctWord,
  singularizeTokens,
  buildValidSet,
  levenshtein,
  stripLeadingConnector,
  cleanUserInput,
  restructureSentence,
  detectNegation,
  ABBREVIATIONS,
  TYPO_DICT,
  CORRECT_WORDS,
  FILLER_PHRASES_ES,
  BUSINESS_VERBS,
  SINGULARIZE_STOPWORDS,
  LEADING_CONNECTOR_RE,
  LEADING_TAMB_RE,
};

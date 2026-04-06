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

const { normalize, toSingular } = require('./normalize');

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
  'cuantas', 'cuantos', 'cuanto', 'cuanta',
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

// ─── Full preprocessing pipeline ─────────────────────────────────────────────

/**
 * Full message preprocessing pipeline.
 *
 * Runs BEFORE intent detection and entity extraction.
 * The output is a clean, normalized string that:
 *   - Has no accents, no punctuation, no inverted chars
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
  const normalized = normalize(text);
  const expanded   = expandAbbreviations(normalized);
  const validSet   = buildValidSet(products, categories);
  return correctTypos(expanded, validSet);
}

module.exports = {
  preprocessMessage,
  expandAbbreviations,
  correctTypos,
  correctWord,
  singularizeTokens,
  buildValidSet,
  levenshtein,
  ABBREVIATIONS,
  TYPO_DICT,
  CORRECT_WORDS,
  SINGULARIZE_STOPWORDS,
};

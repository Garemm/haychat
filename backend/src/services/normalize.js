'use strict';

/**
 * src/services/normalize.js
 *
 * Normalización robusta de texto para NLP en español.
 * Módulo centralizado — todos los servicios importan desde aquí.
 *
 * Pipeline:
 *   1. lowercase
 *   2. NFD + strip diacritics (acentos)
 *   3. Strip inverted punctuation (¿ ¡)
 *   4. Strip remaining punctuation except spaces
 *   5. Collapse repeated characters (hoolaa → hola)
 *   6. Trim + collapse whitespace
 */

/**
 * Full normalization pipeline for NLP comparison.
 * @param {string} text
 * @returns {string}
 */
function normalize(text) {
  if (!text) return '';
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/n\u0303/g, 'ñ')          // restore ñ before stripping other diacritics
    .replace(/[\u0300-\u036f]/g, '')    // strip remaining accents
    .replace(/[¿¡]/g, '')              // strip inverted punct
    .replace(/[^a-z0-9ñ\s]/g, '')      // strip punctuation + underscores (keep letters, digits, ñ, spaces)
    .replace(/(.)\1{2,}/g, '$1$1')     // collapse 3+ repeated chars → 2 (hoolaa→hoolaa, holaaa→holaa)
    .replace(/\s+/g, ' ')              // collapse whitespace
    .trim();
}

/**
 * Tries basic singular from a Spanish plural.
 * NOT a full stemmer — handles common suffixes only.
 *
 * Algorithm for -es ending words:
 *   - If stem ends in a VOWEL → the word was vowel-final-stem + 's' → remove only 's'
 *     Example: paquetes → stem="paquete" (ends 'e') → remove 's' → "paquete"
 *   - If stem ends in CONSONANT+CONSONANT cluster → vowel-final-stem + 's' → remove only 's'
 *     Example: cables → stem="cabl" (ends 'bl') → remove 's' → "cable"
 *   - If stem ends in VOWEL+CONSONANT → consonant-final-stem + 'es' → remove 'es'
 *     Example: marcadores → stem="marcador" (ends 'or') → remove 'es' → "marcador"
 * @param {string} word
 * @returns {string}
 */
function toSingular(word) {
  if (word.endsWith('ces')) return word.slice(0, -3) + 'z';   // lapices → lapiz
  if (word.endsWith('iones')) return word.slice(0, -5) + 'ion'; // promociones → promocion
  if (word.endsWith('es') && word.length > 4) {
    const stem = word.slice(0, -2);
    const last = stem[stem.length - 1];
    const penultimate = stem[stem.length - 2];
    const VOWELS = 'aeiou';
    if (VOWELS.includes(last)) {
      // Stem ends in vowel → vowel-final-stem + 's' → remove just 's'
      // Example: paquetes→paquete, nombres→nombre (stem "nombr" ignored, ends in 'r')
      // Wait: nombres → stem="nombr" ends in 'r' (consonant) → falls through to next checks
      // This branch only fires when last char of stem is a vowel: paquetes→paquete ✓
      return word.slice(0, -1);
    }
    if (penultimate && !VOWELS.includes(penultimate)) {
      // Stem ends in consonant cluster (CC) → original stem ended in vowel → remove 's'
      // Example: cables="cabl" (last='l', penultimate='b' consonant) → "cable"
      //          muebles="muebl" (last='l', penultimate='b') → "mueble"
      //          nombres="nombr" (last='r', penultimate='b') → "nombre"
      return word.slice(0, -1);
    }
    // Stem ends in vowel+consonant → consonant-final-stem + 'es' → remove 'es'
    // Example: marcadores="marcador" (last='r', penultimate='o' vowel) → "marcador"
    //          hoteles="hotel" (last='l', penultimate='e' vowel) → "hotel"
    //          canales="canal" (last='l', penultimate='a' vowel) → "canal"
    return stem;
  }
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/**
 * Returns an array with the word + its singular form (if different).
 * Useful for matching both "cuadernos" and "cuaderno".
 * @param {string} word
 * @returns {string[]}
 */
function wordVariants(word) {
  const singular = toSingular(word);
  return singular !== word ? [word, singular] : [word];
}

export { normalize, toSingular, wordVariants };

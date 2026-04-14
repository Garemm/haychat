/**
 * src/services/intentService.js
 *
 * INTENT SERVICE — Keyword-based intent detection.
 *
 * Normalizes the incoming message (lowercase + strip accents) and compares it
 * against every keyword in intents.js.  Returns the matched intent key
 * (e.g. "horarios") or null if no intent is found.
 *
 * ADD NEW INTENTS: just add them to intents.js — no changes needed here.
 */

import intents from '../mockai/intents.js';

/**
 * Strips accents and lowercases a string so comparisons are accent-insensitive.
 * @param {string} text
 * @returns {string}
 */
function normalizeText(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Detects the intent of a user message by scanning for keyword matches.
 * @param {string} message  Raw message from the user.
 * @returns {string|null}   Intent key (e.g. "horarios") or null.
 */
function detectIntent(message) {
  if (!message) return null;

  const normalized = normalizeText(message);

  for (const [intentKey, intent] of Object.entries(intents)) {
    for (const keyword of intent.keywords) {
      if (normalized.includes(normalizeText(keyword))) {
        return intentKey;
      }
    }
  }

  return null;
}

export { detectIntent };

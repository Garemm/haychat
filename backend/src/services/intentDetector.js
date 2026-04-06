'use strict';

/**
 * src/services/intentDetector.js
 *
 * INTENT DETECTOR — Score-based intent detection.
 *
 * Replaces the old intentService.js which used simple `includes()` matching.
 *
 * HOW SCORING WORKS:
 *   1. The normalized message is tested against every keyword phrase in intents.js
 *   2. Each match adds the keyword's weight to that intent's total score
 *   3. The intent with the highest score wins — but only if it exceeds MIN_CONFIDENCE
 *   4. If two intents tie, the one with fewer total matches wins (more specific)
 *
 * WHY SCORING:
 *   - "tienen descuentos?" matches both "tienen" (ambiguous) and "descuentos" (promociones)
 *   - With scoring, "tienen descuentos" is a weight-3 phrase under promociones → wins clearly
 *   - A single ambiguous word "tienen" does NOT appear in any intent (by design)
 *
 * ADDING INTENTS: just edit intents.js — no changes needed here. Each new
 * intent key is automatically scanned by detectIntent().
 */

const intents = require('../mockai/intents');
const { normalize } = require('./normalize');

/** Minimum score for an intent to be considered detected. */
const MIN_CONFIDENCE = 1;

/**
 * High-priority pre-check patterns for the 'descripcion' intent.
 *
 * These run BEFORE keyword scoring to avoid substring collisions:
 *   "que tienes".includes("que tiene") === true  → scoring alone would
 *   incorrectly route catalog questions to 'descripcion'.
 *
 * Rules:
 *  - "que + verb (3rd sg.)"  → descripcion  ONLY when an object follows.
 *    Bare "que tiene?" / "que tienen?" (= catalog) stay as 'productos'.
 *  - Plural forms (tienen, contienen, incluyen, traen) are covered too.
 *  - Articles los/las before the object are allowed: "que tienen los X".
 *
 * \b after the verb ensures "que tienes" is never matched (tienes ends in 's',
 * so \b sits between 's' and the next non-word char — but with [n]? the match
 * would stop at "tiene" leaving "s" attached, breaking the word boundary).
 */
const DESCRIPCION_PRIORITY_PATTERNS = [
  // singular/plural tiene/tienen + object (with optional article los/las/el/la)
  /\bque\s+tiene[n]?\b\s+(?:el\s+|la\s+|los\s+|las\s+)?\w/,
  // singular/plural contiene/contienen
  /\bque\s+contiene[n]?\b/,
  // singular/plural incluye/incluyen
  /\bque\s+incluye[n]?\b/,
  // singular/plural trae/traen
  /\bque\s+trae[n]?\b/,
  // singular/plural lleva/llevan ("lleva" = synonym for trae/incluye in food context)
  /\bque\s+lleva[n]?\b/,
  // "de que está hecho/hecha"
  /\bde\s+que\s+est[aá]\b.*\bhech[oa]\b/,
];

/**
 * Scores each intent against the normalized message and returns a map of
 * intent → score. Only intents with score > 0 are included.
 *
 * @param {string} normalizedText  Already normalized text.
 * @param {object} [intentsConfig] Custom intents config (for testing). Defaults to intents.js.
 * @returns {Record<string, number>}
 */
function scoreIntents(normalizedText, intentsConfig = intents) {
  const scores = {};

  for (const [intentKey, intent] of Object.entries(intentsConfig)) {
    let totalScore = 0;

    for (const { phrase, weight } of intent.keywords) {
      const normalizedPhrase = normalize(phrase);
      if (normalizedText.includes(normalizedPhrase)) {
        totalScore += weight;
      }
    }

    if (totalScore > 0) {
      scores[intentKey] = totalScore;
    }
  }

  return scores;
}

/**
 * Detects the intent with the highest score from a user message.
 *
 * @param {string} message         Raw message from the user.
 * @param {object} [intentsConfig] Custom intents config (for testing).
 * @returns {{ intent: string|null, score: number, scores: Record<string, number>, confident: boolean }}
 */
function detectIntent(message, intentsConfig = intents) {
  if (!message) return { intent: null, score: 0, scores: {}, confident: false };

  const normalizedText = normalize(message);

  // High-priority pre-check: "que + verb(3rd sg.)" → 'descripcion'
  // Must run BEFORE scoring to avoid "que tienes".includes("que tiene") collision.
  for (const pattern of DESCRIPCION_PRIORITY_PATTERNS) {
    if (pattern.test(normalizedText)) {
      return { intent: 'descripcion', score: 5, scores: { descripcion: 5 }, confident: true };
    }
  }

  const scores = scoreIntents(normalizedText, intentsConfig);

  if (Object.keys(scores).length === 0) {
    return { intent: null, score: 0, scores, confident: false };
  }

  // Find the intent with the highest score
  let bestIntent = null;
  let bestScore = 0;

  for (const [intentKey, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestIntent = intentKey;
    }
  }

  const confident = bestScore >= MIN_CONFIDENCE;

  return {
    intent: confident ? bestIntent : null,
    score: bestScore,
    scores,
    confident,
  };
}

/**
 * Returns whether the given intent is standalone (doesn't needs entity context).
 * @param {string} intentKey
 * @param {object} [intentsConfig]
 * @returns {boolean}
 */
function isStandaloneIntent(intentKey, intentsConfig = intents) {
  return intentsConfig[intentKey]?.standalone === true;
}

module.exports = { detectIntent, scoreIntents, isStandaloneIntent, MIN_CONFIDENCE };

'use strict';

/**
 * src/services/aiDecisionEngine.js
 *
 * AI DECISION ENGINE — Determines whether a message should be handled by the
 * backend (deterministic NLP) or routed to OpenAI (future integration).
 *
 * RULES (in priority order):
 *   1. Backend can answer → NEVER use AI
 *   2. Context can resolve → NEVER use AI
 *   3. No relevant data in DB → NEVER use AI (nothing to augment)
 *   4. Long/complex/multi-intent messages → AI
 *   5. Low-confidence ambiguous messages → AI
 *   6. Recommendation/comparison requests → AI
 *
 * This module is a pure decision layer — it does NOT call OpenAI.
 * The pipeline consults this AFTER the deterministic layers fail.
 */

const { normalize } = require('./normalize');

/** Word count threshold for "long" messages. */
const LONG_MESSAGE_WORDS = 12;

/** If the message matches multiple intents with similar scores, it's multi-intent. */
const MULTI_INTENT_SCORE_GAP = 1;

/**
 * @typedef {'backend'|'ai'} AIRouting
 */

/**
 * @typedef {Object} AIDecision
 * @property {AIRouting} routing      - 'backend' or 'ai'
 * @property {string}    reason       - Human-readable reason
 * @property {string|null} aiCategory - Classification for RAG filter when routing=ai
 */

/**
 * Determines if the message needs AI or can be handled by the backend.
 *
 * Called ONLY when the main pipeline's decide() returns strategy='ai'.
 * At this point, no intent/entity was clearly detected.
 *
 * @param {string} normalizedText
 * @param {{ intent: string|null, score: number, scores: Record<string, number> }} intentResult
 * @param {{ type: string|null, value: string|null }} entityResult
 * @param {{ lastIntent: string|null, lastEntity: { type: string|null, value: string|null } }} context
 * @returns {AIDecision}
 */
function shouldUseAI(normalizedText, intentResult, entityResult, context) {
  // ── Guard: if backend already resolved, never use AI ──────────────────────
  if (intentResult.intent && intentResult.score >= 3) {
    return { routing: 'backend', reason: 'high-confidence intent detected', aiCategory: null };
  }

  // ── Check for explicit AI patterns FIRST — before entity/context guards ──
  // Recommendation/comparison requests must bypass entity detection because
  // "que me recomienda de postres?" detects "postres" as entity but the
  // question itself requires AI reasoning, not a catalog dump.

  // Recommendation requests
  const RECOMMEND_RE = /\b(?:recomiend[ao](?:s|me|n)?|recomendacion|sugier[eo]|sugerencia|que\s+me\s+recomienda[sn]?|que\s+(?:es|esta)\s+bueno|mejor\s+opcion|popular|favorito)\b/;
  if (RECOMMEND_RE.test(normalizedText)) {
    return { routing: 'ai', reason: 'recommendation request', aiCategory: 'recommendation' };
  }

  // Comparison requests
  const COMPARE_RE = /\b(?:compar[aeo]|diferencia|versus|vs|mejor\s+entre|cual\s+(?:es|conviene)\s+mejor|que\s+(?:es|conviene)\s+mejor|que\s+es\s+mejor)\b/;
  if (COMPARE_RE.test(normalizedText)) {
    return { routing: 'ai', reason: 'comparison request', aiCategory: 'comparison' };
  }

  // Superlative comparisons: "el/la más barato/a", "cuesta menos", "la mejor", "el mejor"
  // Catches: "que taco es el mas saludable", "que pizza es la mejor", "cual es la mejor pizza"
  const SUPERLATIVE_RE = /\bm[aá]s\s+(?:barat[ao]s?|car[ao]s?|econ[oó]mic[ao]s?|saludables?|buen[ao]s?|mal[ao]s?|populares?)|cuesta\s+menos|menos\s+car[ao]s?|\bel\s+m[aá]s\b|\bla\s+m[aá]s\b|\b(?:el|la|los|las)\s+mejor(?:es)?\b/;
  if (SUPERLATIVE_RE.test(normalizedText)) {
    return { routing: 'ai', reason: 'superlative comparison question', aiCategory: 'comparison' };
  }

  // Capacity / nutritional questions: "cuántos tacos puedo comer", "cuánto debo consumir"
  const CAPACITY_RE = /\bcu[aá]nto[as]?\b.{0,50}\b(?:puedo|debo|debería?|conviene|se\s+puede|se\s+recomienda)\b/;
  if (CAPACITY_RE.test(normalizedText)) {
    return { routing: 'ai', reason: 'nutritional/capacity question', aiCategory: 'open_query' };
  }

  // ── Guard: entity detected → deterministic backend can handle ─────────────
  if (entityResult.type && entityResult.value) {
    return { routing: 'backend', reason: 'entity detected by backend', aiCategory: null };
  }

  // ── Guard: context available for SHORT follow-up messages only ───────────
  // Complex questions must NOT be blocked by stale context (e.g. "que hamburguesa
  // es la mas barata" has 6 words and needs AI, not context reuse of "taco de canasta").
  const wordCount = normalizedText.split(/\s+/).length;
  if (context?.lastEntity?.value && context?.lastIntent && wordCount <= 4) {
    return { routing: 'backend', reason: 'context available for short follow-up', aiCategory: null };
  }

  // Subjective/opinion questions
  const OPINION_RE = /\b(?:opinion|que\s+(?:tal|opinas?|piensas?)|vale\s+la\s+pena|es\s+bueno|es\s+malo|merece|conviene)\b/;
  if (OPINION_RE.test(normalizedText)) {
    return { routing: 'ai', reason: 'opinion/subjective question', aiCategory: 'open_query' };
  }

  // Long messages (likely complex questions)
  if (wordCount >= LONG_MESSAGE_WORDS) {
    return { routing: 'ai', reason: `long message (${wordCount} words)`, aiCategory: 'open_query' };
  }

  // Multiple competing intents with close scores
  const scoreValues = Object.values(intentResult.scores);
  if (scoreValues.length >= 2) {
    const sorted = [...scoreValues].sort((a, b) => b - a);
    if (sorted[0] - sorted[1] <= MULTI_INTENT_SCORE_GAP && sorted[0] > 0) {
      return { routing: 'ai', reason: 'multiple competing intents', aiCategory: 'open_query' };
    }
  }

  // Low-confidence partial intent (0 < score < 3) — may benefit from AI interpretation
  if (intentResult.score > 0 && intentResult.score < 3 && !entityResult.value) {
    // Only route to AI if the message is moderately complex
    if (wordCount >= 5) {
      return { routing: 'ai', reason: 'low-confidence intent + moderate complexity', aiCategory: 'contextual' };
    }
  }

  // Default: for very short unknown messages, backend fallback is fine
  // (greetings, "ok", "gracias" handled by keywordResponses)
  return { routing: 'backend', reason: 'simple/short message — backend fallback sufficient', aiCategory: null };
}

/**
 * Checks whether there's enough data to justify an AI call.
 * If the DB has no relevant data, AI won't produce a useful answer.
 *
 * @param {{ type: string, data: object[], total: number }} ragContext
 * @returns {boolean}
 */
function hasRelevantData(ragContext) {
  return ragContext.type !== 'empty' && ragContext.data.length > 0;
}

module.exports = {
  shouldUseAI,
  hasRelevantData,
  LONG_MESSAGE_WORDS,
  MULTI_INTENT_SCORE_GAP,
};

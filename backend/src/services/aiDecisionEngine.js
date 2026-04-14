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

import { normalize } from './normalize.js';

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
  // ── Check for explicit AI patterns FIRST — before ALL guards ─────────────
  // RECOMMEND_RE, COMPARE_RE and SUPERLATIVE_RE take absolute priority because
  // 'dame' / 'quiero una' score 3 on the comprar intent yet the message can
  // still be a recommendation or comparison ("dame una recomendacion",
  // "quiero una que sea la mas barata"). Moving only these three patterns
  // before the intent-score guard ensures they are never blocked.
  // CAPACITY_RE and PRODUCT_DESC_RE stay after the guard because they
  // match verb forms that descripcion intent also scores ≥ 3 on ("que tiene",
  // "que contiene") — moving them would route deterministic descripcion
  // queries to AI unnecessarily.

  // Recommendation requests (includes infinitive "recomendar" and modal "puedes/puede recomendar")
  const RECOMMEND_RE = /\b(?:recomendar|recomiend[ao](?:s|me|n)?|recomendacion|sugier[eo]|sugerencia|que\s+me\s+recomienda[sn]?|que\s+(?:es|esta)\s+bueno|mejor\s+opcion|popular|favorito|(?:puedes?|puede|pueden|podr[ií]as?)\s+recomendar)\b/;
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

  // ── Guard: if backend already resolved, never use AI ──────────────────────
  // Placed AFTER the three AI-override patterns above so that a high-confidence
  // comprar intent (score=3 via 'dame') never blocks a recommendation or
  // comparison signal.
  if (intentResult.intent && intentResult.score >= 3) {
    return { routing: 'backend', reason: 'high-confidence intent detected', aiCategory: null };
  }

  // Capacity / nutritional questions: "cuántos tacos puedo comer", "cuánto debo consumir"
  const CAPACITY_RE = /\bcu[aá]nto[as]?\b.{0,50}\b(?:puedo|debo|debería?|conviene|se\s+puede|se\s+recomienda)\b/;
  if (CAPACITY_RE.test(normalizedText)) {
    return { routing: 'ai', reason: 'nutritional/capacity question', aiCategory: 'open_query' };
  }

  // Ingredient/content descriptive questions: "la quesadilla tiene queso?", "lleva carne?", "contiene gluten?"
  // These are yes/no descriptive questions about a product, not catalog searches.
  //
  // Guard: if the availability verb is at the START or END of the message, it is an
  // availability/catalog query — NOT an ingredient question — skip AI routing.
  //   START: "tienes hamburguesas?"       → availability
  //   END:   "que tipos de hamburguesa tiene?" → catalog  (verb trails after entity)
  //   END:   "que hamburguesas tienen?"   → catalog
  // In contrast, "la quesadilla tiene queso?" has "tiene" in the MIDDLE (not at start/end),
  // so it is correctly treated as an ingredient description and routed to AI.
  const PRODUCT_DESC_RE = /\b(?:tiene[ns]?|lleva[ns]?|contiene[ns]?|incluye[ns]?|trae[ns]?|viene[ns]?\s+con|es\s+con|viene\s+con)\b/;
  const AVAIL_VERB_RE   = /^(?:tienes?|tienen|hay)\s+|(?:tiene[sn]?|tienen|hay)\s*\??$|\bsi\s+(?:tienes?|tienen|hay)\b/;
  if (!AVAIL_VERB_RE.test(normalizedText) && PRODUCT_DESC_RE.test(normalizedText)) {
    return { routing: 'ai', reason: 'product description/ingredient question', aiCategory: 'open_query' };
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

export {
  shouldUseAI,
  hasRelevantData,
  LONG_MESSAGE_WORDS,
  MULTI_INTENT_SCORE_GAP,
};

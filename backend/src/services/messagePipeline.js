'use strict';

/**
 * src/services/messagePipeline.js
 *
 * DECISION PIPELINE — Orchestrates intent detection, entity extraction,
 * context resolution, and response generation.
 *
 * PIPELINE ORDER:
 *   1. normalize(message)
 *   2. intent  = detectIntent(message)
 *   3. entity  = detectEntities(message, businessId, intentResult)
 *   4. context = getContext(sessionId)
 *   5. decision = decide(intent, entity, context, message)
 *   6. execute decision → generate response
 *   7. updateContext(sessionId, ...)
 *
 * DECISION RULES (CORE):
 *   1. If intent is HIGH confidence (score ≥ 3) AND standalone → use intent alone
 *   2. If entity detected clearly → use entity (ignore context)
 *   3. If intent detected + entity from context → combine
 *   4. If message is ambiguous → use context
 *   5. Else → fallback to AI
 *
 * KEY RULE: clear entity in message → NEVER use context.
 *           clear intent in message → IGNORE previous context entity.
 */

import { normalize } from './normalize.js';
import { preprocessMessage, detectNegation } from './textPreprocessor.js';
import { detectIntent, isStandaloneIntent } from './intentDetector.js';
import { detectEntities, queryProducts, queryCategories, formatProductResponse, formatPartialMatchResponse } from './entityDetector.js';
import { getSynonymsAcrossCategories, getSynonymsByBusinessId } from './synonyms.js';
import { detectDay } from './dayDetector.js';
import { getContext, updateContext } from './sessionContextService.js';
import { pushTurnMemory, addRejectedEntity } from './redisService.js';
import { parseMultiIntent, joinResponses } from './multiIntentParser.js';
import { logProductQuery } from './queryLogService.js';
import {
  getBusinessInfoByIntent,
  getHorariosByDay,
  getCategories,
  getProductosByCategory,
  countProductosByCategory,
  getProductAttributes,
  getServiceByName,
} from './businessInfoService.js';
import { formatIntentResponse, formatHorarioDay, formatList, formatDescripcionResponse, formatProductAttributes, formatServiceDetail, formatServiceWithContact } from './intentResponseFormatter.js';
import { getKeywordResponse } from '../mockai/keywordResponses.js';
import { getMockOpenAIResponse } from '../temp/mockOpenAI.js';
import { shouldUseAI } from './aiDecisionEngine.js';
import { handleAIGate } from './subscriptionController.js';
import { searchByAttributes, searchByCompoundQuery, searchByCategoryAttribute, formatAttributeResponse, formatCompoundQueryResponse, formatCategoryAttributeResponse } from './attributeSearchService.js';
import { extractAttribute } from './attributeExtractor.js';

/** Minimum score to consider intent as "high confidence" (skip context). */
const HIGH_CONFIDENCE_THRESHOLD = 3;

/** Max products to show in one turn before asking user to narrow down. */
const PRODUCTS_HARD_LIMIT = 20;

/** Products per paginated page inside a category. */
const PAGE_SIZE = 10;

/**
 * Genuinely standalone comprar phrases — they express purchase intent WITHOUT
 * needing a product in context (no pronouns like "lo", "la", "me lo", etc.).
 * Used by Rule -1d to distinguish real purchase queries from post-result
 * pronouns like "quiero una" / "me lo llevo" that refer to a previous product.
 */
const COMPRAR_GENUINELY_STANDALONE = [
  'quiero comprar', 'como puedo comprar', 'como compro', 'donde puedo comprar',
  'quiero hacer un pedido', 'como hago un pedido', 'como puedo pedir',
  'quiero ordenar', 'como ordeno', 'quiero adquirir', 'como lo adquiero',
  'puedo comprar en linea', 'tienen tienda en linea', 'venden en linea',
  'hacer pedido', 'realizar pedido', 'realizar compra', 'comprar en linea',
  'tienda en linea', 'quiero pedirlo',
];

/**
 * Regex patterns that signal "I want to buy the PREVIOUSLY mentioned product".
 * These are pronoun-based purchase phrases — they don't name a product;
 * they refer anaphorically to the product confirmed in context.
 *
 * All patterns are tested on already-normalised text (accents stripped, lowercase).
 * Rule 4.9 in decide() uses these to route to 'comprar_context' before
 * extractFollowUpEntity() can misinterpret the phrase as a product name.
 */
const COMPRAR_PRONOUN_PATTERNS = [
  /\bme\s+gustaria\b/,                         // "me gustaria pedir una"
  /\bquisiera\b/,                               // "quisiera pedirlo"
  /\bme\s+l[ao]\s+llevo\b/,                    // "me lo/la llevo"
  /\bl[ao]\s+quiero\b/,                         // "lo/la quiero"
  /\bquiero\s+(?:un[oa]|ese|esa)\b/,           // "quiero una" / "quiero ese"
  /\bdame(?:lo|la|me)?\s*(?:un[oa])?\b/,       // "damelo" / "dame una"
  /\bdeme\s+(?:un[oa])\b/,                      // "deme uno/una"
  /\bvoy\s+a\s+compr[ao]r(?:lo|la)?\b/,       // "voy a comprarlo"
  /\bcompr[ao]r(?:lo|la)\b/,                   // "comprarlo" / "comprarla"
  /\bpedir(?:lo|la)\b/,                         // "pedirlo" / "pedirla"
  /\bl[ao]\s+pido\b/,                           // "lo pido" / "la pido"
  /\bme\s+lo\s+das\b|\bme\s+la\s+das\b/,      // "me lo das" / "me la das"
];

// ─── Pagination / category navigation helpers ─────────────────────────────────

/** Patterns that mean "show me next page". */
const SEE_MORE_PATTERNS = [
  /^ver mas$/,
  /^mas$/,
  /^siguiente$/,
  /^siguiente pagina$/,
  /^mas productos$/,
  /^mas resultados$/,
  /^continuar$/,
  /^mas opciones$/,
  // "otras mas" / "otros mas" — colloquial "show me more (of the others)"
  /^otras?\s+mas$/,
  /^otras?\s+opciones$/,
  /^ver\s+otras?$/,
  /^otras?\s+mas\s+opciones$/,
];

function isSeekingMore(normalizedText) {
  return SEE_MORE_PATTERNS.some((p) => p.test(normalizedText));
}

/**
 * Normalizes a string for loose category matching (removes accents, lowercase).
 * @param {string} s
 * @returns {string}
 */
function normalizeForMatch(s) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Returns the original category name from availableCategories that best matches
 * the user's message, or null if no match found.
 *
 * Uses the same normalization as the main pipeline so punctuation/accents are
 * handled consistently. Matches in BOTH directions:
 *   - forward:  user text contains the category name  ("quiero ver bebidas" → "Bebidas")
 *   - reverse:  category name contains the user text   ("Bebidas Calientes" ← "bebidas")
 *
 * Sorting by descending name length ensures the most-specific category wins
 * when two categories could match (e.g. "Pizzas" vs "Pizzas Especiales").
 *
 * @param {string}   normalizedText        Already preprocessed with preprocessMessage()
 * @param {string[]} availableCategories
 * @returns {string|null}
 */
function detectCategorySelection(normalizedText, availableCategories) {
  if (!availableCategories || availableCategories.length === 0) return null;

  // Sort longest category first so "Pizzas Especiales" beats "Pizzas" on exact matches
  const sorted = [...availableCategories].sort((a, b) => b.length - a.length);

  for (const cat of sorted) {
    // Use full normalize() — same pipeline as preprocessMessage — so punctuation
    // and accents are stripped identically on both sides.
    const catNorm = normalize(cat);
    if (normalizedText.includes(catNorm) || catNorm.includes(normalizedText)) {
      return cat;
    }
  }
  return null;
}

/**
 * Formats the "too many results" pivot response that prompts for a category.
 * @param {string[]} categories
 * @returns {string}
 */
function formatCategoryPrompt(categories) {
  if (!categories || categories.length === 0) {
    return 'Tenemos muchos productos disponibles. ¿Buscas algo en particular?';
  }
  const shown  = categories.slice(0, 4);
  const listed = shown.join(', ');
  const more   = categories.length > 4 ? ', entre otras' : '';
  return `Tenemos muchos productos disponibles. Puedes buscar por categoría, como ${listed}${more}. ¿Cuál te interesa?`;
}

/**
 * Formats a paginated product slice.
 * @param {object[]} rows      Current page rows
 * @param {number}   offset    Current offset
 * @param {number}   total     Total count in category
 * @param {string}   category  Category display name
 * @returns {string}
 */
function formatProductPage(rows, offset, total, category) {
  const end       = offset + rows.length;
  const remaining = total - end;
  const items     = rows.map((r) =>
    r.is_available !== false
      ? `${r.name} a $${Number(r.price).toFixed(2)}`
      : `${r.name} (no disponible)`
  );
  // natural comma list
  const listed = items.length > 1
    ? `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`
    : items[0];
  const base = `😊 Aquí tienes productos de ${category}: ${listed}.`;
  if (end < total) {
    return `${base} Hay ${remaining} más. Escribe "ver más" para continuar.`;
  }
  return `${base} Eso es todo en esta categoría.`;
}

/**
 * Friendly response when user selects a category from the prompted list.
 * Shows up to PAGE_SIZE items in a conversational tone.
 */
function formatCategorySelectionResponse(category, rows, offset, total) {
  const end       = offset + rows.length;
  const remaining = total - end;
  const items     = rows.map((r) =>
    r.is_available !== false
      ? `${r.name} a $${Number(r.price).toFixed(2)}`
      : `${r.name} (no disponible)`
  );
  const listed = items.length > 1
    ? `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`
    : items[0];
  const intro = `😊 ¡Claro! En ${category} tenemos: ${listed}.`;
  if (end < total) {
    return `${intro} Hay ${remaining} más, escribe "ver más" para continuar.`;
  }
  return `${intro} Eso es todo en esta categoría. ¿Te interesa alguno en especial?`;
}

/**
 * Extracts a service name from a user query.
 * Handles patterns like "servicio de X", "servicio X", etc.
 * @param {string} normalizedText
 * @returns {string|null}
 */
function extractServiceQuery(normalizedText) {
  const patterns = [
    // Explicit "servicio de X" / "servicio X"
    /\bservicios?\s+de\s+(.+?)(?:\?|$)/,
    /\bservicios?\s+(.+?)(?:\?|$)/,
    // Price/cost queries about a service: "que precio tiene la renta de salon para eventos"
    /\bque\s+(?:precio|costo|valor|tarifa|cuesta|cobran?)\s+(?:tiene[ns]?|es|cobran?|hay)?\s*(?:el\s+|la\s+|los\s+|las\s+|un\s+|una\s+)?(.+?)(?:\?|$)/,
    // "cuanto cuesta/vale/cobran [por] X"
    /\bcuanto\s+(?:cuesta[n]?|vale[n]?|cobran?(?:\s+por)?)\s+(?:el\s+|la\s+|los\s+|las\s+|un\s+|una\s+)?(.+?)(?:\?|$)/,
    // "en cuanto tiene/tienes/tienen X" / "a cuanto tiene X" — Mexican Spanish price query
    /\b(?:en|a)\s+cuanto\s+tiene[sn]?\s+(?:el\s+|la\s+|los\s+|las\s+|un\s+|una\s+)?(.+?)(?:\?|$)/,
    // Description queries about a service: "que incluye/contiene/trae/lleva/es X"
    // Strip the verb phrase to get just the service-name portion.
    /\bque\s+(?:incluye[n]?|contiene[n]?|trae[n]?|lleva[n]?|es|son)\s+(?:el\s+|la\s+|los\s+|las\s+|un\s+|una\s+)?(.+?)(?:\?|$)/,
    // "informacion sobre/de X" / "sobre X" / "acerca de X"
    /\binformacion\s+(?:(?:sobre|acerca\s+de|de)\s+)?(?:el\s+|la\s+|los\s+|las\s+)?(.+?)(?:\?|$)/,
    /^(?:sobre|acerca\s+de)\s+(?:el\s+|la\s+|los\s+|las\s+)?(.+?)(?:\?|$)/,
    // Conjunction-prefix follow-up: "y la renta de salon", "y el menu especial"
    // These are continuation turns where the user appends "y [el/la]" to name a service.
    /^(?:y|e)\s+(?:el\s+|la\s+|los\s+|las\s+|un\s+|una\s+)?(.+?)(?:\?|$)/,
  ];
  for (const p of patterns) {
    const m = normalizedText.match(p);
    if (m?.[1]) {
      // Keep 'de' — service names often contain it (e.g. "alquiler de herramientas").
      // Only strip leading articles/pronouns that are never part of a service name.
      const candidate = m[1]
        .replace(/^(?:el|la|los|las|un|una)\s+/, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (candidate.length >= 2) return candidate;
    }
  }
  return null;
}

// ─── Ambiguity detection ──────────────────────────────────────────────────────

/**
 * Patterns that indicate an ambiguous / follow-up message.
 * These messages can't stand alone — they need context.
 */
const AMBIGUOUS_PATTERNS = [
  /^si$/,
  /^no$/,
  /^ok$/,
  /^ya$/,
  /^y eso$/,
  /^y esos$/,
  /^y esas$/,
  /^hay mas$/,
  /^tiene[ns]? mas$/,
  /^cuanto cuesta$/,     // without product = ambiguous
  /^cuanto vale$/,
  /^cuanto sale$/,
  /^en cuanto esta$/,
  /^y precio$/,
  /^y el precio$/,
  /^y precios$/,         // plural — "¿Y precios?" after product context
  /^y la promo$/,
  /^y las promos$/,
  /^y promociones$/,
  /^esta disponible$/,
  /^hay stock$/,
  /^que mas tienen$/,
  /^alguna otra cosa$/,
  /^algo mas$/,
  /^me das mas info$/,
  /^mas informacion$/,
  /^y la garantia$/,
  /^y envian$/,
  /^que incluye$/,
];

/**
 * Determines if a message is ambiguous and needs context to be understood.
 *
 * @param {string} normalizedText
 * @returns {boolean}
 */
function isAmbiguous(normalizedText) {
  if (normalizedText.length <= 3) return true; // Very short messages are ambiguous
  return AMBIGUOUS_PATTERNS.some((p) => p.test(normalizedText));
}

// ─── Follow-up product extraction ─────────────────────────────────────────────

const QUESTION_WORDS = new Set([
  'cuanto', 'cuanta', 'cuantos', 'cuantas',
  'cuando', 'donde', 'como', 'cual', 'cuales', 'quien',
  'que', 'precio', 'costo',
]);

/**
 * Extracts a product entity from follow-up messages in an active product context.
 * Handles two shapes:
 *   1. "¿Y pizza mexicana?" — starts with "y"
 *   2. Bare noun phrase — 2-5 tokens, no question or verb words
 *      e.g. "pizza mexicana", "pizza bbq al pastor"
 *
 * Only active when there's a lastEntity in context (product-track).
 *
 * @param {string} normalizedText
 * @param {{ value: string|null, type: string|null }} lastEntity
 * @returns {string|null}
 */
/**
 * If a follow-up candidate starts with a preposition ("de", "del", "con", "al"),
 * reconstruct the full entity by prepending the base word from context.
 *
 * Example: lastEntityValue="agua de limon", candidate="de jamaica" → "agua de jamaica"
 * Example: lastEntityValue="tacos al pastor", candidate="al carbon" → "tacos al carbon"
 *
 * @param {string} candidate       Raw extracted follow-up candidate
 * @param {string} contextValue    lastEntity.value from context
 * @returns {string}
 */
function enrichFollowUpCandidate(candidate, contextValue) {
  const PREP_PREFIX = /^(?:de[l]?|con|en|al|a)\s+/;
  if (!PREP_PREFIX.test(candidate) || !contextValue) return candidate;

  // "del X" — contracted de+el — the candidate IS a standalone product reference
  // (e.g. "del agua de jamaica" → "agua de jamaica").
  // Never prepend the context entity; just strip the contracted article.
  if (/^del\s+/.test(candidate)) {
    return candidate.replace(/^del\s+/, '');
  }

  // Extract base of context entity (everything before the first preposition)
  const baseMatch = contextValue.match(/^(.+?)\s+(?:de[l]?|con|en|al|a)\s+/);
  if (baseMatch?.[1]) {
    return `${baseMatch[1]} ${candidate}`;
  }
  // contextValue is a simple noun with no preposition.
  // "con ..." is always an attribute qualifier → prepend the base automatically.
  //   e.g. lastEntity="hamburguesa", candidate="con queso" → "hamburguesa con queso"
  // "de/del/al/en/a ..." can be a standalone product-name prefix (e.g. "agua de jamaica")
  //   → leave the candidate as-is so the DB lookup can match it directly.
  if (/^con\s+/.test(candidate)) {
    return `${contextValue} ${candidate}`;
  }
  return candidate;
}

function extractFollowUpEntity(normalizedText, lastEntity) {
  if (!lastEntity?.value) return null;

  // Articles that should never be the first word of an entity name.
  const LEAD_ARTICLES = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas']);

  /**
   * Strips a leading article/preposition from an extracted candidate string.
   * "la pizza mexicana" → "pizza mexicana"
   * "los tacos" → "tacos"
   */
  function stripLeadingArticle(text) {
    const parts = text.trim().split(/\s+/);
    let i = 0;
    while (i < parts.length - 1 && LEAD_ARTICLES.has(parts[i])) i++;
    return parts.slice(i).join(' ');
  }

  // Shape 1a: "y pizza mexicana" / "y la pizza mexicana" — starts with "y"
  const matchY = normalizedText.match(/^y\s+(?<entity>[\w\s]+?)$/);
  if (matchY?.groups?.entity) {
    const candidate = stripLeadingArticle(matchY.groups.entity.trim());
    if (candidate.length >= 2 && !candidate.split(/\s+/).some((w) => QUESTION_WORDS.has(w))) {
      return enrichFollowUpCandidate(candidate, lastEntity.value);
    }
  }

  // Shape 1b: starts with "tambien / igual / otro / otra" (+ optional article)
  const matchTrigger = normalizedText.match(
    /^(?:tambien|igual|otro|otra|tb|tmb)\s+(?:el\s+|la\s+|los\s+|las\s+|un\s+|una\s+)?(?<entity>[\w\s]+?)$/
  );
  if (matchTrigger?.groups?.entity) {
    const candidate = stripLeadingArticle(matchTrigger.groups.entity.trim());
    if (candidate.length >= 2 && !candidate.split(/\s+/).some((w) => QUESTION_WORDS.has(w))) {
      return enrichFollowUpCandidate(candidate, lastEntity.value);
    }
  }

  // Shape 2: bare noun phrase (2-5 tokens, no question/meta/verb words)
  // Catches "pizza mexicana", "la pizza mexicana" when user refines a product search.
  // Leading articles are stripped so "la pizza mexicana" → "pizza mexicana".
  const BARE_SKIP = new Set([
    ...QUESTION_WORDS,
    'hay', 'tienen', 'tienes', 'tiene', 'venden', 'vende', 'vendes',
    'busco', 'quiero', 'necesito', 'existen', 'existe', 'ofrecen', 'ofrece',
    'si', 'no', 'ok', 'ya', 'hola', 'gracias', 'buenas', 'saludos',
    // Follow-up trigger words — excluded so Shape 2 doesn't include them in the entity
    'tambien', 'igual', 'otro', 'otra', 'tb', 'tmb',
    // Purchase-action verbs — these signal intent to BUY, never appear as product names.
    // Without this guard, "me gustaria pedir una" would be extracted as a product name.
    'pedir', 'ordenar', 'comprar', 'adquirir',
    // Purchase imperative commands — "dame una X", "trae un X", "pedi una X" include
    // the product name BUT also the imperative verb; treat the whole phrase as intent,
    // not as a bare product follow-up. Entity extraction handled via PRODUCT_QUERY_PATTERNS.
    'dame', 'trae', 'traeme', 'pedi',
    // Modal desire words — similarly anaphoric, never product names
    'gustaria', 'quisiera',
    // Reflexive purchase tokens
    'llevarme', 'quedarme',
    // Copula verb forms — "es natural?", "están frescos?" are yes/no questions about the
    // current context product, not product-name candidates.
    'es', 'estan',
    // Continuation / pagination words — "otras mas", "mas", "otras" are never product names.
    // "otras mas" means "show me more"; letting it through stores a corrupted entity.
    'otras', 'otros', 'mas',
  ]);
  const tokens = normalizedText.split(/\s+/);
  // Allow leading articles in the token count — they'll be stripped after the check.
  const meaningfulTokens = tokens.filter((t) => !LEAD_ARTICLES.has(t));
  if (tokens.length >= 2 && tokens.length <= 6 && meaningfulTokens.length >= 1) {
    if (!tokens.some((w) => BARE_SKIP.has(w)) && normalizedText.length >= 3) {
      const cleaned = stripLeadingArticle(normalizedText);
      if (cleaned.length >= 2) {
        return enrichFollowUpCandidate(cleaned, lastEntity.value);
      }
    }
  }

  return null;
}

// ─── Product attribute inclusion check ──────────────────────────────────────

/**
 * Intent-domain words that, when appearing as the queried attribute, signal a
 * known business-info intent rather than a product attribute.
 * Prevents "la tienda tiene promociones?" from triggering product_attr_check.
 */
const INTENT_DOMAIN_ATTR_WORDS = new Set([
  'promociones', 'descuentos', 'descuento', 'promocion',
  'horario', 'horarios', 'precio', 'precios', 'costo', 'costos',
  'ubicacion', 'ubicaciones', 'direccion',
  'contacto', 'telefono', 'correo',
  'servicios', 'servicio',
  'catalogo', 'menu', 'carta',
]);

/**
 * Detects yes/no attribute-inclusion patterns:
 *   "la pizza hawaiana incluye jamón?"    → { product: "pizza hawaiana", askedAttribute: "jamon" }
 *   "sopa de tortillas lleva crema?"      → { product: "sopa de tortillas", askedAttribute: "crema" }
 *   "Michelada tiene limón?"              → { product: "michelada", askedAttribute: "limon" }
 *
 * NOT matched:
 *   "que incluye la pizza hawaiana?"      → open-ended description (starts with "que")
 *   "algo con jamón?"                     → attribute search (has "algo")
 *   "tiene promociones?"                  → intent-domain attr blocked
 *
 * @param {string} normalizedText  Already preprocessed text
 * @returns {{ product: string, askedAttribute: string }|null}
 */
function detectProductAttributeCheck(normalizedText) {
  // Skip open-ended question starters ("que incluye X?" = "what does X have?")
  if (/^(?:que|cual|cuales|cuando|donde|como)\s/.test(normalizedText)) return null;
  // Skip generic attribute searches ("algo con X", "hay algo con X")
  if (/\balgo\b/.test(normalizedText)) return null;

  // Pattern: [optional article] [product (1+ words)] [verb] [optional article] [attribute (1+ words)] [?]
  const ARTICLE    = '(?:el\\s+|la\\s+|los\\s+|las\\s+|un\\s+|una\\s+)?';
  const VERB_GROUP = '(?:incluye[n]?|contiene[n]?|trae[n]?|lleva[n]?|tiene[n]?)';
  const WORD_SEQ   = '[\\wñ]+(?:\\s+[\\wñ]+)*?';
  const WORD_SEQ_E = '[\\wñ]+(?:\\s+[\\wñ]+)*';
  const pattern = new RegExp(
    `^${ARTICLE}(?<product>${WORD_SEQ})\\s+${VERB_GROUP}\\s+${ARTICLE}(?<attr>${WORD_SEQ_E})\\s*\\??$`
  );

  const m = normalizedText.match(pattern);
  if (!m?.groups?.product || !m?.groups?.attr) return null;

  const product = m.groups.product.trim();
  const attr    = m.groups.attr.trim();

  if (product.length < 2 || attr.length < 2) return null;

  // Don't trigger when the attribute is an intent-domain keyword
  if (INTENT_DOMAIN_ATTR_WORDS.has(attr)) return null;

  return { product, askedAttribute: attr };
}

// ─── Decision engine ──────────────────────────────────────────────────────────

/**
 * @typedef {Object} PipelineDecision
 * @property {'intent'|'entity'|'context'|'followup'|'ai'} strategy
 * @property {string|null} intent
 * @property {{ type: string|null, value: string|null }} entity
 * @property {boolean} usedContext
 * @property {string} reason
 */

/**
 * Makes the routing decision based on all available signals.
 *
 * @param {{ intent: string|null, score: number, scores: object, confident: boolean }} intentResult
 * @param {{ type: string|null, value: string|null, product: string|null, category: string|null, promotion: string|null }} entityResult
 * @param {{ lastIntent: string|null, lastEntity: { type: string|null, value: string|null } }} context
 * @param {string} normalizedText
 * @returns {PipelineDecision}
 */
function decide(intentResult, entityResult, context, normalizedText) {
  const hasIntent = intentResult.intent !== null;
  const hasEntity = entityResult.type !== null && entityResult.value !== null;
  const standalone = hasIntent && isStandaloneIntent(intentResult.intent);
  const highConfidence = intentResult.score >= HIGH_CONFIDENCE_THRESHOLD;

  // Rule -1a: User is paginating ("ver más") inside a category flow
  if (isSeekingMore(normalizedText) && context.paginationCategory) {
    return {
      strategy: 'pagination',
      intent: 'productos',
      entity: { type: null, value: null },
      usedContext: true,
      reason: 'pagination: next page requested',
    };
  }

  // Rule -1b: User is selecting a category from the prompted list
  const selectedCat = detectCategorySelection(normalizedText, context.availableCategories);
  if (selectedCat && context.lastIntent === 'category_selection') {
    return {
      strategy: 'category_select',
      intent: 'productos',
      entity: { type: 'category', value: selectedCat },
      usedContext: true,
      reason: `category selected: "${selectedCat}"`,
    };
  }

  // Rule -1c: Still in category_selection state but no match → re-prompt with list
  // Exceptions:
  //   1. Standalone intent (e.g. "que servicios tienen") — let through normally.
  //   2. Attribute entity detected (e.g. "tiene algo con pollo?") — skip re-prompt
  //      so the attribute search path handles it directly instead of looping.
  //   3. Product/category entity explicitly detected in the current message
  //      (e.g. "de casualidad tienes refresco?") — the user is asking about a
  //      specific item, not selecting from the category list; let Rule 2 handle it.
  const isAttributeEntity = entityResult.type === 'attribute';
  if (context.lastIntent === 'category_selection' && context.availableCategories?.length > 0 && !(hasIntent && standalone) && !isAttributeEntity && !hasEntity) {
    return {
      strategy: 'category_reprompt',
      intent: null,
      entity: { type: null, value: null },
      usedContext: true,
      reason: 'category_selection context: input not matched, re-prompting',
    };
  }

  // Rule -1d: Post-result pronoun purchase phrase after a failed product lookup.
  // Phrases like "quiero una", "me lo llevo", "lo quiero" use pronouns that refer
  // to a previously mentioned product. If the last search returned nothing, these
  // mean the user is asking for something that doesn't exist → surface a clear
  // "not available" response instead of routing to generic purchase contact info.
  //
  // Guard: skip when the current message explicitly names a NEW product entity
  // (e.g. "dame una pizza hawaiana" after a failed "hamburguesa doble" lookup).
  // In that case hasEntity=true and Rule 2 should handle it directly.
  if (
    intentResult.intent === 'comprar' &&
    context.lastEntityFound === false &&
    context.lastEntity?.value &&
    !hasEntity
  ) {
    const hasGenuinePhrase = COMPRAR_GENUINELY_STANDALONE
      .some((p) => normalizedText.includes(normalize(p)));
    if (!hasGenuinePhrase) {
      return {
        strategy: 'product_not_found_followup',
        intent: 'comprar',
        entity: { type: 'product', value: context.lastEntity.value },
        usedContext: true,
        reason: `comprar pronoun phrase but "${context.lastEntity.value}" was not found`,
      };
    }
  }

  // Rule -1e: Servicios context follow-up.
  // When the user saw a list of services and then types a follow-up (service name,
  // "que es X", "que incluye X", "informacion sobre X", bare name, etc.) route
  // straight to the servicios handler so it can do word-intersection matching.
  // Must be placed before Rule 1.5 (AI prescreen) so service-name queries are
  // never sent to the AI fallback.
  //
  // Intercepts when:
  //   - lastIntent is 'servicios'
  //   - no product/category entity was cleanly detected (attribute entities in a
  //     services context are almost always fragments of a service name, not product
  //     attributes — e.g. "renta de salón para eventos" → attribute="eventos")
  //   - no standalone intent at any confidence was detected (standalone intents like
  //     horarios/ubicacion/promociones always represent a genuine topic change and
  //     must never be overridden by the services context)
  //   - not a high-confidence 'productos' intent — "que venden?" / "que productos tiene?"
  //     are unambiguous topic changes to the product catalog
  //   - not an attribute entity (ingredient/property) with no detectable service query —
  //     e.g. "tiene algo con pollo?" has attribute entity but refers to a product, not a service
  //   - message is not purely ambiguous and has enough text to match against
  if (
    context.lastIntent === 'servicios' &&
    !(entityResult.type === 'product' && entityResult._rows?.length > 0) &&
    entityResult.type !== 'category' &&
    !(hasIntent && standalone) &&
    !(intentResult.intent === 'productos' && highConfidence) &&
    !(entityResult.type === 'attribute' && !extractServiceQuery(normalizedText)) &&
    !isAmbiguous(normalizedText) &&
    normalizedText.length >= 3
  ) {
    return {
      strategy: 'servicios_followup',
      intent: 'servicios',
      entity: { type: null, value: null },
      usedContext: true,
      reason: 'servicios context follow-up: matching message against service names',
    };
  }

  // Rule 0: Day-of-week entity detected → always horarios, never needs context
  if (entityResult.type === 'day') {
    return {
      strategy: 'entity',
      intent: 'horarios',
      entity: { type: 'day', value: entityResult.value, dayOfWeek: entityResult.dayOfWeek },
      usedContext: false,
      reason: `day "${entityResult.value}" detected → horarios`,
    };
  }

  // Rule 0b: Purchase-pronoun + confirmed context product beats high-confidence
  // standalone 'comprar' routing. Phrases like "quiero una", "quiero ese",
  // "lo quiero" score as comprar at weight 3 (highConfidence=true) and would
  // fire Rule 1 BEFORE Rule 4.9 can intercept them. Pre-empt Rule 1 here so
  // the purchase form is shown for the confirmed product instead of generic
  // comprar info.
  if (
    !hasEntity &&
    intentResult.intent === 'comprar' &&
    context.lastEntity?.type === 'product' &&
    context.lastEntity?.value &&
    context.lastEntityFound !== false &&
    COMPRAR_PRONOUN_PATTERNS.some((p) => p.test(normalizedText))
  ) {
    return {
      strategy:    'comprar_context',
      intent:      'comprar',
      entity:      { type: context.lastEntity.type, value: context.lastEntity.value },
      usedContext: true,
      reason:      `purchase pronoun + confirmed product "${context.lastEntity.value}" [pre-Rule1]`,
    };
  }

  // Rule 1.5: AI pre-screen — must run BEFORE the high-confidence intent guard so
  // recommendation/comparison/superlative signals always win, even when a standalone
  // intent fires first.
  //
  // Example: "recomiendame algo rico" scores 3 on the 'comprar' intent (substring
  // "dame" is inside "recomiendame") which would otherwise trigger Rule 1 and return
  // strategy='intent'. The pre-screen intercepts first via RECOMMEND_RE.
  //
  // "que me recomienda de postres?" detects entity "postres" but user wants
  // AI reasoning, not a raw catalog. Ask shouldUseAI with the real entity so
  // the decision engine can bypass the entity guard for recommendation/comparison.
  const aiPrescreen = shouldUseAI(normalizedText, intentResult, entityResult, context);
  if (aiPrescreen.routing === 'ai') {
    return {
      strategy: 'ai',
      intent: null,
      entity: { type: null, value: null },
      usedContext: false,
      reason: `AI pre-screen: ${aiPrescreen.reason}`,
    };
  }

  // Rule 1: High-confidence standalone intent → use intent alone, ignore everything
  // (only reached when the AI pre-screen above determined backend is sufficient)
  if (hasIntent && standalone && highConfidence) {
    return {
      strategy: 'intent',
      intent: intentResult.intent,
      entity: { type: null, value: null },
      usedContext: false,
      reason: `standalone intent "${intentResult.intent}" score=${intentResult.score}`,
    };
  }

  // Rule 1.6: Product attribute inclusion check — "does [product] include/have [attr]?"
  // Intercepts yes/no questions like "la pizza hawaiana incluye jamón?" BEFORE the
  // attribute entity path (Rule 1.7) misroutes them as attribute searches, and BEFORE
  // Rule 2 treats the ingredient as a product name to look up.
  // Placed after AI prescreen and high-confidence standalone intent so those win first.
  const attrCheck = detectProductAttributeCheck(normalizedText);
  if (attrCheck) {
    return {
      strategy:    'product_attr_check',
      intent:      'descripcion',
      entity:      { type: 'product', value: attrCheck.product, askedAttribute: attrCheck.askedAttribute },
      usedContext: false,
      reason:      `product attr check: "${attrCheck.product}" ¿tiene "${attrCheck.askedAttribute}"?`,
    };
  }

  // Rule 1.7: Attribute entity → always route to attribute search (no AI needed)
  if (entityResult.type === 'attribute') {
    return {
      strategy: 'attribute',
      intent: 'productos',
      entity: {
        type: 'attribute',
        value: entityResult.value,
        attributeType: entityResult.attributeType,
        // Compound query fields (present only for "entity de attribute" patterns)
        entityTerm: entityResult.entityTerm ?? null,
        attributeTerm: entityResult.attributeTerm ?? null,
        categoryTerm: entityResult.categoryTerm ?? null,
      },
      usedContext: false,
      reason: `attribute detected: "${entityResult.value}" (${entityResult.attributeType})`,
    };
  }

  // Rule 1.8: Service entity detected → route directly to servicios handler
  if (entityResult.type === 'service') {
    return {
      strategy: 'entity',
      intent: 'servicios',
      entity: { type: 'service', value: entityResult.value },
      usedContext: false,
      reason: `service entity detected: "${entityResult.value}"`,
    };
  }

  // Rule 2: Clear entity detected in message → use it directly, NO context
  if (hasEntity) {
    // If we also have an intent, combine them; otherwise infer 'productos' for product/category entities
    const effectiveIntent = hasIntent
      ? intentResult.intent
      : (entityResult.type === 'product' || entityResult.type === 'category')
        ? 'productos'
        : null;
    return {
      strategy: 'entity',
      intent: effectiveIntent,
      entity: { type: entityResult.type, value: entityResult.value },
      usedContext: false,
      reason: `entity detected: ${entityResult.type}="${entityResult.value}"`,
    };
  }

  // Rule 2.5: High-confidence general catalog query ("que productos tienes", "que vendes").
  // When the user explicitly asks for the full product list with a strong signal
  // (score >= HIGH_CONFIDENCE_THRESHOLD), this is a topic reset — never inherit
  // a stale context entity. Without this guard, Rule 3 would pull "pizza hawaiana"
  // from context and return that product's info instead of the catalog.
  if (hasIntent && intentResult.intent === 'productos' &&
      intentResult.score >= HIGH_CONFIDENCE_THRESHOLD && !hasEntity) {
    return {
      strategy: 'intent',
      intent: 'productos',
      entity: { type: null, value: null },
      usedContext: false,
      reason: `general catalog query: "productos" score=${intentResult.score}`,
    };
  }

  // Rule 3: Intent detected without entity → check if it needs entity from context
  if (hasIntent && !standalone) {
    // Non-standalone intent (precios, productos) might need entity from context
    if (context.lastEntity?.value) {
      return {
        strategy: 'context',
        intent: intentResult.intent,
        entity: { type: context.lastEntity.type, value: context.lastEntity.value },
        usedContext: true,
        reason: `intent "${intentResult.intent}" + context entity "${context.lastEntity.value}"`,
      };
    }
    // No context entity → use intent alone (will give general response)
    return {
      strategy: 'intent',
      intent: intentResult.intent,
      entity: { type: null, value: null },
      usedContext: false,
      reason: `intent "${intentResult.intent}" without entity`,
    };
  }

  // Rule 3b: Standalone intent with lower confidence
  if (hasIntent && standalone) {
    return {
      strategy: 'intent',
      intent: intentResult.intent,
      entity: { type: null, value: null },
      usedContext: false,
      reason: `standalone intent "${intentResult.intent}" score=${intentResult.score}`,
    };
  }

  // Rule 4: Ambiguous message → use context if available
  if (isAmbiguous(normalizedText)) {
    if (context.lastEntity?.value || context.lastIntent) {
      // If the last entity was NOT found in DB, treat as catalog intent (entity.value = null)
      // so a bare "sí" after a miss shows the catalog instead of re-querying the dead entity.
      const entityNotFound = context.lastEntityFound === false;
      const entityForAmbiguous = entityNotFound
        ? { type: null, value: null }
        : (context.lastEntity?.value
          ? { type: context.lastEntity.type, value: context.lastEntity.value }
          : { type: null, value: null });
      // When product was not found, redirect to catalog regardless of previous intent
      // (avoids re-querying unknown product or prompting for a product name again)
      const intentForAmbiguous = entityNotFound ? 'productos' : context.lastIntent;
      return {
        strategy: 'context',
        intent: intentForAmbiguous,
        entity: entityForAmbiguous,
        usedContext: true,
        reason: `ambiguous message, using context`,
      };
    }
  }


  // Rule 4.6: "es [adjective]?" / "están [adjective]?" — yes/no description question
  // about the confirmed context product. "¿Es natural?", "¿Es picante?", "¿Es vegano?"
  // are attribute questions about the product just presented, NOT product-name searches.
  // Fires before Rule 5 so "es natural" is never extracted as a product-name candidate.
  const COPULA_ADJ_RE = /^(?:es|estan)\s+[\wñ]/;
  if (
    !hasEntity &&
    COPULA_ADJ_RE.test(normalizedText) &&
    context.lastEntity?.type === 'product' &&
    context.lastEntity?.value &&
    context.lastEntityFound !== false
  ) {
    return {
      strategy:    'context',
      intent:      'descripcion',
      entity:      { type: context.lastEntity.type, value: context.lastEntity.value },
      usedContext: true,
      reason:      `yes/no adjective question about context product "${context.lastEntity.value}"`,
    };
  }

  // Rule 4.7: "que contiene este articulo" o similares, con contexto de producto
  // Se asegura que preguntas de descripción ambiguas usen el contexto si existe un producto
  const DESC_ARTICULO_RE = /que\s+contiene\s+este\s+articulo|que\s+lleva\s+este\s+articulo|que\s+ingredientes|que\s+lleva|que\s+contiene/i;
  if (
    !hasEntity &&
    DESC_ARTICULO_RE.test(normalizedText) &&
    context.lastEntity?.type === 'product' &&
    context.lastEntity?.value &&
    context.lastEntityFound !== false
  ) {
    return {
      strategy:    'context',
      intent:      'descripcion',
      entity:      { type: context.lastEntity.type, value: context.lastEntity.value },
      usedContext: true,
      reason:      `descripcion question about context product "${context.lastEntity.value}"`,
    };
  }

  // Rule 4.8: "con X" attribute follow-up in product context.
  // "y una con queso" after context { type: "product", value: "hamburguesa" }
  // → compound search: hamburguesas that CONTAIN queso.
  // Must fire before extractFollowUpEntity so "con queso" is never treated as a product name.
  //
  // Base-noun extraction: strip any " con X" compound previously stored by an AI turn
  // (e.g. lastEntity.value = "hamburguesa con picante") so compound search receives
  // just "hamburguesa" + new attribute, not the accumulated string.
  const CON_FOLLOWUP_RE = /^(?:y\s+)?(?:(?:un[ao]?|es[ao]?)\s+)?con\s+(?<attr>[\w\u00f1][\w\u00f1\s]{0,30}?)\s*\??$/;
  if (
    !hasEntity &&
    context.lastEntity?.type === 'product' &&
    context.lastEntity?.value
  ) {
    const conMatch = normalizedText.match(CON_FOLLOWUP_RE);
    const attrWord = conMatch?.groups?.attr?.trim();
    if (attrWord && attrWord.length >= 2) {
      // Strip " con X" suffix that may have been persisted by a prior AI turn.
      const entityBase = context.lastEntity.value.replace(/\s+con\s+.+$/, '').trim();
      return {
        strategy: 'attribute',
        intent: 'productos',
        entity: {
          type: 'attribute',
          value: `${entityBase} con ${attrWord}`,
          attributeType: 'feature',
          entityTerm: entityBase,
          attributeTerm: attrWord,
          categoryTerm: null,
        },
        usedContext: true,
        reason: `attribute follow-up: "${entityBase}" con "${attrWord}"`,
      };
    }
  }

  // Rule 4.9: Purchase pronoun after a confirmed context product.
  // Phrases like "me gustaria pedir una", "lo quiero", "dame una", "me lo llevo"
  // refer anaphorically to the product confirmed in the previous turn.
  // Must fire BEFORE Rule 5 so extractFollowUpEntity never processes them as
  // product names (which would cause a failed DB lookup with garbage text).
  //
  // Conditions:
  //   – No entity was detected directly in the current message
  //   – The message contains a purchase-pronoun signal
  //   – Context has a confirmed product (lastEntityFound !== false)
  if (
    !hasEntity &&
    context.lastEntity?.type === 'product' &&
    context.lastEntity?.value &&
    context.lastEntityFound !== false &&
    COMPRAR_PRONOUN_PATTERNS.some((p) => p.test(normalizedText))
  ) {
    return {
      strategy:   'comprar_context',
      intent:     'comprar',
      entity:     { type: context.lastEntity.type, value: context.lastEntity.value },
      usedContext: true,
      reason:     `purchase pronoun referring to confirmed product "${context.lastEntity.value}"`,
    };
  }

  // Rule 5: Check for follow-up entity ("¿Y pizza mexicana?", "tambien X", bare noun)
  const followUp = extractFollowUpEntity(normalizedText, context.lastEntity);
  if (followUp) {
    return {
      strategy: 'followup',
      intent: context.lastIntent ?? null,   // reuse last intent (e.g. 'productos')
      entity: { type: 'product', value: followUp },
      usedContext: true,
      reason: `follow-up entity: "${followUp}"`,
    };
  }

  // Rule 6: Anti-fallback — if there is valid context but no entity/intent could
  // be resolved from this message, prefer context over AI for short messages.
  // This handles ambiguous continuations like "y ese?" that isAmbiguous() misses.
  // Skip if:
  //   - the last entity was a miss (would re-query a known-empty product)
  //   - the last entity is a 'day' type (temporal context must not contaminate product/recommendation queries)
  //   - the last entity is a 'category' type — bare nouns like "postres?" should browse a NEW
  //     category, not repeat the old one. Category pagination is handled by Rule −1a (isSeekingMore).
  if (context.lastEntity?.value && context.lastEntityFound !== false &&
      context.lastEntity?.type !== 'day' &&
      context.lastEntity?.type !== 'category' &&
      normalizedText.length >= 2 && normalizedText.length <= 40) {
    const hasNewTopic = normalizedText.split(/\s+/).some((w) =>
      ['horario', 'horarios', 'direccion', 'contacto', 'promos', 'promociones', 'descuentos'].includes(w)
    );
    if (!hasNewTopic) {
      return {
        strategy: 'context',
        intent: context.lastIntent ?? null,
        entity: { type: context.lastEntity.type, value: context.lastEntity.value },
        usedContext: true,
        reason: `anti-fallback: using context entity "${context.lastEntity.value}"`,
      };
    }
  }

  // Rule 7: Fallback to AI
  return {
    strategy: 'ai',
    intent: null,
    entity: { type: null, value: null },
    usedContext: false,
    reason: 'no intent or entity detected',
  };
}

// ─── Context update builder ───────────────────────────────────────────────────

/**
 * Builds the context update object based on the pipeline decision.
 *
 * @param {PipelineDecision} decision
 * @returns {Record<string, any>}  Partial update for Redis (or {} for no-op)
 */
function buildContextUpdate(decision) {
  // Product attribute check — save the confirmed product entity for follow-up turns
  if (decision.strategy === 'product_attr_check') {
    return {
      lastIntent:          'descripcion',
      lastEntity:          { type: 'product', value: decision.entity.value },
      lastEntityFound:     true,
      paginationCategory:  null,
      paginationOffset:    null,
      paginationTotal:     null,
      availableCategories: null,
    };
  }

  // AI path: if a product entity was identified in the message, save it so
  // follow-up turns (e.g. "y una con queso") can resolve against the right product.
  // When no entity was found, return {} — existing context is left untouched.
  if (decision.strategy === 'ai') {
    if (decision._aiEntity?.value) {
      return {
        lastIntent: 'productos',
        lastEntity: decision._aiEntity,
      };
    }
    return {};
  }

  // Pagination advance — offset is managed inside executeDecision via direct updateContext
  if (decision.strategy === 'pagination') return {};

  // Category selected — reset pagination state; executeDecision will set it
  if (decision.strategy === 'category_select') return {};

  // Category reprompt — keep existing context so user can still pick a category
  if (decision.strategy === 'category_reprompt') return {};

  // Product-not-found follow-up (post-result pronoun after a miss) — no context change
  if (decision.strategy === 'product_not_found_followup') return {};

  // Servicios context follow-up — keep lastIntent as 'servicios' so the next
  // message is still treated as a service-topic follow-up.
  if (decision.strategy === 'servicios_followup') return { lastIntent: 'servicios' };

  // Attribute search — store the searched attribute(s) in Redis
  if (decision.strategy === 'attribute') {
    // When the attribute came from a product-context follow-up (e.g. "con queso" after
    // "hamburguesa"), preserve the product entity as lastEntity so subsequent
    // "con X" turns keep anchoring to the same product TYPE (base noun),
    // not the specific product variant ("hamburguesa doble" → store "hamburguesa").
    const PREP_ART = new Set(['de', 'del', 'con', 'sin', 'al', 'a', 'en', 'el', 'la', 'los', 'las', 'un', 'una']);
    const rawEntityTerm = decision.entity.entityTerm;
    const baseEntityTerm = rawEntityTerm
      ? (rawEntityTerm.split(/\s+/).find((w) => !PREP_ART.has(w)) || rawEntityTerm.split(/\s+/)[0])
      : null;
    const entityToStore = baseEntityTerm
      ? { type: 'product', value: baseEntityTerm }
      : { type: 'attribute', value: decision.entity.value };
    const attrsToStore = decision.entity.entityTerm
      ? null
      : (decision._attributes ?? [{ value: decision.entity.value, type: decision.entity.attributeType }]);
    return {
      lastIntent: 'productos',
      lastEntity: entityToStore,
      lastAttributes: attrsToStore,
      lastEntityFound: true,
      paginationCategory: null,
      paginationOffset: null,
      paginationTotal: null,
      availableCategories: null,
    };
  }

  // Entity detected → track entity, clear intent (new track)
  if (decision.entity?.value && !decision.usedContext) {
    const entityToStore = { type: decision.entity.type, value: decision.entity.value };
    if (decision.entity.type === 'day' && decision.entity.dayOfWeek !== undefined) {
      entityToStore.dayOfWeek = decision.entity.dayOfWeek;
    }
    return {
      lastIntent: decision.intent,
      lastEntity: entityToStore,
      lastEntityFound: true,   // reset to true; processMessage overrides to false on DB miss
      // New entity detected → clear any lingering pagination / category state
      paginationCategory: null,
      paginationOffset: null,
      paginationTotal: null,
      availableCategories: null,
      lastAttributes: null,
    };
  }

  // Follow-up entity → update entity track, keep intent
  if (decision.strategy === 'followup' && decision.entity?.value) {
    return {
      lastIntent: decision.intent,   // persist reused intent (may be null — that's OK)
      lastEntity: { type: decision.entity.type, value: decision.entity.value },
      paginationCategory: null,
      paginationOffset: null,
      paginationTotal: null,
      availableCategories: null,
    };
  }

  // Standalone intent → clear entity (topic change)
  if (decision.strategy === 'intent' && isStandaloneIntent(decision.intent)) {
    return {
      lastIntent: decision.intent,
      lastEntity: { type: null, value: null },
      paginationCategory: null,
      paginationOffset: null,
      paginationTotal: null,
      availableCategories: null,
    };
  }

  // General catalog query (productos intent, no entity) → clear stale entity so the
  // next ambiguous follow-up ("cuánto cuesta?") doesn't re-query the old product.
  if (decision.strategy === 'intent' && decision.intent === 'productos' && !decision.entity?.value) {
    return {
      lastIntent: 'productos',
      lastEntity: { type: null, value: null },
      paginationCategory: null,
      paginationOffset: null,
      paginationTotal: null,
      availableCategories: null,
      lastAttributes: null,
    };
  }

  // Non-standalone intent → keep entity, update intent
  if (decision.strategy === 'intent' || (decision.strategy === 'context' && decision.intent)) {
    return { lastIntent: decision.intent };
  }

  return {};
}

// ─── Response execution ───────────────────────────────────────────────────────

/**
 * Queries products with awareness of compound "X con Y" entity values.
 *
 * When an AI recommendation stores "hamburguesa con picante" as lastEntity.value,
 * a plain ILIKE search for that phrase finds nothing (no product is literally named
 * that). This helper splits the value at " con " and runs searchByCompoundQuery
 * instead, so results are correctly scoped to the attribute constraint.
 *
 * Falls through to a regular queryProducts call when:
 *   - the value has no " con " separator, OR
 *   - the compound search returns zero rows.
 *
 * @param {string} entityValue
 * @param {number} businessId
 * @returns {Promise<{ rows: Array, compound: object|null }>}
 */
async function queryProductsCompoundAware(entityValue, businessId) {
  const CON_SPLIT = /^(.+?)\s+con\s+(.+)$/.exec(entityValue);
  if (CON_SPLIT) {
    const [, baseEntity, attrTerm] = CON_SPLIT;
    try {
      const { rows } = await searchByCompoundQuery(
        { entity: baseEntity, attribute: attrTerm, fullPhrase: entityValue },
        businessId
      );
      if (rows.length > 0) {
        return {
          rows,
          compound: { entity: baseEntity, attribute: attrTerm, fullPhrase: entityValue },
          partialMatch: false,
        };
      }
    } catch { /* fall through */ }
  }
  const rawRows = await queryProducts(entityValue, businessId);
  if (rawRows.length > 1) {
    // Re-rank: promote products where the query appears as a whole word in the name.
    // ILIKE '%mole%' matches both "Mole Poblano" AND "Guacamole", and alphabetical
    // ordering puts "Guacamole" first. Re-sorting surfaces the word-boundary hit first.
    const normQ = normalize(entityValue).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wbRe  = new RegExp(`\\b${normQ}\\b`);
    rawRows.sort((a, b) => {
      const aWb = wbRe.test(normalize(a.name)) ? 0 : 1;
      const bWb = wbRe.test(normalize(b.name)) ? 0 : 1;
      return aWb - bWb;
    });
  }
  const rows = rawRows;
  if (rows.length > 0) return { rows, compound: null, partialMatch: false };

  // ── Word-by-word fallback ────────────────────────────────────────────
  // When searching for a multi-word phrase (e.g. "escuadra metalica") returns no
  // results, retry with each individual significant word so we surface the base
  // product ("Escuadra de 12\"") and tell the customer it's a related match.
  const words = entityValue.split(/\s+/).filter((w) => w.length >= 3);
  if (words.length >= 2) {
    for (const word of words) {
      const fallbackRows = await queryProducts(word, businessId);
      if (fallbackRows.length > 0) {
        return { rows: fallbackRows, compound: null, partialMatch: true };
      }
    }
  }

  // ── Synonym fallback ────────────────────────────────────────────────────
  // Last resort: swap each meaningful word for a known synonym and retry.
  // E.g. user types "soda" → no DB match → try "refresco" / "gaseosa".
  // A Set guards against retrying the same term twice (no infinite loops).
  const queriedTerms = new Set([normalize(entityValue)]);
  const candidateTerms = entityValue.split(/\s+/).filter((w) => w.length >= 3);
  for (const term of [entityValue, ...candidateTerms]) {
    for (const syn of await getSynonymsByBusinessId(term, businessId)) {
      if (queriedTerms.has(syn)) continue;
      queriedTerms.add(syn);

      // 1. Try as a product name / description match
      const synRows = await queryProducts(syn, businessId);
      if (synRows.length > 0) {
        return { rows: synRows, compound: null, partialMatch: true };
      }

      // 2. Try the synonym as a category name and load its products.
      //    E.g. dulce → postre → category "Postres" → Helado de fresa, Pastel...
      try {
        const catRows = await queryCategories(syn, businessId);
        if (catRows.length > 0) {
          const catProducts = await getProductosByCategory(businessId, catRows[0].name, PAGE_SIZE, 0);
          if (catProducts.length > 0) {
            return { rows: catProducts, compound: null, partialMatch: true };
          }
        }
      } catch { /* ignore — category lookup is best-effort */ }
    }
  }

  return { rows: [], compound: null, partialMatch: false };
}

/**
 * Executes the pipeline decision and returns the response text.
 *
 * @param {PipelineDecision} decision
 * @param {string} originalText    Raw user message
 * @param {string} normalizedText  Preprocessed text
 * @param {number} businessId
 * @param {{ lastIntent: string|null, lastEntity: object|null }} context
 * @returns {Promise<string>}
 */
async function executeDecision(decision, originalText, normalizedText, businessId, context, sessionId) {
  // ── Pagination: next page of the current category ──────────────────────────
  if (decision.strategy === 'pagination') {
    try {
      const cat    = context.paginationCategory;
      const offset = (context.paginationOffset ?? 0) + PAGE_SIZE;
      const total  = context.paginationTotal ?? 0;
      const rows   = await getProductosByCategory(businessId, cat, PAGE_SIZE, offset);
      if (rows.length === 0) {
        return `¡Listo! Aunque al parecer ya no hay más productos en ${cat}. ¿Puedo ayudarte con algo más?`;
      }
      await updateContext(businessId, sessionId, { paginationOffset: offset });
      return formatProductPage(rows, offset, total, cat);
    } catch (err) {
      console.error('[Pipeline] Error paginating products:', err.message);
    }
  }

  // ── Category reprompt: user typed something unrecognized while in selection ─
  if (decision.strategy === 'category_reprompt') {
    const cats = context.availableCategories ?? [];
    const listed = cats.slice(0, 6).join(', ');
    return `No identifiqué esa categoría. Puedes elegir entre: ${listed}. ¿Cuál te interesa?`;
  }

  // ── Category selection: user picked a category ─────────────────────────────
  if (decision.strategy === 'category_select') {
    try {
      const cat   = decision.entity.value;
      const total = await countProductosByCategory(businessId, cat);
      const rows  = await getProductosByCategory(businessId, cat, PAGE_SIZE, 0);
      await updateContext(businessId, sessionId, {
        lastIntent: 'productos',
        lastEntity: { type: 'category', value: cat },
        paginationCategory: cat,
        paginationOffset: 0,
        paginationTotal: total,
        availableCategories: null,
      });
      if (rows.length === 0) {
        return `Hmm, parece que no tenemos productos en la categoría "${cat}". ¿Quieres explorar otra?`;
      }
      return formatCategorySelectionResponse(cat, rows, 0, total);
    } catch (err) {
      console.error('[Pipeline] Error loading category:', err.message);
    }
  }

  // ── Attribute search: "algo con X", "para madera", "que tenga wifi" ──────────
  if (decision.strategy === 'attribute') {
    try {
      // Category+attribute path: "alguna bebida con chocolate", "algun postre de arroz"
      if (decision.entity.categoryTerm) {
        const catAttr = { categoryWord: decision.entity.categoryTerm, attribute: decision.entity.attributeTerm };
        const { rows, strategy } = await searchByCategoryAttribute(catAttr, businessId);
        return formatCategoryAttributeResponse(catAttr, rows, strategy);
      }

      // Compound query path: "tornillos de madera", "carne de res", etc.
      // Uses strict 3-layer search to prevent false positives.
      if (decision.entity.entityTerm) {
        const compound = {
          entity:     decision.entity.entityTerm,
          attribute:  decision.entity.attributeTerm,
          fullPhrase: decision.entity.value,
        };
        const { rows, strategy } = await searchByCompoundQuery(compound, businessId);
        return formatCompoundQueryResponse(compound, rows, strategy);
      }

      // Standard attribute path: "algo con queso", "para madera", etc.
      const attributes = decision._attributes ?? [{ value: decision.entity.value, type: decision.entity.attributeType }];
      const { rows, strategy } = await searchByAttributes(attributes, businessId);

      // Synonym fallback: attribute search found nothing, so try the attribute value
      // as a product name through the synonym-aware pipeline.
      // e.g. "algo con mazorca" → attribute="mazorca" → DB finds nothing →
      //      queryProductsCompoundAware("mazorca") → synonym "elote" → found.
      if (rows.length === 0 && attributes.length === 1) {
        const attrTerm = attributes[0].value;
        try {
          const { rows: synRows, compound, partialMatch } = await queryProductsCompoundAware(attrTerm, businessId);
          if (synRows.length > 0) {
            if (compound) return formatCompoundQueryResponse(compound, synRows, 'entity+attribute');
            if (partialMatch) return formatPartialMatchResponse(attrTerm, synRows);
            return formatProductResponse(attrTerm, synRows);
          }
        } catch { /* synonym fallback is best-effort */ }
      }

      return formatAttributeResponse(attributes, rows, strategy);
    } catch (err) {
      console.error('[Pipeline] Error in attribute search:', err.message);
    }
  }

  // Horarios for a specific day
  if (decision.intent === 'horarios' && decision.entity?.type === 'day') {
    try {
      const row = await getHorariosByDay(businessId, decision.entity.dayOfWeek);
      return formatHorarioDay(decision.entity.value, row);
    } catch (err) {
      console.error('[Pipeline] Error querying horarios by day:', err.message);
    }
  }

  // Servicios intent: show specific service detail if entity provided, else full list
  if (decision.intent === 'servicios') {
    // Build search term: entity value, or service-name pattern in text, or — for
    // servicios_followup — the full normalized message (word-intersection handles it).
    const serviceQuery = decision.entity?.value || extractServiceQuery(normalizedText);
    const queryToUse   = serviceQuery || (decision.strategy === 'servicios_followup' ? normalizedText : null);
    if (queryToUse) {
      try {
        const allServices = await getBusinessInfoByIntent('servicios', businessId);
        const normQuery   = normalize(queryToUse);
        // 1. Exact substring match (covers most cases)
        let match = allServices.find((s) => {
          const normName = normalize(s.name);
          return normName.includes(normQuery) || normQuery.includes(normName);
        });
        // 2. Word-intersection fallback: ≥50% of meaningful query words appear in the service name
        if (!match) {
          const qWords = normQuery.split(/\s+/).filter((w) => w.length > 2);
          match = allServices.find((s) => {
            const nameWords = new Set(normalize(s.name).split(/\s+/));
            const overlap   = qWords.filter((w) => nameWords.has(w));
            return qWords.length > 0 && overlap.length >= Math.ceil(qWords.length / 2);
          });
        }
        if (match) {
          try {
            const contactInfo = await getBusinessInfoByIntent('contacto', businessId);
            return formatServiceWithContact(match, contactInfo);
          } catch {
            return formatServiceDetail(match);
          }
        }
      } catch (err) {
        console.error('[Pipeline] Error searching service by name:', err.message);
      }
    }
    try {
      const data = await getBusinessInfoByIntent('servicios', businessId);
      return formatIntentResponse('servicios', data);
    } catch (err) {
      console.error('[Pipeline] Error querying servicios:', err.message);
    }
  }

  // Price-specific response: intent=precios + product entity (from message OR context)
  if (decision.intent === 'precios' && decision.entity?.type === 'product' && decision.entity?.value) {
    try {
      const { rows, compound, partialMatch } = await queryProductsCompoundAware(decision.entity.value, businessId);
      if (rows.length === 0) {
        return `No encontré "${decision.entity.value}" en nuestro catálogo. ¿Quieres ver las opciones disponibles?`;
      }
      // Partial match (via word fallback): show related item instead of an exact price
      if (partialMatch) {
        return formatPartialMatchResponse(decision.entity.value, rows);
      }
      // Compound match with multiple results: list them so the user can narrow down.
      if (compound && rows.length > 1) {
        return formatCompoundQueryResponse(compound, rows, 'entity+attribute');
      }
      const p = rows[0];
      let response = `😊 ${p.name} tiene un precio de $${Number(p.price).toFixed(2)}.`;
      try {
        const attrsMap = await getProductAttributes([p.id]);
        response += formatProductAttributes(attrsMap, p.id);
      } catch { /* attributes are optional */ }
      return response;
    } catch (err) {
      console.error('[Pipeline] Error querying product price:', err.message);
    }
  }

  // ── Product attribute inclusion check: "does [product] include/have [attr]?" ─
  // Looks up the product, checks its description AND key/value attributes for the
  // specific queried attribute, then replies positively or negatively — always
  // including the full product description and attributes in the response.
  if (decision.strategy === 'product_attr_check') {
    const productName = decision.entity.value;
    const askedAttr   = decision.entity.askedAttribute;
    try {
      const { rows, partialMatch } = await queryProductsCompoundAware(productName, businessId);
      // Reject word-by-word fallback matches where the returned product doesn't
      // actually contain all significant words from the query — e.g. searching
      // "hamburguesa italiana" must not silently return "hamburguesa BBQ".
      const _ATTR_STOP = new Set(['el','la','los','las','un','una','de','del','con','y','o','en','a','al','por']);
      const validAttrRows = (partialMatch && rows.length > 0)
        ? (() => {
            const qWords = normalize(productName).split(/\s+/).filter((w) => w.length >= 3 && !_ATTR_STOP.has(w));
            const p0 = rows[0];
            const haystack = normalize((p0.name ?? '') + ' ' + (p0.description ?? ''));
            return qWords.every((w) => haystack.includes(w)) ? rows : [];
          })()
        : rows;
      if (validAttrRows.length === 0) {
        return `No encontré "${productName}" en nuestro catálogo. ¿Quieres ver las opciones disponibles?`;
      }
      const p = validAttrRows[0];
      let attrsMap = {};
      try {
        attrsMap = await getProductAttributes([p.id]);
      } catch { /* attributes are optional */ }

      const normAttr  = normalize(askedAttr);
      const normDesc  = normalize(p.description ?? '');
      const attrsList = attrsMap[p.id] ?? [];

      // Check description and product attributes (key and value)
      const foundInDesc  = normDesc.includes(normAttr);
      const foundInAttrs = attrsList.some(
        (a) => normalize(a.value).includes(normAttr) || normalize(a.key).includes(normAttr)
      );
      const found = foundInDesc || foundInAttrs;

      // Build product info suffix (description + attributes)
      const descPart  = p.description ? ` ${p.description}` : '';
      const attrsPart = attrsList.length > 0
        ? ` Sus características son: ${attrsList.map((a) => `${a.key}: ${a.value}`).join(', ')}.`
        : '';

      if (found) {
        return `😊 Sí, ${p.name} incluye ${askedAttr}.${descPart}${attrsPart}`;
      } else {
        return `${p.name} no incluye "${askedAttr}" entre sus ingredientes o características.${descPart}${attrsPart}`;
      }
    } catch (err) {
      console.error('[Pipeline] Error in product attribute check:', err.message);
    }
  }

  // Description request: intent=descripcion → show product/service description
  if (decision.intent === 'descripcion') {
    if (!decision.entity?.value) {
      return '¡Claro! ¿Sobre qué producto o servicio te gustaría saber más?';
    }
    try {
      const { rows, partialMatch } = await queryProductsCompoundAware(decision.entity.value, businessId);
      // Reject word-by-word fallback matches where the returned product doesn't
      // contain all significant words from the query — avoids returning "Hamburguesa BBQ"
      // when the user asked about "hamburguesa italiana" (which doesn't exist).
      const _DESC_STOP = new Set(['el','la','los','las','un','una','de','del','con','y','o','en','a','al','por']);
      const descRows = (partialMatch && rows.length > 0)
        ? (() => {
            const qWords = normalize(decision.entity.value).split(/\s+/).filter((w) => w.length >= 3 && !_DESC_STOP.has(w));
            const p0 = rows[0];
            const haystack = normalize((p0.name ?? '') + ' ' + (p0.description ?? ''));
            return qWords.every((w) => haystack.includes(w)) ? rows : [];
          })()
        : rows;
      let response = formatDescripcionResponse(decision.entity.value, descRows);
      if (descRows.length > 0) {
        try {
          const attrsMap = await getProductAttributes([descRows[0].id]);
          response += formatProductAttributes(attrsMap, descRows[0].id);
        } catch { /* attributes are optional */ }
        return response;
      }
      // No product found — try matching against business services as a fallback
      try {
        const allServices = await getBusinessInfoByIntent('servicios', businessId);
        const normQuery   = normalize(decision.entity.value);
        let serviceMatch  = allServices.find((s) => {
          const normName = normalize(s.name);
          return normName.includes(normQuery) || normQuery.includes(normName);
        });
        if (!serviceMatch) {
          const qWords = normQuery.split(/\s+/).filter((w) => w.length > 2);
          serviceMatch = allServices.find((s) => {
            const nameWords = new Set(normalize(s.name).split(/\s+/));
            const overlap   = qWords.filter((w) => nameWords.has(w));
            return qWords.length > 0 && overlap.length >= Math.ceil(qWords.length / 2);
          });
        }
        if (serviceMatch) {
          try {
            const contactInfo = await getBusinessInfoByIntent('contacto', businessId);
            return formatServiceWithContact(serviceMatch, contactInfo);
          } catch {
            return formatServiceDetail(serviceMatch);
          }
        }
      } catch { /* service fallback is best-effort */ }
      return response;
    } catch (err) {
      console.error('[Pipeline] Error querying description:', err.message);
    }
  }

  // Entity-based response: query product/category
  if (decision.entity?.value && (decision.strategy === 'entity' || decision.strategy === 'context' || decision.strategy === 'followup')) {
    // Category entity (e.g. "que bebidas tienen", "que tipo de bebidas tienen") →
    // show the first page of products for that category
    if (decision.entity.type === 'category') {
      try {
        const cat   = decision.entity.value;
        const total = await countProductosByCategory(businessId, cat);
        const rows  = await getProductosByCategory(businessId, cat, PAGE_SIZE, 0);
        await updateContext(businessId, sessionId, {
          lastIntent: 'productos',
          lastEntity: { type: 'category', value: cat },
          paginationCategory: cat,
          paginationOffset: 0,
          paginationTotal: total,
          availableCategories: null,
        });
        if (rows.length === 0) {
          return `Hmm, no encontré productos en la categoría "${cat}". ¿Quieres explorar otra?`;
        }
        return formatProductPage(rows, 0, total, cat);
      } catch (err) {
        console.error('[Pipeline] Error loading category from entity:', err.message);
      }
    }

    if (decision.entity.type === 'product') {
      // Context-aware service match: if the last turn showed services the user may
      // be naming a service (e.g. "quiero el menú especial empresarial"). Try the
      // services table first before falling through to the product catalog.
      if (context.lastIntent === 'servicios') {
        try {
          const allServices = await getBusinessInfoByIntent('servicios', businessId);
          const normQuery   = normalize(decision.entity.value);
          let serviceMatch  = allServices.find((s) => {
            const normName = normalize(s.name);
            return normName.includes(normQuery) || normQuery.includes(normName);
          });
          // Word-intersection fallback (≥50% of significant words match)
          if (!serviceMatch) {
            const qWords = normQuery.split(/\s+/).filter((w) => w.length > 2);
            serviceMatch = allServices.find((s) => {
              const nameWords = new Set(normalize(s.name).split(/\s+/));
              const overlap   = qWords.filter((w) => nameWords.has(w));
              return qWords.length > 0 && overlap.length >= Math.ceil(qWords.length / 2);
            });
          }
          if (serviceMatch) {
            try {
              const contactInfo = await getBusinessInfoByIntent('contacto', businessId);
              return formatServiceWithContact(serviceMatch, contactInfo);
            } catch {
              return formatServiceDetail(serviceMatch);
            }
          }
        } catch (err) {
          console.error('[Pipeline] Error searching service from context:', err.message);
        }
      }

      try {
        const { rows, compound, partialMatch } = await queryProductsCompoundAware(decision.entity.value, businessId);
        // Log every specific product query as an individual event.
        // Category and general catalog queries never reach this block — they are handled
        // by the category branch above (decision.entity.type === 'category') or by the
        // intent-only path, so no further filtering is needed here.
        const available = rows.filter((r) => r.is_available !== false);
        if (available.length > 0) {
          logProductQuery(businessId, available.map((r) => r.id));
        }
        // Compound entity (e.g. "hamburguesa con picante" from context after AI turn) →
        // show filtered results using the attribute-aware format.
        if (compound) {
          return formatCompoundQueryResponse(compound, rows, 'entity+attribute');
        }
        // Partial match (e.g. "escuadra metalica" → found "Escuadra de 12\"") →
        // use a "related products" message instead of the exact-match format.
        if (partialMatch) {
          return formatPartialMatchResponse(decision.entity.value, rows);
        }
        let response = formatProductResponse(decision.entity.value, rows);
        if (rows.length === 1) {
          try {
            const attrsMap = await getProductAttributes([rows[0].id]);
            response += formatProductAttributes(attrsMap, rows[0].id);
          } catch { /* attributes are optional */ }
        }
        return response;
      } catch (err) {
        console.error('[Pipeline] Error querying product:', err.message);
      }
    }
  }

  // comprar_context: purchase pronoun referencing the confirmed context product.
  // chatSocket.js checks this signal and triggers the purchase form (or contact info).
  // The text here acts as a brief acknowledgment while the form loads.
  if (decision.strategy === 'comprar_context') {
    const productName = decision.entity?.value ?? 'ese producto';
    return `¡Perfecto! 😊 Enseguida te ayudo con tu pedido de ${productName}.`;
  }

  // Post-result pronoun purchase phrase after a failed product lookup:
  // user said something like "quiero una" / "me lo llevo" referring to a product
  // that doesn't exist in the catalog.
  if (decision.strategy === 'product_not_found_followup') {
    const productName = decision.entity?.value ?? 'ese producto';
    return `Lo siento, "${productName}" no está disponible en nuestro catálogo. ¿Te gustaría ver las opciones disponibles? 😊`;
  }

  // Intent-based response
  if (decision.intent) {
    try {
      const data = await getBusinessInfoByIntent(decision.intent, businessId);

      // Hard limit for productos: if too many, prompt with category list instead
      if (decision.intent === 'productos' && Array.isArray(data) && data.length > PRODUCTS_HARD_LIMIT) {
        const categories = await getCategories(businessId);
        // Signal to processMessage to override buildContextUpdate()
        decision._ctxOverride = {
          lastIntent: 'category_selection',
          availableCategories: categories,
          paginationCategory: null,
          paginationOffset: null,
          paginationTotal: null,
        };
        return formatCategoryPrompt(categories);
      }

      let intentResponse = formatIntentResponse(decision.intent, data);

      // For ubicacion: append a brief list of the business's services
      if (decision.intent === 'ubicacion') {
        try {
          const services = await getBusinessInfoByIntent('servicios', businessId);
          if (services && services.length > 0) {
            const svcNames = services.map((s) => s.name).slice(0, 3);
            const svcListed = svcNames.length > 1
              ? `${svcNames.slice(0, -1).join(', ')} y ${svcNames[svcNames.length - 1]}`
              : svcNames[0];
            const more = services.length > 3 ? ', entre otros' : '';
            intentResponse +=
              ` También ofrecemos ${svcListed}${more}. ¿Te gustaría saber más sobre alguno?`;
          }
        } catch { /* services are optional */ }
        // Attach google maps link as metadata so frontend can render a hidden
        // hyperlink with the label "ubicación" instead of showing the raw URL.
        if (data?.google_maps_url) {
          decision._replyMeta = { links: [{ text: 'Abrir ubicación', url: data.google_maps_url }] };
        }
      }

      return intentResponse;
    } catch (err) {
      console.error('[Pipeline] Error querying intent:', err.message);
    }
  }

  // AI fallback
  const keyword = getKeywordResponse(originalText);
  if (keyword) return keyword;

  return getMockOpenAIResponse(originalText, {
    lastProduct: context?.lastEntity?.value ?? null,
    lastIntent: context?.lastIntent ?? null,
  });
}

/**
 * Hybrid AI handler: runs the AI decision engine + RAG filter, then
 * either returns a backend fallback or a simulated OpenAI response.
 *
 * @param {string} originalText     Raw user message
 * @param {string} normalizedText   Preprocessed text
 * @param {number} businessId
 * @param {{ intent: string|null, score: number, scores: object }} intentResult
 * @param {{ type: string|null, value: string|null }}              entityResult
 * @param {{ lastIntent: string|null, lastEntity: object }}        context
 * @returns {Promise<{ text: string, aiUsed: boolean, ragContext: object|null }>}
 */
async function handleAIFallback(originalText, normalizedText, businessId, intentResult, entityResult, context, sessionId = null, onToken = null) {
  // Step 1: keyword responses (greetings, etc.) — only for short/standalone messages.
  // A message like "hola que me recomiendas" contains "hola" as a prefix but is really
  // an AI request, so we skip the keyword shortcut once the message exceeds 3 words.
  const _kwWordCount = originalText.trim().split(/\s+/).length;
  if (_kwWordCount <= 3) {
    const keyword = getKeywordResponse(originalText);
    if (keyword) {
      return { text: keyword, aiUsed: false, ragContext: null };
    }
  }

  // Step 2: AI decision engine — segunda comprobación (FLUJO_CHAT §3.4 PASO 2).
  // shouldUseAI checks explicit AI signals (recommendations, comparisons, etc.)
  // BEFORE the intent-score guard, so a high comprar score never blocks AI routing.
  const aiDecision = shouldUseAI(normalizedText, intentResult, entityResult, context);

  if (aiDecision.routing === 'backend') {
    // Backend fallback — use the mock response (no AI needed for this message)
    const fallback = getMockOpenAIResponse(originalText, {
      lastProduct: context?.lastEntity?.value ?? null,
      lastIntent: context?.lastIntent ?? null,
    });
    return { text: fallback, aiUsed: false, ragContext: null };
  }

  // Step 3–5: Subscription gate → RAG → Ollama (FLUJO_CHAT §3.4 PASO 4b–5).
  // Delegate entirely to subscriptionController.handleAIGate which:
  //   • Checks subscription plan (Lite → placeholder mock, Premium → continues)
  //   • Runs RAG filter for Premium to fetch relevant business data
  //   • Calls Ollama (llama3) with business context + RAG data
  //   • Falls back to getRAGOpenAIResponse if Ollama is unavailable
  const gateResult = await handleAIGate({
    businessId,
    originalText,
    normalizedText,
    intentResult,
    entityResult,
    context,
    sessionId,
    onToken,
  });

  return { text: gateResult.text, aiUsed: gateResult.aiUsed, ragContext: gateResult.ragContext };
}

// ─── Full pipeline ────────────────────────────────────────────────────────────

/**
 * Processes a user message through the full NLP pipeline.
 *
 * @param {{ text: string, sessionId: string, businessId: number }} params
 * @returns {Promise<{ replyText: string, decision: PipelineDecision, logs: object }>}
 */
async function processMessage({ text, sessionId, businessId, onToken = null }) {
  // 0. Raw normalization (before restructureSentence reorders word order) — used
  //    exclusively to detect product-attribute inclusion questions whose pattern
  //    is destroyed by the OV→VO reordering in preprocessMessage.
  const rawNorm = normalize(text);

  // 1. Preprocess: normalize + expand abbreviations + correct typos
  const normalizedText = preprocessMessage(text);

  // 1.5  Negation detection — captures "sin X", "no quiero X", "que no tenga X", etc.
  //      Results are stored in Redis AFTER the response so they don't change routing
  //      for _this_ turn, but ARE available from the next turn onward.
  const negationInfo = detectNegation(normalizedText);

  // 1.6  Multi-intent splitting — splits compound messages at Spanish connectors.
  //      "cuánto cuesta la pizza y a qué hora abren?" → two independent segments.
  //      When only one segment is returned the whole flow is a single-pass (normal).
  const intentSegments = parseMultiIntent(normalizedText);
  const isMultiIntent  = intentSegments.length > 1;

  // ROOT-CAUSE FIX: when the message is multi-intent, the combined text
  // (e.g. "cuanto cuesta la pizza hawaiana y que horarios tienen") causes
  // entity-extraction regexes to greedily include connector words and the
  // second clause ("pizza hawaiana y que horarios tienen" as the entity value).
  // The DB lookup then fails → pipeline falls back to the STALE context entity
  // (e.g. previous "Orden de Carnitas").
  //
  // Solution: run steps 2-6 (day/intent/entity detection + decision) on the
  // PRIMARY segment only ("cuanto cuesta la pizza hawaiana"). Secondary
  // segments are still processed inline after the primary response (see the
  // multi-intent block below).
  //
  // Single-intent messages: primaryText === normalizedText (no change in behaviour).
  const primaryText = isMultiIntent ? intentSegments[0].segment : normalizedText;

  // 2. Detect day entity (highest priority — skips DB lookup entirely)
  const dayEntity = detectDay(primaryText);

  // 3. Detect intent (scoring) — pass preprocessed text so typos are already corrected
  const intentResult = detectIntent(primaryText);

  // 4. Detect entities (DB lookup — skipped when day detected)
  const entityResult = dayEntity
    ? dayEntity
    : await detectEntities(primaryText, businessId, intentResult);

  // 5. Get context from Redis
  const context = await getContext(businessId, sessionId);

  // 5b. Attribute follow-up: combine new attribute with previous search context
  // e.g. "algo con queso" → "y con pollo" → combine [queso, pollo]
  //
  // Guard: skip combination when the current message is a fresh standalone query.
  // "tiene algo con pollo?" / "hay algo con pollo?" start a brand-new search
  // and must NOT be merged with the prior attribute context.
  // Only short follow-up forms like "y con pollo", "con queso", "tambien con jalapeño"
  // should accumulate attributes.
  const FRESH_ATTR_QUERY_RE = /\b(?:algo|alguna?|alguno?|productos?|hay|tienes?|tienen|busco|necesito)\b/;
  if (
    !FRESH_ATTR_QUERY_RE.test(primaryText) &&
    entityResult.type === 'attribute' &&
    context.lastEntity?.type === 'attribute' &&
    Array.isArray(context.lastAttributes) &&
    context.lastAttributes.length > 0
  ) {
    const newAttr = { value: entityResult.value, type: entityResult.attributeType };
    // Avoid duplicates
    const alreadyPresent = context.lastAttributes.some(
      (a) => a.value === newAttr.value
    );
    if (!alreadyPresent) {
      const combinedAttributes = [...context.lastAttributes, newAttr];
      // Override entity result to trigger multi-attribute search
      entityResult._combinedAttributes = combinedAttributes;
    }
  }

  // 6. Make decision
  const decision = decide(intentResult, entityResult, context, primaryText);

  // 6.1  Raw-text attribute check override:
  //      preprocessMessage()'s restructureSentence() transforms
  //        "la pizza hawaiana incluye jamon?" → "incluye la pizza hawaiana jamon"
  //      which breaks the regex in decide() Rule 1.6.
  //      Re-run on rawNorm (just normalize(), no word reordering) so the
  //      original subject–verb–object order is preserved.
  if (decision.strategy !== 'product_attr_check') {
    const rawAttrCheck = detectProductAttributeCheck(rawNorm);
    if (rawAttrCheck) {
      Object.assign(decision, {
        strategy:    'product_attr_check',
        intent:      'descripcion',
        entity:      { type: 'product', value: rawAttrCheck.product, askedAttribute: rawAttrCheck.askedAttribute },
        usedContext: false,
        reason:      `product attr check (raw): "${rawAttrCheck.product}" ¿tiene "${rawAttrCheck.askedAttribute}"?`,
      });
    }
  }

  // If we detected combined attributes, attach them to the decision
  if (entityResult._combinedAttributes) {
    decision._attributes = entityResult._combinedAttributes;
  }

  // When the AI pre-screen fires, capture the most useful entity for context
  // persistence so follow-up queries ("¿cuánto cuesta?", "y una con jalapeño") can
  // refer back to what was discussed in this turn.
  //
  // Priority for base product:
  //   1. Explicit product entity detected in the message (e.g. entityResult.value = 'hamburguesa')
  //   2. Product entity already in context — for messages like "recomiéndame una con picante"
  //      where no standalone product noun was in the message.
  //
  // If the message also carries a "con X" attribute constraint, encode it in the
  // stored entity value ("hamburguesa con picante") so that follow-up Rule 4.8 and
  // queryProductsCompoundAware can scope results to the specified attribute.
  if (decision.strategy === 'ai') {
    const aiBase =
      (entityResult.type === 'product' && entityResult.value)
        ? entityResult.value
        : (context.lastEntity?.type === 'product' ? context.lastEntity.value : null);
    if (aiBase) {
      // Strip any previously stored " con X" compound from the base so we don't
      // accumulate chains like "hamburguesa con queso con picante".
      const cleanBase = aiBase.replace(/\s+con\s+.+$/, '').trim();
      const CON_RE = /\bcon\s+([\w\u00f1][\w\u00f1\s]{1,25}?)(?:\s*\?)?$/;
      const conMatch = CON_RE.exec(primaryText);
      const attrSuffix = conMatch?.[1]?.trim() ?? null;
      const entityValue = attrSuffix ? `${cleanBase} con ${attrSuffix}` : cleanBase;
      decision._aiEntity = { type: 'product', value: entityValue };
    }
  }

  // Logging
  const logs = {
    normalizedText,
    primaryText:   isMultiIntent ? primaryText : undefined,
    isMultiIntent,
    intentScores: intentResult.scores,
    intentWinner: intentResult.intent,
    intentScore: intentResult.score,
    entityType: entityResult.type,
    entityValue: entityResult.value,
    context: { lastIntent: context.lastIntent, lastEntity: context.lastEntity },
    decision: decision.strategy,
    reason: decision.reason,
    usedContext: decision.usedContext,
  };

  console.log('[Pipeline]', JSON.stringify(logs, null, 2));

  // 6. Execute decision → response (hybrid: backend-first, AI as last resort)
  let replyText;
  let aiUsed = false;
  let ragContext = null;

  if (decision.strategy === 'ai') {
    // Hybrid AI path: decision engine + RAG filter + simulated OpenAI
    const aiResult = await handleAIFallback(
      text, primaryText, businessId, intentResult, entityResult, context, sessionId, onToken
    );
    replyText = aiResult.text;
    aiUsed = aiResult.aiUsed;
    ragContext = aiResult.ragContext;

    // Cuando llama3 respondió (Premium), identificar el producto específico mencionado
    // escaneando la respuesta contra los datos RAG. Permite que preguntas de seguimiento
    // ("cuánto cuesta?", "qué incluye?") resuelvan el producto exacto.
    if (aiUsed && ragContext?.type === 'products' && Array.isArray(ragContext.data) && ragContext.data.length > 0) {
      const normReply = normalize(replyText);
      const sorted = [...ragContext.data].sort((a, b) => b.name.length - a.name.length);
      const mentioned = sorted.find((p) => normReply.includes(normalize(p.name)));
      if (mentioned) {
        decision._aiEntity = { type: 'product', value: normalize(mentioned.name) };
      }
    }
  } else {
    // ── Ruta determinista: intents + contexto + valores ────────────────────────
    replyText = await executeDecision(decision, text, primaryText, businessId, context, sessionId);
  }

  // Enrich logs with AI routing info
  logs.aiUsed = aiUsed;
  if (ragContext) {
    logs.ragType = ragContext.type;
    logs.ragDataCount = ragContext.data?.length ?? 0;
    logs.ragSummary = ragContext.summary;
  }

  // 7. Update context
  // When a product entity was detected but NOT found in DB:
  //   • Keep lastEntity in context so "y de X" follow-ups can refine the search
  //   • Set lastEntityFound=false so a bare "sí" shows the catalog (not a re-query)
  let contextUpdate;
  if (decision._ctxOverride !== undefined) {
    contextUpdate = decision._ctxOverride;
  } else {
    contextUpdate = buildContextUpdate(decision);
    // entity strategy: _rows comes directly from detectEntities.
    // Also guard with reply text: executeDecision may find the product via a
    // compound/fuzzy fallback (queryProductsCompoundAware) even when _rows is
    // empty. In that case the reply is positive, so we must NOT mark it as missed.
    const entityMissedViaDirect =
      decision.strategy === 'entity' &&
      decision.entity?.type === 'product' &&
      entityResult._rows?.length === 0 &&
      typeof replyText === 'string' &&
      replyText.toLowerCase().includes('no encontr');
    // followup / context strategies: entity came from context/follow-up logic,
    // not from detectEntities, so _rows is undefined. Infer miss from reply text.
    // Both formatProductResponse and formatDescripcionResponse emit a variant:
    //   formatProductResponse  → "Lo siento, no encontr..."
    //   formatDescripcionResponse → "No encontré información..."
    const entityMissedViaContext =
      (decision.strategy === 'followup' || decision.strategy === 'context') &&
      decision.entity?.type === 'product' &&
      decision.entity?.value &&
      typeof replyText === 'string' &&
      replyText.toLowerCase().includes('no encontr');

    if (entityMissedViaDirect || entityMissedViaContext) {
      contextUpdate.lastEntityFound = false;
    }
  }

  if (Object.keys(contextUpdate).length > 0) {
    await updateContext(businessId, sessionId, contextUpdate);
  }

  // ── Multi-intent: process secondary segments inline ───────────────────────
  // When the message was split at a connector (e.g. "cuánto cuesta X y
  // a qué hora abren?"), each secondary segment is run through the pipeline
  // independently using fresh context (updated by the primary segment above).
  // Responses are joined with a natural Spanish bridge phrase.
  if (isMultiIntent) {
    const allResponses = [{ text: replyText, connectorType: 'primary' }];

    for (let i = 1; i < intentSegments.length; i++) {
      const { segment, connectorType } = intentSegments[i];
      try {
        // Each segment was already normalised by parseMultiIntent (it received
        // the already-preprocessed normalizedText as input).
        const segDay    = detectDay(segment);
        const segIntent = detectIntent(segment);
        const segEntity = segDay
          ? segDay
          : await detectEntities(segment, businessId, segIntent);

        // Use fresh context — updated by previous segment processing
        const freshCtx = await getContext(businessId, sessionId);

        const segDecision = decide(segIntent, segEntity, freshCtx, segment);

        // Propagate combined attributes from secondary segment if applicable
        if (segEntity._combinedAttributes) {
          segDecision._attributes = segEntity._combinedAttributes;
        }

        const segReply = await executeDecision(
          segDecision, segment, segment, businessId, freshCtx, sessionId
        );

        allResponses.push({ text: segReply, connectorType });

        // Persist context update for this secondary segment
        const segCtxUpdate = buildContextUpdate(segDecision);
        if (Object.keys(segCtxUpdate).length > 0) {
          await updateContext(businessId, sessionId, segCtxUpdate);
        }
      } catch (err) {
        console.error('[Pipeline] Multi-intent segment error:', segment, err.message);
      }
    }

    if (allResponses.length > 1) {
      replyText = allResponses[0].text;
      for (let i = 1; i < allResponses.length; i++) {
        replyText = joinResponses(replyText, allResponses[i].text, allResponses[i].connectorType);
      }
    }
  }

  // ── Turn memory: push this turn to topicMemory ring buffer ───────────────
  // Stored AFTER the response so `found` reflects the real DB outcome.
  try {
    await pushTurnMemory(businessId, sessionId, {
      intent: decision.intent,
      entity: decision.entity ?? { type: null, value: null },
      found:  contextUpdate.lastEntityFound !== false,
      ts:     Date.now(),
    });
  } catch { /* non-fatal */ }

  // ── Negation: persist rejected terms to Redis ─────────────────────────────
  if (negationInfo.hasNegation) {
    for (const term of negationInfo.negatedTerms) {
      try {
        await addRejectedEntity(businessId, sessionId, term);
      } catch { /* non-fatal */ }
    }
  }

  return { replyText, decision, logs };
}

export {
  processMessage,
  decide,
  buildContextUpdate,
  executeDecision,
  handleAIFallback,
  isAmbiguous,
  extractFollowUpEntity,
  HIGH_CONFIDENCE_THRESHOLD,
};

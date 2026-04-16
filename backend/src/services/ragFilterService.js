'use strict';

/**
 * src/services/ragFilterService.js
 *
 * RAG FILTER SERVICE — Retrieval-Augmented Generation data filter.
 *
 * When the pipeline decides a message needs AI (OpenAI), this service
 * fetches ONLY the relevant data from the DB and builds a compact context
 * payload for the LLM. The goal is to minimize token usage and cost.
 *
 * DESIGN:
 *   - Never sends the full DB — filters by intent, entity, and context
 *   - Hard limit of MAX_ITEMS per query to cap token usage
 *   - Returns structured { type, data[], summary } for the AI prompt builder
 *   - Intent-aware: "recomiéndame algo" → products; "compara X y Y" → specific products
 */

import BusinessModel from '../models/businessModel.js';
import { queryProducts, queryCategories } from './entityDetector.js';
import { normalize } from './normalize.js';
import { searchByCompoundQuery } from './attributeSearchService.js';

/** Maximum items to include in the RAG context for any single query. */
const MAX_ITEMS = 15;

/**
 * @typedef {Object} RAGContext
 * @property {string}   type     - 'products'|'categories'|'promotions'|'horarios'|'ubicacion'|'mixed'|'empty'
 * @property {object[]} data     - Filtered rows from DB
 * @property {string}   summary  - Human-readable description of what was filtered
 * @property {number}   total    - Total matching items (before limit)
 */

/**
 * Classifies the AI request into a RAG retrieval type.
 *
 * @param {string} normalizedText
 * @param {{ intent: string|null, score: number }} intentResult
 * @param {{ type: string|null, value: string|null }} entity
 * @param {{ lastIntent: string|null, lastEntity: { type: string|null, value: string|null } }} context
 * @returns {'recommendation'|'comparison'|'open_query'|'contextual'|'general'}
 */
function classifyAIRequest(normalizedText, intentResult, entity, context) {
  // Recommendation patterns (includes infinitive "recomendar" and modal "puedes/puede recomendar")
  const RECOMMEND_RE = /\b(?:recomendar|recomiend[ao](?:s|me|n)?|recomendacion|sugier[eo]|sugerencia|que\s+me\s+recomienda[sn]?|que\s+(?:es|esta)\s+bueno|mejor\s+opcion|popular|favorito|(?:puedes?|puede|pueden|podr[ií]as?)\s+recomendar)\b/;
  if (RECOMMEND_RE.test(normalizedText)) return 'recommendation';

  // Comparison patterns
  const COMPARE_RE = /\b(?:compar[aeo]|diferencia|versus|vs|mejor|entre|cual\s+(?:es|conviene)|que\s+(?:es|conviene)\s+mejor)\b/;
  if (COMPARE_RE.test(normalizedText)) return 'comparison';

  // Superlative comparisons: "el/la más barato/a", "cuesta menos", "la mejor", "el mejor"
  const SUPERLATIVE_RE = /\bm[aá]s\s+(?:barat[ao]s?|car[ao]s?|econ[oó]mic[ao]s?|saludables?|buen[ao]s?|mal[ao]s?|populares?)|cuesta\s+menos|menos\s+car[ao]s?|\bel\s+m[aá]s\b|\bla\s+m[aá]s\b|\b(?:el|la|los|las)\s+mejor(?:es)?\b/;
  if (SUPERLATIVE_RE.test(normalizedText)) return 'comparison';

  // Capacity / nutritional questions
  const CAPACITY_RE = /\bcu[aá]nto[as]?\b.{0,50}\b(?:puedo|debo|debería?|conviene|se\s+puede|se\s+recomienda)\b/;
  if (CAPACITY_RE.test(normalizedText)) return 'open_query';

  // If there's a partial intent or entity from context, it's contextual
  if (context?.lastEntity?.value || context?.lastIntent) return 'contextual';

  // If there's a weak intent signal, try open query
  if (intentResult?.score > 0 && intentResult.score < 3) return 'open_query';

  return 'general';
}

/**
 * Extracts comparison candidates ("X o Y", "X vs Y", "X y Y") from text.
 *
 * @param {string} normalizedText
 * @returns {string[]}  Array of 0-2 candidate entity names
 */
function extractComparisonEntities(normalizedText) {
  const patterns = [
    /(?:entre|comparar?)\s+(?:el\s+|la\s+|los\s+|las\s+)?(?<a>[\w\s]+?)\s+(?:y|o|vs|versus|con)\s+(?:el\s+|la\s+|los\s+|las\s+)?(?<b>[\w\s]+?)(?:\?|$)/,
    /(?<a>[\w\s]+?)\s+(?:o|vs|versus)\s+(?<b>[\w\s]+?)(?:\?|$)/,
  ];
  for (const pat of patterns) {
    const m = normalizedText.match(pat);
    if (m?.groups?.a && m?.groups?.b) {
      return [m.groups.a.trim(), m.groups.b.trim()].filter((e) => e.length >= 2);
    }
  }
  return [];
}

/**
 * Filters relevant data from the DB based on the AI request classification.
 *
 * @param {string}   normalizedText
 * @param {number}   businessId
 * @param {{ intent: string|null, score: number }} intentResult
 * @param {{ type: string|null, value: string|null }} entity
 * @param {{ lastIntent: string|null, lastEntity: { type: string|null, value: string|null } }} context
 * @returns {Promise<RAGContext>}
 */
async function filterRelevantData(normalizedText, businessId, intentResult, entity, context) {
  const aiType = classifyAIRequest(normalizedText, intentResult, entity, context);

  try {
    switch (aiType) {
      case 'recommendation': {
        // Words that describe the *request type*, not a product category.
        // If the entity extractor picked one of these, it's useless as a search term.
        const META_WORDS = new Set([
          'recomendacion', 'recomendaciones', 'sugerencia', 'sugerencias',
          'opcion', 'opciones', 'algo', 'producto', 'productos', 'articulo', 'articulos',
        ]);

        const rawEntity      = entity?.value || null;
        const explicitEntity = rawEntity && !META_WORDS.has(rawEntity) ? rawEntity : null;
        const contextEntity  = context?.lastEntity?.value && !META_WORDS.has(context.lastEntity.value)
          ? context.lastEntity.value
          : null;

        // Detect "alternative to X" patterns: "en lugar de", "en vez de", "alternativa a",
        // "sustituto de", "algo similar a", etc. When detected, we want OTHER products, not X.
        const ALT_RE = /\b(?:en\s+lugar\s+de|en\s+vez\s+de|alternativa\s+(?:a|al|de)|sustituto\s+(?:a|de)|similar\s+a|parecido\s+a|cambio\s+de|distinto\s+a|diferente\s+a)\b/;
        const isAlternativeRequest = ALT_RE.test(normalizedText);

        // If entity is a meta-word, extract the first meaningful noun from the text.
        // e.g. "dame recomendacion de herramientas para armar mesa" → "herramientas"
        let textHint = null;
        if (!explicitEntity) {
          const NOISE = new Set([
            'dame', 'deme', 'quiero', 'quisiera', 'necesito', 'busco',
            'de', 'del', 'para', 'una', 'uno', 'unos', 'unas', 'que', 'me', 'con', 'los',
            'las', 'algunos', 'algunas', 'hay', 'armar', 'hacer', 'comprar', 'usar',
            'lugar', 'vez', 'cambio', 'alternativa', 'sustituto',
            ...META_WORDS,
          ]);
          const words = normalizedText.split(/\s+/).filter((w) => w.length > 3 && !NOISE.has(w));
          textHint = words[0] || null;
        }

        const catHint = explicitEntity || contextEntity || textHint;

        const REC_MAX = 8; // smaller than global MAX_ITEMS → shorter prompt → faster inference
        let rows;

        if (isAlternativeRequest && catHint) {
          // User wants alternatives to a specific product (e.g. "en lugar de tornillos").
          // Fetch all products and exclude the reference product so Ollama can reason
          // about what else could serve the same purpose.
          const allResult = await BusinessModel.getProductos(businessId);
          const refNorm   = normalize(catHint);
          rows = allResult
            .filter((p) => !normalize(p.name).includes(refNorm))
            .slice(0, REC_MAX);
          // If exclusion left nothing, just return all (better than empty)
          if (rows.length === 0) rows = allResult.slice(0, REC_MAX);
        } else if (catHint) {
          // If message contains "con X" (attribute filter) AND we have a product type,
          // use compound search so Ollama only sees the relevant filtered products.
          const CON_IN_MSG = /\bcon\s+(?<attr>[\wñ][\wñ\s]{1,30}?)(?:\s*\?)?$/.exec(normalizedText);
          const attrHint = CON_IN_MSG?.groups?.attr?.trim();
          if (attrHint) {
            const PREP_ART = new Set(['de', 'del', 'con', 'sin', 'al', 'a', 'en', 'el', 'la', 'los', 'las', 'un', 'una']);
            const baseNoun = catHint.split(/\s+/).find((w) => !PREP_ART.has(w)) || catHint.split(/\s+/)[0];
            const compound = await searchByCompoundQuery(
              { entity: baseNoun, attribute: attrHint, fullPhrase: `${baseNoun} con ${attrHint}` },
              businessId
            );
            if (compound.rows.length > 0) rows = compound.rows.slice(0, REC_MAX);
          }
          if (!rows) {
            const catBase = catHint.replace(/\s+con\s+.+$/, '').trim() || catHint;
            rows = (await queryProducts(catBase, businessId)).slice(0, REC_MAX);
            if (rows.length === 0 && /\s/.test(catBase)) {
              const firstNoun = catBase.split(/\s+/)[0];
              rows = (await queryProducts(firstNoun, businessId)).slice(0, REC_MAX);
            }
          }
        }

        if (!rows || rows.length === 0) {
          const allResult = await BusinessModel.getProductos(businessId);
          rows = allResult.slice(0, REC_MAX);
        }

        return {
          type: 'products',
          data: _compactProducts(rows, { onlyAvailable: true, maxDescLen: 60 }),
          summary: `${rows.length} productos relevantes para recomendación${
            isAlternativeRequest && catHint ? ` (alternativas a "${catHint}")` : ''
          }`,
          total: rows.length,
          alternativeTo: isAlternativeRequest ? catHint : null,
        };
      }

      case 'comparison': {
        const candidates = extractComparisonEntities(normalizedText);
        const allRows = [];
        for (const cand of candidates) {
          const found = await queryProducts(cand, businessId);
          allRows.push(...found);
        }
        // Deduplicate by id
        const seen = new Set();
        const unique = allRows.filter((r) => {
          if (seen.has(r.id)) return false;
          seen.add(r.id);
          return true;
        });
        if (unique.length === 0) {
          // No explicit X vs Y entities (e.g. superlative: "el más barato", "cuesta menos").
          // Fall back to fetching all products so AI can rank/compare them.
          const all = await BusinessModel.getProductos(businessId);
          const limited = all.slice(0, MAX_ITEMS);
          if (limited.length === 0) {
            return { type: 'empty', data: [], summary: 'No hay productos para comparar', total: 0 };
          }
          return {
            type: 'products',
            data: _compactProducts(limited),
            summary: `${limited.length} productos para comparación/orden`,
            total: all.length,
          };
        }
        return {
          type: 'products',
          data: _compactProducts(unique.slice(0, MAX_ITEMS)),
          summary: `${unique.length} productos para comparación: ${candidates.join(' vs ')}`,
          total: unique.length,
        };
      }

      case 'contextual': {
        // Use context entity/intent to pull relevant data
        const contextEntity = context?.lastEntity?.value;
        const contextIntent = context?.lastIntent;

        if (contextEntity) {
          const rows = await queryProducts(contextEntity, businessId);
          if (rows.length > 0) {
            return {
              type: 'products',
              data: _compactProducts(rows.slice(0, MAX_ITEMS)),
              summary: `${rows.length} productos relacionados con "${contextEntity}"`,
              total: rows.length,
            };
          }
        }

        // Fall back to intent-based data
        if (contextIntent && contextIntent !== 'category_selection') {
          return _fetchByIntent(contextIntent, businessId);
        }

        return { type: 'empty', data: [], summary: 'Contexto sin datos relevantes', total: 0 };
      }

      case 'open_query': {
        // Weak intent signal — fetch data for the best-guess intent
        const guessIntent = intentResult?.intent;
        if (guessIntent) {
          return _fetchByIntent(guessIntent, businessId);
        }
        // No intent → fetch a general product summary
        const products = await BusinessModel.getProductos(businessId);
        const limited = products.slice(0, MAX_ITEMS);
        return {
          type: 'products',
          data: _compactProducts(limited),
          summary: `${limited.length} productos (resumen general, de ${products.length} total)`,
          total: products.length,
        };
      }

      default: {
        // 'general' — minimal data, let AI respond with capabilities
        const categories = await BusinessModel.getCategories(businessId);
        return {
          type: 'categories',
          data: categories,
          summary: `${categories.length} categorías disponibles (consulta general)`,
          total: categories.length,
        };
      }
    }
  } catch (err) {
    console.error('[RAGFilter] Error filtering data:', err.message);
    return { type: 'empty', data: [], summary: 'Error al obtener datos', total: 0 };
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Strips heavy fields from product rows to minimize token usage.
 * @param {object[]} rows
 * @param {{ onlyAvailable?: boolean, maxDescLen?: number }} opts
 * @returns {object[]}
 */
function _compactProducts(rows, { onlyAvailable = false, maxDescLen = 60 } = {}) {
  const filtered = onlyAvailable ? rows.filter((r) => r.is_available !== false) : rows;
  return filtered.map((r) => ({
    name: r.name,
    price: r.price,
    category: r.category ?? null,
    available: r.is_available !== false,
    description: r.description ? r.description.slice(0, maxDescLen) : null,
  }));
}

/**
 * Fetches data by intent name and returns a RAGContext.
 * @param {string} intentName
 * @param {number} businessId
 * @returns {Promise<RAGContext>}
 */
async function _fetchByIntent(intentName, businessId) {
  const INTENT_DATA_MAP = {
    productos: async () => {
      const rows = await BusinessModel.getProductos(businessId);
      return { type: 'products', data: _compactProducts(rows.slice(0, MAX_ITEMS)), summary: `${Math.min(rows.length, MAX_ITEMS)} productos`, total: rows.length };
    },
    precios: async () => {
      const rows = await BusinessModel.getPrecios(businessId);
      return { type: 'products', data: rows.slice(0, MAX_ITEMS).map((r) => ({ name: r.name, price: r.price })), summary: `${Math.min(rows.length, MAX_ITEMS)} precios`, total: rows.length };
    },
    promociones: async () => {
      const rows = await BusinessModel.getPromociones(businessId);
      return { type: 'promotions', data: rows.slice(0, MAX_ITEMS), summary: `${rows.length} promociones activas`, total: rows.length };
    },
    horarios: async () => {
      const rows = await BusinessModel.getHorarios(businessId);
      return { type: 'horarios', data: rows, summary: `${rows.length} dias de horario`, total: rows.length };
    },
    ubicacion: async () => {
      const row = await BusinessModel.getUbicacion(businessId);
      return { type: 'ubicacion', data: row ? [row] : [], summary: row ? 'Datos de ubicación' : 'Sin ubicación', total: row ? 1 : 0 };
    },
  };

  const fetcher = INTENT_DATA_MAP[intentName];
  if (fetcher) return fetcher();

  return { type: 'empty', data: [], summary: `Sin handler para intent "${intentName}"`, total: 0 };
}

export {
  filterRelevantData,
  classifyAIRequest,
  extractComparisonEntities,
  MAX_ITEMS,
};

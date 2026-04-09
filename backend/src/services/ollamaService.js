'use strict';

/**
 * src/services/ollamaService.js
 *
 * OLLAMA SERVICE — Integrates a local Ollama LLM as the AI fallback when the
 * deterministic NLP pipeline cannot resolve the user's message.
 *
 * HOW IT FITS IN THE PIPELINE:
 *   messagePipeline.handleAIFallback()
 *     → ragFilterService.filterRelevantData()   (only fetches relevant DB rows)
 *     → ollamaService.generateOllamaResponse()  ← THIS MODULE
 *     → getMockOpenAIResponse()                  (final fallback if Ollama is down)
 *
 * DESIGN:
 *   • Builds a business-aware system prompt from the DB profile + RAG context.
 *   • The prompt always identifies the business name, giro (category), and any
 *     relevant data already fetched by the RAG filter (products, promotions, etc.).
 *   • Calls POST /api/chat on Ollama (non-streaming, JSON mode).
 *   • Returns null on any error so the caller can degrade gracefully to the mock.
 *   • Caches the business profile in memory (keyed by businessId) — business
 *     data rarely changes, so a single DB round-trip per server lifetime is fine.
 *
 * SCALABILITY:
 *   • Model, URL and timeout are configurable via environment variables.
 *   • Swap OLLAMA_MODEL to any model pulled in Ollama without touching code.
 *   • Multi-tenant safe: each businessId gets its own system prompt built from
 *     its own DB profile — no data bleeds between businesses.
 *   • ragContext is already size-capped by ragFilterService (MAX_ITEMS = 15),
 *     so token usage stays bounded.
 *
 * CONFIGURATION (env vars / src/config/env.js):
 *   OLLAMA_URL         — Base URL of the Ollama server (default: http://localhost:11434)
 *   OLLAMA_MODEL       — Model name to use             (default: llama3.2)
 *   OLLAMA_TIMEOUT_MS  — HTTP timeout in milliseconds  (default: 30000)
 */

const env = require('../config/env');
const BusinessModel = require('../models/businessModel');
const { getHistory } = require('./redisService');

// ─── Configuration ────────────────────────────────────────────────────────────

const OLLAMA_URL        = env.OLLAMA_URL        || 'http://localhost:11434';
const OLLAMA_MODEL      = env.OLLAMA_MODEL      || 'llama3.2';
const OLLAMA_TIMEOUT_MS = env.OLLAMA_TIMEOUT_MS || 30_000;

// ─── Business profile cache ───────────────────────────────────────────────────

/**
 * Simple in-memory cache for business profiles.
 * Business data changes infrequently, so a single DB read per server lifetime
 * per businessId is acceptable.
 * @type {Map<number, object>}
 */
const _profileCache = new Map();

/**
 * Maps the `businesses.category` DB enum to a readable Spanish giro description.
 * Add new categories here when the schema is extended.
 */
const CATEGORY_LABELS = {
  restaurant: 'restaurante / negocio de alimentos y bebidas',
  hardware:   'ferretería / tienda de materiales y herramientas',
  stationery: 'papelería / artículos de oficina y escolares',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Fetches the full profile for a business (name, category/giro, description,
 * city, phone, email, webpage_link) with in-memory caching.
 *
 * @param {number} businessId
 * @returns {Promise<object|null>}
 */
async function getBusinessProfile(businessId) {
  if (_profileCache.has(businessId)) {
    return _profileCache.get(businessId);
  }
  const profile = await BusinessModel.getProfile(businessId);
  if (profile) _profileCache.set(businessId, profile);
  return profile;
}

/**
 * Invalidates the cached profile for a business (call after admin updates).
 * @param {number} businessId
 */
function invalidateProfile(businessId) {
  _profileCache.delete(businessId);
}

/**
 * Serializes the RAG context data into a compact, readable text block
 * for inclusion in the system prompt.
 *
 * @param {{ type: string, data: object[], summary: string }} ragContext
 * @returns {string}  Empty string if no useful data.
 */
function formatRagBlock(ragContext) {
  if (!ragContext || ragContext.type === 'empty' || !ragContext.data?.length) {
    return '';
  }

  const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const lines = [];

  switch (ragContext.type) {
    case 'products': {
      lines.push('PRODUCTOS / PRECIOS DISPONIBLES:');
      for (const p of ragContext.data) {
        const price = p.price != null ? ` — $${Number(p.price).toFixed(2)}` : '';
        const cat   = p.category ? ` [${p.category}]` : '';
        const desc  = p.description ? ` (${p.description})` : '';
        const avail = p.available === false ? ' ⚠ no disponible' : '';
        lines.push(`  • ${p.name}${cat}${price}${desc}${avail}`);
      }
      break;
    }

    case 'promotions': {
      lines.push('PROMOCIONES ACTIVAS:');
      for (const p of ragContext.data) {
        const discount = p.discount_type === 'percent'
          ? `${p.discount_value}% de descuento`
          : `$${Number(p.discount_value).toFixed(2)} de descuento`;
        const desc = p.description ? `: ${p.description}` : '';
        lines.push(`  • ${p.title}${desc} (${discount})`);
      }
      break;
    }

    case 'horarios': {
      lines.push('HORARIOS DE ATENCIÓN:');
      for (const h of ragContext.data) {
        const dayName = DAYS[h.day_of_week] ?? `Día ${h.day_of_week}`;
        if (h.is_closed) {
          lines.push(`  • ${dayName}: Cerrado`);
        } else {
          lines.push(`  • ${dayName}: ${h.open_time} – ${h.close_time}`);
        }
      }
      break;
    }

    case 'ubicacion': {
      const u = ragContext.data[0];
      if (u) {
        lines.push('UBICACIÓN:');
        if (u.city)         lines.push(`  • Ciudad: ${u.city}`);
        if (u.webpage_link) lines.push(`  • Web: ${u.webpage_link}`);
      }
      break;
    }

    case 'services': {
      lines.push('SERVICIOS OFRECIDOS:');
      for (const s of ragContext.data) {
        const price = s.price != null ? ` — $${Number(s.price).toFixed(2)}` : '';
        const desc  = s.description ? ` (${s.description})` : '';
        lines.push(`  • ${s.name}${price}${desc}`);
      }
      break;
    }

    default: {
      // mixed / unknown type — include a compact JSON snippet
      lines.push('DATOS RELEVANTES:');
      lines.push(JSON.stringify(ragContext.data).slice(0, 600));
      break;
    }
  }

  return lines.join('\n');
}

/**
 * Builds the Ollama system prompt for the given business and RAG context.
 *
 * The prompt tells the model:
 *   1. Who it is (business name + giro)
 *   2. Business description, contact and location (from DB profile)
 *   3. The specific data relevant to the user's query (from RAG filter)
 *   4. Behavioral instructions (Spanish only, no hallucination, concise)
 *
 * @param {{ name: string, category: string, description: string|null, city: string|null, phone: string|null, email: string|null, webpage_link: string|null }} profile
 * @param {{ type: string, data: object[], summary: string }|null} ragContext
 * @returns {string}
 */
function buildSystemPrompt(profile, ragContext) {
  const giro    = CATEGORY_LABELS[profile.category] ?? profile.category;
  const contact = [
    profile.phone        && `Teléfono: ${profile.phone}`,
    profile.email        && `Email: ${profile.email}`,
    profile.webpage_link && `Web: ${profile.webpage_link}`,
    profile.city         && `Ciudad: ${profile.city}`,
  ].filter(Boolean).join(' | ');

  const ragBlock = formatRagBlock(ragContext);

  const desc = profile.description ? profile.description.slice(0, 80) : null;

  const parts = [
    `Asistente de "${profile.name}" (${giro}).`,
    desc    ? `Info: ${desc}` : null,
    contact ? `Contacto: ${contact}` : null,
    ragBlock ? `\n${ragBlock}` : null,
    '\nReglas: responde en español, máx 2 oraciones, solo datos del contexto, sin inventar.',
  ];

  return parts.filter((l) => l !== null).join('\n');
}

/**
 * Makes the HTTP call to Ollama's /api/chat endpoint.
 *
 * Uses AbortController to enforce the configured timeout.
 * Throws on network error, non-2xx status, or empty model response.
 *
 * @param {string} systemPrompt
 * @param {string} userMessage
 * @returns {Promise<string>}
 */
async function _callOllama(systemPrompt, userMessage, historyMessages = []) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

  try {
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model:  OLLAMA_MODEL,
        stream: false,
        messages: [
          { role: 'system', content: systemPrompt },
          ...historyMessages,
          { role: 'user',   content: userMessage  },
        ],
        options: {
          temperature: 0.3,
          num_predict: 80,
          num_ctx:     1024,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama HTTP ${response.status}`);
    }

    const json = await response.json();
    const content = json?.message?.content;
    if (!content || typeof content !== 'string' || content.trim() === '') {
      throw new Error('Ollama returned empty content');
    }
    return content.trim();
  } finally {
    clearTimeout(timer);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generates a response using the local Ollama model with full business context.
 *
 * This is the main entry-point called from messagePipeline.handleAIFallback().
 * It will:
 *   1. Load the business profile from cache or DB.
 *   2. Build a context-aware system prompt (profile + RAG data).
 *   3. Call Ollama's /api/chat.
 *   4. Return the model's reply, or null if Ollama is unavailable.
 *
 * Returning null allows the pipeline to degrade gracefully to the mock fallback.
 *
 * @param {string}  userMessage     Raw user message (as typed, not normalized)
 * @param {{ type: string, data: object[], summary: string }|null} ragContext
 * @param {{ lastIntent: string|null, lastEntity: object|null }} sessionContext
 * @param {number}  businessId
 * @returns {Promise<string|null>}  Model reply, or null on error/unavailability
 */
async function generateOllamaResponse(userMessage, ragContext, sessionContext, businessId, sessionId = null) {
  try {
    const profile = await getBusinessProfile(businessId);
    if (!profile) {
      console.warn(`[Ollama] No business profile found for id=${businessId}`);
      return null;
    }
    const systemPrompt = buildSystemPrompt(profile, ragContext);

    // Build last 2 turns from Redis history to give Ollama conversational context
    let historyMessages = [];
    if (sessionId) {
      try {
        const history = await getHistory(businessId, sessionId);
        const recent = history.slice(-4); // last 4 entries = 2 turns
        historyMessages = recent
          .filter((m) => m?.sender && m?.text)
          .map((m) => ({
            role: m.sender === 'user' ? 'user' : 'assistant',
            content: m.text.slice(0, 200),
          }));
      } catch { /* non-fatal */ }
    }

    const reply = await _callOllama(systemPrompt, userMessage, historyMessages);
    console.log(`[Ollama] Response for business=${businessId} (${reply.length} chars)`);
    return reply;
  } catch (err) {
    const hint = err.name === 'AbortError' || err.message.includes('aborted')
      ? `timeout after ${OLLAMA_TIMEOUT_MS / 1000}s — model may still be loading`
      : err.message;
    console.warn('[Ollama] Unavailable or error — falling back to mock:', hint);
    return null;
  }
}

/**
 * Warms up the Ollama model at server startup so the first real user request
 * doesn't hit the cold-start delay (model loading into VRAM/RAM).
 *
 * Fires-and-forgets: errors are logged but never thrown.
 * Call once from server.js after the HTTP server starts.
 */
async function warmupOllama() {
  console.log(`[Ollama] Warming up model "${OLLAMA_MODEL}" at ${OLLAMA_URL} …`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
  try {
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        messages: [{ role: 'user', content: 'hola' }],
        options: { num_predict: 1 },
      }),
    });
    if (response.ok) {
      console.log(`[Ollama] ✓ Model "${OLLAMA_MODEL}" ready`);
    } else {
      console.warn(`[Ollama] Warmup got HTTP ${response.status} — check model name`);
    }
  } catch (err) {
    const hint = err.name === 'AbortError' || err.message.includes('aborted')
      ? 'timeout — model may need more time, or Ollama is not running'
      : err.message;
    console.warn('[Ollama] Warmup failed:', hint);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  generateOllamaResponse,
  buildSystemPrompt,
  formatRagBlock,
  invalidateProfile,
  warmupOllama,
};


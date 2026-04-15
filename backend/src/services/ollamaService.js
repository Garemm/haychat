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

import { OLLAMA_URL as _OLLAMA_URL, OLLAMA_MODEL as _OLLAMA_MODEL, OLLAMA_TIMEOUT_MS as _OLLAMA_TIMEOUT_MS } from '../config/env.js';
import BusinessModel from '../models/businessModel.js';
import { getHistory } from './redisService.js';
import { getProfile } from './userProfileService.js';

// ─── Configuration ────────────────────────────────────────────────────────────

const OLLAMA_URL        = _OLLAMA_URL        || 'http://localhost:11434';
const OLLAMA_MODEL      = _OLLAMA_MODEL      || 'llama3:latest';
const OLLAMA_TIMEOUT_MS = _OLLAMA_TIMEOUT_MS || 30_000;

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
 * Builds the Ollama system prompt for the given business, RAG context, and user profile.
 *
 * The prompt tells the model:
 *   1. Who it is (business name + giro) and its personality
 *   2. Business description, contact and location (from DB profile)
 *   3. The specific data relevant to the user's query (from RAG filter)
 *   4. Any known user preferences / name from the profile (personalization)
 *   5. Behavioral instructions: natural, human-like, concise but not robotic
 *
 * @param {{ name: string, category: string, description: string|null, city: string|null, phone: string|null, email: string|null, webpage_link: string|null }} profile
 * @param {{ type: string, data: object[], summary: string }|null} ragContext
 * @param {{ name: string|null, rejectedEntities: string[], visitCount: number }} userProfile
 * @returns {string}
 */
function buildSystemPrompt(profile, ragContext, userProfile = {}) {
  const giro    = CATEGORY_LABELS[profile.category] ?? profile.category;
  const contact = [
    profile.phone        && `Teléfono: ${profile.phone}`,
    profile.email        && `Email: ${profile.email}`,
    profile.webpage_link && `Web: ${profile.webpage_link}`,
    profile.city         && `Ciudad: ${profile.city}`,
  ].filter(Boolean).join(' | ');

  const ragBlock = formatRagBlock(ragContext);

  const desc = profile.description ? profile.description.slice(0, 120) : null;

  // Personalization block — only included when we know something about the user
  const userName     = userProfile.name || null;
  const rejected     = Array.isArray(userProfile.rejectedEntities) && userProfile.rejectedEntities.length > 0
    ? userProfile.rejectedEntities.join(', ')
    : null;
  const isReturning  = (userProfile.visitCount || 0) > 3;

  const personBlock = [
    userName   ? `El usuario se llama ${userName}.` : null,
    rejected   ? `El usuario no quiere: ${rejected}. Nunca sugieras estos.` : null,
    isReturning ? `Es un cliente recurrente — puedes ser más familiar y cercano.` : null,
  ].filter(Boolean).join(' ');

  const parts = [
    `Eres el asistente de chat de "${profile.name}" (${giro}).`,
    `Tu personalidad: amable, natural, cercano — como un empleado real que conoce el negocio.`,
    desc    ? `Sobre el negocio: ${desc}` : null,
    contact ? `Contacto: ${contact}` : null,
    ragBlock ? `\n${ragBlock}` : null,
    personBlock ? `\nPerfil del usuario: ${personBlock}` : null,
    [
      '\nInstrucciones:',
      '- Responde siempre en español, en tono conversacional y natural.',
      '- Sé conciso pero completo. Usa 1-3 oraciones normalmente; más si el usuario pide detalle.',
      '- Si el usuario mencionó algo antes en la conversación, puedes referenciarlo naturalmente.',
      '- Usa ÚNICAMENTE la información del contexto proporcionado. No inventes precios ni datos.',
      '- Si no sabes algo, dilo honestamente y ofrece alternativas.',
      '- No repitas saludos si ya hablaste con el usuario en este chat.',
    ].join('\n'),
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
          temperature: 0.4,
          num_predict: 200,  // was 80 — allow natural, complete sentences
          num_ctx:     2048, // was 1024 — fits 6 turns + system prompt comfortably
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
 *   2. Load the user profile (name, preferences) for personalization.
 *   3. Build a context-aware system prompt (profile + RAG data + user preferences).
 *   4. Inject the last 6 turns (12 messages) of history for coherent conversation.
 *   5. Call Ollama's /api/chat.
 *   6. Return the model's reply, or null if Ollama is unavailable.
 *
 * Returning null allows the pipeline to degrade gracefully to the mock fallback.
 *
 * @param {string}  userMessage     Raw user message (as typed, not normalized)
 * @param {{ type: string, data: object[], summary: string }|null} ragContext
 * @param {{ lastIntent: string|null, lastEntity: object|null }} sessionContext
 * @param {number}  businessId
 * @param {string|null} sessionId
 * @returns {Promise<string|null>}  Model reply, or null on error/unavailability
 */
async function generateOllamaResponse(userMessage, ragContext, sessionContext, businessId, sessionId = null) {
  try {
    const profile = await getBusinessProfile(businessId);
    if (!profile) {
      console.warn(`[Ollama] No business profile found for id=${businessId}`);
      return null;
    }

    // Load user profile for personalization (name, rejected entities, visit count)
    let userProfile = { name: null, rejectedEntities: [], visitCount: 0 };
    if (sessionId) {
      try { userProfile = await getProfile(businessId, sessionId); } catch { /* non-fatal */ }
    }

    const systemPrompt = buildSystemPrompt(profile, ragContext, userProfile);

    // Build last 6 turns (12 messages) from Redis history for conversational continuity.
    // 6 turns is enough to avoid context drift without pushing the num_ctx limit.
    let historyMessages = [];
    if (sessionId) {
      try {
        const history = await getHistory(businessId, sessionId);
        // Exclude the very last entry — it's the current user message being processed,
        // already sent as the final 'user' role message in _callOllama.
        const recent = history.slice(-13, -1); // up to 12 previous messages
        historyMessages = recent
          .filter((m) => m?.role && m?.text)
          .map((m) => ({
            role: m.role === 'user' ? 'user' : 'assistant',
            // Truncate at word boundary to avoid cutting mid-word
            content: m.text.length > 500
              ? m.text.slice(0, 500).replace(/\s\S*$/, '…')
              : m.text,
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

export {
  generateOllamaResponse,
  buildSystemPrompt,
  formatRagBlock,
  invalidateProfile,
  warmupOllama,
};


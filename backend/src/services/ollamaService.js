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

/**
 * Resolved model name — may differ from OLLAMA_MODEL if the configured name
 * is a prefix (e.g. "llama3" resolves to "llama3.2:latest").
 * Set by warmupOllama(); falls back to OLLAMA_MODEL until warmup completes.
 */
let _activeModel = OLLAMA_MODEL;

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
        // Cap description inline as a safety net (ragFilter already limits, but just in case)
        const rawDesc = p.description ? p.description.slice(0, 50) : null;
        const desc  = rawDesc ? ` (${rawDesc})` : '';
        lines.push(`  • ${p.name}${cat}${price}${desc}`);
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

  // If the RAG service detected an "alternative to X" request, add a directive
  // so the model knows it should recommend DIFFERENT products, not X itself.
  const altHint = ragContext?.alternativeTo
    ? `\nNota: El usuario quiere alternativas a "${ragContext.alternativeTo}". Recomienda productos diferentes; no menciones "${ragContext.alternativeTo}" como opción.`
    : null;

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
    altHint  ? altHint : null,
    personBlock ? `\nPerfil del usuario: ${personBlock}` : null,
    [
      '\nInstrucciones:',
      '- Responde en español, tono conversacional, 1-3 oraciones (más si piden detalle).',
      '- Usa SOLO la información del contexto. No inventes precios ni datos.',
      '- NO incluyas teléfono, email ni web a menos que el usuario los pida explícitamente.',
      '- Si no sabes algo, dilo y ofrece alternativas. No repitas saludos.',
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
 * When `onToken` is provided the request uses Ollama's NDJSON streaming mode:
 * each token is forwarded to `onToken(token)` as it arrives, so the caller
 * can push it to the client in real time.  The full assembled string is still
 * returned when the stream is complete.
 *
 * @param {string}   systemPrompt
 * @param {string}   userMessage
 * @param {object[]} historyMessages
 * @param {((token: string) => void) | null} onToken  — streaming callback
 * @returns {Promise<string>}
 */
async function _callOllama(systemPrompt, userMessage, historyMessages = [], onToken = null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

  try {
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model:  _activeModel,
        stream: true,   // always stream — onToken forwards tokens; without it we just collect
        messages: [
          { role: 'system', content: systemPrompt },
          ...historyMessages,
          { role: 'user',   content: userMessage  },
        ],
        options: {
          temperature: 0.4,
          num_predict: 220,  // ~4-5 oraciones; más que 120 para no cortar respuestas
          num_ctx:     1024, // ventana reducida → menos memoria procesada → mayor velocidad
          num_thread:  0,    // 0 = auto-detect: usa todos los núcleos disponibles
          top_k:       40,
          top_p:       0.9,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama HTTP ${response.status}`);
    }

    // Read the NDJSON stream line by line
    const reader  = response.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';
    let buffer      = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep last (possibly incomplete) line

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data  = JSON.parse(line);
          const token = data?.message?.content;
          if (token) {
            fullContent += token;
            onToken?.(token);
          }
        } catch { /* skip malformed NDJSON line */ }
      }
    }

    if (!fullContent.trim()) throw new Error('Ollama returned empty content');
    return fullContent.trim();
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
async function generateOllamaResponse(userMessage, ragContext, sessionContext, businessId, sessionId = null, onToken = null) {
  try {
    // Parallelize all three async lookups — they are independent of each other.
    const [profile, userProfileRaw, historyRaw] = await Promise.all([
      getBusinessProfile(businessId),
      sessionId ? getProfile(businessId, sessionId).catch(() => null) : Promise.resolve(null),
      sessionId ? getHistory(businessId, sessionId).catch(() => [])   : Promise.resolve([]),
    ]);

    if (!profile) {
      console.warn(`[Ollama] No business profile found for id=${businessId}`);
      return null;
    }

    const userProfile = userProfileRaw ?? { name: null, rejectedEntities: [], visitCount: 0 };

    const systemPrompt = buildSystemPrompt(profile, ragContext, userProfile);

    // Build last 3 turns (6 messages) from Redis history for conversational continuity.
    // Reduced from 6 turns to keep context window small and improve response speed.
    const recent = historyRaw.slice(-7, -1); // up to 6 previous messages (3 turns)
    const historyMessages = recent
      .filter((m) => m?.role && m?.text)
      .map((m) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        // Shorter truncation keeps context window lean for faster inference
        content: m.text.length > 200
          ? m.text.slice(0, 200).replace(/\s\S*$/, '…')
          : m.text,
      }));

    const reply = await _callOllama(systemPrompt, userMessage, historyMessages, onToken);
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
 * Queries Ollama's /api/tags to list all locally pulled models.
 * Returns an array of model name strings, or null on error.
 *
 * @returns {Promise<string[]|null>}
 */
async function listOllamaModels() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return null;
    const json = await res.json();
    return (json?.models ?? []).map((m) => m.name);
  } catch {
    return null;
  }
}

/**
 * Warms up the Ollama model at server startup so the first real user request
 * doesn't hit the cold-start delay (model loading into VRAM/RAM).
 *
 * Uses a longer timeout (5 min) than regular requests because cold-start on
 * CPU-only machines can take several minutes.
 *
 * Fires-and-forgets: errors are logged but never thrown.
 * Call once from server.js after the HTTP server starts.
 */
async function warmupOllama() {
  // ── 1. Verify Ollama is reachable and the model exists ───────────────────
  const available = await listOllamaModels();
  if (available === null) {
    console.warn(`[Ollama] ⚠ Cannot reach Ollama at ${OLLAMA_URL} — service may not be running.`);
    return;
  }

  if (available.length === 0) {
    console.warn(`[Ollama] ⚠ No models found. Pull one with:  ollama pull llama3`);
    return;
  }

  // Check for exact match first, then prefix match (e.g. "llama3" matches "llama3:latest")
  const exactMatch  = available.includes(OLLAMA_MODEL);
  const prefixMatch = !exactMatch && available.find(
    (m) => m.startsWith(OLLAMA_MODEL.split(':')[0])
  );

  if (!exactMatch && !prefixMatch) {
    console.warn(
      `[Ollama] ⚠ Model "${OLLAMA_MODEL}" not found locally.\n` +
      `         Available models: ${available.join(', ')}\n` +
      `         Set OLLAMA_MODEL env var to one of the above, or run:  ollama pull ${OLLAMA_MODEL}`
    );
    return;
  }

  const resolvedModel = exactMatch ? OLLAMA_MODEL : prefixMatch;
  if (!exactMatch) {
    console.log(`[Ollama] Model "${OLLAMA_MODEL}" resolved to "${resolvedModel}"`);
  }

  // Store the resolved name so _callOllama uses the correct model tag
  _activeModel = resolvedModel;

  // ── 2. Warm up with a generous timeout (cold start can take minutes) ─────
  const WARMUP_TIMEOUT = Math.max(OLLAMA_TIMEOUT_MS, 300_000); // at least 5 min
  console.log(`[Ollama] Warming up model "${resolvedModel}" at ${OLLAMA_URL} (timeout ${WARMUP_TIMEOUT / 1000}s) …`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WARMUP_TIMEOUT);
  try {
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: resolvedModel,
        stream: false,
        messages: [{ role: 'user', content: 'hola' }],
        options: { num_predict: 1 },
      }),
    });
    if (response.ok) {
      console.log(`[Ollama] ✓ Model "${resolvedModel}" ready`);
    } else {
      console.warn(`[Ollama] Warmup got HTTP ${response.status} — check model name`);
    }
  } catch (err) {
    const hint = err.name === 'AbortError' || err.message.includes('aborted')
      ? `timeout after ${WARMUP_TIMEOUT / 1000}s — model is still loading (large models can take several minutes on CPU)`
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
  listOllamaModels,
};


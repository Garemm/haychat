/**
 * src/services/redisService.js
 *
 * REDIS SERVICE — Single module for ALL Redis operations in the chat.
 *
 * KEY SCHEMA (strict, collision-free):
 *
 *   Context  (NLP state, short-lived):
 *     key:  ctx:<businessId>:<sessionId>
 *     TTL:  CTX_TTL_SECONDS  (1800 s = 30 min)
 *     type: Redis String (JSON)
 *     use:  lastIntent, lastEntity, pagination — NLP pipeline only
 *
 *   History  (full chat messages, sliding TTL):
 *     key:  hist:<businessId>:<sessionId>
 *     TTL:  HIST_TTL_SECONDS (21600 s = 6 h, resets on every message)
 *     type: Redis List (RPUSH / LRANGE)
 *     use:  message display in UI + Ollama conversation history
 *
 *   User Profile  (long-term user memory):
 *     key:  profile:<businessId>:<sessionId>
 *     TTL:  30 days (managed by userProfileService.js)
 *     type: Redis Hash
 *     use:  name, rejectedEntities, visitCount, preferences
 *
 * ISOLATION GUARANTEE:
 *   All keys include <businessId> AND <sessionId>, so two users sharing the
 *   same display name can never collide, and business data never crosses tenants.
 *
 * MEMORY SAFETY:
 *   Every write resets the TTL.  No key ever lives indefinitely.
 *   History TTL is sliding (reset on every message) so active conversations
 *   never expire mid-session.
 *
 * RESILIENCE:
 *   All functions catch Redis errors and degrade gracefully — the chat works
 *   (without history or context) even when Redis is unreachable.
 */

import redis, { isRedisUp } from '../config/redis.js';
import { addRejectedEntity as profileAddRejected } from './userProfileService.js';

// ─── TTL constants ─────────────────────────────────────────────────────────────
// Rule ram-ttl: always set TTL on cache keys to prevent unbounded growth.
// CTX_TTL: 30 min — generous enough for natural conversation pauses.
//   10 min was too short: a user who pauses to read a menu for 12 minutes
//   would lose all NLP context and the bot would lose track of the topic.
const CTX_TTL_SECONDS  = 1800;   // 30 minutes — conversational context window
const HIST_TTL_SECONDS = 21600;  // 6 hours     — message history window (sliding)

/**
 * Maximum messages stored in a history list at write time (LTRIM on every RPUSH).
 * Rule conn-blocking: prevents LRANGE on unboundedly large lists.
 * 500 messages ≈ 250 turns — far more than any real chat session needs in memory.
 */
const HIST_MAX_MESSAGES = 500;

/**
 * Maximum messages read from history in a single LRANGE call.
 * Rule conn-blocking: LRANGE 0 -1 on a large list is a slow command.
 * Reading the last 200 messages gives ~100 turns — enough for full context.
 */
const HIST_READ_LIMIT = 200;

/** Maximum turns kept in topicMemory ring buffer per session. */
const MAX_TOPIC_MEMORY = 6;

// ─── Key builders ──────────────────────────────────────────────────────────────

function ctxKey(businessId, sessionId) {
  return `ctx:${businessId}:${sessionId}`;
}

function histKey(businessId, sessionId) {
  return `hist:${businessId}:${sessionId}`;
}

// ══════════════════════════════════════════════════════════════════════════════
//  CONTEXT — NLP state (short-lived)
// ══════════════════════════════════════════════════════════════════════════════

/** Empty context — returned for new sessions or when Redis is unavailable. */
const EMPTY_CONTEXT = {
  lastIntent:       null,
  lastEntity:       { type: null, value: null },
  lastAttributes:   null,
  updatedAt:        null,
  // Multi-turn memory — rolling window of recent topics discussed
  // Each entry: { intent: string|null, entity: object, found: boolean, ts: number }
  topicMemory:      [],
  // Negation tracking — entities/terms the user explicitly rejected
  // Populated by detectNegation() → stored by addRejectedEntity()
  rejectedEntities: [],
};

// In-process fallback used during transient Redis outages.
// Prevents context loss when Redis connection drops momentarily.
const _ctxMem = new Map();

function _memGet(key) {
  const entry = _ctxMem.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) { _ctxMem.delete(key); return null; }
  return entry.value;
}

function _memSet(key, value) {
  if (_ctxMem.size >= 2000) {
    // Evict oldest entry to keep memory bounded
    _ctxMem.delete(_ctxMem.keys().next().value);
  }
  _ctxMem.set(key, { value, expiresAt: Date.now() + CTX_TTL_SECONDS * 1000 });
}

function _parseContext(raw) {
  const parsed = JSON.parse(raw);
  // Migrate legacy format: { lastProduct } → { lastEntity: { type, value } }
  if (parsed.lastProduct !== undefined && parsed.lastEntity === undefined) {
    parsed.lastEntity = parsed.lastProduct
      ? { type: 'product', value: parsed.lastProduct }
      : { type: null, value: null };
    delete parsed.lastProduct;
    delete parsed.lastEntities;
  }
  if (!parsed.lastEntity || typeof parsed.lastEntity !== 'object') {
    parsed.lastEntity = { type: null, value: null };
  }
  return parsed;
}

/**
 * Reads the NLP context for a session.
 * Falls back to in-process memory when Redis is unavailable.
 *
 * @param {number|string} businessId
 * @param {string}        sessionId  UUID generated by the frontend
 * @returns {Promise<object>}
 */
async function getContext(businessId, sessionId) {
  const key = ctxKey(businessId, sessionId);
  try {
    const raw = await redis.get(key);
    if (!raw) return { ...EMPTY_CONTEXT };
    _memSet(key, raw);
    return _parseContext(raw);
  } catch (err) {
    if (isRedisUp()) console.warn('[Redis] getContext error:', err.message);
    const memRaw = _memGet(key);
    if (memRaw) {
      try { return _parseContext(memRaw); } catch { /* corrupt — fall through */ }
    }
    return { ...EMPTY_CONTEXT };
  }
}

/**
 * Persists (merges) NLP context for a session.
 * Writes to in-process memory first, then to Redis.
 *
 * @param {number|string} businessId
 * @param {string}        sessionId
 * @param {object}        data   Partial fields to merge
 * @returns {Promise<void>}
 */
async function updateContext(businessId, sessionId, data) {
  const key = ctxKey(businessId, sessionId);
  try {
    const current    = await getContext(businessId, sessionId);
    const updated    = { ...current, ...data, updatedAt: new Date().toISOString() };
    const serialized = JSON.stringify(updated);
    _memSet(key, serialized);                           // memory-first
    await redis.setex(key, CTX_TTL_SECONDS, serialized);
  } catch (err) {
    if (isRedisUp()) console.warn('[Redis] updateContext error:', err.message);
    // In-memory write already done — context survives Redis failure
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  HISTORY — Full message log (longer-lived)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Retrieves the full message history for a session.
 * Returns an empty array when no history exists or Redis is unavailable.
 *
 * @param {number|string} businessId
 * @param {string}        sessionId
 * @returns {Promise<Array<{sender: string, text: string, timestamp: string}>>}
 */
/**
 * Returns the most recent HIST_READ_LIMIT messages for the session.
 *
 * Rule conn-blocking: replaced LRANGE 0 -1 (full scan of the list) with
 * LRANGE -HIST_READ_LIMIT -1 which reads only the tail.  This is O(1) in
 * terms of CPU cost regardless of how many messages the session has.
 *
 * The old stale-count loop that manually trimmed leading expired messages is
 * removed.  It is now superseded by:
 *   1. HIST_TTL_SECONDS expiry on the key itself (key deleted when session ends)
 *   2. LTRIM to -HIST_MAX_MESSAGES on every write (keeps the list bounded)
 * Together those two mechanisms ensure LRANGE never reads stale content.
 *
 * @param {number|string} businessId
 * @param {string}        sessionId
 * @returns {Promise<Array<{sender:string, text:string, timestamp:string}>>}
 */
async function getHistory(businessId, sessionId) {
  const key = histKey(businessId, sessionId);
  try {
    // Read only the last HIST_READ_LIMIT entries — bounded, O(log N + M) Redis cost.
    const items = await redis.lrange(key, -HIST_READ_LIMIT, -1);
    if (items.length === 0) return [];

    return items.map((raw) => {
      try { return JSON.parse(raw); } catch { return null; }
    }).filter(Boolean);
  } catch (err) {
    if (isRedisUp()) console.warn('[Redis] getHistory error:', err.message);
    return [];
  }
}

/**
 * Appends a single message to the session's history list and resets the
 * 6-hour sliding TTL.
 *
 * Rule conn-pipelining: batches RPUSH + EXPIRE + LTRIM into a single round
 * trip instead of 2-3 separate commands.
 *
 * Rule conn-blocking: LTRIM keeps the list bounded at HIST_MAX_MESSAGES so
 * that LRANGE never scans an unboundedly large list.
 *
 * @param {number|string} businessId
 * @param {string}        sessionId
 * @param {{ sender: string, text: string, timestamp: string }} message
 * @returns {Promise<void>}
 */
async function saveMessage(businessId, sessionId, message) {
  const key = histKey(businessId, sessionId);
  try {
    const serialized = JSON.stringify(message);
    // Pipeline: 3 ops in 1 round trip.
    //   RPUSH  — append message (oldest-first order)
    //   EXPIRE — sliding TTL reset on every message so active conversations
    //            never expire mid-session
    //   LTRIM  — cap list at HIST_MAX_MESSAGES to prevent unbounded growth
    //            and protect against slow LRANGE on huge lists
    await redis.pipeline()
      .rpush(key, serialized)
      .expire(key, HIST_TTL_SECONDS)
      .ltrim(key, -HIST_MAX_MESSAGES, -1)
      .exec();
  } catch (err) {
    if (isRedisUp()) console.warn('[Redis] saveMessage error:', err.message);
    // Non-fatal: UI may not show this message after refresh, but chat continues
  }
}

// ══════════════════════════════════════════════════════════════════════════════
//  EXPANDED INTENTS DICTIONARY — cached morphological expansions
// ══════════════════════════════════════════════════════════════════════════════

/**
 * TTL for the expanded intents dictionary stored in Redis.
 * Refreshed on every server startup via bootstrapIntents().
 * 7 days is generous: the server starts far more frequently.
 */
const INTENTS_TTL = 604800; // 7 days

function _intentsKey() {
  return 'intents:expanded';
}

/**
 * Persists the morphologically expanded intents dictionary to Redis.
 * Called by intentExpanderService.bootstrapIntents() at server startup.
 *
 * @param {object} dict  Expanded intents object (same shape as intents.js).
 * @returns {Promise<void>}
 */
async function saveExpandedIntents(dict) {
  try {
    await redis.setex(_intentsKey(), INTENTS_TTL, JSON.stringify(dict));
  } catch (err) {
    if (isRedisUp()) console.warn('[Redis] saveExpandedIntents error:', err.message);
  }
}

/**
 * Retrieves the morphologically expanded intents dictionary from Redis.
 * Returns null when the key does not exist or Redis is unavailable.
 * intentDetector.js falls back to the static intents.js when null.
 *
 * @returns {Promise<object|null>}
 */
async function getExpandedIntents() {
  try {
    const raw = await redis.get(_intentsKey());
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (err) {
    if (isRedisUp()) console.warn('[Redis] getExpandedIntents error:', err.message);
    return null;
  }
}

// ─── Topic memory helpers ─────────────────────────────────────────────────────

/**
 * Pushes a turn record onto the topicMemory ring buffer in the session context.
 * The ring buffer is capped at MAX_TOPIC_MEMORY entries (oldest entry evicted).
 *
 * Call AFTER generating the response so `found` reflects the actual DB result.
 *
 * @param {number|string} businessId
 * @param {string}        sessionId
 * @param {{ intent: string|null, entity: { type: string|null, value: string|null }, found: boolean, ts: number }} turnData
 * @returns {Promise<void>}
 */
async function pushTurnMemory(businessId, sessionId, turnData) {
  try {
    const current = await getContext(businessId, sessionId);
    const memory  = Array.isArray(current.topicMemory) ? current.topicMemory : [];
    const updated = [...memory, turnData].slice(-MAX_TOPIC_MEMORY);
    await updateContext(businessId, sessionId, { topicMemory: updated });
  } catch (err) {
    if (isRedisUp()) console.warn('[Redis] pushTurnMemory error:', err.message);
  }
}

/**
 * Adds a normalized entity value to the rejectedEntities list for the session.
 * Duplicate entries are silently ignored.
 *
 * Dual-write strategy:
 *   1. CTX key (10-min TTL)  — used by the NLP pipeline in the current session.
 *   2. Profile key (30-day TTL) — long-term persistence across sessions.
 *      Imported lazily to avoid circular dependency (profile → redis → profile).
 *
 * @param {number|string} businessId
 * @param {string}        sessionId
 * @param {string}        entityValue  Normalized rejected term
 * @returns {Promise<void>}
 */
async function addRejectedEntity(businessId, sessionId, entityValue) {
  if (!entityValue || entityValue.length < 2) return;
  try {
    // 1. Write to short-lived NLP context (for the current 10-min window)
    const current  = await getContext(businessId, sessionId);
    const existing = Array.isArray(current.rejectedEntities) ? current.rejectedEntities : [];
    if (!existing.includes(entityValue)) {
      await updateContext(businessId, sessionId, {
        rejectedEntities: [...existing, entityValue].slice(-10),
      });
    }
    // 2. Write to long-term profile (30-day TTL)
    await profileAddRejected(businessId, sessionId, entityValue);
  } catch (err) {
    if (isRedisUp()) console.warn('[Redis] addRejectedEntity error:', err.message);
  }
}

// ─── Exports ───────────────────────────────────────────────────────────────────
export {
  // Context
  getContext,
  updateContext,
  EMPTY_CONTEXT,
  CTX_TTL_SECONDS,
  // Topic / negation memory
  pushTurnMemory,
  addRejectedEntity,
  // History
  getHistory,
  saveMessage,
  HIST_TTL_SECONDS,
  // Expanded intents dictionary
  saveExpandedIntents,
  getExpandedIntents,
};

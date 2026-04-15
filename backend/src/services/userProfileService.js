'use strict';

/**
 * src/services/userProfileService.js
 *
 * USER PROFILE SERVICE — Long-term user memory layer.
 *
 * KEY SCHEMA:
 *   profile:<businessId>:<sessionId>
 *   type: Redis Hash
 *   TTL:  PROFILE_TTL_SECONDS (30 days)
 *
 * WHY A SEPARATE KEY FROM ctx:
 *   - The NLP context (ctx:) expires in 10 minutes by design — it only holds
 *     the current conversational state (lastIntent, lastEntity, pagination).
 *   - The user profile must survive across multiple chat sessions.  A customer
 *     who says "sin gluten" on Monday should still be remembered on Tuesday.
 *   - Redis Hash type lets us update individual fields atomically without
 *     fetching and re-serializing the whole document (unlike the JSON string
 *     used by the CTX key).
 *
 * STORED FIELDS:
 *   name            — user's name, extracted from order forms or self-introduction
 *   rejectedEntities — JSON array of normalized terms the user rejected
 *                      ("sin gluten", "sin carne", "no picante", etc.)
 *   visitCount      — number of times the session has sent a message
 *   lastSeen        — ISO timestamp of the last activity
 *   preferences     — JSON object for any extra per-user preferences
 *
 * RESILIENCE:
 *   All functions degrade gracefully when Redis is unavailable.
 *   A missing profile is always treated as a new / anonymous user.
 */

import redis, { isRedisUp } from '../config/redis.js';

// ─── TTL ──────────────────────────────────────────────────────────────────────

/** 30 days — survives across browser sessions when sessionId is stored in localStorage. */
const PROFILE_TTL_SECONDS = 30 * 24 * 3600; // 2_592_000

/** Max rejected entities kept per user to prevent unbounded growth. */
const MAX_REJECTED = 20;

// ─── Key builder ──────────────────────────────────────────────────────────────

function profileKey(businessId, sessionId) {
  return `profile:${businessId}:${sessionId}`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Safely parse a JSON field stored in the hash; returns the fallback on error. */
function _parseField(raw, fallback) {
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Retrieves the full user profile for a session.
 * Returns a safe default object when the profile doesn't exist or Redis is down.
 *
 * @param {number|string} businessId
 * @param {string}        sessionId
 * @returns {Promise<{
 *   name: string|null,
 *   rejectedEntities: string[],
 *   visitCount: number,
 *   lastSeen: string|null,
 *   preferences: object,
 * }>}
 */
async function getProfile(businessId, sessionId) {
  const key = profileKey(businessId, sessionId);
  try {
    const raw = await redis.hgetall(key);
    if (!raw || Object.keys(raw).length === 0) {
      return { name: null, rejectedEntities: [], visitCount: 0, lastSeen: null, preferences: {} };
    }
    return {
      name:             raw.name || null,
      rejectedEntities: _parseField(raw.rejectedEntities, []),
      visitCount:       parseInt(raw.visitCount, 10) || 0,
      lastSeen:         raw.lastSeen || null,
      preferences:      _parseField(raw.preferences, {}),
    };
  } catch (err) {
    if (isRedisUp()) console.warn('[Profile] getProfile error:', err.message);
    return { name: null, rejectedEntities: [], visitCount: 0, lastSeen: null, preferences: {} };
  }
}

/**
 * Records a new message turn: increments visitCount and updates lastSeen.
 * Call once per user message (not bot reply).
 *
 * @param {number|string} businessId
 * @param {string}        sessionId
 * @returns {Promise<void>}
 */
async function recordVisit(businessId, sessionId) {
  const key = profileKey(businessId, sessionId);
  try {
    // Rule conn-pipelining: 3 ops → 1 round trip.
    // HSET sets lastSeen, HINCRBY atomically increments visit counter,
    // EXPIRE resets the 30-day sliding TTL so active users never get pruned.
    await redis.pipeline()
      .hset(key, 'lastSeen', new Date().toISOString())
      .hincrby(key, 'visitCount', 1)
      .expire(key, PROFILE_TTL_SECONDS)
      .exec();
  } catch (err) {
    if (isRedisUp()) console.warn('[Profile] recordVisit error:', err.message);
  }
}

/**
 * Saves the user's name to their profile.
 * Safe to call multiple times — only overwrites when a non-empty name is provided.
 *
 * @param {number|string} businessId
 * @param {string}        sessionId
 * @param {string}        name
 * @returns {Promise<void>}
 */
async function saveName(businessId, sessionId, name) {
  if (!name || typeof name !== 'string' || !name.trim()) return;
  const key = profileKey(businessId, sessionId);
  try {
    // Rule conn-pipelining: HSET + EXPIRE in 1 round trip.
    await redis.pipeline()
      .hset(key, 'name', name.trim())
      .expire(key, PROFILE_TTL_SECONDS)
      .exec();
  } catch (err) {
    if (isRedisUp()) console.warn('[Profile] saveName error:', err.message);
  }
}

/**
 * Adds a normalized rejected entity to the user's long-term preference list.
 * Duplicates are silently ignored. The list is capped at MAX_REJECTED entries.
 *
 * This replaces the short-lived rejectedEntities previously stored inside the
 * NLP context (ctx: key, 10-min TTL) so preferences survive between sessions.
 *
 * @param {number|string} businessId
 * @param {string}        sessionId
 * @param {string}        entityValue  Normalized rejected term (e.g. "sin gluten")
 * @returns {Promise<void>}
 */
async function addRejectedEntity(businessId, sessionId, entityValue) {
  if (!entityValue || entityValue.length < 2) return;
  const key = profileKey(businessId, sessionId);
  try {
    // HGET is needed first for the duplicate check — it cannot be pipelined
    // with the write because the write value depends on the read result.
    const raw     = await redis.hget(key, 'rejectedEntities');
    const current = _parseField(raw, []);
    if (current.includes(entityValue)) return; // already stored
    const updated = [...current, entityValue].slice(-MAX_REJECTED);
    // Rule conn-pipelining: HSET + EXPIRE in 1 round trip.
    await redis.pipeline()
      .hset(key, 'rejectedEntities', JSON.stringify(updated))
      .expire(key, PROFILE_TTL_SECONDS)
      .exec();
  } catch (err) {
    if (isRedisUp()) console.warn('[Profile] addRejectedEntity error:', err.message);
  }
}

/**
 * Retrieves only the rejectedEntities array from the user profile.
 * Convenience wrapper used by the NLP pipeline to filter suggestions.
 *
 * @param {number|string} businessId
 * @param {string}        sessionId
 * @returns {Promise<string[]>}
 */
async function getRejectedEntities(businessId, sessionId) {
  const key = profileKey(businessId, sessionId);
  try {
    const raw = await redis.hget(key, 'rejectedEntities');
    return _parseField(raw, []);
  } catch (err) {
    if (isRedisUp()) console.warn('[Profile] getRejectedEntities error:', err.message);
    return [];
  }
}

/**
 * Persists an arbitrary key-value preference to the user profile.
 *
 * @param {number|string} businessId
 * @param {string}        sessionId
 * @param {string}        key   Preference name (e.g. "preferredCategory")
 * @param {*}             value Preference value (will be JSON-serialized if not string)
 * @returns {Promise<void>}
 */
async function setPreference(businessId, sessionId, prefKey, value) {
  const key = profileKey(businessId, sessionId);
  try {
    const raw   = await redis.hget(key, 'preferences');
    const prefs = _parseField(raw, {});
    prefs[prefKey] = value;
    await redis.hset(key, 'preferences', JSON.stringify(prefs));
    await redis.expire(key, PROFILE_TTL_SECONDS);
  } catch (err) {
    if (isRedisUp()) console.warn('[Profile] setPreference error:', err.message);
  }
}

export {
  getProfile,
  recordVisit,
  saveName,
  addRejectedEntity,
  getRejectedEntities,
  PROFILE_TTL_SECONDS,
};

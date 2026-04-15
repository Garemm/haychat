/**
 * tests/__mocks__/ioredis.js
 *
 * Global ioredis mock — used by all test files that do NOT provide their own
 * jest.mock('ioredis', factory) call.
 *
 * Mapped via moduleNameMapper in jest config (package.json).
 * Prevents real TCP connections and the "Force exiting Jest / exit code 1"
 * caused by ioredis keeping the event loop alive after tests finish.
 *
 * sessionContextService.test.js uses its own jest.mock('ioredis', ...) which
 * takes precedence over this mapper for that file only.
 */

const store     = new Map();
const listStore = new Map(); // Separate store for List keys (history)
const hashStore = new Map(); // Separate store for Hash keys (profile)

class RedisMock {
  constructor() {
    this.status = 'ready';
  }

  async get(key) {
    return store.get(key) ?? null;
  }

  async setex(key, _ttl, value) {
    store.set(key, value);
    return 'OK';
  }

  // ── Hash operations (used by userProfileService) ────────────────────────────
  async hset(key, ...args) {
    if (!hashStore.has(key)) hashStore.set(key, new Map());
    const hash = hashStore.get(key);
    // hset can be called as hset(key, field, value) or hset(key, field, value, field2, value2)
    for (let i = 0; i < args.length; i += 2) {
      hash.set(args[i], args[i + 1]);
    }
    return args.length / 2;
  }

  async hget(key, field) {
    return hashStore.get(key)?.get(field) ?? null;
  }

  async hgetall(key) {
    const hash = hashStore.get(key);
    if (!hash || hash.size === 0) return null;
    const obj = {};
    for (const [k, v] of hash) obj[k] = v;
    return obj;
  }

  async hincrby(key, field, increment) {
    if (!hashStore.has(key)) hashStore.set(key, new Map());
    const hash = hashStore.get(key);
    const current = parseInt(hash.get(field) ?? '0', 10);
    const updated = current + increment;
    hash.set(field, String(updated));
    return updated;
  }

  // ── List operations (used by redisService history) ──────────────────────────
  async rpush(key, value) {
    const list = listStore.get(key) || [];
    list.push(value);
    listStore.set(key, list);
    return list.length;
  }

  async lrange(key, start, end) {
    const list = listStore.get(key) || [];
    const len  = list.length;
    // Translate negative Redis-style indices to JS slice indices
    const jsStart = start < 0 ? Math.max(0, len + start) : start;
    const jsEnd   = end   < 0 ? len + end + 1            : end + 1;
    return list.slice(jsStart, jsEnd);
  }

  async ltrim(key, start, end) {
    const list = listStore.get(key) || [];
    const len  = list.length;
    const jsStart = start < 0 ? Math.max(0, len + start) : start;
    const jsEnd   = end   < 0 ? len + end + 1            : end + 1;
    listStore.set(key, list.slice(jsStart, jsEnd));
    return 'OK';
  }

  async del(key) {
    store.delete(key);
    listStore.delete(key);
    hashStore.delete(key);
    return 1;
  }

  async expire(key, _ttl) {
    return 1; // 1 = key exists and TTL was set
  }

  // ── Pipeline support ────────────────────────────────────────────────────────
  // Returns a chainable object that collects commands and executes them all
  // when exec() is called.  Mimics the ioredis pipeline().rpush().expire().exec()
  // pattern used by saveMessage, recordVisit, addRejectedEntity, and saveName.
  pipeline() {
    const commands = [];
    const self     = this;

    const pipelineProxy = {
      rpush(key, value) {
        commands.push(() => self.rpush(key, value));
        return pipelineProxy;
      },
      expire(key, ttl) {
        commands.push(() => self.expire(key, ttl));
        return pipelineProxy;
      },
      ltrim(key, start, end) {
        commands.push(() => self.ltrim(key, start, end));
        return pipelineProxy;
      },
      hset(key, ...args) {
        commands.push(() => self.hset(key, ...args));
        return pipelineProxy;
      },
      hincrby(key, field, increment) {
        commands.push(() => self.hincrby(key, field, increment));
        return pipelineProxy;
      },
      async exec() {
        const results = [];
        for (const cmd of commands) {
          try {
            results.push([null, await cmd()]);
          } catch (err) {
            results.push([err, null]);
          }
        }
        return results;
      },
    };

    return pipelineProxy;
  }

  // No-op event listener — ioredis emits 'connect', 'error', 'reconnecting'
  on() {
    return this;
  }

  async quit() {
    this.status = 'end';
    return 'OK';
  }

  disconnect() {
    this.status = 'end';
  }
}

export default RedisMock;

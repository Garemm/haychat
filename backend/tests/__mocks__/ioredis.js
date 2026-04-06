'use strict';

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

const store    = new Map();
const listStore = new Map(); // Separate store for List keys (history)

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

  // Redis List operations — used by redisService history functions
  async rpush(key, value) {
    const list = listStore.get(key) || [];
    list.push(value);
    listStore.set(key, list);
    return list.length;
  }

  async lrange(key, start, end) {
    const list = listStore.get(key) || [];
    if (end === -1) return list.slice(start);
    return list.slice(start, end + 1);
  }

  async expire(key, _ttl) {
    return 1; // 1 = key exists and TTL was set
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

module.exports = RedisMock;

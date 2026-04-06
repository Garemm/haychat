'use strict';

/**
 * tests/setup.js
 *
 * Global Jest setup — runs before every test file.
 *
 * Responsibilities:
 *   • Load .env so any service that reads process.env during require() works
 *     without a real database connection during unit tests.
 *   • The DB pool is mocked at the module level in tests that query the DB;
 *     this file just ensures the environment object is populated.
 */

// Load .env.example values as a safe fallback — keeps tests hermetic.
// Real .env credentials are never required for unit tests.
process.env.DB_HOST     = process.env.DB_HOST     || 'localhost';
process.env.DB_PORT     = process.env.DB_PORT     || '5432';
process.env.DB_NAME     = process.env.DB_NAME     || 'llm_chat_test';
process.env.DB_USER     = process.env.DB_USER     || 'postgres';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'test';
process.env.NODE_ENV    = 'test';
process.env.PORT        = '3001';
process.env.CLIENT_URL  = 'http://localhost:5173';
// Redis — usado por sessionContextService (mockeado en tests unitarios)
process.env.REDIS_HOST  = process.env.REDIS_HOST  || 'localhost';
process.env.REDIS_PORT  = process.env.REDIS_PORT  || '6379';

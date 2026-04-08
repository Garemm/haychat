/**
 * src/config/env.js
 *
 * Single source of truth for all environment variables.
 * Any new env var should be added here — not read with process.env directly
 * from controllers/services. This keeps things explicit and easy to audit.
 */

const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT, 10) || 3000,
  // Comma-separated list of allowed origins, e.g. "http://localhost:5173,http://192.168.1.3:5173"
  CLIENT_URL: (process.env.CLIENT_URL || 'http://localhost:5173,http://192.168.1.3:5173')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean),

  // ── PostgreSQL ────────────────────────────────────────────────────────────
  DB_HOST: process.env.DB_HOST,
  DB_PORT: parseInt(process.env.DB_PORT, 10) || 5432,
  DB_NAME: process.env.DB_NAME,
  DB_USER: process.env.DB_USER,
  DB_PASSWORD: process.env.DB_PASSWORD,

  // ── Redis (contexto conversacional / cache de sesiones) ──────────────────
  REDIS_HOST: process.env.REDIS_HOST || 'localhost',
  REDIS_PORT: parseInt(process.env.REDIS_PORT, 10) || 6379,

  // ── Ollama (local LLM fallback) ──────────────────────────────────────────
  OLLAMA_URL:        process.env.OLLAMA_URL        || 'http://localhost:11434',
  OLLAMA_MODEL:      process.env.OLLAMA_MODEL      || 'llama3:latest', //llama3.2:latest
  // 120s: first call loads the model into VRAM/RAM (cold start can take 30-60s)
  OLLAMA_TIMEOUT_MS: parseInt(process.env.OLLAMA_TIMEOUT_MS, 10) || 120_000,

  // ── OpenAI (uncomment when integrating) ─────────────────────────────────
  // OPENAI_API_KEY: process.env.OPENAI_API_KEY,
};

module.exports = env;

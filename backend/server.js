/**
 * server.js — Entry point
 *
 * Responsibility: boot the HTTP server + Socket.io.
 * Keep this file minimal. App logic lives in src/.
 *
 * BOOT ORDER (important when PostgreSQL is added):
 *   1. Load env
 *   2. Connect to DB  ← add here before listen()
 *   3. Start HTTP server
 *   4. Init Socket.io
 */

require('dotenv').config();
const { createServer } = require('http');
const fs   = require('fs');
const path = require('path');
const app = require('./src/app');
const { initSocket } = require('./src/sockets/chatSocket');
const { PORT, NODE_ENV } = require('./src/config/env');
const { warmupOllama } = require('./src/services/ollamaService');
const { bootstrapIntents } = require('./src/services/intentExpanderService');
const { initIntents }      = require('./src/services/intentDetector');
const db = require('./src/config/database');

/** Run ticket.sql on every startup — all statements are idempotent (IF NOT EXISTS). */
async function runMigrations() {
  const sql = fs.readFileSync(path.join(__dirname, 'src/config/ticket.sql'), 'utf8');
  // Strip single-line comments and split on semicolons so each statement
  // is sent individually (avoids issues with pg multi-statement parsing).
  const statements = sql
    .replace(/--[^\n]*/g, '')   // remove -- comments
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

  for (const stmt of statements) {
    await db.query(stmt);
  }
  console.log('✅ DB migrations applied (ticket.sql)');
}

const httpServer = createServer(app);
initSocket(httpServer);

(async () => {
  try {
    await runMigrations();
  } catch (err) {
    console.error('⚠️  Migration warning (non-fatal):', err.message);
  }

  httpServer.listen(PORT, async () => {
    console.log(`\n🚀 Server ready on http://localhost:${PORT}  [${NODE_ENV}]\n`);
    warmupOllama();
    await bootstrapIntents();
    await initIntents();
  });
})();

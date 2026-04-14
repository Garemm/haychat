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

import 'dotenv/config';
import { createServer } from 'http';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import app from './src/app.js';
import { initSocket } from './src/sockets/chatSocket.js';
import { PORT, NODE_ENV } from './src/config/env.js';
import { warmupOllama } from './src/services/ollamaService.js';
import { bootstrapIntents } from './src/services/intentExpanderService.js';
import { initIntents } from './src/services/intentDetector.js';
import db from './src/config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

/** Run ticket.sql on every startup — all statements are idempotent (IF NOT EXISTS). */
async function runMigrations() {
  const sql = fs.readFileSync(join(__dirname, 'src/config/ticket.sql'), 'utf8');
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

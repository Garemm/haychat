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
const app = require('./src/app');
const { initSocket } = require('./src/sockets/chatSocket');
const { PORT, NODE_ENV } = require('./src/config/env');
const { warmupOllama } = require('./src/services/ollamaService');

const httpServer = createServer(app);
initSocket(httpServer);

httpServer.listen(PORT, () => {
  console.log(`\n🚀 Server ready on http://localhost:${PORT}  [${NODE_ENV}]\n`);
  // Warm up the Ollama model in the background so the first real user
  // request doesn't hit the cold-start delay.
  warmupOllama();
});

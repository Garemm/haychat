/**
 * src/app.js
 *
 * Express application factory.
 * Separated from server.js so it can be imported in tests without starting
 * the HTTP server or Socket.io connection.
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { CLIENT_URL } from './config/env.js';
import routes from './routes/index.js';
import errorHandler from './middlewares/errorHandler.js';
import requestLogger from './middlewares/requestLogger.js';

const app = express();

// ── Security & Parsing ────────────────────────────────────────────────────────
// CLIENT_URL is already an array (parsed in env.js)
app.use(cors({ origin: CLIENT_URL, credentials: true }));
app.use(express.json());

// ── Request Logging ───────────────────────────────────────────────────────────
app.use(requestLogger);

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api', routes);

// ── Health Check (useful for Docker, Railway, Render, etc.) ──────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ── Centralized Error Handler (must be last) ─────────────────────────────────
app.use(errorHandler);

export default app;

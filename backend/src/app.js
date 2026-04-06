/**
 * src/app.js
 *
 * Express application factory.
 * Separated from server.js so it can be imported in tests without starting
 * the HTTP server or Socket.io connection.
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { CLIENT_URL } = require('./config/env');
const routes = require('./routes');
const errorHandler = require('./middlewares/errorHandler');
const requestLogger = require('./middlewares/requestLogger');

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

module.exports = app;

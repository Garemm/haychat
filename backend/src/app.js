import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

import { CLIENT_URL } from './config/env.js';
import routes from './routes/index.js';
import errorHandler from './middlewares/errorHandler.js';
import requestLogger from './middlewares/requestLogger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ── Middlewares ──────────────────────────────────────────────────────────────
app.use(cors({ origin: CLIENT_URL, credentials: true }));
app.use(express.json());
app.use(requestLogger);

// ── API ──────────────────────────────────────────────────────────────────────
app.use('/api', routes);

// ── Health ───────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ── Static Frontend (SOLO SI ESTÁ ACTIVADO) ─────────────────────────────────
if (process.env.SERVE_FRONTEND === 'true') {
  const publicPath = path.join(__dirname, '../public/chatFrontend');

  // servir frontend bajo /chat
  app.use('/chat', express.static(publicPath));

  // fallback React Router
  app.get('/chat/*', (req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
  });

  // redirect root → /chat
  app.get('/', (req, res) => {
    res.redirect('/chat');
  });
}

// ── Error Handler ───────────────────────────────────────────────────────────
app.use(errorHandler);

export default app;
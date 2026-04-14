/**
 * src/routes/index.js
 *
 * Central route registry. All resource routes are mounted here.
 * Add new resource routes below as the app grows.
 *
 * Convention: /api/<resource>
 */

import { Router } from 'express';
import messageRoutes from './messageRoutes.js';
import businessRoutes from './businessRoutes.js';
import pedidoRoutes from './pedidoRoutes.js';
import { transcribe } from '../controllers/transcribeController.js';

const router = Router();

router.use('/messages', messageRoutes);
router.use('/business', businessRoutes);
router.use('/pedidos',  pedidoRoutes);

// ── Audio transcription (MediaRecorder fallback for mobile browsers) ──────
router.post('/transcribe', transcribe);

// ── Future routes ─────────────────────────────────────────────────
// router.use('/rooms',   roomRoutes);
// router.use('/users',   userRoutes);

export default router;

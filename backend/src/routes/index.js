/**
 * src/routes/index.js
 *
 * Central route registry. All resource routes are mounted here.
 * Add new resource routes below as the app grows.
 *
 * Convention: /api/<resource>
 */

const { Router } = require('express');
const messageRoutes  = require('./messageRoutes');
const businessRoutes = require('./businessRoutes');
const pedidoRoutes   = require('./pedidoRoutes');
const { transcribe } = require('../controllers/transcribeController');

const router = Router();

router.use('/messages', messageRoutes);
router.use('/business', businessRoutes);
router.use('/pedidos',  pedidoRoutes);

// ── Audio transcription (MediaRecorder fallback for mobile browsers) ──────
router.post('/transcribe', transcribe);

// ── Future routes ─────────────────────────────────────────────────
// router.use('/rooms',   roomRoutes);
// router.use('/users',   userRoutes);

module.exports = router;

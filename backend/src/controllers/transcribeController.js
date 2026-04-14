/**
 * src/controllers/transcribeController.js
 *
 * POST /api/transcribe
 *
 * Accepts a base64-encoded audio blob recorded by the browser's MediaRecorder
 * API and returns the Spanish transcript via Groq Whisper (fast, free tier).
 *
 * Required env variable (one of):
 *   GROQ_API_KEY   — https://console.groq.com  (recommended – very fast)
 *   OPENAI_API_KEY — https://platform.openai.com (fallback)
 *
 * Request body (JSON):
 *   { audio: "<base64>", format: "webm"|"mp4"|"ogg" }
 *
 * Response:
 *   200 { transcript: "..." }
 *   400 missing audio field
 *   503 no API key configured
 *   502 upstream API error
 */

const GROQ_KEY   = process.env.GROQ_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;

const API_KEY = GROQ_KEY || OPENAI_KEY;
const API_URL = GROQ_KEY
  ? 'https://api.groq.com/openai/v1/audio/transcriptions'
  : 'https://api.openai.com/v1/audio/transcriptions';
const MODEL = GROQ_KEY ? 'whisper-large-v3-turbo' : 'whisper-1';

// MIME type map: extension → media type
const MIME = {
  webm: 'audio/webm',
  mp4:  'audio/mp4',
  ogg:  'audio/ogg',
  wav:  'audio/wav',
  m4a:  'audio/mp4',
};

/**
 * POST /api/transcribe
 */
async function transcribe(req, res, next) {
  if (!API_KEY) {
    return res.status(503).json({
      error: 'Transcription service not configured. Add GROQ_API_KEY or OPENAI_API_KEY to .env',
    });
  }

  const { audio, format = 'webm' } = req.body ?? {};

  if (!audio || typeof audio !== 'string') {
    return res.status(400).json({ error: 'audio field required (base64 string)' });
  }

  // Sanitise format to prevent header injection
  const ext      = /^[a-z0-9]{2,4}$/.test(format) ? format : 'webm';
  const mimeType = MIME[ext] ?? 'audio/webm';

  try {
    const buffer = Buffer.from(audio, 'base64');
    const blob   = new Blob([buffer], { type: mimeType });

    const formData = new FormData();
    formData.append('file', blob, `recording.${ext}`);
    formData.append('model', MODEL);
    formData.append('language', 'es');
    formData.append('response_format', 'json');

    const upstream = await fetch(API_URL, {
      method:  'POST',
      headers: { Authorization: `Bearer ${API_KEY}` },
      body:    formData,
    });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => upstream.statusText);
      return res.status(502).json({ error: `Upstream transcription error: ${text}` });
    }

    const data = await upstream.json();
    return res.json({ transcript: (data.text ?? '').trim() });
  } catch (err) {
    next(err);
  }
}

export { transcribe };

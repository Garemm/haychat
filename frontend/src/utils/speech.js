/**
 * utils/speech.js
 *
 * Reusable browser-native TTS utilities. No external APIs, no audio sent to
 * any server. All processing is purely in-memory on the client.
 *
 * Exports:
 *   pickBestVoice()          — selects the best Spanish voice available
 *   prepareForSpeech(text)   — cleans raw chat text for natural-sounding speech
 *   speakMessage(text, opts) — full TTS call with iOS + Android mobile fixes
 *
 * Mobile guarantees:
 *   iOS   — when nothing is playing the utterance runs synchronously, preserving
 *           the current user-gesture context and permanently unlocking the iOS
 *           audio session. When something IS playing, cancel() + 80 ms delay
 *           lets iOS re-acquire the audio session before the next utterance.
 *   Android (Chrome) — periodic resume() every 10 s prevents the known silent-
 *           pause bug where SpeechSynthesis stops mid-speech.
 */

const synthAPI = typeof window !== 'undefined' ? window.speechSynthesis : null;

// ── Preload voice list asynchronously ────────────────────────────────────────
// Chrome desktop returns voices synchronously; Android/iOS fire voiceschanged.
// Triggering getVoices() at module load + subscribing to the event ensures the
// list is ready by the time the user first taps the speaker button.
if (synthAPI) {
  synthAPI.getVoices();
  if (typeof synthAPI.addEventListener === 'function') {
    synthAPI.addEventListener('voiceschanged', () => synthAPI.getVoices());
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// pickBestVoice
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the best available Spanish voice using a quality-priority cascade:
 *   1. Premium engine voices (Google, Microsoft, Apple/Siri) — best naturalness
 *   2. Locale preference: es-MX → es-ES → es-US → es-AR → any Spanish
 *
 * Returns null when no Spanish voice is found; the browser will use its default.
 */
export function pickBestVoice() {
  if (!synthAPI) return null;

  const voices  = synthAPI.getVoices();
  const spanish = voices.filter((v) => v.lang.startsWith('es'));
  if (!spanish.length) return null;

  // Prefer premium TTS engine voices for better naturalness
  const premium = spanish.find((v) => /google|microsoft|siri/i.test(v.name));
  if (premium) return premium;

  // Locale cascade
  for (const locale of ['es-MX', 'es-ES', 'es-US', 'es-AR']) {
    const v = spanish.find((v) => v.lang.startsWith(locale));
    if (v) return v;
  }

  return spanish[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// prepareForSpeech
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cleans and reformats raw chat text so it sounds natural when spoken aloud.
 *
 * Processing order (each step intentional):
 *  1. Strip emojis and Unicode pictographs
 *  2. Strip markdown formatting characters
 *  3. Semantic symbol replacements ($, :, bullets)
 *  4. Convert line-break structures to sentence/clause pauses
 *  5. Collapse whitespace and trim
 *
 * @param {string} text  Raw message text from the chat
 * @returns {string}     Clean, speakable text
 */
export function prepareForSpeech(text) {
  if (!text) return '';

  return text
    // ── 1. Emojis & pictographs ──────────────────────────────────────────
    // \p{Extended_Pictographic} covers all emoji+symbol blocks (Unicode 10+)
    // Variation selectors and combining keycap suffix are stripped separately.
    .replace(/\p{Extended_Pictographic}/gu, ' ')
    .replace(/[\u{FE00}-\u{FE0F}]/gu, '')   // variation selectors
    .replace(/\u{20E3}/gu, '')               // combining enclosing keycap

    // ── 2. Markdown noise ───────────────────────────────────────────────
    .replace(/[*_~`]/g, '')

    // ── 3. Semantic symbol replacements ─────────────────────────────────
    // "$120.00" → "120 pesos"  |  "$120.50" → "120 pesos con 50 centavos"
    // Must match the full number (including decimals) BEFORE any other sub.
    .replace(/\$\s?(\d+)\.00\b/g, '$1 pesos')
    .replace(/\$\s?(\d+)\.(\d{2})\b/g, '$1 pesos con $2 centavos')
    .replace(/\$\s?(\d+)/g, '$1 pesos')
    .replace(/\$/g, ' pesos ')
    // Bullets read as a clause pause
    .replace(/•\s*/g, ', ')
    // Colons read as a short pause (comma) — avoids "colon" being spoken
    .replace(/:\s+/g, ', ')

    // ── 4. Line-break → sentence / clause boundaries ────────────────────
    .replace(/\n{2,}/g, '. ')  // blank line → sentence end
    .replace(/\n/g, ', ')      // single newline → clause pause

    // ── 5. Whitespace normalisation ─────────────────────────────────────
    .replace(/\s{2,}/g, ' ')
    // Strip stray leading punctuation that would sound like stuttering
    .replace(/^[,.\s]+/, '')
    .trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// speakMessage
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Speaks a chat message via the browser's SpeechSynthesis API.
 *
 * Cleans the text via prepareForSpeech(), then selects the best voice via
 * pickBestVoice(), and enqueues the utterance. All audio stays client-side.
 *
 * @param {string}   text               Raw message text
 * @param {object}  [opts]
 * @param {()=>void} [opts.onStart]     Called when playback begins
 * @param {()=>void} [opts.onEnd]       Called when playback finishes naturally
 * @param {()=>void} [opts.onError]     Called on TTS error (not on 'interrupted')
 * @param {{ current: ReturnType<typeof setInterval>|null }} [opts.resumeRef]
 *   A React ref used to hold the Chrome Android keepalive interval handle.
 *   The caller is responsible for calling clearInterval(resumeRef.current) on
 *   unmount; this function manages it internally during each utterance.
 */
export function speakMessage(text, opts = {}) {
  if (!synthAPI || !text) return;

  const clean = prepareForSpeech(text);
  if (!clean) return;

  const { onStart, onEnd, onError, resumeRef } = opts;
  if (resumeRef) clearInterval(resumeRef.current);

  const doSpeak = () => {
    const utt   = new SpeechSynthesisUtterance(clean);
    const voice = pickBestVoice();

    if (voice) {
      utt.voice = voice;
      utt.lang  = voice.lang;
    } else {
      // Broader 'es' tag avoids silent rejection when no voice list is loaded
      utt.lang  = 'es';
    }

    utt.rate   = 0.95;  // slightly below 1.0 — more natural, less robotic
    utt.pitch  = 1.0;
    utt.volume = 1.0;

    utt.onstart = () => {
      onStart?.();

      // Chrome Android keepalive: synthesis silently pauses after ~10-15 s.
      // Periodic resume() prevents the bug without audible glitches.
      if (resumeRef) {
        clearInterval(resumeRef.current);
        resumeRef.current = setInterval(() => {
          if (synthAPI.speaking) synthAPI.resume();
          else clearInterval(resumeRef.current);
        }, 10_000);
      }
    };

    utt.onend = () => {
      if (resumeRef) clearInterval(resumeRef.current);
      onEnd?.();
    };

    utt.onerror = (e) => {
      // 'interrupted' is benign — fired by cancel(), not a real error
      if (e.error !== 'interrupted') {
        if (resumeRef) clearInterval(resumeRef.current);
        onError?.(e);
      }
    };

    synthAPI.speak(utt);
  };

  // ── iOS Audio Session constraint ─────────────────────────────────────────
  // synthAPI.cancel() releases the iOS audio session. Calling speak() right
  // after iOS has released the session (without an active gesture in flight)
  // results in silent failure.
  //
  // • IDLE: run doSpeak() synchronously.
  //   If called from a user-gesture handler this preserves the gesture context,
  //   permanently unlocking iOS TTS for the rest of the session.
  // • BUSY: cancel(), then wait 80 ms before enqueueing the next utterance.
  //   iOS is already unlocked at this point; the delay lets it re-acquire the
  //   audio session cleanly.
  if (synthAPI.speaking || synthAPI.pending) {
    synthAPI.cancel();
    setTimeout(doSpeak, 80);
  } else {
    doSpeak();
  }
}

/**
 * hooks/useVoice.js
 *
 * React hook that wires the Web Speech API into component state.
 *
 *   TTS (text-to-speech) — delegates all text preparation, voice selection,
 *     and mobile fixes to utils/speech.js via speakMessage().
 *
 *   STT (speech-to-text) — Two paths:
 *     1. SpeechRecognition / webkitSpeechRecognition (Chrome, Safari, Edge).
 *        A FRESH instance is created for every recording session to avoid
 *        InvalidStateError on Chrome Android and Safari.
 *     2. MediaRecorder fallback (Firefox Android, browsers without Web Speech
 *        API). Records audio locally, then sends base64 to POST /api/transcribe
 *        which uses Groq/OpenAI Whisper to produce the transcript.
 *
 * PRIVACY: no audio is sent to our backend until the user stops recording.
 * The backend forwards it to Groq/OpenAI Whisper — no audio is stored.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { speakMessage } from '../utils/speech';

const LANG = 'es-MX';

// ── Capability detection (module level, evaluated once) ───────────────────────
const SpeechRecognitionAPI =
  typeof window !== 'undefined'
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null;

const synthAPI = typeof window !== 'undefined' ? window.speechSynthesis : null;

// Detect the best MediaRecorder format for this browser
// (webm/opus on Chrome, mp4 on Safari iOS, ogg on Firefox)
const MEDIA_MIME =
  typeof window !== 'undefined' && typeof window.MediaRecorder !== 'undefined'
    ? ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find(
        (t) => window.MediaRecorder.isTypeSupported(t)
      ) ?? ''
    : '';
const MEDIA_EXT = MEDIA_MIME.includes('mp4')
  ? 'mp4'
  : MEDIA_MIME.includes('ogg')
  ? 'ogg'
  : 'webm';

const mediaRecSupported = Boolean(MEDIA_MIME);

const useVoice = () => {
  const [isListening,    setIsListening]    = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);  // MR: waiting for backend
  const [isSpeaking,     setIsSpeaking]     = useState(false);
  const [transcript,     setTranscript]     = useState('');
  const [voiceError,     setVoiceError]     = useState(null);

  const recRef      = useRef(null);  // current STT instance (recreated per session)
  const resumeRef   = useRef(null);  // Chrome Android TTS keepalive interval
  const mrRecRef    = useRef(null);  // MediaRecorder instance
  const mrStreamRef = useRef(null);  // getUserMedia stream (needs cleanup)

  // true if at least one recording method is available
  const sttSupported = Boolean(SpeechRecognitionAPI) || mediaRecSupported;
  const ttsSupported = Boolean(synthAPI);

  // ── Cancel TTS on unmount ────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      clearInterval(resumeRef.current);
      if (synthAPI) synthAPI.cancel();
      // Stop any active MediaRecorder stream so mic indicator disappears
      mrStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // ── TTS speak — delegates to utils/speech.js ─────────────────────────────
  const speak = useCallback((text) => {
    speakMessage(text, {
      onStart: () => setIsSpeaking(true),
      onEnd:   () => setIsSpeaking(false),
      onError: () => setIsSpeaking(false),
      resumeRef,
    });
  }, []);

  // ── TTS cancel ───────────────────────────────────────────────────────────
  const cancelSpeak = useCallback(() => {
    if (!synthAPI) return;
    clearInterval(resumeRef.current);
    synthAPI.cancel();
    setIsSpeaking(false);
  }, []);

  // ═════════════════════════════════════════════════════════════════════════
  // PATH 1 — Web Speech API (Chrome, Edge, Safari)
  // ═════════════════════════════════════════════════════════════════════════

  const startListeningSTT = useCallback(() => {
    if (!SpeechRecognitionAPI || isListening) return;

    // Cancel any ongoing TTS first so mic audio isn't garbled by speaker output
    cancelSpeak();
    setTranscript('');
    setVoiceError(null);
    setIsListening(true);

    const rec = new SpeechRecognitionAPI();
    rec.lang            = LANG;
    rec.continuous      = false;
    rec.interimResults  = false;
    rec.maxAlternatives = 1;

    rec.onresult = (event) => {
      const text = event.results[0][0].transcript.trim();
      if (text) setTranscript(text);
    };

    rec.onerror = (event) => {
      if (!['no-speech', 'aborted'].includes(event.error)) {
        setVoiceError(event.error);
      }
      setIsListening(false);
    };

    rec.onend = () => setIsListening(false);

    recRef.current = rec;
    try {
      rec.start();
    } catch {
      recRef.current = null;
      setIsListening(false);
    }
  }, [isListening, cancelSpeak]);

  const stopListeningSTT = useCallback(() => {
    if (!recRef.current || !isListening) return;
    try { recRef.current.stop(); } catch { /* already ended */ }
  }, [isListening]);

  // ═════════════════════════════════════════════════════════════════════════
  // PATH 2 — MediaRecorder fallback (Firefox Android, etc.)
  //   Records locally → sends to POST /api/transcribe → get transcript
  // ═════════════════════════════════════════════════════════════════════════

  const startListeningMR = useCallback(async () => {
    if (!mediaRecSupported || isListening) return;

    // Cancel any ongoing TTS first — must happen synchronously before any await
    cancelSpeak();
    setTranscript('');
    setVoiceError(null);

    let stream;
    try {
      // navigator.mediaDevices is undefined on HTTP (non-secure context).
      // Check explicitly before calling getUserMedia so the browser doesn't
      // throw a cryptic TypeError that gets swallowed as a generic error.
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setVoiceError('needs-https');
        return;
      }
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      // Normalise the many slightly-different error names across browsers
      const n = err.name;
      if (n === 'NotAllowedError' || n === 'PermissionDeniedError') {
        setVoiceError('not-allowed');
      } else if (n === 'SecurityError') {
        setVoiceError('needs-https');
      } else if (n === 'NotFoundError' || n === 'DevicesNotFoundError') {
        setVoiceError('no-mic');
      } else if (n === 'NotReadableError' || n === 'TrackStartError') {
        setVoiceError('mic-busy');
      } else {
        setVoiceError('mic-error');
      }
      return;
    }

    mrStreamRef.current = stream;
    setIsListening(true);

    const chunks   = [];
    const recorder = new MediaRecorder(stream, { mimeType: MEDIA_MIME });
    mrRecRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = async () => {
      // Release mic immediately so OS mic indicator goes away
      stream.getTracks().forEach((t) => t.stop());
      mrStreamRef.current = null;
      // Keep isListening true so button stays busy; switch to "transcribing" phase
      setIsTranscribing(true);

      const blob = new Blob(chunks, { type: MEDIA_MIME });

      // Convert to base64 and call backend
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = reader.result.split(',')[1];
        try {
          const resp = await fetch('/api/transcribe', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ audio: base64, format: MEDIA_EXT }),
          });
          if (!resp.ok) throw new Error('transcription-failed');
          const { transcript: text } = await resp.json();
          if (text?.trim()) setTranscript(text.trim());
        } catch {
          setVoiceError('transcription-failed');
        } finally {
          setIsListening(false);
          setIsTranscribing(false);
        }
      };
      reader.onerror = () => {
        setVoiceError('transcription-failed');
        setIsListening(false);
        setIsTranscribing(false);
      };
      reader.readAsDataURL(blob);
    };

    recorder.start();
  }, [isListening, cancelSpeak]);

  const stopListeningMR = useCallback(() => {
    if (!mrRecRef.current || mrRecRef.current.state === 'inactive') return;
    try { mrRecRef.current.stop(); } catch { /* already ended */ }
  }, []);

  // ═════════════════════════════════════════════════════════════════════════
  // Unified API — dispatch to the right path automatically
  // Memoised so consumers get a stable reference and don't re-render on every
  // render cycle of this hook.
  // ═════════════════════════════════════════════════════════════════════════

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const startListening = useMemo(
    () => (SpeechRecognitionAPI ? startListeningSTT : startListeningMR),
    [startListeningSTT, startListeningMR],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stopListening = useMemo(
    () => (SpeechRecognitionAPI ? stopListeningSTT : stopListeningMR),
    [stopListeningSTT, stopListeningMR],
  );

  const clearTranscript  = useCallback(() => setTranscript(''),  []);
  const clearVoiceError  = useCallback(() => setVoiceError(null), []);

  return {
    // State
    isListening,
    isTranscribing,
    isSpeaking,
    transcript,
    voiceError,
    // Capabilities
    sttSupported,
    ttsSupported,
    // STT actions
    startListening,
    stopListening,
    clearTranscript,
    clearVoiceError,
    // TTS actions
    speak,
    cancelSpeak,
  };
};

export default useVoice;


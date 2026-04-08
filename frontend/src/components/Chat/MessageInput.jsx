import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import useSocket from '../../hooks/useSocket';
import VoiceButton from './VoiceButton';

const TYPING_TIMEOUT_MS = 1500;

const SendIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}
    strokeLinecap="round" strokeLinejoin="round">
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);

const MessageInput = ({ voice }) => {
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const textRef      = useRef('');
  const typingTimer  = useRef(null);
  const { sendMessage, emitTyping, emitStopTyping, solicitarCompra } = useSocket();

  // Destructure voice props with safe defaults
  const {
    isListening    = false,
    isTranscribing = false,
    startListening = null,
    stopListening  = null,
    cancelSpeak    = null,
    transcript     = '',
    clearTranscript  = null,
    clearVoiceError  = null,
    voiceError       = null,
    sttSupported   = false,
  } = voice || {};

  // ── Auto-send STT transcript when it arrives ──────────────────────────
  const sendMessageRef = useRef(sendMessage);
  useEffect(() => { sendMessageRef.current = sendMessage; });

  useEffect(() => {
    if (!transcript) return;
    const trimmed = transcript.trim();
    if (!trimmed) return;
    sendMessageRef.current(trimmed);
    clearTranscript?.();
    emitStopTyping();
    clearTimeout(typingTimer.current);
  }, [transcript]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = useCallback(
    (e) => {
      const val = e.target.value;
      setText(val);
      textRef.current = val;
      emitTyping();
      clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(emitStopTyping, TYPING_TIMEOUT_MS);
    },
    [emitTyping, emitStopTyping]
  );

  const send = useCallback(() => {
    const trimmed = textRef.current.trim();
    if (!trimmed) return;
    sendMessage(trimmed);
    setText('');
    textRef.current = '';
    emitStopTyping();
    clearTimeout(typingTimer.current);
  }, [sendMessage, emitStopTyping]);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    },
    [send]
  );

  const handleTouchStart = useCallback(
    (e) => { e.preventDefault(); send(); },
    [send]
  );

  // ── Voice mic toggle ──────────────────────────────────────────────────
  const handleVoiceToggle = useCallback(() => {
    // Don't allow a new session while MediaRecorder is uploading to backend
    if (isTranscribing) return;

    clearVoiceError?.(); // dismiss any previous error on every new tap
    if (isListening) {
      stopListening?.();
    } else {
      // cancelSpeak is also called inside startListening, but calling it here
      // first gives immediate visual feedback (speaking indicator disappears
      // before the mic opens).
      cancelSpeak?.();
      startListening?.();
    }
  }, [isListening, isTranscribing, startListening, stopListening, cancelSpeak, clearVoiceError]);

  const hasText = text.trim().length > 0;

  const ERROR_LABELS = {
    'not-allowed':          'Permiso de micrófono denegado. Abre la config del navegador y permite el micrófono.',
    'service-not-allowed':  'El navegador bloqueó el micrófono. Revisa la config del sitio.',
    'needs-https':          'El micrófono requiere HTTPS. Abre el chat con https:// en lugar de http://',
    'no-mic':               'No se detectó micrófono en este dispositivo.',
    'mic-busy':             'El micrófono está en uso por otra aplicación.',
    'mic-error':            'No se pudo acceder al micrófono.',
    'transcription-failed': 'Error al procesar el audio.',
  };
  const errorMsg = voiceError ? (ERROR_LABELS[voiceError] ?? 'Error de voz') : null;

  return (
    <>
      <AnimatePresence>
        {errorMsg && (
          <motion.div
            className="voice-error-hint"
            role="alert"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{    opacity: 0, y: 6 }}
            transition={{ duration: 0.2 }}
          >
            <span>{errorMsg}</span>
            <button
              type="button"
              className="voice-error-hint__close"
              aria-label="Cerrar"
              onClick={clearVoiceError}
            >✕</button>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="message-input__buy-row">
        <motion.button
          type="button"
          className="buy-btn"
          aria-label="Realizar pedido"
          onClick={solicitarCompra}
          whileHover={{ scale: 1.06 }}
          whileTap={{ scale: 0.92 }}
          transition={{ type: 'spring', stiffness: 400, damping: 20 }}
        >
          🛒 Hacer pedido
        </motion.button>
      </div>
      <motion.div
      className={`message-input${focused ? ' message-input--focused' : ''}${isListening ? ' message-input--listening' : ''}`}
      animate={{ boxShadow: isListening
        ? '0 -2px 16px rgba(239,68,68,0.14)'
        : focused
          ? '0 -2px 16px rgba(91,80,245,0.12)'
          : '0 -2px 8px rgba(0,0,0,0.04)'
      }}
      transition={{ duration: 0.25 }}
    >
      <input
        type="text"
        value={text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={isTranscribing ? 'Procesando…' : isListening ? 'Escuchando…' : 'Escribe un mensaje…'}
        autoComplete="off"
        maxLength={2000}
        readOnly={isListening || isTranscribing}
      />
      {sttSupported && (
        <VoiceButton
          isListening={isListening}
          onToggle={handleVoiceToggle}
        />
      )}
      <motion.button
        className="send-btn"
        type="button"
        aria-label="Enviar"
        aria-disabled={!hasText}
        onTouchStart={handleTouchStart}
        onClick={send}
        whileHover={hasText ? { scale: 1.12 } : {}}
        whileTap={hasText  ? { scale: 0.88 } : {}}
        animate={{
          background: hasText
            ? 'linear-gradient(135deg, #5b50f5 0%, #8577ff 100%)'
            : 'linear-gradient(135deg, #d8d6ee 0%, #e2e0f0 100%)',
          boxShadow: hasText
            ? '0 4px 14px rgba(91,80,245,0.35)'
            : '0 1px 3px rgba(0,0,0,0.06)',
        }}
        transition={{ type: 'spring', stiffness: 400, damping: 17, background: { duration: 0.2 } }}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={hasText ? 'active' : 'idle'}
            initial={{ opacity: 0, rotate: -15, scale: 0.7 }}
            animate={{ opacity: 1, rotate: 0,   scale: 1   }}
            exit={{    opacity: 0, rotate: 15,  scale: 0.7 }}
            transition={{ duration: 0.15 }}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <SendIcon />
          </motion.span>
        </AnimatePresence>
      </motion.button>
    </motion.div>
    </>
  );
};

export default MessageInput;

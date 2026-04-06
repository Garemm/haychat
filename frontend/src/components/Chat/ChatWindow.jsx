import { useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import MessageList from './MessageList';
import MessageInput from './MessageInput';
import { useChat } from '../../context/ChatContext';
import useVoice from '../../hooks/useVoice';

// ── SVG icons ────────────────────────────────────────────────────────────────
const SpeakerOnIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
  </svg>
);

const SpeakerOffIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <line x1="23" y1="9"  x2="17" y2="15" />
    <line x1="17" y1="9"  x2="23" y2="15" />
  </svg>
);

// ── Component ────────────────────────────────────────────────────────────────
const ChatWindow = () => {
  const { roomId, username, businessName, messages, voiceEnabled, toggleVoice } = useChat();
  const displayName = businessName || roomId || 'Chat';

  // Single useVoice instance — shared between TTS (here) and STT (MessageInput)
  const voice = useVoice();
  const { speak, cancelSpeak, isSpeaking, ttsSupported } = voice;

  // ── Voice toggle — speak() MUST fire synchronously inside the click handler ──
  // iOS Safari blocks speechSynthesis.speak() unless it runs directly in a
  // user-gesture event. Calling it here (not in a useEffect) unlocks the API
  // so all subsequent auto-speak calls work for the duration of the session.
  const handleToggleVoice = useCallback(() => {
    if (voiceEnabled) {
      cancelSpeak();
      toggleVoice();
    } else {
      toggleVoice();
      speak('Voz activada'); // unlocks iOS TTS + gives audible feedback
    }
  }, [voiceEnabled, toggleVoice, speak, cancelSpeak]);

  // ── Auto-speak new bot messages when voice is enabled ────────────────
  useEffect(() => {
    const last = messages.at(-1);
    if (!last?.isNew || last.sender === username || !voiceEnabled) return;
    speak(last.text);
  }, [messages, voiceEnabled, username, speak]);

  // ── Cancel speech when tab is hidden or component unmounts ───────────
  useEffect(() => {
    const onVisibilityChange = () => { if (document.hidden) cancelSpeak(); };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      cancelSpeak();
    };
  }, [cancelSpeak]);

  const statusClass = isSpeaking ? 'chat-header__status chat-header__status--speaking' : 'chat-header__status';
  const statusText  = isSpeaking ? 'Reproduciendo voz…' : 'En línea';

  return (
    <div className="chat-window">
      <motion.header
        className="chat-header"
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
      >
        {/* Animated gradient shimmer line */}
        <span className="chat-header__shimmer" aria-hidden="true" />

        <motion.div
          className="chat-header__avatar"
          whileHover={{ scale: 1.1, rotate: 6 }}
          transition={{ type: 'spring', stiffness: 380, damping: 18 }}
        >
          {displayName[0]}
        </motion.div>

        <div className="chat-header__info">
          <div className="chat-header__name">{displayName}</div>
          <div className={statusClass}>
            <span className="chat-header__dot" aria-hidden="true" />
            {statusText}
          </div>
        </div>

        <div className="chat-header__right">
          <motion.span
            className="chat-header__user"
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.18, duration: 0.25 }}
          >
            @{username}
          </motion.span>

          {ttsSupported && (
            <motion.button
              className={`voice-toggle${voiceEnabled ? ' voice-toggle--on' : ''}`}
              onClick={handleToggleVoice}
              title={voiceEnabled ? 'Desactivar respuestas por voz' : 'Activar respuestas por voz'}
              aria-label={voiceEnabled ? 'Desactivar voz del asistente' : 'Activar voz del asistente'}
              aria-pressed={voiceEnabled}
              whileHover={{ scale: 1.12 }}
              whileTap={{ scale: 0.88 }}
              transition={{ type: 'spring', stiffness: 400, damping: 18 }}
            >
              {voiceEnabled ? <SpeakerOnIcon /> : <SpeakerOffIcon />}
            </motion.button>
          )}
        </div>
      </motion.header>
      <MessageList />
      <MessageInput voice={voice} />
    </div>
  );
};

export default ChatWindow;

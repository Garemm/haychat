/**
 * components/Chat/VoiceButton.jsx
 *
 * Animated microphone toggle button.
 * Shows two expanding ripple rings while actively recording.
 * All icons are inline SVGs — no external font dependency.
 *
 * Props:
 *   isListening {boolean}  — whether STT capture is active
 *   onToggle    {function} — called on click to start / stop recording
 *   disabled    {boolean}  — disables the button (e.g. STT not supported)
 */

import { motion, AnimatePresence } from 'framer-motion';

const MicIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8"  y1="23" x2="16" y2="23" />
  </svg>
);

const MicOffIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="1" y1="1" x2="23" y2="23" />
    <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
    <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8"  y1="23" x2="16" y2="23" />
  </svg>
);

const RING_BASE = {
  position: 'absolute',
  inset: 0,
  borderRadius: '50%',
  background: 'rgba(239,68,68,0.3)',
  pointerEvents: 'none',
};

const VoiceButton = ({ isListening, onToggle, disabled = false }) => (
  <motion.button
    type="button"
    className={`voice-btn${isListening ? ' voice-btn--listening' : ''}`}
    aria-label={isListening ? 'Detener grabación de voz' : 'Activar entrada de voz'}
    aria-pressed={isListening}
    onClick={onToggle}
    disabled={disabled}
    whileHover={!disabled ? { scale: 1.1  } : {}}
    whileTap={!disabled  ? { scale: 0.88 } : {}}
    animate={{
      background: isListening
        ? 'linear-gradient(135deg, #ef4444 0%, #f87171 100%)'
        : 'linear-gradient(135deg, rgba(91,80,245,0.10) 0%, rgba(133,119,255,0.10) 100%)',
      boxShadow: isListening
        ? '0 4px 14px rgba(239,68,68,0.38)'
        : '0 1px 3px rgba(0,0,0,0.06)',
      color: isListening ? '#ffffff' : 'var(--accent)',
    }}
    transition={{
      type: 'spring', stiffness: 400, damping: 17,
      background: { duration: 0.2 },
    }}
  >
    {/* Expanding ripple rings — only visible while recording */}
    <AnimatePresence>
      {isListening && (
        <>
          <motion.span
            key="ring1"
            style={RING_BASE}
            initial={{ scale: 1, opacity: 0.5 }}
            animate={{ scale: 2.5, opacity: 0 }}
            exit={{    opacity: 0 }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeOut', repeatDelay: 0.1 }}
          />
          <motion.span
            key="ring2"
            style={RING_BASE}
            initial={{ scale: 1, opacity: 0.35 }}
            animate={{ scale: 1.85, opacity: 0 }}
            exit={{    opacity: 0 }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeOut', delay: 0.55, repeatDelay: 0.1 }}
          />
        </>
      )}
    </AnimatePresence>

    {/* Icon swaps between mic-on and mic-off */}
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={isListening ? 'mic-off' : 'mic-on'}
        className="voice-btn__icon"
        initial={{ opacity: 0, scale: 0.65 }}
        animate={{ opacity: 1, scale: 1    }}
        exit={{    opacity: 0, scale: 0.65 }}
        transition={{ duration: 0.15 }}
      >
        {isListening ? <MicOffIcon /> : <MicIcon />}
      </motion.span>
    </AnimatePresence>
  </motion.button>
);

export default VoiceButton;

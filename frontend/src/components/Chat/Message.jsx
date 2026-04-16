import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

/* Characters per second for the typing simulation.
   Adaptive: slow for short messages, faster for long ones so it never drags. */
const getTypingSpeed = (len) => {
  if (len <= 80)  return 18;
  if (len <= 200) return 12;
  return 8;
};

const bubbleVariants = {
  hidden:  { opacity: 0, y: 10, scale: 0.95 },
  visible: {
    opacity: 1, y: 0, scale: 1,
    transition: { duration: 0.22, ease: [0.25, 0.46, 0.45, 0.94] },
  },
};

const Message = ({ message, currentUser }) => {
  // Use `role` field when available (new messages stored with role in Redis).
  // Fall back to sender comparison for legacy history entries without a role field.
  const isMine = message.role
    ? message.role === 'user'
    : message.sender === currentUser;

  // Streaming messages (arriving token by token) must NOT use the typewriter animation —
  // the animation captures message.text at mount time and would only play the first token.
  // Non-streaming new bot messages still get the typewriter effect.
  const isStreaming = message.streaming === true;
  const shouldType  = !isMine && message.isNew === true && !isStreaming;

  const [displayed, setDisplayed] = useState(shouldType ? '' : message.text);
  const [isTyping,  setIsTyping]  = useState(shouldType);
  const intervalRef = useRef(null);
  const startRef    = useRef(null);

  // Sync displayed text for streaming messages as new tokens arrive
  useEffect(() => {
    if (isStreaming) {
      setDisplayed(message.text);
    }
  }, [isStreaming, message.text]);

  useEffect(() => {
    if (!shouldType) return;
    const full  = message.text;
    const speed = getTypingSpeed(full.length);
    let i = 0;

    startRef.current = setTimeout(() => {
      intervalRef.current = setInterval(() => {
        i++;
        setDisplayed(full.slice(0, i));
        if (i >= full.length) {
          clearInterval(intervalRef.current);
          setIsTyping(false);
        }
      }, speed);
    }, 60);

    return () => {
      clearTimeout(startRef.current);
      clearInterval(intervalRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const time = new Date(message.createdAt || message.timestamp).toLocaleTimeString([], {
    hour: '2-digit', minute: '2-digit',
  });

  return (
    <motion.div
      className={`message ${isMine ? 'message--mine' : 'message--theirs'}`}
      variants={bubbleVariants}
      initial="hidden"
      animate="visible"
      layout="position"
    >
      {!isMine && (
        <div className="message__avatar">{message.sender[0]?.toUpperCase()}</div>
      )}
      <div className="message__body">
        {!isMine && <span className="message__sender">{message.sender}</span>}
        <p className="message__text">
          {displayed}
          {(isTyping || isStreaming) && <span className="message__cursor" aria-hidden="true" />}
        </p>
        {!isTyping && !isStreaming && (
          <span className="message__time">{time}</span>
        )}
      </div>
    </motion.div>
  );
};

export default Message;

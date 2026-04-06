import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Message from './Message';
import { useChat } from '../../context/ChatContext';

const MessageList = () => {
  const { messages, username, typingUsers } = useChat();
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, typingUsers]);

  return (
    <div className="message-list">
      <AnimatePresence initial={false}>
        {messages.map((msg) => (
          <Message key={msg.id} message={msg} currentUser={username} />
        ))}
      </AnimatePresence>

      <AnimatePresence>
        {typingUsers.length > 0 && (
          <motion.div
            key="typing-indicator"
            className="typing-dots"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4, transition: { duration: 0.15 } }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <div className="typing-dots__bubble">
              <span /><span /><span />
            </div>
            <span className="typing-dots__label">{typingUsers[0]} está escribiendo…</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div ref={bottomRef} />
    </div>
  );
};

export default MessageList;

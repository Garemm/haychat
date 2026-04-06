import { useState, useEffect } from 'react';
import { useParams, Navigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChatProvider, useChat } from '../context/ChatContext';
import ChatWindow from '../components/Chat/ChatWindow';

const cardVariants = {
  hidden:  { opacity: 0, y: 28, scale: 0.95 },
  visible: { opacity: 1, y: 0,  scale: 1,
    transition: { duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] },
  },
  exit:    { opacity: 0, y: -16, scale: 0.97,
    transition: { duration: 0.22 },
  },
};

const ChatContent = ({ businessName }) => {
  const { username, setUsername } = useChat();
  const [name, setName]           = useState('');

  return (
    <AnimatePresence mode="wait">
      {!username ? (
        <motion.div
          key="join"
          className="join-screen"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <motion.div className="join-card" variants={cardVariants} initial="hidden" animate="visible" exit="exit">
            <div className="join-card__logo">
              <motion.div
                className="join-card__icon"
                initial={{ scale: 0.5, rotate: -20 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ delay: 0.1, type: 'spring', stiffness: 300, damping: 18 }}
              >
                🤖
              </motion.div>
              <motion.span
                className="join-card__title"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.18, duration: 0.25 }}
              >
                {businessName || 'Chat'}
              </motion.span>
              <motion.span
                className="join-card__subtitle"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.26, duration: 0.25 }}
              >
                Ingresa tu nombre para continuar
              </motion.span>
            </div>

            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.22 }}
              style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}
            >
              <input
                className="name-input"
                placeholder="Tu nombre…"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={30}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && name.trim()) setUsername(name.trim());
                }}
              />
              <motion.button
                className="join-btn"
                disabled={!name.trim()}
                onClick={() => setUsername(name.trim())}
                whileHover={name.trim() ? { y: -2, boxShadow: '0 12px 32px rgba(91,80,245,0.35)' } : {}}
                whileTap={name.trim()   ? { scale: 0.97 } : {}}
                transition={{ type: 'spring', stiffness: 400, damping: 20 }}
              >
                Entrar al chat →
              </motion.button>
            </motion.div>
          </motion.div>
        </motion.div>
      ) : (
        <motion.div
          key="chat"
          style={{ display: 'flex', flex: 1, width: '100%' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25 }}
        >
          <ChatWindow />
        </motion.div>
      )}
    </AnimatePresence>
  );
};

const ChatPage = () => {
  const { businessId } = useParams();
  const { state }      = useLocation();
  const bizId          = parseInt(businessId, 10);

  const [businessName, setBusinessName] = useState(state?.name || '');
  const [loadingName, setLoadingName]   = useState(!state?.name);

  // If the user lands directly on the URL (no router state), fetch the name
  useEffect(() => {
    if (state?.name || !bizId) return;
    fetch('/api/business')
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then(({ data }) => {
        const match = data.find((b) => b.id === bizId);
        if (match) setBusinessName(match.name);
      })
      .catch(() => {})
      .finally(() => setLoadingName(false));
  }, [bizId, state?.name]);

  if (!bizId || isNaN(bizId)) return <Navigate to="/" replace />;
  if (loadingName) return null; // brief flash while fetching name

  return (
    <ChatProvider businessId={bizId} businessName={businessName}>
      <ChatContent businessName={businessName} />
    </ChatProvider>
  );
};

export default ChatPage;

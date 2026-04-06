import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';

const cardVariants = {
  hidden:  { opacity: 0, y: 24, scale: 0.96 },
  visible: { opacity: 1, y: 0,  scale: 1,
    transition: { duration: 0.32, ease: [0.25, 0.46, 0.45, 0.94] },
  },
};

const listVariants = {
  hidden:  {},
  visible: { transition: { staggerChildren: 0.07, delayChildren: 0.1 } },
};

const itemVariants = {
  hidden:  { opacity: 0, x: -14 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.22, ease: 'easeOut' } },
};

const BusinessSelector = () => {
  const [businesses, setBusinesses] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetch('/api/business')
      .then((res) => {
        if (!res.ok) throw new Error('Error al obtener negocios');
        return res.json();
      })
      .then(({ data }) => setBusinesses(data))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="join-screen">
      <AnimatePresence mode="wait">
        {loading && (
          <motion.div key="loading" className="join-card"
            variants={cardVariants} initial="hidden" animate="visible" exit={{ opacity: 0, scale: 0.95 }}>
            <div className="join-card__logo">
              <motion.div className="join-card__icon"
                animate={{ rotate: [0, 10, -10, 0] }}
                transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}>
                💬
              </motion.div>
              <span className="join-card__title">Cargando…</span>
            </div>
          </motion.div>
        )}

        {error && (
          <motion.div key="error" className="join-card"
            variants={cardVariants} initial="hidden" animate="visible">
            <div className="join-card__logo">
              <div className="join-card__icon">⚠️</div>
              <span className="join-card__title">Sin conexión</span>
              <span className="join-card__subtitle">{error}</span>
            </div>
          </motion.div>
        )}

        {!loading && !error && (
          <motion.div key="list" className="join-card"
            variants={cardVariants} initial="hidden" animate="visible">
            <div className="join-card__logo">
              <motion.div
                className="join-card__icon"
                whileHover={{ rotate: [0, -8, 8, 0] }}
                transition={{ duration: 0.4 }}
              >
                💬
              </motion.div>
              <span className="join-card__title">LLM Chat</span>
              <span className="join-card__subtitle">Elige un negocio para comenzar</span>
            </div>

            <motion.div className="biz-list" variants={listVariants} initial="hidden" animate="visible">
              {businesses.map((biz) => (
                <motion.button
                  key={biz.id}
                  className="biz-btn"
                  variants={itemVariants}
                  whileHover={{ x: 4, backgroundColor: 'var(--surface)', boxShadow: '0 2px 16px rgba(91,80,245,0.1)' }}
                  whileTap={{ scale: 0.98 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                  onClick={() =>
                    navigate(`/chat/${biz.id}`, {
                      state: { name: biz.name, city: biz.city },
                    })
                  }
                >
                  <div className="biz-btn__avatar">{biz.name[0]}</div>
                  <div className="biz-btn__info">
                    <div className="biz-btn__name">{biz.name}</div>
                    {biz.city && <div className="biz-btn__meta">{biz.city}</div>}
                  </div>
                  <motion.span
                    className="biz-btn__arrow"
                    animate={{ x: [0, 2, 0] }}
                    transition={{ repeat: Infinity, duration: 1.8, ease: 'easeInOut' }}
                  >
                    ›
                  </motion.span>
                </motion.button>
              ))}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default BusinessSelector;

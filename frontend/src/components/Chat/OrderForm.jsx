import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import useSocket from '../../hooks/useSocket';
import { useChat } from '../../context/ChatContext';

const formVariants = {
  hidden:  { opacity: 0, y: 16, scale: 0.97 },
  visible: {
    opacity: 1, y: 0, scale: 1,
    transition: { duration: 0.28, ease: [0.25, 0.46, 0.45, 0.94] },
  },
  exit: {
    opacity: 0, y: -8, scale: 0.97,
    transition: { duration: 0.2 },
  },
};

const INITIAL = { nombreCliente: '', telefono: '', detallePedido: '', horaRecogida: '' };

const OrderForm = () => {
  const { clearPedidoForm } = useChat();
  const { submitPedido }    = useSocket();

  const [fields,      setFields]      = useState(INITIAL);
  const [submitting,  setSubmitting]  = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});

  const handleChange = useCallback((e) => {
    const { name, value } = e.target;
    setFields((prev) => ({ ...prev, [name]: value }));
    setFieldErrors((prev) => ({ ...prev, [name]: '' }));
  }, []);

  const validate = () => {
    const errors = {};
    if (!fields.nombreCliente.trim())   errors.nombreCliente  = 'Campo requerido';
    if (!fields.telefono.trim())        errors.telefono       = 'Campo requerido';
    if (!fields.detallePedido.trim())   errors.detallePedido  = 'Campo requerido';
    if (!fields.horaRecogida.trim())    errors.horaRecogida   = 'Campo requerido';
    if (fields.nombreCliente.trim().length > 150)  errors.nombreCliente  = 'Máx. 150 caracteres';
    if (fields.telefono.trim().length > 50)        errors.telefono       = 'Máx. 50 caracteres';
    if (fields.detallePedido.trim().length > 2000) errors.detallePedido  = 'Máx. 2000 caracteres';
    if (fields.horaRecogida.trim().length > 50)    errors.horaRecogida   = 'Máx. 50 caracteres';
    return errors;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const errors = validate();
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setSubmitting(true);
    submitPedido({
      nombreCliente: fields.nombreCliente.trim(),
      telefono:      fields.telefono.trim(),
      detallePedido: fields.detallePedido.trim(),
      horaRecogida:  fields.horaRecogida.trim(),
    });
    // The form is closed by onPedidoConfirmado / onPedidoError in useSocket.
    // We reset submitting after a short delay as a safety fallback.
    setTimeout(() => setSubmitting(false), 6000);
  };

  return (
    <motion.div
      className="order-form"
      variants={formVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
      layout
    >
      <div className="order-form__header">
        <span className="order-form__icon" aria-hidden="true">🛒</span>
        <span className="order-form__title">Realizar pedido</span>
        <button
          type="button"
          className="order-form__close"
          aria-label="Cancelar pedido"
          onClick={clearPedidoForm}
        >
          ✕
        </button>
      </div>

      <form onSubmit={handleSubmit} noValidate>
        <div className="order-form__field">
          <label htmlFor="of-nombre">Nombre</label>
          <input
            id="of-nombre"
            type="text"
            name="nombreCliente"
            className={`order-form__input${fieldErrors.nombreCliente ? ' order-form__input--error' : ''}`}
            placeholder="Tu nombre completo"
            value={fields.nombreCliente}
            onChange={handleChange}
            maxLength={150}
            autoComplete="name"
            disabled={submitting}
          />
          <AnimatePresence>
            {fieldErrors.nombreCliente && (
              <motion.span
                className="order-form__error"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                {fieldErrors.nombreCliente}
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        <div className="order-form__field">
          <label htmlFor="of-telefono">Teléfono</label>
          <input
            id="of-telefono"
            type="tel"
            name="telefono"
            className={`order-form__input${fieldErrors.telefono ? ' order-form__input--error' : ''}`}
            placeholder="Tu número de contacto"
            value={fields.telefono}
            onChange={handleChange}
            maxLength={50}
            autoComplete="tel"
            disabled={submitting}
          />
          <AnimatePresence>
            {fieldErrors.telefono && (
              <motion.span
                className="order-form__error"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                {fieldErrors.telefono}
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        <div className="order-form__field">
          <label htmlFor="of-detalle">Detalle del pedido</label>
          <textarea
            id="of-detalle"
            name="detallePedido"
            className={`order-form__textarea${fieldErrors.detallePedido ? ' order-form__input--error' : ''}`}
            placeholder="¿Qué deseas pedir? (productos, cantidad, etc.)"
            value={fields.detallePedido}
            onChange={handleChange}
            maxLength={2000}
            rows={3}
            disabled={submitting}
          />
          <AnimatePresence>
            {fieldErrors.detallePedido && (
              <motion.span
                className="order-form__error"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                {fieldErrors.detallePedido}
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        <div className="order-form__field">
          <label htmlFor="of-hora">Hora de recogida</label>
          <input
            id="of-hora"
            type="text"
            name="horaRecogida"
            className={`order-form__input${fieldErrors.horaRecogida ? ' order-form__input--error' : ''}`}
            placeholder="Ej: 2:30 PM"
            value={fields.horaRecogida}
            onChange={handleChange}
            maxLength={50}
            disabled={submitting}
          />
          <AnimatePresence>
            {fieldErrors.horaRecogida && (
              <motion.span
                className="order-form__error"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                {fieldErrors.horaRecogida}
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        <div className="order-form__actions">
          <button
            type="button"
            className="order-form__cancel"
            onClick={clearPedidoForm}
            disabled={submitting}
          >
            Cancelar
          </button>
          <motion.button
            type="submit"
            className="order-form__submit"
            disabled={submitting}
            whileHover={!submitting ? { y: -2 } : {}}
            whileTap={!submitting  ? { scale: 0.96 } : {}}
            transition={{ type: 'spring', stiffness: 400, damping: 20 }}
          >
            {submitting ? 'Enviando…' : 'Enviar pedido'}
          </motion.button>
        </div>
      </form>
    </motion.div>
  );
};

export default OrderForm;

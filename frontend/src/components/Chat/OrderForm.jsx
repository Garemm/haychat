import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import socketService from '../../services/socketService';
import { useChat } from '../../context/ChatContext';

// ─── Motion variants ─────────────────────────────────────────────────────────

const cardVariants = {
  hidden:  { opacity: 0, y: 18, scale: 0.97 },
  visible: {
    opacity: 1, y: 0, scale: 1,
    transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] },
  },
  exit: {
    opacity: 0, y: -8, scale: 0.97,
    transition: { duration: 0.2, ease: 'easeIn' },
  },
};

const INITIAL = { nombreCliente: '', telefono: '', detallePedido: '' };

// ─── Status badge ─────────────────────────────────────────────────────────────

const StatusBadge = ({ aceptado }) => {
  if (aceptado === true) {
    return (
      <div className="of-badge of-badge--accepted">
        <span className="of-badge__dot" />
        Aceptado
      </div>
    );
  }
  return (
    <div className="of-badge of-badge--pending">
      <span className="of-badge__dot of-badge__dot--pulse" />
      Pendiente · esperando confirmación
    </div>
  );
};

// ─── Read-only field (used in receipt) ───────────────────────────────────────

const ReadField = ({ label, value, multiline = false }) => (
  <div className="of-field">
    <label className="of-label">{label}</label>
    {multiline
      ? <textarea className="of-input of-input--readonly" value={value ?? ''} rows={3} readOnly disabled />
      : <input    className="of-input of-input--readonly" value={value ?? ''} readOnly disabled />
    }
  </div>
);

// ─── Receipt card ─────────────────────────────────────────────────────────────

const ReceiptCard = ({ pedido, onClose, updatePedidoReceipt }) => {
  const { id, fecha, aceptado, nombreCliente, telefono, detallePedido, notasAdmin, liberado, rechazado, pedidoListo } = pedido;

  const [editing,    setEditing]    = useState(false);
  const [editFields, setEditFields] = useState({});
  const [editErrors, setEditErrors] = useState({});
  const [saving,     setSaving]     = useState(false);
  const [cancelling, setCancelling] = useState(false);

  // Always fetch fresh data from the DB on mount + poll while pending + on tab focus
  const refresh = async () => {
    try {
      const res = await fetch(`/api/pedidos/${id}`);
      if (!res.ok) return;
      const { data } = await res.json();
      if (!data) return;
      updatePedidoReceipt({
        id:            data.id,
        aceptado:      data.aceptado,
        nombreCliente: data.nombre_cliente,
        telefono:      data.telefono,
        detallePedido: data.detalle_pedido,
        horaRecogida:  data.hora_recogida,
        notasAdmin:    data.notas_admin ?? null,
        liberado:      data.liberado,
        rechazado:     data.rechazado,
        pedidoListo:   data.pedido_listo,
      });
    } catch { /* silent */ }
  };

  useEffect(() => {
    refresh();

    if (liberado === true || rechazado === true || pedidoListo === true) return;
    const interval = setInterval(refresh, 8_000);
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, liberado, rechazado, pedidoListo]);

  // ── Edit helpers ────────────────────────────────────────────────────────────

  const startEdit = () => {
    setEditFields({ nombreCliente, telefono, detallePedido });
    setEditErrors({});
    setEditing(true);
  };

  const handleEditChange = (e) => {
    const { name, value } = e.target;
    setEditFields((prev) => ({ ...prev, [name]: value }));
    setEditErrors((prev) => ({ ...prev, [name]: '' }));
  };

  const validateEdit = () => {
    const errors = {};
    if (!editFields.nombreCliente?.trim())               errors.nombreCliente  = 'Campo requerido';
    if (!editFields.telefono?.trim())                    errors.telefono       = 'Campo requerido';
    if (!editFields.detallePedido?.trim())               errors.detallePedido  = 'Campo requerido';
    if (editFields.nombreCliente?.trim().length  > 150)  errors.nombreCliente  = 'Máx. 150 caracteres';
    if (editFields.telefono?.trim().length       > 50)   errors.telefono       = 'Máx. 50 caracteres';
    if (editFields.detallePedido?.trim().length  > 2000) errors.detallePedido  = 'Máx. 2000 caracteres';
    return errors;
  };

  const handleUpdate = async () => {
    const errors = validateEdit();
    if (Object.keys(errors).length > 0) { setEditErrors(errors); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/pedidos/${id}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombreCliente: editFields.nombreCliente.trim(),
          telefono:      editFields.telefono.trim(),
          detallePedido: editFields.detallePedido.trim(),
        }),
      });
      if (res.ok) {
        const { data } = await res.json();
        if (data) {
          updatePedidoReceipt({
            id:            data.id,
            aceptado:      data.aceptado,
            nombreCliente: data.nombre_cliente,
            telefono:      data.telefono,
            detallePedido: data.detalle_pedido,
            horaRecogida:  data.hora_recogida,
            notasAdmin:    data.notas_admin ?? null,
            liberado:      data.liberado,
            rechazado:     data.rechazado,
          });
        }
        setEditing(false);
      }
    } catch { /* silent */ } finally {
      setSaving(false);
    }
  };

  // ── Cancel pedido ───────────────────────────────────────────────────────────

  const handleCancelPedido = async () => {
    setCancelling(true);
    try {
      await fetch(`/api/pedidos/${id}`, { method: 'DELETE' });
    } catch { /* silent */ } finally {
      onClose();
    }
  };
  if (pedidoListo === true) {
    return (
      <motion.div
        className="of-listo"
        variants={cardVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
      >
        <div className="of-status-row">
          <span>🎉 Tu pedido ya está listo para recoger</span>
          <button type="button" className="of-dismiss" aria-label="Cerrar" onClick={onClose}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
        {notasAdmin && (
          <p className="of-listo__notas">{notasAdmin}</p>
        )}
      </motion.div>
    );
  }

  if (rechazado === true) {
    return (
      <motion.div
        className="of-rechazado"
        variants={cardVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
      >
        <div className="of-status-row">
          <span>❌ Tu pedido fue rechazado</span>
          <button type="button" className="of-dismiss" aria-label="Cerrar" onClick={onClose}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
        {notasAdmin && (
          <p className="of-rechazado__notas">{notasAdmin}</p>
        )}
      </motion.div>
    );
  }
  // ── Liberado state ──────────────────────────────────────────────────────────

  if (liberado === true) {
    return (
      <motion.div
        className="of-liberado"
        variants={cardVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
      >
        <div className="of-status-row">
          <span>✅ Tu pedido ya fue liberado</span>
          <button type="button" className="of-dismiss" aria-label="Cerrar" onClick={onClose}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
        {notasAdmin && (
          <p className="of-liberado__notas">Administrador: {notasAdmin}</p>
        )}
      </motion.div>
    );
  }

  // ── Edit mode ───────────────────────────────────────────────────────────────

  if (editing) {
    return (
      <motion.div
        className="of-card of-card--receipt"
        variants={cardVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
      >
        <div className="of-header">
          <div className="of-header__icon">✏️</div>
          <div className="of-header__titles">
            <span className="of-header__title">Editar pedido</span>
            <span className="of-header__sub">#{id}</span>
          </div>
        </div>

        <div className="of-fields">

          {/* Nombre */}
          <div className="of-field">
            <label className="of-label">Nombre</label>
            <input
              type="text"
              name="nombreCliente"
              className={`of-input${editErrors.nombreCliente ? ' of-input--error' : ''}`}
              value={editFields.nombreCliente ?? ''}
              onChange={handleEditChange}
              maxLength={150}
              autoComplete="name"
              disabled={saving}
            />
            <AnimatePresence>
              {editErrors.nombreCliente && (
                <motion.span className="of-error"
                  initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}>
                  {editErrors.nombreCliente}
                </motion.span>
              )}
            </AnimatePresence>
          </div>

          {/* Teléfono - edit mode */}
          <div className="of-field">
            <label className="of-label">Teléfono</label>
            <input
              type="tel"
              inputMode="numeric"
              name="telefono"
              className={`of-input${editErrors.telefono ? ' of-input--error' : ''}`}
              value={editFields.telefono ?? ''}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, '');
                setEditFields((prev) => ({ ...prev, telefono: v }));
                setEditErrors((prev) => ({ ...prev, telefono: '' }));
              }}
              maxLength={50}
              autoComplete="tel"
              disabled={saving}
            />
            <AnimatePresence>
              {editErrors.telefono && (
                <motion.span className="of-error"
                  initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}>
                  {editErrors.telefono}
                </motion.span>
              )}
            </AnimatePresence>
          </div>

          {/* Detalle */}
          <div className="of-field">
            <label className="of-label">Detalle del pedido</label>
            <textarea
              name="detallePedido"
              className={`of-input of-input--textarea${editErrors.detallePedido ? ' of-input--error' : ''}`}
              value={editFields.detallePedido ?? ''}
              onChange={handleEditChange}
              maxLength={2000}
              rows={3}
              disabled={saving}
            />
            <AnimatePresence>
              {editErrors.detallePedido && (
                <motion.span className="of-error"
                  initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}>
                  {editErrors.detallePedido}
                </motion.span>
              )}
            </AnimatePresence>
          </div>

        </div>

        <div className="of-actions">
          <button
            type="button"
            className="of-btn of-btn--ghost"
            onClick={() => setEditing(false)}
            disabled={saving}
          >
            Cancelar edición
          </button>
          <motion.button
            type="button"
            className="of-btn of-btn--primary"
            onClick={handleUpdate}
            disabled={saving}
            whileHover={!saving ? { y: -2, boxShadow: '0 8px 24px rgba(91,80,245,0.38)' } : {}}
            whileTap={!saving ? { scale: 0.97 } : {}}
            transition={{ type: 'spring', stiffness: 400, damping: 20 }}
          >
            {saving ? <span className="of-btn__spinner" /> : 'Actualizar'}
          </motion.button>
        </div>
      </motion.div>
    );
  }

  // ── Receipt view ────────────────────────────────────────────────────────────

  return (
    <motion.div
      className="of-card of-card--receipt"
      variants={cardVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      <div className="of-header">
        <div className="of-header__icon">🧾</div>
        <div className="of-header__titles">
          <span className="of-header__title">Tu pedido</span>
          <span className="of-header__sub">#{id} · {fecha}</span>
        </div>
      </div>

      <StatusBadge aceptado={aceptado} />

      <div className="of-fields">
        <ReadField label="Nombre"   value={nombreCliente} />
        <ReadField label="Teléfono" value={telefono} />
        <ReadField label="Detalle"  value={detallePedido} multiline />

        {notasAdmin && (
          <div className="of-notas">
            <span className="of-notas__label">💬 Notas del negocio</span>
            <p className="of-notas__text">{notasAdmin}</p>
          </div>
        )}
      </div>

      {!rechazado && (
        <div className="of-actions of-actions--receipt">
          {!aceptado && (
            <button
              type="button"
              className="of-btn of-btn--danger"
              onClick={handleCancelPedido}
              disabled={cancelling}
            >
              {cancelling ? <span className="of-btn__spinner of-btn__spinner--dark" /> : 'Cancelar pedido'}
            </button>
          )}
          <button
            type="button"
            className="of-btn of-btn--ghost"
            onClick={startEdit}
          >
            ✏️ Editar
          </button>
        </div>
      )}
    </motion.div>
  );
};

// ─── Input form ──────────────────────────────────────────────────────────────

const OrderForm = () => {
  const { pedidoForm, businessId, clearPedidoForm, updatePedidoReceipt } = useChat();

  const [fields,      setFields]      = useState(INITIAL);
  const [submitting,  setSubmitting]  = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});

  if (!pedidoForm) return null;

  if (pedidoForm?.submitted) {
    return (
      <ReceiptCard
        pedido={pedidoForm.pedido}
        onClose={clearPedidoForm}
        updatePedidoReceipt={updatePedidoReceipt}
      />
    );
  }

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFields((prev) => ({ ...prev, [name]: value }));
    setFieldErrors((prev) => ({ ...prev, [name]: '' }));
  };

  const validate = () => {
    const errors = {};
    if (!fields.nombreCliente.trim())               errors.nombreCliente  = 'Campo requerido';
    if (!fields.telefono.trim())                    errors.telefono       = 'Campo requerido';
    if (!fields.detallePedido.trim())               errors.detallePedido  = 'Campo requerido';
    if (fields.nombreCliente.trim().length  > 150)  errors.nombreCliente  = 'Máx. 150 caracteres';
    if (fields.telefono.trim().length       > 50)   errors.telefono       = 'Máx. 50 caracteres';
    if (fields.detallePedido.trim().length  > 2000) errors.detallePedido  = 'Máx. 2000 caracteres';
    return errors;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const errors = validate();
    if (Object.keys(errors).length > 0) { setFieldErrors(errors); return; }
    setSubmitting(true);
    socketService.getSocket()?.emit('enviar_pedido', {
      businessId,
      sessionId:     socketService.getSessionId(),
      nombreCliente: fields.nombreCliente.trim(),
      telefono:      fields.telefono.trim(),
      detallePedido: fields.detallePedido.trim(),
    });
    setTimeout(() => setSubmitting(false), 8000);
  };

  return (
    <motion.div
      className="of-card"
      variants={cardVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      <div className="of-header">
        <div className="of-header__icon">🛒</div>
        <div className="of-header__titles">
          <span className="of-header__title">Realizar pedido</span>
          <span className="of-header__sub">Completa los datos para tu pedido</span>
        </div>
        <button
          type="button"
          className="of-close"
          aria-label="Cancelar"
          onClick={clearPedidoForm}
          disabled={submitting}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      <form onSubmit={handleSubmit} noValidate>
        <div className="of-fields">

          {/* Nombre */}
          <div className="of-field">
            <label className="of-label" htmlFor="of-nombre">Nombre</label>
            <input
              id="of-nombre"
              type="text"
              name="nombreCliente"
              className={`of-input${fieldErrors.nombreCliente ? ' of-input--error' : ''}`}
              placeholder="Tu nombre completo"
              value={fields.nombreCliente}
              onChange={handleChange}
              maxLength={150}
              autoComplete="name"
              disabled={submitting}
            />
            <AnimatePresence>
              {fieldErrors.nombreCliente && (
                <motion.span className="of-error"
                  initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}>
                  {fieldErrors.nombreCliente}
                </motion.span>
              )}
            </AnimatePresence>
          </div>

          {/* Teléfono */}
          <div className="of-field">
            <label className="of-label" htmlFor="of-telefono">Teléfono</label>
            <input
              id="of-telefono"
              type="tel"
              inputMode="numeric"
              name="telefono"
              className={`of-input${fieldErrors.telefono ? ' of-input--error' : ''}`}
              placeholder="Tu número de contacto"
              value={fields.telefono}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, '');
                setFields((prev) => ({ ...prev, telefono: v }));
                setFieldErrors((prev) => ({ ...prev, telefono: '' }));
              }}
              maxLength={50}
              autoComplete="tel"
              disabled={submitting}
            />
            <AnimatePresence>
              {fieldErrors.telefono && (
                <motion.span className="of-error"
                  initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}>
                  {fieldErrors.telefono}
                </motion.span>
              )}
            </AnimatePresence>
          </div>

          {/* Detalle */}
          <div className="of-field">
            <label className="of-label" htmlFor="of-detalle">Detalle del pedido</label>
            <textarea
              id="of-detalle"
              name="detallePedido"
              className={`of-input of-input--textarea${fieldErrors.detallePedido ? ' of-input--error' : ''}`}
              placeholder="¿Qué deseas pedir? (productos, cantidad, etc.)"
              value={fields.detallePedido}
              onChange={handleChange}
              maxLength={2000}
              rows={3}
              disabled={submitting}
            />
            <AnimatePresence>
              {fieldErrors.detallePedido && (
                <motion.span className="of-error"
                  initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}>
                  {fieldErrors.detallePedido}
                </motion.span>
              )}
            </AnimatePresence>
          </div>

          {/* Info pago */}
          <p className="of-info-msg">💳 Los pedidos se pagan en el establecimiento 😊</p>

        </div>

        <div className="of-actions">
          <button
            type="button"
            className="of-btn of-btn--ghost"
            onClick={clearPedidoForm}
            disabled={submitting}
          >
            Cancelar
          </button>
          <motion.button
            type="submit"
            className="of-btn of-btn--primary"
            disabled={submitting}
            whileHover={!submitting ? { y: -2, boxShadow: '0 8px 24px rgba(91,80,245,0.38)' } : {}}
            whileTap={!submitting   ? { scale: 0.97 } : {}}
            transition={{ type: 'spring', stiffness: 400, damping: 20 }}
          >
            {submitting
              ? <span className="of-btn__spinner" />
              : 'Enviar pedido →'}
          </motion.button>
        </div>
      </form>
    </motion.div>
  );
};

export default OrderForm;

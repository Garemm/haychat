import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import socketService from '../services/socketService';

const ChatContext = createContext(null);

export const ChatProvider = ({ children, businessId, businessName = '', aceptoPedidos = false }) => {
  const [messages, setMessages]       = useState([]);
  // roomId único por sesión: evita que dos dispositivos compartan la misma sala Socket.io
  const [roomId, setRoomId]           = useState(() => `${businessId}:${socketService.getSessionId()}`);
  const [username, setUsername]       = useState('');
  const [typingUsers, setTypingUsers] = useState([]);
  const [voiceEnabled, setVoiceEnabled] = useState(false);

  // pedidoForm states:
  //   null                                     → no form visible
  //   { businessId }                           → form input mode (user filling in fields)
  //   { businessId, submitted: true, pedido }  → receipt mode (order sent, showing status card)
  //     pedido: { id, fecha, aceptado, nombreCliente, telefono, detallePedido, horaRecogida, notasAdmin }
  const _pedidoStorageKey = `pedidoReceipt:${businessId}:${socketService.getSessionId()}`;
  const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
  const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
  const [pedidoForm, setPedidoFormState] = useState(() => {
    try {
      const stored = localStorage.getItem(`pedidoReceipt:${businessId}:${socketService.getSessionId()}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.submitted && parsed?.pedido?.id) {
          // Auto-expire any receipt older than 6 hours (from submission)
          if (parsed.pedido.submittedAt) {
            if (Date.now() - parsed.pedido.submittedAt >= SIX_HOURS_MS) return null;
          }
          // Auto-expire liberado receipts older than 2 hours
          if (parsed.pedido.liberado && parsed.pedido.liberadoAt) {
            if (Date.now() - parsed.pedido.liberadoAt >= TWO_HOURS_MS) return null;
          }
          return parsed;
        }
      }
    } catch { /* ignore parse errors */ }
    return null;
  });

  const addMessage = useCallback((message) => {
    setMessages((prev) => [...prev, { ...message, isNew: true }]);
  }, []);

  const setHistory = useCallback((history) => {
    setMessages(history.map((m) => ({ ...m, isNew: false })));
  }, []);

  const addTypingUser = useCallback((sender) => {
    setTypingUsers((prev) => (prev.includes(sender) ? prev : [...prev, sender]));
  }, []);

  const removeTypingUser = useCallback((sender) => {
    setTypingUsers((prev) => prev.filter((u) => u !== sender));
  }, []);

  const toggleVoice = useCallback(() => setVoiceEnabled((v) => !v), []);

  // Sync receipt state to localStorage so it survives page refresh.
  useEffect(() => {
    if (pedidoForm?.submitted) {
      try { localStorage.setItem(_pedidoStorageKey, JSON.stringify(pedidoForm)); } catch { /* ignore */ }
    } else {
      localStorage.removeItem(_pedidoStorageKey);
    }
  }, [pedidoForm, _pedidoStorageKey]);

  const setPedidoForm = useCallback((data) => {
    // Never open a new form while a submitted receipt is still live
    if (data !== null) {
      setPedidoFormState((prev) => (prev?.submitted ? prev : data));
    } else {
      setPedidoFormState(null);
    }
  }, []);
  const clearPedidoForm = useCallback(() => setPedidoFormState(null), []);

  /** Transition form → receipt card after successful submission. */
  const setPedidoSubmitted = useCallback((pedido) => {
    setPedidoFormState((prev) =>
      prev ? { ...prev, submitted: true, pedido: { ...pedido, submittedAt: Date.now() } }
           : { businessId, submitted: true, pedido: { ...pedido, submittedAt: Date.now() } }
    );
  }, [businessId]);

  /** Merge admin update fields into the existing receipt card. */
  const updatePedidoReceipt = useCallback(({ id, aceptado, nombreCliente, telefono, detallePedido, horaRecogida, notasAdmin, liberado, rechazado, pedidoListo }) => {
    setPedidoFormState((prev) => {
      if (!prev?.submitted || prev.pedido?.id !== id) return prev;
      const wasLiberado = prev.pedido.liberado;
      const nowLiberado = liberado !== undefined ? liberado : wasLiberado;
      return {
        ...prev,
        pedido: {
          ...prev.pedido,
          aceptado:      aceptado      !== undefined ? aceptado      : prev.pedido.aceptado,
          nombreCliente: nombreCliente !== undefined ? nombreCliente : prev.pedido.nombreCliente,
          telefono:      telefono      !== undefined ? telefono      : prev.pedido.telefono,
          detallePedido: detallePedido !== undefined ? detallePedido : prev.pedido.detallePedido,
          horaRecogida:  horaRecogida  !== undefined ? horaRecogida  : prev.pedido.horaRecogida,
          notasAdmin:    notasAdmin    !== undefined ? notasAdmin    : prev.pedido.notasAdmin,
          liberado:      nowLiberado,
          rechazado:     rechazado     !== undefined ? rechazado     : prev.pedido.rechazado,
          pedidoListo:   pedidoListo   !== undefined ? pedidoListo   : prev.pedido.pedidoListo,
          // Record the moment it was first liberado (to drive the 2-hour auto-expire)
          liberadoAt:    (!wasLiberado && nowLiberado) ? Date.now() : prev.pedido.liberadoAt,
        },
      };
    });
  }, []);

  // Auto-clear the receipt 6 hours after submission (client-side timestamp)
  useEffect(() => {
    const submittedAt = pedidoForm?.pedido?.submittedAt;
    if (!submittedAt) return;
    const remaining = SIX_HOURS_MS - (Date.now() - submittedAt);
    if (remaining <= 0) { setPedidoFormState(null); return; }
    const t = setTimeout(() => setPedidoFormState(null), remaining);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidoForm?.pedido?.submittedAt]);

  // Auto-clear the receipt 2 hours after it was liberado
  useEffect(() => {
    const pedido = pedidoForm?.pedido;
    if (!pedido?.liberado || !pedido?.liberadoAt) return;
    const remaining = TWO_HOURS_MS - (Date.now() - pedido.liberadoAt);
    if (remaining <= 0) { setPedidoFormState(null); return; }
    const t = setTimeout(() => setPedidoFormState(null), remaining);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidoForm?.pedido?.liberado, pedidoForm?.pedido?.liberadoAt]);

  return (
    <ChatContext.Provider
      value={{
        messages,
        roomId,
        username,
        typingUsers,
        businessId,
        businessName,
        aceptoPedidos,
        voiceEnabled,
        pedidoForm,
        setRoomId,
        setUsername,
        addMessage,
        setHistory,
        addTypingUser,
        removeTypingUser,
        toggleVoice,
        setPedidoForm,
        clearPedidoForm,
        setPedidoSubmitted,
        updatePedidoReceipt,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
};

export const useChat = () => {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used inside <ChatProvider>');
  return ctx;
};

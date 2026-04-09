import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import socketService from '../services/socketService';

const ChatContext = createContext(null);

export const ChatProvider = ({ children, businessId, businessName = '' }) => {
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
  const [pedidoForm, setPedidoFormState] = useState(() => {
    try {
      const stored = localStorage.getItem(`pedidoReceipt:${businessId}:${socketService.getSessionId()}`);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.submitted && parsed?.pedido?.id) return parsed;
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

  const setPedidoForm   = useCallback((data) => setPedidoFormState(data), []);
  const clearPedidoForm = useCallback(() => setPedidoFormState(null), []);

  /** Transition form → receipt card after successful submission. */
  const setPedidoSubmitted = useCallback((pedido) => {
    setPedidoFormState((prev) =>
      prev ? { ...prev, submitted: true, pedido } : { businessId, submitted: true, pedido }
    );
  }, [businessId]);

  /** Merge admin update fields into the existing receipt card. */
  const updatePedidoReceipt = useCallback(({ id, aceptado, nombreCliente, telefono, detallePedido, horaRecogida, notasAdmin }) => {
    setPedidoFormState((prev) => {
      if (!prev?.submitted || prev.pedido?.id !== id) return prev;
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
        },
      };
    });
  }, []);

  return (
    <ChatContext.Provider
      value={{
        messages,
        roomId,
        username,
        typingUsers,
        businessId,
        businessName,
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

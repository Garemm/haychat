import React, { createContext, useContext, useState, useCallback } from 'react';
import socketService from '../services/socketService';

const ChatContext = createContext(null);

export const ChatProvider = ({ children, businessId, businessName = '' }) => {
  const [messages, setMessages]       = useState([]);
  // roomId único por sesión: evita que dos dispositivos compartan la misma sala Socket.io
  const [roomId, setRoomId]           = useState(() => `${businessId}:${socketService.getSessionId()}`);
  const [username, setUsername]       = useState('');
  const [typingUsers, setTypingUsers] = useState([]);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  // pedidoForm: null while no form is pending, or { businessId } when the server
  // requests the order form to be shown inside the chat.
  const [pedidoForm, setPedidoFormState] = useState(null);

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

  const setPedidoForm   = useCallback((data) => setPedidoFormState(data), []);
  const clearPedidoForm = useCallback(() => setPedidoFormState(null), []);

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

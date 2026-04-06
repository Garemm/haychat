/**
 * context/ChatContext.jsx — Global chat state.
 *
 * Holds: current room, messages, username, and typing indicators.
 *
 * ISOLACIÓN POR SESIÓN:
 *   El roomId se calcula como `${businessId}:${sessionId}`, garantizando que
 *   cada usuario tenga su propio canal Socket.io y su propio historial en Redis.
 *   Dos dispositivos del mismo usuario generan UUIDs distintos → salas distintas
 *   → históricos y mensajes en tiempo real completamente separados.
 */

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
        setRoomId,
        setUsername,
        addMessage,
        setHistory,
        addTypingUser,
        removeTypingUser,
        toggleVoice,
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

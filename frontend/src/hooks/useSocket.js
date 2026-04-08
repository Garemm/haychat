/**
 * hooks/useSocket.js
 *
 * Manages the socket lifecycle for a component tree.
 * Registers event listeners on mount, cleans them up on unmount.
 *
 * MANEJO DE SESIÓN:
 *   socketService.getSessionId() lee (o genera) el sessionId desde localStorage,
 *   garantizando que el mismo usuario vea su historial de mensajes al recargar la
 *   página dentro de las 24 h que dura el TTL de hist:<businessId>:<sessionId>
 *   en Redis.
 *
 *   El sessionId se envía tanto en 'join_room' (para cargar historial) como en
 *   'send_message' (para leer/escribir contexto NLP).
 *
 * Exposes:
 *   sendMessage      — emits 'send_message'
 *   emitTyping       — emits indicador 'typing'
 *   emitStopTyping   — emits 'stop_typing'
 *   solicitarCompra  — emits 'solicitar_compra'
 *   submitPedido     — emits 'enviar_pedido'
 */

import { useEffect, useRef } from 'react';
import socketService from '../services/socketService';
import { useChat } from '../context/ChatContext';

const useSocket = () => {
  const {
    roomId,
    username,
    businessId,
    addMessage,
    setHistory,
    addTypingUser,
    removeTypingUser,
    setPedidoForm,
    clearPedidoForm,
  } = useChat();

  const joinedRoom = useRef(null);

  useEffect(() => {
    const socket = socketService.connect();
    const sessionId = socketService.getSessionId();

    if (joinedRoom.current !== roomId) {
      // Pass sessionId so the backend can load this user's Redis history
      socket.emit('join_room', { roomId, businessId, sessionId });
      joinedRoom.current = roomId;
    }

    socket.on('message_history', setHistory);
    socket.on('receive_message', addMessage);
    socket.on('user_typing', ({ sender }) => {
      if (sender !== username) addTypingUser(sender);
    });
    socket.on('user_stop_typing', ({ sender }) => removeTypingUser(sender));

    // ── Purchase flow events ─────────────────────────────────────────────────
    // Server confirmed orders are open → show the order form inside the chat
    const onMostrarFormulario = ({ businessId: bId }) => {
      setPedidoForm({ businessId: bId });
    };

    // Server says orders are closed → inject a contact-info message in chat
    const onInfoContacto = ({ mensaje, telefono, email }) => {
      let text = mensaje || 'Pedidos no disponibles en este momento.';
      if (telefono) text += `\n📞 ${telefono}`;
      if (email)    text += `\n📧 ${email}`;
      addMessage({
        id:        crypto.randomUUID(),
        sender:    'Bot',
        text,
        timestamp: new Date().toISOString(),
      });
    };

    // Server confirmed the pedido was saved → inject confirmation message + close form
    const onPedidoConfirmado = ({ mensaje }) => {
      clearPedidoForm();
      addMessage({
        id:        crypto.randomUUID(),
        sender:    'Bot',
        text:      mensaje || '¡Pedido recibido! Te contactaremos pronto.',
        timestamp: new Date().toISOString(),
      });
    };

    // Server returned a validation/DB error during enviar_pedido
    const onPedidoError = ({ message: msg }) => {
      addMessage({
        id:        crypto.randomUUID(),
        sender:    'Bot',
        text:      `⚠️ ${msg || 'Error al procesar el pedido.'}`,
        timestamp: new Date().toISOString(),
      });
    };

    socket.on('mostrar_formulario_pedido', onMostrarFormulario);
    socket.on('info_contacto',            onInfoContacto);
    socket.on('pedido_confirmado',        onPedidoConfirmado);
    socket.on('pedido_error',             onPedidoError);

    return () => {
      socket.off('message_history', setHistory);
      socket.off('receive_message', addMessage);
      socket.off('user_typing');
      socket.off('user_stop_typing');
      socket.off('mostrar_formulario_pedido', onMostrarFormulario);
      socket.off('info_contacto',            onInfoContacto);
      socket.off('pedido_confirmado',        onPedidoConfirmado);
      socket.off('pedido_error',             onPedidoError);
    };
  }, [roomId, username, addMessage, setHistory, addTypingUser, removeTypingUser, setPedidoForm, clearPedidoForm]);

  /**
   * Envía el mensaje del usuario incluyendo el sessionId persistente.
   */
  const sendMessage = (text) => {
    const sessionId = socketService.getSessionId();
    socketService.getSocket().emit('send_message', { roomId, sender: username, text, sessionId, businessId });
  };

  const emitTyping = () => {
    socketService.getSocket().emit('typing', { roomId, sender: username });
  };

  const emitStopTyping = () => {
    socketService.getSocket().emit('stop_typing', { roomId, sender: username });
  };

  /** Asks the server whether purchase orders are enabled for this business. */
  const solicitarCompra = () => {
    socketService.getSocket().emit('solicitar_compra', { businessId });
  };

  /**
   * Submits the completed order form to the backend.
   * @param {{ nombreCliente: string, telefono: string, detallePedido: string, horaRecogida: string }} data
   */
  const submitPedido = (data) => {
    socketService.getSocket().emit('enviar_pedido', { businessId, ...data });
  };

  return { sendMessage, emitTyping, emitStopTyping, solicitarCompra, submitPedido };
};

export default useSocket;


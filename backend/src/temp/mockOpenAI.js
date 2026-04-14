/**
 * src/temp/mockOpenAI.js
 *
 * MOCK OPENAI — Fallback de IA simulado.
 *
 * PROPÓSITO:
 *   Se invoca cuando ninguna regla determinista (NLP entity, intent keywords)
 *   pudo resolver el mensaje del usuario. Actúa como último recurso en el pipeline.
 *
 * USO DEL CONTEXTO:
 *   Recibe el contexto de sesión (lastProduct / lastIntent) para generar
 *   una respuesta más coherente con la conversación previa.
 *   Sin contexto devuelve un mensaje genérico de ayuda.
 *
 * REEMPLAZAR EN PRODUCCIÓN:
 *   Sustituir el cuerpo de getMockOpenAIResponse() por la llamada real a
 *   openai.chat.completions.create() con el historial de la sesión.
 *
 * @param {string} userMessage
 * @param {{ lastProduct?: string|null, lastIntent?: string|null }|null} context
 * @returns {string}
 */
function getMockOpenAIResponse(userMessage, context = null) {
  // Si hay contexto previo, generar una respuesta coherente con él
  if (context?.lastProduct) {
    return (
      `No entendí muy bien lo que quisieras saber sobre ${context.lastProduct}. ` +
      `¿Te puedo ayudar con su precio, disponibilidad o descripción?`
    );
  }

  if (context?.lastIntent) {
    const temas = {
      horarios:           'horarios de atención',
      productos:          'productos disponibles',
      precios:            'precios',
      promociones:        'promociones activas',
      ubicacion:          'ubicación del negocio',
      category_selection: 'categorías disponibles',
    };
    const tema = temas[context.lastIntent] || context.lastIntent;
    return (
      `¡Claro! Puedo contarte más sobre ${tema}. ` +
      `¿Tienes alguna pregunta específica?`
    );
  }

  // Sin contexto → respuesta genérica orientada a las capacidades del bot
  return (
    `No estoy seguro de lo que buscas, ¡pero con gusto te ayudo! 😊 Puedo orientarte sobre:\n` +
    `  • Horarios de atención\n` +
    `  • Productos disponibles\n` +
    `  • Precios\n` +
    `  • Promociones\n` +
    `  • Ubicación\n` +
    `¿Con qué te puedo ayudar?`
  );
}

/**
 * Simulates an OpenAI call with RAG context.
 * In production, this will be replaced by an actual openai.chat.completions.create() call
 * with the filtered data injected into the system prompt.
 *
 * @param {string} userMessage       Original user message
 * @param {{ type: string, data: object[], summary: string, total: number }} ragContext  Filtered DB data
 * @param {{ lastIntent: string|null, lastEntity: { type: string|null, value: string|null } }} sessionContext
 * @returns {string}
 */
function getRAGOpenAIResponse(userMessage, ragContext, sessionContext = {}) {
  const dataCount = ragContext?.data?.length ?? 0;
  const ragType = ragContext?.type ?? 'empty';
  const summary = ragContext?.summary ?? 'sin datos';

  // Build context string for simulation
  const contextParts = [];
  if (sessionContext?.lastIntent) contextParts.push(`lastIntent="${sessionContext.lastIntent}"`);
  if (sessionContext?.lastEntity?.value) contextParts.push(`lastEntity="${sessionContext.lastEntity.value}"`);
  const contextStr = contextParts.length > 0 ? contextParts.join(', ') : 'sin contexto previo';

  if (dataCount === 0) {
    return (
      `🤖 [AI Simulado] La pregunta "${userMessage}" fue analizada pero no se encontraron datos relevantes en la base de datos. ` +
      `Contexto: ${contextStr}. ` +
      `Puedo ayudarte con horarios, productos, precios, promociones o ubicación.`
    );
  }

  return (
    `🤖 [AI Simulado] La pregunta "${userMessage}" fue enviada a OpenAI con ${dataCount} resultados relevantes. ` +
    `Tipo de datos: ${ragType}. Resumen: ${summary}. ` +
    `Contexto de sesión: ${contextStr}.`
  );
}

export { getMockOpenAIResponse, getRAGOpenAIResponse };



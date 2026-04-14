/**
 * src/mockai/keywordResponses.js
 *
 * Respuestas simuladas para palabras/frases clave.
 * Si el mensaje recibido contiene una clave, responde con el valor asociado.
 */

const responses = [
  {
    keywords: ["hola"],
    response: "¡Hola! 👋 ¿En qué te puedo ayudar hoy?"
  },
  {
    keywords: ["como te llamas", "¿como te llamas?", "cómo te llamas", "¿cómo te llamas?"],
    response: "Soy tu asistente virtual 😊 Estoy aquí para ayudarte con cualquier pregunta sobre nuestros productos, horarios, precios, promociones y más. ¿En qué te puedo ayudar?"
  }
];

function getKeywordResponse(userMessage) {
  if (!userMessage) return null;
  const normalized = userMessage.toLowerCase();
  for (const { keywords, response } of responses) {
    if (keywords.some(k => normalized.includes(k))) {
      return response;
    }
  }
  return null;
}

export { getKeywordResponse };

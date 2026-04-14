'use strict';

/**
 * src/services/conversationalContext.js
 *
 * Funciones puras para resolver el contexto conversacional.
 * Separadas del socket para ser independientemente testeables.
 *
 * ESTRATEGIA DE PRIORIDAD:
 *   1. Nuevo producto detectado  → producto track, intent = null (no hereda lastIntent)
 *   2. Nueva intención detectada → hereda lastProduct del contexto (ej: "¿y cuánto cuesta?")
 *   3. Nada detectado            → fallback completo al contexto previo
 *
 * DETECCIÓN DE SEGUIMIENTO:
 *   extractFollowUpProduct() captura mensajes tipo "¿Y pizza mexicana?" cuando el
 *   usuario está en un producto-track. Solo activa si hay lastProduct en contexto
 *   y el mensaje empieza con "y " — evitando falsos positivos en preguntas de acción.
 */

/**
 * Palabras interrogativas que indican una pregunta de acción, no un producto.
 * Usadas en extractFollowUpProduct para rechazar entidades como "cuánto cuesta".
 */
const QUESTION_WORDS = new Set([
  'cuanto', 'cuanta', 'cuantos', 'cuantas',
  'cuando', 'donde', 'como', 'cual', 'cuales', 'quien',
]);

/**
 * Intenciones autosuficientes que se responden de forma independiente del contexto de producto.
 * Al detectar una de estas intenciones, lastProduct previo se ignora y se limpia del contexto.
 *
 * Bug resuelto: usuario pregunta "pizza" → "¿a qué hora abren?" → el pipeline recibía
 * effectiveProduct="pizza" porque la lógica anterior heredaba lastProduct para cualquier intent.
 * Con STANDALONE_INTENTS, horarios y ubicación responden sin necesitar producto.
 *
 * NO incluir intenciones que dependen de contexto:
 *   - 'precios'   → "¿y cuánto cuesta?" necesita saber de qué producto se habla
 *   - 'productos' → podría filtrar por lastProduct en el futuro
 */
const STANDALONE_INTENTS = new Set(['horarios', 'ubicacion']);

/**
 * Determina si el mensaje actual debe consultar el contexto previo de sesión.
 * Función de decisión pura — exportada para ser independientemente testeable.
 *
 * Retorna false para intenciones standalone (autosuficientes):
 *   - "¿A qué hora abren?" (horarios) → no necesita saber qué producto se discutía
 *   - "¿Dónde están?"     (ubicacion) → respuesta siempre independiente
 *
 * Retorna true para mensajes ambiguos o que dependen del contexto:
 *   - "¿cuánto cuesta?" (precios sin producto) → usa lastProduct del contexto
 *   - Mensajes sin intent detectado             → fallback al contexto completo
 *
 * @param {string|null} detectedIntent  Intent detectado por detectIntent()
 * @returns {boolean}
 */
function shouldUseContext(detectedIntent) {
  if (detectedIntent && STANDALONE_INTENTS.has(detectedIntent)) return false;
  return true;
}

/**
 * Extrae el nombre de producto de un mensaje de seguimiento tipo "¿Y pizza mexicana?".
 *
 * CUÁNDO ACTIVA:
 *   - El mensaje normalizado empieza con "y " (artículo de continuación en español)
 *   - Hay un lastProduct en el contexto (indica que estamos en un producto-track)
 *   - La entidad extraída NO contiene palabras interrogativas (no es una pregunta de acción)
 *
 * CUÁNDO NO ACTIVA:
 *   - Sin lastProduct → sesión nueva o en intent-track (ej: sesión de horarios pura)
 *   - "¿Y cuánto cuesta?" → "cuanto" es palabra interrogativa → null
 *   - Mensaje que no empieza con "y " tras normalizar → null
 *
 * @param {string} normalizedText  Texto ya normalizado (lowercase, sin acentos, sin ¿¡)
 * @param {string|null} lastProduct  Último producto del contexto de sesión
 * @returns {string|null}  Nombre del producto refinado, o null
 */
function extractFollowUpProduct(normalizedText, lastProduct) {
  // Solo activa quando estamos en un producto-track (hay producto previo)
  if (!lastProduct) return null;

  const match = normalizedText.match(/^y\s+(?<entity>[\w\s]+?)(?:\?|$)/);
  if (!match?.groups?.entity) return null;

  const candidate = match.groups.entity.trim();
  if (candidate.length < 2) return null;

  // Rechazar si contiene palabras interrogativas → no es un nombre de producto
  const words = candidate.split(/\s+/);
  if (words.some((w) => QUESTION_WORDS.has(w))) return null;

  return candidate;
}

/**
 * Resuelve el producto e intención efectivos a partir de la detección actual
 * y el contexto previo de la sesión.
 *
 * @param {string|null} detectedProduct  Entidad de producto detectada en el mensaje actual
 * @param {string|null} detectedIntent   Intención detectada en el mensaje actual
 * @param {{ lastProduct: string|null, lastIntent: string|null }} context  Contexto Redis
 * @returns {{ effectiveProduct: string|null, effectiveIntent: string|null }}
 */
function resolveEffectiveContext(detectedProduct, detectedIntent, context) {
  // Prioridad 1: producto detectado ahora → producto track, no heredar lastIntent
  if (detectedProduct) {
    return { effectiveProduct: detectedProduct, effectiveIntent: null };
  }

  // Prioridad 2: intención standalone → autosuficiente, ignorar producto previo
  // "¿A qué hora abren?" no necesita saber que antes se habló de pizza
  if (detectedIntent && STANDALONE_INTENTS.has(detectedIntent)) {
    return { effectiveProduct: null, effectiveIntent: detectedIntent };
  }

  // Prioridad 3: intención dependiente de producto → heredar lastProduct del contexto
  // "¿y cuánto cuesta?" (precios) → usa el producto del turno anterior
  if (detectedIntent) {
    return {
      effectiveProduct: context.lastProduct ?? null,
      effectiveIntent:  detectedIntent,
    };
  }

  // Prioridad 4: nada detectado → fallback completo al contexto previo
  return {
    effectiveProduct: context.lastProduct ?? null,
    effectiveIntent:  context.lastIntent  ?? null,
  };
}

/**
 * Construye el objeto parcial a persistir en Redis tras procesar un turno.
 *
 * LÓGICA DE ACTUALIZACIÓN:
 *   - Producto detectado → guarda producto y limpia intent (cambio de track)
 *   - Intent detectado   → guarda solo intent (lastProduct se preserva vía merge en updateContext)
 *   - Nada detectado     → devuelve {} → el llamador no llama updateContext
 *
 * El merge con el contexto previo ocurre en sessionContextService.updateContext().
 *
 * @param {string|null} detectedProduct
 * @param {string|null} detectedIntent
 * @returns {Record<string, any>}  Objeto parcial para updateContext, o {} si no hay nada
 */
function buildContextUpdate(detectedProduct, detectedIntent) {
  if (detectedProduct) {
    // Al detectar un nuevo producto, limpiamos el intent para no mezclar tracks
    return { lastProduct: detectedProduct, lastIntent: null };
  }
  if (detectedIntent) {
    if (STANDALONE_INTENTS.has(detectedIntent)) {
      // Intención autosuficiente: limpiar lastProduct (cambio de tema completo)
      // Evita que "pizza" persista en contexto después de preguntar por horarios/ubicación
      return { lastIntent: detectedIntent, lastProduct: null };
    }
    // Intención dependiente de producto → solo actualizar intent; lastProduct se preserva por merge
    return { lastIntent: detectedIntent };
  }
  // Nada nuevo — no contaminar el contexto con un update vacío
  return {};
}

export {
  resolveEffectiveContext,
  buildContextUpdate,
  extractFollowUpProduct,
  shouldUseContext,
};

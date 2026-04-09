'use strict';

/**
 * src/services/subscriptionController.js
 *
 * SUBSCRIPTION CONTROLLER
 * ──────────────────────────────────────────────────────────────────────────────
 * Intercepta cualquier mensaje que el pipeline haya decidido manejar con IA
 * (decision.strategy === 'ai') y comprueba el plan de suscripción del negocio
 * ANTES de realizar la llamada a llama3.
 *
 * Planes (columna subscription_id en tabla businesses):
 *   1 = Lite    → Sin IA. Devuelve texto placeholder.
 *   2 = Premium → Llama a llama3 via Ollama (RAG + generateOllamaResponse).
 *
 * Por qué llamamos a llama3 directamente aquí en lugar de usar handleAIFallback:
 *   handleAIFallback pasa por shouldUseAI(), que puede redirigir mensajes cortos
 *   o con contexto disponible hacia el mock backend, evitando llama3 incluso en
 *   plan Premium. Al ir directamente a generateOllamaResponse garantizamos que
 *   plan=2 SIEMPRE use el modelo real.
 *
 * FLUJO:
 *   1. Consultar subscription_id del negocio en la BD.
 *   2. Si es 1 (Lite)    → devolver "respondiendo con redis", sin llamar a la IA.
 *   3. Si es 2 (Premium) → RAG filter → llama3 → fallback mock si Ollama está caído.
 */

const BusinessModel          = require('../models/businessModel');
const { filterRelevantData } = require('./ragFilterService');
const { generateOllamaResponse } = require('./ollamaService');
const { getRAGOpenAIResponse }   = require('../temp/mockOpenAI');

/** IDs de plan */
const PLAN_LITE    = 1;
const PLAN_PREMIUM = 2;

// ─── Consulta de plan ─────────────────────────────────────────────────────────

/**
 * Lee subscription_id de la BD para el negocio dado.
 * - Devuelve PLAN_LITE si no se encuentra la fila o la columna no existe todavía
 *   (migración pendiente), para que la IA nunca se active sin confirmación explícita.
 *
 * @param {number} businessId
 * @returns {Promise<number>}  1 = Lite | 2 = Premium
 */
async function getSubscriptionPlan(businessId) {
  try {
    const raw = await BusinessModel.getSubscriptionId(businessId);
    const plan = Number(raw);
    console.log('[SubscriptionController] businessId=%d → subscription_id=%d', businessId, plan);
    return plan;
  } catch (err) {
    // La columna puede no existir aún (migración pendiente) → Lite por defecto.
    console.warn(
      '[SubscriptionController] Error leyendo subscription_id para businessId=%d: %s. Usando Lite.',
      businessId,
      err.message
    );
    return PLAN_LITE;
  }
}

// ─── Gate de IA ───────────────────────────────────────────────────────────────

/**
 * Punto de entrada principal. Llamar ANTES de cualquier llamada a la IA cuando
 * decision.strategy === 'ai'.
 *
 * @param {{
 *   businessId:     number,
 *   originalText:   string,   // texto original del usuario
 *   normalizedText: string,   // texto preprocesado
 *   intentResult:   object,
 *   entityResult:   object,
 *   context:        object,   // contexto Redis { lastIntent, lastEntity }
 * }} params
 * @returns {Promise<{
 *   text:       string,        // respuesta final para el usuario
 *   aiUsed:     boolean,       // true si llama3 generó la respuesta
 *   ragContext: object|null,   // datos RAG usados (null si Lite)
 *   plan:       number,        // plan efectivo aplicado (1 o 2)
 * }>}
 */
async function handleAIGate({ businessId, originalText, normalizedText, intentResult, entityResult, context }) {

  // ── 1. Consultar plan en la BD ────────────────────────────────────────────
  const plan = await getSubscriptionPlan(businessId);

  // ── 2. Plan Lite (subscription_id = 1): sin IA ────────────────────────────
  if (plan !== PLAN_PREMIUM) {
    console.log('[SubscriptionController] Plan Lite → devolviendo placeholder.');
    return {
      text:       'Qué producto tienes en mente?',
      aiUsed:     false,
      ragContext: null,
      plan:       PLAN_LITE,
    };
  }

  // ── 3. Plan Premium (subscription_id = 2): llamar a llama3 ───────────────
  console.log('[SubscriptionController] Plan Premium → llamando a llama3.');

  // Paso 3a: RAG filter — obtener solo los datos relevantes de la BD.
  const ragContext = await filterRelevantData(
    normalizedText, businessId, intentResult, entityResult, context
  );

  // Paso 3b: llamar a Ollama (llama3) con el perfil del negocio + contexto RAG.
  const ollamaText = await generateOllamaResponse(
    originalText,
    ragContext,
    { lastIntent: context?.lastIntent ?? null, lastEntity: context?.lastEntity ?? null },
    businessId
  );

  if (ollamaText) {
    return { text: ollamaText, aiUsed: true, ragContext, plan: PLAN_PREMIUM };
  }

  // Paso 3c: Ollama no disponible → fallback mock con datos RAG ya filtrados.
  console.warn('[SubscriptionController] Ollama no disponible. Usando fallback mock.');
  const fallbackText = getRAGOpenAIResponse(originalText, ragContext, {
    lastIntent: context?.lastIntent ?? null,
    lastEntity: context?.lastEntity ?? null,
  });

  return { text: fallbackText, aiUsed: true, ragContext, plan: PLAN_PREMIUM };
}

module.exports = { handleAIGate, getSubscriptionPlan, PLAN_LITE, PLAN_PREMIUM };

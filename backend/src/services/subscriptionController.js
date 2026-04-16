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
 *   1 = Emprendedor → Sin IA. Devuelve texto placeholder.
 *   2 = Lite        → Sin IA. Devuelve texto placeholder.
 *   3 = Empresarial → Sin IA. Devuelve texto placeholder.
 *   4 = Premium     → Llama a llama3 via Ollama (RAG + generateOllamaResponse).
 *   5 = Custom      → Llama a llama3 via Ollama (RAG + generateOllamaResponse).
 *
 * Regla: subscription_id ∈ {1, 2, 3} → sin Ollama
 *        subscription_id ∈ {4, 5}    → con Ollama
 *
 * Por qué llamamos a llama3 directamente aquí en lugar de usar handleAIFallback:
 *   handleAIFallback pasa por shouldUseAI(), que puede redirigir mensajes cortos
 *   o con contexto disponible hacia el mock backend, evitando llama3 incluso en
 *   planes con IA. Al ir directamente a generateOllamaResponse garantizamos que
 *   los planes 4 y 5 SIEMPRE usen el modelo real.
 *
 * FLUJO:
 *   1. Consultar subscription_id del negocio en la BD.
 *   2. Si ∈ {1,2,3} → devolver placeholder, sin llamar a la IA.
 *   3. Si ∈ {4,5}   → RAG filter → llama3 → fallback mock si Ollama está caído.
 */

import BusinessModel from '../models/businessModel.js';
import { filterRelevantData } from './ragFilterService.js';
import { generateOllamaResponse } from './ollamaService.js';
import { getRAGOpenAIResponse } from '../temp/mockOpenAI.js';

// ─── Definición de planes ─────────────────────────────────────────────────────

const PLAN_EMPRENDEDOR = 1;
const PLAN_LITE        = 2;
const PLAN_EMPRESARIAL = 3;
const PLAN_PREMIUM     = 4;
const PLAN_CUSTOM      = 5;

/** Conjunto de planes que habilitan Ollama. */
const OLLAMA_PLANS = new Set([PLAN_PREMIUM, PLAN_CUSTOM]);

/** Nombre legible de cada plan (para logs). */
const PLAN_NAMES = {
  [PLAN_EMPRENDEDOR]: 'Emprendedor',
  [PLAN_LITE]:        'Lite',
  [PLAN_EMPRESARIAL]: 'Empresarial',
  [PLAN_PREMIUM]:     'Premium',
  [PLAN_CUSTOM]:      'Custom',
};

// ─── Consulta de plan ─────────────────────────────────────────────────────────

/**
 * Lee subscription_id de la BD para el negocio dado.
 * Devuelve PLAN_LITE si no se encuentra la fila o la columna no existe todavía
 * (migración pendiente), para que la IA nunca se active sin confirmación
 * explícita.
 *
 * @param {number} businessId
 * @returns {Promise<number>}
 */
async function getSubscriptionPlan(businessId) {
  try {
    const raw  = await BusinessModel.getSubscriptionId(businessId);
    const plan = Number(raw);
    console.log(
      '[SubscriptionController] businessId=%d → subscription_id=%d (%s)',
      businessId, plan, PLAN_NAMES[plan] ?? 'desconocido'
    );
    return plan;
  } catch (err) {
    console.warn(
      '[SubscriptionController] Error leyendo subscription_id para businessId=%d: %s. Usando Lite.',
      businessId, err.message
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
 *   sessionId?:     string|null,
 * }} params
 * @returns {Promise<{
 *   text:       string,        // respuesta final para el usuario
 *   aiUsed:     boolean,       // true si llama3 generó la respuesta
 *   ragContext: object|null,   // datos RAG usados (null si plan sin IA)
 *   plan:       number,        // plan efectivo aplicado
 * }>}
 */
async function handleAIGate({ businessId, originalText, normalizedText, intentResult, entityResult, context, sessionId = null, onToken = null }) {

  // ── 1. Consultar plan en la BD ────────────────────────────────────────────
  const plan = await getSubscriptionPlan(businessId);

  // ── 2. Planes sin IA (1, 2, 3) ───────────────────────────────────────────
  if (!OLLAMA_PLANS.has(plan)) {
    console.log(
      '[SubscriptionController] Plan %s (id=%d) sin IA → devolviendo placeholder.',
      PLAN_NAMES[plan] ?? 'desconocido', plan
    );
    return {
      text:       '¿Qué producto tienes en mente?',
      aiUsed:     false,
      ragContext: null,
      plan,
    };
  }

  // ── 3. Planes con IA (4 = Premium, 5 = Custom) → llamar a llama3 ─────────
  console.log(
    '[SubscriptionController] Plan %s (id=%d) con IA → llamando a llama3.',
    PLAN_NAMES[plan], plan
  );

  // Paso 3a: RAG filter — obtener solo los datos relevantes de la BD.
  const ragContext = await filterRelevantData(
    normalizedText, businessId, intentResult, entityResult, context
  );

  // Paso 3b: llamar a Ollama (llama3) con el perfil del negocio + contexto RAG.
  const ollamaText = await generateOllamaResponse(
    originalText,
    ragContext,
    { lastIntent: context?.lastIntent ?? null, lastEntity: context?.lastEntity ?? null },
    businessId,
    sessionId,
    onToken
  );

  if (ollamaText) {
    return { text: ollamaText, aiUsed: true, ragContext, plan };
  }

  // Paso 3c: Ollama no disponible → fallback mock con datos RAG ya filtrados.
  console.warn('[SubscriptionController] Ollama no disponible. Usando fallback mock.');
  const fallbackText = getRAGOpenAIResponse(originalText, ragContext, {
    lastIntent: context?.lastIntent ?? null,
    lastEntity: context?.lastEntity ?? null,
  });

  return { text: fallbackText, aiUsed: true, ragContext, plan };
}

export {
  handleAIGate,
  getSubscriptionPlan,
  // Plan constants — exportados para tests y otros módulos
  PLAN_EMPRENDEDOR,
  PLAN_LITE,
  PLAN_EMPRESARIAL,
  PLAN_PREMIUM,
  PLAN_CUSTOM,
  OLLAMA_PLANS,
  PLAN_NAMES,
};

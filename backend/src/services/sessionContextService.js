/**
 * src/services/sessionContextService.js
 *
 * SESSION CONTEXT SERVICE — thin re-export layer.
 *
 * All Redis operations have been consolidated into redisService.js,
 * which owns the key schema and TTL constants.
 *
 * This module re-exports the context functions so that existing consumers
 * (messagePipeline.js, chatSocket.js, tests) require no import changes.
 *
 * Key schema (managed by redisService):
 *   ctx:<businessId>:<sessionId>   TTL: 210 s  (NLP context)
 *   hist:<businessId>:<sessionId>  TTL: 86400 s (message history)
 */

import {
  getContext,
  updateContext,
  EMPTY_CONTEXT,
  CTX_TTL_SECONDS,
  pushTurnMemory,
  addRejectedEntity,
} from './redisService.js';

/** Alias kept for backward compatibility with chatSocket.js */
const SESSION_TTL_SECONDS = CTX_TTL_SECONDS;

export { getContext, updateContext, EMPTY_CONTEXT, SESSION_TTL_SECONDS, pushTurnMemory, addRejectedEntity };


/**
 * src/config/redis.js
 *
 * REDIS CLIENT — Singleton ioredis instance.
 *
 * PROPÓSITO:
 *   Almacena el contexto conversacional temporal de cada sesión anónima.
 *   Toda la aplicación usa este único cliente para evitar múltiples conexiones.
 *
 * CONFIGURACIÓN (.env):
 *   REDIS_HOST  → host del servidor Redis (default: localhost)
 *   REDIS_PORT  → puerto Redis (default: 6379)
 *
 * RESILIENCIA:
 *   lazyConnect=true  → no bloquea el boot si Redis tarda en arrancar.
 *   retryStrategy     → deja de reintentar después de 3 intentos para no
 *                       saturar logs. Si Redis no está disponible,
 *                       sessionContextService captura el error y el chat
 *                       continúa sin contexto (degradación elegante).
 */

import Redis from 'ioredis';
import { REDIS_HOST, REDIS_PORT } from './env.js';

const redis = new Redis({
  host: REDIS_HOST,
  port: REDIS_PORT,
  lazyConnect: true,
  // Rule conn-timeouts: fail fast on unreachable Redis instead of hanging.
  // connectTimeout: how long to wait for the TCP handshake.
  // commandTimeout: how long a single command may take before it rejects.
  connectTimeout:      3000,  // 3 s — fast failure detection
  commandTimeout:      5000,  // 5 s — prevents slow commands from blocking
  maxRetriesPerRequest: 2,    // retry transient errors twice, then surface them
  retryStrategy: (times) => {
    if (times > 3) return null; // stop retrying — chat continues without Redis
    return Math.min(times * 300, 2000);
  },
});

// Track whether we've already told the operator that Redis is unavailable.
// Suppresses the repetitive ECONNREFUSED spam on every operation.
let _redisDown = false;

redis.on('connect', () => {
  _redisDown = false;
  console.log('[Redis] Conectado correctamente');
});

redis.on('error', (e) => {
  if (_redisDown) return;   // already logged — stay quiet
  _redisDown = true;
  const msg = e.code || e.message || 'Connection refused';
  console.warn(
    `[Redis] No disponible (${msg}). El chat continúa sin persistencia — ` +
    `inicia Redis para activar historial y contexto entre sesiones.`
  );
});

redis.on('reconnecting', () => {
  if (!_redisDown) console.log('[Redis] Reconectando...');
});

/**
 * Returns true when Redis is currently reachable.
 * Used by redisService to skip chatty per-operation error logs.
 */
function isRedisUp() { return !_redisDown; }

export { isRedisUp };
export default redis;

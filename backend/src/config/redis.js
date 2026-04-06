'use strict';

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

const Redis = require('ioredis');
const env   = require('./env');

const redis = new Redis({
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  // Conecta sólo cuando se ejecuta la primera operación
  lazyConnect: true,
  retryStrategy: (times) => {
    if (times > 3) return null; // Deja de reintentar — chat sigue sin contexto
    return Math.min(times * 300, 2000);
  },
});

redis.on('connect',      ()  => console.log('[Redis] Conectado correctamente'));
redis.on('error',        (e) => console.error('[Redis] Error:', e.message));
redis.on('reconnecting', ()  => console.log('[Redis] Reconectando...'));

module.exports = redis;

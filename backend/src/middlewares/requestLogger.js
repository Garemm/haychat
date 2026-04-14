/**
 * src/middlewares/requestLogger.js
 *
 * Lightweight request logger.
 * TIP: Replace with a structured logger (winston, pino) when going to production.
 *      Structured JSON logs integrate well with Datadog, Logtail, etc.
 */

const requestLogger = (req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 500 ? 'ERROR' : res.statusCode >= 400 ? 'WARN' : 'INFO';
    console.log(`[${level}] ${req.method} ${req.originalUrl} → ${res.statusCode} (${duration}ms)`);
  });

  next();
};

export default requestLogger;

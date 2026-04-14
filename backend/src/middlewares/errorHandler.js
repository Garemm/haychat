/**
 * src/middlewares/errorHandler.js
 *
 * Centralized Express error handler.
 * Must be registered LAST in app.js (after all routes).
 *
 * TIP: As the app grows, add specific error-type checks here:
 *   - pg DatabaseError → 500 with sanitized message
 *   - Sequelize ValidationError → 400
 *   - Custom AppError class with `.status` property
 */

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  const status = err.status || 500;
  const message = err.message || 'Internal Server Error';

  if (process.env.NODE_ENV !== 'production') {
    console.error(`[ERROR] ${req.method} ${req.originalUrl}`, err);
  }

  res.status(status).json({
    success: false,
    message,
    // Never expose stack traces in production
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

export default errorHandler;

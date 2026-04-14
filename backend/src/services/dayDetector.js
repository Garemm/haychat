'use strict';

/**
 * src/services/dayDetector.js
 *
 * Day-of-week detection for Spanish messages.
 * Converts day name mentions into a structured entity ready for the pipeline.
 *
 * day_of_week values follow PostgreSQL convention (used in business_hours):
 *   0 = Domingo, 1 = Lunes, ..., 6 = Sábado
 */

/** Normalized (accent-free, lowercase) day names → day_of_week index. */
const DAY_MAP = {
  domingo:   0,
  lunes:     1,
  martes:    2,
  miercoles: 3,
  jueves:    4,
  viernes:   5,
  sabado:    6,
};

/** Display names (with accents) for each day_of_week index. */
const DAY_DISPLAY = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

/**
 * Returns the accented display name for a normalized day key.
 * @param {string} normalizedDayKey   e.g. "miercoles"
 * @returns {string}                  e.g. "Miércoles"
 */
function getDayDisplayName(normalizedDayKey) {
  const idx = DAY_MAP[normalizedDayKey];
  return idx !== undefined ? DAY_DISPLAY[idx] : normalizedDayKey;
}

/**
 * Detects the first day-of-week mention in a normalized Spanish message.
 *
 * @param {string} normalizedText  Already lowercased + accent-stripped text.
 * @returns {{ type: 'day', value: string, dayOfWeek: number }|null}
 */
function detectDay(normalizedText) {
  if (!normalizedText) return null;

  for (const [dayKey, dayOfWeek] of Object.entries(DAY_MAP)) {
    // Word boundaries prevent "martes" matching inside "marteseño" (hypothetical)
    const re = new RegExp(`\\b${dayKey}\\b`);
    if (re.test(normalizedText)) {
      return { type: 'day', value: dayKey, dayOfWeek };
    }
  }
  return null;
}

export { detectDay, DAY_MAP, DAY_DISPLAY, getDayDisplayName };

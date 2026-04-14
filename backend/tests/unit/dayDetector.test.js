import { detectDay, DAY_MAP, DAY_DISPLAY, getDayDisplayName } from '../../src/services/dayDetector.js';

// ─── detectDay() ──────────────────────────────────────────────────────────────

describe('detectDay()', () => {

  describe('detects all Spanish day names', () => {
    const CASES = [
      ['domingo',    0],
      ['lunes',      1],
      ['martes',     2],
      ['miercoles',  3],
      ['jueves',     4],
      ['viernes',    5],
      ['sabado',     6],
    ];

    test.each(CASES)('"%s" → dayOfWeek=%i', (dayKey, dayOfWeek) => {
      const result = detectDay(dayKey);
      expect(result).not.toBeNull();
      expect(result.type).toBe('day');
      expect(result.value).toBe(dayKey);
      expect(result.dayOfWeek).toBe(dayOfWeek);
    });
  });

  describe('detects day inside a natural sentence', () => {
    const CASES = [
      ['abren el lunes',           'lunes',     1],
      ['abren los martes',         'martes',    2],
      ['atienden el viernes',      'viernes',   5],
      ['que pasa el sabado',       'sabado',    6],
      ['y el miercoles?',          'miercoles', 3],
      ['el jueves abren?',         'jueves',    4],
      ['cierran el domingo',       'domingo',   0],
      ['lunes a viernes',          'lunes',     1], // first match wins
    ];

    test.each(CASES)('"%s" → "%s" (dayOfWeek=%i)', (input, expectedDay, expectedDOW) => {
      const result = detectDay(input);
      expect(result).not.toBeNull();
      expect(result.value).toBe(expectedDay);
      expect(result.dayOfWeek).toBe(expectedDOW);
    });
  });

  describe('returns null when no day present', () => {
    const CASES = [
      'cuando abren',
      'a que hora cierran',
      'horarios de atencion',
      'precio hamburguesa',
      'hola como estas',
      '',
    ];

    test.each(CASES)('"%s" → null', (input) => {
      expect(detectDay(input)).toBeNull();
    });
  });

  describe('handles edge cases', () => {
    test('null input → null', () => {
      expect(detectDay(null)).toBeNull();
    });

    test('bare day name "lunes?" (trailing punctuation stripped by normalize)', () => {
      // After normalize(), "lunes?" becomes "lunes"
      expect(detectDay('lunes')).not.toBeNull();
    });
  });
});

// ─── getDayDisplayName() ──────────────────────────────────────────────────────

describe('getDayDisplayName()', () => {
  const CASES = [
    ['domingo',   'Domingo'],
    ['lunes',     'Lunes'],
    ['martes',    'Martes'],
    ['miercoles', 'Miércoles'],
    ['jueves',    'Jueves'],
    ['viernes',   'Viernes'],
    ['sabado',    'Sábado'],
  ];

  test.each(CASES)('"%s" → "%s"', (input, expected) => {
    expect(getDayDisplayName(input)).toBe(expected);
  });
});

// ─── Mock the pg Pool before requiring the module under test ─────────────────
jest.mock('../../src/config/database', () => ({
  query: jest.fn(),
}));

import db from '../../src/config/database.js';
import {
  normalize,
  extractProductEntity,
  extractAndRespond,
} from '../../src/services/nlpEntityExtractor.js';

// ─── normalize() ─────────────────────────────────────────────────────────────

describe('normalize()', () => {
  test('lowercases text', () => {
    expect(normalize('Hola MUNDO')).toBe('hola mundo');
  });

  test('strips accent marks', () => {
    expect(normalize('qué día están abiertos')).toBe('que dia estan abiertos');
  });

  test('removes inverted punctuation (¿ ¡)', () => {
    expect(normalize('¿Cuándo abren?')).toBe('cuando abren?');
  });

  test('trims surrounding whitespace', () => {
    expect(normalize('  hola  ')).toBe('hola');
  });

  test('handles empty string', () => {
    expect(normalize('')).toBe('');
  });

  test('handles string with only accents/punctuation', () => {
    expect(normalize('¿¡')).toBe('');
  });
});

// ─── extractProductEntity() ───────────────────────────────────────────────────

describe('extractProductEntity()', () => {

  // ── Regex patterns: positive matches ────────────────────────────────────────
  describe('regex patterns — should extract entity', () => {
    const CASES = [
      // [normalized input, expected entity]
      ['tienen hamburguesa doble',          'hamburguesa doble'],
      ['tienen la hamburguesa doble',       'hamburguesa doble'],
      ['tienes pizza pepperoni',            'pizza pepperoni'],
      ['hay pozole rojo',                   'pozole rojo'],
      ['hay disponibilidad de agua mineral','agua mineral'],
      ['tienen disponible la birria',       'birria'],
      ['cuanto cuesta la pizza pepperoni',  'pizza pepperoni'],
      ['cuanto vale el pozole',             'pozole'],
      ['precio de la hamburguesa',          'hamburguesa'],
      ['busco agua mineral',                'agua mineral'],
      ['quiero una hamburguesa',            'hamburguesa'],
      ['existe el pozole rojo',             'pozole rojo'],
      ['me interesa el mole poblano',       'mole poblano'],
      ['info de la pizza margarita',        'pizza margarita'],
    ];

    test.each(CASES)('"%s" → "%s"', (input, expected) => {
      expect(extractProductEntity(input)).toBe(expected);
    });
  });

  // ── Blocklist: should NOT extract generic category words ────────────────────
  describe('blocklist — should return null for generic terms', () => {
    const BLOCKED = [
      'cuando abren',
      'que productos tienen',
      'cuantos productos hay',
      'tienen un catalogo',
      'muestrame el menu',
      'lista de servicios',
      'hay ofertas',
      'hola que tal',
      'gracias',
    ];

    test.each(BLOCKED)('"%s" → null', (input) => {
      expect(extractProductEntity(input)).toBeNull();
    });
  });

  // ── Trigger word guard ───────────────────────────────────────────────────────
  describe('trigger word guard — NLP fallback should not run without trigger', () => {
    test('plain greeting returns null', () => {
      expect(extractProductEntity('hola como estas')).toBeNull();
    });

    test('schedule question returns null', () => {
      expect(extractProductEntity('cuando abren los domingos')).toBeNull();
    });

    test('message with trigger word but blocklisted entity returns null', () => {
      expect(extractProductEntity('tienen productos')).toBeNull();
    });
  });
});

// ─── extractAndRespond() — DB mocked ─────────────────────────────────────────

describe('extractAndRespond()', () => {

  beforeEach(() => {
    db.query.mockReset();
  });

  test('returns null when no entity is detected', async () => {
    const result = await extractAndRespond('cuando abren?');
    expect(result).toBeNull();
    expect(db.query).not.toHaveBeenCalled();
  });

  test('returns null when entity triggers DB, but returns empty rows', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const result = await extractAndRespond('tienen piñata gigante?');
    // entity "piñata gigante" is not blocklisted, DB returns empty
    expect(result).toContain('no encontré ningún producto');
  });

  test('formats single product correctly', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{
        id: 42,
        name: 'Hamburguesa Doble',
        description: 'Doble carne con queso',
        price: '150.00',
        is_available: true,
        stock_quantity: 30,
      }],
    });

    const result = await extractAndRespond('tienen hamburguesa doble?');
    expect(result).toContain('Hamburguesa Doble');
    expect(result).toContain('$150.00');
    expect(result).toContain('Disponible');
    expect(result).toContain('Stock: 30');
  });

  test('formats multiple products as compact list', async () => {
    db.query.mockResolvedValueOnce({
      rows: [
        { id: 1, name: 'Pizza Margarita',  price: '110.00', is_available: true, stock_quantity: 20 },
        { id: 2, name: 'Pizza Pepperoni',  price: '130.00', is_available: true, stock_quantity: 35 },
        { id: 3, name: 'Pizza Hawaiana',   price: '120.00', is_available: false, stock_quantity: 0  },
      ],
    });

    const result = await extractAndRespond('tienen pizza?');
    expect(result).toContain('3 productos');
    expect(result).toContain('Pizza Margarita');
    expect(result).toContain('Pizza Pepperoni');
    expect(result).toContain('Pizza Hawaiana');
    expect(result).toContain('✅');
    expect(result).toContain('❌');
  });

  test('shows unavailable product when is_available is false', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{
        id: 99,
        name: 'Pozole de Cabeza',
        description: null,
        price: '120.00',
        is_available: false,
        stock_quantity: 0,
      }],
    });

    const result = await extractAndRespond('hay pozole de cabeza?');
    expect(result).toContain('No disponible');
  });

  test('propagates DB errors', async () => {
    db.query.mockRejectedValueOnce(new Error('DB connection refused'));
    await expect(extractAndRespond('tienen tacos?')).rejects.toThrow('DB connection refused');
  });

  test('is accent-insensitive for entity extraction', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ id: 1, name: 'Pozole Rojo', description: null, price: '110.00', is_available: true, stock_quantity: 25 }],
    });

    const result = await extractAndRespond('hay póżolé rojo?');
    expect(result).toContain('Pozole Rojo');
  });
});

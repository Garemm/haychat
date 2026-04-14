import { getKeywordResponse } from '../../src/mockai/keywordResponses.js';

// ─── Positive matches ─────────────────────────────────────────────────────────

describe('getKeywordResponse() — known keywords', () => {
  test('"hola" returns greeting response', () => {
    expect(getKeywordResponse('hola')).toBe('¡Hola! 👋 ¿En qué te puedo ayudar hoy?');
  });

  test('"como te llamas" returns name response', () => {
    expect(getKeywordResponse('como te llamas')).toBe('Soy tu asistente virtual 😊 Estoy aquí para ayudarte con cualquier pregunta sobre nuestros productos, horarios, precios, promociones y más. ¿En qué te puedo ayudar?');
  });

  test('"\u00bfcomo te llamas?" (with punctuation) returns name response', () => {
    expect(getKeywordResponse('\u00bfcomo te llamas?')).toBe('Soy tu asistente virtual 😊 Estoy aquí para ayudarte con cualquier pregunta sobre nuestros productos, horarios, precios, promociones y más. ¿En qué te puedo ayudar?');
  });

  test('"cómo te llamas" (with accent) returns name response', () => {
    expect(getKeywordResponse('cómo te llamas')).toBe('Soy tu asistente virtual 😊 Estoy aquí para ayudarte con cualquier pregunta sobre nuestros productos, horarios, precios, promociones y más. ¿En qué te puedo ayudar?');
  });
});

// ─── Case-insensitivity ────────────────────────────────────────────────────────

describe('getKeywordResponse() — case-insensitive matching', () => {
  test('"HOLA" matches', () => {
    expect(getKeywordResponse('HOLA')).toBe('¡Hola! 👋 ¿En qué te puedo ayudar hoy?');
  });

  test('"Hola Mundo" matches', () => {
    expect(getKeywordResponse('Hola Mundo')).toBe('¡Hola! 👋 ¿En qué te puedo ayudar hoy?');
  });

  test('"Como Te Llamas" matches', () => {
    expect(getKeywordResponse('Como Te Llamas')).toBe('Soy tu asistente virtual 😊 Estoy aquí para ayudarte con cualquier pregunta sobre nuestros productos, horarios, precios, promociones y más. ¿En qué te puedo ayudar?');
  });
});

// ─── Keyword embedded in sentence ────────────────────────────────────────────

describe('getKeywordResponse() — keyword inside a longer message', () => {
  test('sentence containing "hola" returns greeting response', () => {
    expect(getKeywordResponse('oye hola que tal estas')).toBe('¡Hola! 👋 ¿En qué te puedo ayudar hoy?');
  });
});

// ─── No match ─────────────────────────────────────────────────────────────────

describe('getKeywordResponse() — no match → null', () => {
  const NO_MATCH = [
    'que hora es',
    'cuanto cuesta',
    'tienen tacos',
    'adios',
    '   ',
    'xyzzy',
  ];

  test.each(NO_MATCH)('"%s" → null', (msg) => {
    expect(getKeywordResponse(msg)).toBeNull();
  });
});

// ─── Edge cases / guard clauses ───────────────────────────────────────────────

describe('getKeywordResponse() — edge cases', () => {
  test('null input returns null', () => {
    expect(getKeywordResponse(null)).toBeNull();
  });

  test('undefined input returns null', () => {
    expect(getKeywordResponse(undefined)).toBeNull();
  });

  test('empty string returns null', () => {
    expect(getKeywordResponse('')).toBeNull();
  });
});

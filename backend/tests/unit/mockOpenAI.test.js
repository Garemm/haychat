import { getMockOpenAIResponse } from '../../src/temp/mockOpenAI.js';

// ─── Sin contexto ─────────────────────────────────────────────────────────────

describe('getMockOpenAIResponse() — sin contexto', () => {
  test('devuelve un string cuando context es null', () => {
    const res = getMockOpenAIResponse('hola que tal', null);
    expect(typeof res).toBe('string');
    expect(res.length).toBeGreaterThan(0);
  });

  test('devuelve un string cuando context es undefined (default param)', () => {
    const res = getMockOpenAIResponse('algo raro');
    expect(typeof res).toBe('string');
  });

  test('respuesta genérica menciona las capacidades del bot', () => {
    const res = getMockOpenAIResponse('no entiendo nada', null);
    // Debe mencionar al menos uno de los temas disponibles
    const hasTema = ['Horarios', 'Productos', 'Precios', 'Promociones', 'Ubicación']
      .some((t) => res.includes(t));
    expect(hasTema).toBe(true);
  });

  test('respuesta genérica contiene algún emoji', () => {
    const res = getMockOpenAIResponse('test', null);
    // La respuesta genérica debe incluir algún emoji (puede variar)
    expect(res).toMatch(/[\u{1F300}-\u{1FFFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u);
  });
});

// ─── Con lastProduct en contexto ─────────────────────────────────────────────

describe('getMockOpenAIResponse() — con lastProduct', () => {
  test('menciona el producto del contexto en la respuesta', () => {
    const res = getMockOpenAIResponse('¿y eso?', { lastProduct: 'hamburguesa doble', lastIntent: null });
    expect(res).toContain('hamburguesa doble');
  });

  test('respuesta menciona el producto en texto plano o markdown', () => {
    const res = getMockOpenAIResponse('info', { lastProduct: 'pizza margherita', lastIntent: null });
    // El producto debe aparecer en la respuesta (sin importar si usa markdown o no)
    expect(res).toContain('pizza margherita');
  });

  test('da prioridad a lastProduct sobre lastIntent cuando ambos están presentes', () => {
    const res = getMockOpenAIResponse('¿y cuánto cuesta?', { lastProduct: 'pozole', lastIntent: 'precios' });
    expect(res).toContain('pozole');
  });
});

// ─── Con lastIntent en contexto (sin producto) ────────────────────────────────

describe('getMockOpenAIResponse() — con lastIntent (sin producto)', () => {
  const INTENT_CASES = [
    ['horarios',    'horarios de atención'],
    ['productos',   'productos disponibles'],
    ['precios',     'precios'],
    ['promociones', 'promociones activas'],
    ['ubicacion',   'ubicación del negocio'],
  ];

  test.each(INTENT_CASES)(
    'intent "%s" → respuesta menciona "%s"',
    (intent, expectedPhrase) => {
      const res = getMockOpenAIResponse('¿algo más?', { lastProduct: null, lastIntent: intent });
      expect(res.toLowerCase()).toContain(expectedPhrase.toLowerCase());
    }
  );

  test('intent desconocido no lanza excepción', () => {
    const res = getMockOpenAIResponse('hola', { lastProduct: null, lastIntent: 'intent_raro' });
    expect(typeof res).toBe('string');
  });
});

// ─── Robustez ─────────────────────────────────────────────────────────────────

describe('getMockOpenAIResponse() — robustez', () => {
  test('maneja mensaje vacío sin lanzar excepción', () => {
    expect(() => getMockOpenAIResponse('')).not.toThrow();
  });

  test('maneja context con campos faltantes sin lanzar excepción', () => {
    expect(() => getMockOpenAIResponse('hola', {})).not.toThrow();
  });

  test('siempre retorna un string', () => {
    const cases = [
      [null, null],
      ['', null],
      ['hola', { lastProduct: 'x', lastIntent: 'horarios' }],
      ['test', { lastProduct: null, lastIntent: null }],
    ];
    for (const [msg, ctx] of cases) {
      expect(typeof getMockOpenAIResponse(msg, ctx)).toBe('string');
    }
  });
});

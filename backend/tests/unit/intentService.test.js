import { detectIntent, scoreIntents, isStandaloneIntent, MIN_CONFIDENCE } from '../../src/services/intentDetector.js';

// ─── detectIntent ─────────────────────────────────────────────────────────────

describe('detectIntent()', () => {

  // ── horarios ────────────────────────────────────────────────────────────────
  describe('intent: horarios', () => {
    const HORARIOS_CASES = [
      // Formas plurales (ya existentes)
      'cuando abren?',
      'Cuando Abren',
      'cuándo abren',          // with accent
      'a que hora abren',
      'a qué hora abren',
      'a que hora cierran',
      'horario de atencion',
      'horario de atención',   // with accent
      'que dias atienden',
      'atienden los domingos',
      'atienden fines de semana',
      'hasta que hora atienden',
      'están abiertos ahora',
      'estan abiertos ahora',  // without accent
      'horarios',
      'cuales son sus horarios',
      'abren hoy',
      'abren mañana',
      // Segunda persona singular — bug-regression
      'que dia abres',
      '¿Qué día abres?',       // with accents + punctuation
      'que dias abres',
      '¿Qué días abres?',
      'cuando abres',
      '¿Cuándo abres?',
      'a que hora abres',
      '¿A qué hora abres?',
      'a que hora cierras',
      '¿A qué hora cierras?',
      'cuando cierras',
      '¿Cuándo cierras?',
      // Días de venta = horario de operación
      'que dias vendes',
      '¿Qué días vendes?',
    ];

    test.each(HORARIOS_CASES)('"%s" → horarios', (msg) => {
      expect(detectIntent(msg).intent).toBe('horarios');
    });
  });

  // ── productos ───────────────────────────────────────────────────────────────
  describe('intent: productos', () => {
    const PRODUCTOS_CASES = [
      'que productos tienen',
      'qué productos tienen',
      'que venden',
      'hay stock',
      'tienen en existencia',
      'catalogo de productos',
      'catálogo de productos',
      'lista de productos',
      'hay disponibilidad de algo',      // nuevas variantes de conjugación (tienes / tiene / vendes / vende)
      'que productos tienes',
      'que productos tiene',
      'que vendes',
      'que vende',
      'que tienes',
      'que tiene',
      'que tienes para vender',
      'que articulos tienes',
      'que articulos tiene',    ];

    test.each(PRODUCTOS_CASES)('"%s" → productos', (msg) => {
      expect(detectIntent(msg).intent).toBe('productos');
    });
  });

  // ── precios ──────────────────────────────────────────────────────────────────
  describe('intent: precios', () => {
    const PRECIOS_CASES = [
      'cuanto cuesta',
      'cuánto cuesta',
      'cuanto vale',
      'cual es el precio',
      'me puede dar el precio',
      'cuanto me cobra',
      'tarifa',
      'precio de lista',
      'precio al mayoreo',
      'en cuanto esta',
    ];

    test.each(PRECIOS_CASES)('"%s" → precios', (msg) => {
      expect(detectIntent(msg).intent).toBe('precios');
    });
  });

  // ── promociones ──────────────────────────────────────────────────────────────
  describe('intent: promociones', () => {
    const PROMO_CASES = [
      'tienen promociones',
      'hay promociones',
      'hay ofertas',
      'cupon de descuento',
      'cupón de descuento',
      'codigo de descuento',
      '2x1',
      'tienen programa de lealtad',
      'liquidacion',
      'liquidación',
    ];

    test.each(PROMO_CASES)('"%s" → promociones', (msg) => {
      expect(detectIntent(msg).intent).toBe('promociones');
    });
  });

  // ── ubicacion ────────────────────────────────────────────────────────────────
  describe('intent: ubicacion', () => {
    const UBICACION_CASES = [
      'donde estan ubicados',
      'dónde están ubicados',
      'cual es su direccion',
      'cuál es su dirección',
      'como llego',
      'cómo llego',
      'tienen tienda fisica',
      'tienen sucursales',
      'google maps',
      'mapa de ubicacion',
    ];

    test.each(UBICACION_CASES)('"%s" → ubicacion', (msg) => {
      expect(detectIntent(msg).intent).toBe('ubicacion');
    });
  });

  // ── descripcion ───────────────────────────────────────────────────────────────
  describe('intent: descripcion', () => {
    const DESCRIPCION_CASES = [
      // Singular forms (que + tiene/contiene/incluye/trae)
      'que tiene este producto',
      'que tiene la pizza',
      'que tiene el combo',
      'que contiene este articulo',
      'que contiene la hamburguesa',
      'que incluye',
      'que incluye el paquete',
      'que trae',
      'que trae el set',
      'de que esta hecho',
      'de que esta hecho el pan',
      // Plural forms (que + tienen/contienen/incluyen/traen)
      'que tienen los chiles en nogada',
      'que tienen las hamburguesas',
      'que tienen los tacos',
      'que contienen los chiles en nogada',
      'que contienen las pizzas',
      'que incluyen los combos',
      'que traen los paquetes',
      // Frases descriptivas explícitas
      'caracteristicas de la hamburguesa',
      'características de la hamburguesa',
      'especificaciones de X',
      'descripcion de este articulo',
      'informacion de la pizza',
    ];

    test.each(DESCRIPCION_CASES)('"%s" → descripcion', (msg) => {
      expect(detectIntent(msg).intent).toBe('descripcion');
    });

    // Diferenciación crítica: "tiene X" ≠ "que tiene X"
    test('"que tienes" → productos (NO descripcion)', () => {
      expect(detectIntent('que tienes').intent).toBe('productos');
      expect(detectIntent('que tienes').intent).not.toBe('descripcion');
    });

    test('"que tienes para vender" → productos (NO descripcion)', () => {
      expect(detectIntent('que tienes para vender').intent).toBe('productos');
    });

    test('"que tienen" (bare, sin objeto) → NO es descripcion', () => {
      expect(detectIntent('que tienen').intent).not.toBe('descripcion');
    });

    test('"que tienen?" (bare con signo) → NO es descripcion', () => {
      expect(detectIntent('que tienen?').intent).not.toBe('descripcion');
    });

    test('"que productos tienes" → productos (NO descripcion)', () => {
      expect(detectIntent('que productos tienes').intent).toBe('productos');
    });

    test('"tiene hamburguesa" → no es descripcion (disponibilidad)', () => {
      expect(detectIntent('tiene hamburguesa').intent).not.toBe('descripcion');
    });

    test('"tienen pizza" → no es descripcion (disponibilidad)', () => {
      expect(detectIntent('tienen pizza').intent).not.toBe('descripcion');
    });

    // Diferenciación crítica: "que [entidad] tienen" ≠ "que tiene/tienen [entidad]"
    test('"que hamburguesas tienen" → NO es descripcion (entidad antes del verbo)', () => {
      expect(detectIntent('que hamburguesas tienen').intent).not.toBe('descripcion');
    });

    test('"que tacos al pastor tienen" → NO es descripcion', () => {
      expect(detectIntent('que tacos al pastor tienen').intent).not.toBe('descripcion');
    });
  });

  // ── no match ─────────────────────────────────────────────────────────────────
  describe('no intent match', () => {
    const NO_MATCH_CASES = [
      'hola',
      'hola como estas',
      '',
      null,
      'gracias',
      'que tal',
      'adios',
      'ok',
    ];

    test.each(NO_MATCH_CASES)('"%s" → null', (msg) => {
      expect(detectIntent(msg).intent).toBeNull();
    });
  });

  // ── edge cases ───────────────────────────────────────────────────────────────
  describe('edge cases', () => {
    test('is case-insensitive', () => {
      expect(detectIntent('CUANDO ABREN?').intent).toBe('horarios');
      expect(detectIntent('CUÁNTO CUESTA').intent).toBe('precios');
    });

    test('is accent-insensitive', () => {
      expect(detectIntent('cuándo abren').intent).toBe('horarios');
      expect(detectIntent('cuando abren').intent).toBe('horarios');
    });

    test('detects intent inside longer sentence', () => {
      expect(detectIntent('hola, me podrían decir cuando abren por favor?').intent).toBe('horarios');
    });

    test('returns full result object with score and scores', () => {
      const result = detectIntent('cuanto cuesta');
      expect(result).toHaveProperty('intent', 'precios');
      expect(result).toHaveProperty('score');
      expect(result.score).toBeGreaterThanOrEqual(MIN_CONFIDENCE);
      expect(result).toHaveProperty('scores');
      expect(result).toHaveProperty('confident', true);
    });

    test('not-confident result has intent=null', () => {
      const result = detectIntent('hola');
      expect(result.intent).toBeNull();
      expect(result.confident).toBe(false);
      expect(result.score).toBe(0);
    });
  });
});

// ─── scoreIntents ─────────────────────────────────────────────────────────────

describe('scoreIntents()', () => {
  test('high-weight phrase scores more than single keyword', () => {
    const scores = scoreIntents('tienen descuentos');
    expect(scores.promociones).toBeGreaterThanOrEqual(3);
  });

  test('"tienen" alone does not match any intent', () => {
    const scores = scoreIntents('tienen');
    expect(Object.keys(scores).length).toBe(0);
  });

  test('returns empty object for unrecognized text', () => {
    const scores = scoreIntents('hola mundo');
    expect(scores).toEqual({});
  });

  test('can accept custom intents config', () => {
    const custom = {
      test_intent: {
        name: 'test_intent',
        standalone: true,
        keywords: [{ phrase: 'foobar', weight: 2 }],
      },
    };
    const scores = scoreIntents('foobar', custom);
    expect(scores.test_intent).toBe(2);
  });
});

// ─── isStandaloneIntent ───────────────────────────────────────────────────────

describe('isStandaloneIntent()', () => {
  test('horarios is standalone', () => {
    expect(isStandaloneIntent('horarios')).toBe(true);
  });

  test('ubicacion is standalone', () => {
    expect(isStandaloneIntent('ubicacion')).toBe(true);
  });

  test('promociones is standalone', () => {
    expect(isStandaloneIntent('promociones')).toBe(true);
  });

  test('precios is NOT standalone', () => {
    expect(isStandaloneIntent('precios')).toBe(false);
  });

  test('productos is NOT standalone', () => {
    expect(isStandaloneIntent('productos')).toBe(false);
  });

  test('unknown intent returns false', () => {
    expect(isStandaloneIntent('fake_intent')).toBe(false);
  });
});

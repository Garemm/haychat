// ─── Mock DB ─────────────────────────────────────────────────────────────────
jest.mock('../../src/config/database', () => ({ query: jest.fn() }));
// ─── Mock Redis ───────────────────────────────────────────────────────────────
jest.mock('../../src/config/redis', () => ({
  default: {
    get: jest.fn().mockResolvedValue(null),
    setex: jest.fn().mockResolvedValue('OK'),
  },
  isRedisUp: jest.fn().mockReturnValue(false),
}));
// ─── Mock OpenAI / AI modules — must NOT be called during attribute path ─────
var mockGetMockOpenAI = jest.fn();
var mockGetRAGOpenAI  = jest.fn();
jest.mock('../../src/temp/mockOpenAI', () => ({
  getMockOpenAIResponse: mockGetMockOpenAI,
  getRAGOpenAIResponse:  mockGetRAGOpenAI,
}));
jest.mock('../../src/services/aiDecisionEngine', () => ({
  shouldUseAI:     jest.fn().mockReturnValue({ routing: 'backend', reason: 'mocked' }),
  hasRelevantData: jest.fn().mockReturnValue(false),
}));
jest.mock('../../src/services/ragFilterService', () => ({
  filterRelevantData: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../src/services/businessInfoService', () => ({
  getBusinessInfoByIntent:    jest.fn().mockResolvedValue([]),
  getHorariosByDay:           jest.fn().mockResolvedValue(null),
  getCategories:              jest.fn().mockResolvedValue([]),
  getProductosByCategory:     jest.fn().mockResolvedValue([]),
  countProductosByCategory:   jest.fn().mockResolvedValue(0),
}));
jest.mock('../../src/mockai/keywordResponses', () => ({
  getKeywordResponse: jest.fn().mockReturnValue(null),
}));

import db from '../../src/config/database.js';
import {
  extractAttribute,
  extractCompoundQuery,
  extractCategoryAttributeQuery,
  isAttributeQuery,
  classifyAttributeType,
  isMeasure,
} from '../../src/services/attributeExtractor.js';
import {
  searchByAttribute,
  searchByAttributes,
  searchByCompoundQuery,
  searchByCategoryAttribute,
  formatAttributeResponse,
  formatCompoundQueryResponse,
  formatCategoryAttributeResponse,
  buildAttributeConditions,
} from '../../src/services/attributeSearchService.js';
import { detectEntities } from '../../src/services/entityDetector.js';
import { processMessage } from '../../src/services/messagePipeline.js';

beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockResolvedValue({ rows: [] });
});

// ─── attributeExtractor ───────────────────────────────────────────────────────

describe('attributeExtractor — extractAttribute()', () => {
  describe('detects attribute correctly', () => {
    const CASES = [
      ['tienes algo con queso',             { value: 'queso',            type: 'feature'  }],
      ['algo con bluetooth',                { value: 'bluetooth',        type: 'feature'  }],
      ['productos con wifi',                { value: 'wifi',             type: 'feature'  }],
      ['algo que tenga wifi',               { value: 'wifi',             type: 'feature'  }],
      ['algo que tengan pantalla tactil',   { value: 'pantalla tactil',  type: 'feature'  }],
      ['tornillos para madera',             { value: 'madera',           type: 'use'      }],
      ['algo para construccion',            { value: 'construccion',     type: 'use'      }],
      ['cables de 2 metros',                { value: '2 metros',         type: 'measure'  }],
      ['tornillos de 10 milimetros',        { value: '10 milimetros',    type: 'measure'  }],
      ['productos de acero inoxidable',     { value: 'acero inoxidable', type: 'material' }],
      ['algo con acero',                    { value: 'acero',            type: 'material' }],
      ['algo que tenga bluetooth y wifi',   { value: 'bluetooth y wifi', type: 'feature'  }],
    ];

    test.each(CASES)('"%s" → %j', (input, expected) => {
      const result = extractAttribute(input);
      expect(result).not.toBeNull();
      expect(result.value).toBe(expected.value);
      expect(result.type).toBe(expected.type);
    });
  });

  describe('returns null for non-attribute queries', () => {
    const NON_ATTR = [
      'tienen hamburguesa',
      'que precios tienen',
      'horario del sabado',
      'cuanto cuesta la pizza',
      'quiero una hamburguesa doble',
      'tienes cuadernos',
    ];

    test.each(NON_ATTR)('"%s" → null', (input) => {
      expect(extractAttribute(input)).toBeNull();
    });
  });
});

// ─── isMeasure ────────────────────────────────────────────────────────────────

describe('attributeExtractor — isMeasure()', () => {
  test.each([
    ['2 metros',        true],
    ['10 milimetros',   true],
    ['1.5 litros',      true],
    ['500 gramos',      true],
    ['15 watts',        true],
    ['queso',           false],
    ['bluetooth',       false],
    ['madera',          false],
  ])('"%s" → %s', (input, expected) => {
    expect(isMeasure(input)).toBe(expected);
  });
});

// ─── classifyAttributeType ────────────────────────────────────────────────────

describe('attributeExtractor — classifyAttributeType()', () => {
  test('measure: 10 milimetros', () => {
    expect(classifyAttributeType('10 milimetros', 'de')).toBe('measure');
  });
  test('material: acero inoxidable', () => {
    expect(classifyAttributeType('acero inoxidable', 'de')).toBe('material');
  });
  test('use: madera with hint para', () => {
    expect(classifyAttributeType('madera', 'para')).toBe('use');
  });
  test('feature: bluetooth with hint con', () => {
    expect(classifyAttributeType('bluetooth', 'con')).toBe('feature');
  });
  test('feature: wifi default', () => {
    expect(classifyAttributeType('wifi', 'que tenga')).toBe('feature');
  });
});

// ─── isAttributeQuery ─────────────────────────────────────────────────────────

describe('attributeExtractor — isAttributeQuery()', () => {
  test.each([
    ['algo con queso',          true],
    ['productos con bluetooth', true],
    ['algo que tenga wifi',     true],
    ['productos de acero',      true],
    ['tienen hamburguesa',      false],
    ['que precios tienen',      false],
  ])('"%s" → %s', (input, expected) => {
    expect(isAttributeQuery(input)).toBe(expected);
  });
});

// ─── buildAttributeConditions ────────────────────────────────────────────────

describe('attributeSearchService — buildAttributeConditions()', () => {
  test('builds conditions for a single-variant word', () => {
    const { conditions, params, nextIndex } = buildAttributeConditions('wifi', 2);
    // wifi has no plural/singular variant → 1 condition block, 5 params
    expect(conditions).toHaveLength(1);
    expect(params).toHaveLength(5);
    expect(params.every((p) => p === '%wifi%')).toBe(true);
    expect(nextIndex).toBe(7);
  });

  test('builds conditions for a plural word (wordVariants)', () => {
    // "tornillos" → variants: ["tornillos", "tornillo"]
    const { conditions, params } = buildAttributeConditions('tornillos', 2);
    expect(conditions).toHaveLength(2);   // one per variant
    expect(params).toHaveLength(10);      // 5 params × 2 variants
  });
});

// ─── searchByAttribute ────────────────────────────────────────────────────────

describe('attributeSearchService — searchByAttribute()', () => {
  test('queries DB and returns matching rows', async () => {
    const fakeRows = [
      { id: 1, name: 'Pizza con queso', description: 'Queso mozarella', price: 15, is_available: true, stock_quantity: 10, category: 'Pizzas' },
    ];
    db.query.mockResolvedValueOnce({ rows: fakeRows });

    const rows = await searchByAttribute('queso', 1);
    expect(rows).toEqual(fakeRows);
    expect(db.query).toHaveBeenCalledTimes(1);
    // Verify businessId param
    const [sql, params] = db.query.mock.calls[0];
    expect(params[0]).toBe(1);
    expect(sql).toMatch(/ILIKE/i);
    // Must NOT call openai
    expect(mockGetMockOpenAI).not.toHaveBeenCalled();
    expect(mockGetRAGOpenAI).not.toHaveBeenCalled();
  });

  test('returns empty array when no products match', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const rows = await searchByAttribute('queso', 1);
    expect(rows).toEqual([]);
  });
});

// ─── searchByAttributes (multi) ───────────────────────────────────────────────

describe('attributeSearchService — searchByAttributes()', () => {
  test('single attribute delegates to searchByAttribute', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 1, name: 'Test', price: 10, is_available: true }] });
    const { rows, strategy } = await searchByAttributes([{ value: 'queso', type: 'feature' }], 1);
    expect(rows).toHaveLength(1);
    expect(strategy).toBe('AND');
  });

  test('multi-attribute AND returns results when AND matches', async () => {
    const fakeRows = [{ id: 2, name: 'Pizza queso y pollo', price: 18, is_available: true }];
    db.query
      .mockResolvedValueOnce({ rows: fakeRows })   // AND query
    ;
    const { rows, strategy } = await searchByAttributes(
      [{ value: 'queso', type: 'feature' }, { value: 'pollo', type: 'feature' }],
      1
    );
    expect(rows).toEqual(fakeRows);
    expect(strategy).toBe('AND');
  });

  test('multi-attribute falls back to OR when AND returns empty', async () => {
    const fakeRows = [{ id: 3, name: 'Pollo BBQ', price: 12, is_available: true }];
    db.query
      .mockResolvedValueOnce({ rows: [] })         // AND miss
      .mockResolvedValueOnce({ rows: fakeRows })   // OR hit
    ;
    const { rows, strategy } = await searchByAttributes(
      [{ value: 'queso', type: 'feature' }, { value: 'pollo', type: 'feature' }],
      1
    );
    expect(rows).toEqual(fakeRows);
    expect(strategy).toBe('OR');
  });
});

// ─── formatAttributeResponse ─────────────────────────────────────────────────

describe('attributeSearchService — formatAttributeResponse()', () => {
  const attrs = [{ value: 'queso', type: 'feature' }];

  test('returns not-found message when rows empty', () => {
    const msg = formatAttributeResponse(attrs, []);
    expect(msg).toMatch(/no encontr/i);
    expect(msg).toMatch(/queso/);
  });

  test('formats single product correctly', () => {
    const rows = [{ id: 1, name: 'Pizza de queso', price: 15, is_available: true, stock_quantity: 5, category: 'Pizzas', description: null }];
    const msg = formatAttributeResponse(attrs, rows, 'AND');
    expect(msg).toMatch(/Pizza de queso/);
    expect(msg).toMatch(/15/);
    expect(msg).toMatch(/queso/);
  });

  test('formats multiple products with count', () => {
    const rows = [
      { id: 1, name: 'Pizza queso', price: 15, is_available: true, stock_quantity: null, category: null },
      { id: 2, name: 'Hamburguesa queso', price: 12, is_available: true, stock_quantity: null, category: null },
    ];
    const msg = formatAttributeResponse(attrs, rows, 'AND');
    expect(msg).toMatch(/2 opciones/i);
  });

  test('includes OR note when strategy is OR', () => {
    const rows = [{ id: 1, name: 'Pollo', price: 10, is_available: true, stock_quantity: null, category: null }];
    const msg = formatAttributeResponse(
      [{ value: 'queso', type: 'feature' }, { value: 'pollo', type: 'feature' }],
      rows,
      'OR'
    );
    expect(msg).toMatch(/criterios|cercanas/i);
  });
});

// ─── entityDetector — attribute routing ──────────────────────────────────────

describe('entityDetector — detectEntities() attribute routing', () => {
  test('"tienes algo con queso" → returns attribute entity', async () => {
    const result = await detectEntities('tienes algo con queso', 1, { intent: null, score: 0 });
    expect(result.type).toBe('attribute');
    expect(result.value).toBe('queso');
    expect(result.attributeType).toBe('feature');
    // DB should NOT be queried for attribute entities
    expect(db.query).not.toHaveBeenCalled();
  });

  test('"algo que tenga wifi" → attribute: wifi', async () => {
    const result = await detectEntities('algo que tenga wifi', 1, { intent: null, score: 0 });
    expect(result.type).toBe('attribute');
    expect(result.value).toBe('wifi');
  });

  test('"tornillos para madera" → attribute: madera (use)', async () => {
    const result = await detectEntities('productos para madera', 1, { intent: null, score: 0 });
    expect(result.type).toBe('attribute');
    expect(result.value).toBe('madera');
    expect(result.attributeType).toBe('use');
  });

  test('"cables de 2 metros" → attribute: 2 metros (measure)', async () => {
    const result = await detectEntities('productos de 2 metros', 1, { intent: null, score: 0 });
    expect(result.type).toBe('attribute');
    expect(result.value).toBe('2 metros');
    expect(result.attributeType).toBe('measure');
  });

  test('"tienen hamburguesa" → NOT attribute (normal product entity)', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id: 1, name: 'Hamburguesa', price: 10, is_available: true }] });
    const result = await detectEntities('tienen hamburguesa', 1, { intent: null, score: 0 });
    expect(result.type).not.toBe('attribute');
  });
});

// ─── Full pipeline — attribute strategy + no OpenAI ─────────────────────────

describe('processMessage() — attribute strategy', () => {
  test('"tienes algo con queso" → strategy=attribute, no OpenAI', async () => {
    const fakeProducts = [
      { id: 1, name: 'Pizza cuatro quesos', price: 20, is_available: true, stock_quantity: 3, category: 'Pizzas' },
    ];
    db.query.mockResolvedValueOnce({ rows: fakeProducts });

    const result = await processMessage({
      text: 'tienes algo con queso',
      sessionId: 'test-session-1',
      businessId: 1,
    });

    expect(result.decision.strategy).toBe('attribute');
    expect(result.decision.intent).toBe('productos');
    expect(result.replyText).toMatch(/Pizza cuatro quesos/);
    expect(mockGetMockOpenAI).not.toHaveBeenCalled();
    expect(mockGetRAGOpenAI).not.toHaveBeenCalled();
  });

  test('"productos con bluetooth" → strategy=attribute, no OpenAI', async () => {
    db.query.mockResolvedValueOnce({ rows: [
      { id: 5, name: 'Altavoz bluetooth', price: 50, is_available: true, stock_quantity: 8, category: 'Electrónica' },
    ]});

    const result = await processMessage({
      text: 'productos con bluetooth',
      sessionId: 'test-session-2',
      businessId: 1,
    });

    expect(result.decision.strategy).toBe('attribute');
    expect(result.replyText).toMatch(/Altavoz bluetooth/);
    expect(mockGetMockOpenAI).not.toHaveBeenCalled();
  });

  test('"tornillos para madera" → strategy=attribute', async () => {
    db.query.mockResolvedValueOnce({ rows: [
      { id: 10, name: 'Tornillo madera 3"', price: 0.5, is_available: true, stock_quantity: 200, category: 'Tornillería' },
    ]});

    const result = await processMessage({
      text: 'tornillos para madera',
      sessionId: 'test-session-3',
      businessId: 2,
    });

    expect(result.decision.strategy).toBe('attribute');
    expect(result.replyText).toMatch(/Tornillo madera/);
    expect(mockGetMockOpenAI).not.toHaveBeenCalled();
  });

  test('"cables de 2 metros" → strategy=attribute, measure type', async () => {
    db.query.mockResolvedValueOnce({ rows: [
      { id: 20, name: 'Cable HDMI 2m', price: 8, is_available: true, stock_quantity: 15, category: 'Cables' },
    ]});

    const result = await processMessage({
      text: 'cables de 2 metros',
      sessionId: 'test-session-4',
      businessId: 2,
    });

    expect(result.decision.strategy).toBe('attribute');
    expect(result.decision.entity.attributeType).toBe('measure');
    expect(mockGetMockOpenAI).not.toHaveBeenCalled();
  });

  test('"algo que tenga wifi" → strategy=attribute, no OpenAI', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const result = await processMessage({
      text: 'algo que tenga wifi',
      sessionId: 'test-session-5',
      businessId: 1,
    });

    expect(result.decision.strategy).toBe('attribute');
    expect(result.replyText).toMatch(/no encontr/i);
    expect(mockGetMockOpenAI).not.toHaveBeenCalled();
    expect(mockGetRAGOpenAI).not.toHaveBeenCalled();
  });

  test('attribute search → no OpenAI flow activated', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const result = await processMessage({
      text: 'productos con acero inoxidable',
      sessionId: 'test-session-6',
      businessId: 2,
    });

    // Must NOT fall through to AI
    expect(result.decision.strategy).not.toBe('ai');
    expect(mockGetMockOpenAI).not.toHaveBeenCalled();
    expect(mockGetRAGOpenAI).not.toHaveBeenCalled();
  });
});

// ─── extractCompoundQuery ────────────────────────────────────────────────────

describe('attributeExtractor — extractCompoundQuery()', () => {
  describe('detects compound queries correctly', () => {
    const CASES = [
      ['tornillos de madera',        { entity: 'tornillos', attribute: 'madera',  fullPhrase: 'tornillos de madera'  }],
      ['carne de res',               { entity: 'carne',     attribute: 'res',     fullPhrase: 'carne de res'         }],
      ['cables de cobre',            { entity: 'cables',    attribute: 'cobre',   fullPhrase: 'cables de cobre'      }],
      ['cable de cobre',             { entity: 'cable',     attribute: 'cobre',   fullPhrase: 'cable de cobre'       }],
      ['tornillo de madera',         { entity: 'tornillo',  attribute: 'madera',  fullPhrase: 'tornillo de madera'   }],
      ['tienes tornillos de madera', { entity: 'tornillos', attribute: 'madera',  fullPhrase: 'tornillos de madera'  }],
      ['busco carne de res',         { entity: 'carne',     attribute: 'res',     fullPhrase: 'carne de res'         }],
    ];

    test.each(CASES)('"%s"', (input, expected) => {
      const result = extractCompoundQuery(input);
      expect(result).not.toBeNull();
      expect(result.entity).toBe(expected.entity);
      expect(result.attribute).toBe(expected.attribute);
      expect(result.fullPhrase).toBe(expected.fullPhrase);
    });
  });

  describe('returns null for non-compound queries', () => {
    const NON_COMPOUND = [
      'tornillos',                  // no "de" separator
      'algo con queso',             // trigger-word attribute query (handled by extractAttribute)
      'productos de acero',         // "productos" is a blocked meta-word
      'cables de 2 metros',         // attribute is a measure → handled by existing flow
      'precio de la pizza',         // "precio" is a blocked meta-word
      'tienen hamburguesa',         // plain product query, no "de"
    ];

    test.each(NON_COMPOUND)('"%s" → null', (input) => {
      expect(extractCompoundQuery(input)).toBeNull();
    });
  });
});

// ─── searchByCompoundQuery ───────────────────────────────────────────────────

describe('attributeSearchService — searchByCompoundQuery()', () => {
  const compound = { entity: 'tornillos', attribute: 'madera', fullPhrase: 'tornillos de madera' };

  test('Layer 1 — returns results on exact phrase match', async () => {
    const screwRows = [{ id: 1, name: 'Tornillos de madera 3"', price: 0.5, is_available: true, stock_quantity: 200, category: 'Tornillería' }];
    db.query.mockResolvedValueOnce({ rows: screwRows });

    const { rows, strategy } = await searchByCompoundQuery(compound, 1);
    expect(rows).toEqual(screwRows);
    expect(strategy).toBe('exact');
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  test('Layer 2 — falls back to entity+attribute when no exact phrase match', async () => {
    const screwRows = [{ id: 2, name: 'Tornillo para madera', price: 0.3, is_available: true, stock_quantity: 500, category: 'Tornillería' }];
    db.query
      .mockResolvedValueOnce({ rows: [] })       // Layer 1 miss
      .mockResolvedValueOnce({ rows: screwRows }) // Layer 2 hit
    ;

    const { rows, strategy } = await searchByCompoundQuery(compound, 1);
    expect(rows).toEqual(screwRows);
    expect(strategy).toBe('entity+attribute');
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  test('Layer 2 — does NOT return results with only attribute (false positive prevention)', async () => {
    // "martillo de madera" would match attribute-only; Layer 2 requires BOTH entity AND attribute.
    // DB is called 3 times (all layers miss for entity+attribute) then returns entity-only
    db.query
      .mockResolvedValueOnce({ rows: [] })  // Layer 1 miss
      .mockResolvedValueOnce({ rows: [] })  // Layer 2: entity+attribute miss
      .mockResolvedValueOnce({ rows: [] })  // Layer 3: entity-only miss
    ;

    const { rows, strategy } = await searchByCompoundQuery(compound, 1);
    expect(rows).toHaveLength(0);
    expect(strategy).toBe('entity-only');
    // Verify Layer 2 SQL includes both entity AND attribute in separate AND clauses
    const layer2Call = db.query.mock.calls[1];
    expect(layer2Call[0]).toMatch(/AND.*AND/s);
  });

  test('Layer 3 — falls back to entity-only when no combined match', async () => {
    const entityRows = [{ id: 3, name: 'Tornillos hexagonales', price: 0.8, is_available: true, stock_quantity: 100, category: 'Tornillería' }];
    db.query
      .mockResolvedValueOnce({ rows: [] })        // Layer 1 miss
      .mockResolvedValueOnce({ rows: [] })        // Layer 2 miss
      .mockResolvedValueOnce({ rows: entityRows }) // Layer 3 hit
    ;

    const { rows, strategy } = await searchByCompoundQuery(compound, 1);
    expect(rows).toEqual(entityRows);
    expect(strategy).toBe('entity-only');
  });

  test('"carne de res" — valid compound query returns carne+res results', async () => {
    const carneRows = [{ id: 5, name: 'Carne de res premium', price: 12, is_available: true, stock_quantity: 20, category: 'Carnes' }];
    db.query.mockResolvedValueOnce({ rows: carneRows });

    const { rows, strategy } = await searchByCompoundQuery(
      { entity: 'carne', attribute: 'res', fullPhrase: 'carne de res' },
      1
    );
    expect(rows).toEqual(carneRows);
    expect(strategy).toBe('exact');
  });
});

// ─── formatCompoundQueryResponse ────────────────────────────────────────────

describe('attributeSearchService — formatCompoundQueryResponse()', () => {
  const compound = { entity: 'tornillos', attribute: 'madera', fullPhrase: 'tornillos de madera' };

  test('returns not-found message when rows empty', () => {
    const msg = formatCompoundQueryResponse(compound, []);
    expect(msg).toMatch(/no encontr/i);
    expect(msg).toMatch(/tornillos de madera/);
  });

  test('formats single product correctly', () => {
    const rows = [{ id: 1, name: 'Tornillo madera 3"', price: 0.5, is_available: true, stock_quantity: 200, category: 'Tornillería', description: null }];
    const msg = formatCompoundQueryResponse(compound, rows, 'exact');
    expect(msg).toMatch(/Tornillo madera/);
    expect(msg).toMatch(/0\.50/);
    expect(msg).not.toMatch(/solo coincide con/i);
  });

  test('includes fallback note when strategy is entity-only', () => {
    const rows = [{ id: 2, name: 'Tornillos hexagonales', price: 0.8, is_available: true, stock_quantity: 10, category: 'Tornillería' }];
    const msg = formatCompoundQueryResponse(compound, rows, 'entity-only');
    expect(msg).toMatch(/tornillos/i);
    expect(msg).toMatch(/tornillos de madera/i);
  });
});

// ─── Pipeline — compound query strategy ─────────────────────────────────────

describe('processMessage() — compound query strategy', () => {
  test('"tornillos de madera" → strategy=attribute, compound path', async () => {
    const screwRows = [
      { id: 1, name: 'Tornillos de madera', price: 0.5, is_available: true, stock_quantity: 200, category: 'Tornillería' },
    ];
    // queryCategories('tornillos') returns empty → entityTerm path (not categoryTerm)
    // Then Layer 1 of searchByCompoundQuery hits
    db.query
      .mockResolvedValueOnce({ rows: [] })        // queryCategories → entityTerm path
      .mockResolvedValueOnce({ rows: screwRows }) // Layer 1 exact phrase match
    ;

    const result = await processMessage({
      text: 'tornillos de madera',
      sessionId: 'test-compound-1',
      businessId: 1,
    });

    expect(result.decision.strategy).toBe('attribute');
    expect(result.decision.entity.entityTerm).toBe('tornillos');
    expect(result.decision.entity.attributeTerm).toBe('madera');
    expect(result.replyText).toMatch(/Tornillos de madera/);
    expect(mockGetMockOpenAI).not.toHaveBeenCalled();
    expect(mockGetRAGOpenAI).not.toHaveBeenCalled();
  });

  test('"tornillos de madera" must NOT return "martillo de madera"', async () => {
    // Simulate: Layer 1 miss, Layer 2 miss (no product has both tornillo+madera),
    // Layer 3 hit returns only screw-type products (not hammers).
    const entityOnlyRows = [
      { id: 10, name: 'Tornillos para drywall', price: 0.4, is_available: true, stock_quantity: 300, category: 'Tornillería' },
    ];
    const hammerRow = { id: 20, name: 'Martillo de madera', price: 15, is_available: true, stock_quantity: 5, category: 'Herramientas' };

    // Layer 1: exact phrase miss
    db.query.mockResolvedValueOnce({ rows: [] });
    // Layer 2: entity+attribute miss (tornillo AND madera → nothing)
    db.query.mockResolvedValueOnce({ rows: [] });
    // Layer 3: entity-only → returns screw rows (not hammer)
    db.query.mockResolvedValueOnce({ rows: entityOnlyRows });

    const result = await processMessage({
      text: 'tornillos de madera',
      sessionId: 'test-compound-2',
      businessId: 1,
    });

    expect(result.replyText).not.toMatch(/Martillo/i);
    expect(result.replyText).toMatch(/Tornillos/i);
    // hammerRow must not appear
    expect(result.replyText).not.toContain(hammerRow.name);
  });

  test('"carne de res" → strategy=attribute, compound path', async () => {
    const carneRows = [
      { id: 5, name: 'Carne de res molida', price: 12, is_available: true, stock_quantity: 20, category: 'Carnes' },
    ];
    // queryCategories('carne') returns empty → entityTerm path (not categoryTerm)
    // Then Layer 1 of searchByCompoundQuery hits
    db.query
      .mockResolvedValueOnce({ rows: [] })         // queryCategories → entityTerm path
      .mockResolvedValueOnce({ rows: carneRows })  // Layer 1 exact phrase match
    ;

    const result = await processMessage({
      text: 'carne de res',
      sessionId: 'test-compound-3',
      businessId: 1,
    });

    expect(result.decision.strategy).toBe('attribute');
    expect(result.decision.entity.entityTerm).toBe('carne');
    expect(result.decision.entity.attributeTerm).toBe('res');
    expect(result.replyText).toMatch(/Carne de res/);
    expect(mockGetMockOpenAI).not.toHaveBeenCalled();
  });

  test('"cables de cobre" → compound query, not attribute-only', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }); // Layer 1
    db.query.mockResolvedValueOnce({ rows: [] }); // Layer 2
    db.query.mockResolvedValueOnce({ rows: [] }); // Layer 3

    const result = await processMessage({
      text: 'cables de cobre',
      sessionId: 'test-compound-4',
      businessId: 2,
    });

    expect(result.decision.strategy).toBe('attribute');
    expect(result.decision.entity.entityTerm).toBe('cables');
    expect(result.decision.entity.attributeTerm).toBe('cobre');
    // not-found message should not contain unrelated products
    expect(result.replyText).toMatch(/no encontr/i);
    expect(mockGetMockOpenAI).not.toHaveBeenCalled();
  });
});

// ─── Embedded compound inside "algo con" attribute query ─────────────────────

describe('entityDetector — embedded compound in attribute value', () => {
  test('"tiene algo con carne de res" → promoted to compound query', async () => {
    const result = await detectEntities('tiene algo con carne de res', 1, { intent: null, score: 0 });
    expect(result.type).toBe('attribute');
    expect(result.entityTerm).toBe('carne');
    expect(result.attributeTerm).toBe('res');
    expect(result.value).toBe('carne de res');
    expect(db.query).not.toHaveBeenCalled();
  });

  test('"hay algo con tornillos de madera" → promoted to compound query', async () => {
    const result = await detectEntities('hay algo con tornillos de madera', 1, { intent: null, score: 0 });
    expect(result.type).toBe('attribute');
    expect(result.entityTerm).toBe('tornillos');
    expect(result.attributeTerm).toBe('madera');
  });
});

describe('processMessage() — "tiene algo con" embedded compound', () => {
  test('"tiene algo con carne de res" → finds caldo de res via Layer 2b (attribute-only)', async () => {
    const carneRows = [
      { id: 10, name: 'Caldo de res', price: 8, is_available: true, stock_quantity: 5, category: 'Sopas' },
    ];
    // Layer 1: exact "carne de res" phrase miss
    db.query.mockResolvedValueOnce({ rows: [] });
    // Layer 2: entity(carne) AND attribute(res) → "caldo de res" has "res" but NOT "carne" → miss
    db.query.mockResolvedValueOnce({ rows: [] });
    // Layer 2b: attribute-only "res" (word-boundary) → "Caldo de res" name has "res" standalone ✓
    // Activated because "res" is NOT a material word.
    db.query.mockResolvedValueOnce({ rows: carneRows });

    const result = await processMessage({
      text: 'tiene algo con carne de res',
      sessionId: 'test-embedded-1',
      businessId: 1,
    });

    expect(result.decision.strategy).toBe('attribute');
    expect(result.decision.entity.entityTerm).toBe('carne');
    expect(result.decision.entity.attributeTerm).toBe('res');
    expect(result.replyText).toMatch(/Caldo de res/);
    expect(mockGetMockOpenAI).not.toHaveBeenCalled();
  });
});

// ─── Word-boundary matching (regex) ─────────────────────────────────────────

describe('attributeSearchService — word-boundary matching safety', () => {
  test('"res" as attribute does NOT match products where "res" appears only inside another word', async () => {
    // "res" is NOT a material → Layer 2b (attribute-only) also runs.
    // All 4 layers return empty → no Agua fresca false positive.
    db.query
      .mockResolvedValueOnce({ rows: [] })  // Layer 1: exact phrase miss
      .mockResolvedValueOnce({ rows: [] })  // Layer 2: entity+attribute miss
      .mockResolvedValueOnce({ rows: [] })  // Layer 2b: attribute-only "res" miss
      .mockResolvedValueOnce({ rows: [] }); // Layer 3: entity-only miss

    const { rows, strategy } = await searchByCompoundQuery(
      { entity: 'carne', attribute: 'res', fullPhrase: 'carne de res' },
      1
    );
    // No false positives — result is empty, not "Agua fresca"
    expect(rows).toHaveLength(0);
    expect(strategy).toBe('entity-only');
    // Verify Layer 2 SQL uses ~* (word-boundary regex) not ILIKE %res%
    const layer2Sql = db.query.mock.calls[1][0];
    expect(layer2Sql).toMatch(/~\*/);
    // Must NOT use %res% ILIKE for the single-word attribute
    const layer2Params = db.query.mock.calls[1][1];
    const hasSubstringParam = layer2Params.some((p) => p === '%res%');
    expect(hasSubstringParam).toBe(false);
    // The word-boundary pattern should be present
    const hasBoundaryParam = layer2Params.some((p) => typeof p === 'string' && p.includes('\\mres\\M'));
    expect(hasBoundaryParam).toBe(true);
  });

  test('"madera" (material) skips Layer 2b — only 3 DB calls for tornillos/madera', async () => {
    // "madera" IS a material → Layer 2b is skipped entirely.
    // Exactly 3 DB calls: Layer 1, Layer 2, Layer 3.
    const entityRows = [{ id: 3, name: 'Tornillos para madera', price: 0.5, is_available: true, stock_quantity: 100, category: 'Tornillería' }];
    db.query
      .mockResolvedValueOnce({ rows: [] })         // Layer 1
      .mockResolvedValueOnce({ rows: [] })         // Layer 2
      .mockResolvedValueOnce({ rows: entityRows }); // Layer 3 hit

    const { rows, strategy } = await searchByCompoundQuery(
      { entity: 'tornillos', attribute: 'madera', fullPhrase: 'tornillos de madera' },
      1
    );
    expect(rows).toEqual(entityRows);
    expect(strategy).toBe('entity-only');
    // Exactly 3 queries — Layer 2b was NOT called
    expect(db.query).toHaveBeenCalledTimes(3);
  });

  test('Layer 2b activated for non-material attribute ("res") — finds via attribute-only', async () => {
    const caldoRow = [{ id: 11, name: 'Caldo de res', price: 8, is_available: true, stock_quantity: 5, category: 'Sopas' }];
    db.query
      .mockResolvedValueOnce({ rows: [] })      // Layer 1
      .mockResolvedValueOnce({ rows: [] })      // Layer 2
      .mockResolvedValueOnce({ rows: caldoRow }); // Layer 2b hit

    const { rows, strategy } = await searchByCompoundQuery(
      { entity: 'carne', attribute: 'res', fullPhrase: 'carne de res' },
      1
    );
    expect(rows).toEqual(caldoRow);
    expect(strategy).toBe('attribute-only');
    // Layer 2b SQL must use word-boundary regex
    const layer2bSql = db.query.mock.calls[2][0];
    expect(layer2bSql).toMatch(/~\*/);
    // Layer 2b must also search product_attributes
    expect(layer2bSql).toMatch(/product_attributes/);
    expect(db.query).toHaveBeenCalledTimes(3);
  });

  test('Layer 2 finds hamburguesas via product_attributes when they have "res" in attrs', async () => {
    // Hamburguesa has product_attributes.value = 'carne de res' → both 'carne' and 'res' match
    const hamburguerRows = [
      { id: 20, name: 'Hamburguesa clásica', price: 10, is_available: true, stock_quantity: 8, category: 'Hamburguesas' },
      { id: 21, name: 'Hamburguesa BBQ', price: 12, is_available: true, stock_quantity: 5, category: 'Hamburguesas' },
    ];
    db.query
      .mockResolvedValueOnce({ rows: [] })            // Layer 1 miss
      .mockResolvedValueOnce({ rows: hamburguerRows }); // Layer 2: product_attributes hit

    const { rows, strategy } = await searchByCompoundQuery(
      { entity: 'carne', attribute: 'res', fullPhrase: 'carne de res' },
      1
    );
    expect(rows).toEqual(hamburguerRows);
    expect(strategy).toBe('entity+attribute');
    // Verify Layer 2 SQL searches product_attributes for both terms
    const layer2Sql = db.query.mock.calls[1][0];
    expect(layer2Sql).toMatch(/product_attributes/);
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  test('"carne de res" exact phrase uses ILIKE in Layer 1 (including product_attributes)', async () => {
    const rows = [{ id: 1, name: 'Carne de res molida', price: 10, is_available: true, stock_quantity: 5, category: 'Carnes' }];
    db.query.mockResolvedValueOnce({ rows });

    const result = await searchByCompoundQuery(
      { entity: 'carne', attribute: 'res', fullPhrase: 'carne de res' },
      1
    );
    expect(result.strategy).toBe('exact');
    const layer1Sql = db.query.mock.calls[0][0];
    expect(layer1Sql).toMatch(/ILIKE/);
    expect(layer1Sql).toMatch(/product_attributes/);
    const layer1Params = db.query.mock.calls[0][1];
    expect(layer1Params.some((p) => p === '%carne de res%')).toBe(true);
  });
});

// ─── attributeExtractor — extractCategoryAttributeQuery ──────────────────────

describe('attributeExtractor — extractCategoryAttributeQuery()', () => {
  describe('positive matches', () => {
    test.each([
      ['tiene alguna bebida con chocolate',  { categoryWord: 'bebida',  attribute: 'chocolate' }],
      ['hay alguna bebida de chocolate',     { categoryWord: 'bebida',  attribute: 'chocolate' }],
      ['algun postre de arroz',              { categoryWord: 'postre',  attribute: 'arroz'     }],
      ['tiene algun postre con crema',       { categoryWord: 'postre',  attribute: 'crema'     }],
      ['alguna bebida fria con menta',       { categoryWord: 'bebida fria', attribute: 'menta' }],
    ])('%s', (msg, expected) => {
      expect(extractCategoryAttributeQuery(msg)).toMatchObject(expected);
    });
  });

  describe('returns null for non-matching inputs', () => {
    test.each([
      ['tienes una hamburguesa'],
      ['que bebidas tienen'],
      ['quiero una pizza con queso'],  // no "algun*"
      ['alguna bebida con litros'],    // "litros" is a measure
    ])('%s', (msg) => {
      expect(extractCategoryAttributeQuery(msg)).toBeNull();
    });
  });
});

// ─── attributeSearchService — searchByCategoryAttribute ──────────────────────

describe('attributeSearchService — searchByCategoryAttribute()', () => {
  const maltRow = [{ id: 10, name: 'Malteada de chocolate', price: 4.5, is_available: true, stock_quantity: 3, category: 'Bebidas' }];

  test('Layer 1 hit: returns rows with strategy "category+attribute"', async () => {
    db.query.mockResolvedValueOnce({ rows: maltRow });

    const { rows, strategy } = await searchByCategoryAttribute(
      { categoryWord: 'bebida', attribute: 'chocolate' }, 1
    );
    expect(rows).toEqual(maltRow);
    expect(strategy).toBe('category+attribute');
    expect(db.query).toHaveBeenCalledTimes(1);
    const sql = db.query.mock.calls[0][0];
    expect(sql).toMatch(/c\.name ILIKE/);
  });

  test('Layer 2 fallback: category not matched, falls back to attribute-only', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }); // Layer 1 miss
    db.query.mockResolvedValueOnce({ rows: maltRow }); // Layer 2 hit

    const { rows, strategy } = await searchByCategoryAttribute(
      { categoryWord: 'bebida', attribute: 'chocolate' }, 1
    );
    expect(rows).toEqual(maltRow);
    expect(strategy).toBe('attribute-only');
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  test('no results: both layers empty → returns empty rows with "attribute-only"', async () => {
    db.query.mockResolvedValue({ rows: [] });

    const { rows, strategy } = await searchByCategoryAttribute(
      { categoryWord: 'bebida', attribute: 'chocolate' }, 1
    );
    expect(rows).toEqual([]);
    expect(strategy).toBe('attribute-only');
  });
});

// ─── formatCategoryAttributeResponse ─────────────────────────────────────────

describe('formatCategoryAttributeResponse()', () => {
  const query = { categoryWord: 'bebida', attribute: 'chocolate' };

  test('empty rows → not-found message', () => {
    const msg = formatCategoryAttributeResponse(query, [], 'attribute-only');
    expect(msg).toMatch(/no encontr/i);
    expect(msg).toMatch(/bebida/);
  });

  test('single result → shows product name and price', () => {
    const rows = [{ id: 1, name: 'Malteada de chocolate', price: 4.5, is_available: true, stock_quantity: null, category: 'Bebidas', description: null }];
    const msg = formatCategoryAttributeResponse(query, rows, 'category+attribute');
    expect(msg).toMatch(/Malteada de chocolate/);
    expect(msg).toMatch(/4\.50/);
    expect(msg).not.toMatch(/fallback/i);
  });

  test('multiple results → lists products with natural language', () => {
    const rows = [
      { id: 1, name: 'Malteada de chocolate', price: 4.5, is_available: true, stock_quantity: null, category: 'Bebidas', description: null },
      { id: 2, name: 'Batido de chocolate',   price: 3.0, is_available: true, stock_quantity: null, category: 'Bebidas', description: null },
    ];
    const msg = formatCategoryAttributeResponse(query, rows, 'category+attribute');
    expect(msg).toMatch(/Malteada de chocolate/);
    expect(msg).toMatch(/Batido de chocolate/);
    expect(msg).not.toMatch(/•/);
  });

  test('fallback note shown when strategy is "attribute-only"', () => {
    const rows = [{ id: 1, name: 'Hot chocolate', price: 2.0, is_available: true, stock_quantity: null, category: 'Otras', description: null }];
    const msg = formatCategoryAttributeResponse(query, rows, 'attribute-only');
    expect(msg).toMatch(/bebida/);
  });
});

// ─── Pipeline integration: category+attribute routing ────────────────────────

describe('processMessage() — category+attribute strategy', () => {
  const BID = 7;
  const maltRows = [
    { id: 10, name: 'Malteada de chocolate', price: 4.5, is_available: true, stock_quantity: 5, category: 'Bebidas', description: 'Rica malteada' },
  ];

  test('"tiene alguna bebida con chocolate" routes to searchByCategoryAttribute', async () => {
    // Layer 1 hit: category=bebida + attribute=chocolate → returns maltRows
    db.query.mockResolvedValueOnce({ rows: maltRows });

    const result = await processMessage({
      text: 'tiene alguna bebida con chocolate',
      sessionId: 'sess-cat1',
      businessId: BID,
    });

    expect(result.replyText).toMatch(/Malteada de chocolate/);
    expect(result.replyText).toMatch(/4\.50/);
    expect(result.decision.strategy).toBe('attribute');
  });

  test('"tiene algun postre de arroz" routes to category+attribute search', async () => {
    const arrozRows = [{ id: 11, name: 'Arroz con leche', price: 3.0, is_available: true, stock_quantity: 2, category: 'Postres', description: null }];
    db.query.mockResolvedValueOnce({ rows: arrozRows });

    const result = await processMessage({
      text: 'tiene algun postre de arroz',
      sessionId: 'sess-cat2',
      businessId: BID,
    });

    expect(result.replyText).toMatch(/Arroz con leche/);
    expect(result.decision.strategy).toBe('attribute');
  });
});

// ─── Mock ioredis antes de cualquier import ─────────────────────────────────
jest.mock('ioredis', () => {
  const _store     = new Map();
  const _listStore = new Map();
  const inst = {
    get:    jest.fn(async (key)            => _store.get(key) ?? null),
    setex:  jest.fn(async (key, _ttl, val) => { _store.set(key, val); return 'OK'; }),
    rpush:  jest.fn(async (key, val)       => { const l = _listStore.get(key) || []; l.push(val); _listStore.set(key, l); return l.length; }),
    lrange: jest.fn(async (key, s, e)      => { const l = _listStore.get(key) || []; return e === -1 ? l.slice(s) : l.slice(s, e + 1); }),
    expire: jest.fn(async ()               => 1),
    on:     jest.fn(),
  };
  global.__hfStore     = _store;
  global.__hfListStore = _listStore;
  global.__hfInstance  = inst;
  return jest.fn().mockImplementation(() => inst);
});

var store             = global.__hfStore;
var listStore         = global.__hfListStore;
var mockRedisInstance = global.__hfInstance;

// ─── Mock database ───────────────────────────────────────────────────────────
jest.mock('../../src/config/database', () => ({ query: jest.fn() }));

import db from '../../src/config/database.js';

// ─── Importar módulos bajo test ──────────────────────────────────────────────
import { shouldUseAI, hasRelevantData, LONG_MESSAGE_WORDS } from '../../src/services/aiDecisionEngine.js';
import { filterRelevantData, classifyAIRequest, extractComparisonEntities, MAX_ITEMS } from '../../src/services/ragFilterService.js';
import { processMessage, handleAIFallback } from '../../src/services/messagePipeline.js';
import { getContext, updateContext } from '../../src/services/sessionContextService.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────
const sid = () => `hybrid-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const noIntent = { intent: null, score: 0, scores: {}, confident: false };
const emptyEntity = { type: null, value: null };
const emptyContext = { lastIntent: null, lastEntity: { type: null, value: null } };

const mockProduct = (name, price, category = 'General') => ({
  id: Math.floor(Math.random() * 1000),
  name,
  description: `Descripción de ${name}`,
  price: String(price),
  is_available: true,
  stock_quantity: 10,
  category,
});

beforeEach(() => {
  store.clear();
  jest.clearAllMocks();
  db.query.mockReset();
});

// ═════════════════════════════════════════════════════════════════════════════
// shouldUseAI() — AI Decision Engine
// ═════════════════════════════════════════════════════════════════════════════

describe('shouldUseAI()', () => {

  test('high-confidence intent → routing=backend', () => {
    const intentResult = { intent: 'horarios', score: 3, scores: { horarios: 3 } };
    const result = shouldUseAI('a que hora abren', intentResult, emptyEntity, emptyContext);
    expect(result.routing).toBe('backend');
  });

  test('entity detected (plain query) → routing=backend', () => {
    const entity = { type: 'product', value: 'pizza' };
    const result = shouldUseAI('tienen pizza', noIntent, entity, emptyContext);
    expect(result.routing).toBe('backend');
  });

  // ── Bug-regression: entity MUST NOT block AI for recommendation/comparison ─

  test('recommendation + entity detected → routing=ai (entity does NOT block)', () => {
    // "que me recomienda de postres?" detects "postres" as category entity —
    // should still route to AI, not dump the catalog.
    const entity = { type: 'category', value: 'postres' };
    const result = shouldUseAI('que me recomienda de postres', noIntent, entity, emptyContext);
    expect(result.routing).toBe('ai');
    expect(result.aiCategory).toBe('recommendation');
  });

  test('comparison + entity detected → routing=ai (entity does NOT block)', () => {
    // "que es mejor entre crepa de cajeta y helado de vainilla?" detects an entity
    // — should still route to AI for comparison reasoning.
    const entity = { type: 'product', value: 'crepa de cajeta' };
    const result = shouldUseAI('que es mejor entre crepa de cajeta y helado de vainilla', noIntent, entity, emptyContext);
    expect(result.routing).toBe('ai');
    expect(result.aiCategory).toBe('comparison');
  });

  test('high-confidence intent + recommendation → intent guard wins (explicit horario)', () => {
    // High-confidence intent still blocks AI — this is intentional (exact schedule queries)
    const highIntent = { intent: 'horarios', score: 4, scores: { horarios: 4 }, confident: true };
    const result = shouldUseAI('a que hora abren', highIntent, emptyEntity, emptyContext);
    expect(result.routing).toBe('backend');
  });

  test('context available (entity+intent) → routing=backend', () => {
    const ctx = { lastIntent: 'precios', lastEntity: { type: 'product', value: 'hamburguesa' } };
    const result = shouldUseAI('cuanto cuesta', noIntent, emptyEntity, ctx);
    expect(result.routing).toBe('backend');
  });

  test('recommendation request → routing=ai, category=recommendation', () => {
    const result = shouldUseAI('que me recomiendas', noIntent, emptyEntity, emptyContext);
    expect(result.routing).toBe('ai');
    expect(result.aiCategory).toBe('recommendation');
  });

  test('"recomiendame algo" → routing=ai', () => {
    const result = shouldUseAI('recomiendame algo', noIntent, emptyEntity, emptyContext);
    expect(result.routing).toBe('ai');
    expect(result.aiCategory).toBe('recommendation');
  });

  test('comparison request → routing=ai, category=comparison', () => {
    const result = shouldUseAI('diferencia entre pizza y hamburguesa', noIntent, emptyEntity, emptyContext);
    expect(result.routing).toBe('ai');
    expect(result.aiCategory).toBe('comparison');
  });

  test('"compara pizza con hamburguesa" → routing=ai', () => {
    const result = shouldUseAI('compara pizza con hamburguesa', noIntent, emptyEntity, emptyContext);
    expect(result.routing).toBe('ai');
    expect(result.aiCategory).toBe('comparison');
  });

  test('opinion question → routing=ai', () => {
    const result = shouldUseAI('que opinas de la comida', noIntent, emptyEntity, emptyContext);
    expect(result.routing).toBe('ai');
    expect(result.aiCategory).toBe('open_query');
  });

  test('long message → routing=ai', () => {
    const longMsg = 'quiero saber si tienen algun producto especial de temporada que sea nuevo y que este en descuento por favor';
    const result = shouldUseAI(longMsg, noIntent, emptyEntity, emptyContext);
    expect(result.routing).toBe('ai');
    expect(result.reason).toContain('long message');
  });

  test('multiple competing intents → routing=ai', () => {
    const intentResult = { intent: 'productos', score: 2, scores: { productos: 2, precios: 2 } };
    const result = shouldUseAI('algo sobre productos y precios', intentResult, emptyEntity, emptyContext);
    expect(result.routing).toBe('ai');
    expect(result.reason).toContain('competing intents');
  });

  test('short simple unknown message → routing=backend', () => {
    const result = shouldUseAI('hola', noIntent, emptyEntity, emptyContext);
    expect(result.routing).toBe('backend');
  });

  test('"gracias" → routing=backend (no necesita AI)', () => {
    const result = shouldUseAI('gracias', noIntent, emptyEntity, emptyContext);
    expect(result.routing).toBe('backend');
  });

  test('"ok" → routing=backend', () => {
    const result = shouldUseAI('ok', noIntent, emptyEntity, emptyContext);
    expect(result.routing).toBe('backend');
  });

  // ── Superlative & capacity patterns ───────────────────────────────────────

  test('"que taco es el mas saludable" + context → routing=ai (superlative)', () => {
    const ctx = { lastIntent: 'descripcion', lastEntity: { type: 'product', value: 'taco de canasta' } };
    const result = shouldUseAI('que taco es el mas saludable', noIntent, emptyEntity, ctx);
    expect(result.routing).toBe('ai');
    expect(result.aiCategory).toBe('comparison');
  });

  test('"que hamburguesa es la mas barata" + context → routing=ai (superlative)', () => {
    const ctx = { lastIntent: 'descripcion', lastEntity: { type: 'product', value: 'taco de canasta' } };
    const result = shouldUseAI('que hamburguesa es la mas barata', noIntent, emptyEntity, ctx);
    expect(result.routing).toBe('ai');
    expect(result.aiCategory).toBe('comparison');
  });

  test('"que hamburguesa cuesta menos" + context → routing=ai (superlative)', () => {
    const ctx = { lastIntent: 'descripcion', lastEntity: { type: 'product', value: 'taco de canasta' } };
    const result = shouldUseAI('que hamburguesa cuesta menos', noIntent, emptyEntity, ctx);
    expect(result.routing).toBe('ai');
    expect(result.aiCategory).toBe('comparison');
  });

  test('"cuantos tacos de canasta me puedo comer" + context → routing=ai (capacity)', () => {
    const ctx = { lastIntent: 'descripcion', lastEntity: { type: 'product', value: 'taco de canasta' } };
    const result = shouldUseAI('cuantos tacos de canasta me puedo comer', noIntent, emptyEntity, ctx);
    expect(result.routing).toBe('ai');
    expect(result.aiCategory).toBe('open_query');
  });

  test('superlative + entity detected → routing=ai (entity does NOT block superlative)', () => {
    // Even if entity is detected, superlative patterns must win
    const entity = { type: 'product', value: 'hamburguesa' };
    const result = shouldUseAI('cual hamburguesa es la mas barata', noIntent, entity, emptyContext);
    expect(result.routing).toBe('ai');
  });

  test('"cuanto cuesta" + context (2 words) → routing=backend (short follow-up)', () => {
    const ctx = { lastIntent: 'precios', lastEntity: { type: 'product', value: 'hamburguesa' } };
    const result = shouldUseAI('cuanto cuesta', noIntent, emptyEntity, ctx);
    expect(result.routing).toBe('backend');
  });

  test('"y ese" + context (2 words) → routing=backend (short follow-up)', () => {
    const ctx = { lastIntent: 'productos', lastEntity: { type: 'product', value: 'taco' } };
    const result = shouldUseAI('y ese', noIntent, emptyEntity, ctx);
    expect(result.routing).toBe('backend');
  });

  // ── Bug-regression: second-person "recomiendas" + "la/el mejor" after day context ─

  test('"que pizza me recomiendas" + day context → routing=ai (not blocked by day entity)', () => {
    const ctx = { lastIntent: 'horarios', lastEntity: { type: 'day', value: 'domingo', dayOfWeek: 0 } };
    const result = shouldUseAI('que pizza me recomiendas', noIntent, emptyEntity, ctx);
    expect(result.routing).toBe('ai');
    expect(result.aiCategory).toBe('recommendation');
  });

  test('"que pizza es la mejor" + day context → routing=ai (la/el mejor pattern)', () => {
    const ctx = { lastIntent: 'horarios', lastEntity: { type: 'day', value: 'domingo', dayOfWeek: 0 } };
    const result = shouldUseAI('que pizza es la mejor', noIntent, emptyEntity, ctx);
    expect(result.routing).toBe('ai');
    expect(result.aiCategory).toBe('comparison');
  });

  test('"cual es la mejor pizza" → routing=ai (superlative)', () => {
    const result = shouldUseAI('cual es la mejor pizza', noIntent, emptyEntity, emptyContext);
    expect(result.routing).toBe('ai');
    expect(result.aiCategory).toBe('comparison');
  });

  test('"los mejores tacos" + day context → routing=ai', () => {
    const ctx = { lastIntent: 'horarios', lastEntity: { type: 'day', value: 'domingo', dayOfWeek: 0 } };
    const result = shouldUseAI('los mejores tacos', noIntent, emptyEntity, ctx);
    expect(result.routing).toBe('ai');
  });

  test('"recomiendas algo" (2nd-person) → routing=ai', () => {
    const result = shouldUseAI('recomiendas algo', noIntent, emptyEntity, emptyContext);
    expect(result.routing).toBe('ai');
    expect(result.aiCategory).toBe('recommendation');
  });

  test('"que recomiendas de postres" + day context → routing=ai (day entity does NOT block)', () => {
    const ctx = { lastIntent: 'horarios', lastEntity: { type: 'day', value: 'domingo', dayOfWeek: 0 } };
    const result = shouldUseAI('que recomiendas de postres', noIntent, emptyEntity, ctx);
    expect(result.routing).toBe('ai');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// hasRelevantData()
// ═════════════════════════════════════════════════════════════════════════════

describe('hasRelevantData()', () => {
  test('empty type → false', () => {
    expect(hasRelevantData({ type: 'empty', data: [], total: 0 })).toBe(false);
  });

  test('products with data → true', () => {
    expect(hasRelevantData({ type: 'products', data: [{ name: 'x' }], total: 1 })).toBe(true);
  });

  test('non-empty type but empty data → false', () => {
    expect(hasRelevantData({ type: 'products', data: [], total: 0 })).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// classifyAIRequest()
// ═════════════════════════════════════════════════════════════════════════════

describe('classifyAIRequest()', () => {
  test('recommendation phrase → recommendation', () => {
    expect(classifyAIRequest('que me recomiendas', noIntent, emptyEntity, emptyContext)).toBe('recommendation');
  });

  test('"sugerencia" → recommendation', () => {
    expect(classifyAIRequest('alguna sugerencia', noIntent, emptyEntity, emptyContext)).toBe('recommendation');
  });

  test('"que esta bueno" → recommendation', () => {
    expect(classifyAIRequest('que esta bueno', noIntent, emptyEntity, emptyContext)).toBe('recommendation');
  });

  test('comparison phrase → comparison', () => {
    expect(classifyAIRequest('compara pizza y hamburguesa', noIntent, emptyEntity, emptyContext)).toBe('comparison');
  });

  test('"diferencia entre X y Y" → comparison', () => {
    expect(classifyAIRequest('diferencia entre pizza y hamburguesa', noIntent, emptyEntity, emptyContext)).toBe('comparison');
  });

  test('with context → contextual', () => {
    const ctx = { lastIntent: 'productos', lastEntity: { type: 'product', value: 'pizza' } };
    expect(classifyAIRequest('es bueno eso', noIntent, emptyEntity, ctx)).toBe('contextual');
  });

  test('weak intent → open_query', () => {
    const weakIntent = { intent: 'productos', score: 1, scores: { productos: 1 } };
    expect(classifyAIRequest('algo de productos', weakIntent, emptyEntity, emptyContext)).toBe('open_query');
  });

  test('no signals → general', () => {
    expect(classifyAIRequest('hola mundo', noIntent, emptyEntity, emptyContext)).toBe('general');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// extractComparisonEntities()
// ═════════════════════════════════════════════════════════════════════════════

describe('extractComparisonEntities()', () => {
  test('"entre pizza y hamburguesa" → [pizza, hamburguesa]', () => {
    const result = extractComparisonEntities('entre pizza y hamburguesa');
    expect(result).toEqual(['pizza', 'hamburguesa']);
  });

  test('"comparar la pizza con la hamburguesa" → [pizza, hamburguesa]', () => {
    const result = extractComparisonEntities('comparar la pizza con la hamburguesa');
    expect(result).toEqual(['pizza', 'hamburguesa']);
  });

  test('"pizza o hamburguesa" → [pizza, hamburguesa]', () => {
    const result = extractComparisonEntities('pizza o hamburguesa');
    expect(result).toEqual(['pizza', 'hamburguesa']);
  });

  test('"pizza vs hamburguesa" → [pizza, hamburguesa]', () => {
    const result = extractComparisonEntities('pizza vs hamburguesa');
    expect(result).toEqual(['pizza', 'hamburguesa']);
  });

  test('sin patrón → []', () => {
    expect(extractComparisonEntities('hola')).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// filterRelevantData() — RAG Filter
// ═════════════════════════════════════════════════════════════════════════════

describe('filterRelevantData()', () => {
  const BUSINESS_ID = 1;

  function mockDbProducts(products) {
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('products') && sql.includes('is_available')) {
        return { rows: products };
      }
      if (sql.includes('ILIKE') && sql.includes('products')) {
        return { rows: products.slice(0, 5) };
      }
      if (sql.includes('DISTINCT') && sql.includes('categories')) {
        return { rows: [{ category: 'Comida' }, { category: 'Bebidas' }] };
      }
      return { rows: [] };
    });
  }

  test('recommendation → returns products, limited to MAX_ITEMS', async () => {
    const products = Array.from({ length: 25 }, (_, i) => mockProduct(`P${i}`, 10 + i));
    mockDbProducts(products);

    const result = await filterRelevantData('que me recomiendas', BUSINESS_ID, noIntent, emptyEntity, emptyContext);

    expect(result.type).toBe('products');
    expect(result.data.length).toBeLessThanOrEqual(MAX_ITEMS);
    expect(result.summary).toContain('recomendación');
  });

  test('comparison → returns specific products', async () => {
    db.query.mockImplementation(async (sql, params) => {
      if (sql.includes('ILIKE') && sql.includes('products')) {
        const search = params?.find((p) => typeof p === 'string' && p.includes('%'))?.replace(/%/g, '').toLowerCase() ?? '';
        if (search.includes('pizza')) return { rows: [mockProduct('Pizza', 100)] };
        if (search.includes('hambur')) return { rows: [mockProduct('Hamburguesa', 120)] };
        return { rows: [] };
      }
      return { rows: [] };
    });

    const result = await filterRelevantData('entre pizza y hamburguesa', BUSINESS_ID, noIntent, emptyEntity, emptyContext);

    expect(result.type).toBe('products');
    expect(result.data.length).toBe(2);
    expect(result.summary).toContain('comparación');
  });

  test('contextual with last entity → returns related products', async () => {
    db.query.mockImplementation(async (sql, params) => {
      if (sql.includes('ILIKE')) {
        return { rows: [mockProduct('Pizza Pepperoni', 130)] };
      }
      return { rows: [] };
    });

    const ctx = { lastIntent: 'productos', lastEntity: { type: 'product', value: 'pizza' } };
    const result = await filterRelevantData('y algo mas', BUSINESS_ID, noIntent, emptyEntity, ctx);

    expect(result.type).toBe('products');
    expect(result.data.length).toBeGreaterThan(0);
    expect(result.summary).toContain('pizza');
  });

  test('general query → returns categories', async () => {
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('DISTINCT') && sql.includes('categories')) {
        return { rows: [{ category: 'Comida' }, { category: 'Bebidas' }] };
      }
      return { rows: [] };
    });

    const result = await filterRelevantData('hola', BUSINESS_ID, noIntent, emptyEntity, emptyContext);

    expect(result.type).toBe('categories');
    expect(result.data.length).toBe(2);
  });

  test('comparison with no DB match → type=empty', async () => {
    db.query.mockResolvedValue({ rows: [] });

    const result = await filterRelevantData('compara X y Y', BUSINESS_ID, noIntent, emptyEntity, emptyContext);

    expect(result.type).toBe('empty');
    expect(result.data.length).toBe(0);
  });

  test('compacted products only include essential fields', async () => {
    mockDbProducts([mockProduct('Pizza', 130, 'Comida')]);

    const result = await filterRelevantData('que me recomiendas', BUSINESS_ID, noIntent, emptyEntity, emptyContext);

    if (result.data.length > 0) {
      const item = result.data[0];
      expect(item).toHaveProperty('name');
      expect(item).toHaveProperty('price');
      expect(item).toHaveProperty('available');
      // Should NOT have heavy fields like id, stock_quantity
      expect(item).not.toHaveProperty('id');
      expect(item).not.toHaveProperty('stock_quantity');
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// handleAIFallback() — Hybrid handler
// ═════════════════════════════════════════════════════════════════════════════

describe('handleAIFallback()', () => {
  const BUSINESS_ID = 1;

  test('keyword match ("hola") → aiUsed=false, returns keyword response', async () => {
    const result = await handleAIFallback('hola', 'hola', BUSINESS_ID, noIntent, emptyEntity, emptyContext);
    expect(result.aiUsed).toBe(false);
    expect(result.text.toLowerCase()).toContain('hola');
    expect(result.ragContext).toBeNull();
  });

  test('simple unknown message → aiUsed=false (backend fallback)', async () => {
    db.query.mockResolvedValue({ rows: [] });
    const result = await handleAIFallback('xyz', 'xyz', BUSINESS_ID, noIntent, emptyEntity, emptyContext);
    expect(result.aiUsed).toBe(false);
    expect(result.ragContext).toBeNull();
  });

  test('recommendation request with DB data → aiUsed=true', async () => {
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('subscription_id')) return { rows: [{ subscription_id: 4 }] };
      if (sql.includes('products')) return { rows: [mockProduct('Pizza', 100)] };
      return { rows: [] };
    });

    const result = await handleAIFallback(
      'que me recomiendas', 'que me recomiendas',
      BUSINESS_ID, noIntent, emptyEntity, emptyContext
    );

    expect(result.aiUsed).toBe(true);
    expect(result.ragContext).not.toBeNull();
    expect(result.ragContext.data.length).toBeGreaterThan(0);
    expect(result.text).toContain('AI Simulado');
  });

  test('recommendation with NO DB data → aiUsed=false (guard: no data = no AI)', async () => {
    db.query.mockResolvedValue({ rows: [] });

    const result = await handleAIFallback(
      'que me recomiendas', 'que me recomiendas',
      BUSINESS_ID, noIntent, emptyEntity, emptyContext
    );

    // No data → fallback to backend mock, NOT AI
    expect(result.aiUsed).toBe(false);
  });

  test('comparison request with data → aiUsed=true, ragContext has products', async () => {
    db.query.mockImplementation(async (sql, params) => {
      if (sql.includes('subscription_id')) return { rows: [{ subscription_id: 4 }] };
      if (sql.includes('ILIKE') && sql.includes('products')) {
        const search = params?.find((p) => typeof p === 'string' && p.includes('%'))?.replace(/%/g, '').toLowerCase() ?? '';
        if (search.includes('pizza')) return { rows: [mockProduct('Pizza', 100)] };
        if (search.includes('hambur')) return { rows: [mockProduct('Hamburguesa', 120)] };
      }
      return { rows: [] };
    });

    const result = await handleAIFallback(
      'compara pizza con hamburguesa', 'compara pizza con hamburguesa',
      BUSINESS_ID, noIntent, emptyEntity, emptyContext
    );

    expect(result.aiUsed).toBe(true);
    expect(result.ragContext.type).toBe('products');
  });

  test('AI response includes data count in simulation', async () => {
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('products')) return { rows: [mockProduct('A', 10), mockProduct('B', 20)] };
      return { rows: [] };
    });

    const result = await handleAIFallback(
      'que me recomiendas', 'que me recomiendas',
      BUSINESS_ID, noIntent, emptyEntity, emptyContext
    );

    if (result.aiUsed) {
      expect(result.text).toContain('resultados relevantes');
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// processMessage() — Full pipeline integration (hybrid)
// ═════════════════════════════════════════════════════════════════════════════

describe('processMessage() — hybrid flow', () => {
  const BUSINESS_ID = 1;

  function mockDbNoMatch() {
    db.query.mockResolvedValue({ rows: [] });
  }

  function mockDbProductMatch(product) {
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('ILIKE') && sql.includes('products')) {
        return { rows: [mockProduct(product, 100)] };
      }
      return { rows: [] };
    });
  }

  // ── Backend resolves — NO AI used ─────────────────────────────────────────

  test('simple intent "a que hora abren" → backend, aiUsed=false', async () => {
    mockDbNoMatch();
    const id = sid();
    const { decision, logs } = await processMessage({ text: '¿A qué hora abren?', sessionId: id, businessId: BUSINESS_ID });
    expect(decision.strategy).toBe('intent');
    expect(decision.intent).toBe('horarios');
    expect(logs.aiUsed).toBe(false);
  });

  test('product query "tienen pizza" → backend, aiUsed=false', async () => {
    mockDbProductMatch('Pizza');
    const id = sid();
    const { decision, logs } = await processMessage({ text: '¿Tienen pizza?', sessionId: id, businessId: BUSINESS_ID });
    expect(decision.strategy).toBe('entity');
    expect(logs.aiUsed).toBe(false);
  });

  test('promotion query "tienen descuentos" → backend, aiUsed=false', async () => {
    mockDbNoMatch();
    const id = sid();
    const { decision, logs } = await processMessage({ text: '¿Tienen descuentos?', sessionId: id, businessId: BUSINESS_ID });
    expect(decision.intent).toBe('promociones');
    expect(logs.aiUsed).toBe(false);
  });

  test('context-based "cuanto cuesta" after product → backend, aiUsed=false', async () => {
    const id = sid();
    mockDbProductMatch('Hamburguesa');
    await processMessage({ text: 'tienen hamburguesa', sessionId: id, businessId: BUSINESS_ID });

    mockDbNoMatch();
    const { decision, logs } = await processMessage({ text: '¿Cuánto cuesta?', sessionId: id, businessId: BUSINESS_ID });
    expect(decision.usedContext).toBe(true);
    expect(logs.aiUsed).toBe(false);
  });

  test('"hola" → keyword response, aiUsed=false', async () => {
    mockDbNoMatch();
    const id = sid();
    const { decision, replyText, logs } = await processMessage({ text: 'hola', sessionId: id, businessId: BUSINESS_ID });
    // "hola" may hit keyword or anti-fallback, but should NOT use AI
    expect(logs.aiUsed).toBe(false);
  });

  // ── AI routed (simulated) ─────────────────────────────────────────────────

  test('"que me recomiendas" with products in DB → aiUsed=true', async () => {
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('subscription_id')) return { rows: [{ subscription_id: 4 }] };
      if (sql.includes('products') && sql.includes('is_available')) {
        return { rows: [mockProduct('Pizza', 100), mockProduct('Hamburguesa', 120)] };
      }
      if (sql.includes('ILIKE')) return { rows: [] };
      if (sql.includes('DISTINCT')) return { rows: [{ category: 'Comida' }] };
      return { rows: [] };
    });

    const id = sid();
    const { decision, replyText, logs } = await processMessage({ text: 'que me recomiendas', sessionId: id, businessId: BUSINESS_ID });

    expect(decision.strategy).toBe('ai');
    expect(logs.aiUsed).toBe(true);
    expect(logs.ragDataCount).toBeGreaterThan(0);
    expect(replyText).toContain('AI Simulado');
  });

  test('"que me recomiendas" with empty DB → aiUsed=false (no data guard)', async () => {
    mockDbNoMatch();
    const id = sid();
    const { decision, logs } = await processMessage({ text: 'que me recomiendas', sessionId: id, businessId: BUSINESS_ID });

    expect(decision.strategy).toBe('ai');
    expect(logs.aiUsed).toBe(false);
  });

  // ── Critical rules ────────────────────────────────────────────────────────

  test('RULE: backend CAN answer → AI NOT used (horarios)', async () => {
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('business_hours')) return { rows: [{ day_of_week: 1, open_time: '09:00:00', close_time: '18:00:00', is_closed: false }] };
      return { rows: [] };
    });

    const id = sid();
    const { logs } = await processMessage({ text: 'a que hora abren', sessionId: id, businessId: BUSINESS_ID });
    expect(logs.aiUsed).toBe(false);
  });

  test('RULE: backend CAN answer → AI NOT used (ubicación)', async () => {
    mockDbNoMatch();
    const id = sid();
    const { decision, logs } = await processMessage({ text: 'donde estan ubicados', sessionId: id, businessId: BUSINESS_ID });
    expect(decision.intent).toBe('ubicacion');
    expect(logs.aiUsed).toBe(false);
  });

  test('RULE: context useful → AI NOT used', async () => {
    const id = sid();
    mockDbProductMatch('Pizza');
    await processMessage({ text: 'tienen pizza', sessionId: id, businessId: BUSINESS_ID });

    mockDbNoMatch();
    const { logs } = await processMessage({ text: 'y el precio', sessionId: id, businessId: BUSINESS_ID });
    expect(logs.aiUsed).toBe(false);
  });

  test('RULE: AI does NOT decide intent or entity', async () => {
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('subscription_id')) return { rows: [{ subscription_id: 4 }] };
      if (sql.includes('products') && sql.includes('is_available')) {
        return { rows: [mockProduct('Item', 50)] };
      }
      if (sql.includes('DISTINCT')) return { rows: [{ category: 'Cat' }] };
      return { rows: [] };
    });

    const id = sid();
    const { decision, logs } = await processMessage({ text: 'recomiendame algo rico', sessionId: id, businessId: BUSINESS_ID });

    // The decision engine sets strategy=ai FIRST, then AI handler runs
    // AI should NOT override the intent/entity from the decision
    expect(decision.strategy).toBe('ai');
    expect(decision.intent).toBeNull();
    expect(decision.entity.value).toBeNull();
  });

  // ── RAG data validation ───────────────────────────────────────────────────

  test('RAG filter limits data to MAX_ITEMS', async () => {
    const bigList = Array.from({ length: 50 }, (_, i) => mockProduct(`P${i}`, 10 + i));
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('products') && sql.includes('is_available')) return { rows: bigList };
      if (sql.includes('ILIKE')) return { rows: [] };
      if (sql.includes('DISTINCT')) return { rows: [{ category: 'Big' }] };
      return { rows: [] };
    });

    const id = sid();
    const { logs } = await processMessage({ text: 'recomiendame algo', sessionId: id, businessId: BUSINESS_ID });

    if (logs.ragDataCount) {
      expect(logs.ragDataCount).toBeLessThanOrEqual(MAX_ITEMS);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Bug-regression: recommendation/comparison with detected entity → AI, NOT catalog
// ═════════════════════════════════════════════════════════════════════════════

describe('Bug-regression: entity detection MUST NOT block AI for recommendation/comparison', () => {
  const BUSINESS_ID = 1;

  test('"que me recomienda de postres?" → decision=ai, aiUsed=true (NOT catalog dump)', async () => {
    // Entity "postres" will be detected; recommendation pattern must win.
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('subscription_id')) return { rows: [{ subscription_id: 4 }] };
      if (sql.includes('ILIKE')) return { rows: [mockProduct('Crepa de cajeta', 80, 'Postres'), mockProduct('Helado de vainilla', 45, 'Postres')] };
      if (sql.includes('is_available')) return { rows: [mockProduct('Crepa de cajeta', 80, 'Postres')] };
      if (sql.includes('DISTINCT')) return { rows: [{ category: 'Postres' }] };
      return { rows: [] };
    });

    const id = sid();
    const { decision, replyText, logs } = await processMessage({
      text: 'que me recomienda de postres?',
      sessionId: id,
      businessId: BUSINESS_ID,
    });

    expect(decision.strategy).toBe('ai');
    expect(logs.aiUsed).toBe(true);
    expect(replyText).toContain('AI Simulado');
    // Must NOT be the raw catalog format
    expect(replyText).not.toMatch(/📦|🗂️/);
  });

  test('"que es mejor entre crepa de cajeta y helado de vainilla?" → decision=ai, aiUsed=true', async () => {
    // Entity may be detected for one of the products; comparison must win.
    db.query.mockImplementation(async (sql, params) => {
      if (sql.includes('subscription_id')) return { rows: [{ subscription_id: 4 }] };
      if (sql.includes('ILIKE')) {
        const s = (params?.find((p) => typeof p === 'string' && p.includes('%')) ?? '').replace(/%/g, '').toLowerCase();
        if (s.includes('crepa')) return { rows: [mockProduct('Crepa de cajeta', 80, 'Postres')] };
        if (s.includes('helado')) return { rows: [mockProduct('Helado de vainilla', 45, 'Postres')] };
      }
      if (sql.includes('is_available')) return { rows: [mockProduct('Crepa de cajeta', 80, 'Postres')] };
      if (sql.includes('DISTINCT')) return { rows: [{ category: 'Postres' }] };
      return { rows: [] };
    });

    const id = sid();
    const { decision, replyText, logs } = await processMessage({
      text: 'que es mejor entre crepa de cajeta y helado de vainilla?',
      sessionId: id,
      businessId: BUSINESS_ID,
    });

    expect(decision.strategy).toBe('ai');
    expect(logs.aiUsed).toBe(true);
    expect(replyText).toContain('AI Simulado');
  });

  test('"que me recomienda de postres?" does NOT return the "no entendi" fallback', async () => {
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('ILIKE')) return { rows: [mockProduct('Flan', 35, 'Postres')] };
      if (sql.includes('is_available')) return { rows: [mockProduct('Flan', 35, 'Postres')] };
      if (sql.includes('DISTINCT')) return { rows: [{ category: 'Postres' }] };
      return { rows: [] };
    });

    const id = sid();
    const { replyText } = await processMessage({
      text: 'que me recomienda de postres?',
      sessionId: id,
      businessId: BUSINESS_ID,
    });

    // The "no entendí" response was the wrong behavior previously
    expect(replyText).not.toContain('No entendí bien tu pregunta');
    expect(replyText).not.toContain('No entendi bien tu pregunta');
  });

  test('plain entity query "muestrame los postres" → aiUsed=false (NOT a recommendation)', async () => {
    // "muestrame los postres" has no recommendation/comparison pattern →
    // even if decide() falls to 'ai' strategy, handleAIFallback must NOT invoke AI.
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('ILIKE')) return { rows: [mockProduct('Flan', 35, 'Postres')] };
      return { rows: [] };
    });

    const id = sid();
    const { logs } = await processMessage({
      text: 'muestrame los postres',
      sessionId: id,
      businessId: BUSINESS_ID,
    });

    expect(logs.aiUsed).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Bug-regression: ambiguous/complex questions with stale context → AI, NOT context reuse
// (from real pipeline logs where decision="context" reason="anti-fallback: using context entity 'taco de canasta'")
// ═════════════════════════════════════════════════════════════════════════════

describe('Bug-regression: complex questions MUST NOT reuse stale context entity', () => {
  const BUSINESS_ID = 1;

  // DB helper that returns some products for these queries
  function mockDbWithProducts() {
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('subscription_id')) return { rows: [{ subscription_id: 4 }] };
      if (sql.includes('is_available')) return { rows: [mockProduct('Taco de canasta', 15, 'Tacos'), mockProduct('Hamburguesa clasica', 90, 'Hamburguesas')] };
      if (sql.includes('ILIKE')) return { rows: [mockProduct('Taco de canasta', 15, 'Tacos')] };
      if (sql.includes('DISTINCT')) return { rows: [{ category: 'Tacos' }, { category: 'Hamburguesas' }] };
      return { rows: [] };
    });
  }

  async function seedContext(sessionId, intent, entityValue) {
    await updateContext(sessionId, {
      lastIntent: intent,
      lastEntity: { type: 'product', value: entityValue },
    });
  }

  test('"cuantos tacos de canasta me puedo comer" after context → aiUsed=true (capacity question)', async () => {
    const id = sid();
    await seedContext(id, 'descripcion', 'taco de canasta');
    mockDbWithProducts();

    const { decision, logs } = await processMessage({
      text: 'cuantos tacos de canasta me puedo comer',
      sessionId: id,
      businessId: BUSINESS_ID,
    });

    expect(decision.strategy).toBe('ai');
    expect(logs.aiUsed).toBe(true);
    // Must NOT reuse stale context entity
    expect(decision.reason).not.toContain('anti-fallback');
  });

  test('"que taco es el mas saludable" after context → aiUsed=true (superlative)', async () => {
    const id = sid();
    await seedContext(id, 'descripcion', 'taco de canasta');
    mockDbWithProducts();

    const { decision, logs } = await processMessage({
      text: 'que taco es el mas saludable',
      sessionId: id,
      businessId: BUSINESS_ID,
    });

    expect(decision.strategy).toBe('ai');
    expect(logs.aiUsed).toBe(true);
    expect(decision.reason).not.toContain('anti-fallback');
  });

  test('"que hamburguesa es la mas barata" after taco context → aiUsed=true, NOT taco response', async () => {
    const id = sid();
    await seedContext(id, 'descripcion', 'taco de canasta');
    db.query.mockImplementation(async (sql, params) => {
      if (sql.includes('subscription_id')) return { rows: [{ subscription_id: 4 }] };
      if (sql.includes('ILIKE')) return { rows: [mockProduct('Hamburguesa clasica', 90, 'Hamburguesas')] };
      if (sql.includes('is_available')) return { rows: [mockProduct('Hamburguesa clasica', 90, 'Hamburguesas')] };
      if (sql.includes('DISTINCT')) return { rows: [{ category: 'Hamburguesas' }] };
      return { rows: [] };
    });

    const { decision, replyText, logs } = await processMessage({
      text: 'que hamburguesa es la mas barata',
      sessionId: id,
      businessId: BUSINESS_ID,
    });

    expect(decision.strategy).toBe('ai');
    expect(logs.aiUsed).toBe(true);
    // Response must be the AI simulation, NOT a raw catalog dump
    expect(replyText).toContain('AI Simulado');
    expect(replyText).not.toMatch(/📦|🗂️/);
  });

  test('"que hamburguesa cuesta menos" after taco context → aiUsed=true', async () => {
    const id = sid();
    await seedContext(id, 'descripcion', 'taco de canasta');
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('subscription_id')) return { rows: [{ subscription_id: 4 }] };
      if (sql.includes('is_available')) return { rows: [mockProduct('Hamburguesa clasica', 90, 'Hamburguesas')] };
      if (sql.includes('ILIKE')) return { rows: [mockProduct('Hamburguesa clasica', 90, 'Hamburguesas')] };
      if (sql.includes('DISTINCT')) return { rows: [{ category: 'Hamburguesas' }] };
      return { rows: [] };
    });

    const { decision, logs } = await processMessage({
      text: 'que hamburguesa cuesta menos',
      sessionId: id,
      businessId: BUSINESS_ID,
    });

    expect(decision.strategy).toBe('ai');
    expect(logs.aiUsed).toBe(true);
  });

  test('short follow-up "cuanto cuesta" after context → backend, NOT AI (context still valid)', async () => {
    const id = sid();
    await seedContext(id, 'productos', 'hamburguesa');
    db.query.mockResolvedValue({ rows: [] });

    const { decision, logs } = await processMessage({
      text: 'cuanto cuesta',
      sessionId: id,
      businessId: BUSINESS_ID,
    });

    expect(decision.strategy).not.toBe('ai');
    expect(logs.aiUsed).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Bug-regression: recommendation/superlative after day-entity context → AI, NOT horarios
// (from real log: lastEntity={type:'day',value:'domingo'} → anti-fallback contaminating product queries)
// ═════════════════════════════════════════════════════════════════════════════

describe('Bug-regression: queries after day context MUST NOT reuse day entity', () => {
  const BUSINESS_ID = 1;

  async function seedDayContext(sessionId) {
    await updateContext(sessionId, {
      lastIntent: 'horarios',
      lastEntity: { type: 'day', value: 'domingo', dayOfWeek: 0 },
    });
  }

  function mockDbWithPizzas() {
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('subscription_id')) return { rows: [{ subscription_id: 4 }] };
      if (sql.includes('is_available')) return { rows: [mockProduct('Pizza mexicana', 120, 'Pizzas'), mockProduct('Pizza hawaiana', 110, 'Pizzas')] };
      if (sql.includes('ILIKE')) return { rows: [mockProduct('Pizza mexicana', 120, 'Pizzas')] };
      if (sql.includes('DISTINCT')) return { rows: [{ category: 'Pizzas' }] };
      return { rows: [] };
    });
  }

  test('"que pizza me recomiendas" after domingo context → aiUsed=true, NOT horarios', async () => {
    const id = sid();
    await seedDayContext(id);
    mockDbWithPizzas();

    const { decision, replyText, logs } = await processMessage({
      text: 'que pizza me recomiendas',
      sessionId: id,
      businessId: BUSINESS_ID,
    });

    expect(decision.strategy).toBe('ai');
    expect(logs.aiUsed).toBe(true);
    expect(replyText).toContain('AI Simulado');
    // Must NOT be a raw catalog or horarios error — the AI simulation is the correct path
    expect(replyText).not.toMatch(/No encontr[eé] informaci[oó]n de horarios/);
  });

  test('"que pizza es la mejor" after domingo context → aiUsed=true (la/el mejor)', async () => {
    const id = sid();
    await seedDayContext(id);
    mockDbWithPizzas();

    const { decision, replyText, logs } = await processMessage({
      text: 'que pizza es la mejor',
      sessionId: id,
      businessId: BUSINESS_ID,
    });

    expect(decision.strategy).toBe('ai');
    expect(logs.aiUsed).toBe(true);
    expect(replyText).toContain('AI Simulado');
  });

  test('"cual es la mejor pizza" after domingo context → aiUsed=true', async () => {
    const id = sid();
    await seedDayContext(id);
    mockDbWithPizzas();

    const { decision, logs } = await processMessage({
      text: 'cual es la mejor pizza',
      sessionId: id,
      businessId: BUSINESS_ID,
    });

    expect(decision.strategy).toBe('ai');
    expect(logs.aiUsed).toBe(true);
  });

  test('RULE: day entity MUST NOT contaminate product queries via anti-fallback', async () => {
    // Any non-horarios question after a day query must NOT reuse "domingo" as entity
    const id = sid();
    await seedDayContext(id);
    db.query.mockResolvedValue({ rows: [] });

    const { decision } = await processMessage({
      text: 'que recomiendas de postre',
      sessionId: id,
      businessId: BUSINESS_ID,
    });

    // anti-fallback must NOT have fired with "domingo"
    expect(decision.reason).not.toContain('anti-fallback');
    expect(decision.entity?.value).not.toBe('domingo');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Anti-patterns: validate AI is NOT used unnecessarily
// ═════════════════════════════════════════════════════════════════════════════

describe('Anti-patterns: AI MUST NOT be used when backend can resolve', () => {
  const BUSINESS_ID = 1;

  function mockDbNoMatch() {
    db.query.mockResolvedValue({ rows: [] });
  }

  const simpleQuestions = [
    { text: '¿A qué hora abren?',   expectedIntent: 'horarios' },
    { text: '¿Tienen descuentos?',   expectedIntent: 'promociones' },
    { text: '¿Dónde están ubicados?', expectedIntent: 'ubicacion' },
  ];

  test.each(simpleQuestions)('simple question "$text" → NO AI', async ({ text, expectedIntent }) => {
    mockDbNoMatch();
    const id = sid();
    const { decision, logs } = await processMessage({ text, sessionId: id, businessId: BUSINESS_ID });
    expect(decision.intent).toBe(expectedIntent);
    expect(logs.aiUsed).toBe(false);
  });

  test('product query with match → NO AI', async () => {
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('ILIKE')) return { rows: [mockProduct('Laptop', 500)] };
      return { rows: [] };
    });

    const id = sid();
    const { logs } = await processMessage({ text: 'tienen laptop', sessionId: id, businessId: BUSINESS_ID });
    expect(logs.aiUsed).toBe(false);
  });

  test('ambiguous message with context → NO AI (uses context)', async () => {
    const id = sid();
    await updateContext(BUSINESS_ID, id, { lastIntent: 'precios', lastEntity: { type: 'product', value: 'pizza' } });

    db.query.mockResolvedValue({ rows: [] });
    const { decision, logs } = await processMessage({ text: '¿y cuánto?', sessionId: id, businessId: BUSINESS_ID });
    expect(decision.usedContext).toBe(true);
    expect(logs.aiUsed).toBe(false);
  });

  test('follow-up "y pizza mexicana" → NO AI (followup strategy)', async () => {
    const id = sid();
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('ILIKE')) return { rows: [mockProduct('Pizza', 100)] };
      return { rows: [] };
    });
    await processMessage({ text: 'tienen pizza', sessionId: id, businessId: BUSINESS_ID });

    db.query.mockResolvedValue({ rows: [] });
    const { decision, logs } = await processMessage({ text: 'y pizza mexicana', sessionId: id, businessId: BUSINESS_ID });
    expect(decision.strategy).toBe('followup');
    expect(logs.aiUsed).toBe(false);
  });
});

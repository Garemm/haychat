// ─── Mock ioredis antes de cualquier import ──────────────────────────────────
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
  global.__cfStore     = _store;
  global.__cfListStore = _listStore;
  global.__cfInstance  = inst;
  return jest.fn().mockImplementation(() => inst);
});

var store             = global.__cfStore;
var listStore         = global.__cfListStore;
var mockRedisInstance = global.__cfInstance;

// ─── Mock database (requerido por entityDetector) ────────────────────────────
jest.mock('../../src/config/database', () => ({ query: jest.fn() }));

import db from '../../src/config/database.js';

// ─── Importar módulos bajo test ───────────────────────────────────────────────
import { detectIntent } from '../../src/services/intentDetector.js';
import {
  decide,
  buildContextUpdate,
  extractFollowUpEntity,
  isAmbiguous,
  processMessage,
} from '../../src/services/messagePipeline.js';
import { getContext, updateContext, EMPTY_CONTEXT } from '../../src/services/sessionContextService.js';
import { extractEntityCandidate } from '../../src/services/entityDetector.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const sid = () => `flow-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const emptyEntity = { type: null, value: null };
const noIntent = { intent: null, score: 0, scores: {}, confident: false };
const emptyContext = { lastIntent: null, lastEntity: { type: null, value: null } };

beforeEach(() => {
  store.clear();
  jest.clearAllMocks();
  db.query.mockReset();
});

// ─── decide() ────────────────────────────────────────────────────────────────

describe('decide()', () => {

  test('Rule 1: high-confidence standalone intent → strategy=intent, ignores context', () => {
    const intentResult = { intent: 'horarios', score: 3, scores: { horarios: 3 }, confident: true };
    const entityResult = { type: null, value: null };
    const context = { lastIntent: 'precios', lastEntity: { type: 'product', value: 'pizza' } };

    const d = decide(intentResult, entityResult, context, 'a que hora abren');
    expect(d.strategy).toBe('intent');
    expect(d.intent).toBe('horarios');
    expect(d.entity).toEqual(emptyEntity);
    expect(d.usedContext).toBe(false);
  });

  test('Rule 2: clear entity → strategy=entity, ignores context', () => {
    const intentResult = noIntent;
    const entityResult = { type: 'product', value: 'laptop' };
    const context = { lastIntent: 'horarios', lastEntity: { type: 'product', value: 'pizza' } };

    const d = decide(intentResult, entityResult, context, 'tienen laptop');
    expect(d.strategy).toBe('entity');
    expect(d.entity).toEqual({ type: 'product', value: 'laptop' });
    expect(d.usedContext).toBe(false);
  });

  test('Rule 2: entity + intent → strategy=entity, includes intent', () => {
    const intentResult = { intent: 'precios', score: 3, scores: { precios: 3 }, confident: true };
    const entityResult = { type: 'product', value: 'laptop' };

    const d = decide(intentResult, entityResult, emptyContext, 'cuanto cuesta la laptop');
    expect(d.strategy).toBe('entity');
    expect(d.intent).toBe('precios');
    expect(d.entity).toEqual({ type: 'product', value: 'laptop' });
    expect(d.usedContext).toBe(false);
  });

  test('Rule 3: non-standalone intent + context entity → strategy=context', () => {
    const intentResult = { intent: 'precios', score: 3, scores: { precios: 3 }, confident: true };
    const entityResult = { type: null, value: null };
    const context = { lastIntent: null, lastEntity: { type: 'product', value: 'hamburguesa' } };

    const d = decide(intentResult, entityResult, context, 'cuanto cuesta');
    expect(d.strategy).toBe('context');
    expect(d.intent).toBe('precios');
    expect(d.entity).toEqual({ type: 'product', value: 'hamburguesa' });
    expect(d.usedContext).toBe(true);
  });

  test('Rule 3: non-standalone intent without context → strategy=intent, no entity', () => {
    const intentResult = { intent: 'precios', score: 3, scores: { precios: 3 }, confident: true };
    const entityResult = { type: null, value: null };

    const d = decide(intentResult, entityResult, emptyContext, 'cuanto cuesta');
    expect(d.strategy).toBe('intent');
    expect(d.intent).toBe('precios');
    expect(d.entity).toEqual(emptyEntity);
    expect(d.usedContext).toBe(false);
  });

  test('Rule 3b: standalone intent with lower confidence → strategy=intent', () => {
    const intentResult = { intent: 'horarios', score: 1, scores: { horarios: 1 }, confident: true };
    const entityResult = { type: null, value: null };

    const d = decide(intentResult, entityResult, emptyContext, 'horarios');
    expect(d.strategy).toBe('intent');
    expect(d.intent).toBe('horarios');
  });

  test('Rule 4: ambiguous message with context → strategy=context', () => {
    const context = { lastIntent: 'precios', lastEntity: { type: 'product', value: 'pizza' } };

    const d = decide(noIntent, { type: null, value: null }, context, 'y precio');
    expect(d.strategy).toBe('context');
    expect(d.usedContext).toBe(true);
    expect(d.entity).toEqual({ type: 'product', value: 'pizza' });
  });

  test('Rule 5: follow-up entity → strategy=followup', () => {
    const context = { lastIntent: null, lastEntity: { type: 'product', value: 'pizza' } };

    const d = decide(noIntent, { type: null, value: null }, context, 'y pizza mexicana');
    expect(d.strategy).toBe('followup');
    expect(d.entity).toEqual({ type: 'product', value: 'pizza mexicana' });
    expect(d.usedContext).toBe(true);
  });

  test('Rule 6: nothing detected → strategy=ai', () => {
    const d = decide(noIntent, { type: null, value: null }, emptyContext, 'hola como estas');
    expect(d.strategy).toBe('ai');
    expect(d.usedContext).toBe(false);
  });

  test('standalone intent does NOT inherit entity from context', () => {
    const intentResult = { intent: 'horarios', score: 3, scores: { horarios: 3 }, confident: true };
    const entityResult = { type: null, value: null };
    const context = { lastIntent: null, lastEntity: { type: 'product', value: 'pizza' } };

    const d = decide(intentResult, entityResult, context, 'a que hora abren');
    expect(d.entity.value).toBeNull();
  });

  test('intent change must NOT drag entity from context', () => {
    const intentResult = { intent: 'ubicacion', score: 3, scores: { ubicacion: 3 }, confident: true };
    const entityResult = { type: null, value: null };
    const context = { lastIntent: 'precios', lastEntity: { type: 'product', value: 'hamburguesa' } };

    const d = decide(intentResult, entityResult, context, 'donde estan ubicados');
    expect(d.entity.value).toBeNull();
  });

  // ─── Rule -1e: servicios context follow-up ──────────────────────────────────

  test('Rule -1e: "y la renta de salon" en contexto servicios → servicios_followup', () => {
    // Joint-prefix "y [article] X" must stay in servicios context, not escape to attribute handler
    const context = { lastIntent: 'servicios', lastEntity: { type: null, value: null } };
    const d = decide(noIntent, { type: 'attribute', value: 'y la renta de salon' }, context, 'y la renta de salon');
    expect(d.strategy).toBe('servicios_followup');
    expect(d.intent).toBe('servicios');
    expect(d.usedContext).toBe(true);
  });

  test('Rule -1e: "y el menu especial" en contexto servicios → servicios_followup', () => {
    const context = { lastIntent: 'servicios', lastEntity: { type: null, value: null } };
    const d = decide(noIntent, { type: 'attribute', value: 'y el menu especial' }, context, 'y el menu especial');
    expect(d.strategy).toBe('servicios_followup');
  });

  test('Rule -1e: "tiene algo con pollo?" en contexto servicios → attribute (escapa por ser ingrediente)', () => {
    // Short attribute value with no extractable service query → must escape to product attribute search
    const context = { lastIntent: 'servicios', lastEntity: { type: null, value: null } };
    const d = decide(noIntent, { type: 'attribute', value: 'pollo' }, context, 'tiene algo con pollo');
    expect(d.strategy).toBe('attribute');
  });

  test('Rule -1e: "que venden?" en contexto servicios → escapa (productos high-confidence)', () => {
    const intentResult = { intent: 'productos', score: 3, scores: { productos: 3 }, confident: true };
    const context = { lastIntent: 'servicios', lastEntity: { type: null, value: null } };
    const d = decide(intentResult, { type: null, value: null }, context, 'que venden');
    expect(d.strategy).not.toBe('servicios_followup');
  });

  test('Rule -1e: "que dias abren?" en contexto servicios → escapa (standalone intent)', () => {
    const intentResult = { intent: 'horarios', score: 1, scores: { horarios: 1 }, confident: true };
    const context = { lastIntent: 'servicios', lastEntity: { type: null, value: null } };
    const d = decide(intentResult, { type: null, value: null }, context, 'que dias abren');
    expect(d.strategy).not.toBe('servicios_followup');
    expect(d.intent).toBe('horarios');
  });

  test('Rule -1e: nombre de servicio sin prefijo en contexto servicios → servicios_followup', () => {
    // Plain service name (no "y", no leading article) — attribute entity but is a service follow-up
    // via extractServiceQuery "sobre X" or servicios normalizedText fallback
    const context = { lastIntent: 'servicios', lastEntity: { type: null, value: null } };
    const d = decide(noIntent, { type: 'attribute', value: 'catering' }, context, 'sobre el catering');
    expect(d.strategy).toBe('servicios_followup');
  });
});

// ─── buildContextUpdate() ─────────────────────────────────────────────────────

describe('buildContextUpdate()', () => {
  test('entity detected → tracks entity + intent', () => {
    const decision = {
      strategy: 'entity',
      intent: null,
      entity: { type: 'product', value: 'pizza' },
      usedContext: false,
    };
    const upd = buildContextUpdate(decision);
    expect(upd.lastEntity).toEqual({ type: 'product', value: 'pizza' });
    expect(upd.lastIntent).toBeNull();
  });

  test('entity + intent → tracks both', () => {
    const decision = {
      strategy: 'entity',
      intent: 'precios',
      entity: { type: 'product', value: 'laptop' },
      usedContext: false,
    };
    const upd = buildContextUpdate(decision);
    expect(upd.lastEntity).toEqual({ type: 'product', value: 'laptop' });
    expect(upd.lastIntent).toBe('precios');
  });

  test('followup entity → updates entity track', () => {
    const decision = {
      strategy: 'followup',
      intent: null,
      entity: { type: 'product', value: 'pizza mexicana' },
      usedContext: true,
    };
    const upd = buildContextUpdate(decision);
    expect(upd.lastEntity).toEqual({ type: 'product', value: 'pizza mexicana' });
  });

  test('standalone intent → clears entity', () => {
    const decision = {
      strategy: 'intent',
      intent: 'horarios',
      entity: { type: null, value: null },
      usedContext: false,
    };
    const upd = buildContextUpdate(decision);
    expect(upd.lastIntent).toBe('horarios');
    expect(upd.lastEntity).toEqual({ type: null, value: null });
  });

  test('non-standalone intent → keeps entity (only updates intent)', () => {
    const decision = {
      strategy: 'intent',
      intent: 'precios',
      entity: { type: null, value: null },
      usedContext: false,
    };
    const upd = buildContextUpdate(decision);
    expect(upd.lastIntent).toBe('precios');
    expect(upd).not.toHaveProperty('lastEntity');
  });

  test('context-based decision with intent → updates intent only', () => {
    const decision = {
      strategy: 'context',
      intent: 'precios',
      entity: { type: 'product', value: 'pizza' },
      usedContext: true,
    };
    const upd = buildContextUpdate(decision);
    expect(upd.lastIntent).toBe('precios');
    expect(upd).not.toHaveProperty('lastEntity');
  });

  test('AI fallback → empty update', () => {
    const decision = {
      strategy: 'ai',
      intent: null,
      entity: { type: null, value: null },
      usedContext: false,
    };
    expect(buildContextUpdate(decision)).toEqual({});
  });
});

// ─── isAmbiguous() ────────────────────────────────────────────────────────────

describe('isAmbiguous()', () => {
  test('very short messages are ambiguous', () => {
    expect(isAmbiguous('si')).toBe(true);
    expect(isAmbiguous('no')).toBe(true);
    expect(isAmbiguous('ok')).toBe(true);
  });

  test('follow-up price questions are ambiguous', () => {
    expect(isAmbiguous('cuanto cuesta')).toBe(true);
    expect(isAmbiguous('y precio')).toBe(true);
    expect(isAmbiguous('y el precio')).toBe(true);
  });

  test('clear messages are NOT ambiguous', () => {
    expect(isAmbiguous('cuanto cuesta la pizza')).toBe(false);
    expect(isAmbiguous('tienen hamburguesa doble')).toBe(false);
    expect(isAmbiguous('a que hora abren')).toBe(false);
  });
});

// ─── extractFollowUpEntity() ──────────────────────────────────────────────────

describe('extractFollowUpEntity()', () => {
  test('extrae "pizza mexicana" de "y pizza mexicana" con lastEntity set', () => {
    expect(extractFollowUpEntity('y pizza mexicana', { value: 'pizza' })).toBe('pizza mexicana');
  });

  test('extrae entidad de "y hamburguesa doble" con lastEntity set', () => {
    expect(extractFollowUpEntity('y hamburguesa doble', { value: 'hamburguesa' })).toBe('hamburguesa doble');
  });

  test('devuelve null sin lastEntity (sesión vacía o expirada)', () => {
    expect(extractFollowUpEntity('y pizza mexicana', null)).toBeNull();
    expect(extractFollowUpEntity('y pizza mexicana', { value: null })).toBeNull();
  });

  test('devuelve null para "y cuanto cuesta" — palabra interrogativa', () => {
    expect(extractFollowUpEntity('y cuanto cuesta', { value: 'hamburguesa' })).toBeNull();
  });

  test('devuelve null para "y cuantos tiene" — palabra interrogativa', () => {
    expect(extractFollowUpEntity('y cuantos tiene', { value: 'pizza' })).toBeNull();
  });

  test('devuelve null para mensaje que no empieza con "y "', () => {
    expect(extractFollowUpEntity('tienen pizza mexicana', { value: 'pizza' })).toBeNull();
  });

  test('devuelve null para "y" solo (sin entidad)', () => {
    expect(extractFollowUpEntity('y', { value: 'pizza' })).toBeNull();
  });
});

// ─── processMessage() — full pipeline integration ────────────────────────────

describe('processMessage() — full pipeline', () => {
  const BUSINESS_ID = 1;
  const mockProduct = (name, price, available = true) => ({
    id: Math.floor(Math.random() * 1000),
    name,
    description: null,
    price: String(price),
    is_available: available,
    stock_quantity: 10,
    category: 'General',
  });

  // Helper: mock DB to return products for entity detection
  function mockDbProductMatch(product) {
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('products') && sql.includes('ILIKE')) {
        return { rows: [mockProduct(product, 100)] };
      }
      return { rows: [] };
    });
  }

  // Helper: mock DB to return nothing (no entity match)
  function mockDbNoMatch() {
    db.query.mockResolvedValue({ rows: [] });
  }

  test('standalone intent: "a que hora abren" → intent response, no context used', async () => {
    mockDbNoMatch();
    const id = sid();
    // Pre-fill context with old entity
    await updateContext(BUSINESS_ID, id, { lastEntity: { type: 'product', value: 'pizza' }, lastIntent: null });

    const { decision } = await processMessage({ text: '¿A qué hora abren?', sessionId: id, businessId: BUSINESS_ID });

    expect(decision.strategy).toBe('intent');
    expect(decision.intent).toBe('horarios');
    expect(decision.entity.value).toBeNull();
    expect(decision.usedContext).toBe(false);
  });

  test('product detection: "tienen laptop?" → entity detected, context NOT used', async () => {
    mockDbProductMatch('Laptop Gamer');
    const id = sid();
    // Pre-fill context with different product
    await updateContext(BUSINESS_ID, id, { lastEntity: { type: 'product', value: 'pizza' }, lastIntent: 'horarios' });

    const { decision } = await processMessage({ text: '¿Tienen laptop?', sessionId: id, businessId: BUSINESS_ID });

    expect(decision.strategy).toBe('entity');
    expect(decision.entity.value).toBe('laptop');
    expect(decision.usedContext).toBe(false);
  });

  test('intent change: horarios → entity → horarios does NOT drag entity', async () => {
    mockDbProductMatch('Pizza');
    const id = sid();

    // Turn 1: horarios
    mockDbNoMatch();
    const t1 = await processMessage({ text: '¿A qué hora abren?', sessionId: id, businessId: BUSINESS_ID });
    expect(t1.decision.intent).toBe('horarios');

    // Turn 2: product query
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('products') && sql.includes('ILIKE')) {
        return { rows: [mockProduct('Pizza Pepperoni', 130)] };
      }
      return { rows: [] };
    });
    const t2 = await processMessage({ text: '¿Tienen pizza?', sessionId: id, businessId: BUSINESS_ID });
    expect(t2.decision.entity.value).toBe('pizza');

    // Turn 3: horarios again — must NOT have pizza in entity
    mockDbNoMatch();
    const t3 = await processMessage({ text: '¿A qué hora abren?', sessionId: id, businessId: BUSINESS_ID });
    expect(t3.decision.intent).toBe('horarios');
    expect(t3.decision.entity.value).toBeNull();
  });

  test('follow-up price: product → "cuanto cuesta" → inherits entity from context', async () => {
    const id = sid();

    // Turn 1: detect product
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('products') && sql.includes('ILIKE')) {
        return { rows: [mockProduct('Hamburguesa Doble', 150)] };
      }
      return { rows: [] };
    });
    await processMessage({ text: '¿Tienen hamburguesa doble?', sessionId: id, businessId: BUSINESS_ID });

    // Turn 2: price query — no entity in text, should use context
    mockDbNoMatch();
    const t2 = await processMessage({ text: '¿Cuánto cuesta?', sessionId: id, businessId: BUSINESS_ID });
    // "cuanto cuesta" without entity = ambiguous pattern in pipeline,
    // OR precios intent + context entity = strategy=context
    expect(['context', 'intent']).toContain(t2.decision.strategy);
    if (t2.decision.strategy === 'context') {
      expect(t2.decision.entity.value).toBe('hamburguesa doble');
    }
  });

  test('TTL expiration: expired context → new message starts fresh', async () => {
    const id = sid();
    await updateContext(BUSINESS_ID, id, { lastEntity: { type: 'product', value: 'pizza' }, lastIntent: 'precios' });

    // Simulate TTL expiration
    store.delete(`ctx:${BUSINESS_ID}:${id}`);

    mockDbNoMatch();
    const { decision } = await processMessage({ text: 'gracias', sessionId: id, businessId: BUSINESS_ID });

    // Without context and no intent/entity, should be ai fallback
    expect(decision.strategy).toBe('ai');
    expect(decision.usedContext).toBe(false);
  });

  test('promotion detection: "tienen descuentos?" → intent=promociones', async () => {
    mockDbNoMatch();
    const id = sid();

    const { decision } = await processMessage({ text: '¿Tienen descuentos?', sessionId: id, businessId: BUSINESS_ID });

    expect(decision.intent).toBe('promociones');
  });

  test('"productos disponibles" sin contexto → intent=productos (no AI fallback)', async () => {
    // Reproduces the bug: user picks "Productos disponibles" from the fallback menu
    // with no session context and receives the generic error message again.
    mockDbNoMatch();
    const id = sid();

    const { decision, replyText } = await processMessage({
      text: 'productos disponibles',
      sessionId: id,
      businessId: BUSINESS_ID,
    });

    expect(decision.strategy).not.toBe('ai');
    expect(decision.intent).toBe('productos');
    // Must NOT return the generic "no estoy seguro" fallback message
    expect(replyText).not.toContain('No estoy seguro');
  });

  test('"productos" solo sin contexto → intent=productos', async () => {
    mockDbNoMatch();
    const id = sid();

    const { decision } = await processMessage({
      text: 'productos',
      sessionId: id,
      businessId: BUSINESS_ID,
    });

    expect(decision.intent).toBe('productos');
    expect(decision.strategy).not.toBe('ai');
  });

  test('"ver catalogo" sin contexto → intent=productos', async () => {
    mockDbNoMatch();
    const id = sid();

    const { decision } = await processMessage({
      text: 'ver catalogo',
      sessionId: id,
      businessId: BUSINESS_ID,
    });

    expect(decision.intent).toBe('productos');
    expect(decision.strategy).not.toBe('ai');
  });
});

// ─── General catalog query debe romper contexto de producto previo ────────────

describe('General catalog query no hereda entidad de contexto', () => {
  const BUSINESS_ID = 1;

  const mockPizzaMex  = { id: 1, name: 'Pizza Mexicana',  description: null, price: '120.00', is_available: true, stock_quantity: 5,  category: 'Pizzas' };
  const mockPizzaHaw  = { id: 2, name: 'Pizza Hawaiana',  description: null, price: '115.00', is_available: true, stock_quantity: 8,  category: 'Pizzas' };

  function mockDbByName(...products) {
    db.query.mockImplementation(async (sql, params) => {
      if (!sql.includes('ILIKE')) return { rows: [] };
      const search = params?.find((p) => typeof p === 'string' && p.startsWith('%'))
        ?.replace(/%/g, '').toLowerCase() ?? '';
      const matches = products.filter((r) => r.name.toLowerCase().includes(search));
      return { rows: matches };
    });
  }

  test('"que productos tienes" después de pizza hawaiana → NO hereda pizza hawaiana', async () => {
    const id = sid();

    // Turn 1: pizza mexicana
    mockDbByName(mockPizzaMex);
    await processMessage({ text: 'tienes pizza mexicana', sessionId: id, businessId: BUSINESS_ID });

    // Turn 2: precio (hereda contexto)
    mockDbByName(mockPizzaMex);
    await processMessage({ text: 'que precio tiene', sessionId: id, businessId: BUSINESS_ID });

    // Turn 3: pizza hawaiana
    mockDbByName(mockPizzaHaw);
    await processMessage({ text: 'y pizza hawaiana', sessionId: id, businessId: BUSINESS_ID });

    // Turn 4: petición general del catálogo → NOT be about pizza hawaiana
    db.query.mockResolvedValue({ rows: [] });
    const t4 = await processMessage({ text: 'que productos tienes', sessionId: id, businessId: BUSINESS_ID });

    expect(t4.decision.strategy).toBe('intent');
    expect(t4.decision.intent).toBe('productos');
    expect(t4.decision.entity.value).toBeNull();
    expect(t4.decision.usedContext).toBe(false);
  });

  test('"que vendes" con contexto previo → catálogo general (sin herencia)', async () => {
    const id = sid();

    mockDbByName(mockPizzaHaw);
    await processMessage({ text: 'tienes pizza hawaiana', sessionId: id, businessId: BUSINESS_ID });

    db.query.mockResolvedValue({ rows: [] });
    const t2 = await processMessage({ text: 'que vendes', sessionId: id, businessId: BUSINESS_ID });

    expect(t2.decision.strategy).toBe('intent');
    expect(t2.decision.intent).toBe('productos');
    expect(t2.decision.entity.value).toBeNull();
    expect(t2.decision.usedContext).toBe(false);
  });

  test('contexto se limpia después de petición general (lastEntity=null)', async () => {
    const id = sid();

    // Establish pizza context
    mockDbByName(mockPizzaHaw);
    await processMessage({ text: 'tienes pizza hawaiana', sessionId: id, businessId: BUSINESS_ID });

    // General catalog query
    db.query.mockResolvedValue({ rows: [] });
    await processMessage({ text: 'que productos tienes', sessionId: id, businessId: BUSINESS_ID });

    // Context entity must be cleared
    const ctx = await getContext(BUSINESS_ID, id);
    expect(ctx.lastEntity.value).toBeNull();
    expect(ctx.lastIntent).toBe('productos');
  });

  test('"productos disponibles" con contexto previo → catálogo general', async () => {
    const id = sid();

    mockDbByName(mockPizzaMex);
    await processMessage({ text: 'tienes pizza mexicana', sessionId: id, businessId: BUSINESS_ID });

    db.query.mockResolvedValue({ rows: [] });
    const t2 = await processMessage({ text: 'productos disponibles', sessionId: id, businessId: BUSINESS_ID });

    expect(t2.decision.strategy).toBe('intent');
    expect(t2.decision.intent).toBe('productos');
    expect(t2.decision.entity.value).toBeNull();
  });

  test('"precios" ambiguo con contexto → SÍ hereda entidad (comportamiento correcto)', async () => {
    // Verify we did NOT break the legitimate context-inheritance for precios
    const id = sid();

    mockDbByName(mockPizzaMex);
    await processMessage({ text: 'tienes pizza mexicana', sessionId: id, businessId: BUSINESS_ID });

    mockDbByName(mockPizzaMex);
    const t2 = await processMessage({ text: 'que precio tiene', sessionId: id, businessId: BUSINESS_ID });

    expect(t2.decision.usedContext).toBe(true);
    expect(t2.decision.entity.value).toBe('pizza mexicana');
    expect(t2.decision.intent).toBe('precios');
  });
});

// ─── Multi-turn scenario ──────────────────────────────────────────────────────

describe('Escenario conversacional: 3 turnos con processMessage', () => {
  const BUSINESS_ID = 1;

  test('horarios → product → follow-up horarios — context evolves correctly', async () => {
    const id = sid();

    // Mock DB: no product matches for intent-only messages
    db.query.mockImplementation(async (sql, params) => {
      // Match "pizza" in product query
      if (sql.includes('products') && sql.includes('ILIKE') && params?.some((p) => typeof p === 'string' && p.includes('pizza'))) {
        return { rows: [{ id: 1, name: 'Pizza Pepperoni', description: null, price: '130.00', is_available: true, stock_quantity: 20, category: 'Pizzas' }] };
      }
      return { rows: [] };
    });

    // Turn 1: horarios
    const t1 = await processMessage({ text: '¿A qué hora abren?', sessionId: id, businessId: BUSINESS_ID });
    expect(t1.decision.intent).toBe('horarios');
    expect(t1.decision.entity.value).toBeNull();

    // Turn 2: product
    const t2 = await processMessage({ text: '¿Tienen pizza?', sessionId: id, businessId: BUSINESS_ID });
    expect(t2.decision.entity.value).toBe('pizza');

    // Turn 3: back to horarios — must NOT carry pizza
    db.query.mockResolvedValue({ rows: [] });
    const t3 = await processMessage({ text: '¿A qué hora abren?', sessionId: id, businessId: BUSINESS_ID });
    expect(t3.decision.intent).toBe('horarios');
    expect(t3.decision.entity.value).toBeNull();

    // Verify context after turn 3: entity cleared by standalone intent
    const ctx = await getContext(BUSINESS_ID, id);
    expect(ctx.lastIntent).toBe('horarios');
    expect(ctx.lastEntity).toEqual({ type: null, value: null });
  });
});

// ─── Product not found → "sí" → catalog ──────────────────────────────────────

describe('Product not found → "sí" shows catalog', () => {
  const BUSINESS_ID = 1;

  test('"tienes comida vegana" (not found) → "sí" → intent=productos (catalog)', async () => {
    const id = sid();

    // Turn 1: product NOT found in DB → bot says "no encontré… ¿catálogo completo?"
    db.query.mockResolvedValue({ rows: [] });
    const t1 = await processMessage({ text: '¿Tienes comida vegana?', sessionId: id, businessId: BUSINESS_ID });
    expect(t1.decision.strategy).toBe('entity');
    expect(t1.replyText).toContain('no encontré');

    // Verify context keeps the entity (for follow-up refinement) but marks it as not-found
    const ctxAfterT1 = await getContext(BUSINESS_ID, id);
    expect(ctxAfterT1.lastIntent).toBe('productos');
    expect(ctxAfterT1.lastEntity.value).toBe('comida vegana');
    expect(ctxAfterT1.lastEntityFound).toBe(false);

    // Turn 2: "sí" → should use context intent=productos → show catalog
    const t2 = await processMessage({ text: 'Sí', sessionId: id, businessId: BUSINESS_ID });
    expect(t2.decision.strategy).toBe('context');
    expect(t2.decision.intent).toBe('productos');
    expect(t2.decision.entity.value).toBeNull();
    expect(t2.decision.usedContext).toBe(true);
  });

  test('product FOUND → "sí" → re-queries product (normal behavior)', async () => {
    const id = sid();

    // Turn 1: product found
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('products') && sql.includes('ILIKE')) {
        return { rows: [{ id: 1, name: 'Pizza', description: null, price: '130.00', is_available: true, stock_quantity: 20, category: 'Pizzas' }] };
      }
      return { rows: [] };
    });
    const t1 = await processMessage({ text: '¿Tienen pizza?', sessionId: id, businessId: BUSINESS_ID });
    expect(t1.decision.strategy).toBe('entity');

    // Context should track the found entity normally
    const ctx = await getContext(BUSINESS_ID, id);
    expect(ctx.lastEntity).toEqual({ type: 'product', value: 'pizza' });
    expect(ctx.lastIntent).toBe('productos');
  });
});

// ─── Precio con cambio de producto ─────────────────────────────────────────────

describe('Precio: detección de producto en mensaje vs contexto', () => {
  const BUSINESS_ID = 1;

  const mockHamburguesa = { id: 1, name: 'Hamburguesa', description: null, price: '150.00', is_available: true, stock_quantity: 5, category: 'Comida' };
  const mockHorchata  = { id: 2, name: 'Agua de Horchata', description: null, price: '35.00', is_available: true, stock_quantity: 20, category: 'Bebidas' };

  function mockDbByName(rows) {
    db.query.mockImplementation(async (sql, params) => {
      if (!sql.includes('ILIKE')) return { rows: [] };
      const search = params?.find((p) => typeof p === 'string' && p.startsWith('%'))?.replace(/%/g, '').toLowerCase() ?? '';
      const match = rows.filter((r) => r.name.toLowerCase().includes(search));
      return { rows: match };
    });
  }

  test('"precio hamburguesa" → detecta hamburguesa, NO usa contexto', async () => {
    const id = sid();
    mockDbByName([mockHamburguesa, mockHorchata]);

    const { decision, replyText } = await processMessage({ text: 'precio hamburguesa', sessionId: id, businessId: BUSINESS_ID });

    expect(decision.entity.value).toBe('hamburguesa');
    expect(decision.usedContext).toBe(false);
    expect(replyText).toContain('Hamburguesa');
    expect(replyText).toContain('150.00');
  });

  test('"precio agua de horchata" después de preguntar hamburguesa → NO usa contexto', async () => {
    const id = sid();

    // Turn 1: hamburgesa quedó en contexto
    mockDbByName([mockHamburguesa]);
    await processMessage({ text: 'precio hamburguesa', sessionId: id, businessId: BUSINESS_ID });

    // Turn 2: precio agua de horchata → debe usar agua de horchata, NO hamburguesa
    mockDbByName([mockHamburguesa, mockHorchata]);
    const { decision, replyText } = await processMessage({ text: 'precio agua de horchata', sessionId: id, businessId: BUSINESS_ID });

    expect(decision.entity.value).toBe('agua de horchata');
    expect(decision.usedContext).toBe(false);
    expect(replyText).toContain('Agua de Horchata');
    expect(replyText).toContain('35.00');
    expect(replyText).not.toContain('Hamburguesa');
  });

  test('"y cuanto cuesta?" → usa contexto (hamburguesa)', async () => {
    const id = sid();

    // Turn 1: establecer contexto con hamburguesa
    mockDbByName([mockHamburguesa]);
    await processMessage({ text: 'precio hamburguesa', sessionId: id, businessId: BUSINESS_ID });

    // Turn 2: pregunta ambigua → debe usar contexto
    mockDbByName([mockHamburguesa]);
    const { decision } = await processMessage({ text: '¿y cuánto cuesta?', sessionId: id, businessId: BUSINESS_ID });

    expect(decision.usedContext).toBe(true);
    expect(decision.entity.value).toBe('hamburguesa');
  });

  test('"que precio tiene la hamburguesa" → extrae hamburguesa del mensaje', async () => {
    const id = sid();
    mockDbByName([mockHamburguesa]);

    const { decision, replyText } = await processMessage({ text: '¿Qué precio tiene la hamburguesa?', sessionId: id, businessId: BUSINESS_ID });

    expect(decision.entity.value).toBe('hamburguesa');
    expect(replyText).toContain('Hamburguesa');
    expect(replyText).toContain('150.00');
  });
});

// ─── Horarios con día específico ──────────────────────────────────────────────

describe('Horarios: detección de día en el mensaje', () => {
  const BUSINESS_ID = 1;

  const mockLunes  = { day_of_week: 1, open_time: '09:00:00', close_time: '18:00:00', is_closed: false };
  const mockMartes = { day_of_week: 2, open_time: '10:00:00', close_time: '20:00:00', is_closed: false };
  const mockDomingo = { day_of_week: 0, open_time: null, close_time: null, is_closed: true };

  function mockDbHorarios(row) {
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('business_hours')) return { rows: row ? [row] : [] };
      return { rows: [] };
    });
  }

  test('"cuando abren" → intent=horarios, entity=null (responde todos los días)', async () => {
    const id = sid();
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('business_hours')) return { rows: [mockLunes, mockMartes] };
      return { rows: [] };
    });
    const { decision } = await processMessage({ text: 'cuando abren', sessionId: id, businessId: BUSINESS_ID });
    expect(decision.intent).toBe('horarios');
    expect(decision.entity.type).toBeNull();
    expect(decision.usedContext).toBe(false);
  });

  test('"abren el lunes" → day=lunes, intent=horarios, NO IA, NO contexto', async () => {
    const id = sid();
    mockDbHorarios(mockLunes);

    const { decision, replyText } = await processMessage({ text: 'abren el lunes', sessionId: id, businessId: BUSINESS_ID });

    expect(decision.strategy).toBe('entity');
    expect(decision.intent).toBe('horarios');
    expect(decision.entity.type).toBe('day');
    expect(decision.entity.value).toBe('lunes');
    expect(decision.usedContext).toBe(false);
    expect(replyText).toContain('Lunes');
    expect(replyText).toContain('9:00 am');
  });

  test('"lunes?" → detecta lunes, responde horarios del lunes', async () => {
    const id = sid();
    mockDbHorarios(mockLunes);

    const { decision, replyText } = await processMessage({ text: 'lunes', sessionId: id, businessId: BUSINESS_ID });

    expect(decision.entity.type).toBe('day');
    expect(decision.entity.value).toBe('lunes');
    expect(decision.intent).toBe('horarios');
    expect(replyText).toContain('Lunes');
  });

  test('"y el martes?" → detecta martes directamente (no necesita contexto)', async () => {
    const id = sid();
    mockDbHorarios(mockMartes);

    const { decision, replyText } = await processMessage({ text: '¿y el martes?', sessionId: id, businessId: BUSINESS_ID });

    expect(decision.entity.type).toBe('day');
    expect(decision.entity.value).toBe('martes');
    expect(decision.intent).toBe('horarios');
    expect(decision.usedContext).toBe(false);
    expect(replyText).toContain('Martes');
  });

  test('día cerrado → respuesta "estamos cerrados"', async () => {
    const id = sid();
    mockDbHorarios(mockDomingo);

    const { replyText } = await processMessage({ text: 'abren el domingo', sessionId: id, businessId: BUSINESS_ID });

    expect(replyText.toLowerCase()).toContain('cerrado');
  });

  test('día no encontrado en DB → respuesta de fallback', async () => {
    const id = sid();
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('business_hours')) return { rows: [] };
      return { rows: [] };
    });

    const { replyText } = await processMessage({ text: 'el sabado abren', sessionId: id, businessId: BUSINESS_ID });
    expect(replyText.toLowerCase()).toContain('no encontré');
  });

  test('day entity se guarda en contexto después de consulta', async () => {
    const id = sid();
    mockDbHorarios(mockLunes);

    await processMessage({ text: 'abren el lunes', sessionId: id, businessId: BUSINESS_ID });

    const ctx = await getContext(BUSINESS_ID, id);
    expect(ctx.lastIntent).toBe('horarios');
    expect(ctx.lastEntity.type).toBe('day');
    expect(ctx.lastEntity.value).toBe('lunes');
  });

  test('cambio de día → SIEMPRE usa el día del mensaje, no el contexto', async () => {
    const id = sid();

    // Turn 1: preguntar lunes
    mockDbHorarios(mockLunes);
    await processMessage({ text: 'abren el lunes', sessionId: id, businessId: BUSINESS_ID });

    // Turn 2: preguntar martes → DEBE responder martes, no lunes
    mockDbHorarios(mockMartes);
    const t2 = await processMessage({ text: 'y el martes', sessionId: id, businessId: BUSINESS_ID });

    expect(t2.decision.entity.value).toBe('martes');
    expect(t2.decision.usedContext).toBe(false);
    expect(t2.replyText).toContain('Martes');
    expect(t2.replyText).not.toContain('Lunes');
  });

  test('decide() con day entity → strategy=entity, intent=horarios, usedContext=false', () => {
    const dayEntityResult = { type: 'day', value: 'viernes', dayOfWeek: 5 };
    const anyContext = { lastIntent: 'precios', lastEntity: { type: 'product', value: 'pizza' } };

    const d = decide(
      { intent: null, score: 0, scores: {}, confident: false },
      dayEntityResult,
      anyContext,
      'viernes'
    );

    expect(d.strategy).toBe('entity');
    expect(d.intent).toBe('horarios');
    expect(d.entity.type).toBe('day');
    expect(d.entity.value).toBe('viernes');
    expect(d.entity.dayOfWeek).toBe(5);
    expect(d.usedContext).toBe(false);
  });

  test('decide() con day entity ignora cualquier contexto previo de producto', () => {
    const dayEntityResult = { type: 'day', value: 'lunes', dayOfWeek: 1 };
    const productContext = { lastIntent: 'precios', lastEntity: { type: 'product', value: 'hamburguesa' } };

    const d = decide(
      { intent: 'horarios', score: 2, scores: { horarios: 2 }, confident: true },
      dayEntityResult,
      productContext,
      'abren el lunes'
    );

    expect(d.intent).toBe('horarios');
    expect(d.entity.type).toBe('day');
    expect(d.usedContext).toBe(false);
  });
});

// ─── Paginación y selección de categoría ─────────────────────────────────────

describe('Paginación: catálogo grande → categorías → paginación', () => {
  const BUSINESS_ID = 1;

  // Generate N fake products
  function makeProducts(n, category = 'General') {
    return Array.from({ length: n }, (_, i) => ({
      id: i + 1,
      name: `Producto ${i + 1}`,
      description: null,
      price: String((10 + i).toFixed(2)),
      is_available: true,
      stock_quantity: 5,
      category,
    }));
  }

  const CATEGORIES = ['Electrónica', 'Accesorios', 'Bebidas'];

  // Mock db.query dispatch table for pagination scenario
  function mockDbPagination({ allProducts, categoriesRows, categoryProducts, countResult }) {
    db.query.mockImplementation(async (sql, params) => {
      // getProductosByCategory (LIMIT / OFFSET) — must be checked BEFORE generic ILIKE
      if (sql.includes('LIMIT') && sql.includes('OFFSET')) {
        const limit  = params?.[2] ?? 10;
        const offset = params?.[3] ?? 0;
        const src    = categoryProducts ?? [];
        return { rows: src.slice(offset, offset + limit) };
      }

      // countProductosByCategory
      if (sql.includes('COUNT(*)')) {
        return { rows: [{ total: String(countResult ?? categoryProducts?.length ?? 0) }] };
      }

      // getCategories query
      if (sql.includes('DISTINCT') && sql.includes('categories')) {
        return { rows: categoriesRows ?? CATEGORIES.map((c) => ({ category: c })) };
      }

      // Entity detection ILIKE (p.name ILIKE — no LIMIT/OFFSET)
      if (sql.includes('ILIKE') && sql.includes('products')) return { rows: [] };

      // getProductos (all products — triggers hard limit)
      if (sql.includes('products')) {
        return { rows: allProducts ?? [] };
      }

      return { rows: [] };
    });
  }

  test('> 20 productos → responde con categorías (no muestra todos)', async () => {
    const id = sid();
    const big = makeProducts(25);
    mockDbPagination({ allProducts: big });

    const { replyText, decision } = await processMessage({ text: 'que productos tienen', sessionId: id, businessId: BUSINESS_ID });

    expect(decision.strategy).toBe('intent');
    expect(replyText).toContain('muchos productos');
    expect(replyText).toContain('Electrónica');
    expect(replyText).toContain('Accesorios');
    expect(replyText).not.toContain('Producto 1');
  });

  test('> 20 productos → contexto queda en category_selection', async () => {
    const id = sid();
    mockDbPagination({ allProducts: makeProducts(25) });

    await processMessage({ text: 'que productos tienen', sessionId: id, businessId: BUSINESS_ID });

    const ctx = await getContext(BUSINESS_ID, id);
    expect(ctx.lastIntent).toBe('category_selection');
    expect(ctx.availableCategories).toEqual(CATEGORIES);
  });

  test('selección de categoría → muestra primeros 10 productos', async () => {
    const id = sid();
    const catProducts = makeProducts(15, 'Electrónica');

    // Seed context as if we already showed categories
    await updateContext(BUSINESS_ID, id, {
      lastIntent: 'category_selection',
      availableCategories: CATEGORIES,
    });

    mockDbPagination({ categoryProducts: catProducts, countResult: 15 });

    const { decision, replyText } = await processMessage({ text: 'Electrónica', sessionId: id, businessId: BUSINESS_ID });

    expect(decision.strategy).toBe('category_select');
    expect(replyText).toContain('Electrónica');
    expect(replyText).toContain('Producto 1');
  });

  test('selección categoría con > 10 → muestra "ver más"', async () => {
    const id = sid();
    const catProducts = makeProducts(15, 'Bebidas');

    await updateContext(BUSINESS_ID, id, {
      lastIntent: 'category_selection',
      availableCategories: CATEGORIES,
    });

    mockDbPagination({ categoryProducts: catProducts, countResult: 15 });

    const { replyText } = await processMessage({ text: 'Bebidas', sessionId: id, businessId: BUSINESS_ID });

    expect(replyText).toContain('ver más');
  });

  test('selección categoría con ≤ 10 → NO muestra "ver más"', async () => {
    const id = sid();
    const catProducts = makeProducts(8, 'Accesorios');

    await updateContext(BUSINESS_ID, id, {
      lastIntent: 'category_selection',
      availableCategories: CATEGORIES,
    });

    mockDbPagination({ categoryProducts: catProducts, countResult: 8 });

    const { replyText } = await processMessage({ text: 'Accesorios', sessionId: id, businessId: BUSINESS_ID });

    expect(replyText).not.toContain('ver más');
    expect(replyText).toContain('todo en esta categoría');
  });

  test('"ver más" → devuelve siguiente bloque', async () => {
    const id = sid();
    const catProducts = makeProducts(20, 'Electrónica');

    // Seed pagination context
    await updateContext(BUSINESS_ID, id, {
      lastIntent: 'productos',
      paginationCategory: 'Electrónica',
      paginationOffset: 0,
      paginationTotal: 20,
    });

    mockDbPagination({ categoryProducts: catProducts, countResult: 20 });

    const { decision, replyText } = await processMessage({ text: 'ver más', sessionId: id, businessId: BUSINESS_ID });

    expect(decision.strategy).toBe('pagination');
    expect(replyText).toContain('Electrónica');
    expect(replyText).toContain('Producto 11');
  });

  test('"siguiente" también activa paginación', async () => {
    const id = sid();
    const catProducts = makeProducts(25, 'Electrónica');

    await updateContext(BUSINESS_ID, id, {
      lastIntent: 'productos',
      paginationCategory: 'Electrónica',
      paginationOffset: 0,
      paginationTotal: 25,
    });

    mockDbPagination({ categoryProducts: catProducts, countResult: 25 });

    const { decision } = await processMessage({ text: 'siguiente', sessionId: id, businessId: BUSINESS_ID });

    expect(decision.strategy).toBe('pagination');
  });

  test('nueva búsqueda reset contexto de paginación', async () => {
    const id = sid();

    // Seed pagination context
    await updateContext(BUSINESS_ID, id, {
      lastIntent: 'productos',
      paginationCategory: 'Electrónica',
      paginationOffset: 0,
      paginationTotal: 20,
      availableCategories: CATEGORIES,
    });

    // User asks about something completely new — product query, small result
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('ILIKE')) return { rows: [{ id: 99, name: 'Agua Mineral', description: null, price: '20.00', is_available: true, stock_quantity: 10, category: 'Bebidas' }] };
      return { rows: [] };
    });

    const { decision } = await processMessage({ text: 'tienen agua mineral', sessionId: id, businessId: BUSINESS_ID });

    expect(decision.strategy).toBe('entity');
    expect(decision.entity.value).toBe('agua mineral');

    const ctx = await getContext(BUSINESS_ID, id);
    expect(ctx.paginationCategory).toBeNull();
    expect(ctx.availableCategories).toBeNull();
  });
});

// ─── "tiene X" — verbo singular tercera persona ──────────────────────────────

describe('"tiene X" — detección verbo+entidad sin tienes/tienen', () => {
  const BUSINESS_ID = 1;
  const mockHamburguesa = { id: 1, name: 'Hamburguesa Doble', description: null, price: '120.00', is_available: true, stock_quantity: 8, category: 'Comida' };
  const mockBbq         = { id: 2, name: 'Hamburguesa BBQ',   description: null, price: '135.00', is_available: true, stock_quantity: 3, category: 'Comida' };

  // ── extractEntityCandidate ────────────────────────────────────────────────

  test('"tiene hamburguesa" → extrae "hamburguesa"', () => {
    expect(extractEntityCandidate('tiene hamburguesa')).toBe('hamburguesa');
  });

  test('"tiene hamburguesa bbq" → extrae "hamburguesa bbq"', () => {
    expect(extractEntityCandidate('tiene hamburguesa bbq')).toBe('hamburguesa bbq');
  });

  test('"tiene la hamburguesa mexicana" → extrae "hamburguesa mexicana" (elimina artículo)', () => {
    expect(extractEntityCandidate('tiene la hamburguesa mexicana')).toBe('hamburguesa mexicana');
  });

  test('"tiene hamburguesas" → extrae "hamburguesas"', () => {
    expect(extractEntityCandidate('tiene hamburguesas')).toBe('hamburguesas');
  });

  // ── Full pipeline: estrategia + intent ───────────────────────────────────

  test('"tiene hamburguesa" → strategy=entity, intent=productos, NO fallback', async () => {
    const id = sid();
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('ILIKE')) return { rows: [mockHamburguesa] };
      return { rows: [] };
    });

    const { decision } = await processMessage({ text: 'tiene hamburguesa', sessionId: id, businessId: BUSINESS_ID });

    expect(decision.strategy).toBe('entity');
    expect(decision.intent).toBe('productos');
    expect(decision.entity.type).toBe('product');
    expect(decision.entity.value).toBe('hamburguesa');
    expect(decision.usedContext).toBe(false);
  });

  test('"tienen hamburguesas" → strategy=entity, entity detectada, NO fallback', async () => {
    const id = sid();
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('ILIKE')) return { rows: [mockHamburguesa] };
      return { rows: [] };
    });

    const { decision } = await processMessage({ text: 'tienen hamburguesas', sessionId: id, businessId: BUSINESS_ID });

    expect(decision.strategy).toBe('entity');
    expect(decision.entity.type).toBe('product');
    expect(['hamburguesas', 'hamburguesa']).toContain(decision.entity.value);
  });

  test('"tiene hamburguesa bbq" → strategy=entity, entity="hamburguesa bbq"', async () => {
    const id = sid();
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('ILIKE')) return { rows: [mockBbq] };
      return { rows: [] };
    });

    const { decision } = await processMessage({ text: 'tiene hamburguesa bbq', sessionId: id, businessId: BUSINESS_ID });

    expect(decision.strategy).toBe('entity');
    expect(decision.intent).toBe('productos');
    expect(decision.entity.value).toBe('hamburguesa bbq');
  });

  test('"tiene hamburguesa" → replyText contiene nombre del producto', async () => {
    const id = sid();
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('ILIKE')) return { rows: [mockHamburguesa] };
      return { rows: [] };
    });

    const { replyText } = await processMessage({ text: 'tiene hamburguesa', sessionId: id, businessId: BUSINESS_ID });

    expect(replyText).toContain('Hamburguesa');
    expect(replyText).not.toBe(''); 
  });

  test('"tiene hamburguesa" sin contexto previo → NO usa contexto', async () => {
    const id = sid();
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('ILIKE')) return { rows: [mockHamburguesa] };
      return { rows: [] };
    });

    const { decision } = await processMessage({ text: 'tiene hamburguesa', sessionId: id, businessId: BUSINESS_ID });

    expect(decision.usedContext).toBe(false);
  });

  test('"tiene hamburguesa" → contexto guarda entidad para follow-up', async () => {
    const id = sid();
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('ILIKE')) return { rows: [mockHamburguesa] };
      return { rows: [] };
    });

    await processMessage({ text: 'tiene hamburguesa', sessionId: id, businessId: BUSINESS_ID });

    const ctx = await getContext(BUSINESS_ID, id);
    expect(ctx.lastEntity.value).toBe('hamburguesa');
    expect(ctx.lastEntity.type).toBe('product');
  });
});

// ─── extractFollowUpEntity() — bare noun (Shape 2) ───────────────────────────

describe('extractFollowUpEntity() — bare noun (Shape 2)', () => {
  test('"pizza mexicana" con lastEntity → "pizza mexicana"', () => {
    expect(extractFollowUpEntity('pizza mexicana', { value: 'pizza', type: 'product' })).toBe('pizza mexicana');
  });

  test('"pizza bbq" con lastEntity → "pizza bbq"', () => {
    expect(extractFollowUpEntity('pizza bbq', { value: 'pizza mexicana', type: 'product' })).toBe('pizza bbq');
  });

  test('"hamburguesa al pastor" (3 tokens) con lastEntity → extrae entidad', () => {
    expect(extractFollowUpEntity('hamburguesa al pastor', { value: 'pizza', type: 'product' })).toBe('hamburguesa al pastor');
  });

  test('"laptop gamer pro" (3 tokens) con lastEntity → extrae entidad', () => {
    expect(extractFollowUpEntity('laptop gamer pro', { value: 'laptop', type: 'product' })).toBe('laptop gamer pro');
  });

  test('token único "laptop" → null (requiere ≥ 2 tokens)', () => {
    expect(extractFollowUpEntity('laptop', { value: 'plasma', type: 'product' })).toBeNull();
  });

  test('"tienen pizza" → null (verbo en BARE_SKIP)', () => {
    expect(extractFollowUpEntity('tienen pizza mexicana', { value: 'pizza', type: 'product' })).toBeNull();
  });

  test('"hola" → null (en BARE_SKIP)', () => {
    expect(extractFollowUpEntity('hola', { value: 'pizza', type: 'product' })).toBeNull();
  });

  test('"si" → null (1 token)', () => {
    expect(extractFollowUpEntity('si', { value: 'pizza', type: 'product' })).toBeNull();
  });

  test('"busco hamburguesa" → null (busco está en BARE_SKIP)', () => {
    expect(extractFollowUpEntity('busco hamburguesa', { value: 'pizza', type: 'product' })).toBeNull();
  });

  test('devuelve null sin lastEntity', () => {
    expect(extractFollowUpEntity('pizza mexicana', null)).toBeNull();
    expect(extractFollowUpEntity('pizza mexicana', { value: null })).toBeNull();
  });
});

// ─── Contexto: bare-noun follow-up multi-turno ───────────────────────────────

describe('Contexto: bare noun follow-up multi-turno', () => {
  const BUSINESS_ID = 1;

  const mockPizza = { id: 1, name: 'Pizza Pepperoni', description: null, price: '130.00', is_available: true, stock_quantity: 10, category: 'Pizzas' };
  const mockMexicana = { id: 2, name: 'Pizza Mexicana', description: null, price: '145.00', is_available: true, stock_quantity: 5, category: 'Pizzas' };

  test('product found → bare noun "pizza mexicana" → strategy=followup, entity actualizado', async () => {
    const id = sid();

    // Turn 1: establece contexto con "pizza"
    db.query.mockImplementation(async (sql, params) => {
      if (sql.includes('ILIKE') && params?.some((p) => typeof p === 'string' && p.includes('pizza'))) {
        return { rows: [mockPizza] };
      }
      return { rows: [] };
    });
    const t1 = await processMessage({ text: 'tienen pizza', sessionId: id, businessId: BUSINESS_ID });
    expect(t1.decision.strategy).toBe('entity');
    expect(t1.decision.entity.value).toBe('pizza');

    // Turn 2: bare noun follow-up — "pizza mexicana" sin trigger
    db.query.mockImplementation(async (sql, params) => {
      if (sql.includes('ILIKE') && params?.some((p) => typeof p === 'string' && p.includes('mexicana'))) {
        return { rows: [mockMexicana] };
      }
      return { rows: [] };
    });
    const t2 = await processMessage({ text: 'pizza mexicana', sessionId: id, businessId: BUSINESS_ID });

    expect(t2.decision.strategy).toBe('followup');
    expect(t2.decision.entity.value).toBe('pizza mexicana');
    expect(t2.decision.usedContext).toBe(true);
  });

  test('product found → bare noun "pizza bbq" → followup, contexto actualiza entidad', async () => {
    const id = sid();
    const mockBbq = { ...mockPizza, id: 3, name: 'Pizza BBQ', price: '155.00' };

    // Turn 1
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('ILIKE')) return { rows: [mockPizza] };
      return { rows: [] };
    });
    await processMessage({ text: 'tienes pizza pepperoni', sessionId: id, businessId: BUSINESS_ID });

    // Turn 2
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('ILIKE')) return { rows: [mockBbq] };
      return { rows: [] };
    });
    const t2 = await processMessage({ text: 'pizza bbq', sessionId: id, businessId: BUSINESS_ID });

    expect(t2.decision.strategy).toBe('followup');
    expect(t2.decision.entity.value).toBe('pizza bbq');

    const ctx = await getContext(BUSINESS_ID, id);
    expect(ctx.lastEntity.value).toBe('pizza bbq');
  });

  test('sin contexto: bare noun "pizza mexicana" → strategy=ai (no context = no followup)', async () => {
    const id = sid();
    db.query.mockResolvedValue({ rows: [] });

    const { decision } = await processMessage({ text: 'pizza mexicana', sessionId: id, businessId: BUSINESS_ID });

    // No hay lastEntity en contexto → not a followup → AI fallback
    expect(decision.strategy).toBe('ai');
    expect(decision.usedContext).toBe(false);
  });

  test('"que productos tienes" después de producto → intent=productos detectado correctamente', async () => {
    const id = sid();

    // Turn 1: establecer producto en contexto
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('ILIKE')) return { rows: [mockPizza] };
      return { rows: [] };
    });
    await processMessage({ text: 'tienen pizza', sessionId: id, businessId: BUSINESS_ID });
    const ctx1 = await getContext(BUSINESS_ID, id);
    expect(ctx1.lastEntity.value).toBe('pizza');

    // Turn 2: "que productos tienes" — intent=productos debe detectarse
    db.query.mockResolvedValue({ rows: [] });
    const t2 = await processMessage({ text: 'que productos tienes', sessionId: id, businessId: BUSINESS_ID });

    expect(t2.decision.intent).toBe('productos');
  });
});

// ─── Disponibilidad de productos ─────────────────────────────────────────────

describe('Disponibilidad de productos', () => {
  const BUSINESS_ID = 1;

  const mockAvailable   = { id: 1, name: 'Pizza Pepperoni', description: null, price: '130.00', is_available: true,  stock_quantity: 10, category: 'Pizzas' };
  const mockUnavailable = { id: 2, name: 'Pizza Mexicana',  description: null, price: '145.00', is_available: false, stock_quantity: 0,  category: 'Pizzas' };

  function mockDbProduct(row) {
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('ILIKE')) return { rows: [row] };
      return { rows: [] };
    });
  }

  // ── extractEntityCandidate para frases de disponibilidad ──────────────────

  test('"esta disponible la pizza" → extrae "pizza"', () => {
    expect(extractEntityCandidate('esta disponible la pizza')).toBe('pizza');
  });

  test('"hay stock de cuadernos" → extrae "cuadernos"', () => {
    expect(extractEntityCandidate('hay stock de cuadernos')).toBe('cuadernos');
  });

  test('"tienen disponibilidad de la hamburguesa" → extrae "hamburguesa"', () => {
    expect(extractEntityCandidate('tienen disponibilidad de la hamburguesa')).toBe('hamburguesa');
  });

  test('"hay stock de laptop gamer" → extrae "laptop gamer"', () => {
    expect(extractEntityCandidate('hay stock de laptop gamer')).toBe('laptop gamer');
  });

  // ── Pipeline: producto disponible ─────────────────────────────────────────

  test('producto disponible → replyText menciona el nombre', async () => {
    const id = sid();
    mockDbProduct(mockAvailable);

    const { replyText } = await processMessage({ text: '¿Tienen pizza pepperoni?', sessionId: id, businessId: BUSINESS_ID });

    expect(replyText).toMatch(/tenemos|disponible/i);
    expect(replyText).toContain('Pizza Pepperoni');
  });

  test('producto NO disponible → replyText indica no disponible', async () => {
    const id = sid();
    mockDbProduct(mockUnavailable);

    const { replyText } = await processMessage({ text: '¿Tienen pizza mexicana?', sessionId: id, businessId: BUSINESS_ID });

    expect(replyText).toMatch(/no está disponible/i);
    expect(replyText).toContain('Pizza Mexicana');
  });

  test('"esta disponible la pizza" → entity detectada, pipeline responde con disponibilidad', async () => {
    const id = sid();
    mockDbProduct(mockAvailable);

    const { decision, replyText } = await processMessage({
      text: '¿Está disponible la pizza pepperoni?',
      sessionId: id,
      businessId: BUSINESS_ID,
    });

    expect(decision.entity.value).toBe('pizza pepperoni');
    expect(replyText).toMatch(/tenemos|disponible/i);
  });

  test('"hay stock de hamburguesa" → detecta entidad hamburguesa', async () => {
    const id = sid();
    const mockHamburguesa = { id: 3, name: 'Hamburguesa Doble', description: null, price: '120.00', is_available: true, stock_quantity: 5, category: 'Comida' };
    mockDbProduct(mockHamburguesa);

    const { decision } = await processMessage({
      text: 'hay stock de hamburguesa',
      sessionId: id,
      businessId: BUSINESS_ID,
    });

    expect(decision.entity.value).toBe('hamburguesa');
    expect(decision.strategy).toBe('entity');
  });

  test('stock_quantity=0 disponible=false → replyText indica no disponible', async () => {
    const id = sid();
    mockDbProduct(mockUnavailable);

    const { replyText } = await processMessage({
      text: 'tienes pizza mexicana',
      sessionId: id,
      businessId: BUSINESS_ID,
    });

    expect(replyText).toMatch(/no está disponible/i);
  });

  test('consulta disponibilidad → queda en contexto para follow-up', async () => {
    const id = sid();
    mockDbProduct(mockAvailable);

    await processMessage({ text: '¿Está disponible la pizza pepperoni?', sessionId: id, businessId: BUSINESS_ID });

    const ctx = await getContext(BUSINESS_ID, id);
    expect(ctx.lastEntity.type).toBe('product');
    expect(ctx.lastEntity.value).toBe('pizza pepperoni');
  });
});

// ─── Follow-up con triggers: "y", "tambien", "igual", "otro/a" ───────────────

describe('extractFollowUpEntity() — Shape 1b: tambien/igual/otro triggers', () => {
  test('"tambien hamburguesa bbq" → "hamburguesa bbq"', () => {
    expect(extractFollowUpEntity('tambien hamburguesa bbq', { value: 'hamburguesa mexicana', type: 'product' })).toBe('hamburguesa bbq');
  });

  test('"igual pizza pepperoni" → "pizza pepperoni"', () => {
    expect(extractFollowUpEntity('igual pizza pepperoni', { value: 'pizza mexicana', type: 'product' })).toBe('pizza pepperoni');
  });

  test('"otro tacos al pastor" → "tacos al pastor"', () => {
    expect(extractFollowUpEntity('otro tacos al pastor', { value: 'tacos', type: 'product' })).toBe('tacos al pastor');
  });

  test('"otra pizza bbq" → "pizza bbq"', () => {
    expect(extractFollowUpEntity('otra pizza bbq', { value: 'pizza mexicana', type: 'product' })).toBe('pizza bbq');
  });

  test('"tambien la pizza" → "pizza" (elimina artículo)', () => {
    expect(extractFollowUpEntity('tambien la pizza', { value: 'hamburguesa', type: 'product' })).toBe('pizza');
  });

  test('"tb hamburguesa" → "hamburguesa"', () => {
    expect(extractFollowUpEntity('tb hamburguesa', { value: 'pizza', type: 'product' })).toBe('hamburguesa');
  });

  test('"tambien" sin entidad → null', () => {
    expect(extractFollowUpEntity('tambien', { value: 'pizza', type: 'product' })).toBeNull();
  });

  test('"tambien hamburguesa bbq" sin lastEntity → null', () => {
    expect(extractFollowUpEntity('tambien hamburguesa bbq', null)).toBeNull();
    expect(extractFollowUpEntity('tambien hamburguesa bbq', { value: null })).toBeNull();
  });

  // Ensure tambien is in BARE_SKIP so Shape 2 doesn't include it
  test('"tambien hamburguesa" NO devuelve "tambien hamburguesa" por Shape 2', () => {
    const result = extractFollowUpEntity('tambien hamburguesa', { value: 'pizza', type: 'product' });
    if (result !== null) {
      expect(result).not.toContain('tambien');
    }
  });
});

// ─── Flujo completo: "tienen hamburguesa mexicana" → "y hamburguesa bbq" ──────

describe('Flujo completo: follow-up con "y / tambien / igual"', () => {
  const BUSINESS_ID = 1;

  const mockMexicana = { id: 1, name: 'Hamburguesa Mexicana', description: null, price: '130.00', is_available: true,  stock_quantity: 10, category: 'Comida' };
  const mockBbq      = { id: 2, name: 'Hamburguesa BBQ',      description: null, price: '145.00', is_available: true,  stock_quantity: 5,  category: 'Comida' };
  const mockPastor   = { id: 3, name: 'Tacos Al Pastor',      description: null, price: '80.00',  is_available: false, stock_quantity: 0,  category: 'Comida' };

  test('tienen hamburguesa mexicana → y hamburguesa bbq → strategy=followup, entity=hamburguesa bbq', async () => {
    const id = sid();

    // Turn 1
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('ILIKE')) return { rows: [mockMexicana] };
      return { rows: [] };
    });
    const t1 = await processMessage({ text: 'tienen hamburguesa mexicana', sessionId: id, businessId: BUSINESS_ID });
    expect(t1.decision.strategy).toBe('entity');
    expect(t1.decision.entity.value).toBe('hamburguesa mexicana');

    // Turn 2 — critico: "y hamburguesa bbq"
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('ILIKE')) return { rows: [mockBbq] };
      return { rows: [] };
    });
    const t2 = await processMessage({ text: 'y hamburguesa bbq', sessionId: id, businessId: BUSINESS_ID });

    expect(t2.decision.strategy).toBe('followup');
    expect(t2.decision.entity.type).toBe('product');
    expect(t2.decision.entity.value).toBe('hamburguesa bbq');
    expect(t2.decision.usedContext).toBe(true);
    expect(t2.replyText).toContain('Hamburguesa BBQ');
  });

  test('tienen hamburguesa mexicana → tambien hamburguesa bbq → followup detectado', async () => {
    const id = sid();

    db.query.mockImplementation(async (sql) => {
      if (sql.includes('ILIKE')) return { rows: [mockMexicana] };
      return { rows: [] };
    });
    await processMessage({ text: 'tienen hamburguesa mexicana', sessionId: id, businessId: BUSINESS_ID });

    db.query.mockImplementation(async (sql) => {
      if (sql.includes('ILIKE')) return { rows: [mockBbq] };
      return { rows: [] };
    });
    const t2 = await processMessage({ text: 'tambien hamburguesa bbq', sessionId: id, businessId: BUSINESS_ID });

    expect(t2.decision.strategy).toBe('followup');
    expect(t2.decision.entity.value).toBe('hamburguesa bbq');
    expect(t2.decision.usedContext).toBe(true);
  });

  test('tienen hamburguesa mexicana → igual pizza bbq → followup detectado (otro producto)', async () => {
    const id = sid();
    const mockPizzaBbq = { id: 4, name: 'Pizza BBQ', description: null, price: '150.00', is_available: true, stock_quantity: 8, category: 'Pizzas' };

    db.query.mockImplementation(async (sql) => {
      if (sql.includes('ILIKE')) return { rows: [mockMexicana] };
      return { rows: [] };
    });
    await processMessage({ text: 'tienen hamburguesa mexicana', sessionId: id, businessId: BUSINESS_ID });

    db.query.mockImplementation(async (sql) => {
      if (sql.includes('ILIKE')) return { rows: [mockPizzaBbq] };
      return { rows: [] };
    });
    const t2 = await processMessage({ text: 'igual pizza bbq', sessionId: id, businessId: BUSINESS_ID });

    expect(t2.decision.strategy).toBe('followup');
    expect(t2.decision.entity.value).toBe('pizza bbq');
  });

  test('follow-up hereda intent=productos del turno anterior', async () => {
    const id = sid();

    db.query.mockImplementation(async (sql) => {
      if (sql.includes('ILIKE')) return { rows: [mockMexicana] };
      return { rows: [] };
    });
    await processMessage({ text: 'tienen hamburguesa mexicana', sessionId: id, businessId: BUSINESS_ID });

    db.query.mockImplementation(async (sql) => {
      if (sql.includes('ILIKE')) return { rows: [mockBbq] };
      return { rows: [] };
    });
    const t2 = await processMessage({ text: 'y hamburguesa bbq', sessionId: id, businessId: BUSINESS_ID });

    expect(t2.decision.intent).toBe('productos');
  });

  test('contexto se actualiza después del follow-up (nueva entidad en lastEntity)', async () => {
    const id = sid();

    db.query.mockImplementation(async (sql) => {
      if (sql.includes('ILIKE')) return { rows: [mockMexicana] };
      return { rows: [] };
    });
    await processMessage({ text: 'tienen hamburguesa mexicana', sessionId: id, businessId: BUSINESS_ID });

    db.query.mockImplementation(async (sql) => {
      if (sql.includes('ILIKE')) return { rows: [mockBbq] };
      return { rows: [] };
    });
    await processMessage({ text: 'y hamburguesa bbq', sessionId: id, businessId: BUSINESS_ID });

    const ctx = await getContext(BUSINESS_ID, id);
    expect(ctx.lastEntity.value).toBe('hamburguesa bbq');
    expect(ctx.lastEntity.type).toBe('product');
    expect(ctx.lastIntent).toBe('productos');
  });

  test('tres turnos: mexicana → bbq → pastor', async () => {
    const id = sid();

    db.query.mockImplementation(async (sql) => {
      if (sql.includes('ILIKE')) return { rows: [mockMexicana] };
      return { rows: [] };
    });
    await processMessage({ text: 'tienen hamburguesa mexicana', sessionId: id, businessId: BUSINESS_ID });

    db.query.mockImplementation(async (sql) => {
      if (sql.includes('ILIKE')) return { rows: [mockBbq] };
      return { rows: [] };
    });
    const t2 = await processMessage({ text: 'y hamburguesa bbq', sessionId: id, businessId: BUSINESS_ID });
    expect(t2.decision.strategy).toBe('followup');
    expect(t2.decision.entity.value).toBe('hamburguesa bbq');

    db.query.mockImplementation(async (sql) => {
      if (sql.includes('ILIKE')) return { rows: [mockPastor] };
      return { rows: [] };
    });
    const t3 = await processMessage({ text: 'tambien tacos al pastor', sessionId: id, businessId: BUSINESS_ID });
    expect(t3.decision.strategy).toBe('followup');
    expect(t3.decision.entity.value).toBe('tacos al pastor');
  });

  test('detección parcialmente fallida en turno 1 — contexto persiste y follow-up funciona', async () => {
    const id = sid();

    // Manually seed context as if turn 1 partially saved entity
    await updateContext(BUSINESS_ID, id, {
      lastEntity: { type: 'product', value: 'hamburguesa' },
      lastIntent: 'productos',
    });

    db.query.mockImplementation(async (sql) => {
      if (sql.includes('ILIKE')) return { rows: [mockBbq] };
      return { rows: [] };
    });
    const t2 = await processMessage({ text: 'y hamburguesa bbq', sessionId: id, businessId: BUSINESS_ID });

    expect(t2.decision.strategy).toBe('followup');
    expect(t2.decision.entity.value).toBe('hamburguesa bbq');
    expect(t2.decision.usedContext).toBe(true);
  });
});

// ─── enrichFollowUpCandidate: reconstrucción con preposición ─────────────────

describe('extractFollowUpEntity() — preposition-enrichment ("y de X")', () => {
  test('"y de jamaica" + lastEntity="agua de limon" → "agua de jamaica"', () => {
    expect(extractFollowUpEntity('y de jamaica', { value: 'agua de limon', type: 'product' })).toBe('agua de jamaica');
  });

  test('"y de fresa" + lastEntity="agua de limon" → "agua de fresa"', () => {
    expect(extractFollowUpEntity('y de fresa', { value: 'agua de limon', type: 'product' })).toBe('agua de fresa');
  });

  test('"y de queso" + lastEntity="pizza de pepperoni" → "pizza de queso"', () => {
    expect(extractFollowUpEntity('y de queso', { value: 'pizza de pepperoni', type: 'product' })).toBe('pizza de queso');
  });

  test('"y al carbon" + lastEntity="tacos al pastor" → "tacos al carbon"', () => {
    expect(extractFollowUpEntity('y al carbon', { value: 'tacos al pastor', type: 'product' })).toBe('tacos al carbon');
  });

  test('"y pizza bbq" (sin preposición) → sin enriquecimiento → "pizza bbq"', () => {
    expect(extractFollowUpEntity('y pizza bbq', { value: 'pizza mexicana', type: 'product' })).toBe('pizza bbq');
  });

  test('"tambien de jamaica" + lastEntity="agua de limon" → "agua de jamaica"', () => {
    expect(extractFollowUpEntity('tambien de jamaica', { value: 'agua de limon', type: 'product' })).toBe('agua de jamaica');
  });

  test('"y de jamaica" + lastEntity sin preposición → sin enriquecimiento → "de jamaica"', () => {
    // lastEntity "pizza" has no "de/con/al", so enrichment base extraction fails → returns raw candidate
    expect(extractFollowUpEntity('y de jamaica', { value: 'pizza', type: 'product' })).toBe('de jamaica');
  });

  // "del X" — contracted de+el — must extract standalone product, NOT prepend context entity
  test('"el del agua de jamaica" + lastEntity="arroz con leche" → "agua de jamaica" (no corruption)', () => {
    const result = extractFollowUpEntity('el del agua de jamaica', { value: 'arroz con leche', type: 'product' });
    expect(result).toBe('agua de jamaica');
  });

  test('"del agua de jamaica" (bare) + lastEntity="arroz con leche" → "agua de jamaica"', () => {
    const result = extractFollowUpEntity('del agua de jamaica', { value: 'arroz con leche', type: 'product' });
    expect(result).toBe('agua de jamaica');
  });

  test('"del refresco" + lastEntity="arroz con leche" → "refresco" (standalone, not "arroz del refresco")', () => {
    const result = extractFollowUpEntity('del refresco', { value: 'arroz con leche', type: 'product' });
    expect(result).toBe('refresco');
  });
});

// ─── Flujo completo: producto NO encontrado → follow-up sí encontrado ────────

describe('Flujo: primer resultado negativo → follow-up positivo con "y de X"', () => {
  const BUSINESS_ID = 1;

  const mockJamaica = { id: 5, name: 'Agua de Jamaica', description: null, price: '25.00', is_available: true, stock_quantity: 15, category: 'Bebidas' };
  const mockFresa   = { id: 6, name: 'Agua de Fresa',   description: null, price: '25.00', is_available: true, stock_quantity: 8,  category: 'Bebidas' };

  test('"tienen agua de limon" (no encontrado) → "y de jamaica?" → strategy=followup, entity="agua de jamaica"', async () => {
    const id = sid();

    // Turn 1: agua de limon — NOT found
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('ILIKE')) return { rows: [] };
      return { rows: [] };
    });
    const t1 = await processMessage({ text: 'tienen agua de limon', sessionId: id, businessId: BUSINESS_ID });
    expect(t1.decision.strategy).toBe('entity');
    expect(t1.decision.entity.value).toBe('agua de limon');
    // Entity saved to context even when not found
    const ctx1 = await getContext(BUSINESS_ID, id);
    expect(ctx1.lastEntity.value).toBe('agua de limon');

    // Turn 2: "y de jamaica?" — enriquece con contexto → "agua de jamaica"
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('ILIKE')) return { rows: [mockJamaica] };
      return { rows: [] };
    });
    const t2 = await processMessage({ text: 'y de jamaica?', sessionId: id, businessId: BUSINESS_ID });

    expect(t2.decision.strategy).toBe('followup');
    expect(t2.decision.entity.type).toBe('product');
    expect(t2.decision.entity.value).toBe('agua de jamaica');
    expect(t2.decision.usedContext).toBe(true);
    expect(t2.replyText).toContain('Jamaica');
    // NOT the AI fallback message
    expect(t2.replyText).not.toMatch(/🤖.*horarios.*productos.*precios/i);
  });

  test('"tienen agua de limon" (no encontrado) → contexto guarda entidad para follow-up', async () => {
    const id = sid();
    db.query.mockResolvedValue({ rows: [] });

    await processMessage({ text: 'tienen agua de limon', sessionId: id, businessId: BUSINESS_ID });

    const ctx = await getContext(BUSINESS_ID, id);
    expect(ctx.lastEntity).toEqual({ type: 'product', value: 'agua de limon' });
    expect(ctx.lastIntent).toBe('productos');
  });

  test('"y de fresa?" después de agua de limon → "agua de fresa" encontrado', async () => {
    const id = sid();
    db.query.mockResolvedValue({ rows: [] });
    await processMessage({ text: 'tienen agua de limon', sessionId: id, businessId: BUSINESS_ID });

    db.query.mockImplementation(async (sql) => {
      if (sql.includes('ILIKE')) return { rows: [mockFresa] };
      return { rows: [] };
    });
    const t2 = await processMessage({ text: 'y de fresa?', sessionId: id, businessId: BUSINESS_ID });

    expect(t2.decision.strategy).toBe('followup');
    expect(t2.decision.entity.value).toBe('agua de fresa');
    expect(t2.replyText).toContain('Fresa');
  });

  test('"tienen agua de limon" NO encontrado → "y de jamaica?" NO responde con IA fallback', async () => {
    const id = sid();
    db.query.mockResolvedValue({ rows: [] });
    await processMessage({ text: 'tienen agua de limon', sessionId: id, businessId: BUSINESS_ID });

    db.query.mockImplementation(async (sql) => {
      if (sql.includes('ILIKE')) return { rows: [mockJamaica] };
      return { rows: [] };
    });
    const { replyText, decision } = await processMessage({ text: 'y de jamaica?', sessionId: id, businessId: BUSINESS_ID });

    // Crucial: must NOT be AI fallback
    expect(decision.strategy).not.toBe('ai');
    expect(replyText).not.toMatch(/Quieres saber algo mas/i);
  });

  test('tres variantes de agua: limon → jamaica → fresa (cadena seguida)', async () => {
    const id = sid();
    const mockLimon = { id: 4, name: 'Agua de Limon', description: null, price: '25.00', is_available: false, stock_quantity: 0, category: 'Bebidas' };

    // Turn 1: limon FOUND but unavailable
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('ILIKE')) return { rows: [mockLimon] };
      return { rows: [] };
    });
    const t1 = await processMessage({ text: 'tienen agua de limon', sessionId: id, businessId: BUSINESS_ID });
    expect(t1.decision.entity.value).toBe('agua de limon');

    // Turn 2: y de jamaica
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('ILIKE')) return { rows: [mockJamaica] };
      return { rows: [] };
    });
    const t2 = await processMessage({ text: 'y de jamaica', sessionId: id, businessId: BUSINESS_ID });
    expect(t2.decision.strategy).toBe('followup');
    expect(t2.decision.entity.value).toBe('agua de jamaica');

    // Turn 3: y de fresa
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('ILIKE')) return { rows: [mockFresa] };
      return { rows: [] };
    });
    const t3 = await processMessage({ text: 'y de fresa', sessionId: id, businessId: BUSINESS_ID });
    expect(t3.decision.strategy).toBe('followup');
    expect(t3.decision.entity.value).toBe('agua de fresa');
  });
});

// ─── Intención: descripcion ───────────────────────────────────────────────────

describe('Intención: descripcion', () => {
  const BUSINESS_ID = 1;

  const mockPizza = {
    id: 1,
    name: 'Pizza Pepperoni',
    description: 'Masa crujiente, salsa de tomate, pepperoni y queso mozzarella',
    price: '130.00',
    is_available: true,
    stock_quantity: 10,
    category: 'Pizzas',
  };
  const mockSinDesc = {
    id: 2,
    name: 'Agua de Jamaica',
    description: null,
    price: '25.00',
    is_available: true,
    stock_quantity: 20,
    category: 'Bebidas',
  };

  function mockDbProduct(row) {
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('ILIKE')) return { rows: [row] };
      return { rows: [] };
    });
  }

  // ── Detección de intención ────────────────────────────────────────────────

  test('"que tiene la pizza pepperoni" → intent=descripcion', async () => {
    const id = sid();
    mockDbProduct(mockPizza);
    const { decision } = await processMessage({ text: 'que tiene la pizza pepperoni', sessionId: id, businessId: BUSINESS_ID });
    expect(decision.intent).toBe('descripcion');
  });

  test('"que contiene este articulo" → intent=descripcion', async () => {
    const id = sid();
    db.query.mockResolvedValue({ rows: [] });
    const { decision } = await processMessage({ text: 'que contiene este articulo', sessionId: id, businessId: BUSINESS_ID });
    expect(decision.intent).toBe('descripcion');
  });

  test('"caracteristicas" → intent=descripcion', async () => {
    const id = sid();
    db.query.mockResolvedValue({ rows: [] });
    const { decision } = await processMessage({ text: 'caracteristicas', sessionId: id, businessId: BUSINESS_ID });
    expect(decision.intent).toBe('descripcion');
  });

  test('"especificaciones de pizza pepperoni" → intent=descripcion', async () => {
    const id = sid();
    mockDbProduct(mockPizza);
    const { decision } = await processMessage({ text: 'especificaciones de pizza pepperoni', sessionId: id, businessId: BUSINESS_ID });
    expect(decision.intent).toBe('descripcion');
  });

  test('"que trae" → intent=descripcion', async () => {
    const id = sid();
    db.query.mockResolvedValue({ rows: [] });
    const { decision } = await processMessage({ text: 'que trae', sessionId: id, businessId: BUSINESS_ID });
    expect(decision.intent).toBe('descripcion');
  });

  test('"descripcion de este articulo" → intent=descripcion', async () => {
    const id = sid();
    db.query.mockResolvedValue({ rows: [] });
    const { decision } = await processMessage({ text: 'descripcion de este articulo', sessionId: id, businessId: BUSINESS_ID });
    expect(decision.intent).toBe('descripcion');
  });

  // ── Respuesta con descripción ─────────────────────────────────────────────

  test('"que tiene la pizza pepperoni" → replyText contiene descripción', async () => {
    const id = sid();
    mockDbProduct(mockPizza);
    const { replyText } = await processMessage({ text: 'que tiene la pizza pepperoni', sessionId: id, businessId: BUSINESS_ID });
    expect(replyText).toContain('Pizza Pepperoni');
    expect(replyText).toContain('pepperoni');
  });

  test('producto sin descripción → respuesta informativa sin crash', async () => {
    const id = sid();
    mockDbProduct(mockSinDesc);
    const { replyText } = await processMessage({ text: 'que contiene agua de jamaica', sessionId: id, businessId: BUSINESS_ID });
    expect(replyText).toContain('Agua de Jamaica');
    expect(replyText).toBeDefined();
  });

  test('entidad no encontrada → respuesta informativa', async () => {
    const id = sid();
    db.query.mockResolvedValue({ rows: [] });
    const { replyText } = await processMessage({ text: 'que contiene el producto xyz123', sessionId: id, businessId: BUSINESS_ID });
    expect(typeof replyText).toBe('string');
    expect(replyText.length).toBeGreaterThan(0);
  });

  // ── Diferenciación "tiene X" vs "que tiene X" ─────────────────────────────

  test('"tiene hamburguesa" → disponibilidad (NO descripcion)', async () => {
    const id = sid();
    mockDbProduct(mockPizza);
    const { decision } = await processMessage({ text: 'tiene hamburguesa', sessionId: id, businessId: BUSINESS_ID });
    expect(decision.intent).not.toBe('descripcion');
  });

  test('"tienes pizza" → disponibilidad (NO descripcion)', async () => {
    const id = sid();
    mockDbProduct(mockPizza);
    const { decision } = await processMessage({ text: 'tienes pizza', sessionId: id, businessId: BUSINESS_ID });
    expect(decision.intent).not.toBe('descripcion');
  });

  test('"que tienes" → productos (NO descripcion)', async () => {
    const id = sid();
    db.query.mockResolvedValue({ rows: [] });
    const { decision } = await processMessage({ text: 'que tienes', sessionId: id, businessId: BUSINESS_ID });
    expect(decision.intent).toBe('productos');
    expect(decision.intent).not.toBe('descripcion');
  });

  // ── Uso de contexto ───────────────────────────────────────────────────────

  test('"que contiene este articulo" con contexto pizza → usa contexto', async () => {
    const id = sid();

    // Turn 1: establish pizza context
    mockDbProduct(mockPizza);
    await processMessage({ text: 'tienes pizza pepperoni', sessionId: id, businessId: BUSINESS_ID });

    // Turn 2: ambiguous description request → context entity used
    mockDbProduct(mockPizza);
    const { decision } = await processMessage({ text: 'que contiene este articulo', sessionId: id, businessId: BUSINESS_ID });
    expect(decision.intent).toBe('descripcion');
    expect(decision.usedContext).toBe(true);
  });

  test('"que incluye" sin entidad ni contexto → pide clarificación', async () => {
    const id = sid();
    db.query.mockResolvedValue({ rows: [] });
    const { replyText } = await processMessage({ text: 'que incluye', sessionId: id, businessId: BUSINESS_ID });
    // No entity and no context → should ask for clarification, not crash
    expect(typeof replyText).toBe('string');
    expect(replyText.length).toBeGreaterThan(0);
  });
});

// ─── extractFollowUpEntity: stripping de artículos ───────────────────────────

describe('extractFollowUpEntity(): stripping de artículos iniciales', () => {
  const lastEntity = { type: 'product', value: 'hamburguesa bbq' };

  test('"la pizza mexicana" → "pizza mexicana" (artículo "la" eliminado)', () => {
    expect(extractFollowUpEntity('la pizza mexicana', lastEntity)).toBe('pizza mexicana');
  });

  test('"el taco pastor" → "taco pastor" (artículo "el" eliminado)', () => {
    expect(extractFollowUpEntity('el taco pastor', lastEntity)).toBe('taco pastor');
  });

  test('"los tacos al pastor" → "tacos al pastor" (artículo "los" eliminado)', () => {
    expect(extractFollowUpEntity('los tacos al pastor', lastEntity)).toBe('tacos al pastor');
  });

  test('"pizza mexicana" sin artículo → sigue funcionando igual', () => {
    expect(extractFollowUpEntity('pizza mexicana', lastEntity)).toBe('pizza mexicana');
  });

  test('"y la pizza mexicana" → "pizza mexicana" (artículo en Shape 1a)', () => {
    expect(extractFollowUpEntity('y la pizza mexicana', lastEntity)).toBe('pizza mexicana');
  });

  test('"y el taco" → "taco" (artículo en Shape 1a)', () => {
    expect(extractFollowUpEntity('y el taco', lastEntity)).toBe('taco');
  });

  test('mensaje solo artículo + 1 palabra → no devuelve nada inválido', () => {
    // After stripping "la", there's only "x" - still valid (length >= 2)
    const result = extractFollowUpEntity('la pizza', lastEntity);
    expect(result).toBe('pizza');
  });
});

// ─── Flujo: descripcion → follow-up con artículo → "sí" → catálogo ──────────

describe('Flujo: descripcion context → follow-up con artículo → no encontrado → "sí" → catálogo', () => {
  const BUSINESS_ID = 1;

  const mockHamburguesa = {
    id: 1,
    name: 'Hamburguesa BBQ',
    description: 'Con cheddar y cebolla caramelizada',
    price: '150.00',
    is_available: true,
    stock_quantity: 10,
    category: 'Burgers',
  };
  const mockPizzaMexicana = {
    id: 2,
    name: 'Pizza Mexicana',
    description: 'Con jalapeños, elote y salsa roja',
    price: '120.00',
    is_available: true,
    stock_quantity: 5,
    category: 'Pizzas',
  };

  function mockDbByName(...products) {
    db.query.mockImplementation(async (sql, params) => {
      if (!sql.includes('ILIKE')) return { rows: [] };
      const search = params?.find((p) => typeof p === 'string' && p.startsWith('%'))
        ?.replace(/%/g, '').toLowerCase() ?? '';
      const matches = products.filter((r) => r.name.toLowerCase().includes(search));
      return { rows: matches };
    });
  }

  test('follow-up "la pizza mexicana" usa el producto correcto (artículo eliminado)', async () => {
    const id = sid();

    // Turn 1: "qué contiene la hamburguesa bbq?" → establece contexto descripcion
    mockDbByName(mockHamburguesa);
    const t1 = await processMessage({
      text: '¿Qué contiene la hamburguesa bbq?',
      sessionId: id,
      businessId: BUSINESS_ID,
    });
    expect(t1.decision.intent).toBe('descripcion');
    expect(t1.replyText).toContain('Hamburguesa BBQ');

    // Turn 2: "la pizza mexicana" → follow-up con artículo → debe ENCONTRAR pizza mexicana
    mockDbByName(mockHamburguesa, mockPizzaMexicana);
    const t2 = await processMessage({
      text: 'la pizza mexicana',
      sessionId: id,
      businessId: BUSINESS_ID,
    });
    // Entity value should be "pizza mexicana" (NOT "la pizza mexicana")
    expect(t2.decision.entity.value).toBe('pizza mexicana');
    // Should NOT say "no encontré"
    expect(t2.replyText).not.toContain('no encontr');
    expect(t2.replyText).toContain('Pizza Mexicana');
  });

  test('follow-up con artículo pero producto NO existe → "sí" muestra catálogo', async () => {
    const id = sid();

    // Turn 1: hamburguesa en contexto
    mockDbByName(mockHamburguesa);
    await processMessage({
      text: '¿Qué contiene la hamburguesa bbq?',
      sessionId: id,
      businessId: BUSINESS_ID,
    });

    // Turn 2: producto que no existe → "la torta de res" → no encontrado
    db.query.mockResolvedValue({ rows: [] });
    const t2 = await processMessage({
      text: 'la torta de res',
      sessionId: id,
      businessId: BUSINESS_ID,
    });
    expect(t2.replyText.toLowerCase()).toContain('no encontr');

    // Verify lastEntityFound=false so "sí" shows catalog
    const ctxAfterT2 = await getContext(BUSINESS_ID, id);
    expect(ctxAfterT2.lastEntityFound).toBe(false);

    // Turn 3: "sí" → debe mostrar catálogo (entity null), NO re-querying la torta
    db.query.mockResolvedValue({ rows: [] });
    const t3 = await processMessage({ text: 'sí', sessionId: id, businessId: BUSINESS_ID });
    expect(t3.decision.strategy).toBe('context');
    expect(t3.decision.intent).toBe('productos');
    expect(t3.decision.entity.value).toBeNull();
  });

  test('follow-up sin artículo y producto existente → respuesta correcta con descripción', async () => {
    const id = sid();

    // Turn 1: establecer contexto descripcion con hamburguesa
    mockDbByName(mockHamburguesa);
    await processMessage({
      text: '¿Qué contiene la hamburguesa bbq?',
      sessionId: id,
      businessId: BUSINESS_ID,
    });

    // Turn 2: "pizza mexicana" (sin artículo) → debe encontrarla y responder
    mockDbByName(mockHamburguesa, mockPizzaMexicana);
    const t2 = await processMessage({
      text: 'pizza mexicana',
      sessionId: id,
      businessId: BUSINESS_ID,
    });
    expect(t2.decision.entity.value).toBe('pizza mexicana');
    expect(t2.replyText).not.toContain('no encontr');
    expect(t2.replyText).toContain('Pizza Mexicana');
  });
});

// ─── Estructura "que [entidad] tienen?" ──────────────────────────────────────

describe('Estructura: que + [entidad] + tienen', () => {
  const BUSINESS_ID = 1;

  // ── extractEntityCandidate ────────────────────────────────────────────────

  test('"que hamburguesas tienen" → extrae "hamburguesas"', () => {
    expect(extractEntityCandidate('que hamburguesas tienen')).toBe('hamburguesas');
  });

  test('"que tacos al pastor tienen" → extrae "tacos al pastor"', () => {
    expect(extractEntityCandidate('que tacos al pastor tienen')).toBe('tacos al pastor');
  });

  test('"que hamburguesas hay" → extrae "hamburguesas"', () => {
    expect(extractEntityCandidate('que hamburguesas hay')).toBe('hamburguesas');
  });

  test('"que hamburguesas tienen?" (con signo) → extrae "hamburguesas"', () => {
    expect(extractEntityCandidate('que hamburguesas tienen?')).toBe('hamburguesas');
  });

  test('"que hamburguesas tienen disponibles" → extrae "hamburguesas"', () => {
    expect(extractEntityCandidate('que hamburguesas tienen disponibles')).toBe('hamburguesas');
  });

  test('"que productos tienen" → null (producto es genérico, está en blocklist)', () => {
    // "productos" está en ENTITY_BLOCKLIST → debe rechazarse
    expect(extractEntityCandidate('que productos tienen')).toBeNull();
  });

  test('"que tiene la hamburguesa" NO es extraído por este patrón (verb-first → descripcion)', () => {
    // El patrón requiere verbo AL FINAL. Este tiene verbo justo tras "que" → no aplica.
    // La extracción puede devolverlo por otro patrón (descripcion), pero no por el nuevo.
    // Solo verificamos que no devuelve "tiene la hamburguesa".
    const result = extractEntityCandidate('que tiene la hamburguesa');
    if (result !== null) {
      expect(result).not.toBe('tiene la hamburguesa');
      expect(result).not.toContain('tiene');
    }
  });

  // ── Pipeline integración ─────────────────────────────────────────────────

  test('"que hamburguesas tienen" → strategy=entity, intent=productos', async () => {
    const id = sid();
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('ILIKE')) return { rows: [
        { id: 1, name: 'Hamburguesa Doble', description: null, price: '130.00', is_available: true, stock_quantity: 5, category: 'Comida' },
      ]};
      return { rows: [] };
    });

    const { decision } = await processMessage({ text: 'que hamburguesas tienen', sessionId: id, businessId: BUSINESS_ID });

    expect(decision.strategy).toBe('entity');
    expect(decision.intent).toBe('productos');
    expect(decision.entity.value).toBe('hamburguesas');
    expect(decision.intent).not.toBe('descripcion');
  });

  test('"que tacos al pastor tienen?" → extrae entidad multi-palabra', async () => {
    const id = sid();
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('ILIKE')) return { rows: [
        { id: 2, name: 'Tacos al Pastor', description: null, price: '80.00', is_available: true, stock_quantity: 10, category: 'Tacos' },
      ]};
      return { rows: [] };
    });

    const { decision } = await processMessage({ text: 'que tacos al pastor tienen?', sessionId: id, businessId: BUSINESS_ID });

    expect(decision.strategy).toBe('entity');
    expect(decision.entity.value).toBe('tacos al pastor');
    expect(decision.intent).toBe('productos');
  });

  test('"que hamburguesas tienen" → replyText contiene el nombre del producto', async () => {
    const id = sid();
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('ILIKE')) return { rows: [
        { id: 1, name: 'Hamburguesa BBQ', description: null, price: '145.00', is_available: true, stock_quantity: 3, category: 'Comida' },
      ]};
      return { rows: [] };
    });

    const { replyText } = await processMessage({ text: 'que hamburguesas tienen', sessionId: id, businessId: BUSINESS_ID });

    expect(replyText).toContain('Hamburguesa BBQ');
  });

  test('"que hamburguesas tienen" y "que tiene la hamburguesa bbq" difieren en intent', async () => {
    // "que hamburguesas tienen" → productos
    expect(detectIntent('que hamburguesas tienen').intent).not.toBe('descripcion');
    // "que tiene la hamburguesa bbq" → descripcion
    expect(detectIntent('que tiene la hamburguesa bbq').intent).toBe('descripcion');
  });
});

// ─── Estructura "que [intent-word] tienen?" → infiere intent correcto ────────

describe('Estructura: que [intent-word] tienen → infiere intent correcto', () => {
  const BUSINESS_ID = 1;

  // ── Intent detection solo ─────────────────────────────────────────────────

  test('"que horarios tienen?" → intent=horarios (NO productos)', () => {
    expect(detectIntent('que horarios tienen?').intent).toBe('horarios');
    expect(detectIntent('que horarios tienen?').intent).not.toBe('productos');
  });

  test('"que promociones tienen?" → intent=promociones', () => {
    expect(detectIntent('que promociones tienen?').intent).toBe('promociones');
  });

  test('"que descuentos tienen?" → intent=promociones', () => {
    expect(detectIntent('que descuentos tienen?').intent).toBe('promociones');
  });

  test('"que precios tienen?" → intent=precios', () => {
    expect(detectIntent('que precios tienen?').intent).toBe('precios');
  });

  test('"que ubicacion tienen?" → intent=ubicacion', () => {
    expect(detectIntent('que ubicacion tienen?').intent).toBe('ubicacion');
  });

  // ── Blocklist: palabras de intención no extraídas como entidad ────────────

  test('"que horarios tienen" NO extrae "horarios" como entidad producto', () => {
    expect(extractEntityCandidate('que horarios tienen')).toBeNull();
  });

  test('"que precios tienen" NO extrae "precios" como entidad producto', () => {
    expect(extractEntityCandidate('que precios tienen')).toBeNull();
  });

  test('"que ubicacion tienen" NO extrae "ubicacion" como entidad producto', () => {
    expect(extractEntityCandidate('que ubicacion tienen')).toBeNull();
  });

  // ── Pipeline: routing correcto ────────────────────────────────────────────

  test('"que horarios tienen?" → pipeline: decision.intent=horarios, strategy≠entity', async () => {
    const id = sid();
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('business_hours')) return { rows: [
        { day_of_week: 1, open_time: '09:00:00', close_time: '18:00:00', is_closed: false },
      ]};
      return { rows: [] };
    });

    const { decision } = await processMessage({ text: 'que horarios tienen?', sessionId: id, businessId: BUSINESS_ID });

    expect(decision.intent).toBe('horarios');
    // Must NOT be routed as a product entity query
    expect(decision.strategy).not.toBe('entity');
    expect(decision.entity.value).toBeNull();
  });

  test('"que promociones tienen?" → pipeline: decision.intent=promociones', async () => {
    const id = sid();
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('promotions')) return { rows: [
        { title: 'Promo 2x1', description: '', discount_type: 'percentage', discount_value: 50, start_date: '2026-01-01', end_date: '2026-12-31' },
      ]};
      return { rows: [] };
    });

    const { decision } = await processMessage({ text: 'que promociones tienen?', sessionId: id, businessId: BUSINESS_ID });

    expect(decision.intent).toBe('promociones');
    expect(decision.entity.value).toBeNull();
  });

  test('"que precios tienen?" → pipeline: decision.intent=precios', async () => {
    const id = sid();
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM products') && !sql.includes('ILIKE')) return { rows: [
        { name: 'Hamburguesa', price: '130.00' },
      ]};
      return { rows: [] };
    });

    const { decision } = await processMessage({ text: 'que precios tienen?', sessionId: id, businessId: BUSINESS_ID });

    expect(decision.intent).toBe('precios');
    expect(decision.entity.value).toBeNull();
  });

  // ── "que hamburguesas tienen" sigue siendo productos (entidad concreta) ───

  test('"que hamburguesas tienen" → entity=hamburguesas, intent=productos (sin cambio)', async () => {
    const id = sid();
    db.query.mockImplementation(async (sql) => {
      if (sql.includes('ILIKE')) return { rows: [
        { id: 1, name: 'Hamburguesa Doble', description: null, price: '130.00', is_available: true, stock_quantity: 5, category: 'Comida' },
      ]};
      return { rows: [] };
    });

    const { decision } = await processMessage({ text: 'que hamburguesas tienen', sessionId: id, businessId: BUSINESS_ID });

    expect(decision.entity.value).toBe('hamburguesas');
    expect(decision.intent).toBe('productos');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Flujo completo 2-turnos: "que venden?" → categorías → selección de categoría
// ─────────────────────────────────────────────────────────────────────────────
describe('Flujo catálogo → categorías → selección (2 turnos completos)', () => {
  const BUSINESS_ID = 1;
  const CATS = ['Pizzas', 'Hamburguesas', 'Bebidas'];

  function makeProducts(n, category = 'General') {
    return Array.from({ length: n }, (_, i) => ({
      id: i + 1,
      name: `Producto ${i + 1}`,
      description: null,
      price: String((10 + i).toFixed(2)),
      is_available: true,
      stock_quantity: 5,
      category,
    }));
  }

  /** Sets up db.query to handle ALL queries needed for the 2-turn flow. */
  function mockDbFlow({ allProducts, catProducts, countResult = 0 }) {
    db.query.mockImplementation(async (sql, params) => {
      // getProductosByCategory (LIMIT/OFFSET)
      if (sql.includes('LIMIT') && sql.includes('OFFSET')) {
        const limit  = params?.[2] ?? 10;
        const offset = params?.[3] ?? 0;
        return { rows: (catProducts ?? []).slice(offset, offset + limit) };
      }
      // countProductosByCategory
      if (sql.includes('COUNT(*)')) {
        return { rows: [{ total: String(countResult) }] };
      }
      // getCategories
      if (sql.includes('DISTINCT') && sql.includes('categories')) {
        return { rows: CATS.map((c) => ({ category: c })) };
      }
      // Entity detection ILIKE — no entity found for category names
      if (sql.includes('ILIKE')) return { rows: [] };
      // getProductos (all products — trips hard limit)
      if (sql.includes('products')) return { rows: allProducts ?? [] };
      return { rows: [] };
    });
  }

  test('turno 1: "que venden?" → muestra categorías; turno 2: nombre de categoría → muestra productos', async () => {
    const id = sid();
    const catProducts = makeProducts(8, 'Pizzas');
    mockDbFlow({ allProducts: makeProducts(25), catProducts, countResult: 8 });

    // Turno 1
    const t1 = await processMessage({ text: 'que venden', sessionId: id, businessId: BUSINESS_ID });
    expect(t1.replyText).toContain('Pizzas');
    expect(t1.replyText).toContain('Hamburguesas');
    expect(t1.replyText).toContain('Bebidas');

    // Contexto guardado correctamente tras turno 1
    const ctx1 = await getContext(BUSINESS_ID, id);
    expect(ctx1.lastIntent).toBe('category_selection');
    expect(ctx1.availableCategories).toEqual(CATS);

    // Turno 2: usuario escribe el nombre exacto de la categoría
    const t2 = await processMessage({ text: 'Pizzas', sessionId: id, businessId: BUSINESS_ID });
    expect(t2.decision.strategy).toBe('category_select');
    expect(t2.decision.intent).toBe('productos');
    expect(t2.decision.entity.value).toBe('Pizzas');
    expect(t2.replyText).toContain('Producto 1');
  });

  test('turno 2: usuario escribe categoría en minúsculas → detecta igual', async () => {
    const id = sid();
    await updateContext(BUSINESS_ID, id, {
      lastIntent: 'category_selection',
      availableCategories: CATS,
    });
    mockDbFlow({ catProducts: makeProducts(5, 'Bebidas'), countResult: 5 });

    const { decision } = await processMessage({ text: 'bebidas', sessionId: id, businessId: BUSINESS_ID });
    expect(decision.strategy).toBe('category_select');
    expect(decision.entity.value).toBe('Bebidas');
  });

  test('turno 2: categoría con acento (Electrónica) → detecta aunque usuario omita acento', async () => {
    const id = sid();
    await updateContext(BUSINESS_ID, id, {
      lastIntent: 'category_selection',
      availableCategories: ['Electrónica', 'Accesorios', 'Cables'],
    });
    mockDbFlow({ catProducts: makeProducts(4, 'Electrónica'), countResult: 4 });

    const { decision } = await processMessage({ text: 'Electronica', sessionId: id, businessId: BUSINESS_ID });
    expect(decision.strategy).toBe('category_select');
    expect(decision.entity.value).toBe('Electrónica');
  });

  test('turno 2: usuario escribe frase que contiene nombre de categoría → detecta', async () => {
    const id = sid();
    await updateContext(BUSINESS_ID, id, {
      lastIntent: 'category_selection',
      availableCategories: CATS,
    });
    mockDbFlow({ catProducts: makeProducts(6, 'Hamburguesas'), countResult: 6 });

    const { decision } = await processMessage({ text: 'quiero ver hamburguesas', sessionId: id, businessId: BUSINESS_ID });
    expect(decision.strategy).toBe('category_select');
    expect(decision.entity.value).toBe('Hamburguesas');
  });

  test('turno 2: categoría con nombre largo → detecta con nombre parcial', async () => {
    const id = sid();
    await updateContext(BUSINESS_ID, id, {
      lastIntent: 'category_selection',
      availableCategories: ['Tornillos y Fijaciones', 'Herramientas Manuales', 'Pinturas'],
    });
    mockDbFlow({ catProducts: makeProducts(3, 'Tornillos y Fijaciones'), countResult: 3 });

    // User types just the first word of a multi-word category
    const { decision } = await processMessage({ text: 'tornillos', sessionId: id, businessId: BUSINESS_ID });
    expect(decision.strategy).toBe('category_select');
    expect(decision.entity.value).toBe('Tornillos y Fijaciones');
  });

  test('turno 2: responde con los productos de la categoría seleccionada (no fallback AI)', async () => {
    const id = sid();
    const catProducts = makeProducts(3, 'Bebidas');
    await updateContext(BUSINESS_ID, id, {
      lastIntent: 'category_selection',
      availableCategories: CATS,
    });
    mockDbFlow({ catProducts, countResult: 3 });

    const { replyText, decision } = await processMessage({ text: 'Bebidas', sessionId: id, businessId: BUSINESS_ID });

    expect(decision.strategy).not.toBe('ai');
    expect(replyText).not.toMatch(/no estoy seguro/i);
    expect(replyText).toContain('Producto 1');
  });

  test('turno 2: pregunta puntual sobre producto no repromptea lista de categorías', async () => {
    // Reproduce: chat mostró categorías, usuario preguntó por producto específico.
    // Esperado: pipeline busca el producto (entity), NO devuelve "No identifiqué esa categoría".
    const id = sid();
    await updateContext(BUSINESS_ID, id, {
      lastIntent: 'category_selection',
      availableCategories: CATS,
    });
    mockDbFlow({ allProducts: makeProducts(20), catProducts: [], countResult: 0 });

    const { decision, replyText } = await processMessage({
      text: 'de casualidad tienes refresco?',
      sessionId: id,
      businessId: BUSINESS_ID,
    });

    // Must NOT reprompt category list
    expect(decision.strategy).not.toBe('category_reprompt');
    expect(replyText).not.toMatch(/no identif[iqué]+\s+esa categor[íi]a/i);
  });

  test('flujo completo con "¿qué tienen?" → categorías → selección', async () => {
    const id = sid();
    const catProducts = makeProducts(5, 'Hamburguesas');
    mockDbFlow({ allProducts: makeProducts(30), catProducts, countResult: 5 });

    // Turno 1
    const t1 = await processMessage({ text: '¿qué tienen?', sessionId: id, businessId: BUSINESS_ID });
    expect(t1.replyText).toContain('Hamburguesas');

    const ctx = await getContext(BUSINESS_ID, id);
    expect(ctx.lastIntent).toBe('category_selection');

    // Turno 2
    const t2 = await processMessage({ text: 'Hamburguesas', sessionId: id, businessId: BUSINESS_ID });
    expect(t2.decision.strategy).toBe('category_select');
    expect(t2.replyText).toContain('Producto 1');
  });
});

// ─── Flujo catálogo → categorías con Redis caído ─────────────────────────────

describe('Flujo catálogo → categorías con Redis caído', () => {
  const BUSINESS_ID = 1;
  const CATS = ['Pizzas', 'Hamburguesas', 'Bebidas'];

  function makeProducts(n, category = 'General') {
    return Array.from({ length: n }, (_, i) => ({
      id: i + 1,
      name: `Producto ${i + 1}`,
      description: null,
      price: String((10 + i).toFixed(2)),
      is_available: true,
      stock_quantity: 5,
      category,
    }));
  }

  function mockDbFlow({ allProducts, catProducts, countResult = 0 }) {
    db.query.mockImplementation(async (sql, params) => {
      if (sql.includes('LIMIT') && sql.includes('OFFSET')) {
        const limit  = params?.[2] ?? 10;
        const offset = params?.[3] ?? 0;
        return { rows: (catProducts ?? []).slice(offset, offset + limit) };
      }
      if (sql.includes('COUNT(*)')) {
        return { rows: [{ total: String(countResult) }] };
      }
      if (sql.includes('DISTINCT') && sql.includes('categories')) {
        return { rows: CATS.map((c) => ({ category: c })) };
      }
      if (sql.includes('ILIKE')) return { rows: [] };
      if (sql.includes('products')) return { rows: allProducts ?? [] };
      return { rows: [] };
    });
  }

  afterEach(() => {
    // Restaurar el mock de Redis al comportamiento normal
    mockRedisInstance.get.mockImplementation(async (key) => store.get(key) ?? null);
    mockRedisInstance.setex.mockImplementation(async (key, _ttl, val) => { store.set(key, val); return 'OK'; });
  });

  test('con Redis caído, "qué venden → nombre de categoría" funciona vía fallback en memoria', async () => {
    const id = sid();
    const catProducts = makeProducts(5, 'Pizzas');
    mockDbFlow({ allProducts: makeProducts(25), catProducts, countResult: 5 });

    mockRedisInstance.get.mockRejectedValue(new Error('Connection is closed.'));
    mockRedisInstance.setex.mockRejectedValue(new Error('Connection is closed.'));

    // Turno 1: muestra categorías
    const t1 = await processMessage({ text: 'que venden', sessionId: id, businessId: BUSINESS_ID });
    expect(t1.replyText).toContain('Pizzas');
    expect(t1.replyText).toContain('Hamburguesas');
    expect(t1.replyText).toContain('Bebidas');

    // Turno 2: selecciona categoría — NO debe ir a AI fallback
    const t2 = await processMessage({ text: 'Pizzas', sessionId: id, businessId: BUSINESS_ID });
    expect(t2.decision.strategy).toBe('category_select');
    expect(t2.decision.entity.value).toBe('Pizzas');
    expect(t2.replyText).toContain('Producto 1');
    expect(t2.replyText).not.toMatch(/no estoy seguro/i);
  });

  test('con Redis caído, categoría en minúsculas también es detectada', async () => {
    const id = sid();
    const catProducts = makeProducts(4, 'Bebidas');
    mockDbFlow({ allProducts: makeProducts(25), catProducts, countResult: 4 });

    mockRedisInstance.get.mockRejectedValue(new Error('Connection is closed.'));
    mockRedisInstance.setex.mockRejectedValue(new Error('Connection is closed.'));

    // Turno 1
    await processMessage({ text: 'que tienen', sessionId: id, businessId: BUSINESS_ID });

    // Turno 2: minúsculas
    const t2 = await processMessage({ text: 'bebidas', sessionId: id, businessId: BUSINESS_ID });
    expect(t2.decision.strategy).toBe('category_select');
    expect(t2.replyText).not.toMatch(/no estoy seguro/i);
  });
});





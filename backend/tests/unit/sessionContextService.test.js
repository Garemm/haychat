/**
 * tests/unit/sessionContextService.test.js
 *
 * Unit tests for:
 *   - sessionContextService.getContext()
 *   - sessionContextService.updateContext()
 *
 * ESTRATEGIA DE MOCK:
 *   ioredis se mockea completamente con jest.mock() para que los tests
 *   sean puramente unitarios — sin conexión real a Redis.
 *   El mock implementa el comportamiento de SETEX / GET / TTL con un
 *   Map en memoria, replicando fielmente la interfaz de ioredis.
 */

// ─── Mock de ioredis ─────────────────────────────────────────────────────────
jest.mock('ioredis', () => {
  const _store     = new Map();
  const _listStore = new Map();
  const inst = {
    get:    jest.fn(async (key)             => _store.get(key) ?? null),
    setex:  jest.fn(async (key, _ttl, val)  => { _store.set(key, val); return 'OK'; }),
    rpush:  jest.fn(async (key, val)        => { const l = _listStore.get(key) || []; l.push(val); _listStore.set(key, l); return l.length; }),
    lrange: jest.fn(async (key, s, e)       => { const l = _listStore.get(key) || []; return e === -1 ? l.slice(s) : l.slice(s, e + 1); }),
    expire: jest.fn(async ()                => 1),
    on:     jest.fn(),
  };
  // Populate global refs so test code can access them after module load
  global.__scsStore     = _store;
  global.__scsListStore = _listStore;
  global.__scsInstance  = inst;
  return jest.fn().mockImplementation(() => inst);
});

import { getContext, updateContext, EMPTY_CONTEXT } from '../../src/services/sessionContextService.js';

// Global refs are populated by the factory which runs during module load above
var store             = global.__scsStore;
var listStore         = global.__scsListStore;
var mockRedisInstance = global.__scsInstance;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** businessId fijo para todos los tests. */
const BIZ = 1;

/** Genera un sessionId único por test para evitar contaminación entre tests. */
const sid = (label) => `test-session-${label}-${Date.now()}`;

beforeEach(() => {
  store.clear();
  listStore.clear();
  jest.clearAllMocks();
});

// ─── getContext() ─────────────────────────────────────────────────────────────

describe('getContext()', () => {
  test('devuelve estructura con todos los campos en null para sesión nueva', async () => {
    const ctx = await getContext(BIZ, sid('new'));
    expect(ctx).toEqual({
      lastIntent:       null,
      lastEntity:       { type: null, value: null },
      lastAttributes:   null,
      updatedAt:        null,
      topicMemory:      [],
      rejectedEntities: [],
    });
  });

  test('lee desde la clave "ctx:{businessId}:{sessionId}"', async () => {
    const id = sid('key-format');
    store.set(`ctx:${BIZ}:${id}`, JSON.stringify({
      lastIntent: 'horarios',
      lastEntity: { type: null, value: null },
      updatedAt: '2026-01-01',
    }));
    await getContext(BIZ, id);
    expect(mockRedisInstance.get).toHaveBeenCalledWith(`ctx:${BIZ}:${id}`);
  });

  test('devuelve el contexto guardado previamente', async () => {
    const id = sid('existing');
    const ctx = {
      lastIntent: 'precios',
      lastEntity: { type: 'product', value: 'pizza' },
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    store.set(`ctx:${BIZ}:${id}`, JSON.stringify(ctx));
    expect(await getContext(BIZ, id)).toEqual(ctx);
  });

  test('devuelve null-context si Redis devuelve JSON inválido (resiliencia)', async () => {
    const id = sid('bad-json');
    store.set(`ctx:${BIZ}:${id}`, 'not-a-json-string{{');
    const ctx = await getContext(BIZ, id);
    expect(ctx).toEqual(EMPTY_CONTEXT);
  });

  test('devuelve null-context cuando Redis lanza excepción (degradación elegante)', async () => {
    mockRedisInstance.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const ctx = await getContext(BIZ, sid('redis-down'));
    expect(ctx).toEqual(EMPTY_CONTEXT);
  });

  test('migrates old format { lastProduct } → { lastEntity: { type, value } }', async () => {
    const id = sid('migrate');
    store.set(`ctx:${BIZ}:${id}`, JSON.stringify({
      lastIntent: 'precios',
      lastProduct: 'hamburguesa',
      lastEntities: {},
      updatedAt: '2026-01-01',
    }));
    const ctx = await getContext(BIZ, id);
    expect(ctx.lastEntity).toEqual({ type: 'product', value: 'hamburguesa' });
    expect(ctx.lastProduct).toBeUndefined();
    expect(ctx.lastEntities).toBeUndefined();
  });

  test('migrates old format with null lastProduct', async () => {
    const id = sid('migrate-null');
    store.set(`ctx:${BIZ}:${id}`, JSON.stringify({
      lastIntent: 'horarios',
      lastProduct: null,
      lastEntities: {},
      updatedAt: '2026-01-01',
    }));
    const ctx = await getContext(BIZ, id);
    expect(ctx.lastEntity).toEqual({ type: null, value: null });
  });
});

// ─── updateContext() ──────────────────────────────────────────────────────────

describe('updateContext()', () => {
  test('guarda el contexto con SETEX y la clave correcta', async () => {
    const id = sid('setex');
    await updateContext(BIZ, id, { lastIntent: 'horarios' });
    expect(mockRedisInstance.setex).toHaveBeenCalledTimes(1);
    const lastCall = mockRedisInstance.setex.mock.calls.find(([k]) => k === `ctx:${BIZ}:${id}`);
    expect(lastCall).toBeDefined();
    expect(lastCall[0]).toBe(`ctx:${BIZ}:${id}`);
    expect(lastCall[1]).toBe(600); // TTL exacto
  });

  test('el TTL es exactamente 600 segundos', async () => {
    const id = sid('ttl');
    await updateContext(BIZ, id, { lastIntent: 'precios' });
    const setexCall = mockRedisInstance.setex.mock.calls.find(([k]) => k === `ctx:${BIZ}:${id}`);
    expect(setexCall[1]).toBe(600);
  });

  test('hace MERGE con el contexto previo (no sobreescribe campos no enviados)', async () => {
    const id = sid('merge');
    // Contexto inicial
    await updateContext(BIZ, id, { lastIntent: 'horarios', lastEntity: { type: null, value: null } });
    // Actualización parcial: solo lastEntity
    await updateContext(BIZ, id, { lastEntity: { type: 'product', value: 'hamburguesa doble' } });
    const ctx = await getContext(BIZ, id);
    // lastIntent debe conservarse del turno anterior
    expect(ctx.lastIntent).toBe('horarios');
    expect(ctx.lastEntity).toEqual({ type: 'product', value: 'hamburguesa doble' });
  });

  test('agrega updatedAt con formato ISO 8601', async () => {
    const id = sid('timestamp');
    await updateContext(BIZ, id, { lastIntent: 'ubicacion' });
    const ctx = await getContext(BIZ, id);
    expect(ctx.updatedAt).toBeDefined();
    expect(new Date(ctx.updatedAt).toISOString()).toBe(ctx.updatedAt);
  });

  test('updatedAt se renueva con cada actualización', async () => {
    const id = sid('ts-renew');
    await updateContext(BIZ, id, { lastIntent: 'horarios' });
    const first = (await getContext(BIZ, id)).updatedAt;
    await new Promise((r) => setTimeout(r, 5));
    await updateContext(BIZ, id, { lastEntity: { type: 'product', value: 'pozole' } });
    const second = (await getContext(BIZ, id)).updatedAt;
    expect(second >= first).toBe(true);
  });

  test('no lanza excepción cuando Redis falla (degradación elegante)', async () => {
    mockRedisInstance.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(updateContext(BIZ, sid('redis-down'), { lastIntent: 'precios' })).resolves.toBeUndefined();
  });

  test('guarda correctamente lastEntity con nulls (reset)', async () => {
    const id = sid('null-entity');
    await updateContext(BIZ, id, {
      lastIntent: 'productos',
      lastEntity: { type: 'product', value: 'pizza' },
    });
    await updateContext(BIZ, id, { lastEntity: { type: null, value: null } });
    const ctx = await getContext(BIZ, id);
    expect(ctx.lastEntity).toEqual({ type: null, value: null });
  });

  test('guarda correctamente un contexto completo', async () => {
    const id = sid('full');
    await updateContext(BIZ, id, {
      lastIntent: 'precios',
      lastEntity: { type: 'product', value: 'hamburguesa doble' },
    });
    const ctx = await getContext(BIZ, id);
    expect(ctx.lastIntent).toBe('precios');
    expect(ctx.lastEntity).toEqual({ type: 'product', value: 'hamburguesa doble' });
  });
});

// ─── Flujo conversacional completo ───────────────────────────────────────────

describe('flujo conversacional — múltiples turnos', () => {
  test('simula 3 turnos de conversación con herencia de contexto', async () => {
    const id = sid('conversation');

    // Turno 1: pregunta por un producto
    await updateContext(BIZ, id, { lastIntent: null, lastEntity: { type: 'product', value: 'hamburguesa doble' } });
    let ctx = await getContext(BIZ, id);
    expect(ctx.lastEntity).toEqual({ type: 'product', value: 'hamburguesa doble' });
    expect(ctx.lastIntent).toBeNull();

    // Turno 2: pregunta de seguimiento sobre precio
    await updateContext(BIZ, id, { lastIntent: 'precios' });
    ctx = await getContext(BIZ, id);
    // La entidad del turno 1 debe conservarse
    expect(ctx.lastEntity).toEqual({ type: 'product', value: 'hamburguesa doble' });
    expect(ctx.lastIntent).toBe('precios');

    // Turno 3: cambia de tema
    await updateContext(BIZ, id, { lastIntent: 'horarios', lastEntity: { type: null, value: null } });
    ctx = await getContext(BIZ, id);
    expect(ctx.lastIntent).toBe('horarios');
    expect(ctx.lastEntity).toEqual({ type: null, value: null });
  });
});

// ─── Fallback en memoria — Redis caído ───────────────────────────────────────

describe('Fallback en memoria — flujo con Redis caído', () => {
  afterEach(() => {
    // Restaurar el mock de Redis al comportamiento normal
    mockRedisInstance.get.mockImplementation(async (key) => store.get(key) ?? null);
    mockRedisInstance.setex.mockImplementation(async (key, _ttl, val) => { store.set(key, val); return 'OK'; });
    mockRedisInstance.rpush.mockImplementation(async (key, val) => { const l = listStore.get(key) || []; l.push(val); listStore.set(key, l); return l.length; });
    mockRedisInstance.lrange.mockImplementation(async (key, s, e) => { const l = listStore.get(key) || []; return e === -1 ? l.slice(s) : l.slice(s, e + 1); });
    mockRedisInstance.expire.mockImplementation(async () => 1);
  });

  test('cuando Redis falla al guardar, el contexto se preserva en el fallback en memoria', async () => {
    mockRedisInstance.get.mockRejectedValue(new Error('Connection is closed.'));
    mockRedisInstance.setex.mockRejectedValue(new Error('Connection is closed.'));

    const id = sid('mem-save');
    await updateContext(BIZ, id, { lastIntent: 'category_selection', availableCategories: ['Bebidas', 'Pizzas'] });

    const ctx = await getContext(BIZ, id);
    expect(ctx.lastIntent).toBe('category_selection');
    expect(ctx.availableCategories).toEqual(['Bebidas', 'Pizzas']);
  });

  test('cuando Redis falla, el merge de múltiples turnos se hereda correctamente', async () => {
    mockRedisInstance.get.mockRejectedValue(new Error('Connection is closed.'));
    mockRedisInstance.setex.mockRejectedValue(new Error('Connection is closed.'));

    const id = sid('mem-chain');

    // Turno 1 — categorías
    await updateContext(BIZ, id, {
      lastIntent: 'category_selection',
      availableCategories: ['Pizzas', 'Bebidas'],
    });

    // Turno 2 — selección (merge con turno 1)
    await updateContext(BIZ, id, { lastEntity: { type: 'category', value: 'Pizzas' } });

    const ctx = await getContext(BIZ, id);
    expect(ctx.lastIntent).toBe('category_selection');
    expect(ctx.availableCategories).toEqual(['Pizzas', 'Bebidas']);
    expect(ctx.lastEntity).toEqual({ type: 'category', value: 'Pizzas' });
  });

  test('cuando Redis se recupera, las siguientes escrituras se guardan en Redis sin errores', async () => {
    // Primer turno: Redis caído
    mockRedisInstance.get.mockRejectedValue(new Error('Connection is closed.'));
    mockRedisInstance.setex.mockRejectedValue(new Error('Connection is closed.'));

    const id = sid('mem-recover');
    // No debe lanzar excepción aunque Redis esté caído
    await expect(updateContext(BIZ, id, { lastIntent: 'category_selection' })).resolves.toBeUndefined();

    // Redis se recupera
    mockRedisInstance.get.mockImplementation(async (key) => store.get(key) ?? null);
    mockRedisInstance.setex.mockImplementation(async (key, _ttl, val) => { store.set(key, val); return 'OK'; });

    // Después de la recuperación, las escrituras funcionan normalmente
    await updateContext(BIZ, id, { lastIntent: 'productos' });
    const ctx = await getContext(BIZ, id);
    expect(ctx.lastIntent).toBe('productos');
  });
});

import { formatIntentResponse } from '../../src/services/intentResponseFormatter.js';

// ─── Helper fixtures ──────────────────────────────────────────────────────────

const HORARIOS_ROWS = [
  { day_of_week: 1, open_time: '08:00:00', close_time: '20:00:00', is_closed: false }, // Lunes
  { day_of_week: 5, open_time: '09:00:00', close_time: '23:00:00', is_closed: false }, // Viernes
  { day_of_week: 0, open_time: null,        close_time: null,        is_closed: true  }, // Domingo
];

const PRODUCTOS_ROWS = [
  { name: 'Hamburguesa Doble', category: 'Hamburguesas', price: '150.00', is_available: true,  stock_quantity: 30   },
  { name: 'Refresco',          category: 'Bebidas',       price: '25.00',  is_available: true,  stock_quantity: null },
];

const PRECIOS_ROWS = [
  { name: 'Pozole Rojo',  price: '110.00' },
  { name: 'Agua Mineral', price: '20.00'  },
];

const PROMOCIONES_ROWS = [
  {
    title: '2x1 Martes',
    discount_type: 'percentage',
    discount_value: '50',
    end_date: '2025-12-31',
    description: 'Solo en pastor',
  },
  {
    title: 'Combo Familiar',
    discount_type: 'fixed',
    discount_value: '30.00',
    end_date: '2025-11-30',
    description: null,
  },
];

const UBICACION_ROW = {
  name: 'Restaurante Don Pepe',
  city: 'Ciudad de México',
  description: 'Av. Insurgentes Sur 1234, Col. Del Valle',
};

// ─── horarios formatter ───────────────────────────────────────────────────────

describe('formatIntentResponse("horarios", ...)', () => {
  test('contains day names in plain text (no emojis)', () => {
    const result = formatIntentResponse('horarios', HORARIOS_ROWS);
    expect(result).toContain('Lunes');
    expect(result).toContain('Viernes');
    expect(result).toContain('Domingo');
    expect(result).not.toMatch(/🕐|🔒|📅/);
  });

  test('mentions closed day in natural sentence', () => {
    const result = formatIntentResponse('horarios', HORARIOS_ROWS);
    expect(result.toLowerCase()).toContain('cerrados');
    expect(result.toLowerCase()).toContain('domingo');
  });

  test('formats an AM open time correctly', () => {
    const result = formatIntentResponse('horarios', HORARIOS_ROWS);
    expect(result).toContain('8:00 am');
  });

  test('formats a PM close time correctly', () => {
    const result = formatIntentResponse('horarios', HORARIOS_ROWS);
    expect(result).toContain('8:00 pm'); // 20:00 → 8:00 pm
  });

  test('uses 12 for midnight (00:00)', () => {
    const row = [{ day_of_week: 6, open_time: '00:00:00', close_time: '03:00:00', is_closed: false }];
    const result = formatIntentResponse('horarios', row);
    expect(result).toContain('12:00 am');
  });

  test('uses 12 for noon (12:00)', () => {
    const row = [{ day_of_week: 3, open_time: '12:00:00', close_time: '14:00:00', is_closed: false }];
    const result = formatIntentResponse('horarios', row);
    expect(result).toContain('12:00 pm');
  });

  test('returns fallback for empty rows', () => {
    const result = formatIntentResponse('horarios', []);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(10);
  });

  test('returns fallback for null input', () => {
    const result = formatIntentResponse('horarios', null);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(10);
  });

  test('response is plain text — no bullet points or markdown', () => {
    const result = formatIntentResponse('horarios', HORARIOS_ROWS);
    expect(result).not.toContain('•');
    expect(result).not.toContain('*');
    expect(result).not.toContain('—');
  });
});

// ─── productos formatter ──────────────────────────────────────────────────────

describe('formatIntentResponse("productos", ...)', () => {
  test('lists product names in natural language', () => {
    const result = formatIntentResponse('productos', PRODUCTOS_ROWS);
    expect(result).toContain('Hamburguesa Doble');
    expect(result).toContain('Refresco');
  });

  test('does NOT include stock count (not requested)', () => {
    const result = formatIntentResponse('productos', PRODUCTOS_ROWS);
    expect(result).not.toContain('stock');
    expect(result).not.toContain('30');
  });

  test('response has no forbidden emojis or bullet points', () => {
    const result = formatIntentResponse('productos', PRODUCTOS_ROWS);
    // 😊 is intentionally allowed; use u flag so emoji don’t share surrogate matches
    expect(result).not.toMatch(/[📦📁✅❌•]/u);
    expect(result).not.toContain('*');
    expect(result).not.toContain('—');
  });

  test('offers to continue with a question', () => {
    const result = formatIntentResponse('productos', PRODUCTOS_ROWS);
    expect(result).toMatch(/\?/);
  });

  test('skips stock when stock_quantity is null (always)', () => {
    const rows = [{ name: 'Agua', category: null, price: '20.00', is_available: true, stock_quantity: null }];
    const result = formatIntentResponse('productos', rows);
    expect(result).not.toContain('stock');
  });

  test('shows max 3 items when many products', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      name: `Producto ${i + 1}`, category: 'Cat', price: '10.00', is_available: true, stock_quantity: 5,
    }));
    const result = formatIntentResponse('productos', rows);
    // Should mention "entre otros" for large sets
    expect(result).toMatch(/entre otros/i);
  });

  test('returns fallback for empty rows', () => {
    const result = formatIntentResponse('productos', []);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(10);
  });
});

// ─── precios formatter ────────────────────────────────────────────────────────

describe('formatIntentResponse("precios", ...)', () => {
  test('lists product names and prices as natural sentence', () => {
    const result = formatIntentResponse('precios', PRECIOS_ROWS);
    expect(result).toContain('Pozole Rojo');
    expect(result).toContain('$110.00');
    expect(result).toContain('Agua Mineral');
    expect(result).toContain('$20.00');
  });

  test('response has no forbidden emojis or bullet points', () => {
    const result = formatIntentResponse('precios', PRECIOS_ROWS);
    expect(result).not.toMatch(/[💲•]/u);
    expect(result).not.toContain('*');
  });

  test('returns fallback for empty rows', () => {
    const result = formatIntentResponse('precios', []);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(10);
  });
});

// ─── promociones formatter ────────────────────────────────────────────────────

describe('formatIntentResponse("promociones", ...)', () => {
  test('shows percentage discount correctly', () => {
    const result = formatIntentResponse('promociones', PROMOCIONES_ROWS);
    expect(result).toContain('50% de descuento');
  });

  test('shows fixed discount correctly', () => {
    const result = formatIntentResponse('promociones', PROMOCIONES_ROWS);
    expect(result).toContain('$30.00 de descuento');
  });

  test('includes promo title and end date', () => {
    const result = formatIntentResponse('promociones', PROMOCIONES_ROWS);
    expect(result).toContain('2x1 Martes');
    expect(result).toContain('2025-12-31');
  });

  test('includes description when present', () => {
    const result = formatIntentResponse('promociones', PROMOCIONES_ROWS);
    expect(result).toContain('Solo en pastor');
  });

  test('response has no forbidden emojis or bullet points', () => {
    const result = formatIntentResponse('promociones', PROMOCIONES_ROWS);
    expect(result).not.toMatch(/[🎉•✅❌]/u);
    expect(result).not.toContain('*');
  });

  test('returns fallback for empty rows', () => {
    expect(formatIntentResponse('promociones', [])).toMatch(/no hay promociones/i);
  });
});

// ─── ubicacion formatter ──────────────────────────────────────────────────────

describe('formatIntentResponse("ubicacion", ...)', () => {
  test('shows city', () => {
    const result = formatIntentResponse('ubicacion', UBICACION_ROW);
    expect(result).toContain('Ciudad de México');
  });

  test('shows business name', () => {
    const result = formatIntentResponse('ubicacion', UBICACION_ROW);
    expect(result).toContain('Restaurante Don Pepe');
  });

  test('shows the address/description', () => {
    const result = formatIntentResponse('ubicacion', UBICACION_ROW);
    expect(result).toContain('Insurgentes');
  });

  test('response has no forbidden emojis or bullet points', () => {
    const result = formatIntentResponse('ubicacion', UBICACION_ROW);
    expect(result).not.toMatch(/[📍•✅❌]/u);
    expect(result).not.toContain('*');
  });

  test('returns fallback for null input', () => {
    const result = formatIntentResponse('ubicacion', null);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(10);
  });
});

// ─── Unknown intent ───────────────────────────────────────────────────────────

describe('formatIntentResponse() — unknown intent', () => {
  test('returns safe fallback string for unrecognised intent', () => {
    const result = formatIntentResponse('unknown_intent', []);
    expect(typeof result).toBe('string');
    expect(result).toContain('unknown_intent');
  });
});

// ─── Voice optimization checks ───────────────────────────────────────────────

describe('voice optimization — all formatters produce clean text', () => {
  // 😊 (U+1F60A) is intentionally allowed as a single friendly emoji per response.
  // All other emoji in the heavy-emoji Unicode blocks are forbidden.
  const EMOJI_RE = /[\u{1F300}-\u{1FFFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/u;

  test.each([
    ['horarios',    HORARIOS_ROWS],
    ['productos',   PRODUCTOS_ROWS],
    ['precios',     PRECIOS_ROWS],
    ['promociones', PROMOCIONES_ROWS],
    ['ubicacion',   UBICACION_ROW],
  ])('%s formatter produces no forbidden emojis', (intent, data) => {
    const result = formatIntentResponse(intent, data);
    // Strip the one allowed emoji (😊) before asserting
    const stripped = result.replace(/\u{1F60A}/gu, '');
    expect(stripped).not.toMatch(EMOJI_RE);
  });

  test.each([
    ['horarios',    HORARIOS_ROWS],
    ['productos',   PRODUCTOS_ROWS],
    ['precios',     PRECIOS_ROWS],
    ['promociones', PROMOCIONES_ROWS],
    ['ubicacion',   UBICACION_ROW],
  ])('%s formatter has no bullet points', (intent, data) => {
    const result = formatIntentResponse(intent, data);
    expect(result).not.toContain('•');
  });
});


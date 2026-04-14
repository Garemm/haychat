jest.mock('../../src/config/database', () => ({
  query: jest.fn(),
}));

import db from '../../src/config/database.js';
import {
  detectEntities,
  extractEntityCandidate,
  formatProductResponse,
  formatCategoryResponse,
  isBlocklisted,
  stripLeadingStopwords,
} from '../../src/services/entityDetector.js';
import { normalize } from '../../src/services/normalize.js';

beforeEach(() => {
  db.query.mockReset();
});

// ─── extractEntityCandidate() ─────────────────────────────────────────────────

describe('extractEntityCandidate()', () => {

  describe('regex patterns — should extract entity', () => {
    const CASES = [
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
      ['me interesa el mole poblano',       'mole poblano'],
      ['info de la pizza margarita',        'pizza margarita'],
      // verifacación de disponibilidad en stock
      ['esta disponible la pizza',             'pizza'],
      ['estan disponibles las hamburguesas',   'hamburguesas'],
      ['hay stock de cuadernos',               'cuadernos'],
      ['hay stock de laptop gamer',            'laptop gamer'],
      ['tienes disponibilidad de agua mineral','agua mineral'],
      ['tienen disponibilidad de la birria',   'birria'],
      // verbo "tiene" (singular tercera persona) — casos del bug crítico
      ['tiene hamburguesa',                    'hamburguesa'],
      ['tiene hamburguesa bbq',                'hamburguesa bbq'],
      ['tiene la hamburguesa mexicana',        'hamburguesa mexicana'],
      ['tienen hamburguesas',                  'hamburguesas'],
      ['tienes pizza mexicana',                'pizza mexicana'],
      // verbs: vende/vendes/venden
      ['vendes agua de horchata',           'agua de horchata'],
      ['venden laptops',                    'laptops'],
      ['vende tacos de pastor',             'tacos de pastor'],
      // verbs: ofrece/ofrecen
      ['ofrecen paquetes escolares',         'paquetes escolares'],
      ['ofrece la laptop gamer',            'laptop gamer'],
      // verb: necesito
      ['necesito un cuaderno',              'cuaderno'],
      // precio [product] — bare price query (no "de")
      ['precio hamburguesa',                'hamburguesa'],
      ['precio agua de horchata',           'agua de horchata'],
      ['precio pozole rojo',                'pozole rojo'],
      // que precio tiene [product]
      ['que precio tiene la hamburguesa',   'hamburguesa'],
      ['que precio tiene el pozole',        'pozole'],
      // cual es el precio de [product]
      ['cual es el precio de la pizza',     'pizza'],
    ];

    test.each(CASES)('"%s" → "%s"', (input, expected) => {
      expect(extractEntityCandidate(input)).toBe(expected);
    });
  });

  describe('blocklist — should return null for generic terms', () => {
    const BLOCKED = [
      'cuantos productos hay',
      'muestrame el menu',
      'hola que tal',
      'gracias',
    ];

    test.each(BLOCKED)('"%s" → null', (input) => {
      expect(extractEntityCandidate(input)).toBeNull();
    });
  });

  describe('trigger word guard — NLP fallback needs trigger', () => {
    test('plain greeting returns null', () => {
      expect(extractEntityCandidate('hola como estas')).toBeNull();
    });

    test('schedule question returns null', () => {
      expect(extractEntityCandidate('cuando abren los domingos')).toBeNull();
    });
  });
});

// ─── isBlocklisted() ──────────────────────────────────────────────────────────

describe('isBlocklisted()', () => {
  test('blocks "producto"', () => {
    expect(isBlocklisted('producto')).toBe(true);
  });

  test('blocks "catalogo"', () => {
    expect(isBlocklisted('catalogo')).toBe(true);
  });

  test('blocks "precio"', () => {
    expect(isBlocklisted('precio')).toBe(true);
  });

  test('does not block real product names', () => {
    expect(isBlocklisted('hamburguesa')).toBe(false);
    expect(isBlocklisted('laptop')).toBe(false);
    expect(isBlocklisted('cuaderno')).toBe(false);
  });
});

// ─── stripLeadingStopwords() ──────────────────────────────────────────────────

describe('stripLeadingStopwords()', () => {
  test('strips "la" from "la hamburguesa"', () => {
    expect(stripLeadingStopwords('la hamburguesa')).toBe('hamburguesa');
  });

  test('strips "el" from "el pozole"', () => {
    expect(stripLeadingStopwords('el pozole')).toBe('pozole');
  });

  test('strips multiple stopwords "un de"', () => {
    expect(stripLeadingStopwords('un de mole')).toBe('mole');
  });

  test('does not strip single-word entities', () => {
    expect(stripLeadingStopwords('pizza')).toBe('pizza');
  });
});

// ─── detectEntities() — DB mocked ────────────────────────────────────────────

describe('detectEntities()', () => {
  const BUSINESS_ID = 1;
  const noIntent = { intent: null, score: 0 };

  test('returns empty entity when no candidate extracted', async () => {
    const result = await detectEntities('cuando abren?', BUSINESS_ID, noIntent);
    expect(result.type).toBeNull();
    expect(result.value).toBeNull();
  });

  test('returns product entity when DB matches', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ id: 1, name: 'Laptop Gamer', description: null, price: '15000', is_available: true, stock_quantity: 5, category: 'Electrónica' }],
    });

    const result = await detectEntities('tienen laptop?', BUSINESS_ID, noIntent);
    expect(result.type).toBe('product');
    expect(result.value).toBe('laptop');
  });

  test('tries category when product has no match', async () => {
    // Product query returns empty
    db.query.mockResolvedValueOnce({ rows: [] });
    // Category query returns match
    db.query.mockResolvedValueOnce({
      rows: [{ id: 5, name: 'Herramientas' }],
    });

    const result = await detectEntities('tienen herramientas?', BUSINESS_ID, noIntent);
    expect(result.type).toBe('category');
    expect(result.value).toBe('herramientas');
  });

  test('returns product attempt even when DB finds nothing', async () => {
    db.query.mockResolvedValue({ rows: [] });

    const result = await detectEntities('tienen xyzzy?', BUSINESS_ID, noIntent);
    // Still returns the candidate as a product attempt with empty rows
    expect(result.type).toBe('product');
    expect(result.value).toBe('xyzzy');
    expect(result._rows).toEqual([]);
  });

  test('is accent-insensitive', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ id: 1, name: 'Pozole Rojo', description: null, price: '110', is_available: true, stock_quantity: 20, category: null }],
    });

    const result = await detectEntities('hay póżolé rojo?', BUSINESS_ID, noIntent);
    expect(result.type).toBe('product');
  });
});

// ─── formatProductResponse() ──────────────────────────────────────────────────

describe('formatProductResponse()', () => {
  test('no products → "no encontré" message', () => {
    const result = formatProductResponse('laptop', []);
    expect(result).toContain('no encontré');
  });

  test('single product shows name, price, and availability', () => {
    const result = formatProductResponse('hamburguesa', [{
      id: 1, name: 'Hamburguesa Doble', description: 'Doble carne', price: '150.00',
      is_available: true, stock_quantity: 30,
    }]);
    expect(result).toContain('Hamburguesa Doble');
    expect(result).toContain('$150.00');
    expect(result).not.toContain('Stock');
    expect(result).not.toContain('✅');
  });

  test('multiple products lists them with count', () => {
    const products = [
      { id: 1, name: 'Pizza Margarita', price: '110.00', is_available: true },
      { id: 2, name: 'Pizza Pepperoni', price: '130.00', is_available: true },
      { id: 3, name: 'Pizza Hawaiana', price: '120.00', is_available: false },
    ];
    const result = formatProductResponse('pizza', products);
    expect(result).toContain('Pizza Margarita');
    expect(result).toContain('Pizza Pepperoni');
    expect(result).not.toContain('✅');
    expect(result).not.toContain('❌');
  });

  test('unavailable product shows not-available message', () => {
    const result = formatProductResponse('pozole', [{
      id: 1, name: 'Pozole', description: null, price: '120.00',
      is_available: false, stock_quantity: 0,
    }]);
    expect(result).not.toContain('❌');
    expect(result).toContain('no está disponible');
  });
});

// ─── formatCategoryResponse() ─────────────────────────────────────────────────

describe('formatCategoryResponse()', () => {
  test('no products → "No encontré" message', () => {
    const result = formatCategoryResponse('papelería', []);
    expect(result).toContain('No encontré');
  });

  test('lists products in category', () => {
    const rows = [
      { id: 1, name: 'Cuaderno 100 hojas', price: '35.00', is_available: true },
      { id: 2, name: 'Cuaderno 200 hojas', price: '55.00', is_available: true },
    ];
    const result = formatCategoryResponse('Cuadernos', rows);
    expect(result).toContain('Cuadernos');
    expect(result).toContain('Cuaderno 100 hojas');
    expect(result).toContain('$35.00');
  });
});

// ─── ñ and underscore normalization ──────────────────────────────────────────

describe('extractEntityCandidate() — ñ y guión bajo', () => {
  test('"que tiene el buñuelo con miel" → extrae "buñuelo con miel"', () => {
    expect(extractEntityCandidate('que tiene el buñuelo con miel')).toBe('buñuelo con miel');
  });

  test('"tienen piñata gigante" → extrae "piñata gigante"', () => {
    expect(extractEntityCandidate('tienen piñata gigante')).toBe('piñata gigante');
  });

  test('"precio del buñuelo" → extrae "buñuelo"', () => {
    expect(extractEntityCandidate('precio del buñuelo')).toBe('buñuelo');
  });

  test('"tienen hamburguesas con guión bajo al final" — guión bajo se ignora', () => {
    // The underscore is stripped by normalize() before detection runs
    // so the entity is extracted cleanly.
    // We call extractEntityCandidate with already-normalized text (as the pipeline does).
    const normalized = normalize('tienen hamburguesas_');
    expect(normalized).toBe('tienen hamburguesas');
    expect(extractEntityCandidate(normalized)).toBe('hamburguesas');
  });

  test('"tienen buñuelos_" — ñ preservada, guión bajo eliminado', () => {
    const normalized = normalize('tienen buñuelos_');
    expect(normalized).toBe('tienen buñuelos');
    expect(extractEntityCandidate(normalized)).toBe('buñuelos');
  });
});

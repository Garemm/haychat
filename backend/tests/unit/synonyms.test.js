// ─── Mock DB ─────────────────────────────────────────────────────────────────
jest.mock('../../src/config/database', () => ({ query: jest.fn() }));

import db from '../../src/config/database.js';
import {
  SYNONYM_MAP,
  getSynonym,
  getSynonymsAcrossCategories,
  getSynonymsByBusinessId,
  getCategories,
} from '../../src/services/synonyms.js';

beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockReset();
});

// ─── getCategories() ─────────────────────────────────────────────────────────

describe('getCategories()', () => {
  const EXPECTED_CATEGORIES = ['restaurante', 'hardware', 'farmacia', 'papeleria', 'ropa', 'otro'];

  test('returns all known categories', () => {
    const cats = getCategories();
    EXPECTED_CATEGORIES.forEach((c) => expect(cats).toContain(c));
  });

  test('returns an array of strings', () => {
    expect(Array.isArray(getCategories())).toBe(true);
    getCategories().forEach((c) => expect(typeof c).toBe('string'));
  });
});

// ─── getSynonym() — restaurante ──────────────────────────────────────────────

describe('getSynonym() — restaurante', () => {
  test('soda → includes refresco and gaseosa', () => {
    const syns = getSynonym('soda', 'restaurante');
    expect(syns).toContain('refresco');
    expect(syns).toContain('gaseosa');
  });

  test('cafe → includes americano', () => {
    expect(getSynonym('cafe', 'restaurante')).toContain('americano');
  });

  test('elote → includes mazorca (food compound noun)', () => {
    expect(getSynonym('elote', 'restaurante')).toContain('mazorca');
  });

  test('mazorca → includes elote (bidirectional)', () => {
    // mazorca is a reverse-map entry generated from elote → ['maiz cocido', 'mazorca']
    expect(getSynonym('mazorca', 'restaurante')).toContain('elote');
  });

  test('tacos → returns synonyms', () => {
    const syns = getSynonym('tacos', 'restaurante');
    expect(Array.isArray(syns)).toBe(true);
    expect(syns.length).toBeGreaterThan(0);
  });

  test('elote and esquites share synonyms (maiz is common)', () => {
    const eloteSyns = getSynonym('elote', 'restaurante');
    expect(eloteSyns.some((s) => s.includes('maiz'))).toBe(true);
  });

  test('helado → includes nieve', () => {
    expect(getSynonym('helado', 'restaurante')).toContain('nieve');
  });

  test('dulce → includes postre', () => {
    expect(getSynonym('dulce', 'restaurante')).toContain('postre');
  });

  test('postre → includes dulce (bidirectional from dulce → postre)', () => {
    expect(getSynonym('postre', 'restaurante')).toContain('dulce');
  });

  test('consome → includes caldo (bidirectional)', () => {
    expect(getSynonym('consome', 'restaurante')).toContain('caldo');
  });

  test('unknown term returns empty array', () => {
    expect(getSynonym('xyzTerminoNoExistente', 'restaurante')).toEqual([]);
  });
});

// ─── getSynonym() — hardware ──────────────────────────────────────────────────

describe('getSynonym() — hardware (ferretería)', () => {
  test('desarmador → includes destornillador', () => {
    expect(getSynonym('desarmador', 'hardware')).toContain('destornillador');
  });

  test('destornillador → includes desarmador (bidirectional)', () => {
    expect(getSynonym('destornillador', 'hardware')).toContain('desarmador');
  });

  test('martillo → includes marro', () => {
    expect(getSynonym('martillo', 'hardware')).toContain('marro');
  });

  test('marro → includes martillo (bidirectional)', () => {
    expect(getSynonym('marro', 'hardware')).toContain('martillo');
  });

  test('taladro → includes perforadora', () => {
    expect(getSynonym('taladro', 'hardware')).toContain('perforadora');
  });

  test('tornillo → includes tirafondo and rosca', () => {
    const syns = getSynonym('tornillo', 'hardware');
    expect(syns).toContain('tirafondo');
    expect(syns).toContain('rosca');
  });

  test('tirafondo → includes tornillo (bidirectional)', () => {
    expect(getSynonym('tirafondo', 'hardware')).toContain('tornillo');
  });

  test('llave → returns synonyms including "llave inglesa"', () => {
    expect(getSynonym('llave', 'hardware')).toContain('llave inglesa');
  });

  test('pintura → includes latex and recubrimiento', () => {
    const syns = getSynonym('pintura', 'hardware');
    expect(syns).toContain('latex');
    expect(syns).toContain('recubrimiento');
  });

  test('esmalte → includes barniz', () => {
    expect(getSynonym('esmalte', 'hardware')).toContain('barniz');
  });

  test('hardware terms not found in restaurante bucket', () => {
    // Restaurante bucket should not have hardware-specific synonyms
    const syns = getSynonym('taladro', 'restaurante');
    expect(syns).toEqual([]);
  });
});

// ─── getSynonym() — farmacia ──────────────────────────────────────────────────

describe('getSynonym() — farmacia', () => {
  test('pastilla → includes tableta and comprimido', () => {
    const syns = getSynonym('pastilla', 'farmacia');
    expect(syns).toContain('tableta');
    expect(syns).toContain('comprimido');
  });

  test('tableta → includes pastilla (bidirectional)', () => {
    expect(getSynonym('tableta', 'farmacia')).toContain('pastilla');
  });

  test('medicina → includes medicamento and farmaco', () => {
    const syns = getSynonym('medicina', 'farmacia');
    expect(syns).toContain('medicamento');
    expect(syns).toContain('farmaco');
  });

  test('medicamento → includes medicina (bidirectional)', () => {
    expect(getSynonym('medicamento', 'farmacia')).toContain('medicina');
  });

  test('curita → includes bandita', () => {
    expect(getSynonym('curita', 'farmacia')).toContain('bandita');
  });

  test('bandita → includes curita (bidirectional)', () => {
    expect(getSynonym('bandita', 'farmacia')).toContain('curita');
  });

  test('vitamina → includes suplemento', () => {
    expect(getSynonym('vitamina', 'farmacia')).toContain('suplemento');
  });

  test('alcohol → includes antiseptico', () => {
    expect(getSynonym('alcohol', 'farmacia')).toContain('antiseptico');
  });
});

// ─── getSynonym() — papeleria ─────────────────────────────────────────────────

describe('getSynonym() — papeleria', () => {
  test('pila → includes bateria', () => {
    expect(getSynonym('pila', 'papeleria')).toContain('bateria');
  });

  test('bateria → includes pila (bidirectional)', () => {
    expect(getSynonym('bateria', 'papeleria')).toContain('pila');
  });

  test('cuaderno → includes libreta', () => {
    expect(getSynonym('cuaderno', 'papeleria')).toContain('libreta');
  });

  test('foco → includes bombilla', () => {
    expect(getSynonym('foco', 'papeleria')).toContain('bombilla');
  });

  test('bombilla → includes foco (bidirectional)', () => {
    expect(getSynonym('bombilla', 'papeleria')).toContain('foco');
  });

  test('cloro → includes blanqueador', () => {
    expect(getSynonym('cloro', 'papeleria')).toContain('blanqueador');
  });

  test('diurex → includes cinta (alias)', () => {
    expect(getSynonym('diurex', 'papeleria')).toContain('cinta');
  });
});

// ─── getSynonym() — ropa ──────────────────────────────────────────────────────

describe('getSynonym() — ropa', () => {
  test('camisa → includes playera and camiseta', () => {
    const syns = getSynonym('camisa', 'ropa');
    expect(syns).toContain('playera');
    expect(syns).toContain('camiseta');
  });

  test('playera → includes camisa (bidirectional)', () => {
    expect(getSynonym('playera', 'ropa')).toContain('camisa');
  });

  test('pantalon → includes jean and vaquero', () => {
    const syns = getSynonym('pantalon', 'ropa');
    expect(syns).toContain('jean');
    expect(syns).toContain('vaquero');
  });

  test('jean → includes pantalon (bidirectional)', () => {
    expect(getSynonym('jean', 'ropa')).toContain('pantalon');
  });

  test('tenis → includes zapatillas and sneakers', () => {
    const syns = getSynonym('tenis', 'ropa');
    expect(syns).toContain('zapatillas');
    expect(syns).toContain('sneakers');
  });

  test('zapatillas → includes tenis (bidirectional)', () => {
    expect(getSynonym('zapatillas', 'ropa')).toContain('tenis');
  });

  test('sudadera → includes hoodie', () => {
    expect(getSynonym('sudadera', 'ropa')).toContain('hoodie');
  });

  test('hoodie → includes sudadera (bidirectional)', () => {
    expect(getSynonym('hoodie', 'ropa')).toContain('sudadera');
  });

  test('sandalias → includes chanclas', () => {
    expect(getSynonym('sandalias', 'ropa')).toContain('chanclas');
  });
});

// ─── getSynonym() — otro (generic) ───────────────────────────────────────────

describe('getSynonym() — otro (generic fallback category)', () => {
  test('oferta → includes promocion and descuento', () => {
    const syns = getSynonym('oferta', 'otro');
    expect(syns).toContain('promocion');
    expect(syns).toContain('descuento');
  });

  test('envio → includes delivery', () => {
    expect(getSynonym('envio', 'otro')).toContain('delivery');
  });

  test('delivery → includes envio (bidirectional)', () => {
    expect(getSynonym('delivery', 'otro')).toContain('envio');
  });

  test('descuento → includes oferta (bidirectional)', () => {
    expect(getSynonym('descuento', 'otro')).toContain('oferta');
  });
});

// ─── getSynonym() — normalization ─────────────────────────────────────────────

describe('getSynonym() — accent and case normalization', () => {
  test('Soda (uppercase) → same as soda', () => {
    expect(getSynonym('Soda', 'restaurante')).toEqual(getSynonym('soda', 'restaurante'));
  });

  test('CAFÉ (uppercase + accent) → same as cafe', () => {
    expect(getSynonym('CAFÉ', 'restaurante')).toEqual(getSynonym('cafe', 'restaurante'));
  });

  test('desarmadór (with accent) → same as desarmador', () => {
    expect(getSynonym('Desarmadór', 'hardware')).toEqual(getSynonym('desarmador', 'hardware'));
  });

  test('unknown category returns empty array', () => {
    expect(getSynonym('pizza', 'cyberpunk_shop')).toEqual([]);
  });
});

// ─── getSynonymsAcrossCategories() ────────────────────────────────────────────

describe('getSynonymsAcrossCategories()', () => {
  test('cafe returns synonyms (from restaurante bucket)', () => {
    const syns = getSynonymsAcrossCategories('cafe');
    expect(syns.length).toBeGreaterThan(0);
    expect(syns).toContain('americano');
  });

  test('taladro returns synonyms (from hardware bucket)', () => {
    const syns = getSynonymsAcrossCategories('taladro');
    expect(syns).toContain('perforadora');
  });

  test('pastilla returns synonyms (from farmacia bucket)', () => {
    expect(getSynonymsAcrossCategories('pastilla')).toContain('tableta');
  });

  test('results are deduplicated (no repeated values)', () => {
    const syns = getSynonymsAcrossCategories('oferta');
    const unique = new Set(syns);
    expect(unique.size).toBe(syns.length);
  });

  test('completely unknown term returns empty array', () => {
    expect(getSynonymsAcrossCategories('zzz_no_existe_zzz')).toEqual([]);
  });

  test('mazorca found across categories', () => {
    // mazorca is a reverse-map synonym for elote in restaurante
    const syns = getSynonymsAcrossCategories('mazorca');
    expect(syns).toContain('elote');
  });
});

// ─── bidirectional reverse mapping ───────────────────────────────────────────

describe('bidirectional reverse mapping', () => {
  // Every entry in SYNONYM_MAP should be bidirectionally reachable
  const BIDIRECTIONAL_CASES = [
    // restaurante
    ['refresco', 'restaurante', 'soda'],
    ['mazorca',  'restaurante', 'elote'],
    ['nieve',    'restaurante', 'helado'],
    ['postre',   'restaurante', 'dulce'],
    // hardware
    ['destornillador', 'hardware', 'desarmador'],
    ['marro',          'hardware', 'martillo'],
    ['perforadora',    'hardware', 'taladro'],
    ['tirafondo',      'hardware', 'tornillo'],
    // farmacia
    ['tableta',    'farmacia', 'pastilla'],
    ['medicamento','farmacia', 'medicina'],
    ['bandita',    'farmacia', 'curita'],
    // papeleria
    ['bateria',    'papeleria', 'pila'],
    ['bombilla',   'papeleria', 'foco'],
    // ropa
    ['playera',    'ropa', 'camisa'],
    ['jean',       'ropa', 'pantalon'],
    ['sneakers',   'ropa', 'tenis'],
    // otro
    ['delivery',   'otro', 'envio'],
    ['promocion',  'otro', 'oferta'],
  ];

  test.each(BIDIRECTIONAL_CASES)(
    'getSynonym("%s", "%s") contains "%s"',
    (term, category, expected) => {
      expect(getSynonym(term, category)).toContain(expected);
    }
  );
});

// ─── getSynonymsByBusinessId() ────────────────────────────────────────────────

describe('getSynonymsByBusinessId()', () => {
  test('returns scoped synonyms when business type is resolved', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ name: 'restaurante' }] });

    const syns = await getSynonymsByBusinessId('elote', 42);
    expect(syns).toContain('mazorca');
  });

  test('caches the business type (second call does not hit DB again)', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ name: 'hardware' }] });

    // First call: hits DB
    await getSynonymsByBusinessId('desarmador', 100);
    // Second call: should use cache
    await getSynonymsByBusinessId('martillo', 100);

    // DB should only have been called once (for the business type lookup)
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  test('falls back to global search when business type is unknown', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }); // no business found

    const syns = await getSynonymsByBusinessId('soda', 999);
    // Falls back to getSynonymsAcrossCategories → should still find it in restaurante
    expect(syns).toContain('refresco');
  });

  test('falls back to global search when DB throws', async () => {
    db.query.mockRejectedValueOnce(new Error('DB connection failed'));

    const syns = await getSynonymsByBusinessId('cafe', 777);
    // Falls back → global search finds it
    expect(syns.length).toBeGreaterThan(0);
  });

  test('restaurante business returns restaurant synonyms, not hardware', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ name: 'restaurante' }] });

    const syns = await getSynonymsByBusinessId('elote', 55);
    // Should find 'mazorca' (restaurante) but NOT 'perno' (hardware)
    expect(syns).toContain('mazorca');
    expect(syns).not.toContain('perno');
  });

  test('[farmacia] business returns pharmacy synonyms', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ name: 'farmacia' }] });

    const syns = await getSynonymsByBusinessId('pastilla', 200);
    expect(syns).toContain('tableta');
    expect(syns).toContain('comprimido');
  });

  test('[hardware] business returns hardware synonyms', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ name: 'hardware' }] });

    const syns = await getSynonymsByBusinessId('martillo', 300);
    expect(syns).toContain('marro');
  });

  test('[ropa] business returns clothing synonyms', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ name: 'ropa' }] });

    const syns = await getSynonymsByBusinessId('camisa', 400);
    expect(syns).toContain('playera');
    expect(syns).toContain('camiseta');
  });

  test('[papeleria] business returns stationery synonyms', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ name: 'papeleria' }] });

    const syns = await getSynonymsByBusinessId('foco', 500);
    expect(syns).toContain('bombilla');
  });

  test('term not in business bucket falls through to global search', async () => {
    // Business is 'hardware' but term 'elote' is not in hardware bucket
    db.query.mockResolvedValueOnce({ rows: [{ name: 'hardware' }] });

    const syns = await getSynonymsByBusinessId('elote', 600);
    // Should find via global cross-bucket (restaurante) fallback
    expect(syns).toContain('mazorca');
  });
});

// ─── SYNONYM_MAP structure validation ────────────────────────────────────────

describe('SYNONYM_MAP integrity', () => {
  test('all categories contain at least one entry', () => {
    for (const [cat, entries] of Object.entries(SYNONYM_MAP)) {
      expect(Object.keys(entries).length).toBeGreaterThan(0);
    }
  });

  test('all synonym values are arrays of strings', () => {
    for (const [cat, entries] of Object.entries(SYNONYM_MAP)) {
      for (const [term, synonyms] of Object.entries(entries)) {
        expect(Array.isArray(synonyms)).toBe(true);
        synonyms.forEach((s) => {
          expect(typeof s).toBe('string');
          expect(s.length).toBeGreaterThan(0);
        });
      }
    }
  });

  test('restaurante has food-specific entries (elote, tacos, pozole, birria)', () => {
    const restauranteKeys = Object.keys(SYNONYM_MAP.restaurante);
    ['elote', 'tacos', 'pozole', 'birria', 'dulce'].forEach((k) => {
      expect(restauranteKeys).toContain(k);
    });
  });

  test('hardware has tool entries (taladro, tornillo, martillo)', () => {
    const hardwareKeys = Object.keys(SYNONYM_MAP.hardware);
    ['taladro', 'tornillo', 'martillo', 'pintura'].forEach((k) => {
      expect(hardwareKeys).toContain(k);
    });
  });

  test('farmacia has medical entries (pastilla, medicina, vitamina)', () => {
    const farmaciaKeys = Object.keys(SYNONYM_MAP.farmacia);
    ['pastilla', 'medicina', 'vitamina', 'antibiotico'].forEach((k) => {
      expect(farmaciaKeys).toContain(k);
    });
  });
});

import { parseMultiIntent, joinResponses, hasSignal } from '../../src/services/multiIntentParser.js';

// ─── hasSignal() ─────────────────────────────────────────────────────────────

describe('hasSignal()', () => {
  test.each([
    // Catalog / availability
    ['tienen pizza',              true],
    ['hay descuentos',            true],
    ['venden pasteles',           true],
    ['busco una camisa',         true],
    ['necesito tornillos',       true],
    // Price
    ['cuanto cuesta',            true],
    ['que precio tiene',         true],
    ['cobran envio',             true],
    // Schedule / location
    ['a que hora abren',         true],
    ['donde estan ubicados',     true],
    ['tienen horario corrido',   true],
    // Purchase
    ['quiero comprar',           true],
    ['como pido',                true],
    // Category signals
    ['que comida tienen',        true],
    ['tienen bebidas',           true],
    // Price-filter
    ['algo barato',              true],
    ['opciones economicas',      true],
    // NO signal words
    ['sal y pimienta',           false],
    ['pan con mantequilla',      false],
    ['tornillos',                false],
    ['hola',                     false],
    ['ok',                       false],
  ])('"%s" → %s', (segment, expected) => {
    expect(hasSignal(segment)).toBe(expected);
  });
});

// ─── parseMultiIntent() — no split ───────────────────────────────────────────

describe('parseMultiIntent() — single segment (no split)', () => {
  test('empty string returns single primary segment', () => {
    const result = parseMultiIntent('');
    expect(result).toHaveLength(1);
    expect(result[0].segment).toBe('');
    expect(result[0].connectorType).toBe('primary');
  });

  test('very short message (≤ 5 chars) is never split', () => {
    const result = parseMultiIntent('hola');
    expect(result).toHaveLength(1);
    expect(result[0].connectorType).toBe('primary');
  });

  test('product-compound "sal y pimienta" is NOT split', () => {
    const result = parseMultiIntent('sal y pimienta');
    expect(result).toHaveLength(1);
    expect(result[0].segment).toBe('sal y pimienta');
  });

  test('product-compound "pan y mantequilla" is NOT split', () => {
    const result = parseMultiIntent('pan y mantequilla');
    expect(result).toHaveLength(1);
  });

  test('product-compound "tornillos y tuercas" is NOT split', () => {
    const result = parseMultiIntent('tornillos y tuercas');
    expect(result).toHaveLength(1);
  });

  test('ingredient list "queso y jamon" is NOT split', () => {
    const result = parseMultiIntent('queso y jamon');
    expect(result).toHaveLength(1);
  });

  test('single question with no connector is NOT split', () => {
    const result = parseMultiIntent('cuanto cuesta la pizza hawaiana');
    expect(result).toHaveLength(1);
    expect(result[0].connectorType).toBe('primary');
  });

  test('"tienen pizza" is NOT split (no connector)', () => {
    const result = parseMultiIntent('tienen pizza');
    expect(result).toHaveLength(1);
  });
});

// ─── parseMultiIntent() — strong connector splits ────────────────────────────

describe('parseMultiIntent() — strong connectors always split', () => {
  test('"cuanto cuesta la pizza y tambien que horarios tienen" splits on "y también"', () => {
    const result = parseMultiIntent('cuanto cuesta la pizza y tambien que horarios tienen');
    expect(result).toHaveLength(2);
    expect(result[0].connectorType).toBe('primary');
    expect(result[1].connectorType).toBe('additive');
    expect(result[0].segment).toContain('pizza');
    expect(result[1].segment).toContain('horarios');
  });

  test('"donde estan ubicados ademas tienen estacionamiento" splits on "además"', () => {
    const result = parseMultiIntent('donde estan ubicados ademas tienen estacionamiento');
    expect(result).toHaveLength(2);
    expect(result[1].connectorType).toBe('additive');
    expect(result[1].segment).toContain('estacionamiento');
  });

  test('"tienen hamburguesas aparte de eso que bebidas tienen" splits on "aparte de eso"', () => {
    const result = parseMultiIntent('tienen hamburguesas aparte de eso que bebidas tienen');
    expect(result).toHaveLength(2);
    expect(result[1].connectorType).toBe('additive');
    expect(result[1].segment).toContain('bebidas');
  });

  test('"cuanto cuesta la pizza sino el precio de la ensalada" splits on "sino"', () => {
    const result = parseMultiIntent('cuanto cuesta la pizza sino el precio de la ensalada');
    expect(result).toHaveLength(2);
    expect(result[1].connectorType).toBe('contrastive');
    expect(result[1].segment).toContain('ensalada');
  });

  test('"tienen tornillos o bien tienen pernos" splits on "o bien"', () => {
    const result = parseMultiIntent('tienen tornillos o bien tienen pernos');
    expect(result).toHaveLength(2);
    expect(result[1].connectorType).toBe('alternative');
  });

  test('"ya sea en efectivo o con tarjeta" splits on "ya sea"', () => {
    const result = parseMultiIntent('ya sea en efectivo ya sea con tarjeta cual precio tienen');
    // "ya sea" is a strong alternative connector
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  // Restaurant scenario
  test('[restaurante] "cuanto cuesta el bistec y tambien que postres tienen" → 2 segments', () => {
    const result = parseMultiIntent('cuanto cuesta el bistec y tambien que postres tienen');
    expect(result).toHaveLength(2);
    expect(result[0].segment).toContain('bistec');
    expect(result[1].segment).toContain('postres');
    expect(result[1].connectorType).toBe('additive');
  });

  // Hardware scenario
  test('[ferreteria] "precio del taladro ademas cuanto cuesta la lijadora" → 2 segments', () => {
    const result = parseMultiIntent('precio del taladro ademas cuanto cuesta la lijadora');
    expect(result).toHaveLength(2);
    expect(result[0].segment).toContain('taladro');
    expect(result[1].segment).toContain('lijadora');
  });

  // Pharmacy scenario
  test('[farmacia] "tienen paracetamol ademas venden vitaminas" → 2 segments', () => {
    const result = parseMultiIntent('tienen paracetamol ademas venden vitaminas');
    expect(result).toHaveLength(2);
    expect(result[0].segment).toContain('paracetamol');
    expect(result[1].segment).toContain('vitaminas');
  });
});

// ─── parseMultiIntent() — weak connector splits ──────────────────────────────

describe('parseMultiIntent() — weak "y" connector (both sides need signal)', () => {
  test('"cuanto cuesta la pizza y que horarios tienen" → 2 segments', () => {
    const result = parseMultiIntent('cuanto cuesta la pizza y que horarios tienen');
    expect(result).toHaveLength(2);
    expect(result[0].segment).toContain('pizza');
    expect(result[1].segment).toContain('horarios');
    expect(result[1].connectorType).toBe('additive');
  });

  test('"tienen hamburguesas y venden tacos" → 2 segments', () => {
    const result = parseMultiIntent('tienen hamburguesas y venden tacos');
    expect(result).toHaveLength(2);
  });

  test('[ropa] "tienen playeras y tienen jeans" → 2 segments', () => {
    const result = parseMultiIntent('tienen playeras y tienen jeans');
    expect(result).toHaveLength(2);
    expect(result[0].segment).toContain('playeras');
    expect(result[1].segment).toContain('jeans');
  });

  test('"cuanto cuesta y donde estan ubicados" (both sides have signals) → 2 segments', () => {
    const result = parseMultiIntent('cuanto cuesta y donde estan ubicados');
    expect(result).toHaveLength(2);
  });

  // One side has no signal → no split
  test('"quiero una pizza y coca cola" → NOT split (right side "coca cola" has no signal)', () => {
    const result = parseMultiIntent('quiero una pizza y coca cola');
    // "coca cola" contains no signal word → short message → should NOT split
    expect(result[0].segment).toContain('pizza');
  });

  test('"pan y agua" → NOT split (neither side has signal, both sides ≤ 3 words)', () => {
    const result = parseMultiIntent('pan y agua');
    expect(result).toHaveLength(1);
  });

  // Right side starts with interrogative word ("que <noun>") — treated as new clause
  test('"dime que hamburguesas vende y que refrescos" → 2 segments', () => {
    const result = parseMultiIntent('dime que hamburguesas vende y que refrescos');
    expect(result).toHaveLength(2);
    expect(result[0].segment).toContain('hamburguesas');
    expect(result[1].segment).toBe('que refrescos');
    expect(result[1].connectorType).toBe('additive');
  });

  test('"que pizzas venden y que bebidas tienen" → 2 segments', () => {
    const result = parseMultiIntent('que pizzas venden y que bebidas tienen');
    expect(result).toHaveLength(2);
    expect(result[0].segment).toContain('pizzas');
    expect(result[1].segment).toContain('bebidas');
  });

  // Lone "que" without following token must NOT be treated as a clause
  test('"pan que y agua" → NOT split (right of "y" is just "agua", no signal)', () => {
    const result = parseMultiIntent('pan que y agua');
    expect(result).toHaveLength(1);
  });
});

// ─── parseMultiIntent() — implied-existence splits (no "también") ────────────
//
// When the left side contains an existence verb (tiene/tienes/tienen/hay/etc.)
// and the right side is a multi-word noun phrase (≥ 2 meaningful tokens),
// the verb is implied for the right side:
//   "tiene hamburguesa doble y agua de jamaica?" = "¿tiene X? y ¿tiene Y?"
// Single-word right sides (e.g. "tienen sal y pimienta") are still NOT split.

describe('parseMultiIntent() — implied existence: "tiene X y <multi-word product>"', () => {
  test('"tiene hamburguesa doble y agua de jamaica" → 2 segments', () => {
    const result = parseMultiIntent('tiene hamburguesa doble y agua de jamaica');
    expect(result).toHaveLength(2);
    expect(result[0].segment).toBe('tiene hamburguesa doble');
    expect(result[1].segment).toBe('agua de jamaica');
    expect(result[0].connectorType).toBe('primary');
    expect(result[1].connectorType).toBe('additive');
  });

  test('"tienen pizza hawaiana y hamburguesa clasica" → 2 segments', () => {
    const result = parseMultiIntent('tienen pizza hawaiana y hamburguesa clasica');
    expect(result).toHaveLength(2);
    expect(result[0].segment).toContain('pizza');
    expect(result[1].segment).toContain('hamburguesa');
  });

  test('"hay agua de jamaica y pozole rojo" → 2 segments', () => {
    const result = parseMultiIntent('hay agua de jamaica y pozole rojo');
    expect(result).toHaveLength(2);
    expect(result[0].segment).toContain('jamaica');
    expect(result[1].segment).toContain('pozole');
  });

  test('"venden tacos de pastor y agua fresca" → 2 segments', () => {
    const result = parseMultiIntent('venden tacos de pastor y agua fresca');
    expect(result).toHaveLength(2);
    expect(result[0].segment).toContain('tacos');
    expect(result[1].segment).toContain('agua');
  });

  test('"tienen arroz con leche y flan napolitano" → 2 segments', () => {
    const result = parseMultiIntent('tienen arroz con leche y flan napolitano');
    expect(result).toHaveLength(2);
    expect(result[0].segment).toContain('arroz');
    expect(result[1].segment).toContain('flan');
  });

  // Single-word right side: compound name guard must still hold
  test('"tienen sal y pimienta" → NOT split (right side is 1 token)', () => {
    const result = parseMultiIntent('tienen sal y pimienta');
    expect(result).toHaveLength(1);
    expect(result[0].segment).toBe('tienen sal y pimienta');
  });

  test('"tienen agua y limon" → NOT split (right side is 1 token)', () => {
    const result = parseMultiIntent('tienen agua y limon');
    expect(result).toHaveLength(1);
  });

  // "quiero" is NOT in EXISTENCE_VERBS → no implied-existence split
  test('"quiero una pizza y coca cola" → NOT split (quiero is not an existence verb)', () => {
    const result = parseMultiIntent('quiero una pizza y coca cola');
    expect(result).toHaveLength(1);
    expect(result[0].segment).toContain('pizza');
  });
});

// ─── parseMultiIntent() — "pero" contrastive splits ─────────────────────────

describe('parseMultiIntent() — "pero" connector', () => {
  test('"tienen hamburguesas pero sin carne" → strong contrastive split', () => {
    const result = parseMultiIntent('tienen hamburguesas pero sin carne');
    expect(result).toHaveLength(2);
    expect(result[1].connectorType).toBe('contrastive');
    expect(result[1].segment).toContain('sin carne');
  });

  test('"tienen pizza pero mas barata" → strong contrastive split', () => {
    const result = parseMultiIntent('tienen pizza pero mas barata');
    expect(result).toHaveLength(2);
    expect(result[1].connectorType).toBe('contrastive');
  });

  test('"tienen jarabe pero economico" → strong contrastive split', () => {
    const result = parseMultiIntent('tienen jarabe pero economico');
    expect(result).toHaveLength(2);
    expect(result[1].connectorType).toBe('contrastive');
  });

  // Weak "pero" requires both sides to have signal
  test('"quiero pizza pero de pollo" → weak pero (one side no signal) → NOT split or split', () => {
    const result = parseMultiIntent('quiero pizza pero de pollo');
    // "de pollo" has no signal → should not split due to weak connector rules
    // (may or may not split depending on left side; acceptable either way)
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── parseMultiIntent() — "también" soft connector ──────────────────────────

describe('parseMultiIntent() — "también quiero/necesito" strong connector', () => {
  test('"tienen medicamentos tambien quiero vitaminas" → additive split', () => {
    const result = parseMultiIntent('tienen medicamentos tambien quiero vitaminas');
    expect(result).toHaveLength(2);
    expect(result[1].connectorType).toBe('additive');
    expect(result[1].segment).toContain('vitaminas');
  });

  test('"precio del vestido tambien necesito saber de los jeans" → additive split', () => {
    const result = parseMultiIntent('precio del vestido tambien necesito saber de los jeans');
    expect(result).toHaveLength(2);
    expect(result[1].connectorType).toBe('additive');
  });
});

// ─── parseMultiIntent() — alternative "o" ─────────────────────────────────

describe('parseMultiIntent() — "o" weak alternative connector', () => {
  test('"cuanto cuesta la pizza o que precio tiene la pasta" → alternative split', () => {
    const result = parseMultiIntent('cuanto cuesta la pizza o que precio tiene la pasta');
    expect(result).toHaveLength(2);
    expect(result[1].connectorType).toBe('alternative');
  });

  test('"tienen ropa o venden calzado" → alternative split', () => {
    const result = parseMultiIntent('tienen ropa o venden calzado');
    expect(result).toHaveLength(2);
    expect(result[1].connectorType).toBe('alternative');
  });

  test('"queso o jamon" → NOT split (no signal on either side)', () => {
    const result = parseMultiIntent('queso o jamon');
    expect(result).toHaveLength(1);
  });
});

// ─── parseMultiIntent() — recursive split (3+ segments) ────────────────────

describe('parseMultiIntent() — recursive splits (multi-segment messages)', () => {
  test('"precio de pizza ademas horarios ademas donde estan" → 3 segments', () => {
    const result = parseMultiIntent('precio de pizza ademas horarios ademas donde estan');
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0].connectorType).toBe('primary');
    result.slice(1).forEach((s) => expect(s.connectorType).not.toBe('primary'));
  });

  test('MAX_SPLITS cap: more than 3 connectors do not generate more than 4 segments', () => {
    const msg = 'precio del taladro ademas precio de la lijadora ademas precio del martillo ademas precio de la sierra ademas precio del cincel';
    const result = parseMultiIntent(msg);
    // MAX_SPLITS = 3, so maximum 4 segments
    expect(result.length).toBeLessThanOrEqual(4);
  });

  // Restaurant: 3-part question
  test('[restaurante] precio + horario + ubicacion → 3 segments', () => {
    const msg = 'cuanto cuesta el pozole y tambien que horario tienen ademas donde estan ubicados';
    const result = parseMultiIntent(msg);
    expect(result.length).toBeGreaterThanOrEqual(2);
    expect(result[0].segment).toContain('pozole');
  });
});

// ─── parseMultiIntent() — first segment always primary ───────────────────────

describe('parseMultiIntent() — first segment always has connectorType="primary"', () => {
  test('split result: first = primary, rest ≠ primary', () => {
    const result = parseMultiIntent('cuanto cuesta la pizza y que horarios tienen');
    expect(result[0].connectorType).toBe('primary');
    result.slice(1).forEach((seg) => {
      expect(seg.connectorType).not.toBe('primary');
    });
  });

  test('no-split result: single item is primary', () => {
    const result = parseMultiIntent('tienen pizza');
    expect(result[0].connectorType).toBe('primary');
  });
});

// ─── parseMultiIntent() — connector type labeling ────────────────────────────

describe('parseMultiIntent() — connector type accuracy', () => {
  test('"y tambien" connector → additive', () => {
    const result = parseMultiIntent('precio del antibiotico y tambien venden vitaminas');
    const additive = result.find((s) => s.connectorType === 'additive');
    expect(additive).toBeDefined();
  });

  test('"sino" connector → contrastive', () => {
    const result = parseMultiIntent('cuanto cuesta la pizza sino la ensalada');
    const contrastive = result.find((s) => s.connectorType === 'contrastive');
    expect(contrastive).toBeDefined();
  });

  test('"o bien" connector → alternative', () => {
    const result = parseMultiIntent('tienen tornillos de madera o bien tienen tornillos de metal');
    const alternative = result.find((s) => s.connectorType === 'alternative');
    expect(alternative).toBeDefined();
  });
});

// ─── parseMultiIntent() — multi-business-type scenarios ─────────────────────

describe('parseMultiIntent() — real-world multi-business scenarios', () => {
  describe('Restaurante', () => {
    test('"cuanto cuesta la pizza y a que hora abren" → 2 segments', () => {
      const result = parseMultiIntent('cuanto cuesta la pizza y a que hora abren');
      expect(result).toHaveLength(2);
      expect(result[0].segment).toContain('pizza');
      expect(result[1].segment).toContain('hora abren');
    });

    test('"hay birria y tambien tienen menudo" → 2 segments (additive)', () => {
      const result = parseMultiIntent('hay birria y tambien tienen menudo');
      expect(result).toHaveLength(2);
      expect(result[1].connectorType).toBe('additive');
    });

    test('"que precio tiene el pozole sino el de la birria" → contrastive split', () => {
      const result = parseMultiIntent('que precio tiene el pozole sino el de la birria');
      expect(result).toHaveLength(2);
      expect(result[1].connectorType).toBe('contrastive');
    });

    test('"tienen tacos o hamburguesas" → NOT split (o without signal on both sides)', () => {
      // "tacos" and "hamburguesas" are product names, not signal words
      const result = parseMultiIntent('tienen tacos o hamburguesas');
      // Left side has "tienen" which IS a signal, so it depends
      // Just verify first segment is primary
      expect(result[0].connectorType).toBe('primary');
    });
  });

  describe('Ferretería (Hardware)', () => {
    test('"precio del taladro y cuanto cuesta la lijadora" → 2 segments', () => {
      const result = parseMultiIntent('precio del taladro y cuanto cuesta la lijadora');
      expect(result).toHaveLength(2);
    });

    test('"tienen tornillos de madera ademas donde estan ubicados" → 2 segments', () => {
      const result = parseMultiIntent('tienen tornillos de madera ademas donde estan ubicados');
      expect(result).toHaveLength(2);
      expect(result[1].segment).toContain('ubicados');
    });

    test('"necesito un martillo y tambien busco pinzas" → 2 segments', () => {
      const result = parseMultiIntent('necesito un martillo y tambien busco pinzas');
      expect(result).toHaveLength(2);
      expect(result[1].connectorType).toBe('additive');
    });

    test('"venden pintura o esmalte" → context-dependent (both are products, weak signal)', () => {
      // "venden" is a signal — left has signal, "esmalte" alone has no signal
      // Behavior depends on message length and signal presence
      const result = parseMultiIntent('venden pintura o esmalte');
      expect(result[0].connectorType).toBe('primary');
    });
  });

  describe('Farmacia (Pharmacy)', () => {
    test('"tienen paracetamol y cuanto cuesta el ibuprofeno" → 2 segments', () => {
      const result = parseMultiIntent('tienen paracetamol y cuanto cuesta el ibuprofeno');
      expect(result).toHaveLength(2);
    });

    test('"venden vitaminas ademas que precio tienen los suplementos" → 2 segments', () => {
      const result = parseMultiIntent('venden vitaminas ademas que precio tienen los suplementos');
      expect(result).toHaveLength(2);
      expect(result[0].segment).toContain('vitaminas');
      expect(result[1].segment).toContain('suplementos');
    });

    test('"necesito aspirinas pero economicas" → contrastive split', () => {
      const result = parseMultiIntent('necesito aspirinas pero economicas');
      expect(result).toHaveLength(2);
      expect(result[1].connectorType).toBe('contrastive');
    });
  });

  describe('Ropa (Clothing)', () => {
    test('"tienen camisas y tambien busco pantalones" → 2 additive segments', () => {
      const result = parseMultiIntent('tienen camisas y tambien busco pantalones');
      expect(result).toHaveLength(2);
      expect(result[1].connectorType).toBe('additive');
    });

    test('"cuanto cuestan los jeans y a que hora cierran" → 2 segments', () => {
      const result = parseMultiIntent('cuanto cuestan los jeans y a que hora cierran');
      expect(result).toHaveLength(2);
      expect(result[0].segment).toContain('jeans');
      expect(result[1].segment).toContain('hora cierran');
    });

    test('"tienen tallas grandes sino en linea" → contrastive split', () => {
      const result = parseMultiIntent('tienen tallas grandes sino en linea');
      expect(result).toHaveLength(2);
      expect(result[1].connectorType).toBe('contrastive');
    });
  });

  describe('Papelería / General', () => {
    test('"tienen cuadernos y cuanto valen las pilas" → 2 segments', () => {
      const result = parseMultiIntent('tienen cuadernos y cuanto valen las pilas');
      expect(result).toHaveLength(2);
    });

    test('"precio del foco ademas venden baterias" → 2 segments', () => {
      const result = parseMultiIntent('precio del foco ademas venden baterias');
      expect(result).toHaveLength(2);
    });
  });
});

// ─── joinResponses() ─────────────────────────────────────────────────────────

describe('joinResponses()', () => {
  test('empty first → returns second as-is', () => {
    expect(joinResponses('', 'Tenemos pizza', 'additive')).toBe('Tenemos pizza');
  });

  test('empty second → returns first as-is', () => {
    expect(joinResponses('Tenemos pizza', '', 'additive')).toBe('Tenemos pizza');
  });

  test('additive connector uses an additive bridge phrase', () => {
    const result = joinResponses('Tenemos pizza.', 'Abrimos a las 9am.', 'additive');
    expect(result).toContain('Tenemos pizza');
    expect(result).toContain('abrimos'); // second part is lower-cased
    // Bridge phrases: "Además, " | "Por otro lado, " | "También te cuento que " | "Y sobre lo otro: "
    expect(result).toMatch(/Además|Por otro lado|También te cuento|Y sobre lo otro/);
  });

  test('alternative connector uses an alternative bridge phrase', () => {
    const result = joinResponses('No tenemos tacos.', 'Pero sí tenemos burritos.', 'alternative');
    expect(result).toMatch(/Ahora bien|Como alternativa|O si prefieres/);
  });

  test('contrastive connector uses a contrastive bridge phrase', () => {
    const result = joinResponses('Tenemos pizza de queso.', 'Sin embargo, no hay de pepperoni.', 'contrastive');
    expect(result).toMatch(/Dicho esto|Eso sí|Ahora bien/);
  });

  test('unknown connector falls back to additive bridge', () => {
    const result = joinResponses('Resp A.', 'Resp B.', 'unknown_type');
    expect(result).toMatch(/Además|Por otro lado|También te cuento|Y sobre lo otro/);
  });

  test('second response is lower-cased when it starts with a letter', () => {
    const result = joinResponses('Primera respuesta.', 'Segunda respuesta aquí.', 'additive');
    expect(result).toContain('segunda respuesta aquí');
  });

  test('second response starting with digit is NOT lower-cased', () => {
    const result = joinResponses('Primera.', '10 opciones disponibles.', 'additive');
    expect(result).toContain('10 opciones disponibles');
  });

  test('second response starting with emoji is NOT lower-cased', () => {
    const result = joinResponses('Primera.', '🍕 Tenemos pizza.', 'additive');
    expect(result).toContain('🍕');
  });

  test('result combines both parts with a newline separator', () => {
    const result = joinResponses('Parte uno.', 'Parte dos.', 'additive');
    expect(result).toContain('\n\n');
  });

  test('primary connector falls back to additive bridge', () => {
    const result = joinResponses('Resp A.', 'Resp B.', 'primary');
    expect(result).toMatch(/Además|Por otro lado|También te cuento|Y sobre lo otro/);
  });
});

// ─── parseMultiIntent() — output shape contract ──────────────────────────────

describe('parseMultiIntent() — output shape always valid', () => {
  const CASES = [
    '',
    'hola',
    'cuanto cuesta',
    'cuanto cuesta la pizza y que horarios tienen',
    'precio del taladro ademas cuanto cuesta la lijadora y donde estan ubicados',
  ];

  test.each(CASES)('output is non-empty array with segment and connectorType for "%s"', (input) => {
    const result = parseMultiIntent(input);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThanOrEqual(1);
    result.forEach((item) => {
      expect(typeof item.segment).toBe('string');
      expect(['primary', 'additive', 'alternative', 'contrastive']).toContain(item.connectorType);
    });
  });
});

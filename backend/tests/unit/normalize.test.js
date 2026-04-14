import { normalize, toSingular, wordVariants } from '../../src/services/normalize.js';

// ─── normalize() ─────────────────────────────────────────────────────────────

describe('normalize()', () => {
  test('lowercases text', () => {
    expect(normalize('Hola MUNDO')).toBe('hola mundo');
  });

  test('strips accent marks', () => {
    expect(normalize('qué día están abiertos')).toBe('que dia estan abiertos');
  });

  test('removes inverted punctuation (¿ ¡)', () => {
    expect(normalize('¿Cuándo abren?')).toBe('cuando abren');
  });

  test('strips remaining punctuation', () => {
    expect(normalize('hola! ¿cómo estás?')).toBe('hola como estas');
  });

  test('collapses repeated characters (3+)', () => {
    expect(normalize('hoolaaa')).toBe('hoolaa');
  });

  test('trims surrounding whitespace', () => {
    expect(normalize('  hola  ')).toBe('hola');
  });

  test('collapses multiple spaces', () => {
    expect(normalize('hola   mundo')).toBe('hola mundo');
  });

  test('handles empty string', () => {
    expect(normalize('')).toBe('');
  });

  test('handles null/undefined', () => {
    expect(normalize(null)).toBe('');
    expect(normalize(undefined)).toBe('');
  });

  test('handles string with only punctuation', () => {
    expect(normalize('¿¡!?')).toBe('');
  });

  test('preserves ñ — does NOT strip it like other diacritics', () => {
    expect(normalize('buñuelo')).toBe('buñuelo');
    expect(normalize('Piñata')).toBe('piñata');
    expect(normalize('mañana')).toBe('mañana');
    expect(normalize('niño')).toBe('niño');
    expect(normalize('CAÑÓN')).toBe('cañon');  // accented Ó stripped, Ñ preserved
  });

  test('strips underscore (treats _ as punctuation)', () => {
    expect(normalize('hamburguesas_')).toBe('hamburguesas');
    expect(normalize('hello_world')).toBe('helloworld');
    expect(normalize('test__double')).toBe('testdouble');
  });

  test('ñ + underscore combined', () => {
    expect(normalize('buñuelos_')).toBe('buñuelos');
    expect(normalize('Niños_')).toBe('niños');
  });
});

// ─── toSingular() ─────────────────────────────────────────────────────────────

describe('toSingular()', () => {
  test('ces → z: lapices → lapiz', () => {
    expect(toSingular('lapices')).toBe('lapiz');
  });

  test('iones → ion: promociones → promocion', () => {
    expect(toSingular('promociones')).toBe('promocion');
  });

  test('es → (strip): marcadores → marcador', () => {
    expect(toSingular('marcadores')).toBe('marcador');
  });

  test('s → (strip): cuadernos → cuaderno', () => {
    expect(toSingular('cuadernos')).toBe('cuaderno');
  });

  test('does not strip ss', () => {
    expect(toSingular('boss')).toBe('boss');
  });

  test('short words with -es not stripped by -es rule (≤4 chars), but -s rule applies', () => {
    // "tres" (4 chars) does NOT match the -es rule (>4) but matches the -s rule
    expect(toSingular('tres')).toBe('tre');
    // "mes" is 3 chars → only -s rule applies → "me"
    expect(toSingular('mes')).toBe('me');
  });

  test('already singular returns unchanged', () => {
    expect(toSingular('laptop')).toBe('laptop');
  });
});

// ─── wordVariants() ───────────────────────────────────────────────────────────

describe('wordVariants()', () => {
  test('plural word returns [plural, singular]', () => {
    const variants = wordVariants('cuadernos');
    expect(variants).toEqual(['cuadernos', 'cuaderno']);
  });

  test('singular word returns [word] only', () => {
    const variants = wordVariants('laptop');
    expect(variants).toEqual(['laptop']);
  });

  test('ces plural returns [plural, singular]', () => {
    const variants = wordVariants('lapices');
    expect(variants).toEqual(['lapices', 'lapiz']);
  });
});

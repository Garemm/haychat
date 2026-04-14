'use strict';

/**
 * src/services/intentExpanderService.js
 *
 * AMPLIFICADOR DE INTENCIONES — Expande el diccionario estático de intents
 * (mockai/intents.js) aplicando reglas morfológicas del español y almacena
 * el resultado en Redis para que intentDetector.js lo use en runtime.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * REGLAS DE DERIVACIÓN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Las reglas operan a nivel de TOKEN (palabra individual dentro de la frase).
 * Para cada frase de cada intent, se tokeniza por espacios, se procesa cada
 * token contra las tablas de sustitución y se genera una nueva frase por cada
 * reemplazo que NO exista ya en el intent.  El peso de la variante es el mismo
 * que el de la frase original.
 *
 * ┌─────┬─────────────────────────────────────────────────────────────────┐
 * │ R1  │ PLURAL_VOCAL — sustantivo/adj. terminado en vocal → +s          │
 * │     │ precio → precios   oferta → ofertas   horario → horarios        │
 * │     │ Condición: no termina ya en -s, -x.                             │
 * ├─────┼─────────────────────────────────────────────────────────────────┤
 * │ R2  │ PLURAL_CONS — terminado en consonante (no s/x/z) → +es          │
 * │     │ ciudad → ciudades   camion → camiones   canal → canales          │
 * │     │ Condición: no termina en s, x, z.                               │
 * ├─────┼─────────────────────────────────────────────────────────────────┤
 * │ R3  │ PLURAL_Z — terminado en "z" → reemplaza "z" por "ces"           │
 * │     │ vez → veces   lapiz → lapices                                   │
 * │     │ Solo se aplica a palabras sueltas (weight = 1).                 │
 * ├─────┼─────────────────────────────────────────────────────────────────┤
 * │ R4  │ VERB_PERSON — conjugación de presento indicativo                │
 * │     │ Tabla VERB_GROUPS: grupos de formas equivalentes.               │
 * │     │ Si se detecta alguna forma del grupo en la frase, se generan    │
 * │     │ variantes con EL RESTO de formas del mismo grupo.               │
 * │     │                                                                  │
 * │     │ Ejemplos:                                                        │
 * │     │   tiene  → tienen / tienes     (tener: 3ª sg → 3ª pl / 2ª sg)  │
 * │     │   vende  → venden / vendes     (vender)                         │
 * │     │   cuesta → cuestan             (costar)                         │
 * │     │   ofrece → ofrecen / ofreces   (ofrecer)                        │
 * │     │   esta   → estan               (estar — sin acento, normalizado) │
 * │     │   sale   → salen / sales       (salir/costar informal)           │
 * ├─────┼─────────────────────────────────────────────────────────────────┤
 * │ R5  │ GENDER_ARTICLE — artículos y pronombres: variante de género     │
 * │     │ Tabla GENDER_TOKEN_PAIRS: pares (masc, fem).  Se sustituye el   │
 * │     │ token por su opuesto para generar la variante de género opuesto. │
 * │     │                                                                  │
 * │     │ Pares cubiertos:                                                 │
 * │     │   Artículos:      el/la,  un/una,  los/las,  unos/unas          │
 * │     │   Pron. acusat.:  lo/la,  los/las,  uno/una                     │
 * │     │   Demostrativos:  ese/esa,  este/esta,  esos/esas,  estos/estas │
 * │     │   Indefinidos:    otro/otra,  mismo/misma                       │
 * │     │   Cuantificadores: mucho/mucha,  poco/poca                      │
 * │     │   Adj. participio: abierto/abierta,  cerrado/cerrada            │
 * │     │                    disponible/disponible (invariable — omitido)  │
 * ├─────┼─────────────────────────────────────────────────────────────────┤
 * │ R6  │ NOUN_SYNONYMS — palabras sueltas con sinónimos frecuentes        │
 * │     │ Tabla WORD_SYNONYMS: { token → [sinónimos] }                   │
 * │     │ Solo se aplica a frases de UNA sola palabra (weight ≤ 2).       │
 * │     │                                                                  │
 * │     │ Ejemplos:                                                        │
 * │     │   precio   + costo / tarifa / valor                             │
 * │     │   telefono + celular / movil / contacto                         │
 * │     │   catalogo + inventario / lista                                  │
 * └─────┴─────────────────────────────────────────────────────────────────┘
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * RESTRICCIONES Y SALVAGUARDAS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 1. Nunca se modifica ni elimina una keyword original — solo se AGREGAN
 *    variantes nuevas.
 * 2. La deduplicación garantiza que ninguna frase aparezca dos veces en el
 *    mismo intent, comparando en forma normalizada.
 * 3. R1-R3 (pluralización) SOLO se aplican a palabras sueltas (weight 1) para
 *    evitar variantes poco naturales en frases largas.
 * 4. R4 (verbos) puede aplicarse a phrases multi-palabra, pero el desplazamiento
 *    de concordancia simple (una sola sustitución de token) puede generar formas
 *    con desacuerdo gramatical.  Esto es INTENCIONAL: los usuarios escriben con
 *    errores gramaticales y el bot debe reconocerlos.  El weight se mantiene igual
 *    para que la contribución al score sea la misma que la frase original.
 * 5. Las variantes generadas se almacenan en Redis bajo "intents:expanded" con
 *    TTL de 7 días, y se regeneran en cada arranque del servidor.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * USO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   // En server.js (arranque):
 *   const { bootstrapIntents } = require('./src/services/intentExpanderService');
 *   await bootstrapIntents();   // computa + guarda en Redis
 *
 *   // En intentDetector.js (después del arranque):
 *   const { initIntents } = require('./intentDetector');
 *   await initIntents();        // carga de Redis → memoria del proceso
 */

import baseIntents from '../mockai/intents.js';
import { normalize } from './normalize.js';
import { saveExpandedIntents, getExpandedIntents } from './redisService.js';

// ─────────────────────────────────────────────────────────────────────────────
// R4 — VERB_GROUPS
//
// Cada sub-array contiene TODAS las formas del presente de indicativo que el
// expander debe considerar equivalentes para el mismo verbo.  Si la frase
// contiene CUALQUIERA de estas formas como token exacto, se generan variantes
// sustituyendo cada una de las DEMÁS formas del grupo.
//
// Orden de cada grupo: [3ª singular, 3ª plural, 2ª singular (tuteo)]
// Cuando no hay forma natural de tuteo se omite.
//
// NOTA: la normalización de normalize() elimina tildes, por lo que
//       "está" y "esta" se normalizan a "esta" — lo usamos sin tilde.
// ─────────────────────────────────────────────────────────────────────────────
const VERB_GROUPS = [
  // tener
  ['tiene',     'tienen',    'tienes'],
  // vender
  ['vende',     'venden',    'vendes'],
  // ofrecer
  ['ofrece',    'ofrecen',   'ofreces'],
  // poder
  ['puede',     'pueden',    'puedes'],
  // querer
  ['quiere',    'quieren',   'quieres'],
  // abrir
  ['abre',      'abren',     'abres'],
  // cerrar
  ['cierra',    'cierran',   'cierras'],
  // hacer
  ['hace',      'hacen',     'haces'],
  // manejar
  ['maneja',    'manejan',   'manejas'],
  // traer
  ['trae',      'traen',     'traes'],
  // llevar (también "llevar puesto")
  ['lleva',     'llevan',    'llevas'],
  // incluir
  ['incluye',   'incluyen',  'incluyes'],
  // contener
  ['contiene',  'contienen', 'contienes'],
  // costar (sin tuteo: "cuestas" no es natural en este contexto)
  ['cuesta',    'cuestan'],
  // valer
  ['vale',      'valen',     'vales'],
  // cobrar
  ['cobra',     'cobran',    'cobras'],
  // atender
  ['atiende',   'atienden',  'atiendes'],
  // estar (sin tilde por normalización)
  ['esta',      'estan'],
  // quedar
  ['queda',     'quedan',    'quedas'],
  // salir / "salir" informal de precio
  ['sale',      'salen',     'sales'],
  // dar
  ['da',        'dan',       'das'],
  // tener en 2ª sg: ya incluido ; agregar formas compuestas frecuentes:
  // "se puede" / "se pueden"
  ['se puede',  'se pueden'],
  // haber impersonal
  ['hay',       'habia'],
];

// Índice inverso: token_normalizado → grupo
const _verbIndex = new Map();
for (const group of VERB_GROUPS) {
  for (const form of group) {
    const key = normalize(form);
    if (!_verbIndex.has(key)) _verbIndex.set(key, group.map(normalize));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// R5 — GENDER_TOKEN_PAIRS
//
// Pares (forma_masculina, forma_femenina).  Para cada token en la frase,
// si coincide con cualquier forma de un par, se genera la variante con la
// forma OPUESTA.
//
// Los tokens se comparan en forma normalizada (sin tildes, lowercase).
// ─────────────────────────────────────────────────────────────────────────────
const GENDER_TOKEN_PAIRS = [
  // Artículos definidos
  ['el',       'la'],
  ['los',      'las'],
  // Artículos indefinidos
  ['un',       'una'],
  ['unos',     'unas'],
  // Pronombres acusativos de 3ª persona
  ['lo',       'la'],
  ['los',      'las'],
  // Numeral / pronombre indefinido
  ['uno',      'una'],
  // Demostrativos singulares
  ['ese',      'esa'],
  ['este',     'esta'],
  // Demostrativos plurales
  ['esos',     'esas'],
  ['estos',    'estas'],
  // Posesivo (raro en intent, pero cubre "el mismo" / "la misma")
  ['otro',     'otra'],
  ['mismo',    'misma'],
  // Cuantificadores
  ['mucho',    'mucha'],
  ['poco',     'poca'],
  // Adjetivos participio frecuentes en horarios/estado
  ['abierto',  'abierta'],
  ['cerrado',  'cerrada'],
];

// Índice bidireccional: token_normalizado → token_opuesto_normalizado
const _genderIndex = new Map();
for (const [masc, fem] of GENDER_TOKEN_PAIRS) {
  const mNorm = normalize(masc);
  const fNorm = normalize(fem);
  if (mNorm !== fNorm) {
    // Mapear ambas direcciones
    if (!_genderIndex.has(mNorm)) _genderIndex.set(mNorm, fNorm);
    if (!_genderIndex.has(fNorm)) _genderIndex.set(fNorm, mNorm);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// R6 — WORD_SYNONYMS
//
// Solo se aplica a frases de UNA palabra (peso ≤ 2).
// Cada entrada extiende el intent con sinónimos frecuentes del token dado.
// ─────────────────────────────────────────────────────────────────────────────
const WORD_SYNONYMS = {
  // precios
  precio:      ['costo', 'tarifa', 'valor', 'cobro'],
  precios:     ['costos', 'tarifas', 'valores'],
  costo:       ['precio', 'tarifa', 'cobro'],
  costos:      ['precios', 'tarifas'],
  tarifa:      ['precio', 'costo'],
  tarifas:     ['precios', 'costos'],
  // productos / inventario
  catalogo:    ['inventario', 'lista', 'menu'],
  inventario:  ['catalogo', 'stock', 'existencias'],
  producto:    ['articulo', 'item', 'mercancia'],
  productos:   ['articulos', 'items', 'mercancias'],
  articulo:    ['producto', 'item'],
  articulos:   ['productos', 'items'],
  // servicios
  servicio:    ['asistencia', 'atencion'],
  servicios:   ['asistencias', 'atenciones'],
  // ubicacion
  ubicacion:   ['localizacion', 'locacion', 'lugar'],
  ubicaciones: ['localizaciones'],
  direccion:   ['domicilio', 'sede', 'local'],
  sucursal:    ['tienda', 'local', 'sede'],
  sucursales:  ['tiendas', 'locales', 'sedes'],
  // contacto
  telefono:    ['celular', 'movil', 'numero'],
  telefonos:   ['celulares', 'moviles', 'numeros'],
  correo:      ['email', 'mail'],
  correos:     ['emails', 'mails'],
  whatsapp:    ['wsp', 'wa', 'wasap'],
  // horarios
  horario:     ['horarios', 'tiempo', 'hora'],
  // comprar
  pedido:      ['orden', 'solicitud', 'compra'],
  pedidos:     ['ordenes', 'solicitudes', 'compras'],
  ordenar:     ['pedir', 'solicitar', 'comprar'],
  // promociones
  promocion:   ['oferta', 'descuento', 'rebaja'],
  promociones: ['ofertas', 'descuentos', 'rebajas'],
  descuento:   ['rebaja', 'ahorro', 'promocion'],
  descuentos:  ['rebajas', 'ahorros', 'promociones'],
  oferta:      ['promocion', 'descuento', 'rebaja'],
  ofertas:     ['promociones', 'descuentos', 'rebajas'],
  liquidacion: ['remate', 'liquidacion', 'barata'],
  remate:      ['liquidacion', 'barata'],
};

// ─────────────────────────────────────────────────────────────────────────────
// R1 / R2 / R3 — Pluralización de sustantivos (palabras sueltas)
// ─────────────────────────────────────────────────────────────────────────────
const VOWELS = new Set(['a', 'e', 'i', 'o', 'u']);

/**
 * Genera la forma plural de una palabra según reglas del español (R1-R3).
 * Devuelve null si la palabra ya parece estar en plural o no aplica.
 *
 * @param {string} word  Palabra en minúsculas, sin tildes.
 * @returns {string|null}
 */
function toPlural(word) {
  if (!word || word.length < 3) return null;
  if (word.endsWith('es') || word.endsWith('s')) return null; // ya plural
  if (word.endsWith('x'))  return null;                       // invariable

  // R3: -z → -ces  (lapiz → lapices, vez → veces)
  if (word.endsWith('z')) return word.slice(0, -1) + 'ces';

  const last = word[word.length - 1];

  // R1: vocal → +s  (precio → precios, oferta → ofertas)
  if (VOWELS.has(last)) return word + 's';

  // R2: consonante → +es  (ciudad → ciudades, camion → camiones)
  return word + 'es';
}

// ─────────────────────────────────────────────────────────────────────────────
// Core expansion logic
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Aplica R4 (verbos) y R5 (género) a una frase multi-palabra.
 * Devuelve todas las frases variantes generadas (sin duplicar la original).
 *
 * @param {string} normPhrase  Frase ya normalizada.
 * @returns {string[]}
 */
function expandMultiword(normPhrase) {
  const tokens   = normPhrase.split(' ');
  const variants = new Set();

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];

    // R4 — verb conjugation
    const verbGroup = _verbIndex.get(tok);
    if (verbGroup) {
      for (const alt of verbGroup) {
        if (alt === tok) continue;
        const newToks = [...tokens];
        newToks[i] = alt;
        variants.add(newToks.join(' '));
      }
    }

    // R5 — gender flip
    const genderFlip = _genderIndex.get(tok);
    if (genderFlip) {
      const newToks = [...tokens];
      newToks[i] = genderFlip;
      variants.add(newToks.join(' '));
    }
  }

  return [...variants];
}

/**
 * Aplica R1-R3 (pluralización) y R6 (sinónimos) a una palabra suelta.
 * Devuelve todas las variantes generadas.
 *
 * @param {string} normWord  Palabra normalizada (sin tilde, lowercase).
 * @returns {string[]}
 */
function expandSingleWord(normWord) {
  const variants = new Set();

  // R1-R3: plural
  const plural = toPlural(normWord);
  if (plural && plural !== normWord) variants.add(plural);

  // R6: sinónimos
  const syns = WORD_SYNONYMS[normWord];
  if (syns) {
    for (const syn of syns) {
      const normSyn = normalize(syn);
      if (normSyn !== normWord) variants.add(normSyn);
    }
  }

  return [...variants];
}

/**
 * Expande TODAS las keywords de un intent generando variantes morfológicas.
 *
 * @param {object[]} keywords  Array de { phrase, weight }.
 * @returns {object[]}         Nuevo array con originales + variantes añadidas.
 */
function expandKeywords(keywords) {
  // Construir Set de frases ya presentes (comparación normalizada)
  const seen = new Set(keywords.map((kw) => normalize(kw.phrase)));
  const result = [...keywords];

  for (const kw of keywords) {
    const normPhrase = normalize(kw.phrase);
    const isSingleWord = !normPhrase.includes(' ');

    // Multi-word: verbos + género
    const multiVariants = expandMultiword(normPhrase);
    for (const v of multiVariants) {
      if (!seen.has(v)) {
        seen.add(v);
        result.push({ phrase: v, weight: kw.weight, _generated: true });
      }
    }

    // Single-word: plurales + sinónimos (siempre, independiente del peso)
    if (isSingleWord) {
      const singleVariants = expandSingleWord(normPhrase);
      for (const v of singleVariants) {
        if (!seen.has(v)) {
          seen.add(v);
          result.push({ phrase: v, weight: kw.weight, _generated: true });
        }
      }
    }
  }

  return result;
}

/**
 * Expande el diccionario completo de intents y devuelve una copia profunda
 * con las keywords ampliadas.  El intent original no se muta.
 *
 * @param {object} [intentsDict]  Diccionario base (por defecto: intents.js).
 * @returns {object}              Copia del diccionario con variantes agregadas.
 */
function expandIntents(intentsDict = baseIntents) {
  const result = {};

  for (const [key, intent] of Object.entries(intentsDict)) {
    const expandedKeywords = expandKeywords(intent.keywords);
    result[key] = { ...intent, keywords: expandedKeywords };
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap: compute → store in Redis
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calcula el diccionario expandido, lo guarda en Redis (TTL = 7 días) y
 * retorna el diccionario resultante.
 *
 * Llamar ONCE en el arranque del servidor (server.js), antes de initIntents().
 *
 * @returns {Promise<object>}  Diccionario expandido.
 */
async function bootstrapIntents() {
  const expanded = expandIntents(baseIntents);

  // Estadísticas para el log de arranque
  let baseTotal    = 0;
  let expandedTotal = 0;

  for (const key of Object.keys(expanded)) {
    baseTotal     += baseIntents[key]?.keywords.length ?? 0;
    expandedTotal += expanded[key].keywords.length;
  }

  await saveExpandedIntents(expanded);

  console.log(
    `[IntentExpander] Vocabulario expandido: ${baseTotal} keywords base → ` +
    `${expandedTotal} variantes (${expandedTotal - baseTotal} nuevas) ` +
    `en ${Object.keys(expanded).length} intents → Redis`
  );

  return expanded;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────
export {
  // Production boot entry point
  bootstrapIntents,
  // Exposed for tests and manual inspection
  expandIntents,
  expandKeywords,
  expandMultiword as expandPhrase,
  toPlural,
  // Rule tables (read-only)
  VERB_GROUPS,
  GENDER_TOKEN_PAIRS,
  WORD_SYNONYMS,
};

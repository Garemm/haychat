'use strict';

import db from '../config/database.js';

/**
 * synonyms.js
 *
 * Vocabulario de sinónimos organizado por tipo de negocio.
 * Las claves del mapa coinciden EXACTAMENTE con los valores de la columna
 * `name` en la tabla `business_types` de la base de datos:
 *   restaurante | hardware | papeleria | farmacia | ropa | otro
 *
 * Uso en el pipeline: si una búsqueda de producto no encuentra resultados,
 * se consultan los sinónimos del tipo de negocio correcto y se reintenta.
 *
 * Para agregar sinónimos:
 *   1. Localiza la clave del tipo de negocio correcto.
 *   2. Añade: termino_usuario: ['equivalente1', 'equivalente2']
 *   3. Agrega también la entrada inversa si aplica.
 */

// ── Normalizador interno ────────────────────────────────────────────────────
function _n(str) {
  return String(str)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

// ── Vocabulario de sinónimos ─────────────────────────────────────────────────
const SYNONYM_MAP = {
  // ── restaurante ─────────────────────────────────────────────────────────────
  restaurante: {
  soda: ['refresco', 'gaseosa', 'bebida carbonatada'],
  jugo_naranja: ['zumo de naranja', 'naranja exprimida'],
  limonada: ['agua de limon', 'bebida de limon'],
  horchata: ['bebida de arroz', 'agua dulce de arroz'],
  jamaica: ['infusion de hibisco', 'agua de flor'],
  cafe: ['americano', 'infusion de cafe'],
  espresso: ['cafe concentrado', 'shot de cafe'],
  cappuccino: ['cafe espumado', 'cafe con espuma'],
  latte: ['cafe con leche', 'leche con cafe'],
  malteada: ['batido', 'licuado'],
  chocolate_caliente: ['bebida de cacao', 'cacao caliente'],
  atole: ['bebida de maiz', 'bebida caliente espesa'],
  cerveza: ['birra', 'chela'],
  vino_tinto: ['vino rojo', 'vino oscuro'],
  vino_blanco: ['vino claro', 'vino ligero'],
  tequila: ['destilado de agave', 'licor de agave'],
  mezcal: ['destilado ahumado', 'licor artesanal de agave'],

  bistec: ['filete de res', 'carne asada'],
  arrachera: ['corte de res', 'carne marinada'],
  cerdo: ['carne de puerco', 'carne porcina', 'puerco'],
  pollo: ['ave', 'carne blanca'],
  pescado: ['filete marino', 'carne de mar'],
  salmon: ['pez rosado', 'pescado graso'],
  atun: ['pez azul', 'pescado rojo'],
  camarones: ['marisco', 'crustaceo'],
  pulpo: ['molusco', 'animal marino'],
  mariscos: ['frutos del mar', 'productos marinos'],

  tacos: ['antojito mexicano', 'tortilla rellena'],
  torta: ['emparedado', 'bocadillo'],
  sandwich: ['emparedado', 'bocata'],
  hamburguesa: ['burger', 'emparedado de carne'],
  pizza: ['pan horneado con queso', 'masa con ingredientes'],
  pasta: ['fideos', 'masa italiana'],
  espagueti: ['pasta larga', 'fideo largo'],
  lasagna: ['pasta en capas', 'horneado de pasta'],
  arroz: ['grano cocido', 'cereal cocido'],
  frijoles: ['legumbres', 'judias'],
  enchiladas: ['tortillas con salsa', 'platillo mexicano'],
  chilaquiles: ['totopos con salsa', 'platillo de desayuno'],
  quesadilla: ['tortilla con queso', 'antojito con queso'],
  gorditas: ['masa rellena', 'antojito grueso'],
  sopes: ['base de maiz', 'antojito pequeño'],
  huaraches: ['tortilla alargada', 'base de maiz grande'],
  pozole: ['caldo de maiz', 'sopa tradicional'],
  menudo: ['caldo de res', 'sopa de tripa'],
  caldo_res: ['sopa de res', 'caldo de carne'],
  caldo_pollo: ['sopa de pollo', 'caldo de ave'],

  hotcakes: ['panqueques', 'tortitas dulces'],
  waffles: ['panal dulce', 'masa crujiente'],
  pan_tostado: ['toast', 'pan dorado'],

  papas_fritas: ['papas doradas', 'papas crujientes'],
  ensalada: ['mezcla de vegetales', 'plato fresco'],
  guacamole: ['pure de aguacate', 'dip verde'],
  salsa: ['aderezo', 'condimento'],
  tortillas: ['pan de maiz', 'disco de masa'],
  pan: ['bolillo', 'barra de trigo'],

  helado: ['nieve', 'postre frio'],
  pastel: ['tarta', 'cake'],
  flan: ['postre de huevo dulce', 'crema cuajada'],
  gelatina: ['postre de gel', 'dulce suave'],
  churros: ['masa frita', 'dulce frito'],
  brownie: ['pastel de chocolate', 'bizcocho denso'],
  pay: ['pie', 'tarta dulce'],

  // --- expansión hasta 1000 ---

  nachos: ['totopos con queso', 'botana con queso'],
  alitas: ['alas de pollo', 'pollo frito en piezas'],
  nuggets: ['bocados de pollo', 'pollo empanizado'],
  milanesa: ['carne empanizada', 'filete empanizado'],
  fajitas: ['tiras de carne', 'carne salteada'],
  burrito: ['tortilla enrollada', 'wrap mexicano'],
  quesofundido: ['queso derretido', 'queso caliente'],
  ceviche: ['marisco marinado', 'pescado en limon'],
  coctel_mariscos: ['mezcla marina', 'mariscos en salsa'],
  tostadas: ['tortilla crujiente', 'base tostada'],

  aguachile: ['camaron en chile', 'marisco picante'],
  barbacoa: ['carne al vapor', 'carne tradicional'],
  carnitas: ['cerdo confitado', 'carne frita'],
  birria: ['caldo especiado', 'carne en salsa'],
  mole: ['salsa espesa', 'platillo con chocolate'],
  tamal: ['masa rellena', 'envuelto de maiz'],
  elote: ['maiz cocido', 'mazorca'],
  esquites: ['maiz en vaso', 'granos de elote'],
  sopa: ['caldo', 'consome'],
  consome: ['caldo ligero', 'sopa clara', 'caldo'],

  ramen: ['sopa japonesa', 'caldo con fideos'],
  sushi: ['arroz con pescado', 'rollo japones'],
  tempura: ['fritura japonesa', 'rebozado ligero'],
  curry: ['salsa especiada', 'platillo con especias'],
  kebab: ['carne asada en brocheta', 'carne giratoria'],
  falafel: ['bolas de garbanzo', 'croquetas vegetales'],
  hummus: ['pure de garbanzo', 'dip arabe'],
  paella: ['arroz español', 'arroz con mariscos'],
  risotto: ['arroz cremoso', 'arroz italiano'],
  gnocchi: ['bolas de papa', 'pasta de papa'],
  gnocchi: ['bolas de papa', 'pasta de papa'],

  //sueltas normales
  dulce: ['postre'],
  },

  // ── hardware (ferreterías) ─────────────────────────────────────────────
  hardware: {

  // herramientas manuales
  desarmador: ['destornillador', 'atornillador'],
  martillo: ['mazo', 'marro'],
  pinzas: ['alicates', 'tenazas'],
  llave: ['llave inglesa', 'llave ajustable'],
  sierra: ['serrucho'],
  formon: ['cincel', 'escoplo'],
  lima: ['escofina', 'limaton'],
  cutter: ['navaja', 'exacto'],
  navaja: ['cutter', 'cuchilla'],
  cepillo: ['garlopa', 'planeador'],
  pala: ['palin', 'lampa'],
  pico: ['zapapico', 'alcotana'],
  rastrillo: ['rastra', 'escarificador'],
  machete: ['cuchillo largo', 'hoja larga'],
  hacha: ['acha', 'segur'],
  barreta: ['pata de cabra', 'palanca'],
  palanca: ['barra', 'barra metalica'],
  prensa: ['sargento', 'abrazadera'],
  sargento: ['prensa', 'abrazadera'],
  escoba: ['cepillo de barrer', 'escobillon'],
  recogedor: ['pala de basura', 'recogebasura'],

  // herramientas eléctricas
  taladro: ['perforadora'],
  rotomartillo: ['martillo electrico', 'taladro percutor'],
  lijadora: ['pulidora'],
  pulidora: ['esmeriladora', 'amoladora'],
  esmeriladora: ['amoladora', 'moladora'],
  sierra_circular: ['cortadora circular', 'disco de corte'],
  caladora: ['sierra caladora', 'sierra de vaiven'],
  ingleteadora: ['sierra de inglete', 'cortadora angular'],
  router: ['fresadora', 'rebajadora'],
  cepillo_electrico: ['garlopa electrica', 'planeador electrico'],
  pistola_calor: ['decapador', 'soplador termico'],
  compresor: ['inflador', 'bomba de aire'],
  soldadora: ['equipo de soldar'],
  generador: ['planta electrica', 'generador de luz'],

  // medición
  metro: ['cinta metrica', 'flexometro'],
  regla: ['regla metalica', 'regla plastica'],
  escuadra: ['cartabon'],
  nivel: ['nivelador'],
  plomada: ['peso de nivel', 'linea de plomo'],
  calibrador: ['vernier', 'pie de rey'],
  micrometro: ['medidor de precision'],
  transportador: ['medidor de angulos', 'goniómetro'],

  // fijación
  clavo: ['puntilla', 'tachuela'],
  tornillo: ['tirafondo', 'rosca'],
  perno: ['bulon', 'tornillo grueso'],
  tuerca: ['rosca hembra'],
  arandela: ['rondana', 'washer'],
  taquete: ['tarugo', 'anclaje'],
  remache: ['rivet', 'clavo remachado'],
  grapa: ['grapilla', 'clip metalico'],
  abrazadera: ['brida', 'cincho'],
  cincho: ['brida', 'sujetador plastico'],

  // materiales
  alambre: ['hilo metalico', 'cable metalico'],
  cable: ['conductor', 'cableado'],
  manguera: ['tubo flexible'],
  tubo: ['conducto', 'cañeria'],
  cadena: ['eslabon', 'cadena metalica'],
  lamina: ['chapa', 'placa metalica'],
  madera: ['tabla', 'tablón'],
  triplay: ['contrachapado', 'plywood'],
  yeso: ['plaster', 'escayola'],
  cemento: ['concreto', 'mortero'],
  arena: ['grava fina'],
  grava: ['piedra', 'triturado'],
  vidrio: ['cristal'],
  acrilico: ['plastico rigido', 'plexiglas'],
  pvc: ['plastico pvc', 'polimero'],
  silicona: ['sellador', 'silicon'],
  teflon: ['cinta selladora'],
  pegamento: ['adhesivo', 'cola'],
  resina: ['epoxico', 'epoxi'],

  // pintura
  pintura: ['latex', 'recubrimiento'],
  esmalte: ['barniz', 'acabado'],
  barniz: ['sellador', 'laca'],
  laca: ['barniz', 'recubrimiento brillante'],
  thinner: ['disolvente', 'diluyente'],
  solvente: ['diluyente', 'disolvente'],
  brocha: ['pincel'],
  rodillo: ['rodillo pintor'],
  espatula: ['rasqueta', 'paleta'],
  cinta_aislar: ['cinta electrica'],
  cinta_masking: ['cinta adhesiva', 'masking tape'],

  // plomería
  llave_paso: ['valvula'],
  valvula: ['llave'],
  codo: ['conector angular'],
  niple: ['conector'],
  tee: ['conexion tee', 'union triple'],
  union: ['copla', 'acople'],
  desague: ['drenaje'],
  coladera: ['rejilla', 'sumidero'],
  sifon: ['trampa', 'curva'],
  flotador: ['boya'],
  tinaco: ['deposito', 'tanque'],
  bomba_agua: ['motobomba'],
  regadera: ['ducha'],
  lavabo: ['lavamanos'],
  inodoro: ['wc', 'retrete'],

  // electricidad
  foco: ['bombilla', 'lampara'],
  bombilla: ['foco'],
  lampara: ['luminaria'],
  apagador: ['interruptor', 'switch'],
  enchufe: ['clavija', 'plug'],
  contacto: ['tomacorriente', 'toma'],
  extension: ['alargador'],
  regulador: ['estabilizador'],
  fusible: ['protector'],
  breaker: ['interruptor termico'],
  tablero: ['panel electrico'],
  cableado: ['instalacion electrica'],

  // seguridad
  casco: ['protector de cabeza'],
  guantes: ['proteccion de manos'],
  lentes: ['gafas de seguridad'],
  mascarilla: ['cubrebocas', 'respirador'],
  arnes: ['cinturon de seguridad'],
  botas: ['calzado de seguridad'],
  chaleco: ['chaleco reflejante'],

  // organización
  caja_herramientas: ['caja de herramientas'],
  organizador: ['clasificador'],
  estante: ['repisa'],
  repisa: ['estante'],
  gabinete: ['armario'],
  carrito: ['carro de herramientas']

},
  // ── farmacia ──────────────────────────────────────────────────────────────
  farmacia: {

  // formas farmacéuticas
  pastilla: ['tableta', 'comprimido', 'gragea'],
  capsula: ['perla', 'gelcaps', 'capsula blanda'],
  medicina: ['medicamento', 'farmaco', 'remedio'],
  jarabe: ['sirope', 'solucion oral', 'liquido medicinal'],
  suspension: ['mezcla oral', 'liquido agitado', 'preparado liquido'],
  inyeccion: ['ampolleta', 'ampolla', 'inyectable'],
  supositorio: ['ovulo rectal', 'supositorio solido'],
  ovulo: ['supositorio vaginal', 'capsula vaginal'],
  crema: ['pomada', 'unguento', 'crema topica'],
  gel: ['gel topico', 'gel medicinal'],
  locion: ['emulsion', 'locion corporal', 'locion liquida'],
  spray: ['aerosol', 'atomizador', 'rociador'],
  gotas: ['solucion oftalmica', 'solucion nasal', 'gotero'],

  // analgesicos / fiebre
  aspirina: ['acido acetilsalicilico', 'analgesico', 'antipiretico'],
  paracetamol: ['acetaminofen', 'analgesico', 'antipiretico'],
  ibuprofeno: ['antiinflamatorio', 'analgesico', 'aines'],
  naproxeno: ['analgesico', 'antiinflamatorio', 'aines'],
  diclofenaco: ['antiinflamatorio', 'aines', 'analgesico'],
  ketorolaco: ['analgesico', 'aines', 'antiinflamatorio'],
  analgesico: ['calmante', 'aliviador', 'painkiller'],
  antipiretico: ['reductor de fiebre', 'antifebril'],
  antiinflamatorio: ['desinflamante', 'aines'],

  // antibióticos
  antibiotico: ['antibacteriano', 'antiinfeccioso'],
  amoxicilina: ['penicilina sintetica', 'antibiotico'],
  penicilina: ['beta lactamico', 'antibiotico'],
  azitromicina: ['macrolido', 'antibiotico'],
  cefalexina: ['cefalosporina', 'antibiotico'],

  // alergias
  antihistaminico: ['antialergico', 'bloqueador h1'],
  loratadina: ['antihistaminico', 'antialergico'],
  cetirizina: ['antihistaminico', 'antialergico'],
  fexofenadina: ['antihistaminico', 'antialergico'],
  clorfenamina: ['antihistaminico', 'antialergico'],

  // tos / gripe
  expectorante: ['mucolitico', 'fluidificante'],
  antitusivo: ['supresor de tos', 'calmante de tos'],
  ambroxol: ['mucolitico', 'expectorante'],
  bromhexina: ['fluidificante', 'mucolitico'],
  dextrometorfano: ['antitusivo', 'supresor'],
  guaifenesina: ['expectorante', 'mucolitico'],
  descongestionante: ['vasoconstrictor', 'desinflamante nasal'],
  pseudoefedrina: ['descongestionante', 'vasoconstrictor'],
  oximetazolina: ['descongestionante', 'spray nasal'],
  vaporub: ['unguento mentolado', 'balsamo'],

  // digestivo
  antiacido: ['neutralizador gastrico', 'protector estomacal'],
  omeprazol: ['inhibidor protones', 'protector gastrico'],
  pantoprazol: ['inhibidor protones', 'protector gastrico'],
  ranitidina: ['bloqueador h2', 'antiacido'],
  bismuto: ['protector estomacal', 'antidiarreico'],
  loperamida: ['antidiarreico', 'regulador intestinal'],
  suero: ['rehidratante oral', 'electrolitos'],
  probiotico: ['flora intestinal', 'bacterias buenas'],
  enzimas: ['digestivos', 'enzimas digestivas'],
  laxante: ['purgante', 'evacuante'],
  fibra: ['suplemento digestivo', 'fibra dietetica'],

  // vitaminas / suplementos
  vitamina: ['suplemento', 'multivitaminico'],
  vitamina_c: ['acido ascorbico', 'vitamina antioxidante'],
  vitamina_d: ['calciferol', 'vitamina solar'],
  vitamina_b: ['complejo b', 'vitaminas b'],
  calcio: ['suplemento mineral', 'calcio dietetico'],
  hierro: ['suplemento ferrico', 'mineral hierro'],
  zinc: ['mineral esencial', 'suplemento zinc'],
  magnesio: ['suplemento mineral', 'mineral magnesio'],
  omega3: ['acidos grasos', 'aceite de pescado'],
  colageno: ['proteina estructural', 'suplemento colageno'],
  proteina: ['suplemento proteico', 'proteina en polvo'],

  // primeros auxilios
  curita: ['bandita', 'apósito adhesivo'],
  venda: ['vendaje', 'venda elastica'],
  gasa: ['compresa', 'gasa esteril'],
  esparadrapo: ['cinta medica', 'adhesivo medico'],
  alcohol: ['antiseptico', 'alcohol isopropilico'],
  yodo: ['povidona', 'antiseptico'],
  agua_oxigenada: ['peroxido', 'antiseptico'],
  antiseptico: ['desinfectante', 'antimicrobiano'],
  desinfectante: ['antiseptico', 'bactericida'],
  suero_fisiologico: ['solucion salina', 'salina'],
  termometro: ['medidor temperatura', 'termometro digital'],
  tensiometro: ['medidor presion', 'baumanometro'],
  glucosa: ['azucar sangre', 'glucemia'],
  lanceta: ['punzador', 'aguja lanceta'],
  jeringa: ['inyector', 'jeringa hipodermica'],
  aguja: ['punta hipodermica', 'aguja medica'],

  // cuidado personal
  shampoo: ['champu', 'limpiador capilar'],
  acondicionador: ['suavizante capilar', 'hidratante cabello'],
  jabon: ['limpiador corporal', 'barra limpieza'],
  gel_antibacterial: ['desinfectante manos', 'gel alcohol'],
  desodorante: ['antitranspirante', 'control olor'],
  pasta_dental: ['dentifrico', 'crema dental'],
  enjuague_bucal: ['colutorio', 'enjuague oral'],
  hilo_dental: ['seda dental', 'limpiador interdental'],
  protector_solar: ['bloqueador', 'filtro solar'],
  crema_corporal: ['hidratante', 'locion corporal'],
  crema_facial: ['hidratante facial', 'crema rostro'],
  exfoliante: ['removedor piel', 'scrub'],
  rastrillo: ['afeitadora', 'rasuradora'],
  espuma_afeitar: ['gel afeitar', 'espuma rasurar'],

  // salud sexual
  anticonceptivo: ['control natal', 'metodo anticonceptivo'],
  condon: ['preservativo', 'profilactico'],
  prueba_embarazo: ['test embarazo', 'prueba gestacion'],
  toalla_sanitaria: ['compresa femenina', 'toalla higienica'],
  tampon: ['protector interno', 'tampon higienico'],
  copa_menstrual: ['dispositivo menstrual', 'copa sanitaria'],

  // oftalmico / oido
  gotas_ojo: ['lagrimas artificiales', 'lubricante ocular'],
  gotas_oido: ['solucion otica', 'gotas auditivas'],
  solucion_lentes: ['liquido lentes', 'limpiador lentes'],
  parche_ojo: ['protector ocular', 'parche oftalmico'],

  // otros
  insulina: ['hormona glucosa', 'control glucemico'],
  glucosamina: ['suplemento articulaciones', 'salud articular'],
  melatonina: ['regulador sueño', 'hormona sueño'],
  valeriana: ['relajante natural', 'calmante herbal'],
  te_herbal: ['infusion medicinal', 'te natural'],
  homeopatico: ['medicina alternativa', 'remedio natural'],
  fitoterapia: ['medicina herbal', 'tratamiento natural'],
  capsula_herbal: ['suplemento natural', 'capsula vegetal']

},

  // ── papeleria (papelerías y tiendas generales) ──────────────────────────
  papeleria: {

  // energía
  pila: ['bateria', 'celda', 'acumulador'],
  bateria: ['pila', 'acumulador', 'bateria recargable'],

  // bolsas / empaque
  bolsa: ['funda', 'bolsa plastica', 'bolsa de empaque'],
  funda: ['bolsa', 'cubierta', 'protector'],

  // papelería básica
  cuaderno: ['libreta', 'bloc', 'cuaderno escolar', 'notebook'],
  libreta: ['cuaderno', 'agenda', 'bloc de notas'],
  lapiz: ['lapicero', 'portaminas', 'grafito'],
  boligrafo: ['pluma', 'lapicero', 'esferografico'],
  pluma: ['boligrafo', 'lapicero', 'pluma tinta'],
  lapicero: ['boligrafo', 'pluma', 'esferografico'],
  marcador: ['plumon', 'marcador permanente', 'resaltador'],
  resaltador: ['marcatextos', 'highlighter', 'marcador fluorescente'],
  borrador: ['goma', 'goma de borrar', 'borrador de lapiz'],
  sacapuntas: ['afilador', 'tajador', 'sharpener'],
  pegamento: ['adhesivo', 'cola', 'resistol'],
  cinta: ['cinta adhesiva', 'tape', 'diurex', 'celo'],
  tape: ['cinta', 'cinta adhesiva', 'adhesivo'],
  diurex: ['cinta', 'cinta adhesiva', 'tape'],
  tijeras: ['cortador', 'tijera escolar'],
  grapas: ['grampas', 'grapa metalica'],
  engrapadora: ['grapadora', 'abrochadora'],
  corrector: ['liquid paper', 'tipp-ex', 'corrector liquido'],
  regla: ['regla plastica', 'escuadra', 'regla escolar'],
  escuadra: ['cartabon', 'escuadra escolar'],

  // organización
  carpeta: ['folder', 'archivador', 'carpeta escolar'],
  folder: ['carpeta', 'portadocumentos'],
  archivador: ['carpeta', 'organizador documentos'],
  separador: ['divisor', 'separador hojas'],
  clip: ['sujetapapeles', 'clip metalico'],
  broche: ['sujetador', 'clip grande'],
  liga: ['banda elastica', 'goma elastica'],
  goma_elastica: ['liga', 'banda elastica'],

  // impresora
  cartucho: ['toner', 'tinta impresora', 'cartucho tinta'],
  toner: ['cartucho', 'tinta laser'],
  tinta: ['tinta impresora', 'tinta liquida'],
  papel_bond: ['papel blanco', 'papel impresora', 'resma'],
  papel: ['hoja', 'papel blanco', 'papel escritura'],

  // iluminación
  foco: ['bombilla', 'ampolleta', 'bulbo', 'luz'],
  bombilla: ['foco', 'ampolleta', 'bulbo'],
  veladora: ['vela', 'cirio'],
  vela: ['veladora', 'cirio'],
  linterna: ['flashlight', 'luz portatil', 'lampara mano'],

  // limpieza
  cloro: ['blanqueador', 'lejia', 'hipoclorito'],
  blanqueador: ['cloro', 'lejia'],
  detergente: ['jabon ropa', 'limpiador ropa'],
  jabon: ['jabon barra', 'jabon tocador', 'limpiador'],
  escoba: ['cepillo barrer', 'escoba hogar'],
  mopa: ['trapeador', 'lampazo'],
  trapeador: ['mopa', 'lampazo', 'jalador'],
  jalador: ['secador piso', 'limpiador piso'],
  esponja: ['fibra', 'esponja limpieza'],
  fibra: ['esponja', 'fibra abrasiva'],

  // despensa básica
  azucar: ['endulzante', 'azucar blanca', 'azucar morena'],
  sal: ['sal mesa', 'sal yodada'],
  aceite: ['aceite vegetal', 'aceite cocina'],
  arroz: ['arroz blanco', 'arroz integral'],
  frijoles: ['habichuelas', 'porotos'],
  harina: ['harina trigo', 'harina cocina'],

  // misceláneos
  encendedor: ['lighter', 'yesquero'],
  cerillos: ['fosforos'],
  fosforos: ['cerillos'],
  pilas: ['baterias', 'acumuladores'],
  bateria_recargable: ['pila recargable', 'bateria recargable'],

  // tecnología ligera
  usb: ['memoria usb', 'flash drive'],
  memoria: ['usb', 'memoria flash'],
  cable: ['cable usb', 'cable carga'],
  cargador: ['adaptador corriente', 'cargador usb'],
  audifonos: ['auriculares', 'headphones'],

  // extras útiles
  calculadora: ['calculadora basica', 'calculadora escolar'],
  agenda: ['planner', 'organizador'],
  calendario: ['almanaque'],
  pizarra: ['pizarron', 'whiteboard'],
  gis: ['tiza'],
  tiza: ['gis'],
  plastilina: ['masa moldeable'],
  colores: ['lapices colores', 'colores madera'],
  crayones: ['ceras', 'colores cera']

},
  // ── ropa (tiendas de ropa y calzado) ─────────────────────────────────────
  ropa: {

  // tops
  camisa: ['camiseta', 'playera', 'polo', 'tshirt'],
  playera: ['camiseta', 'camisa', 'polo', 'tshirt'],
  camiseta: ['playera', 'camisa', 'tshirt'],
  blusa: ['top', 'blusa mujer'],
  polo: ['camisa polo', 'playera cuello'],
  top: ['blusa', 'crop top'],
  crop_top: ['top corto', 'blusa corta'],
  tank: ['camiseta sin mangas', 'playera tirantes'],

  // pantalones
  pantalon: ['jean', 'vaquero', 'chino', 'slacks'],
  jean: ['pantalon', 'mezclilla', 'vaquero'],
  mezclilla: ['denim', 'jean'],
  chino: ['pantalon chino', 'casual'],
  jogger: ['pants deportivos', 'pantalon jogger'],
  leggings: ['mallas', 'licras'],
  short: ['bermuda', 'pantalon corto'],
  bermuda: ['short', 'pantalon corto'],
  pants: ['pantalon deportivo', 'pants'],
  overol: ['mono', 'enterizo pantalon'],

  // faldas / vestidos
  falda: ['pollera', 'skirt'],
  minifalda: ['falda corta', 'mini skirt'],
  vestido: ['dress', 'vestido formal', 'vestido casual'],
  vestido_noche: ['vestido elegante', 'dress noche'],
  vestido_casual: ['vestido diario', 'dress casual'],

  // abrigos
  sudadera: ['hoodie', 'sweatshirt'],
  hoodie: ['sudadera', 'sweatshirt'],
  sueter: ['jersey', 'pullover'],
  chamarra: ['chaqueta', 'jacket'],
  chaqueta: ['chamarra', 'jacket', 'blazer'],
  abrigo: ['gabardina', 'coat'],
  gabardina: ['trench', 'abrigo'],
  impermeable: ['poncho', 'chubasquero'],
  chaleco: ['vest', 'chaleco sin mangas'],

  // formal
  traje: ['suit', 'conjunto formal'],
  saco: ['blazer', 'americana'],
  blazer: ['saco', 'americana'],
  corbata: ['tie', 'corbatin'],
  corbatin: ['bowtie', 'lazo'],
  camisa_vestir: ['camisa formal', 'dress shirt'],

  // accesorios
  panuelo: ['mascada', 'scarf'],
  bufanda: ['chalina', 'scarf'],
  gorra: ['cachucha', 'cap'],
  cachucha: ['gorra', 'cap'],
  sombrero: ['hat', 'fedora', 'panama'],
  cinturon: ['correa', 'cinto'],
  correa: ['cinturon', 'cinto'],
  lentes: ['gafas', 'anteojos'],
  reloj: ['watch', 'reloj pulsera'],

  // interior
  ropa_interior: ['ropa intima', 'lenceria'],
  calzon: ['trusa', 'interior'],
  calzoncillo: ['boxer', 'trusa'],
  boxer: ['calzoncillo', 'interior'],
  tanga: ['ropa interior', 'panty'],
  brassier: ['bra', 'sujetador'],
  bra: ['brassier', 'sujetador'],
  sujetador: ['bra', 'brassier'],
  pijama: ['ropa dormir', 'sleepwear'],
  bata: ['albornoz', 'robe'],

  // calcetería
  calcetin: ['media corta', 'sock'],
  calcetas: ['calcetin', 'medias'],
  medias: ['pantimedia', 'tights'],
  pantimedia: ['medias', 'tights'],

  // calzado
  tenis: ['sneakers', 'zapatillas'],
  zapatillas: ['tenis', 'sneakers'],
  zapatos: ['calzado', 'zapato vestir'],
  calzado: ['zapatos', 'tenis'],
  botas: ['botines', 'boots'],
  botines: ['botas cortas', 'ankle boots'],
  sandalias: ['chanclas', 'huaraches'],
  chanclas: ['sandalias', 'flipflops'],
  tacones: ['zapatos tacón', 'heels'],

  // deportivo
  ropa_deportiva: ['sportswear', 'activewear'],
  short_deportivo: ['short gym', 'short ejercicio'],
  top_deportivo: ['bra deportivo', 'top gym'],
  pants_deportivos: ['pants gym', 'pantalon deportivo'],

  // playa
  traje_bano: ['bikini', 'traje playa'],
  bikini: ['traje bano', 'bikini mujer'],
  pareo: ['falda playa', 'wrap playa'],

  // extras útiles
  uniforme: ['ropa laboral', 'uniforme trabajo'],
  overol_trabajo: ['mono trabajo', 'overol'],
  guantes: ['gloves'],
  cinturilla: ['faja', 'waistband'],
  faja: ['cinturilla', 'shapewear']

},

  // ── otro (tipo genérico / sin clasificar) ─────────────────────────────────
  otro: {

  producto: ['articulo', 'item', 'mercancia', 'bien'],
  articulo: ['producto', 'item', 'mercancia'],
  item: ['producto', 'articulo', 'unidad'],
  mercancia: ['producto', 'articulo', 'inventario'],

  precio: ['costo', 'valor', 'tarifa', 'importe'],
  costo: ['precio', 'valor', 'tarifa'],
  valor: ['precio', 'costo', 'importe'],
  tarifa: ['precio', 'costo', 'cobro'],

  oferta: ['promocion', 'descuento', 'rebaja', 'liquidacion'],
  promocion: ['oferta', 'descuento', 'promo'],
  descuento: ['oferta', 'rebaja', 'promocion', 'promo'],
  rebaja: ['descuento', 'oferta'],

  envio: ['entrega', 'delivery', 'domicilio'],
  entrega: ['envio', 'delivery', 'despacho'],
  delivery: ['envio', 'entrega', 'domicilio'],
  domicilio: ['envio', 'entrega a casa'],

  garantia: ['respaldo', 'cobertura', 'proteccion'],
  respaldo: ['garantia', 'cobertura'],
  cobertura: ['garantia', 'proteccion'],

  devolucion: ['cambio', 'reembolso', 'retorno'],
  cambio: ['devolucion', 'intercambio'],
  reembolso: ['devolucion', 'retorno'],

  catalogo: ['lista productos', 'inventario', 'catalogo online'],
  inventario: ['catalogo', 'stock', 'existencias'],
  stock: ['inventario', 'existencias', 'disponibilidad'],

  disponibilidad: ['stock', 'existencia', 'hay'],
  existencia: ['stock', 'disponibilidad'],

  tienda: ['negocio', 'local', 'establecimiento'],
  local: ['tienda', 'negocio'],
  negocio: ['tienda', 'empresa', 'comercio'],

  compra: ['adquisicion', 'orden', 'pedido'],
  pedido: ['orden', 'compra', 'solicitud'],
  orden: ['pedido', 'compra'],

  pago: ['cobro', 'transaccion', 'abono'],
  cobro: ['pago', 'cargo'],
  transaccion: ['pago', 'operacion'],

  cliente: ['usuario', 'comprador', 'consumidor'],
  usuario: ['cliente', 'comprador'],
  comprador: ['cliente', 'usuario'],

  soporte: ['ayuda', 'atencion', 'servicio cliente'],
  ayuda: ['soporte', 'asistencia'],
  atencion: ['soporte', 'servicio cliente'],

  factura: ['recibo', 'comprobante', 'ticket'],
  recibo: ['factura', 'comprobante'],
  comprobante: ['factura', 'recibo'],

  garantia_extendida: ['garantia adicional', 'proteccion extendida']

},
};


// ── Pre-normalized lookup (built once at load time) ──────────────────────────
const _NORMALIZED_MAP = {};
for (const [category, entries] of Object.entries(SYNONYM_MAP)) {
  _NORMALIZED_MAP[category] = {};
  for (const [term, synonyms] of Object.entries(entries)) {
    _NORMALIZED_MAP[category][_n(term)] = synonyms.map(_n);
  }
}

// ── Reverse mappings (generadas automáticamente) ──────────────────────────────
// Para cada  term → [syn1, syn2]  se agrega también  syn1 → [term, syn2]  y
// syn2 → [term, syn1], de modo que la búsqueda funcione en ambos sentidos.
// Ejemplo:  elote → ['maiz cocido', 'mazorca']
//           genera:  mazorca → ['elote', 'maiz cocido']
//                    maiz cocido → ['elote', 'mazorca']
// Las entradas ya definidas explícitamente por el usuario tienen prioridad y
// no se sobreescriben.
for (const catMap of Object.values(_NORMALIZED_MAP)) {
  const toAdd = {};
  for (const [term, synonyms] of Object.entries(catMap)) {
    for (const syn of synonyms) {
      if (catMap[syn] !== undefined || toAdd[syn] !== undefined) continue;
      toAdd[syn] = [term, ...synonyms.filter((s) => s !== syn)];
    }
  }
  Object.assign(catMap, toAdd);
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns synonyms for `term` within a specific business category.
 *
 * @param {string} term       User search term
 * @param {string} category   One of the SYNONYM_MAP keys
 * @returns {string[]}        Array of synonyms (empty if none found)
 *
 * @example
 *   getSynonym('soda', 'restaurante')  // → ['refresco', 'gaseosa']
 *   getSynonym('tornillo', 'ferreteria') // → ['tirafondo', 'perno', ...]
 */
function getSynonym(term, category) {
  const map = _NORMALIZED_MAP[category];
  if (!map) return [];
  return map[_n(term)] ?? [];
}

/**
 * Returns synonyms for `term` across ALL categories, deduplicated.
 * Use this when the business type is unknown or when you want maximum coverage.
 *
 * @param {string} term
 * @returns {string[]}
 *
 * @example
 *   getSynonymsAcrossCategories('soda')  // → ['refresco', 'gaseosa', 'bebida']
 */
function getSynonymsAcrossCategories(term) {
  const key = _n(term);
  const found = new Set();
  for (const map of Object.values(_NORMALIZED_MAP)) {
    for (const syn of (map[key] ?? [])) {
      found.add(syn);
    }
  }
  return [...found];
}

/**
 * Returns all available category names.
 * Useful for validation or building dynamic synonym tables.
 *
 * @returns {string[]}
 */
function getCategories() {
  return Object.keys(SYNONYM_MAP);
}

// ── Caché en memoria: businessId → tipo de negocio (string|null) ──────────────────
// Se consulta la BD solo una vez por negocio durante la vida del proceso.
const _businessTypeCache = new Map();

/**
 * Consulta `business_types` a través de `businesses.category` para obtener
 * el nombre del tipo de negocio y mapearlo a una clave de SYNONYM_MAP.
 *
 * Relación: businesses.category (FK) → business_types.id
 *            business_types.name   → clave en SYNONYM_MAP
 *
 * Claves válidas: 'restaurante' | 'hardware' | 'papeleria' |
 *                 'farmacia'    | 'ropa'     | 'otro'
 *
 * @param {number} businessId
 * @returns {Promise<string|null>}
 */
async function _resolveBusinessType(businessId) {
  if (_businessTypeCache.has(businessId)) {
    return _businessTypeCache.get(businessId);
  }

  let type = null;
  try {
    // businesses.category es FK hacia business_types.id
    const result = await db.query(
      `SELECT bt.name
       FROM businesses b
       JOIN business_types bt ON bt.id = b.category
       WHERE b.id = $1
       LIMIT 1`,
      [businessId]
    );
    if (result.rows.length > 0) {
      const raw = _n(result.rows[0].name); // normaliza para comparar sin tildes/mayúsculas
      // El nombre en BD debe coincidir con una clave de SYNONYM_MAP
      if (_NORMALIZED_MAP[raw]) {
        type = raw;
      }
    }
  } catch {
    // BD no disponible — se usa fallback sin limitar por tipo
  }

  _businessTypeCache.set(businessId, type);
  return type;
}

/**
 * Devuelve sinónimos para `term` usando el tipo de negocio real del chat.
 * Primero consulta la BD (cacheada) para determinar el bucket correcto y
 * limita las sugerencias a ese vocabulario. Solo si no hay coincidencia
 * dentro del bucket — o si el tipo no pudo resolverse — cae al búsqueda
 * global entre todos los tipos.
 *
 * Este es el método que debe usar el pipeline de búsqueda.
 *
 * @param {string} term
 * @param {number} businessId
 * @returns {Promise<string[]>}
 *
 * @example
 *   // Negocio tipo 'restaurante':
 *   await getSynonymsByBusinessId('soda', 5)  // → ['refresco', 'gaseosa', ...]
 *   // Negocio tipo 'hardware':
 *   await getSynonymsByBusinessId('desarmador', 3)  // → ['destornillador', ...]
 */
async function getSynonymsByBusinessId(term, businessId) {
  const type = await _resolveBusinessType(businessId);

  if (type) {
    const scoped = getSynonym(term, type);
    if (scoped.length > 0) return scoped;
    // Term not in this business type's vocabulary.
    // Fall through to cross-bucket search so terms added to any bucket
    // are still found (e.g. a restaurant with dulce → postre).
  }

  // Tipo desconocido o término no encontrado en el bucket: buscar en todos.
  return getSynonymsAcrossCategories(term);
}

export {
  SYNONYM_MAP,
  getSynonym,
  getSynonymsAcrossCategories,
  getSynonymsByBusinessId,
  getCategories,
};

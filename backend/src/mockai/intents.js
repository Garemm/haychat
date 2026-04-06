'use strict';

/**
 * src/mockai/intents.js
 *
 * Configuración de intenciones con keywords ponderadas (weighted scoring).
 *
 * ESTRUCTURA:
 *   Cada intent tiene:
 *     - name: nombre interno del intent
 *     - standalone: si la intención se responde sin necesitar entidad/contexto
 *     - keywords: array de { phrase, weight }
 *       - weight 3: frase completa muy específica (máxima confianza)
 *       - weight 2: frase parcial o combinación de palabras
 *       - weight 1: palabra suelta (puede ser ambigua)
 *
 * REGLA DE ORO:
 *   Palabras ambiguas como "tienen" NO aparecen aquí.
 *   Solo aparecen en combinaciones específicas (ej: "tienen descuentos" → promociones).
 *
 * AGREGAR INTENCIONES:
 *   1. Agregar nueva clave al objeto con name, standalone y keywords
 *   2. Registrar en businessInfoService.js (QUERY_MAP)
 *   3. Registrar en intentResponseFormatter.js (FORMATTERS)
 *   4. No se modifica intentDetector.js ni el pipeline
 */

const intents = {
  horarios: {
    name: 'horarios',
    standalone: true,
    keywords: [
      // Frases completas (weight 3)
      { phrase: 'a que hora abren', weight: 3 },
      { phrase: 'a que hora cierran', weight: 3 },
      { phrase: 'horario de atencion', weight: 3 },
      { phrase: 'horario de apertura', weight: 3 },
      { phrase: 'horario de cierre', weight: 3 },
      { phrase: 'que dias atienden', weight: 3 },
      { phrase: 'cuales son sus horarios', weight: 3 },
      { phrase: 'hasta que hora atienden', weight: 3 },
      { phrase: 'estan abiertos ahora', weight: 3 },
      { phrase: 'que horario manejan', weight: 3 },
      { phrase: 'me pueden decir el horario', weight: 3 },
      { phrase: 'a que hora puedo ir', weight: 3 },
      // Segunda persona singular (tú): "a qué hora abres?", "qué día abres?"
      { phrase: 'a que hora abres', weight: 3 },
      { phrase: 'a que hora cierras', weight: 3 },
      { phrase: 'que dias abres', weight: 3 },
      { phrase: 'que dia abres', weight: 3 },
      { phrase: 'que dias cierran', weight: 3 },
      { phrase: 'que dias cierra', weight: 3 },
      { phrase: 'que dias cierras', weight: 3 },
      { phrase: 'que dia cierras', weight: 3 },
      { phrase: 'que dias vendes', weight: 3 },
      // Frases parciales (weight 2)
      { phrase: 'está abierto', weight: 2 },
      { phrase: 'está abierto hoy', weight: 2 },
      { phrase: 'cuando abres', weight: 2 },
      { phrase: 'cuando cierras', weight: 2 },
      { phrase: 'cuando abren', weight: 2 },
      { phrase: 'cuando cierran', weight: 2 },
      { phrase: 'horario del negocio', weight: 2 },
      { phrase: 'atienden los domingos', weight: 2 },
      { phrase: 'atienden los sabados', weight: 2 },
      { phrase: 'atienden fines de semana', weight: 2 },
      { phrase: 'abren mañana', weight: 2 },
      { phrase: 'abren hoy', weight: 2 },
      { phrase: 'abre hoy', weight: 2 },
      { phrase: 'hoy', weight: 2 },
      { phrase: 'abren toda la semana', weight: 3 },
      { phrase: 'abren todos los dias', weight: 3 },
      { phrase: 'atienden toda la semana', weight: 3 },
      { phrase: 'toda la semana', weight: 2 },
      { phrase: 'fines de semana', weight: 2 },
      // Palabras sueltas (weight 1)
      { phrase: 'horarios', weight: 1 },
      { phrase: 'horario', weight: 1 },
      { phrase: 'abren', weight: 1 },
      { phrase: 'abres', weight: 1 },
      { phrase: 'cierras', weight: 1 },
    ],
  },

  productos: {
    name: 'productos',
    standalone: false,
    keywords: [
      // Frases completas (weight 3)
      { phrase: 'que productos tienen', weight: 3 },
      { phrase: 'que productos tienes', weight: 3 },
      { phrase: 'que productos tiene', weight: 3 },
      { phrase: 'que venden', weight: 3 },
      { phrase: 'que vendes', weight: 3 },
      { phrase: 'que vende', weight: 3 },
      { phrase: 'catalogo de productos', weight: 3 },
      { phrase: 'lista de productos', weight: 3 },
      { phrase: 'me pueden mostrar sus productos', weight: 3 },
      { phrase: 'que tienen para vender', weight: 3 },
      { phrase: 'que tienes para vender', weight: 3 },
      { phrase: 'que tiene para vender', weight: 3 },
      { phrase: 'que articulos manejan', weight: 3 },
      { phrase: 'que articulos tienes', weight: 3 },
      { phrase: 'que articulos tiene', weight: 3 },
      // Frases parciales (weight 2)
      { phrase: 'hay stock', weight: 2 },
      { phrase: 'tienen en existencia', weight: 2 },
      { phrase: 'tienes en existencia', weight: 2 },
      { phrase: 'hay disponibilidad', weight: 2 },
      { phrase: 'tienen inventario', weight: 2 },
      { phrase: 'tienes inventario', weight: 2 },
      { phrase: 'manejan productos', weight: 2 },
      { phrase: 'venden productos', weight: 2 },
      { phrase: 'que productos vende', weight: 2 },
      { phrase: 'que tienes', weight: 2 },
      { phrase: 'que tiene', weight: 2 },
      { phrase: 'que tipo de', weight: 2 },
      { phrase: 'que tipos de', weight: 2 },
      { phrase: 'productos disponibles', weight: 2 },
      { phrase: 'ver productos', weight: 2 },
      { phrase: 'ver catalogo', weight: 2 },
      // Palabras sueltas (weight 1)
      { phrase: 'catalogo', weight: 1 },
      { phrase: 'inventario', weight: 1 },
      { phrase: 'productos', weight: 1 },
    ],
  },

  precios: {
    name: 'precios',
    standalone: false,
    keywords: [
      // Frases completas (weight 3)
      { phrase: 'cuanto cuesta', weight: 3 },
      { phrase: 'cuanto vale', weight: 3 },
      { phrase: 'cual es el precio', weight: 3 },
      { phrase: 'que precio tiene', weight: 3 },
      { phrase: 'me puede dar el precio', weight: 3 },
      { phrase: 'cuanto me cobra', weight: 3 },
      { phrase: 'en cuanto esta', weight: 3 },
      { phrase: 'me dicen el costo', weight: 3 },
      { phrase: 'cuanto costaria', weight: 3 },
      // Frases parciales (weight 2)
      { phrase: 'precio de lista', weight: 2 },
      { phrase: 'precio por unidad', weight: 2 },
      { phrase: 'precio al mayoreo', weight: 2 },
      { phrase: 'precio al menudeo', weight: 2 },
      { phrase: 'precio especial', weight: 2 },
      { phrase: 'cuanto sale', weight: 2 },
      { phrase: 'es caro o barato', weight: 2 },
      // Palabras sueltas (weight 1)
      { phrase: 'precio', weight: 1 },
      { phrase: 'costo', weight: 1 },
      { phrase: 'tarifa', weight: 1 },
    ],
  },

  promociones: {
    name: 'promociones',
    standalone: true,
    keywords: [
      // Frases completas (weight 3)
      { phrase: 'tienen promociones', weight: 3 },
      { phrase: 'hay promociones', weight: 3 },
      { phrase: 'tienen descuentos', weight: 3 },
      { phrase: 'descuentos disponibles', weight: 3 },
      { phrase: 'hay ofertas', weight: 3 },
      { phrase: 'tienen ofertas', weight: 3 },
      { phrase: 'hay algo en oferta', weight: 3 },
      { phrase: 'promocion del dia', weight: 3 },
      { phrase: 'oferta especial', weight: 3 },
      { phrase: 'cuando hay promociones', weight: 3 },
      { phrase: 'tienen programa de lealtad', weight: 3 },
      // Frases parciales (weight 2)
      { phrase: 'dos por uno', weight: 2 },
      { phrase: '2x1', weight: 2 },
      { phrase: 'cupon de descuento', weight: 2 },
      { phrase: 'codigo de descuento', weight: 2 },
      { phrase: 'precio rebajado', weight: 2 },
      { phrase: 'paga uno lleva dos', weight: 2 },
      // Palabras sueltas (weight 1)
      { phrase: 'promocion', weight: 1 },
      { phrase: 'descuento', weight: 1 },
      { phrase: 'oferta', weight: 1 },
      { phrase: 'liquidacion', weight: 1 },
      { phrase: 'remate', weight: 1 },
    ],
  },

  descripcion: {
    name: 'descripcion',
    standalone: false,
    keywords: [
      // Frases con "que + verbo 3ª persona" (también cubiertas por prioridad en intentDetector)
      { phrase: 'que contiene', weight: 3 },
      { phrase: 'que contienen', weight: 3 },
      { phrase: 'que incluye', weight: 3 },
      { phrase: 'que lleva', weight: 3 },
      { phrase: 'que llevan', weight: 3 },
      { phrase: 'que incluyen', weight: 3 },
      { phrase: 'que trae', weight: 3 },
      { phrase: 'que traen', weight: 3 },
      { phrase: 'de que esta hecho', weight: 3 },
      // Frases descriptivas explícitas (weight 3)
      { phrase: 'caracteristicas de', weight: 3 },
      { phrase: 'especificaciones de', weight: 3 },
      { phrase: 'descripcion de', weight: 3 },
      { phrase: 'informacion de', weight: 3 },
      // Palabras sueltas descriptivas (weight 2)
      { phrase: 'caracteristicas', weight: 2 },
      { phrase: 'especificaciones', weight: 2 },
    ],
  },

  ubicacion: {
    name: 'ubicacion',
    standalone: true,
    keywords: [
      // Frases completas (weight 3)
      { phrase: 'donde estan ubicados', weight: 3 },
      { phrase: 'donde quedan', weight: 3 },
      { phrase: 'cual es su direccion', weight: 3 },
      { phrase: 'me dan la direccion', weight: 3 },
      { phrase: 'como llego', weight: 3 },
      { phrase: 'como los encuentro', weight: 3 },
      { phrase: 'donde puedo ir a verlos', weight: 3 },
      { phrase: 'me comparten su ubicacion', weight: 3 },
      { phrase: 'tienen tienda fisica', weight: 3 },
      { phrase: 'en que colonia estan', weight: 3 },
      { phrase: 'en que ciudad estan', weight: 3 },
      // Frases parciales (weight 2)
      { phrase: 'tienen sucursales', weight: 2 },
      { phrase: 'cuantas sucursales', weight: 2 },
      { phrase: 'en que zona estan', weight: 2 },
      { phrase: 'mapa de ubicacion', weight: 2 },
      { phrase: 'google maps', weight: 2 },
      // Palabras sueltas (weight 1)
      { phrase: 'ubicacion', weight: 1 },
      { phrase: 'direccion', weight: 1 },
      { phrase: 'sucursal', weight: 1 },
    ],
  },

  servicios: {
    name: 'servicios',
    standalone: true,
    keywords: [
      // Frases completas (weight 3)
      { phrase: 'que servicios ofrecen', weight: 3 },
      { phrase: 'que servicios ofrece', weight: 3 },
      { phrase: 'que servicios tienes', weight: 3 },
      { phrase: 'que servicios tienen', weight: 3 },
      { phrase: 'que servicios manejan', weight: 3 },
      { phrase: 'lista de servicios', weight: 3 },
      { phrase: 'tienen servicios', weight: 3 },
      { phrase: 'manejan servicios', weight: 3 },
      { phrase: 'ofrecen servicios', weight: 3 },
      // Consultas sobre un servicio específico (weight 3)
      { phrase: 'tienen servicio de', weight: 3 },
      { phrase: 'tienes servicio de', weight: 3 },
      { phrase: 'hay servicio de', weight: 3 },
      { phrase: 'ofrecen servicio de', weight: 3 },
      { phrase: 'ofrece servicio de', weight: 3 },
      { phrase: 'cuentan con servicio de', weight: 3 },
      { phrase: 'servicio de', weight: 3 },
      // Frases parciales (weight 2)
      { phrase: 'servicios disponibles', weight: 2 },
      { phrase: 'sus servicios', weight: 2 },
      { phrase: 'los servicios', weight: 2 },
      // Palabras sueltas (weight 1)
      { phrase: 'servicios', weight: 1 },
      { phrase: 'servicio', weight: 1 },
    ],
  },

  comprar: {
    name: 'comprar',
    standalone: true,
    keywords: [
      // Frases completas (weight 3)
      { phrase: 'quiero comprar',          weight: 3 },
      { phrase: 'como puedo comprar',      weight: 3 },
      { phrase: 'como compro',             weight: 3 },
      { phrase: 'donde puedo comprar',     weight: 3 },
      { phrase: 'quiero hacer un pedido',  weight: 3 },
      { phrase: 'como hago un pedido',     weight: 3 },
      { phrase: 'como puedo pedir',        weight: 3 },
      { phrase: 'quiero ordenar',          weight: 3 },
      { phrase: 'como ordeno',             weight: 3 },
      { phrase: 'quiero adquirir',         weight: 3 },
      { phrase: 'como lo adquiero',        weight: 3 },
      { phrase: 'puedo comprar en linea',  weight: 3 },
      { phrase: 'tienen tienda en linea',  weight: 3 },
      { phrase: 'venden en linea',         weight: 3 },
      // Frases parciales (weight 2)
      { phrase: 'hacer pedido',            weight: 2 },
      { phrase: 'realizar pedido',         weight: 2 },
      { phrase: 'realizar compra',         weight: 2 },
      { phrase: 'comprar en linea',        weight: 2 },
      { phrase: 'tienda en linea',         weight: 2 },
      { phrase: 'quiero pedirlo',          weight: 2 },
      // Intención de compra post-resultado (weight 3)
      { phrase: 'quiero una',          weight: 3 },
      { phrase: 'quiero uno',          weight: 3 },
      { phrase: 'lo quiero',               weight: 3 },
      { phrase: 'la quiero',               weight: 3 },
      { phrase: 'lo quiero comprar',       weight: 3 },
      { phrase: 'la quiero comprar',       weight: 3 },
      { phrase: 'quiero comprarlo',        weight: 3 },
      { phrase: 'quiero comprarla',        weight: 3 },
      { phrase: 'me lo llevo',             weight: 3 },
      { phrase: 'me la llevo',             weight: 3 },
      { phrase: 'voy a comprarlo',         weight: 3 },
      { phrase: 'voy a comprarla',         weight: 3 },
      { phrase: 'damelo',                  weight: 3 },
      { phrase: 'damela',                  weight: 3 },
      { phrase: 'deme uno',                weight: 3 },
      { phrase: 'deme una',                weight: 3 },
      { phrase: 'como lo pido',            weight: 3 },
      { phrase: 'como la pido',            weight: 3 },
      { phrase: 'quiero ese',              weight: 2 },
      { phrase: 'quiero esa',              weight: 2 },
      { phrase: 'lo compro',               weight: 2 },
      { phrase: 'la compro',               weight: 2 },
      { phrase: 'me lo das',               weight: 2 },
      { phrase: 'me la das',               weight: 2 },
      { phrase: 'lo pido',                 weight: 2 },
      { phrase: 'la pido',                 weight: 2 },
      // Palabras sueltas (weight 1)
      { phrase: 'comprar',                 weight: 1 },
      { phrase: 'pedido',                  weight: 1 },
      { phrase: 'ordenar',                 weight: 1 },
    ],
  },

  contacto: {
    name: 'contacto',
    standalone: true,
    keywords: [
      // ── Teléfono / celular (weight 3) ──────────────────────────────
      { phrase: 'numero de telefono',          weight: 3 },
      { phrase: 'numero de celular',           weight: 3 },
      { phrase: 'cual es su telefono',         weight: 3 },
      { phrase: 'cual es su numero',           weight: 3 },
      { phrase: 'cual es el numero',           weight: 3 },
      { phrase: 'tienen telefono',             weight: 3 },
      { phrase: 'tienen celular',              weight: 3 },
      { phrase: 'tienen numero',               weight: 3 },
      { phrase: 'me dan su telefono',          weight: 3 },
      { phrase: 'me dan su numero',            weight: 3 },
      { phrase: 'me pueden dar su numero',     weight: 3 },
      { phrase: 'a que numero llamo',          weight: 3 },
      { phrase: 'a donde llamo',               weight: 3 },
      { phrase: 'a donde puedo llamar',        weight: 3 },
      { phrase: 'puedo llamarles',             weight: 3 },
      { phrase: 'puedo llamarlos',             weight: 3 },
      { phrase: 'numero para llamar',          weight: 3 },
      { phrase: 'numero para contactarlos',    weight: 3 },
      { phrase: 'su numero de contacto',       weight: 3 },
      // ── Correo (weight 3) ──────────────────────────────────────────
      { phrase: 'correo electronico',          weight: 3 },
      { phrase: 'cual es su correo',           weight: 3 },
      { phrase: 'cual es su email',            weight: 3 },
      { phrase: 'me dan su correo',            weight: 3 },
      { phrase: 'tienen correo',               weight: 3 },
      { phrase: 'tienen email',                weight: 3 },
      { phrase: 'a que correo escribo',        weight: 3 },
      { phrase: 'a que email escribo',         weight: 3 },
      { phrase: 'les puedo escribir',          weight: 3 },
      { phrase: 'puedo mandarles un correo',   weight: 3 },
      { phrase: 'como les escribo',            weight: 3 },
      // ── Sitio web (weight 3) ───────────────────────────────────────
      { phrase: 'pagina web',                  weight: 3 },
      { phrase: 'sitio web',                   weight: 3 },
      { phrase: 'tienen pagina web',           weight: 3 },
      { phrase: 'tienen sitio web',            weight: 3 },
      { phrase: 'tienen pagina',               weight: 3 },
      { phrase: 'tienen pagina de internet',   weight: 3 },
      { phrase: 'cual es su pagina',           weight: 3 },
      { phrase: 'cual es su sitio',            weight: 3 },
      { phrase: 'cual es su web',              weight: 3 },
      { phrase: 'me dan su pagina',            weight: 3 },
      // ── Contacto general (weight 3) ────────────────────────────────
      { phrase: 'como me comunico',            weight: 3 },
      { phrase: 'como los contacto',           weight: 3 },
      { phrase: 'como puedo contactarlos',     weight: 3 },
      { phrase: 'como me puedo comunicar',     weight: 3 },
      { phrase: 'datos de contacto',           weight: 3 },
      { phrase: 'informacion de contacto',     weight: 3 },
      // ── Frases parciales (weight 2) ────────────────────────────────
      { phrase: 'contactar',                   weight: 2 },
      { phrase: 'comunicarme',                 weight: 2 },
      { phrase: 'su whatsapp',                 weight: 2 },
      { phrase: 'su correo',                   weight: 2 },
      { phrase: 'su telefono',                 weight: 2 },
      { phrase: 'su celular',                  weight: 2 },
      { phrase: 'su pagina',                   weight: 2 },
      { phrase: 'su sitio',                    weight: 2 },
      { phrase: 'llamarles',                   weight: 2 },
      { phrase: 'llamarlos',                   weight: 2 },
      // ── Palabras sueltas (weight 1) ────────────────────────────────
      { phrase: 'telefono',                    weight: 1 },
      { phrase: 'celular',                     weight: 1 },
      { phrase: 'correo',                      weight: 1 },
      { phrase: 'email',                       weight: 1 },
      { phrase: 'whatsapp',                    weight: 1 },
      { phrase: 'llamar',                      weight: 1 },
    ],
  },
};

module.exports = intents;

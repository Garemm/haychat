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
    // =========================
    // Frases completas (weight 3)
    // =========================
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

    // Variaciones comunes
    { phrase: 'me puedes decir el horario', weight: 3 },
    { phrase: 'me dices tu horario', weight: 3 },
    { phrase: 'me dices cuando abren', weight: 3 },
    { phrase: 'me dices cuando cierran', weight: 3 },
    { phrase: 'cual es su horario hoy', weight: 3 },
    { phrase: 'cual es su horario mañana', weight: 3 },
    { phrase: 'trabajan hoy', weight: 3 },
    { phrase: 'trabajan mañana', weight: 3 },
    { phrase: 'estan trabajando hoy', weight: 3 },

    // Segunda persona (tú)
    { phrase: 'a que hora abres', weight: 3 },
    { phrase: 'a que hora cierras', weight: 3 },
    { phrase: 'que dias abres', weight: 3 },
    { phrase: 'que dia abres', weight: 3 },
    { phrase: 'que dias cierran', weight: 3 },
    { phrase: 'que dias cierra', weight: 3 },
    { phrase: 'que dias cierras', weight: 3 },
    { phrase: 'que dia cierras', weight: 3 },

    // Lenguaje casual / México
    { phrase: 'a que hora empiezan a atender', weight: 3 },
    { phrase: 'a que hora dejan de atender', weight: 3 },
    { phrase: 'a que hora empiezan a trabajar', weight: 3 },
    { phrase: 'a que hora terminan de trabajar', weight: 3 },
    { phrase: 'andan abiertos ahorita', weight: 3 },
    { phrase: 'andan trabajando ahorita', weight: 3 },
    { phrase: 'andan jalando ahorita', weight: 3 },
    { phrase: 'estan jalando', weight: 3 },
    { phrase: 'si estan abiertos ahorita', weight: 3 },

    // Slang / muy casual
    { phrase: 'a que hora abren o que', weight: 3 },
    { phrase: 'si abren o no', weight: 3 },
    { phrase: 'estan abiertos o que', weight: 3 },
    { phrase: 'andan abiertos o nel', weight: 3 },

    // =========================
    // Frases parciales (weight 2)
    // =========================
    { phrase: 'esta abierto', weight: 2 },
    { phrase: 'esta abierto hoy', weight: 2 },
    { phrase: 'estan abiertos hoy', weight: 2 },
    { phrase: 'cuando abres', weight: 2 },
    { phrase: 'cuando cierras', weight: 2 },
    { phrase: 'cuando abren', weight: 2 },
    { phrase: 'cuando cierran', weight: 2 },
    { phrase: 'horario del negocio', weight: 2 },

    // Días específicos
    { phrase: 'atienden los domingos', weight: 2 },
    { phrase: 'atienden los sabados', weight: 2 },
    { phrase: 'abren los domingos', weight: 2 },
    { phrase: 'abren los sabados', weight: 2 },
    { phrase: 'trabajan domingos', weight: 2 },
    { phrase: 'trabajan sabados', weight: 2 },

    // Referencias de tiempo
    { phrase: 'abren mañana', weight: 2 },
    { phrase: 'abren hoy', weight: 2 },
    { phrase: 'abre hoy', weight: 2 },
    { phrase: 'abren en la tarde', weight: 2 },
    { phrase: 'abren en la noche', weight: 2 },
    { phrase: 'abren temprano', weight: 2 },
    { phrase: 'cierran tarde', weight: 2 },

    // Semana
    { phrase: 'abren toda la semana', weight: 3 },
    { phrase: 'abren todos los dias', weight: 3 },
    { phrase: 'atienden toda la semana', weight: 3 },
    { phrase: 'trabajan toda la semana', weight: 3 },
    { phrase: 'toda la semana', weight: 2 },
    { phrase: 'fines de semana', weight: 2 },
    { phrase: 'fin de semana', weight: 2 },

    // =========================
    // Disponibilidad implícita (weight 3)
    // "¿todavía alcanzo?" / "¿ya cerraron?" — implicitly ask if open NOW
    // =========================
    { phrase: 'todavia alcanzo', weight: 3 },
    { phrase: 'aun alcanzo', weight: 3 },
    { phrase: 'aun hay servicio', weight: 3 },
    { phrase: 'ya cerraron', weight: 3 },
    { phrase: 'ya cerraste', weight: 3 },
    { phrase: 'ya abrieron', weight: 3 },
    { phrase: 'ya abriste', weight: 3 },
    { phrase: 'siguen abiertos', weight: 3 },
    { phrase: 'todavia estan abiertos', weight: 3 },
    { phrase: 'ya estan cerrados', weight: 3 },
    { phrase: 'aun puedo pasar', weight: 3 },
    { phrase: 'si todavia puedo pasar', weight: 3 },
    { phrase: 'a que hora pasan por mi', weight: 2 },
    { phrase: 'todavia atienden', weight: 3 },
    { phrase: 'ya no atienden', weight: 3 },

    // Días de venta = preguntan cuándo trabajan (horario de operación)
    { phrase: 'que dias vendes', weight: 3 },
    { phrase: 'que dias vende', weight: 3 },

    // =========================
    // Errores comunes / chat (weight 1-2)
    // =========================
    { phrase: 'a que ora abren', weight: 2 },
    { phrase: 'a que ora cierran', weight: 2 },
    { phrase: 'a k hora abren', weight: 2 },
    { phrase: 'a k hora cierran', weight: 2 },
    { phrase: 'k horario tienen', weight: 2 },
    { phrase: 'k dias abren', weight: 2 },
    { phrase: 'k dias trabajan', weight: 2 },
    { phrase: 'horaro', weight: 1 },
    { phrase: 'horaios', weight: 1 },
    { phrase: 'horairos', weight: 1 },
    { phrase: 'orabren', weight: 1 },

    // =========================
    // Palabras sueltas (weight 1)
    // =========================
    { phrase: 'horarios', weight: 1 },
    { phrase: 'horario', weight: 1 },
    { phrase: 'abren', weight: 1 },
    { phrase: 'abres', weight: 1 },
    { phrase: 'abre', weight: 1 },
    { phrase: 'cierran', weight: 1 },
    { phrase: 'cierras', weight: 1 },
    { phrase: 'cierra', weight: 1 },
    { phrase: 'atienden', weight: 1 },
    { phrase: 'atiendes', weight: 1 },
    { phrase: 'abierto', weight: 1 },
    { phrase: 'cerrado', weight: 1 },
    { phrase: 'hoy', weight: 1 },
    { phrase: 'mañana', weight: 1 },
  ],
},

  productos: {
  name: 'productos',
  standalone: false,
  keywords: [
    // =========================
    // Frases completas (weight 3)
    // =========================
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

    // Variaciones naturales
    { phrase: 'que manejan', weight: 3 },
    { phrase: 'que ofrecen', weight: 3 },
    { phrase: 'que ofrecen a la venta', weight: 3 },
    { phrase: 'que hay a la venta', weight: 3 },
    { phrase: 'cuenta con', weight: 2 },
    { phrase: 'cuentan con', weight: 2 },
    { phrase: 'cuentas con', weight: 2 },
    { phrase: 'que puedo comprar', weight: 3 },
    { phrase: 'que puedo conseguir', weight: 3 },
    { phrase: 'que tienen disponible', weight: 3 },
    { phrase: 'que tienes disponible', weight: 3 },
    { phrase: 'que tienen ahorita', weight: 3 },
    { phrase: 'que tienes ahorita', weight: 3 },

    // Más específicas
    { phrase: 'me puedes mostrar el catalogo', weight: 3 },
    { phrase: 'me enseñas tus productos', weight: 3 },
    { phrase: 'puedo ver tus productos', weight: 3 },
    { phrase: 'puedo ver el catalogo', weight: 3 },
    { phrase: 'tienen catalogo', weight: 3 },
    { phrase: 'cuentame que vendes', weight: 3 },

    // Lenguaje casual / México
    { phrase: 'que onda que venden', weight: 3 },
    { phrase: 'que traen', weight: 3 },
    { phrase: 'que traes', weight: 3 },
    { phrase: 'que hay', weight: 3 },
    { phrase: 'que tienen ahi', weight: 3 },
    { phrase: 'que tienes ahi', weight: 3 },

    // =========================
    // Frases parciales (weight 2)
    // =========================
    { phrase: 'hay stock', weight: 2 },
    { phrase: 'tienen en existencia', weight: 2 },
    { phrase: 'tienes en existencia', weight: 2 },
    { phrase: 'hay disponibilidad', weight: 2 },
    { phrase: 'tienen inventario', weight: 2 },
    { phrase: 'tienes inventario', weight: 2 },
    { phrase: 'manejan productos', weight: 2 },
    { phrase: 'venden productos', weight: 2 },

    // Exploración
    { phrase: 'que productos vende', weight: 2 },
    { phrase: 'que tienes', weight: 2 },
    { phrase: 'que tiene', weight: 2 },
    { phrase: 'que hay disponible', weight: 2 },
    { phrase: 'que hay en venta', weight: 2 },
    { phrase: 'que hay para comprar', weight: 2 },

    // Tipos / categorías
    { phrase: 'que tipo de', weight: 2 },
    { phrase: 'que tipos de', weight: 2 },
    { phrase: 'que clases de productos', weight: 2 },
    { phrase: 'que categoria manejan', weight: 2 },

    // Ver / mostrar
    { phrase: 'productos disponibles', weight: 2 },
    { phrase: 'ver productos', weight: 2 },
    { phrase: 'ver catalogo', weight: 2 },
    { phrase: 'mostrar productos', weight: 2 },
    { phrase: 'mostrar catalogo', weight: 2 },

    // Disponibilidad puntual
    { phrase: 'tienen disponible', weight: 2 },
    { phrase: 'tienes disponible', weight: 2 },
    { phrase: 'hay en existencia', weight: 2 },
    { phrase: 'queda producto', weight: 2 },

    // =========================
    // Errores comunes (weight 1-2)
    // =========================
    { phrase: 'ke venden', weight: 2 },
    { phrase: 'ke tienes', weight: 2 },
    { phrase: 'k venden', weight: 2 },
    { phrase: 'k tienes', weight: 2 },
    { phrase: 'catalogo', weight: 1 },
    { phrase: 'catalogos', weight: 1 },
    { phrase: 'producto', weight: 1 },
    { phrase: 'productos', weight: 1 },
    { phrase: 'inventario', weight: 1 },

    // =========================
    // Palabras sueltas (weight 1)
    // =========================
    { phrase: 'venden', weight: 1 },
    { phrase: 'ventas', weight: 1 },
    { phrase: 'comprar', weight: 1 },
    { phrase: 'productos', weight: 1 },
    { phrase: 'articulos', weight: 1 },
    { phrase: 'cosas', weight: 1 },
    { phrase: 'stock', weight: 1 },
    { phrase: 'disponible', weight: 1 },
  ],
},

  precios: {
  name: 'precios',
  standalone: false,
  keywords: [
    // =========================
    // Frases completas (weight 3)
    // =========================
    { phrase: 'cuanto cuesta', weight: 3 },
    { phrase: 'cuanto vale', weight: 3 },
    { phrase: 'cual es el precio', weight: 3 },
    { phrase: 'que precio tiene', weight: 3 },
    { phrase: 'me puede dar el precio', weight: 3 },
    { phrase: 'cuanto me cobra', weight: 3 },
    { phrase: 'en cuanto esta', weight: 3 },
    { phrase: 'me dicen el costo', weight: 3 },
    { phrase: 'cuanto costaria', weight: 3 },

    // Variaciones naturales
    { phrase: 'cuanto sale', weight: 3 },
    { phrase: 'cuanto me sale', weight: 3 },
    { phrase: 'en cuanto me lo dejas', weight: 3 },
    { phrase: 'cuanto es lo menos', weight: 3 },
    { phrase: 'cual es el costo', weight: 3 },
    { phrase: 'dime el precio', weight: 3 },
    { phrase: 'precio por favor', weight: 3 },
    { phrase: 'me das precio', weight: 3 },

    // Lenguaje casual / México
    { phrase: 'cuanto andan', weight: 3 },
    { phrase: 'en cuanto andan', weight: 3 },
    { phrase: 'cuanto cuestan esos', weight: 3 },
    { phrase: 'cuanto cuesta ese', weight: 3 },
    { phrase: 'en cuanto tienes eso', weight: 3 },
    { phrase: 'en cuanto tiene', weight: 3 },
    { phrase: 'en cuanto tienes', weight: 3 },
    { phrase: 'en cuanto tienen', weight: 3 },
    { phrase: 'a cuanto tiene', weight: 3 },
    { phrase: 'a cuanto tienes', weight: 3 },
    { phrase: 'a cuanto tienen', weight: 3 },

    // =========================
    // Frases parciales (weight 2)
    // =========================
    { phrase: 'precio de lista', weight: 2 },
    { phrase: 'precio por unidad', weight: 2 },
    { phrase: 'precio al mayoreo', weight: 2 },
    { phrase: 'precio al menudeo', weight: 2 },
    { phrase: 'precio especial', weight: 2 },
    { phrase: 'es caro o barato', weight: 2 },
    { phrase: 'mas barato', weight: 2 },
    { phrase: 'mas caro', weight: 2 },
    { phrase: 'precio final', weight: 2 },
    { phrase: 'incluye envio', weight: 2 },

    // =========================
    // Errores / slang (weight 1-2)
    // =========================
    { phrase: 'cuanto cuestaa', weight: 2 },
    { phrase: 'cuanto bale', weight: 2 },
    { phrase: 'cuanto kuesta', weight: 2 },
    { phrase: 'cuanto kosta', weight: 2 },
    { phrase: 'k cuesta', weight: 2 },
    { phrase: 'k vale', weight: 2 },
    { phrase: 'precioo', weight: 1 },

    // =========================
    // Palabras sueltas (weight 1)
    // =========================
    { phrase: 'precio', weight: 1 },
    { phrase: 'precios', weight: 1 },
    { phrase: 'costo', weight: 1 },
    { phrase: 'cuesta', weight: 1 },
    { phrase: 'vale', weight: 1 },
    { phrase: 'tarifa', weight: 1 },
  ],
},

  promociones: {
  name: 'promociones',
  standalone: true,
  keywords: [
    // =========================
    // Frases completas (weight 3)
    // =========================
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

    // Variaciones naturales
    { phrase: 'que promociones tienen', weight: 3 },
    { phrase: 'que ofertas hay', weight: 3 },
    { phrase: 'tienen algo en descuento', weight: 3 },
    { phrase: 'hay rebajas', weight: 3 },
    { phrase: 'tienen rebajas', weight: 3 },
    { phrase: 'hay promos', weight: 3 },
    { phrase: 'tienen promos', weight: 3 },

    // Lenguaje casual / México
    { phrase: 'hay algo mas bara', weight: 3 },
    { phrase: 'tienen algo mas barato', weight: 3 },
    { phrase: 'hay descuentito', weight: 3 },
    { phrase: 'que promos traen', weight: 3 },

    // =========================
    // Frases parciales (weight 2)
    // =========================
    { phrase: 'dos por uno', weight: 2 },
    { phrase: '2x1', weight: 2 },
    { phrase: '3x2', weight: 2 },
    { phrase: 'cupon de descuento', weight: 2 },
    { phrase: 'codigo de descuento', weight: 2 },
    { phrase: 'precio rebajado', weight: 2 },
    { phrase: 'paga uno lleva dos', weight: 2 },
    { phrase: 'envio gratis', weight: 2 },
    { phrase: 'oferta limitada', weight: 2 },

    // =========================
    // Errores / slang
    // =========================
    { phrase: 'promosion', weight: 2 },
    { phrase: 'ofertaa', weight: 1 },
    { phrase: 'deskuento', weight: 2 },
    { phrase: 'k promociones', weight: 2 },
    { phrase: 'k ofertas', weight: 2 },

    // =========================
    // Palabras sueltas (weight 1)
    // =========================
    { phrase: 'promocion', weight: 1 },
    { phrase: 'promociones', weight: 1 },
    { phrase: 'promo', weight: 1 },
    { phrase: 'descuento', weight: 1 },
    { phrase: 'oferta', weight: 1 },
    { phrase: 'rebaja', weight: 1 },
    { phrase: 'liquidacion', weight: 1 },
    { phrase: 'remate', weight: 1 },
  ],
},

  descripcion: {
  name: 'descripcion',
  standalone: false,
  keywords: [
    // =========================
    // Frases completas (weight 3)
    // =========================
    { phrase: 'que contiene', weight: 3 },
    { phrase: 'que contienen', weight: 3 },
    { phrase: 'que incluye', weight: 3 },
    { phrase: 'que incluye el producto', weight: 3 },
    { phrase: 'que lleva', weight: 3 },
    { phrase: 'que llevan', weight: 3 },
    { phrase: 'que incluyen', weight: 3 },
    { phrase: 'que trae', weight: 3 },
    { phrase: 'que traen', weight: 3 },
    { phrase: 'de que esta hecho', weight: 3 },

    // Variaciones naturales
    { phrase: 'que es', weight: 3 },
    { phrase: 'de que se trata', weight: 3 },
    { phrase: 'que trae incluido', weight: 3 },
    { phrase: 'que contiene el paquete', weight: 3 },
    { phrase: 'que incluye la compra', weight: 3 },

    // Info técnica
    { phrase: 'caracteristicas de', weight: 3 },
    { phrase: 'especificaciones de', weight: 3 },
    { phrase: 'descripcion de', weight: 3 },
     { phrase: 'que descripcion tiene', weight: 3 },
    { phrase: 'informacion de', weight: 3 },
    { phrase: 'detalles de', weight: 3 },

    // Lenguaje casual
    { phrase: 'que trae eso', weight: 3 },
    { phrase: 'que es eso', weight: 3 },
    { phrase: 'como es el', weight: 3 },
    { phrase: 'como es la', weight: 3 },
    { phrase: 'como es ese', weight: 3 },
    { phrase: 'como es eso', weight: 3 },
    { phrase: 'como funciona', weight: 3 },
    { phrase: 'para que sirve', weight: 3 },

    // =========================
    // Frases parciales (weight 2)
    // =========================
    { phrase: 'caracteristicas', weight: 2 },
    { phrase: 'especificaciones', weight: 2 },
    { phrase: 'detalles', weight: 2 },
    { phrase: 'informacion', weight: 2 },
    { phrase: 'descripcion', weight: 2 },

    // =========================
    // Errores / slang
    // =========================
    { phrase: 'k contiene', weight: 2 },
    { phrase: 'k trae', weight: 2 },
    { phrase: 'k incluye', weight: 2 },
    { phrase: 'qe es', weight: 2 },
    { phrase: 'q es', weight: 2 },

    // =========================
    // Palabras sueltas (weight 1)
    // =========================
    { phrase: 'incluye', weight: 1 },
    { phrase: 'contiene', weight: 1 },
    { phrase: 'trae', weight: 1 },
    { phrase: 'info', weight: 1 },
  ],
},

ubicacion: {
  name: 'ubicacion',
  standalone: true,
  keywords: [
    // =========================
    // Frases completas (weight 3)
    // =========================
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

    // Variaciones naturales
    { phrase: 'donde se ubican', weight: 3 },
    { phrase: 'donde se encuentran', weight: 3 },
    { phrase: 'me pasas la ubicacion', weight: 3 },
    { phrase: 'me compartes la ubicacion', weight: 3 },
    { phrase: 'me mandas la ubicacion', weight: 3 },
    { phrase: 'me pasas direccion', weight: 3 },
    { phrase: 'donde estan exactamente', weight: 3 },

    // Lenguaje casual / México
    { phrase: 'donde estan', weight: 3 },
    { phrase: 'donde mero estan', weight: 3 },
    { phrase: 'por donde quedan', weight: 3 },
    { phrase: 'por donde se ubican', weight: 3 },
    { phrase: 'como llego ahi', weight: 3 },
    { phrase: 'como llego con ustedes', weight: 3 },
    { phrase: 'donde los ubico', weight: 3 },

    // =========================
    // Frases parciales (weight 2)
    // =========================
    { phrase: 'tienen sucursales', weight: 2 },
    { phrase: 'cuantas sucursales', weight: 2 },
    { phrase: 'en que zona estan', weight: 2 },
    { phrase: 'mapa de ubicacion', weight: 2 },
    { phrase: 'google maps', weight: 2 },
    { phrase: 'ubicacion en mapa', weight: 2 },
    { phrase: 'como llegar', weight: 2 },
    { phrase: 'direccion exacta', weight: 2 },

    // =========================
    // Errores / slang
    // =========================
    { phrase: 'donde estan ubikados', weight: 2 },
    { phrase: 'donde kedan', weight: 2 },
    { phrase: 'ubicacionn', weight: 1 },
    { phrase: 'direcsion', weight: 1 },
    { phrase: 'k direccion', weight: 2 },
    { phrase: 'k ubicacion', weight: 2 },

    // =========================
    // Palabras sueltas (weight 1)
    // =========================
    { phrase: 'ubicacion', weight: 1 },
    { phrase: 'direccion', weight: 1 },
    { phrase: 'dirección', weight: 1 },
    { phrase: 'sucursal', weight: 1 },
    { phrase: 'mapa', weight: 1 },
    { phrase: 'lugar', weight: 1 },
  ],
},

  servicios: {
  name: 'servicios',
  standalone: true,
  keywords: [
    // =========================
    // Frases completas (weight 3)
    // =========================
    { phrase: 'que servicios ofrecen', weight: 3 },
    { phrase: 'que servicios ofrece', weight: 3 },
    { phrase: 'que servicios tienes', weight: 3 },
    { phrase: 'que servicios tienen', weight: 3 },
    { phrase: 'que servicios manejan', weight: 3 },
    { phrase: 'lista de servicios', weight: 3 },
    { phrase: 'tienen servicios', weight: 3 },
    { phrase: 'manejan servicios', weight: 3 },
    { phrase: 'ofrecen servicios', weight: 3 },

    // Variaciones naturales
    { phrase: 'que hacen', weight: 3 },
    { phrase: 'a que se dedican', weight: 3 },
    { phrase: 'que ofrecen', weight: 3 },
    { phrase: 'que tipo de servicios dan', weight: 3 },
    { phrase: 'que puedo contratar', weight: 3 },
    { phrase: 'en que me pueden ayudar', weight: 3 },

    // Servicio específico
    { phrase: 'tienen servicio de', weight: 3 },
    { phrase: 'tienes servicio de', weight: 3 },
    { phrase: 'hay servicio de', weight: 3 },
    { phrase: 'ofrecen servicio de', weight: 3 },
    { phrase: 'ofrece servicio de', weight: 3 },
    { phrase: 'cuentan con servicio de', weight: 3 },
    { phrase: 'servicio de', weight: 3 },

    // Lenguaje casual / México
    { phrase: 'que servicios traen', weight: 3 },
    { phrase: 'que servicios manejas', weight: 3 },
    { phrase: 'que hacen ahi', weight: 3 },
    { phrase: 'que rollo con sus servicios', weight: 3 },

    // =========================
    // Frases parciales (weight 2)
    // =========================
    { phrase: 'servicios disponibles', weight: 2 },
    { phrase: 'sus servicios', weight: 2 },
    { phrase: 'los servicios', weight: 2 },
    { phrase: 'tipos de servicios', weight: 2 },
    { phrase: 'info de servicios', weight: 2 },

    // =========================
    // Errores / slang
    // =========================
    { phrase: 'servisio', weight: 2 },
    { phrase: 'servisios', weight: 2 },
    { phrase: 'k servicios', weight: 2 },
    { phrase: 'k ofrecen', weight: 2 },
    { phrase: 'ofresen servicios', weight: 2 },

    // =========================
    // Palabras sueltas (weight 1)
    // =========================
    { phrase: 'servicios', weight: 1 },
    { phrase: 'servicio', weight: 1 },
    { phrase: 'ofrecen', weight: 1 },
    { phrase: 'ofrece', weight: 1 },
    { phrase: 'hacen', weight: 1 },
  ],
},

  comprar: {
  name: 'comprar',
  standalone: true,
  keywords: [
    // =========================
    // Frases completas (weight 3)
    // =========================
    { phrase: 'quiero comprar', weight: 3 },
    { phrase: 'como puedo comprar', weight: 3 },
    { phrase: 'como compro', weight: 3 },
    { phrase: 'donde puedo comprar', weight: 3 },
    { phrase: 'quiero hacer un pedido', weight: 3 },
    { phrase: 'como hago un pedido', weight: 3 },
    { phrase: 'como puedo pedir', weight: 3 },
    { phrase: 'quiero ordenar', weight: 3 },
    { phrase: 'como ordeno', weight: 3 },
    { phrase: 'quiero adquirir', weight: 3 },
    { phrase: 'como lo adquiero', weight: 3 },
    { phrase: 'puedo comprar en linea', weight: 3 },
    { phrase: 'tienen tienda en linea', weight: 3 },
    { phrase: 'venden en linea', weight: 3 },

    // Variaciones naturales
    { phrase: 'como le hago para comprar', weight: 3 },
    { phrase: 'como le hago para pedir', weight: 3 },
    { phrase: 'como puedo hacer mi compra', weight: 3 },
    { phrase: 'como puedo hacer mi pedido', weight: 3 },
    { phrase: 'quiero hacer una compra', weight: 3 },
    { phrase: 'quiero pedir uno', weight: 3 },

    // Lenguaje casual / México
    { phrase: 'como le hago', weight: 3 },
    { phrase: 'como le hago para comprarlo', weight: 3 },
    { phrase: 'como le hago para pedirlo', weight: 3 },
    { phrase: 'quiero uno de esos', weight: 3 },
    { phrase: 'quiero una de esas', weight: 3 },
    { phrase: 'quiero ese producto', weight: 3 },
    { phrase: 'quiero ese modelo', weight: 3 },

    // =========================
    // Intención fuerte de compra (weight 3)
    // =========================
    { phrase: 'quiero una', weight: 3 },
    { phrase: 'quiero uno', weight: 3 },
    { phrase: 'me gustaria pedir una', weight: 3 },
    { phrase: 'pedir una', weight: 3 },
    { phrase: 'lo quiero', weight: 3 },
    { phrase: 'la quiero', weight: 3 },
    { phrase: 'lo quiero comprar', weight: 3 },
    { phrase: 'la quiero comprar', weight: 3 },
    { phrase: 'quiero comprarlo', weight: 3 },
    { phrase: 'quiero comprarla', weight: 3 },
    { phrase: 'me lo llevo', weight: 3 },
    { phrase: 'me la llevo', weight: 3 },
    { phrase: 'voy a comprarlo', weight: 3 },
    { phrase: 'voy a comprarla', weight: 3 },
      { phrase: 'dame', weight: 3 },
    { phrase: 'damelo', weight: 3 },
    { phrase: 'damela', weight: 3 },
    { phrase: 'deme uno', weight: 3 },
    { phrase: 'deme una', weight: 3 },
     { phrase: 'me da uno', weight: 3 },
    { phrase: 'me da una', weight: 3 },
    { phrase: 'como lo pido', weight: 3 },
    { phrase: 'como la pido', weight: 3 },

    // Cierre / decisión
    { phrase: 'me interesa comprarlo', weight: 3 },
    { phrase: 'me interesa uno', weight: 3 },
    { phrase: 'si lo quiero', weight: 3 },
    { phrase: 'si me interesa', weight: 3 },

    // =========================
    // Frases parciales (weight 2)
    // =========================
    { phrase: 'hacer pedido', weight: 2 },
    { phrase: 'realizar pedido', weight: 2 },
    { phrase: 'realizar compra', weight: 2 },
    { phrase: 'comprar en linea', weight: 2 },
    { phrase: 'tienda en linea', weight: 2 },
    { phrase: 'quiero pedirlo', weight: 2 },
    { phrase: 'quiero pedirla', weight: 2 },

    { phrase: 'quiero ese', weight: 2 },
    { phrase: 'quiero esa', weight: 2 },
    { phrase: 'lo compro', weight: 2 },
    { phrase: 'la compro', weight: 2 },
    { phrase: 'me lo das', weight: 2 },
    { phrase: 'me la das', weight: 2 },
    { phrase: 'lo pido', weight: 2 },
    { phrase: 'la pido', weight: 2 },

    // =========================
    // Errores / slang (weight 1-2)
    // =========================
    { phrase: 'kiero comprar', weight: 2 },
    { phrase: 'kiero uno', weight: 2 },
    { phrase: 'kiero una', weight: 2 },
    { phrase: 'komo compro', weight: 2 },
    { phrase: 'komo pido', weight: 2 },
    { phrase: 'comprarrr', weight: 1 },
    { phrase: 'pedidoo', weight: 1 },

    // =========================
    // Palabras sueltas (weight 1)
    // =========================
    { phrase: 'comprar', weight: 1 },
    { phrase: 'pedido', weight: 1 },
    { phrase: 'ordenar', weight: 1 },
    { phrase: 'comprarlo', weight: 1 },
    { phrase: 'pedirlo', weight: 1 },
  ],
},

  contacto: {
  name: 'contacto',
  standalone: true,
  keywords: [
    // =========================
    // Teléfono / celular (weight 3)
    // =========================
    { phrase: 'numero de telefono', weight: 3 },
    { phrase: 'numero de celular', weight: 3 },
    { phrase: 'cual es su telefono', weight: 3 },
    { phrase: 'cual es su numero', weight: 3 },
    { phrase: 'cual es el numero', weight: 3 },
    { phrase: 'tienen telefono', weight: 3 },
    { phrase: 'tienen celular', weight: 3 },
    { phrase: 'tienen numero', weight: 3 },
    { phrase: 'me dan su telefono', weight: 3 },
    { phrase: 'me dan su numero', weight: 3 },
    { phrase: 'me pueden dar su numero', weight: 3 },
    { phrase: 'a que numero llamo', weight: 3 },
    { phrase: 'a donde llamo', weight: 3 },
    { phrase: 'a donde puedo llamar', weight: 3 },
    { phrase: 'puedo llamarles', weight: 3 },
    { phrase: 'puedo llamarlos', weight: 3 },
    { phrase: 'numero para llamar', weight: 3 },
    { phrase: 'numero para contactarlos', weight: 3 },
    { phrase: 'su numero de contacto', weight: 3 },

    // Variaciones naturales
    { phrase: 'me pasas tu numero', weight: 3 },
    { phrase: 'me pasas su numero', weight: 3 },
    { phrase: 'me compartes tu numero', weight: 3 },
    { phrase: 'me mandas tu numero', weight: 3 },
    { phrase: 'tienes algun numero', weight: 3 },

    // Lenguaje casual / México
    { phrase: 'pásame tu numero', weight: 3 },
    { phrase: 'rolame tu numero', weight: 3 },
    { phrase: 'me rolas tu numero', weight: 3 },
    { phrase: 'a donde marco', weight: 3 },

    // =========================
    // WhatsApp (muy importante)
    // =========================
    { phrase: 'tienen whatsapp', weight: 3 },
    { phrase: 'me pasas tu whatsapp', weight: 3 },
    { phrase: 'me compartes tu whatsapp', weight: 3 },
    { phrase: 'numero de whatsapp', weight: 3 },
    { phrase: 'los puedo contactar por whatsapp', weight: 3 },
    { phrase: 'atienden por whatsapp', weight: 3 },
    { phrase: 'tienen wpp', weight: 3 },

    // =========================
    // Correo (weight 3)
    // =========================
    { phrase: 'correo electronico', weight: 3 },
    { phrase: 'cual es su correo', weight: 3 },
    { phrase: 'cual es su email', weight: 3 },
    { phrase: 'me dan su correo', weight: 3 },
    { phrase: 'tienen correo', weight: 3 },
    { phrase: 'tienen email', weight: 3 },
    { phrase: 'a que correo escribo', weight: 3 },
    { phrase: 'a que email escribo', weight: 3 },
    { phrase: 'les puedo escribir', weight: 3 },
    { phrase: 'puedo mandarles un correo', weight: 3 },
    { phrase: 'como les escribo', weight: 3 },

    // Variaciones
    { phrase: 'me pasas tu correo', weight: 3 },
    { phrase: 'me compartes tu email', weight: 3 },

    // =========================
    // Sitio web (weight 3)
    // =========================
    { phrase: 'pagina web', weight: 3 },
    { phrase: 'sitio web', weight: 3 },
    { phrase: 'tienen pagina web', weight: 3 },
    { phrase: 'tienen sitio web', weight: 3 },
    { phrase: 'tienen pagina', weight: 3 },
    { phrase: 'tienen pagina de internet', weight: 3 },
    { phrase: 'cual es su pagina', weight: 3 },
    { phrase: 'cual es su sitio', weight: 3 },
    { phrase: 'cual es su web', weight: 3 },
    { phrase: 'me dan su pagina', weight: 3 },

    // =========================
    // Redes sociales (nuevo)
    // =========================
    { phrase: 'tienen facebook', weight: 3 },
    { phrase: 'tienen instagram', weight: 3 },
    { phrase: 'tienen redes sociales', weight: 3 },
    { phrase: 'como los encuentro en facebook', weight: 3 },
    { phrase: 'como los encuentro en instagram', weight: 3 },
    { phrase: 'tienen tiktok', weight: 3 },

    // =========================
    // Contacto general (weight 3)
    // =========================
    { phrase: 'como me comunico', weight: 3 },
    { phrase: 'como los contacto', weight: 3 },
    { phrase: 'como puedo contactarlos', weight: 3 },
    { phrase: 'como me puedo comunicar', weight: 3 },
    { phrase: 'datos de contacto', weight: 3 },
    { phrase: 'informacion de contacto', weight: 3 },

    // Casual
    { phrase: 'como los contacto rapido', weight: 3 },
    { phrase: 'por donde los contacto', weight: 3 },
    { phrase: 'por donde me comunico', weight: 3 },

    // =========================
    // Frases parciales (weight 2)
    // =========================
    { phrase: 'contactar', weight: 2 },
    { phrase: 'comunicarme', weight: 2 },
    { phrase: 'su whatsapp', weight: 2 },
    { phrase: 'su correo', weight: 2 },
    { phrase: 'su telefono', weight: 2 },
    { phrase: 'su celular', weight: 2 },
    { phrase: 'su pagina', weight: 2 },
    { phrase: 'su sitio', weight: 2 },
    { phrase: 'llamarles', weight: 2 },
    { phrase: 'llamarlos', weight: 2 },

    // =========================
    // Errores / slang
    // =========================
    { phrase: 'numeroo', weight: 1 },
    { phrase: 'telefonoo', weight: 1 },
    { phrase: 'celu', weight: 2 },
    { phrase: 'watsap', weight: 2 },
    { phrase: 'wasap', weight: 2 },
    { phrase: 'whats', weight: 2 },
    { phrase: 'k numero', weight: 2 },
    { phrase: 'k telefono', weight: 2 },

    // =========================
    // Palabras sueltas (weight 1)
    // =========================
    { phrase: 'telefono', weight: 1 },
    { phrase: 'celular', weight: 1 },
    { phrase: 'numero', weight: 1 },
    { phrase: 'correo', weight: 1 },
    { phrase: 'email', weight: 1 },
    { phrase: 'whatsapp', weight: 1 },
    { phrase: 'llamar', weight: 1 },
    { phrase: 'contacto', weight: 1 },
  ],
},
};

export default intents;

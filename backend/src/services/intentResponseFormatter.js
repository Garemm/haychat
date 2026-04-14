'use strict';

/**
 * src/services/intentResponseFormatter.js
 *
 * Converts raw DB rows into natural, conversational Spanish responses.
 * Optimized for voice output: no emojis, no bullet lists, no markdown symbols.
 * One formatter per intent. Add a new entry to FORMATTERS when adding a new intent.
 */

const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

function formatTime(t) {
  // t comes as 'HH:MM:SS' from pg
  if (!t) return '';
  const [h, m] = t.split(':');
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? 'pm' : 'am';
  const h12 = hour % 12 || 12;
  return `${h12}:${m} ${ampm}`;
}

/** Max items to show in a conversational list before offering more. */
const LIST_LIMIT = 3;

/** Natural Spanish enumeration: ["A","B","C"] → "A, B y C". */
function enumList(items) {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`;
}

/**
 * Renders a titled bullet list (kept for backward compatibility).
 * @param {string}   title
 * @param {string[]} items
 * @returns {string}
 */
function formatList(title, items) {
  return `${title}\n\n${items.map((i) => `• ${i}`).join('\n')}`;
}

const FORMATTERS = {
  horarios(rows) {
    if (!rows || rows.length === 0) {
      return 'Por el momento no tenemos los horarios registrados. No dudes en contactarnos para más información.';
    }
    const parts = rows.map((r) => {
      const day = DAYS[r.day_of_week] ?? `Día ${r.day_of_week}`;
      if (r.is_closed) return `el ${day} estamos cerrados`;
      return `el ${day} de ${formatTime(r.open_time)} a ${formatTime(r.close_time)}`;
    });
    return `😊 Nuestros horarios: ${parts.join(', ')}. ¿Hay algo más en lo que te pueda ayudar?`;
  },

  productos(rows) {
    if (!rows || rows.length === 0) {
      return 'Por ahora no tenemos productos registrados. ¿Te puedo ayudar con algo más?';
    }
    const available = rows.filter((r) => r.is_available !== false);
    const pool    = available.length > 0 ? available : rows;
    const sample  = pool.slice(0, LIST_LIMIT);
    const names   = sample.map((r) => r.name);
    const hasMore = rows.length > LIST_LIMIT;
    const listed  = enumList(names);

    if (names.length === 1) {
      return `😊 Tenemos ${names[0]} disponible. ¿Buscas algo en específico?`;
    }
    if (hasMore) {
      return `😊 Tenemos varias opciones, como ${listed}, entre otros. ¿Buscas algo en específico?`;
    }
    return `😊 Tenemos ${listed} disponibles. ¿Buscas algo en específico?`;
  },

  precios(rows) {
    if (!rows || rows.length === 0) {
      return 'Por el momento no tengo información de precios disponible. ¿Te puedo ayudar con algo más?';
    }
    const sample  = rows.slice(0, LIST_LIMIT);
    const items   = sample.map((r) => `${r.name} a $${Number(r.price).toFixed(2)}`);
    const hasMore = rows.length > LIST_LIMIT;
    const listed  = enumList(items);

    if (items.length === 1) {
      return `😊 El precio de ${listed}. ¿Necesitas saber el precio de algún otro producto?`;
    }
    if (hasMore) {
      return `😊 Algunos precios: ${listed}, entre otros. ¿Quieres saber el precio de algún producto en particular?`;
    }
    return `😊 Los precios son: ${listed}. ¿Hay algo más en lo que te pueda ayudar?`;
  },

  promociones(rows) {
    if (!rows || rows.length === 0) {
      return 'No hay promociones activas en este momento, pero estate al pendiente. ¿Te puedo ayudar con algo más?';
    }
    const sample = rows.slice(0, LIST_LIMIT);
    const parts  = sample.map((r) => {
      const value =
        r.discount_type === 'percentage'
          ? `${r.discount_value}% de descuento`
          : `$${Number(r.discount_value).toFixed(2)} de descuento`;
      const until = r.end_date ? `, válida hasta ${r.end_date}` : '';
      const desc  = r.description ? `: ${r.description}` : '';
      return `${r.title} con ${value}${until}${desc}`;
    });
    const hasMore = rows.length > LIST_LIMIT;
    const listed  = enumList(parts);

    if (parts.length === 1) {
      return `😊 Tenemos la promoción ${parts[0]}. ¿Te interesa aprovecharlo?`;
    }
    if (hasMore) {
      return `😊 Tenemos varias promociones activas, como ${listed}, entre otras. ¿Te gustaría más detalles?`;
    }
    return `😊 Tenemos ${parts.length} promociones activas: ${listed}. ¿Te interesa alguna?`;
  },

  ubicacion(row) {
    if (!row) return 'No tenemos la ubicación registrada. Contáctanos y te damos más detalles.';
    const city = row.city ? `Nos encuentras en ${row.city}` : '';
    const name = row.name ? (row.city ? `, en ${row.name}` : row.name) : '';
    const desc = row.description ? ` ${row.description}.` : '';
    return `😊 ${city}${name}.${desc} ¿Hay algo más en lo que te pueda ayudar?`.replace(/\s{2,}/g, ' ').trim();
  },

  comprar(row) {
    if (!row) {
      return 'Por el momento no tengo información disponible para guiarte en la compra. Intenta de nuevo más tarde.';
    }
    const contactParts = [];
    if (row.phone)        contactParts.push(`llámanos al ${row.phone}`);
    if (row.email)        contactParts.push(`escríbenos a ${row.email}`);
    if (row.webpage_link) contactParts.push(`visita nuestro sitio en ${row.webpage_link}`);

    const contactStr = contactParts.length > 0
      ? `contactarnos directamente: ${enumList(contactParts)}`
      : (row.city ? `visitarnos en ${row.city}` : null);

    if (row.acepto_pedidos) {
      // Orders enabled: invite them to use the order button AND contact
      const suffix = contactStr ? ` o ${contactStr}` : '';
      return `😊 Puedes enviar tu orden dando click al botón "Hacer pedido"${suffix}. ¿Hay algo más en lo que te pueda ayudar?`;
    }

    // Orders disabled: contact-only message
    if (contactStr) {
      return `😊 Puedes ${contactStr}. ¿Hay algo más en lo que te pueda ayudar?`;
    }
    return '😊 Con gusto te ayudo. Contáctanos directamente para realizar tu pedido. ¿Hay algo más en lo que te pueda ayudar?';
  },

  contacto(row) {
    if (!row) return 'No encontramos información de contacto registrada. Intenta de nuevo más tarde.';
    const hasData = row.phone || row.email || row.webpage_link;
    if (!hasData) return 'Por el momento no tenemos datos de contacto registrados. ¿Te puedo ayudar con algo más?';
    const parts = [];
    if (row.phone)        parts.push(`llámanos al ${row.phone}`);
    if (row.email)        parts.push(`escríbenos a ${row.email}`);
    if (row.webpage_link) parts.push(`visita nuestro sitio en ${row.webpage_link}`);
    return `😊 Puedes contactarnos: ${enumList(parts)}. ¿Hay algo más en lo que te pueda ayudar?`;
  },

  servicios(rows) {
    if (!rows || rows.length === 0) {
      return 'Por el momento no tenemos servicios registrados. ¿Te puedo ayudar con algo más?';
    }
    const sample  = rows.slice(0, LIST_LIMIT);
    const names   = sample.map((s) => {
      const price = s.price != null ? ` (a $${Number(s.price).toFixed(2)})` : '';
      return `${s.name}${price}`;
    });
    const hasMore = rows.length > LIST_LIMIT;
    const listed  = enumList(names);

    if (hasMore) {
      return `😊 Ofrecemos varios servicios, como ${listed}, entre otros. ¿Te gustaría saber más de alguno?`;
    }
    return `😊 Ofrecemos ${listed}. ¿Te gustaría saber más detalles sobre alguno?`;
  },
};

/**
 * Formats DB data for a given intent into a readable string.
 * @param {string} intent
 * @param {any} data  Rows array or single object from BusinessModel
 * @returns {string}
 */
function formatIntentResponse(intent, data) {
  const formatter = FORMATTERS[intent];
  if (!formatter) return `Información sobre "${intent}" no está disponible por ahora. ¿Puedo ayudarte con algo más?`;
  return formatter(data);
}

/**
 * Formats the schedule for a single day into a natural Spanish sentence.
 * @param {string} normalizedDayKey  e.g. "lunes"
 * @param {object|null} row          DB row from business_hours (or null)
 * @returns {string}
 */
function formatHorarioDay(normalizedDayKey, row) {
  // Display name map to keep accents correct
  const DISPLAY = {
    domingo: 'Domingo', lunes: 'Lunes', martes: 'Martes',
    miercoles: 'Miércoles', jueves: 'Jueves', viernes: 'Viernes', sabado: 'Sábado',
  };
  const display = DISPLAY[normalizedDayKey] ?? (normalizedDayKey.charAt(0).toUpperCase() + normalizedDayKey.slice(1));

  if (!row) return `No encontré horarios para el ${display}. ¿Quieres consultar otro día?`;
  if (row.is_closed) return `El ${display} permanecemos cerrados. ¿Hay algo más en lo que te pueda ayudar?`;
  return `😊 El ${display} abrimos de ${formatTime(row.open_time)} a ${formatTime(row.close_time)}. ¿Hay algo más en lo que te pueda ayudar?`;
}

/**
 * Formats a product description response, putting the description first.
 *
 * @param {string} entityValue  Queried entity name (raw user input)
 * @param {Array}  rows         Product rows from queryProducts
 * @returns {string}
 */
function formatDescripcionResponse(entityValue, rows) {
  if (!rows || rows.length === 0) {
    return `No encontré información sobre "${entityValue}". ¿Quieres ver el catálogo completo?`;
  }
  const p = rows[0];
  const name = p.name ?? entityValue;
  if (!p.description) {
    return `${name} aún no tiene descripción detallada disponible. ¿Te gustaría saber su precio o disponibilidad?`;
  }
  return `${name}: ${p.description}`;
}

/**
 * Formats a product's key/value attributes as a natural sentence.
 * Returns an empty string if there are no attributes for the given product.
 *
 * @param {Record<number, {key:string,value:string}[]>} attrsMap  Grouped by product_id
 * @param {number} productId
 * @returns {string}
 */
function formatProductAttributes(attrsMap, productId) {
  const attrs = attrsMap[productId];
  if (!attrs || attrs.length === 0) return '';
  const parts = attrs.map((a) => `${a.key}: ${a.value}`);
  return ` Sus características son: ${enumList(parts)}.`;
}

/**
 * Formats a single service with full detail (name, description, price).
 *
 * @param {{name:string, description:string|null, price:number|null}} service
 * @returns {string}
 */
function formatServiceDetail(service) {
  const price = service.price != null
    ? ` El precio es $${Number(service.price).toFixed(2)}.`
    : '';
  const desc = service.description
    ? ` ${service.description}`
    : '';
  return `${service.name}.${price}${desc}`.trim();
}

/**
 * Formats a service detail response that also includes company contact info.
 *
 * @param {{name:string, description:string|null, price:number|null}} service
 * @param {{phone:string|null, email:string|null, webpage_link:string|null, city:string|null}|null} contactInfo
 * @returns {string}
 */
function formatServiceWithContact(service, contactInfo) {
  const price = service.price != null
    ? ` El precio es $${Number(service.price).toFixed(2)}.`
    : '';
  const desc = service.description ? ` ${service.description}` : '';
  const servicePart = `😊 Sí, ofrecemos el servicio de ${service.name}.${price}${desc}`;

  if (!contactInfo) return `${servicePart} ¿Hay algo más en lo que te pueda ayudar?`;

  const contactParts = [];
  if (contactInfo.phone)        contactParts.push(`llámanos al ${contactInfo.phone}`);
  if (contactInfo.city)         contactParts.push(`visítanos en ${contactInfo.city}`);
  if (contactInfo.webpage_link) contactParts.push(`visita nuestro sitio en ${contactInfo.webpage_link}`);

  if (contactParts.length > 0) {
    return `${servicePart} Para más información ${enumList(contactParts)}. ¿Hay algo más en lo que te pueda ayudar?`;
  }
  return `${servicePart} ¿Hay algo más en lo que te pueda ayudar?`;
}

export {
  formatIntentResponse,
  formatHorarioDay,
  formatList,
  formatDescripcionResponse,
  formatProductAttributes,
  formatServiceDetail,
  formatServiceWithContact,
};

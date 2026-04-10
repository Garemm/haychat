========================================
NLP CONTEXT DATASET – SPANISH CONVERSATIONS
========================================

PURPOSE:
This document provides realistic Spanish conversational patterns for improving:
- Intent detection
- Entity recognition
- Context tracking
- Multi-intent parsing
- Connector handling (y, o, también, pero, etc.)
- Natural, human-like responses

DOMAIN:
Customer service chatbot for:
- Product catalogs
- Services
- Promotions
- Locations
- Schedules

----------------------------------------
SECTION 1: SAME CONTEXT (PRODUCT FLOW)
----------------------------------------

CONTEXT: PRODUCTS → BEVERAGES

[User]: Hola, ¿qué productos tienen disponibles?
Intent: general inquiry
Entities: none
Context: products

[Bot]: Claro, manejamos bebidas, alimentos y promociones. ¿Qué te interesa?

[User]: Quiero ver bebidas
Intent: category selection
Entities: bebidas
Context: beverages

[Bot]: Tenemos refrescos, jugos y bebidas sin azúcar.

[User]: ¿Y también tienes bebidas sin azúcar?
Intent: follow-up + filter
Entities: bebidas sin azúcar
Connector: "también"
Context: beverages

[Bot]: Sí, contamos con varias opciones sin azúcar.

[User]: ¿Cuáles son las más vendidas?
Intent: recommendation
Entities: none
Context: beverages

[Bot]: Las más populares son refresco light y agua mineral.

[User]: ¿Y precios?
Intent: price inquiry (implicit)
Entities: none
Context: beverages

[Bot]: Van desde $15 hasta $35.

[User]: Ok, dame opciones baratas
Intent: filter by price
Entities: barato
Context: beverages

[Bot]: Agua natural $15, refresco chico $18.

[User]: ¿Y promociones en bebidas?
Intent: promotion inquiry
Entities: bebidas
Context: beverages

[Bot]: Hay promoción 2x1 en refrescos medianos.

[User]: Va, ¿también venden snacks?
Intent: context expansion
Entities: snacks
Connector: "también"
Context shift: beverages → products (new category)


----------------------------------------
SECTION 2: CONTEXT SWITCHING
----------------------------------------

CONTEXT FLOW:
services → delivery → products → promotions → schedules

[User]: Hola, ¿qué servicios ofrecen?
Intent: services inquiry
Context: services

[Bot]: Ofrecemos envíos, pedidos en línea y atención en sucursal.

[User]: ¿El envío tiene costo?
Intent: cost inquiry
Entities: envío
Context: delivery

[Bot]: Sí, entre $20 y $50.

[User]: ¿Y cuánto tarda?
Intent: time inquiry
Entities: envío
Context: delivery

[Bot]: Entre 30 y 60 minutos.

[User]: Perfecto, ¿y qué productos tienen?
Intent: context switch
Entities: productos
Context: products

[Bot]: Bebidas, alimentos y combos.

[User]: ¿Hay promociones?
Intent: promotion inquiry
Context: promotions

[Bot]: Sí, combos con descuento y 2x1.

[User]: ¿Y a qué hora cierran?
Intent: schedule inquiry
Context: schedules

[Bot]: A las 10:00 PM.

[User]: ¿Y abren todos los días o solo entre semana?
Intent: schedule clarification
Connector: "o"
Context: schedules

[Bot]: Abrimos todos los días.

[User]: Ok, y si quiero pedir algo ahorita, ¿todavía alcanzo?
Intent: implicit availability check
Entities: tiempo actual
Context: schedules + delivery


----------------------------------------
SECTION 3: NATURAL / HUMAN CONVERSATION
----------------------------------------

CHARACTERISTICS:
- Multi-intent
- Connectors
- Implicit meaning
- Context reuse
- Human phrasing

[User]: Hola, oye, ¿qué tienen de comer y también bebidas?
Intent: multi-intent
Entities: comida, bebidas
Connector: "y también"
Context: products

[Bot]: Tenemos hamburguesas, tacos, snacks y bebidas.

[User]: ¿Qué me recomiendas barato pero bueno?
Intent: recommendation + price filter
Connector: "pero"
Context: products

[Bot]: Tacos y hamburguesa sencilla.

[User]: ¿Y tienen combos o algo así?
Intent: promotion inquiry
Connector: "o"
Context: promotions

[Bot]: Sí, combos con bebida incluida.

[User]: ¿Y si quiero solo bebida, hay promo o no?
Intent: conditional + promotion
Connector: "o"
Context: beverages

[Bot]: Sí, 2x1 en refrescos.

[User]: Ok, ¿y dónde están ubicados?
Intent: location inquiry
Context: locations

[Bot]: Tenemos varias sucursales.

[User]: En Monterrey, pero también podría ir a San Pedro
Intent: multi-location
Connector: "pero también"
Entities: Monterrey, San Pedro
Context: locations

[Bot]: Tenemos sucursales en ambas zonas.

[User]: ¿Y los horarios son iguales o cambian?
Intent: comparison
Connector: "o"
Context: schedules

[Bot]: Algunos cambian.

[User]: ¿Como a qué hora más o menos?
Intent: vague time inquiry
Context: schedules

[Bot]: Entre 9:00 PM y 11:00 PM.

[User]: Ok, y si pido ahorita, ¿todavía hay servicio?
Intent: real-time availability
Context: schedules + delivery

[Bot]: Sí, aún estás en horario.

[User]: Perfecto, quiero una hamburguesa y también una bebida sin azúcar
Intent: order + multi-intent
Connector: "y también"
Entities: hamburguesa, bebida sin azúcar
Context: order


----------------------------------------
NLP DESIGN IMPLICATIONS
----------------------------------------

1. CONTEXT MEMORY:
- Store active context in Redis
- Allow overwrite and stacking (context switching)

2. CONNECTOR HANDLING:
Detect:
- "y" → add intent/entity
- "o" → alternatives
- "también" → additive intent
- "pero" → contrast / override

3. MULTI-INTENT PARSING:
Split sentence into segments:
Example:
"Quiero tacos y también bebidas"
→ Intent 1: tacos
→ Intent 2: bebidas

4. IMPLICIT INTENT DETECTION:
Examples:
- "¿Y precios?" → price inquiry
- "¿todavía alcanzo?" → availability check

5. CONTEXT SWITCHING:
Detect when user changes domain:
products → schedules → locations

6. RESPONSE GENERATION:
- Use context + intent + entities
- Avoid rigid responses
- Maintain conversational tone

----------------------------------------
END OF DOCUMENT
----------------------------------------
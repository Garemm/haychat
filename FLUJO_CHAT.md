# Flujo del Chat — HayChat

Documento de referencia técnica. Describe el recorrido completo de un mensaje de usuario desde que llega al servidor hasta que se emite la respuesta.

---

## 1. Vista general

```
USUARIO (frontend React)
    │
    │  WebSocket  send_message { text, sessionId, businessId, roomId }
    ▼
BACKEND (Node/Express + Socket.io)
    │
    ├─ chatSocket.js          ← punto de entrada Socket.io
    │      │ persiste mensaje en Redis
    │      │ llama a processMessage()
    │      ▼
    ├─ messagePipeline.js     ← orquestador principal del NLP
    │      │
    │      ├─ textPreprocessor.js    (paso 1)
    │      ├─ dayDetector.js         (paso 2)
    │      ├─ intentDetector.js      (paso 3)
    │      ├─ entityDetector.js      (paso 4)
    │      │      └─ attributeExtractor.js
    │      ├─ sessionContextService.js  (paso 5 — Redis)
    │      ├─ decide()               (paso 6)
    │      │      └─ aiDecisionEngine.js
    │      └─ executeDecision()  OR  handleAIFallback()  (paso 7)
    │             ├─ businessInfoService.js
    │             ├─ intentResponseFormatter.js
    │             ├─ subscriptionController.js
    │             └─ ollamaService.js / mockOpenAI.js
    │
    │  WebSocket  receive_message { sender: 'Bot', text, timestamp }
    ▼
USUARIO ve la respuesta
```

---

## 2. Capa de transporte — `chatSocket.js`

Archivo: `backend/src/sockets/chatSocket.js`

```
Cliente emite  send_message
        │
        ├─ Valida sessionId y businessId
        ├─ Emite el mensaje del usuario a la sala (receive_message)
        ├─ Persiste el mensaje del usuario en Redis (getHistory/saveMessage)
        ├─ Emite  user_typing  { sender: 'Bot' }
        ├─ Llama  processMessage({ text, sessionId, businessId })
        ├─ Emite  user_stop_typing
        ├─ Persiste la respuesta del bot en Redis
        └─ Emite  receive_message  { sender: 'Bot', text }
```

**Eventos Socket adicionales:**

| Evento | Descripción |
|--------|-------------|
| `join_room` | Carga historial Redis, envía bienvenida si es sesión nueva |
| `disconnect` | Cancela el temporizador de inactividad |
| Idle timer (TTL) | Si el usuario no escribe en `SESSION_TTL_SECONDS`, el bot envía un catálogo de categorías |

---

## 3. Pipeline NLP — `messagePipeline.js`

Archivo: `backend/src/services/messagePipeline.js`

### 3.1 Pasos en orden

```
texto crudo del usuario
        │
        ▼
┌─────────────────────────────────────────────┐
│ PASO 1 — preprocessMessage()                │
│  textPreprocessor.js                        │
│  ● normalize()  → minúsculas, sin tildes    │
│  ● stripLeadingConnector()  → quita "pero","y"│
│  ● expandAbbreviations()   → "xq" → "porque"│
│  ● correctTypos()          → TYPO_DICT +    │
│    Levenshtein distancia ≤ 1                │
└─────────────────┬───────────────────────────┘
                  │  normalizedText
                  ▼
┌─────────────────────────────────────────────┐
│ PASO 2 — detectDay()                        │
│  dayDetector.js                             │
│  Detecta menciones de día: "lunes", "hoy"  │
│  Si detecta → salta PASO 4 (sin DB query)  │
└─────────────────┬───────────────────────────┘
                  │  dayEntity | null
                  ▼
┌─────────────────────────────────────────────┐
│ PASO 3 — detectIntent()                     │
│  intentDetector.js                          │
│  Carga keywords de Redis (bootstrapeadas   │
│  por intentExpanderService.js al arrancar) │
│  Suma pesos de cada frase que sea           │
│  substring del texto → ganador si score ≥ 1│
│                                             │
│  Intents: productos / precios / horarios /  │
│  servicios / ubicacion / contacto /         │
│  comprar / promociones / descripcion        │
└─────────────────┬───────────────────────────┘
                  │  { intent, score, scores }
                  ▼
┌─────────────────────────────────────────────┐
│ PASO 4 — detectEntities()                   │
│  entityDetector.js                          │
│  (omitido si dayEntity fue detectado)       │
│                                             │
│  4a. extractCategoryAttributeQuery()        │
│      "alguna bebida con chocolate"          │
│  4b. extractCompoundQuery()                 │
│      "bebida de chocolate":                 │
│       queryCategories("bebida")? →          │
│         si match → categoryTerm            │
│         si no   → entityTerm              │
│  4c. extractAttribute()                     │
│      "algo con queso", "para madera"        │
│  4d. Patrones especiales                    │
│      TIPO_DE_RE / QUE_ENTITY_TIENEN_RE      │
│      → queryCategories primero, luego prod  │
│  4e. extractEntityCandidate() → DB ILIKE    │
│      candidate con " con ":                 │
│        1. queryCategories(entityPart)       │
│        2. queryProducts(fullPhrase)         │
│        3. queryProducts(entityPart)         │
│      candidate sin "con":                  │
│        1. queryProducts                    │
│        2. queryCategories                  │
│        3. queryPromotions                  │
│        4. queryServices  ← nuevo           │
│        5. fallback: candidate como product  │
│                                             │
│  Tipos de resultado:                        │
│    product / category / attribute / day /  │
│    promotion / service  ← nuevos           │
└─────────────────┬───────────────────────────┘
                  │  entityResult
                  ▼
┌─────────────────────────────────────────────┐
│ PASO 5 — getContext()                       │
│  sessionContextService.js → Redis           │
│  { lastIntent, lastEntity, lastEntityFound, │
│    lastAttributes, availableCategories,     │
│    paginationCategory, paginationOffset,    │
│    paginationTotal }                        │
└─────────────────┬───────────────────────────┘
                  │  context
                  ▼
┌─────────────────────────────────────────────┐
│ PASO 5b — Combinación de atributos          │
│  Si tipo=attribute Y context.lastAttr Y     │
│  el mensaje NO tiene trigger fresh          │
│  (algo/hay/tienes/alguna/busco/productos…)  │
│  → acumula atributos anteriores (AND luego  │
│    OR como fallback)                        │
│  Si tiene trigger → búsqueda nueva limpia   │
└─────────────────┬───────────────────────────┘
                  │  entityResult (con _combinedAttributes?)
                  ▼
┌─────────────────────────────────────────────┐
│ PASO 6 — decide()                           │
│  decide() en messagePipeline.js             │
│  Consulta aiDecisionEngine.shouldUseAI()    │
│  Elige la estrategia (ver §3.2)             │
└─────────────────┬───────────────────────────┘
                  │  decision { strategy, intent, entity }
                  ▼
┌──────────────────────┬──────────────────────┐
│ strategy !== 'ai'    │ strategy === 'ai'     │
│                      │                      │
│ executeDecision()    │ handleAIFallback()    │
│  (determinista)      │  (ver §3.4)          │
└──────────────────────┴──────────────────────┘
                  │  replyText
                  ▼
┌─────────────────────────────────────────────┐
│ PASO 7 — updateContext()                    │
│  Guarda en Redis el nuevo lastIntent,       │
│  lastEntity, lastEntityFound, etc.          │
└─────────────────────────────────────────────┘
```

### 3.2 Reglas de decisión (`decide()`)

```
Texto ya normalizado + intentResult + entityResult + context
        │
        ├─ Pre-Regla -1a — isSeekingMore? → strategy='pagination'
        │
        ├─ Pre-Regla -1b — category_selection + match
        │    detectCategorySelection() → strategy='category_select'
        │
        ├─ Pre-Regla -1c — category_selection sin match → strategy='category_reprompt'
        │    EXCEPCIÓN: entityResult.type='attribute' → saltar
        │    (ej: "tiene algo con pollo?" no repromptea lista de categorías)
        │
        ├─ Pre-Regla -1d — comprar + pronombre + lastEntityFound=false
        │    → strategy='product_not_found_followup'
        │
        ├─ Pre-Regla -1e — lastIntent='servicios' → strategy='servicios_followup'
        │    EXCEPCIÓN: entity product/category, o intent standalone, o ambigüedad
        │
        ├─ Regla 0 — dayEntity detectado → strategy='entity' intent='horarios'
        │
        ├─ Regla 0b — comprar + pronombre anafórico + producto en context
        │    → strategy='comprar_context'
        │
        ├─ Regla 1 — intent de alta confianza + standalone
        │    → strategy='intent'
        │
        ├─ Regla 1.5 — AI pre-screen (aiDecisionEngine.shouldUseAI())
        │    ┌─ recomendación / comparación / superlativo → routing='ai'
        │    ├─ AVAIL_VERB_RE (tienes/hay al inicio o final) → routing='backend'
        │    └─ entity detectada                → routing='backend'
        │    Si routing='ai' → strategy='ai'
        │
        ├─ Regla 1.7 — entityResult.type='attribute' → strategy='attribute'
        │
        ├─ Regla 1.8 — entityResult.type='service' → strategy='entity' intent='servicios'
        │    (ruta directa al handler de servicios, sin pasar por Rule 2)
        │
        ├─ Regla 2 — hasEntity → strategy='entity'
        │
        ├─ Regla 2.5 — intent='productos' alta confianza, sin entity
        │    → strategy='intent' (catálogo general, reset de contexto)
        │
        ├─ Regla 3 — intent sin entity → usa context.lastEntity
        │    → strategy='context'
        │
        ├─ Regla 3b — intent standalone de baja confianza → strategy='intent'
        │
        ├─ Regla 4 — mensaje ambiguo + context disponible → strategy='context'
        │
        ├─ Regla 4.6 — "¿Es picante?" + producto en context → strategy='context'
        │
        ├─ Regla 4.8 — "con X" follow-up + producto en context
        │    → strategy='attribute'
        │
        ├─ Regla 4.9 — pronombre de compra + producto en context
        │    → strategy='comprar_context'
        │
        ├─ Regla 5 — extractFollowUpEntity ("y pizza mexicana?")
        │    → strategy='followup'
        │
        ├─ Regla 6 — anti-fallback: context válido + mensaje corto
        │    → strategy='context'
        │
        └─ Regla 7 — fallback final → strategy='ai'
```

### 3.3 Rutas deterministas (`executeDecision`)

| strategy | Acción |
|----------|--------|
| `intent` | `businessInfoService` → `intentResponseFormatter` (horarios, ubicación, contacto, servicios, promociones…) |
| `entity` (product) | `queryProducts()` → `formatProductResponse()` |
| `entity` (category) | `queryCategories()` → lista paginada |
| `entity` (service) | handler `servicios` → word-intersection en `business_services` |
| `attribute` con `categoryTerm` | `searchByCategoryAttribute()` → productos de esa categoría con el atributo |
| `attribute` con `entityTerm` | `searchByCompoundQuery()` → búsqueda 3 capas (exact / entity+attr / entity-only) |
| `attribute` genérico | `searchByAttributes()` → ILIKE AND luego OR |
| `context` | Reutiliza `lastEntity` y repite la búsqueda |
| `followup` | Misma lógica que `entity` con la entidad de seguimiento |
| `comprar` | `intentResponseFormatter.comprar()` — rama `acepto_pedidos true` → botón pedido; `false` → solo contacto |
| `comprar_context` | Igual que `comprar` pero usando el producto del contexto |
| `pagination` | `paginationOffset` en context → siguiente página de la categoría |
| `category_select` | Carga productos de la categoría elegida, actualiza paginación en context |
| `category_reprompt` | Re-muestra lista de `availableCategories` |
| `product_not_found_followup` | Responde que ese producto no está disponible |
| `servicios_followup` | Reutiliza lastIntent='servicios', word-intersection en `business_services` |
| `ai` | `handleAIFallback()` → RAG + Ollama (ver §3.4) |

### 3.4 Ruta IA (`handleAIFallback`)

```
handleAIFallback()
    │
    ├─ PASO 1: Se omite si no hay datos relevantes en BD
    │    ragFilterService.filterRelevantData() — búsqueda contextual
    │    Si ragContext vacío → getMockOpenAIResponse() (sin llamar a Ollama)
    │
    ├─ PASO 2: shouldUseAI() — segunda comprobación
    │    Si routing='backend' → executeDecision() con context
    │
    ├─ PASO 3: Datos insuficientes para enriquecer → mock respuesta
    │
    ├─ PASO 4: (reservado para lógica futura)
    │
    ├─ PASO 4b: Verificar suscripción
    │    subscriptionController.getSubscriptionPlan(businessId)
    │    ├─ PLAN_LITE (1)    → getMockOpenAIResponse() — sin Ollama
    │    └─ PLAN_PREMIUM (2) → continuar a PASO 5
    │
    └─ PASO 5: Ollama llama3
         ollamaService.generateOllamaResponse(prompt, ragContext)
         Si timeout/error → getMockOpenAIResponse() como fallback
```

---

## 4. Módulos de soporte

### `intentExpanderService.js` — solo en arranque

```
server.js arranca
    │
    └─ bootstrapIntents()
           │
           ├─ Lee intents.js (diccionario base)
           ├─ expandIntents():
           │    R1-R3: pluralización de palabras sueltas
           │    R4:    conjugaciones verbales (vende→venden/vendes)
           │    R5:    variantes de género (el/la, un/una)
           │    R6:    sinónimos (precio↔costo↔tarifa)
           └─ Guarda en Redis "intents:expanded" (TTL 7 días)

initIntents() en intentDetector.js
    └─ Lee "intents:expanded" de Redis → memoria del proceso
```

### `sessionContextService.js` — Redis

```
Redis key:  ctx:<businessId>:<sessionId>   TTL: SESSION_TTL_SECONDS

Campos guardados:
  lastIntent         — último intent detectado
  lastEntity         — { type, value }  último producto/categoría
  lastEntityFound    — bool: ¿el producto se encontró en BD?
  lastAttributes     — atributos acumulados (multi-turn con/de)
  availableCategories — para categoría_selection activa
  categoryOffset     — paginación en categoría activa
```

### `ragFilterService.js`

```
filterRelevantData(businessId, text, context)
    │
    ├─ Intenta búsqueda de productos relacionados al tema
    ├─ Fallback a horarios / servicios / info del negocio
    └─ Devuelve { type, data[], summary }
         usado como contexto por Ollama en el prompt RAG
```

---

## 5. Flujo completo — ejemplo de mensaje

**Usuario:** `"que tipos de hamburguesa tiene?"`

```
1. textPreprocessor   → "que tipos de hamburguesa tiene"
                         (sin cambios; no hay conectores/abreviaturas)

2. dayDetector        → null  (no hay mención de día)

3. intentDetector     → intent:"productos"  score:3
                         ("que productos tienen" → substring parcial no,
                          pero "que vendes" tampoco; en realidad la frase
                          QUE_ENTITY_TIENEN_RE en entityDetector puede
                          detectarla primero — ver paso 4)

4. entityDetector
   ├─ catAttrExtracted?  → no (no hay "algún/alguna")
   ├─ skipCompound = false  ("tiene" está al final, no al inicio)
   ├─ compoundExtracted? → no (no hay "de" ni "con" entre dos sustantivos)
   ├─ attrExtracted?     → no (no hay "algo con", "para", etc.)
   ├─ QUE_ENTITY_TIENEN_RE match:
   │   "que tipos de hamburguesa tiene"
   │   → tipoCand = "hamburguesa"
   │   → queryCategories("hamburguesa") → 0 filas
   │   → queryProducts("hamburguesa")   → filas con hamburguesas
   └─ entityResult = { type:'product', value:'hamburguesa', _rows:[...] }

5. getContext         → { lastIntent:'comprar', lastEntity:{type:'product',
                           value:'hamburguesa'} }

6. decide()
   ├─ Regla 1.5 aiPrescreen:
   │   AVAIL_VERB_RE = /tiene[sn]?\s*\??$/ → MATCH (tiene al final)
   │   → PRODUCT_DESC_RE se omite → routing='backend'
   ├─ Regla 1.7 attribute? → no
   └─ Regla 2 hasEntity=true → strategy='entity', intent='productos'

7. executeDecision(strategy='entity', entity='hamburguesa')
   → formatProductResponse() con filas de DB
   → "😊 Tenemos: Hamburguesa Clásica a $85.00, Hamburguesa Doble..."

8. updateContext → lastIntent:'productos', lastEntity:{type:'product', value:'hamburguesa'}

9. chatSocket → emit receive_message { sender:'Bot', text: "😊 Tenemos:..." }
```

---

## 6. Mapa de archivos

```
backend/src/
├── sockets/
│   └── chatSocket.js           ← transporte WebSocket, entry point
├── services/
│   ├── messagePipeline.js      ← orquestador central (decide + ejecuta)
│   ├── textPreprocessor.js     ← normalización, abreviaciones, typos
│   ├── normalize.js            ← lowercase, sin tildes, singularización
│   ├── dayDetector.js          ← detección de días/horarios
│   ├── intentDetector.js       ← scoring de intents contra keywords Redis
│   ├── intentExpanderService.js← expande keywords morfológicamente (arranque)
│   ├── entityDetector.js       ← extracción de producto/categoría/atributo
│   ├── attributeExtractor.js   ← patrones "algo con X", "entity de attr"
│   ├── attributeSearchService.js← búsqueda en BD por atributos/ingredientes
│   ├── aiDecisionEngine.js     ← decide si se usa IA o backend
│   ├── ragFilterService.js     ← filtra datos relevantes para el prompt RAG
│   ├── sessionContextService.js← lectura/escritura de contexto en Redis
│   ├── businessInfoService.js  ← consultas de horarios, ubicación, servicios
│   ├── intentResponseFormatter.js ← formatea respuestas deterministas
│   ├── subscriptionController.js  ← gate de suscripción (Lite/Premium)
│   ├── ollamaService.js        ← llama3 vía Ollama API
│   └── conversationalContext.js   ← helpers de contexto conversacional
├── mockai/
│   ├── intents.js              ← diccionario base de intents y keywords
│   └── keywordResponses.js     ← respuestas hardcodeadas para mock
├── models/
│   ├── businessModel.js        ← queries de negocio (nombre, plan, uuid…)
│   ├── messageModel.js         ← caché en memoria de mensajes
│   └── pedidoModel.js          ← estado de pedidos (acepto_pedidos)
└── temp/
    └── mockOpenAI.js           ← respuestas simuladas cuando no hay Ollama
```

---

## 7. Flujo de inactividad (idle)

```
Usuario deja de escribir
        │
        │  IDLE_TIMEOUT_MS = SESSION_TTL_SECONDS * 1000
        ▼
resetIdleTimer() expira
        │
        ├─ getCategories(businessId)
        ├─ updateContext → lastIntent:'category_selection'
        └─ emit receive_message  "Hola, noté que te tomaste una pausa ☕...
                                  📂 Categorías disponibles: ..."
```

El siguiente mensaje del usuario pasa por `detectCategorySelection()` (Regla 0 en `decide()`) que comprueba si el texto coincide con alguna categoría disponible → `strategy='category_select'`.

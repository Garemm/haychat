-- =============================================================================
-- schema.sql
-- PostgreSQL database schema + seed data for the multi-business AI chat
-- platform. Includes 3 businesses (restaurant, hardware, stationery),
-- 210+ products, inventory, attributes, hours, promotions, services,
-- conversations and messages.
--
-- USAGE:
--   psql -U <user> -d <database> -f schema.sql
--
-- Safe to rerun: all tables are dropped in dependency order first.
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- DROP (reverse dependency order to avoid FK conflicts)
-- ─────────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS messages            CASCADE;
DROP TABLE IF EXISTS conversations       CASCADE;
DROP TABLE IF EXISTS business_services   CASCADE;
DROP TABLE IF EXISTS promotions          CASCADE;
DROP TABLE IF EXISTS business_hours      CASCADE;
DROP TABLE IF EXISTS product_attributes  CASCADE;
DROP TABLE IF EXISTS product_inventory   CASCADE;
DROP TABLE IF EXISTS products            CASCADE;
DROP TABLE IF EXISTS admins              CASCADE;
DROP TABLE IF EXISTS categories          CASCADE;
DROP TABLE IF EXISTS businesses          CASCADE;


-- ─────────────────────────────────────────────────────────────────────────────
-- businesses
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE businesses (
    id           SERIAL        PRIMARY KEY,
    chat_uuid    UUID          NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    name         VARCHAR(255)  NOT NULL,
    category     VARCHAR(50)   NOT NULL
                     CHECK (category IN ('restaurant', 'hardware', 'stationery')),
    description  TEXT,
    city         VARCHAR(100),
    email        VARCHAR(255),
    phone        VARCHAR(50),
    webpage_link VARCHAR(500),
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);


-- ─────────────────────────────────────────────────────────────────────────────
-- admins
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE admins (
    id          SERIAL        PRIMARY KEY,
    username    VARCHAR(100)  NOT NULL UNIQUE,
    password    VARCHAR(255)  NOT NULL,
    business_id INT           NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);


-- ─────────────────────────────────────────────────────────────────────────────
-- categories  (self-referencing for nested categories)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE categories (
    id          SERIAL        PRIMARY KEY,
    name        VARCHAR(255)  NOT NULL,
    business_id INT           NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
    parent_id   INT           REFERENCES categories (id) ON DELETE SET NULL
);


-- ─────────────────────────────────────────────────────────────────────────────
-- products
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE products (
    id           SERIAL          PRIMARY KEY,
    business_id  INT             NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
    name         VARCHAR(255)    NOT NULL,
    description  TEXT,
    price        NUMERIC(10, 2)  NOT NULL DEFAULT 0.00,
    category_id  INT             REFERENCES categories (id) ON DELETE SET NULL,
    is_available BOOLEAN         NOT NULL DEFAULT TRUE,
    item_code_empresa  VARCHAR(100),
    created_at   TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- item_code_empresa is unique per business (not globally unique)
CREATE UNIQUE INDEX idx_products_item_code
    ON products (business_id, item_code_empresa)
    WHERE item_code_empresa IS NOT NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- product_inventory
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE product_inventory (
    id             SERIAL      PRIMARY KEY,
    product_id     INT         NOT NULL UNIQUE REFERENCES products (id) ON DELETE CASCADE,
    stock_quantity INT         NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ─────────────────────────────────────────────────────────────────────────────
-- product_attributes  (flexible key/value pairs per product)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE product_attributes (
    id          SERIAL        PRIMARY KEY,
    product_id  INT           NOT NULL REFERENCES products (id) ON DELETE CASCADE,
    key         VARCHAR(100)  NOT NULL,
    value       TEXT          NOT NULL
);


-- ─────────────────────────────────────────────────────────────────────────────
-- business_hours
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE business_hours (
    id           SERIAL   PRIMARY KEY,
    business_id  INT      NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
    day_of_week  SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    open_time    TIME,
    close_time   TIME,
    is_closed    BOOLEAN  NOT NULL DEFAULT FALSE,
    UNIQUE (business_id, day_of_week)
);


-- ─────────────────────────────────────────────────────────────────────────────
-- promotions
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE promotions (
    id             SERIAL          PRIMARY KEY,
    business_id    INT             NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
    title          VARCHAR(255)    NOT NULL,
    description    TEXT,
    discount_type  VARCHAR(10)     NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
    discount_value NUMERIC(10, 2)  NOT NULL CHECK (discount_value >= 0),
    start_date     DATE            NOT NULL,
    end_date       DATE            NOT NULL,
    CHECK (end_date >= start_date)
);


-- ─────────────────────────────────────────────────────────────────────────────
-- business_services
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE business_services (
    id           SERIAL          PRIMARY KEY,
    business_id  INT             NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
    name         VARCHAR(255)    NOT NULL,
    description  TEXT,
    price        NUMERIC(10, 2)  DEFAULT NULL
);


-- ─────────────────────────────────────────────────────────────────────────────
-- conversations
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE conversations (
    id           SERIAL      PRIMARY KEY,
    business_id  INT         NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ─────────────────────────────────────────────────────────────────────────────
-- messages
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE messages (
    id               SERIAL      PRIMARY KEY,
    conversation_id  INT         NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
    sender           VARCHAR(10) NOT NULL CHECK (sender IN ('user', 'bot')),
    message          TEXT        NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ─────────────────────────────────────────────────────────────────────────────
-- INDEXES  (common query patterns)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX idx_products_business_id       ON products            (business_id);
CREATE INDEX idx_products_category_id       ON products            (category_id);
CREATE INDEX idx_categories_business_id     ON categories          (business_id);
CREATE INDEX idx_product_attributes_product ON product_attributes  (product_id);
CREATE INDEX idx_business_hours_business    ON business_hours      (business_id);
CREATE INDEX idx_promotions_business_id     ON promotions          (business_id);
CREATE INDEX idx_promotions_dates           ON promotions          (start_date, end_date);
CREATE INDEX idx_business_services_business ON business_services   (business_id);
CREATE INDEX idx_conversations_business     ON conversations       (business_id);
CREATE INDEX idx_messages_conversation      ON messages            (conversation_id);
CREATE INDEX idx_messages_created_at        ON messages            (created_at);
CREATE INDEX idx_admins_business_id         ON admins              (business_id);


-- =============================================================================
-- SEED DATA
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- BUSINESSES  (ids 1=restaurant, 2=hardware, 3=stationery)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO businesses (id, name, category, description, city, email, phone, webpage_link) VALUES
(1, 'Restaurante Don Pepe',   'restaurant', 'Comida casera y antojitos mexicanos desde 1995.', 'Ciudad de México', 'contacto@donpepe.mx',     '+52 55 1234 5678', 'https://www.donpepe.mx'),
(2, 'Ferretería El Tornillo', 'hardware',   'Todo en herramientas, materiales y construcción.', 'Guadalajara',      'ventas@eltornillo.mx',    '+52 33 8765 4321', 'https://www.eltornillo.mx'),
(3, 'Papelería La Pluma',     'stationery', 'Artículos escolares, oficina y manualidades.',     'Monterrey',        'info@papeleriapluma.mx', '+52 81 5555 9090', 'https://www.papeleriapluma.mx');

SELECT setval('businesses_id_seq', 3);


-- ─────────────────────────────────────────────────────────────────────────────
-- ADMINS
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO admins (username, password, business_id) VALUES
('admin1', '123', 1),
('admin2', '123', 2),
('admin3', '123', 3);


-- ─────────────────────────────────────────────────────────────────────────────
-- CATEGORIES
-- Parent categories: 1-3. Sub-categories per business below.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO categories (id, name, business_id, parent_id) VALUES
-- Restaurant (business_id = 1)
(1,  'Entradas',                     1, NULL),
(2,  'Platos Fuertes',               1, NULL),
(3,  'Pizzas',                       1, NULL),
(4,  'Hamburguesas',                 1, NULL),
(5,  'Tacos y Antojitos',            1, NULL),
(6,  'Bebidas',                      1, NULL),
(7,  'Postres',                      1, NULL),
-- Hardware (business_id = 2)
(8,  'Herramientas Manuales',        2, NULL),
(9,  'Herramientas Eléctricas',      2, NULL),
(10, 'Materiales de Construcción',   2, NULL),
(11, 'Plomería',                     2, NULL),
(12, 'Electricidad',                 2, NULL),
(13, 'Pintura',                      2, NULL),
(14, 'Seguridad',                    2, NULL),
-- Stationery (business_id = 3)
(15, 'Cuadernos y Libretas',         3, NULL),
(16, 'Escritura',                    3, NULL),
(17, 'Papelería General',            3, NULL),
(18, 'Arte y Manualidades',          3, NULL),
(19, 'Material Escolar',             3, NULL),
(20, 'Tecnología de Oficina',        3, NULL);

SELECT setval('categories_id_seq', 20);


-- ─────────────────────────────────────────────────────────────────────────────
-- PRODUCTS — Restaurant (business_id = 1, ~70 products, ids 1-70)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO products (id, business_id, name, description, price, category_id, is_available, item_code_empresa) VALUES
-- Entradas (cat 1)
(1,  1, 'Guacamole con Totopos',         'Aguacate fresco con totopos artesanales',            55.00,  1, TRUE, 'REST-001'),
(2,  1, 'Elotes en Vaso',                'Elote desgranado con crema, queso y chile',          40.00,  1, TRUE, 'REST-002'),
(3,  1, 'Papas Fritas',                  'Papas cortadas a mano con sal y limón',              50.00,  1, TRUE, 'REST-003'),
(4,  1, 'Alitas BBQ (6 pzas)',           'Alitas de pollo con salsa BBQ ahumada',              95.00,  1, TRUE, 'REST-004'),
(5,  1, 'Nachos con Queso',              'Totopos con queso fundido y jalapeños',              75.00,  1, TRUE, 'REST-005'),
(6,  1, 'Sopa de Tortilla',              'Caldo con tortilla frita, queso y crema',            60.00,  1, TRUE, 'REST-006'),
-- Platos Fuertes (cat 2)
(7,  1, 'Pollo a la Plancha',            'Pechuga a la plancha con verduras y arroz',         120.00,  2, TRUE, 'REST-007'),
(8,  1, 'Milanesa de Res',               'Milanesa empanizada con papas y ensalada',          135.00,  2, TRUE, 'REST-008'),
(9,  1, 'Chiles en Nogada',              'Chile poblano relleno de picadillo con nogada',     180.00,  2, TRUE, 'REST-009'),
(10, 1, 'Pozole Rojo',                   'Pozole tradicional con tostadas y orégano',         110.00,  2, TRUE, 'REST-010'),
(11, 1, 'Enchiladas Verdes',             'Enchiladas con pollo, salsa verde y queso',          85.00,  2, TRUE, 'REST-011'),
(12, 1, 'Mole Poblano',                  'Pollo en mole con arroz y frijoles',                130.00,  2, TRUE, 'REST-012'),
(13, 1, 'Caldo de Res',                  'Caldo con verduras de temporada y res',              90.00,  2, TRUE, 'REST-013'),
(14, 1, 'Filete de Pescado',             'Filete a la veracruzana con arroz blanco',          145.00,  2, TRUE, 'REST-014'),
(15, 1, 'Flautas de Papa',               'Flautas crujientes con crema y lechuga',             70.00,  2, TRUE, 'REST-015'),
-- Pizzas (cat 3)
(16, 1, 'Pizza Margarita',               'Jitomate, mozzarella y albahaca fresca',            110.00,  3, TRUE, 'REST-016'),
(17, 1, 'Pizza Pepperoni',               'Salsa de jitomate, pepperoni y queso',              130.00,  3, TRUE, 'REST-017'),
(18, 1, 'Pizza Hawaiana',                'Jamón, piña y queso mozzarella',                   120.00,  3, TRUE, 'REST-018'),
(19, 1, 'Pizza Cuatro Quesos',           'Mozzarella, gouda, parmesano y manchego',          145.00,  3, TRUE, 'REST-019'),
(20, 1, 'Pizza Mexicana',                'Chorizo, jalapeño, cebolla y chile',                135.00,  3, TRUE, 'REST-020'),
(21, 1, 'Pizza de la Casa',              'Verduras mixtas, aceituna y queso',                 125.00,  3, TRUE, 'REST-021'),
-- Hamburguesas (cat 4)
(22, 1, 'Hamburguesa Clásica',           'Carne 150g, lechuga, jitomate y mostaza',            95.00,  4, TRUE, 'REST-022'),
(23, 1, 'Hamburguesa BBQ',               'Carne 180g, queso cheddar y salsa BBQ',             115.00,  4, TRUE, 'REST-023'),
(24, 1, 'Hamburguesa Doble',             'Doble carne 300g, doble queso y tocino',            150.00,  4, TRUE, 'REST-024'),
(25, 1, 'Hamburguesa Vegetariana',       'Medallón de garbanzo, aguacate y verduras',         105.00,  4, TRUE, 'REST-025'),
(26, 1, 'Hamburguesa Picante',           'Carne 180g, jalapeños y salsa habanero',            120.00,  4, TRUE, 'REST-026'),
-- Tacos y Antojitos (cat 5)
(27, 1, 'Taco de Pastor (3 pzas)',       'Tortilla de maíz con carne al pastor',               55.00,  5, TRUE, 'REST-027'),
(28, 1, 'Taco de Canasta (3 pzas)',      'Taco bañado en salsa, frijol o papa',               45.00,  5, TRUE, 'REST-028'),
(29, 1, 'Taco de Barbacoa (3 pzas)',     'Barbacoa de res con salsa verde',                   65.00,  5, TRUE, 'REST-029'),
(30, 1, 'Taco de Suadero (3 pzas)',      'Suadero dorado con cebolla y cilantro',             60.00,  5, TRUE, 'REST-030'),
(31, 1, 'Quesadilla de Queso',           'Tortilla de harina con queso oaxaca',               50.00,  5, TRUE, 'REST-031'),
(32, 1, 'Tostada de Pollo',              'Tostada con pollo, crema y lechuga',                45.00,  5, TRUE, 'REST-032'),
(33, 1, 'Sope de Frijoles',              'Sope con frijoles, crema y queso',                  40.00,  5, TRUE, 'REST-033'),
(34, 1, 'Tamales de Rajas (2 pzas)',     'Tamales de elote con rajas y queso',                50.00,  5, TRUE, 'REST-034'),
(35, 1, 'Tamales Rojos (2 pzas)',        'Tamales de cerdo en salsa roja',                    55.00,  5, TRUE, 'REST-035'),
(36, 1, 'Gordita de Chicharrón',         'Gordita rellena de chicharrón y salsa',             42.00,  5, TRUE, 'REST-036'),
-- Bebidas (cat 6)
(37, 1, 'Agua de Jamaica 500ml',         'Agua fresca de Jamaica',                            25.00,  6, TRUE, 'REST-037'),
(38, 1, 'Agua de Horchata 500ml',        'Horchata tradicional con canela',                   25.00,  6, TRUE, 'REST-038'),
(39, 1, 'Refresco en Lata',              'Coca-Cola, Fanta o Sprite 355ml',                   28.00,  6, TRUE, 'REST-039'),
(40, 1, 'Jugo de Naranja Natural',       'Jugo exprimido al momento 400ml',                   40.00,  6, TRUE, 'REST-040'),
(41, 1, 'Café de Olla',                  'Café molido con canela y piloncillo',               30.00,  6, TRUE, 'REST-041'),
(42, 1, 'Michelada',                     'Cerveza con limón, sal y clamato',                   60.00,  6, TRUE, 'REST-042'),
(43, 1, 'Limonada Natural 500ml',        'Limonada exprimida al momento',                     30.00,  6, TRUE, 'REST-043'),
(44, 1, 'Agua Mineral 600ml',            'Agua mineral sin sabor',                            20.00,  6, TRUE, 'REST-044'),
(45, 1, 'Malteada de Chocolate',         'Malteada cremosa con leche y helado',               65.00,  6, TRUE, 'REST-045'),
(46, 1, 'Té Verde Frío 500ml',           'Té verde con menta y limón',                        28.00,  6, TRUE, 'REST-046'),
-- Postres (cat 7)
(47, 1, 'Flan Napolitano',               'Flan traditional con cajeta',                       55.00,  7, TRUE, 'REST-047'),
(48, 1, 'Pastel de Tres Leches',         'Bizcocho bañado en tres leches',                    65.00,  7, TRUE, 'REST-048'),
(49, 1, 'Churros con Chocolate 4 pzas', 'Churros fritos con chocolate caliente',              60.00,  7, TRUE, 'REST-049'),
(50, 1, 'Helado de Vainilla 2 bolas',    'Helado artesanal de vainilla',                      45.00,  7, TRUE, 'REST-050'),
(51, 1, 'Brownie con Helado',            'Brownie tibio con helado de vainilla',              70.00,  7, TRUE, 'REST-051'),
(52, 1, 'Gelatina de Mosaico',           'Gelatina colorida con crema',                       35.00,  7, TRUE, 'REST-052'),
(53, 1, 'Arroz con Leche',               'Arroz con leche, canela y pasas',                   40.00,  7, TRUE, 'REST-053'),
(54, 1, 'Pay de Limón',                  'Pay de limón con base de galleta',                  60.00,  7, TRUE, 'REST-054'),
(55, 1, 'Crepa de Cajeta',               'Crepa rellena de cajeta y nuez',                    65.00,  7, TRUE, 'REST-055'),
(56, 1, 'Buñuelo con Miel',              'Buñuelo crujiente con miel de piloncillo',          45.00,  7, TRUE, 'REST-056'),
-- Extra platos (cat 2) to reach 70
(57, 1, 'Sopa de Lima',                  'Sopa yucateca con pollo y lima',                    75.00,  2, TRUE, 'REST-057'),
(58, 1, 'Lasaña de Res',                 'Lasaña italiana con carne molida y queso',         140.00,  2, TRUE, 'REST-058'),
(59, 1, 'Pollo en Crema',                'Pollo en salsa de crema y espinacas',              125.00,  2, TRUE, 'REST-059'),
(60, 1, 'Camarones al Ajillo',           'Camarones salteados con ajo y limón',              165.00,  2, TRUE, 'REST-060'),
(61, 1, 'Costillas Barbacoa',            'Costillas de cerdo en salsa BBQ',                  170.00,  2, TRUE, 'REST-061'),
(62, 1, 'Tiritas de Pollo',              'Tiritas empanizadas con aderezo ranch',             90.00,  2, TRUE, 'REST-062'),
(63, 1, 'Chilaquiles Rojos',             'Chilaquiles con pollo, crema y queso',              80.00,  2, TRUE, 'REST-063'),
(64, 1, 'Huevos Rancheros',              'Huevos fritos sobre tortilla con salsa',            70.00,  2, TRUE, 'REST-064'),
(65, 1, 'Bistec a la Mexicana',          'Bistec con jitomate, cebolla y chile serrano',     115.00,  2, TRUE, 'REST-065'),
(66, 1, 'Torta Cubana',                  'Torta con milanesa, jamón, pierna y queso',         90.00,  4, TRUE, 'REST-066'),
(67, 1, 'Torta de Carnitas',             'Torta con carnitas, aguacate y chile',              85.00,  4, TRUE, 'REST-067'),
(68, 1, 'Club Sándwich',                 'Sándwich triple con pollo, tocino y queso',         95.00,  4, TRUE, 'REST-068'),
(69, 1, 'Orden de Carnitas 250g',        'Carnitas de cerdo con tortillas y salsa',          110.00,  5, TRUE, 'REST-069'),
(70, 1, 'Orden de Chicharrón Prensado',  'Chicharrón prensado con tortillas',                 90.00,  5, TRUE, 'REST-070');


-- ─────────────────────────────────────────────────────────────────────────────
-- PRODUCTS — Hardware store (business_id = 2, ids 71-140)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO products (id, business_id, name, description, price, category_id, is_available, item_code_empresa) VALUES
-- Herramientas Manuales (cat 8)
(71,  2, 'Martillo de 16oz',            'Martillo de acero con mango de fibra de vidrio',   185.00,  8, TRUE, 'HW-001'),
(72,  2, 'Desarmador Plano 6"',         'Desarmador de punta plana con mango ergonómico',    55.00,  8, TRUE, 'HW-002'),
(73,  2, 'Desarmador Cruz #2',          'Desarmador Phillips con mango bicolor',             55.00,  8, TRUE, 'HW-003'),
(74,  2, 'Pinza de Electricista',       'Pinza de corte con aislamiento 1000V',             160.00,  8, TRUE, 'HW-004'),
(75,  2, 'Cinta Métrica 5m',            'Cinta métrica de acero con freno automático',       90.00,  8, TRUE, 'HW-005'),
(76,  2, 'Nivel de Burbuja 60cm',       'Nivel de aluminio con 3 burbujas',                 120.00,  8, TRUE, 'HW-006'),
(77,  2, 'Llave Española Ajustable 8"', 'Llave ajustable de acero cromado',                 145.00,  8, TRUE, 'HW-007'),
(78,  2, 'Segueta Manual',              'Segueta con hoja bimetálica 24 dientes',            80.00,  8, TRUE, 'HW-008'),
(79,  2, 'Escuadra de 12"',             'Escuadra de acero inoxidable',                      95.00,  8, TRUE, 'HW-009'),
(80,  2, 'Cutter Profesional 18mm',     'Cuchilla retráctil con hoja de 18mm',               65.00,  8, TRUE, 'HW-010'),
(81,  2, 'Tenaza Grip 10"',             'Tenaza de presión ajustable',                      155.00,  8, TRUE, 'HW-011'),
(82,  2, 'Llave Allen Juego 9 pzas',    'Juego de llaves hexagonales SAE',                   70.00,  8, TRUE, 'HW-012'),
(83,  2, 'Rayador de Madera',           'Rayador de acero con mango de madera',              45.00,  8, TRUE, 'HW-013'),
(84,  2, 'Espátula de Yeso 4"',         'Espátula de acero flexible para yeso',              50.00,  8, TRUE, 'HW-014'),
(85,  2, 'Paleta de Albañil',           'Paleta de acero con mango de madera',               75.00,  8, TRUE, 'HW-015'),
-- Herramientas Eléctricas (cat 9)
(86,  2, 'Taladro Percutor 13mm',       'Taladro 750W con velocidad variable',              890.00,  9, TRUE, 'HW-016'),
(87,  2, 'Esmeriladora Angular 4.5"',   'Esmeriladora 860W con disco de corte',             650.00,  9, TRUE, 'HW-017'),
(88,  2, 'Sierra Circular 7.25"',       'Sierra circular 1500W con guía',                  1100.00,  9, TRUE, 'HW-018'),
(89,  2, 'Atornillador Inalámbrico 12V','Atornillador con batería de litio',                750.00,  9, TRUE, 'HW-019'),
(90,  2, 'Lijadora Orbital 150W',       'Lijadora con base rectangular 93x185mm',           480.00,  9, TRUE, 'HW-020'),
(91,  2, 'Pistola de Calor 2000W',      'Pistola termosopladora con 2 temperaturas',        450.00,  9, TRUE, 'HW-021'),
(92,  2, 'Rotomartillo SDS 800W',       'Rotomartillo con función de cincel',              1350.00,  9, TRUE, 'HW-022'),
(93,  2, 'Compresor de Aire 25L',       'Compresor 2HP con tanque de 25 litros',           2500.00,  9, TRUE, 'HW-023'),
(94,  2, 'Cortadora de Azulejo 600mm',  'Cortadora manual para azulejo',                    550.00,  9, TRUE, 'HW-024'),
(95,  2, 'Cargador de Batería 12/24V',  'Cargador para baterías de autos',                  380.00,  9, TRUE, 'HW-025'),
-- Materiales de Construcción (cat 10)
(96,  2, 'Cemento Gris 50kg',           'Cemento Portland gris de alta resistencia',        175.00, 10, TRUE, 'HW-026'),
(97,  2, 'Arena de Río costal 40kg',    'Arena limpia para mezcla y construcción',           80.00, 10, TRUE, 'HW-027'),
(98,  2, 'Grava Costal 40kg',           'Grava 3/8" para concreto',                          85.00, 10, TRUE, 'HW-028'),
(99,  2, 'Block de Concreto 15x20x40',  'Block estándar para muros',                         12.00, 10, TRUE, 'HW-029'),
(100, 2, 'Ladrillo Tabique Rojo',       'Ladrillo rojo para construcción',                    8.50, 10, TRUE, 'HW-030'),
(101, 2, 'Varilla 3/8" x 12m',         'Varilla corrugada de acero',                        185.00, 10, TRUE, 'HW-031'),
(102, 2, 'Malla Electrosoldada 6x6',    'Rollo 2.5x6m para losas',                          480.00, 10, TRUE, 'HW-032'),
(103, 2, 'Alambre Recocido Kg',         'Alambre negro para amarrar varilla',                 55.00, 10, TRUE, 'HW-033'),
(104, 2, 'Lámina Galvanizada Cal.24',   'Lámina 1m x 2m galvanizada',                       195.00, 10, TRUE, 'HW-034'),
(105, 2, 'Tablaroca 4x8 Normal',        'Panel de yeso para muros interiores',               145.00, 10, TRUE, 'HW-035'),
-- Plomería (cat 11)
(106, 2, 'Tubo PVC 1/2" x 3m',         'Tubo hidráulico PVC para agua fría',                38.00, 11, TRUE, 'HW-036'),
(107, 2, 'Tubo PVC 1" x 3m',           'Tubo hidráulico PVC de 1 pulgada',                  65.00, 11, TRUE, 'HW-037'),
(108, 2, 'Codo PVC 90° 1/2"',          'Codo para tubería hidráulica',                       8.00, 11, TRUE, 'HW-038'),
(109, 2, 'Llave de Paso Esférica 1/2"','Llave de paso de latón 1/2"',                        95.00, 11, TRUE, 'HW-039'),
(110, 2, 'Flotador para Tinaco',        'Flotador plástico de 1/2"',                          45.00, 11, TRUE, 'HW-040'),
(111, 2, 'Wc Completo Económico',       'Inodoro con mochila incluida',                      850.00, 11, TRUE, 'HW-041'),
(112, 2, 'Lavabo de Empotrar',          'Lavabo cerámico blanco 50x38cm',                    420.00, 11, TRUE, 'HW-042'),
(113, 2, 'Regadera de Ducha 8"',        'Regadera fija de acero inoxidable',                 185.00, 11, TRUE, 'HW-043'),
(114, 2, 'Cinta Teflón 12m',            'Cinta selladora para tuberías',                      12.00, 11, TRUE, 'HW-044'),
(115, 2, 'Pegamento PVC 125ml',         'Adhesivo para uniones de PVC',                       35.00, 11, TRUE, 'HW-045'),
-- Electricidad (cat 12)
(116, 2, 'Cable THWN 12 AWG 100m',      'Cable de cobre para instalaciones',                 420.00, 12, TRUE, 'HW-046'),
(117, 2, 'Apagador Sencillo',           'Apagador de 10A color marfil',                       38.00, 12, TRUE, 'HW-047'),
(118, 2, 'Contacto Doble Polarizado',   'Contacto de 15A con tierra física',                  45.00, 12, TRUE, 'HW-048'),
(119, 2, 'Foco LED 9W E27',             'Foco LED luz fría 6500K',                            55.00, 12, TRUE, 'HW-049'),
(120, 2, 'Tablero 4 circuitos',         'Tablero de distribución c/ barra',                  320.00, 12, TRUE, 'HW-050'),
(121, 2, 'Interruptor Termomagnético 20A','Interruptor de seguridad para circuito',          145.00, 12, TRUE, 'HW-051'),
(122, 2, 'Canaleta Plástica 20x10mm 2m','Canaleta para ocultar cables',                      42.00, 12, TRUE, 'HW-052'),
(123, 2, 'Multímetro Digital',          'Multímetro con pantalla LCD y puntas',              195.00, 12, TRUE, 'HW-053'),
(124, 2, 'Foco Ahorrador 20W E27',      'Foco espiral luz blanca',                            38.00, 12, TRUE, 'HW-054'),
(125, 2, 'Extensión 5m 3 contactos',    'Extensión con interruptor y tierra',                 95.00, 12, TRUE, 'HW-055'),
-- Pintura (cat 13)
(126, 2, 'Pintura Vinílica Blanca 4L',  'Pintura para interiores base agua',                 195.00, 13, TRUE, 'HW-056'),
(127, 2, 'Pintura Vinílica Color 4L',   'Pintura interior lavable color a elegir',            225.00, 13, TRUE, 'HW-057'),
(128, 2, 'Brocha 3" Cerda Natural',     'Brocha para barniz y esmalte',                       55.00, 13, TRUE, 'HW-058'),
(129, 2, 'Rodillo de Pintura 9"',       'Kit rodillo con charola',                             85.00, 13, TRUE, 'HW-059'),
(130, 2, 'Lija de Agua Grano 120',      'Lija para madera y metal (pliego)',                  12.00, 13, TRUE, 'HW-060'),
(131, 2, 'Thinner Extra 1L',            'Diluyente para esmaltes y lacas',                    55.00, 13, TRUE, 'HW-061'),
(132, 2, 'Sellador Acrílico Blanco 5kg','Sellador para paredes y techos',                    185.00, 13, TRUE, 'HW-062'),
(133, 2, 'Esmalte Sintético Negro 1L',  'Esmalte brillante alto rendimiento',                 95.00, 13, TRUE, 'HW-063'),
(134, 2, 'Impermeabilizante 4L',        'Impermeabilizante acrílico para terrazas',           245.00, 13, TRUE, 'HW-064'),
-- Seguridad (cat 14)
(135, 2, 'Candado Doble Seguro 50mm',   'Candado de acero endurecido',                       145.00, 14, TRUE, 'HW-065'),
(136, 2, 'Cerradura de Embutir',        'Cerradura para puerta principal',                    280.00, 14, TRUE, 'HW-066'),
(137, 2, 'Bisagra Pesada 4"',           'Bisagra de acero galvanizado par',                    45.00, 14, TRUE, 'HW-067'),
(138, 2, 'Espejo Convexo 30cm',         'Espejo de seguridad para cocheras',                  185.00, 14, TRUE, 'HW-068'),
(139, 2, 'Alarma Magnética para Puerta','Sensor de alarma inalámbrico',                       125.00, 14, TRUE, 'HW-069'),
(140, 2, 'Guantes de Trabajo L',        'Guantes de cuero para trabajos pesados',              75.00, 14, TRUE, 'HW-070');


-- ─────────────────────────────────────────────────────────────────────────────
-- PRODUCTS — Stationery (business_id = 3, ids 141-210)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO products (id, business_id, name, description, price, category_id, is_available, item_code_empresa) VALUES
-- Cuadernos y Libretas (cat 15)
(141, 3, 'Cuaderno Profesional 100h',   'Cuaderno cuadro chico 100 hojas',                   42.00, 15, TRUE, 'STN-001'),
(142, 3, 'Cuaderno Cuadro 200h',        'Cuaderno doble raya 200 hojas tapa dura',            75.00, 15, TRUE, 'STN-002'),
(143, 3, 'Libreta Universitaria A4',    'Libreta universitaria 80h college rule',             38.00, 15, TRUE, 'STN-003'),
(144, 3, 'Cuaderno Espiral 180h',       'Cuaderno espiral con 5 materias',                    65.00, 15, TRUE, 'STN-004'),
(145, 3, 'Libreta Oxford Pocket',       'Libreta pequeña para notas rápidas',                 28.00, 15, TRUE, 'STN-005'),
(146, 3, 'Cuaderno de Dibujo A3',       'Cuaderno de dibujo sin líneas 80h',                  58.00, 15, TRUE, 'STN-006'),
(147, 3, 'Bloc de Notas Post-it 76mm',  'Bloc de notas adhesivas amarillas 100h',             35.00, 15, TRUE, 'STN-007'),
(148, 3, 'Agenda Semanal 2026',         'Agenda con portada rígida y separadores',             98.00, 15, TRUE, 'STN-008'),
(149, 3, 'Cuaderno de Puntos A5',       'Bullet journal cuadro de puntos 120h',              110.00, 15, TRUE, 'STN-009'),
(150, 3, 'Libreta de Música 50h',       'Libreta con pentagramas impresos',                   45.00, 15, TRUE, 'STN-010'),
-- Escritura (cat 16)
(151, 3, 'Bolígrafo BIC Azul Caja 12', 'Caja de 12 bolígrafos punta media',                  45.00, 16, TRUE, 'STN-011'),
(152, 3, 'Pluma Pilot G2 0.5mm',        'Pluma gel retráctil tinta azul',                     28.00, 16, TRUE, 'STN-012'),
(153, 3, 'Marcador Permanente Negro',   'Marcador Sharpie punta fina',                        22.00, 16, TRUE, 'STN-013'),
(154, 3, 'Lápiz Mongol #2 Caja 12',    'Caja 12 lápices de grafito HB',                      35.00, 16, TRUE, 'STN-014'),
(155, 3, 'Pluma Fuente Schneider',      'Pluma fuente con cartucho intercambiable',           145.00, 16, TRUE, 'STN-015'),
(156, 3, 'Marcador Textliner Stabilo',  'Resaltador pastel surtido 4 colores',                48.00, 16, TRUE, 'STN-016'),
(157, 3, 'Corrector Líquido 20ml',      'Corrector blanco con punta fina',                    18.00, 16, TRUE, 'STN-017'),
(158, 3, 'Marcadores de Colores 24 pzas','Set de marcadores de agua 24 colores',              75.00, 16, TRUE, 'STN-018'),
(159, 3, 'Portaminas 0.5mm',            'Portaminas metálico con goma',                       55.00, 16, TRUE, 'STN-019'),
(160, 3, 'Minas 0.5mm HB paquete 10',  'Minas de repuesto para portaminas',                  18.00, 16, TRUE, 'STN-020'),
(161, 3, 'Pluma Sakura Micron 0.3mm',   'Pluma de dibujo técnico waterproof',                 38.00, 16, TRUE, 'STN-021'),
(162, 3, 'Gel Pen Muji Negro 0.5mm',    'Pluma gel de trazo fino',                            32.00, 16, TRUE, 'STN-022'),
-- Papelería General (cat 17)
(163, 3, 'Grapas Caja 5000 pzas',       'Caja de grapas 26/6 estándar',                       18.00, 17, TRUE, 'STN-023'),
(164, 3, 'Clips Niquelados Caja 100',   'Clips estándar 33mm niquelados',                     15.00, 17, TRUE, 'STN-024'),
(165, 3, 'Tijeras Escolar 6"',          'Tijeras inoxidables con mango plástico',             35.00, 17, TRUE, 'STN-025'),
(166, 3, 'Cinta Adhesiva Scotch 19mm',  'Cinta transparente rollo 33m',                       22.00, 17, TRUE, 'STN-026'),
(167, 3, 'Folder Manila Carta Paq 10',  'Paquete 10 folders manila tamaño carta',             28.00, 17, TRUE, 'STN-027'),
(168, 3, 'Archivero de Palanca A4',     'Archivero lomo ancho con ventana',                   65.00, 17, TRUE, 'STN-028'),
(169, 3, 'Separadores de Colores 10 pzas','Separadores plásticos A4 con pestañas',           22.00, 17, TRUE, 'STN-029'),
(170, 3, 'Engrapadora Swingline 747',   'Engrapadora de escritorio metálica',                185.00, 17, TRUE, 'STN-030'),
(171, 3, 'Perforadora 2 hoyos',         'Perforadora metálica para 30 hojas',                 90.00, 17, TRUE, 'STN-031'),
(172, 3, 'Regla de Plástico 30cm',      'Regla transparente milimetrada',                     12.00, 17, TRUE, 'STN-032'),
(173, 3, 'Escuadras Plástico Set 2',    'Escuadra 45° y 60° transparentes',                   25.00, 17, TRUE, 'STN-033'),
(174, 3, 'Transportador 180°',          'Transportador de plástico transparente',              14.00, 17, TRUE, 'STN-034'),
(175, 3, 'Pegamento en Barra 20g',      'Barra de pegamento UHU sólido',                      22.00, 17, TRUE, 'STN-035'),
(176, 3, 'Resistol 5000 500ml',         'Pegamento blanco multipropósito',                    45.00, 17, TRUE, 'STN-036'),
-- Arte y Manualidades (cat 18)
(177, 3, 'Pinturas Vinílicas 12 colores','Set de pinturas vinílicas 12x20ml',                 68.00, 18, TRUE, 'STN-037'),
(178, 3, 'Pinceles Sintéticos Set 10',  'Set 10 pinceles de pelo sintético',                  55.00, 18, TRUE, 'STN-038'),
(179, 3, 'Cartulina Blanca Carta Paq 10','Paquete 10 cartulinas blancas',                    32.00, 18, TRUE, 'STN-039'),
(180, 3, 'Foami Liso A4 Surtido 10',    'Paquete 10 foamis de colores',                       38.00, 18, TRUE, 'STN-040'),
(181, 3, 'Tijeras Zigzag Decorativa',   'Tijeras con filo de zig-zag',                        48.00, 18, TRUE, 'STN-041'),
(182, 3, 'Crayolas Gruesas 24 colores', 'Crayolas Crayola jumbo 24 colores',                  55.00, 18, TRUE, 'STN-042'),
(183, 3, 'Plastilina 12 colores 200g',  'Plastilina suave set 12 colores',                    45.00, 18, TRUE, 'STN-043'),
(184, 3, 'Acuarelas Windsor 12 colores','Caja de acuarelas semisólidas',                      95.00, 18, TRUE, 'STN-044'),
(185, 3, 'Block de Dibujo A3 20h',      'Block con papel especial para dibujo',               72.00, 18, TRUE, 'STN-045'),
(186, 3, 'Silicón Líquido 500ml',       'Silicón líquido escolar para manualidades',           38.00, 18, TRUE, 'STN-046'),
-- Material Escolar (cat 19)
(187, 3, 'Mochila Escolar 18"',         'Mochila con compartimentos y porta-laptop',          285.00, 19, TRUE, 'STN-047'),
(188, 3, 'Lonchera Térmica',            'Lonchera isotérmica con cierre hermético',           145.00, 19, TRUE, 'STN-048'),
(189, 3, 'Cartuchera Doble Zipper',     'Cartuchera con 2 compartimentos',                     58.00, 19, TRUE, 'STN-049'),
(190, 3, 'Compás Escolar Metálico',     'Compás de metal con portaminas',                      75.00, 19, TRUE, 'STN-050'),
(191, 3, 'Calculadora Científica',      'Calculadora Casio FX-82 350 funciones',              245.00, 19, TRUE, 'STN-051'),
(192, 3, 'Set Geometría 5 pzas',        'Set con regla, escuadras, compás y transportador',   55.00, 19, TRUE, 'STN-052'),
(193, 3, 'Borrador Milán 430 Grande',   'Borrador para lápiz sin PVC',                        18.00, 19, TRUE, 'STN-053'),
(194, 3, 'Sacapuntas Metálico c/depósito','Sacapuntas doble con depósito',                   22.00, 19, TRUE, 'STN-054'),
(195, 3, 'Atlas Geográfico Escolar',    'Atlas mundial escolar 120 páginas',                  125.00, 19, TRUE, 'STN-055'),
(196, 3, 'Diccionario Español Larousse','Diccionario escolar 40 000 términos',               185.00, 19, TRUE, 'STN-056'),
-- Tecnología de Oficina (cat 20)
(197, 3, 'USB Flash 32GB',              'Memoria USB 3.0 retráctil 32GB',                     95.00, 20, TRUE, 'STN-057'),
(198, 3, 'Mouse Inalámbrico',           'Mouse óptico inalámbrico 2.4GHz',                   185.00, 20, TRUE, 'STN-058'),
(199, 3, 'Teclado USB Compacto',        'Teclado USB español TKL',                           195.00, 20, TRUE, 'STN-059'),
(200, 3, 'Lámpara LED de Escritorio',   'Lámpara con 3 temperaturas y USB',                  245.00, 20, TRUE, 'STN-060'),
(201, 3, 'Organizador de Escritorio',   'Organizador con 6 compartimentos plástico',           85.00, 20, TRUE, 'STN-061'),
(202, 3, 'Porta-tablet Universal',      'Soporte ajustable para tablet 7–12"',               120.00, 20, TRUE, 'STN-062'),
(203, 3, 'Hub USB 4 puertos',           'Hub USB 2.0 con cable 60cm',                         95.00, 20, TRUE, 'STN-063'),
(204, 3, 'Audífonos con Micrófono',     'Audífonos estéreo con cable 1.8m',                  175.00, 20, TRUE, 'STN-064'),
(205, 3, 'Cámara Web HD 720p',          'Webcam USB con micrófono integrado',                 285.00, 20, TRUE, 'STN-065'),
(206, 3, 'Almohadilla Ergonómica Mouse','Reposamuñecas de gel',                               65.00, 20, TRUE, 'STN-066'),
(207, 3, 'Cargador USB-C 45W',          'Cargador de pared carga rápida',                    195.00, 20, TRUE, 'STN-067'),
(208, 3, 'Rotulador para Pizarrón Negro','Marcador de tinta líquida borrable',                18.00, 20, TRUE, 'STN-068'),
(209, 3, 'Cuaderno Inteligente A4 120h','Cuaderno de tapa dura con espiral y bolsillo',      145.00, 15, TRUE, 'STN-069'),
(210, 3, 'Diario Personal c/candado',   'Diario con tapa rígida y cierre de candado',         95.00, 15, TRUE, 'STN-070');

SELECT setval('products_id_seq', 210);


-- ─────────────────────────────────────────────────────────────────────────────
-- PRODUCT INVENTORY  (one row per product)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO product_inventory (product_id, stock_quantity) VALUES
-- Restaurant (products 1-70)
(1,50),(2,80),(3,100),(4,60),(5,70),(6,40),(7,35),(8,30),(9,20),(10,25),
(11,45),(12,22),(13,18),(14,15),(15,40),(16,30),(17,35),(18,28),(19,20),(20,25),
(21,22),(22,50),(23,45),(24,30),(25,35),(26,40),(27,90),(28,100),(29,60),(30,70),
(31,80),(32,75),(33,65),(34,55),(35,50),(36,60),(37,120),(38,100),(39,150),(40,80),
(41,90),(42,60),(43,110),(44,200),(45,40),(46,95),(47,30),(48,25),(49,50),(50,40),
(51,35),(52,45),(53,38),(54,28),(55,30),(56,42),(57,20),(58,18),(59,22),(60,15),
(61,12),(62,30),(63,35),(64,40),(65,28),(66,45),(67,50),(68,38),(69,20),(70,22),
-- Hardware (products 71-140)
(71,25),(72,40),(73,40),(74,30),(75,50),(76,20),(77,25),(78,30),(79,20),(80,35),
(81,15),(82,25),(83,20),(84,30),(85,25),(86,12),(87,15),(88,8),(89,18),(90,20),
(91,22),(92,6),(93,4),(94,10),(95,15),(96,80),(97,120),(98,100),(99,500),(100,400),
(101,60),(102,15),(103,50),(104,30),(105,40),(106,80),(107,60),(108,200),(109,45),
(110,50),(111,8),(112,10),(113,20),(114,300),(115,80),(116,20),(117,60),(118,55),
(119,100),(120,15),(121,25),(122,40),(123,20),(124,80),(125,35),(126,30),(127,25),
(128,40),(129,30),(130,100),(131,40),(132,20),(133,30),(134,15),(135,25),(136,15),
(137,30),(138,12),(139,20),(140,35),
-- Stationery (products 141-210)
(141,150),(142,120),(143,200),(144,130),(145,180),(146,90),(147,160),(148,60),(149,70),(150,50),
(151,200),(152,120),(153,180),(154,250),(155,40),(156,90),(157,200),(158,80),(159,60),(160,150),
(161,70),(162,90),(163,300),(164,350),(165,100),(166,200),(167,150),(168,80),(169,120),(170,30),
(171,40),(172,200),(173,100),(174,150),(175,180),(176,80),(177,60),(178,50),(179,200),(180,160),
(181,70),(182,90),(183,100),(184,40),(185,60),(186,80),(187,30),(188,40),(189,80),(190,50),
(191,25),(192,60),(193,250),(194,200),(195,30),(196,25),(197,80),(198,40),(199,35),(200,25),
(201,50),(202,30),(203,45),(204,35),(205,15),(206,45),(207,30),(208,120),(209,65),(210,55);


-- ─────────────────────────────────────────────────────────────────────────────
-- PRODUCT ATTRIBUTES  (2+ per product, sample for all 210)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO product_attributes (product_id, key, value) VALUES
-- Restaurant
(1,'porción','250g'),(1,'picante','medio'),
(2,'tamaño','vaso 400ml'),(2,'topping','chile piquín'),
(3,'corte','juliana'),(3,'sal','con sal de mar'),
(4,'pieza','6 unidades'),(4,'salsa','BBQ ahumada'),
(5,'queso','manchego fundido'),(5,'jalapeño','opcional'),
(6,'base','caldo de pollo'),(6,'topping','crema y queso'),
(7,'proteína','pechuga 200g'),(7,'acompañamiento','arroz y verduras'),
(8,'corte','empanizado'),(8,'acompañamiento','papas y ensalada'),
(9,'relleno','picadillo de res y cerdo'),(9,'nogada','nuez de castilla'),
(10,'tipo','rojo'),(10,'guarnición','tostadas y rábanos'),
(11,'salsa','verde tomatillo'),(11,'relleno','pollo deshebrado'),
(12,'tipo','negro'),(12,'acompañamiento','arroz y frijoles'),
(13,'proteína','costilla de res'),(13,'verduras','zanahoria, chayote, calabaza'),
(14,'estilo','veracruzana'),(14,'acompañamiento','arroz blanco'),
(15,'relleno','papa'),(15,'salsa','verde o roja'),
(16,'queso','mozzarella'),(16,'masa','delgada'),
(17,'pepperoni','100% cerdo'),(17,'queso','mozzarella extra'),
(18,'jamón','de pierna'),(18,'piña','natural'),
(19,'quesos','4 variedades'),(19,'masa','gruesa'),
(20,'chorizo','artesanal'),(20,'picante','medio-alto'),
(21,'verduras','surtidas de temporada'),(21,'aceituna','verde'),
(22,'carne','150g res'),(22,'pan','brioche'),
(23,'carne','180g res'),(23,'queso','cheddar'),
(24,'carne','doble 300g'),(24,'tocino','ahumado'),
(25,'base','garbanzo'),(25,'aguacate','natural'),
(26,'jalapeño','fresco'),(26,'salsa','habanero'),
(27,'carne','al pastor piña'),(27,'tortilla','maíz azul'),
(28,'relleno','frijol'),(28,'estilo','canasta tradicional'),
(29,'carne','barbacoa de res'),(29,'salsa','verde'),
(30,'carne','suadero dorado'),(30,'cebolla','morada'),
(31,'queso','oaxaca'),(31,'tortilla','harina de 30cm'),
(32,'pollo','deshebrado'),(32,'tostada','horneada'),
(33,'base','frijol negro'),(33,'topping','crema y queso'),
(34,'tipo','rajas con queso'),(34,'masa','nixtamal'),
(35,'tipo','cerdo en salsa roja'),(35,'masa','nixtamal'),
(36,'relleno','chicharrón prensado'),(36,'masa','azul'),
(37,'fruta','jamaica seca'),(37,'azúcar','estándar'),
(38,'arroz','integral'),(38,'canela','molida'),
(39,'marca','Coca-Cola'),(39,'tamaño','355ml'),
(40,'naranja','variedad valencia'),(40,'tamaño','400ml'),
(41,'café','variedad chiapas'),(41,'endulzante','piloncillo'),
(42,'cerveza','Clara 355ml'),(42,'clamato','vaul'),
(43,'limón','persa'),(43,'tamaño','500ml'),
(44,'marca','Peñafiel'),(44,'tamaño','600ml'),
(45,'sabor','chocolate belga'),(45,'tamaño','500ml'),
(46,'té','verde matcha'),(46,'menta','fresca'),
(47,'base','cajeta artesanal'),(47,'tamaño','porción 150g'),
(48,'tipo','tres leches clásico'),(48,'cobertura','crema batida'),
(49,'piezas','4'),(49,'chocolate','oscuro'),
(50,'sabor','vainilla'),(50,'piezas','2 bolas'),
(51,'brownie','chocolate amargo'),(51,'helado','vainilla'),
(52,'tipo','mosaico'),(52,'crema','chantilly'),
(53,'tipo','con leche entera'),(53,'pasas','sultanas'),
(54,'base','galleta marinela'),(54,'limón','persa'),
(55,'relleno','cajeta artesanal'),(55,'nuez','pecana'),
(56,'miel','piloncillo'),(56,'tamaño','grande'),
(57,'tipo','yucateca'),(57,'proteína','pollo'),
(58,'tipo','italiana'),(58,'queso','parmesano'),
(59,'salsa','crema espinacas'),(59,'proteína','muslo de pollo'),
(60,'tipo','al ajillo'),(60,'camarones','jumbo'),
(61,'tipo','costillas BBQ'),(61,'cocción','8 horas ahumadas'),
(62,'corte','tiritas'),(62,'aderezo','ranch casero'),
(63,'tipo','rojos'),(63,'proteína','pollo deshebrado'),
(64,'tipo','rancheros'),(64,'huevos','2 piezas'),
(65,'carne','bistec de res'),(65,'estilo','a la mexicana'),
(66,'relleno','milanesa,jamón,pierna,queso'),(66,'pan','telera'),
(67,'relleno','carnitas de cerdo'),(67,'aguacate','natural'),
(68,'capas','triple'),(68,'proteína','pollo y tocino'),
(69,'porción','250g'),(69,'tortillas','4 piezas'),
(70,'tipo','prensado'),(70,'tortillas','4 piezas'),
-- Hardware
(71,'peso','16oz'),(71,'material','acero forjado'),
(72,'tamaño','6 pulgadas'),(72,'dureza','acero CRV'),
(73,'número','#2 Phillips'),(73,'marca','Truper'),
(74,'voltaje','1000V aislada'),(74,'longitud','8 pulgadas'),
(75,'longitud','5 metros'),(75,'precisión','1mm'),
(76,'longitud','60cm'),(76,'material','aluminio extruido'),
(77,'apertura','hasta 35mm'),(77,'material','acero cromado'),
(78,'dientes','24 por pulgada'),(78,'longitud','12 pulgadas'),
(79,'longitud','12 pulgadas'),(79,'material','acero inoxidable'),
(80,'ancho','18mm'),(80,'hojas','5 de repuesto incluidas'),
(81,'apertura','hasta 40mm'),(81,'tipo','presión'),
(82,'piezas','9 piezas'),(82,'sistema','SAE'),
(83,'hoja','acero carbono'),(83,'mango','madera dura'),
(84,'ancho','4 pulgadas'),(84,'flexibilidad','alta'),
(85,'tamaño','10 pulgadas'),(85,'material','acero templado'),
(86,'potencia','750W'),(86,'mandril','13mm sin llave'),
(87,'potencia','860W'),(87,'disco','4.5 pulgadas'),
(88,'potencia','1500W'),(88,'hoja','7.25 pulgadas'),
(89,'voltaje','12V'),(89,'batería','litio 1.5Ah'),
(90,'potencia','150W'),(90,'base','93x185mm'),
(91,'potencia','2000W'),(91,'temperaturas','2 niveles'),
(92,'potencia','800W'),(92,'impacto','SDS Plus'),
(93,'capacidad','25 litros'),(93,'presión','115 PSI'),
(94,'longitud','600mm'),(94,'corte','hasta 20mm'),
(95,'voltaje','12/24V'),(95,'corriente','6A'),
(96,'tipo','Portland CPC30R'),(96,'rendimiento','50kg = 0.06m³'),
(97,'granulometría','fina'),(97,'origen','río'),
(98,'tamaño','3/8 pulgadas'),(98,'uso','concreto'),
(99,'medida','15x20x40cm'),(99,'resistencia','c=100 kg/cm²'),
(100,'medida','6x13x28cm'),(100,'absorción','< 15%'),
(101,'diámetro','3/8 pulgadas'),(101,'longitud','12 metros'),
(102,'apertura','6x6cm'),(102,'calibre','4.5mm'),
(103,'calibre','16'),(103,'presentación','rollo 1kg'),
(104,'calibre','24'),(104,'medida','1x2 metros'),
(105,'medida','4x8 pies'),(105,'espesor','12.7mm'),
(106,'diámetro','1/2 pulgada'),(106,'presión','hasta 160 PSI'),
(107,'diámetro','1 pulgada'),(107,'presión','hasta 120 PSI'),
(108,'ángulo','90 grados'),(108,'diámetro','1/2 pulgada'),
(109,'diámetro','1/2 pulgada'),(109,'material','latón niquelado'),
(110,'tipo','de boya 1/2 pulgada'),(110,'material','polietileno'),
(111,'tipo','económico'),(111,'color','blanco'),
(112,'medida','50x38cm'),(112,'color','blanco brillante'),
(113,'diámetro','8 pulgadas'),(113,'material','acero inoxidable 304'),
(114,'ancho','12mm'),(114,'longitud','12 metros'),
(115,'capacidad','125ml'),(115,'tiempo secado','30 min'),
(116,'calibre','12 AWG'),(116,'longitud','100 metros'),
(117,'amperaje','10A'),(117,'color','marfil'),
(118,'amperaje','15A'),(118,'tipo','polarizado con tierra'),
(119,'potencia','9W'),(119,'temperatura','6500K luz fría'),
(120,'circuitos','4'),(120,'material','metálico'),
(121,'amperaje','20A'),(121,'tipo','riel DIN'),
(122,'medida','20x10mm'),(122,'longitud','2 metros'),
(123,'rango voltaje','600V'),(123,'rango corriente','10A'),
(124,'potencia','20W'),(124,'temperatura','luz blanca'),
(125,'longitud','5 metros'),(125,'contactos','3'),
(126,'tipo','vinílica interior'),(126,'rendimiento','12m² por litro'),
(127,'color','a elegir'),(127,'acabado','mate lavable'),
(128,'tamaño','3 pulgadas'),(128,'cerda','natural'),
(129,'ancho','9 pulgadas'),(129,'napa','lana sintética'),
(130,'grano','120'),(130,'tipo','al agua'),
(131,'tipo','extra'),(131,'capacidad','1 litro'),
(132,'tipo','acrílico'),(132,'presentación','5 kilogramos'),
(133,'color','negro mate'),(133,'tipo','sintético'),
(134,'tipo','acrílico'),(134,'rendimiento','4m² por litro'),
(135,'tamaño','50mm'),(135,'material','acero endurecido'),
(136,'tipo','embutir'),(136,'material','acero inoxidable'),
(137,'tamaño','4 pulgadas'),(137,'acabado','galvanizado'),
(138,'diámetro','30cm'),(138,'tipo','esférico'),
(139,'tipo','magnético inalámbrico'),(139,'batería','incluida'),
(140,'talla','L'),(140,'material','cuero natural'),
-- Stationery
(141,'hojas','100'),(141,'pauta','cuadro chico 5mm'),
(142,'hojas','200'),(142,'pauta','doble raya'),
(143,'hojas','80'),(143,'tamaño','A4 college rule'),
(144,'hojas','180'),(144,'materias','5 separadas'),
(145,'hojas','100'),(145,'tamaño','pocket A6'),
(146,'hojas','80'),(146,'tamaño','A3 sin líneas'),
(147,'hojas','100'),(147,'color','amarillo neón'),
(148,'tipo','semanal'),(148,'portada','rígida'),
(149,'hojas','120'),(149,'pauta','puntos 5mm'),
(150,'hojas','50'),(150,'pauta','pentagramas'),
(151,'piezas','12'),(151,'punta','media 1mm'),
(152,'punta','gel 0.5mm'),(152,'retráctil','sí'),
(153,'punta','fina'),(153,'tinta','permanente'),
(154,'piezas','12'),(154,'dureza','HB'),
(155,'punta','fina'),(155,'cartucho','incluido'),
(156,'piezas','4 colores'),(156,'tipo','pastel'),
(157,'capacidad','20ml'),(157,'punta','fina'),
(158,'piezas','24'),(158,'tinta','a base de agua'),
(159,'diámetro','0.5mm'),(159,'retráctil','sí'),
(160,'piezas','10'),(160,'tipo','HB 0.5mm'),
(161,'diámetro','0.3mm'),(161,'tipo','waterproof'),
(162,'diámetro','0.5mm'),(162,'tinta','gel acuosa'),
(163,'piezas','5000'),(163,'tipo','26/6 estándar'),
(164,'piezas','100'),(164,'tipo','33mm niquelado'),
(165,'longitud','6 pulgadas'),(165,'material','acero inoxidable'),
(166,'ancho','19mm'),(166,'longitud','33 metros'),
(167,'piezas','10'),(167,'tamaño','carta'),
(168,'lomo','ancho 75mm'),(168,'mecanismo','palanca'),
(169,'piezas','10'),(169,'material','plástico PP'),
(170,'tipo','de escritorio'),(170,'capacidad','25 hojas'),
(171,'hoyos','2'),(171,'capacidad','30 hojas'),
(172,'longitud','30cm'),(172,'material','plástico transparente'),
(173,'ángulos','45 y 60 grados'),(173,'material','acrílico'),
(174,'tipo','180 grados'),(174,'material','plástico'),
(175,'peso','20 gramos'),(175,'lavable','no'),
(176,'capacidad','500ml'),(176,'tipo','blanco PVA'),
(177,'piezas','12 colores'),(177,'capacidad','20ml c/u'),
(178,'piezas','10'),(178,'pelo','sintético'),
(179,'piezas','10'),(179,'color','blanca'),
(180,'piezas','10 colores'),(180,'tamaño','A4'),
(181,'tipo','zig-zag'),(181,'material','inoxidable'),
(182,'piezas','24 colores'),(182,'tipo','jumbo'),
(183,'colores','12'),(183,'peso','200g total'),
(184,'piezas','12'),(184,'tipo','semisólidas'),
(185,'hojas','20'),(185,'tamaño','A3'),
(186,'capacidad','500ml'),(186,'tipo','escolar'),
(187,'tamaño','18 pulgadas'),(187,'compartimentos','4'),
(188,'tipo','isotérmica'),(188,'capacidad','5 litros'),
(189,'compartimentos','2'),(189,'material','poliéster'),
(190,'material','metal'),(190,'portaminas','incluido'),
(191,'modelo','FX-82'),(191,'funciones','350'),
(192,'piezas','5'),(192,'material','plástico transparente'),
(193,'tamaño','grande'),(193,'tipo','sin PVC'),
(194,'hoyos','doble'),(194,'depósito','plástico'),
(195,'páginas','120'),(195,'escala','actualizada 2025'),
(196,'términos','40000'),(196,'edición','escolar'),
(197,'capacidad','32GB'),(197,'interfaz','USB 3.0'),
(198,'tipo','inalámbrico'),(198,'frecuencia','2.4GHz'),
(199,'tipo','USB TKL'),(199,'idioma','español'),
(200,'potencia','5W LED'),(200,'puertos','USB carga'),
(201,'compartimentos','6'),(201,'material','plástico ABS'),
(202,'ajuste','7 a 12 pulgadas'),(202,'material','aluminio'),
(203,'puertos','4'),(203,'versión','USB 2.0'),
(204,'tipo','estéreo'),(204,'cable','1.8 metros'),
(205,'resolución','720p HD'),(205,'micrófono','integrado'),
(206,'material','gel'),(206,'color','negro'),
(207,'potencia','45W'),(207,'conector','USB-C'),
(208,'tipo','borrable'),(208,'color','negro'),
(209,'hojas','120'),(209,'espiral','doble'),
(210,'cierre','candado con llave'),(210,'tapa','rígida cuero PU');


-- ─────────────────────────────────────────────────────────────────────────────
-- BUSINESS HOURS  (all 7 days × 3 businesses)
-- day_of_week: 0=Sunday … 6=Saturday
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO business_hours (business_id, day_of_week, open_time, close_time, is_closed) VALUES
-- Restaurant: Mon-Sat 08:00-22:00, Sun 09:00-20:00
(1, 0, '09:00', '20:00', FALSE),
(1, 1, '08:00', '22:00', FALSE),
(1, 2, '08:00', '22:00', FALSE),
(1, 3, '08:00', '22:00', FALSE),
(1, 4, '08:00', '22:00', FALSE),
(1, 5, '08:00', '23:00', FALSE),
(1, 6, '08:00', '23:00', FALSE),
-- Hardware: Mon-Fri 07:30-19:00, Sat 08:00-17:00, Sun closed
(2, 0, NULL, NULL, TRUE),
(2, 1, '07:30', '19:00', FALSE),
(2, 2, '07:30', '19:00', FALSE),
(2, 3, '07:30', '19:00', FALSE),
(2, 4, '07:30', '19:00', FALSE),
(2, 5, '07:30', '19:00', FALSE),
(2, 6, '08:00', '17:00', FALSE),
-- Stationery: Mon-Sat 09:00-20:00, Sun closed
(3, 0, NULL, NULL, TRUE),
(3, 1, '09:00', '20:00', FALSE),
(3, 2, '09:00', '20:00', FALSE),
(3, 3, '09:00', '20:00', FALSE),
(3, 4, '09:00', '20:00', FALSE),
(3, 5, '09:00', '20:00', FALSE),
(3, 6, '09:00', '18:00', FALSE);


-- ─────────────────────────────────────────────────────────────────────────────
-- PROMOTIONS  (3+ per business)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO promotions (business_id, title, description, discount_type, discount_value, start_date, end_date) VALUES
-- Restaurant
(1, 'Comida del día -15%',       'Descuento en platillo del día de lunes a viernes',   'percentage', 15.00, '2026-01-01', '2026-12-31'),
(1, 'Postre gratis lunes',       'Al pedir plato fuerte el lunes, postre incluido',    'percentage', 100.00,'2026-01-06', '2026-12-28'),
(1, '2x1 en Pizzas Viernes',     'Los viernes paga 1 pizza y lleva 2 del mismo precio','percentage', 50.00, '2026-01-02', '2026-12-25'),
(1, 'Fiesta familiar -$50',      'Pedidos mayores a $400 con $50 de descuento',        'fixed',       50.00, '2026-03-01', '2026-06-30'),
-- Hardware
(2, 'Descuento en Herramientas', '10% de descuento en todos los artículos de herramientas','percentage',10.00,'2026-01-01','2026-12-31'),
(2, 'Compra mínima $500 -$80',   'Descuento de $80 en compras mayores a $500',         'fixed',       80.00, '2026-04-01', '2026-06-30'),
(2, 'Pintura 3x2',               'Lleva 3 cubetas de pintura y paga 2',                'percentage', 33.33, '2026-03-15', '2026-05-15'),
(2, 'Material Construcción -12%','12% en block, cemento y varilla',                    'percentage', 12.00, '2026-02-01', '2026-04-30'),
-- Stationery
(3, 'Regreso a Clases -20%',     '20% en cuadernos y útiles escolares',                'percentage', 20.00, '2026-08-01', '2026-08-31'),
(3, 'Día del Maestro $30 off',   'Descuento de $30 en artículos de escritura',         'fixed',       30.00, '2026-05-15', '2026-05-15'),
(3, '3x2 en Bolígrafos',         'Compra 3 bolígrafos y paga solo 2',                  'percentage', 33.33, '2026-01-01', '2026-12-31'),
(3, 'Arte y Manualidades -15%',  '15% en pinturas, pinceles y materiales de arte',     'percentage', 15.00, '2026-04-01', '2026-07-31');


-- ─────────────────────────────────────────────────────────────────────────────
-- BUSINESS SERVICES  (3+ per business)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO business_services (business_id, name, description, price) VALUES
-- Restaurant
(1, 'Servicio a domicilio',       'Entrega de pedidos a domicilio en zona local',          50.00),
(1, 'Renta de salón para eventos','Salón privado para 20-40 personas con meseros',        800.00),
(1, 'Menú especial empresarial',  'Comida corrida para empresas con factura incluida',     85.00),
(1, 'Servicio de catering',       'Preparación y servicio de alimentos fuera del local', 2500.00),
-- Hardware
(2, 'Corte de varilla y tubería', 'Corte de materiales a la medida sin cargo mínimo',     25.00),
(2, 'Asesoría técnica en obra',   'Visita de técnico a domicilio para presupuesto',       200.00),
(2, 'Entrega de materiales',      'Flete de materiales de construcción en zona metro',    250.00),
(2, 'Alquiler de herramientas',   'Renta diaria de herramientas especializadas',          150.00),
-- Stationery
(3, 'Impresión y copiado',        'Impresión láser B/N o color, $2 y $8 por hoja',          2.00),
(3, 'Plastificado de documentos', 'Plastificado en frío tamaño carta u oficio',            15.00),
(3, 'Encuadernado espiral',       'Encuadernado con espiral plástico + carátula',           35.00),
(3, 'Venta de regalo empaquetado','Empaque y moño para regalos de cualquier artículo',     20.00);


-- ─────────────────────────────────────────────────────────────────────────────
-- CONVERSATIONS  (5 per business = ids 1-15)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO conversations (id, business_id) VALUES
(1,  1),(2,  1),(3,  1),(4,  1),(5,  1),
(6,  2),(7,  2),(8,  2),(9,  2),(10, 2),
(11, 3),(12, 3),(13, 3),(14, 3),(15, 3);

SELECT setval('conversations_id_seq', 15);


-- ─────────────────────────────────────────────────────────────────────────────
-- MESSAGES  (4+ per conversation, mix of user/bot)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO messages (conversation_id, sender, message) VALUES
-- Conversation 1 (Restaurant)
(1, 'user', 'Hola, ¿a qué hora abren?'),
(1, 'bot',  'Hola, abrimos de lunes a viernes de 8:00 a 22:00, y los fines de semana de 8:00 a 23:00. ¡Te esperamos!'),
(1, 'user', '¿Tienen pizza hawaiana?'),
(1, 'bot',  'Sí, tenemos Pizza Hawaiana con jamón, piña y queso mozzarella por $120.00. ¿La agrego a tu pedido?'),
(1, 'user', 'Sí, y también una limonada natural.'),
(1, 'bot',  'Perfecto, Pizza Hawaiana + Limonada Natural 500ml ($30). Total: $150. ¿Lo confirmas?'),
-- Conversation 2 (Restaurant)
(2, 'user', '¿Cuál es el platillo del día?'),
(2, 'bot',  'El platillo del día es Pollo en Crema con arroz y frijoles a $125.00. Hoy tiene 15% de descuento.'),
(2, 'user', 'Qué bien. ¿Tienen opciones sin gluten?'),
(2, 'bot',  'Sí, varios platillos pueden prepararse sin gluten: Pozole Rojo, Caldo de Res y la mayoría de tacos. ¿Te interesa alguno?'),
-- Conversation 3 (Restaurant)
(3, 'user', '¿Hacen pedidos para eventos?'),
(3, 'bot',  'Claro, ofrecemos servicio de catering desde $2500 y renta de salón para 20-40 personas a $800. ¿Cuántas personas serían?'),
(3, 'user', 'Somos 30 personas, para una reunión de empresa.'),
(3, 'bot',  'Perfecto. Puedo reservar el salón y ofrecerte nuestro menú empresarial a $85 por persona. ¿Qué fecha te interesa?'),
(3, 'user', 'El próximo viernes 3 de abril.'),
(3, 'bot',  'Verificaré disponibilidad para el viernes 3 de abril. En breve te confirmo. ¡Gracias por elegirnos!'),
-- Conversation 4 (Restaurant)
(4, 'user', '¿Tienen opción vegetariana?'),
(4, 'bot',  'Sí, tenemos Hamburguesa Vegetariana con medallón de garbanzo y aguacate ($105) y varios platillos sin carne. ¿Gustas ver el menú completo?'),
(4, 'user', 'Sí por favor.'),
(4, 'bot',  'Opciones vegetarianas: Sopa de Tortilla, Flautas de Papa, Quesadilla de Queso, Sope de Frijoles, Guacamole y más postres. ¿Alguno te llama la atención?'),
-- Conversation 5 (Restaurant)
(5, 'user', '¿Hacen envíos a domicilio?'),
(5, 'bot',  'Sí, hacemos entregas a domicilio con un costo de $50 en la zona local. Pedido mínimo de $150.'),
(5, 'user', 'Quiero 3 tacos de pastor y un refresco.'),
(5, 'bot',  'Orden: Tacos de Pastor x3 ($55) + Refresco ($28) + envío ($50) = Total $133. Como el mínimo es $150, ¿agregarías algo más?'),
(5, 'user', 'Agrega un guacamole.'),
(5, 'bot',  'Listo: Tacos x3 + Refresco + Guacamole + envío = $183. ¿Confirmas el pedido?'),
-- Conversation 6 (Hardware)
(6, 'user', 'Necesito clavar tablaroca, ¿qué herramienta me recomiendas?'),
(6, 'bot',  'Para tablaroca te recomiendo el Atornillador Inalámbrico 12V ($750). Es ideal para tornillos de tablaroca sin dañar el panel. También podrías necesitar broca para tablaroca.'),
(6, 'user', '¿Tienen brocas para tablaroca?'),
(6, 'bot',  'Sí, tenemos brocas en distintas medidas. Las más usadas son 3/16" y 1/4". ¿Cuántos metros cuadrados cubrirás?'),
(6, 'user', 'Como 25m²'),
(6, 'bot',  'Para 25m² necesitarías aproximadamente 5 paneles de Tablaroca 4x8 ($145 c/u = $725). ¿Deseas que calculemos el pedido completo?'),
-- Conversation 7 (Hardware)
(7, 'user', '¿Tienen cemento gris?'),
(7, 'bot',  'Sí, tenemos Cemento Portland Gris 50kg a $175.00. ¿Cuántos costales necesitas?'),
(7, 'user', 'Dame 10 costales. ¿Hacen entrega?'),
(7, 'bot',  'Sí, el servicio de flete cuesta $250 en zona metropolitana. 10 costales = $1,750 + $250 flete = $2,000 total.'),
(7, 'user', 'Perfecto, ¿cómo hago el pedido?'),
(7, 'bot',  'Puedes pasar a la tienda de 7:30 a 19:00 o llamar al número de contacto para coordinar entrega. ¿Necesitas algo más?'),
-- Conversation 8 (Hardware)
(8, 'user', '¿Tienen esmeriladora?'),
(8, 'bot',  'Sí, tenemos la Esmeriladora Angular 4.5" de 860W con disco de corte a $650. ¿Es para corte o desbaste?'),
(8, 'user', 'Para corte de metal, ¿qué disco necesito?'),
(8, 'bot',  'Para corte de metal necesits disco de corte tipo A24R de 4.5" x 1mm. Tenemos en stock. ¿Quieres la esmeriladora + disco?'),
-- Conversation 9 (Hardware)
(9, 'user', 'Busco pintura para exterior, ¿qué me recomiendan?'),
(9, 'bot',  'Para exterior te recomiendo nuestro Impermeabilizante Acrílico 4L ($245) que protege hasta 5 años, o la Pintura Vinílica Color 4L ($225) para fachadas con buen rendimiento.'),
(9, 'user', 'Tengo una pared de 30m², ¿cuántos litros necesito?'),
(9, 'bot',  'Con un rendimiento de 12m² por litro, para 30m² necesitas 2.5L. Te alcanzaría con 1 cubeta de 4L y te sobraría para retoques. Total: $225.'),
(9, 'user', 'Tomaré el impermeabilizante entonces.'),
(9, 'bot',  'Excelente elección. El Impermeabilizante Acrílico 4L requiere 2 manos. Para 30m² con 2 manos necesitas 2 cubetas ($490). ¿Lo aparto?'),
-- Conversation 10 (Hardware)
(10, 'user', '¿Ofrecen asesoría para instalación eléctrica?'),
(10, 'bot', 'Sí, contamos con el servicio de Asesoría Técnica en Obra. Un técnico visita tu domicilio para presupuesto por $200. ¿Cuándo te vendría bien?'),
(10, 'user', 'El sábado por la mañana.'),
(10, 'bot', 'El sábado atendemos de 8:00 a 17:00. Puedo agendar la visita a las 10:00 am. ¿Me confirmas la dirección?'),
-- Conversation 11 (Stationery)
(11, 'user', 'Hola, ¿tienen calculadora científica?'),
(11, 'bot', 'Hola, sí tenemos la Calculadora Científica Casio FX-82 con 350 funciones a $245. Es la más popular entre estudiantes de preparatoria y universidad.'),
(11, 'user', '¿Sirve para cálculo integral?'),
(11, 'bot', 'Sí, la Casio FX-82 incluye funciones de derivadas, integrales definidas, matrices y estadística avanzada. Es ideal para cálculo.'),
(11, 'user', 'También necesito una libreta universitaria.'),
(11, 'bot', 'Tenemos la Libreta Universitaria A4 de 80 hojas a $38 y el Cuaderno Inteligente A4 120h con espiral a $145. ¿Cuál prefieres?'),
-- Conversation 12 (Stationery)
(12, 'user', '¿Hacen impresiones?'),
(12, 'bot', 'Sí, ofrecemos impresión láser en B/N a $2 por hoja y en color a $8 por hoja. También fotocopiado y escaneo. ¿Cuántas páginas necesitas?'),
(12, 'user', '20 hojas en B/N y 5 en color.'),
(12, 'bot', 'Sería: 20 hojas B/N = $40 + 5 en color = $40. Total: $80. ¿Tienes el archivo en USB o lo envías por WhatsApp?'),
(12, 'user', 'Lo mando por WhatsApp.'),
(12, 'bot', 'Perfecto, envía el archivo al número de la tienda y en 20 minutos está listo para recoger. ¿Necesitas encuadernado?'),
-- Conversation 13 (Stationery)
(13, 'user', '¿Tienen material para regreso a clases?'),
(13, 'bot', 'Sí, contamos con todo para regreso a clases: cuadernos, bolígrafos, colores, calculadoras, mochilas y más. Además, en agosto hay 20% de descuento en útiles escolares.'),
(13, 'user', 'Necesito lista completa para secundaria.'),
(13, 'bot', 'Con gusto. Lista típica de secundaria: Cuadernos $42 c/u, Bolígrafos BIC caja $45, Lápices Mongol $35, Colores, Regla, Compás, Calculadora y Mochila. ¿Te preparo un paquete?'),
(13, 'user', 'Sí, arma el paquete.'),
(13, 'bot', 'Paquete secundaria: 5 cuadernos ($210) + bolígrafos ($45) + lápices ($35) + set geometría ($55) + calculadora ($245) + mochila ($285) = $875. Con 20% en agosto = $700.'),
-- Conversation 14 (Stationery)
(14, 'user', '¿Tienen plumas para lettering?'),
(14, 'bot', 'Sí, para lettering tenemos: Pluma Fuente Schneider ($145), Pluma Sakura Micron 0.3mm ($38) y Marcadores de Colores 24 pzas ($75). ¿Para qué nivel es?'),
(14, 'user', 'Soy principiante.'),
(14, 'bot', 'Para principiantes te recomiendo empezar con el set de Marcadores de Colores 24 pzas ($75) o la Pluma Sakura Micron ($38). También el Cuaderno de Puntos A5 ($110) es perfecto para practicar lettering y bullet journal.'),
-- Conversation 15 (Stationery)
(15, 'user', '¿Tienen Mouse inalámbrico?'),
(15, 'bot', 'Sí, tenemos Mouse Inalámbrico 2.4GHz a $185. También Teclado USB Compacto a $195 y Hub USB 4 puertos a $95 si armas un setup'),
(15, 'user', 'Me interesa el mouse y el hub.'),
(15, 'bot', 'Mouse Inalámbrico ($185) + Hub USB 4 puertos ($95) = $280. ¿Te los envuelvo para regalo o es para uso propio?'),
(15, 'user', 'Para uso propio, no es necesario el empaque.'),
(15, 'bot', 'Perfecto. Los tenemos en stock. Puedes pasar por ellos de lunes a sábado de 9:00 a 20:00. ¡Que los disfrutes!');


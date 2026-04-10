-- =============================================================================
-- ticket.sql
-- Incremental database changes for the purchase (pedidos) flow.
--
-- Safe to run on an existing database — uses ADD COLUMN IF NOT EXISTS
-- and CREATE TABLE IF NOT EXISTS so it can be re-applied without errors.
--
-- USAGE:
--   psql -U <user> -d <database> -f ticket.sql
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Add acepto_pedidos column to businesses (if missing)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS acepto_pedidos BOOLEAN NOT NULL DEFAULT false;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Create pedidos table (if missing)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pedidos (
    id               SERIAL        PRIMARY KEY,
    business_id      INT           NOT NULL REFERENCES businesses (id) ON DELETE CASCADE,
    session_id       VARCHAR(128),
    nombre_cliente   VARCHAR(150)  NOT NULL,
    telefono         VARCHAR(50)   NOT NULL,
    detalle_pedido   TEXT          NOT NULL,
    hora_recogida    VARCHAR(50)   NOT NULL,
    notas_admin      TEXT,
    fecha            DATE          NOT NULL DEFAULT CURRENT_DATE,
    aceptado         BOOLEAN       NOT NULL DEFAULT false,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Add session_id and notas_admin to existing tables (safe to re-run)
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS session_id   VARCHAR(128);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS notas_admin  TEXT;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Add liberado column to pedidos (marks the order as released/fulfilled)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS liberado BOOLEAN NOT NULL DEFAULT false;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Make hora_recogida nullable (field removed from customer form)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE pedidos ALTER COLUMN hora_recogida DROP NOT NULL;
ALTER TABLE pedidos ALTER COLUMN hora_recogida SET DEFAULT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Add rechazado column to pedidos (admin can reject an order)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS rechazado BOOLEAN NOT NULL DEFAULT false;

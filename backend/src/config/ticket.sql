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
    nombre_cliente   VARCHAR(150)  NOT NULL,
    telefono         VARCHAR(50)   NOT NULL,
    detalle_pedido   TEXT          NOT NULL,
    hora_recogida    VARCHAR(50)   NOT NULL,
    fecha            DATE          NOT NULL DEFAULT CURRENT_DATE,
    aceptado         BOOLEAN       NOT NULL DEFAULT false,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

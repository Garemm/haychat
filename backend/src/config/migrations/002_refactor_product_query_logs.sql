-- =============================================================================
-- Migration 002: refactor product_query_logs to per-event insert model
--
-- Changes:
--   1. Drop the unique constraint (business_id, product_id, query_date)
--      so multiple rows for the same product on the same day are allowed.
--   2. Drop the query_count column — counts are derived by aggregating rows.
--   3. Add a created_at timestamp column if it does not already exist.
--
-- Run once against the target database:
--   psql -U <user> -d <database> -f 002_refactor_product_query_logs.sql
-- =============================================================================

-- 1. Drop the unique constraint that enforced one row per (business, product, date)
ALTER TABLE product_query_logs
  DROP CONSTRAINT IF EXISTS product_query_logs_business_id_product_id_query_date_key;

-- 2. Remove the counter column
ALTER TABLE product_query_logs
  DROP COLUMN IF EXISTS query_count;

-- 3. Add created_at if it does not already exist
ALTER TABLE product_query_logs
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

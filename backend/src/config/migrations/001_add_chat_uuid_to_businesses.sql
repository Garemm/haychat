-- Migration 001: Add chat_uuid column to businesses table
-- Run once on existing databases:
--   psql -U <user> -d <database> -f migrations/001_add_chat_uuid_to_businesses.sql

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS chat_uuid UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE;

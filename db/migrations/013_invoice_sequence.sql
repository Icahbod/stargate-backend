-- #131: Replace COUNT-based muxed ID allocation with a per-merchant atomic sequence
-- to eliminate the race condition under concurrent invoice creation.

CREATE SEQUENCE IF NOT EXISTS invoice_seq_global START 1;

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS invoice_seq BIGINT NOT NULL DEFAULT 0;

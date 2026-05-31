-- #37: index for fast event-type filtering on active webhooks
CREATE INDEX IF NOT EXISTS idx_webhooks_events ON webhooks USING GIN (events);
CREATE INDEX IF NOT EXISTS idx_webhooks_merchant_active ON webhooks (merchant_id, active);

-- Rename previous_secret to previous_hashed_secret to match hashed storage
ALTER TABLE webhooks RENAME COLUMN previous_secret TO previous_hashed_secret;

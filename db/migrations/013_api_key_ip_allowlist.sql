-- Allow merchants to restrict an API key to specific IP addresses or CIDR ranges.
-- NULL means no restriction (any IP is permitted).
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS allowed_ips TEXT[];

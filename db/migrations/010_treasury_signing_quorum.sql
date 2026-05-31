-- #40 Treasury signing quorum configuration

CREATE TABLE IF NOT EXISTS treasury_configuration (
  id TEXT PRIMARY KEY,
  signing_quorum INT NOT NULL CHECK (signing_quorum >= 1),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO treasury_configuration (id, signing_quorum)
VALUES ('default', 2)
ON CONFLICT (id) DO NOTHING;

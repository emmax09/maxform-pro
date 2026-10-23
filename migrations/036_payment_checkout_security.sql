-- Shared, privacy-preserving request limits for public checkout endpoints.
-- Identity values are HMAC hashes; raw IP addresses and browser IDs are never
-- retained in this table.
CREATE TABLE IF NOT EXISTS payment_checkout_rate_limits (
  endpoint TEXT NOT NULL
    CHECK (endpoint IN ('create', 'coupon', 'quote', 'status')),
  identity_hash TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0
    CHECK (request_count >= 0),
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (endpoint, identity_hash)
);

CREATE INDEX IF NOT EXISTS idx_payment_checkout_rate_limits_expiry
  ON payment_checkout_rate_limits(window_started_at);

-- The browser database role must never inspect or manipulate payment controls.
-- The guarded block keeps fresh environments working before that role exists.
DO $maxform$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'maxform_browser') THEN
    REVOKE ALL ON TABLE payment_checkout_rate_limits FROM maxform_browser;
  END IF;
END
$maxform$;

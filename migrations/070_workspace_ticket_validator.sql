-- Revocable bearer links for workspace-wide event ticket validation.
CREATE TABLE IF NOT EXISTS workspace_ticket_validator_links (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  masked_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rotated_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_ticket_validator_masked_id
  ON workspace_ticket_validator_links(masked_id);

-- Only privacy-preserving hashes are retained for public validator throttling.
CREATE TABLE IF NOT EXISTS event_ticket_validator_rate_limits (
  identity_hash TEXT PRIMARY KEY,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_ticket_validator_rate_limits_expiry
  ON event_ticket_validator_rate_limits(window_started_at);

DO $maxform$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'maxform_browser') THEN
    REVOKE ALL ON TABLE workspace_ticket_validator_links FROM maxform_browser;
    REVOKE ALL ON TABLE event_ticket_validator_rate_limits FROM maxform_browser;
  END IF;
END
$maxform$;

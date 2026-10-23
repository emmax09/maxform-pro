-- Real OAuth for the appointments integrations.
--
-- 072 created scheduling_tool_connections with a credentials column but nothing
-- ever wrote a token into it. These columns are what an actual token needs: when
-- it expires, what it was granted, and which remote account it belongs to, so a
-- second pass at the same provider updates one row instead of duplicating it.

ALTER TABLE scheduling_tool_connections
  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ;

ALTER TABLE scheduling_tool_connections
  ADD COLUMN IF NOT EXISTS scopes JSONB NOT NULL DEFAULT '[]';

ALTER TABLE scheduling_tool_connections
  ADD COLUMN IF NOT EXISTS external_account_id TEXT NOT NULL DEFAULT '';

-- 'oauth' for the providers that run a handshake, 'api_key' for Cal.com and for
-- Calendly personal access tokens, which have no self-serve OAuth app.
ALTER TABLE scheduling_tool_connections
  ADD COLUMN IF NOT EXISTS auth_type TEXT NOT NULL DEFAULT 'oauth';

ALTER TABLE scheduling_tool_connections
  ADD COLUMN IF NOT EXISTS connected_at TIMESTAMPTZ;

-- Distinguishes "the token expired and we could not refresh it" from "the last
-- health check failed", because only the first one requires the user to act.
ALTER TABLE scheduling_tool_connections
  DROP CONSTRAINT IF EXISTS scheduling_tool_connections_status_check;

ALTER TABLE scheduling_tool_connections
  ADD CONSTRAINT scheduling_tool_connections_status_check
  CHECK (status IN ('connected', 'needs_reconnect', 'error'));

-- Rows written by the old placeholder connect action hold no credential, so they
-- cannot be refreshed or used. Mark them for reconnection rather than leaving
-- them claiming to be connected.
UPDATE scheduling_tool_connections
SET status = 'needs_reconnect',
    health_ok = FALSE,
    last_error = 'Reconnect this account to finish authorizing it.'
WHERE COALESCE(credentials_encrypted->>'cipher', '') = '';

CREATE INDEX IF NOT EXISTS idx_scheduling_connections_expiry
  ON scheduling_tool_connections(token_expires_at)
  WHERE token_expires_at IS NOT NULL;

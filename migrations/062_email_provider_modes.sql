-- Provider modes and explicit active-provider state.
-- This is additive: existing role-based routing remains valid while the new
-- active-provider fields become the canonical source for managed sending.

ALTER TABLE email_provider_connections
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'custom'
    CHECK (mode IN ('managed', 'custom')),
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE email_provider_connections
SET mode = 'custom',
    is_active = (role = 'primary' AND status = 'connected')
WHERE mode IS NULL OR mode NOT IN ('managed', 'custom') OR is_active IS DISTINCT FROM (role = 'primary' AND status = 'connected');

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_provider_active
  ON email_provider_connections(user_id)
  WHERE is_active = TRUE AND status = 'connected';

ALTER TABLE email_settings
  ADD COLUMN IF NOT EXISTS active_provider TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS active_provider_mode TEXT NOT NULL DEFAULT 'custom'
    CHECK (active_provider_mode IN ('managed', 'custom'));

UPDATE email_settings settings
SET active_provider = connection.provider,
    active_provider_mode = 'custom'
FROM email_provider_connections connection
WHERE connection.user_id = settings.user_id
  AND connection.role = 'primary'
  AND connection.status = 'connected'
  AND settings.active_provider = '';

UPDATE email_settings settings
SET active_provider = 'resend',
    active_provider_mode = 'managed'
FROM email_identities identity
WHERE identity.user_id = settings.user_id
  AND identity.sending_mode = 'managed'
  AND settings.active_provider = '';

CREATE TABLE IF NOT EXISTS email_provider_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('managed', 'custom')),
  action TEXT NOT NULL CHECK (action IN ('connected', 'activated', 'deactivated', 'disconnected', 'health_check')),
  detail JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_provider_audit_owner_created
  ON email_provider_audit_logs(user_id, created_at DESC);

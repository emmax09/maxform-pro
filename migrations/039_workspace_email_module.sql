-- Workspace email is isolated by user_id, which is the workspace owner key
-- used across the existing forms, contacts, events, and payments modules.
CREATE TABLE IF NOT EXISTS email_provider_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL
    CHECK (provider IN ('resend', 'smtp', 'sendgrid', 'postmark', 'mailgun', 'ses')),
  credentials_encrypted TEXT NOT NULL,
  credential_hint TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'none'
    CHECK (role IN ('primary', 'fallback', 'none')),
  status TEXT NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'attention', 'disconnected')),
  health_ok BOOLEAN NOT NULL DEFAULT TRUE,
  last_health_check_at TIMESTAMPTZ,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, provider)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_provider_primary
  ON email_provider_connections(user_id)
  WHERE role = 'primary' AND status = 'connected';

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_provider_fallback
  ON email_provider_connections(user_id)
  WHERE role = 'fallback' AND status = 'connected';

CREATE INDEX IF NOT EXISTS idx_email_provider_health
  ON email_provider_connections(user_id, status, health_ok);

CREATE TABLE IF NOT EXISTS email_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_name TEXT NOT NULL,
  sender_email TEXT NOT NULL,
  reply_to TEXT NOT NULL DEFAULT '',
  domain TEXT NOT NULL,
  dkim_selector TEXT NOT NULL DEFAULT 'default',
  spf_verified BOOLEAN NOT NULL DEFAULT FALSE,
  dkim_verified BOOLEAN NOT NULL DEFAULT FALSE,
  dmarc_verified BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (status IN ('unverified', 'pending', 'verified')),
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_identity_owner_email
  ON email_identities(user_id, LOWER(sender_email));

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_identity_default
  ON email_identities(user_id)
  WHERE is_default = TRUE;

CREATE INDEX IF NOT EXISTS idx_email_identity_owner
  ON email_identities(user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  module TEXT NOT NULL,
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  html_body TEXT NOT NULL,
  text_body TEXT NOT NULL DEFAULT '',
  blocks JSONB NOT NULL DEFAULT '[]',
  identity_id UUID REFERENCES email_identities(id) ON DELETE SET NULL,
  is_custom BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, key)
);

CREATE INDEX IF NOT EXISTS idx_email_templates_owner_module
  ON email_templates(user_id, module, updated_at DESC);

CREATE TABLE IF NOT EXISTS email_settings (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  default_identity_id UUID REFERENCES email_identities(id) ON DELETE SET NULL,
  rate_limit_per_hour INTEGER NOT NULL DEFAULT 600
    CHECK (rate_limit_per_hour BETWEEN 10 AND 100000),
  suppression_threshold NUMERIC(5,2) NOT NULL DEFAULT 5
    CHECK (suppression_threshold BETWEEN 0.1 AND 100),
  suppression_behavior TEXT NOT NULL DEFAULT 'suppress'
    CHECK (suppression_behavior IN ('suppress', 'pause_campaigns')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_suppressions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient TEXT NOT NULL,
  reason TEXT NOT NULL
    CHECK (reason IN ('unsubscribe', 'bounce', 'complaint', 'manual')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_suppression_owner_recipient
  ON email_suppressions(user_id, LOWER(recipient));

CREATE INDEX IF NOT EXISTS idx_email_suppressions_owner
  ON email_suppressions(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS email_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_key TEXT NOT NULL DEFAULT '',
  module TEXT NOT NULL DEFAULT 'workflows',
  provider TEXT NOT NULL DEFAULT '',
  identity_id UUID REFERENCES email_identities(id) ON DELETE SET NULL,
  recipient TEXT NOT NULL,
  from_address TEXT NOT NULL DEFAULT '',
  reply_to TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  html_body TEXT NOT NULL DEFAULT '',
  text_body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'complained', 'failed')),
  provider_message_id TEXT NOT NULL DEFAULT '',
  provider_response JSONB NOT NULL DEFAULT '{}',
  source_event_id UUID,
  idempotency_key TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT NOT NULL DEFAULT '',
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_log_idempotency
  ON email_logs(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_logs_owner_delivery
  ON email_logs(user_id, status, next_attempt_at, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_logs_owner_recent
  ON email_logs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_logs_source_event
  ON email_logs(user_id, source_event_id)
  WHERE source_event_id IS NOT NULL;

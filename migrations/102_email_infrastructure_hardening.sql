-- Email infrastructure hardening for centralized providers, durable workers,
-- ToSend batch delivery, and safe webhook processing.

ALTER TABLE email_provider_connections
  DROP CONSTRAINT IF EXISTS email_provider_connections_provider_check;
ALTER TABLE email_provider_connections
  ADD CONSTRAINT email_provider_connections_provider_check
  CHECK (provider IN ('tosend', 'resend', 'sender', 'smtp', 'sendgrid', 'postmark', 'mailgun', 'ses'));

ALTER TABLE email_sending_domains
  DROP CONSTRAINT IF EXISTS email_sending_domains_provider_check;
ALTER TABLE email_sending_domains
  ADD CONSTRAINT email_sending_domains_provider_check
  CHECK (provider IN ('tosend', 'resend', 'sender', 'sendgrid', 'postmark', 'mailgun', 'ses'));

ALTER TABLE email_settings
  ADD COLUMN IF NOT EXISTS fallback_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS fallback_provider TEXT NOT NULL DEFAULT '';

ALTER TABLE provider_rate_limits
  ADD COLUMN IF NOT EXISTS max_batch_size INTEGER NOT NULL DEFAULT 100
    CHECK (max_batch_size BETWEEN 1 AND 100);

INSERT INTO provider_rate_limits (provider, max_per_second, max_per_hour, max_batch_size, notes)
VALUES ('tosend', 5, 10000, 100, 'Account limit is read from ToSend /v2/info; these values are a conservative pre-connection fallback.')
ON CONFLICT (provider) DO UPDATE SET
  max_batch_size = EXCLUDED.max_batch_size,
  notes = EXCLUDED.notes,
  updated_at = NOW();

ALTER TABLE email_logs
  ADD COLUMN IF NOT EXISTS email_classification TEXT NOT NULL DEFAULT 'TRANSACTIONAL'
    CHECK (email_classification IN ('TRANSACTIONAL', 'MARKETING', 'SYSTEM', 'EVENT', 'APPOINTMENT', 'DOCUMENT', 'FORM_NOTIFICATION', 'CAMPAIGN', 'AUTHENTICATION')),
  ADD COLUMN IF NOT EXISTS uncertain_at TIMESTAMPTZ;

UPDATE email_logs
SET email_classification = CASE
  WHEN LOWER(COALESCE(module, '')) IN ('contacts', 'campaigns') THEN 'CAMPAIGN'
  WHEN LOWER(COALESCE(module, '')) IN ('events', 'event') THEN 'EVENT'
  WHEN LOWER(COALESCE(module, '')) IN ('appointments', 'scheduling') THEN 'APPOINTMENT'
  WHEN LOWER(COALESCE(module, '')) IN ('documents', 'files') THEN 'DOCUMENT'
  WHEN LOWER(COALESCE(module, '')) IN ('forms', 'form') THEN 'FORM_NOTIFICATION'
  WHEN LOWER(COALESCE(module, '')) IN ('auth', 'authentication') THEN 'AUTHENTICATION'
  ELSE 'TRANSACTIONAL'
END
WHERE email_classification = 'TRANSACTIONAL';

ALTER TABLE email_logs
  DROP CONSTRAINT IF EXISTS email_logs_status_check;
ALTER TABLE email_logs
  ADD CONSTRAINT email_logs_status_check
  CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'complained', 'failed', 'skipped', 'unknown'));

CREATE INDEX IF NOT EXISTS idx_email_logs_provider_message
  ON email_logs(provider, provider_message_id)
  WHERE provider <> '' AND provider_message_id <> '';

CREATE TABLE IF NOT EXISTS email_delivery_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_log_id UUID NOT NULL REFERENCES email_logs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT '',
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  status TEXT NOT NULL CHECK (status IN ('accepted', 'retryable', 'failed', 'unknown')),
  provider_message_id TEXT NOT NULL DEFAULT '',
  error_category TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  provider_response JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_delivery_attempts_log
  ON email_delivery_attempts(email_log_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_delivery_attempts_workspace
  ON email_delivery_attempts(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS email_provider_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  provider_message_id TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL,
  recipient TEXT NOT NULL DEFAULT '',
  payload JSONB NOT NULL DEFAULT '{}',
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  processed_at TIMESTAMPTZ,
  processing_error TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_email_provider_webhooks_pending
  ON email_provider_webhook_events(processed_at, created_at)
  WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_email_provider_webhooks_message
  ON email_provider_webhook_events(provider, provider_message_id, created_at DESC);

CREATE TABLE IF NOT EXISTS email_worker_heartbeats (
  worker_id TEXT PRIMARY KEY,
  queue_name TEXT NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_email_worker_heartbeats_seen
  ON email_worker_heartbeats(last_seen_at DESC);

CREATE TABLE IF NOT EXISTS email_dead_letter_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id TEXT NOT NULL,
  queue_name TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT '',
  workspace_id UUID REFERENCES users(id) ON DELETE SET NULL,
  campaign_id UUID REFERENCES contact_campaigns(id) ON DELETE SET NULL,
  recipient_id UUID REFERENCES contact_campaign_messages(id) ON DELETE SET NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  error_category TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  payload JSONB NOT NULL DEFAULT '{}',
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (queue_name, job_id)
);

CREATE INDEX IF NOT EXISTS idx_email_dead_letters_open
  ON email_dead_letter_events(created_at DESC)
  WHERE resolved_at IS NULL;

ALTER TABLE contact_campaign_messages
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS queued_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bounced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS complaint_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS unsubscribe_at TIMESTAMPTZ;

ALTER TABLE contact_campaign_messages
  DROP CONSTRAINT IF EXISTS contact_campaign_messages_status_check;
ALTER TABLE contact_campaign_messages
  ADD CONSTRAINT contact_campaign_messages_status_check
  CHECK (status IN (
    'queued', 'processing', 'sending', 'sent', 'delivered', 'opened',
    'clicked', 'soft_bounce', 'hard_bounce', 'bounced', 'complained',
    'failed', 'skipped', 'cancelled', 'unknown'
  ));

ALTER TABLE contact_campaign_messages
  DROP CONSTRAINT IF EXISTS contact_campaign_messages_failure_kind_check;
ALTER TABLE contact_campaign_messages
  ADD CONSTRAINT contact_campaign_messages_failure_kind_check
  CHECK (failure_kind IN ('', 'temporary', 'permanent', 'hard_bounce', 'complaint', 'suppressed', 'unknown'));

CREATE INDEX IF NOT EXISTS idx_campaign_messages_provider_message
  ON contact_campaign_messages(provider, provider_message_id)
  WHERE provider <> '' AND provider_message_id IS NOT NULL AND provider_message_id <> '';

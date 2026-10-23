-- BullMQ campaign delivery hardening.
--
-- The existing contact_campaign_messages and campaign_send_batches tables are
-- the canonical recipient/batch records. This migration adds the bookkeeping
-- needed by distributed workers instead of creating a parallel campaign model.

ALTER TABLE contact_campaigns
  DROP CONSTRAINT IF EXISTS contact_campaigns_status_check;
ALTER TABLE contact_campaigns
  ADD CONSTRAINT contact_campaigns_status_check
  CHECK (status IN (
    'draft', 'validating', 'scheduled', 'queued', 'sending', 'paused',
    'sent', 'completed', 'failed', 'cancelled', 'archived'
  ));

ALTER TABLE contact_campaign_messages
  DROP CONSTRAINT IF EXISTS contact_campaign_messages_status_check;
ALTER TABLE contact_campaign_messages
  ADD CONSTRAINT contact_campaign_messages_status_check
  CHECK (status IN (
    'queued', 'processing', 'sending', 'sent', 'delivered', 'opened',
    'clicked', 'soft_bounce', 'hard_bounce', 'bounced', 'complained',
    'failed', 'skipped', 'cancelled'
  ));

ALTER TABLE contact_campaign_messages
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0
    CHECK (attempt_count >= 0),
  ADD COLUMN IF NOT EXISTS processing_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_provider_event_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS failure_reason TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS failure_kind TEXT NOT NULL DEFAULT ''
    CHECK (failure_kind IN ('', 'temporary', 'permanent', 'hard_bounce', 'complaint', 'suppressed')),
  ADD COLUMN IF NOT EXISTS suppression_reason TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS skipped_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_campaign_messages_processing
  ON contact_campaign_messages(status, processing_started_at, updated_at)
  WHERE status IN ('queued', 'processing', 'sending');

ALTER TABLE campaign_send_batches
  DROP CONSTRAINT IF EXISTS campaign_send_batches_status_check;
ALTER TABLE campaign_send_batches
  ADD CONSTRAINT campaign_send_batches_status_check
  CHECK (status IN ('pending', 'queued', 'sending', 'sent', 'failed', 'paused', 'cancelled'));

ALTER TABLE campaign_send_batches
  ADD COLUMN IF NOT EXISTS queue_job_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0
    CHECK (attempt_count >= 0),
  ADD COLUMN IF NOT EXISTS processed_count INTEGER NOT NULL DEFAULT 0
    CHECK (processed_count >= 0),
  ADD COLUMN IF NOT EXISTS skipped_count INTEGER NOT NULL DEFAULT 0
    CHECK (skipped_count >= 0),
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_campaign_send_batches_queue_job
  ON campaign_send_batches(queue_job_id)
  WHERE queue_job_id <> '';

ALTER TABLE email_settings
  ADD COLUMN IF NOT EXISTS workspace_tier TEXT NOT NULL DEFAULT 'new'
    CHECK (workspace_tier IN ('new', 'established', 'enterprise')),
  ADD COLUMN IF NOT EXISTS send_rate_per_minute INTEGER NOT NULL DEFAULT 50
    CHECK (send_rate_per_minute BETWEEN 1 AND 100000),
  ADD COLUMN IF NOT EXISTS domain_rate_per_minute INTEGER NOT NULL DEFAULT 100
    CHECK (domain_rate_per_minute BETWEEN 1 AND 100000),
  ADD COLUMN IF NOT EXISTS campaign_rate_per_minute INTEGER NOT NULL DEFAULT 500
    CHECK (campaign_rate_per_minute BETWEEN 1 AND 100000);

-- A compact reputation read model avoids recounting a large campaign on every
-- worker tick while retaining the raw campaign event ledger as the source of
-- truth for analytics.
CREATE TABLE IF NOT EXISTS campaign_reputation_snapshots (
  workspace_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES contact_campaigns(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT '',
  attempted_count INTEGER NOT NULL DEFAULT 0,
  accepted_count INTEGER NOT NULL DEFAULT 0,
  delivered_count INTEGER NOT NULL DEFAULT 0,
  hard_bounce_count INTEGER NOT NULL DEFAULT 0,
  temporary_failure_count INTEGER NOT NULL DEFAULT 0,
  complaint_count INTEGER NOT NULL DEFAULT 0,
  unsubscribe_count INTEGER NOT NULL DEFAULT 0,
  bounce_rate NUMERIC(8, 5) NOT NULL DEFAULT 0,
  complaint_rate NUMERIC(8, 5) NOT NULL DEFAULT 0,
  temporary_failure_rate NUMERIC(8, 5) NOT NULL DEFAULT 0,
  paused BOOLEAN NOT NULL DEFAULT FALSE,
  pause_reason TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_reputation_provider
  ON campaign_reputation_snapshots(provider, paused, updated_at DESC);

CREATE TABLE IF NOT EXISTS campaign_provider_queue_state (
  workspace_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  paused BOOLEAN NOT NULL DEFAULT FALSE,
  pause_reason TEXT NOT NULL DEFAULT '',
  paused_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, provider)
);

-- Normalised webhook events are retained before processing. The unique provider
-- event key is the idempotency boundary for retries from SES, Resend, SMTP
-- relays, and future provider adapters.
CREATE TABLE IF NOT EXISTS campaign_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL DEFAULT '',
  provider_message_id TEXT NOT NULL,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('delivered', 'opened', 'clicked', 'bounced', 'complained')),
  destination TEXT NOT NULL DEFAULT '',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  processed_at TIMESTAMPTZ,
  processing_error TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, provider, provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_webhook_events_pending
  ON campaign_webhook_events(processed_at, created_at)
  WHERE processed_at IS NULL;

-- Explicit queue status makes an operations dashboard able to distinguish a
-- worker outage from a provider outage without inspecting BullMQ internals.
CREATE TABLE IF NOT EXISTS campaign_queue_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES contact_campaigns(id) ON DELETE CASCADE,
  batch_id UUID REFERENCES campaign_send_batches(id) ON DELETE SET NULL,
  queue_name TEXT NOT NULL,
  job_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'active', 'completed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (queue_name, job_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_queue_audit_workspace
  ON campaign_queue_audit(workspace_id, status, updated_at DESC);

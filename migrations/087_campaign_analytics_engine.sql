-- Central, source-aware campaign analytics engine.
--
-- contact_campaign_engagement_events (086) remains as a compatibility ledger
-- for the first-party open/click implementation. campaign_events is the
-- canonical immutable event stream used by workers, CRM activity, reporting,
-- and realtime updates. Aggregates are deliberately separate from raw events
-- so dashboard reads never need to count a million-message campaign.

CREATE TABLE IF NOT EXISTS campaign_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES contact_campaigns(id) ON DELETE SET NULL,
  recipient_id UUID REFERENCES contact_campaign_messages(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  message_id UUID REFERENCES contact_campaign_messages(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'campaign_created',
    'campaign_scheduled',
    'campaign_queued',
    'email_sent',
    'email_delivered',
    'email_opened',
    'email_clicked',
    'email_bounced',
    'email_failed',
    'email_unsubscribed',
    'spam_complaint'
  )),
  source TEXT NOT NULL DEFAULT 'system' CHECK (source IN (
    'system', 'first_party', 'provider', 'api'
  )),
  provider TEXT NOT NULL DEFAULT '',
  provider_event_id TEXT NOT NULL DEFAULT '',
  event_key TEXT NOT NULL DEFAULT '',
  ip_hash TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  device TEXT NOT NULL DEFAULT '',
  client TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processing_attempts INTEGER NOT NULL DEFAULT 0,
  processing_started_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  processing_error TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_campaign_events_workspace_campaign
  ON campaign_events(workspace_id, campaign_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_campaign_events_campaign_type_time
  ON campaign_events(campaign_id, event_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_campaign_events_workspace_type_time
  ON campaign_events(workspace_id, event_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_campaign_events_message_type_time
  ON campaign_events(message_id, event_type, occurred_at DESC)
  WHERE message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_campaign_events_processing
  ON campaign_events(processed_at, processing_started_at, created_at)
  WHERE processed_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_events_idempotency
  ON campaign_events(workspace_id, event_key)
  WHERE event_key <> '';

-- Protect the event payload after it is written. Worker bookkeeping columns
-- remain mutable so crashed work can be reclaimed safely.
CREATE OR REPLACE FUNCTION maxform_campaign_event_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $campaign_event_immutable$
BEGIN
  -- Parent cleanup may null a reference through ON DELETE SET NULL. That is
  -- relationship housekeeping, not an edit to the event payload supplied by
  -- the application, and must not strand test/workspace deletion.
  IF NEW.workspace_id IS NOT DISTINCT FROM OLD.workspace_id
     AND NEW.event_type IS NOT DISTINCT FROM OLD.event_type
     AND NEW.source IS NOT DISTINCT FROM OLD.source
     AND NEW.provider IS NOT DISTINCT FROM OLD.provider
     AND NEW.provider_event_id IS NOT DISTINCT FROM OLD.provider_event_id
     AND NEW.event_key IS NOT DISTINCT FROM OLD.event_key
     AND NEW.ip_hash IS NOT DISTINCT FROM OLD.ip_hash
     AND NEW.user_agent IS NOT DISTINCT FROM OLD.user_agent
     AND NEW.device IS NOT DISTINCT FROM OLD.device
     AND NEW.client IS NOT DISTINCT FROM OLD.client
     AND NEW.country IS NOT DISTINCT FROM OLD.country
     AND NEW.metadata IS NOT DISTINCT FROM OLD.metadata
     AND NEW.occurred_at IS NOT DISTINCT FROM OLD.occurred_at
     AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
     AND (NEW.campaign_id IS NOT DISTINCT FROM OLD.campaign_id
       OR (NEW.campaign_id IS NULL AND OLD.campaign_id IS NOT NULL))
     AND (NEW.recipient_id IS NOT DISTINCT FROM OLD.recipient_id
       OR (NEW.recipient_id IS NULL AND OLD.recipient_id IS NOT NULL))
     AND (NEW.contact_id IS NOT DISTINCT FROM OLD.contact_id
       OR (NEW.contact_id IS NULL AND OLD.contact_id IS NOT NULL))
     AND (NEW.message_id IS NOT DISTINCT FROM OLD.message_id
       OR (NEW.message_id IS NULL AND OLD.message_id IS NOT NULL)) THEN
    RETURN NEW;
  END IF;
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
     OR NEW.recipient_id IS DISTINCT FROM OLD.recipient_id
     OR NEW.contact_id IS DISTINCT FROM OLD.contact_id
     OR NEW.message_id IS DISTINCT FROM OLD.message_id
     OR NEW.event_type IS DISTINCT FROM OLD.event_type
     OR NEW.source IS DISTINCT FROM OLD.source
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.provider_event_id IS DISTINCT FROM OLD.provider_event_id
     OR NEW.event_key IS DISTINCT FROM OLD.event_key
     OR NEW.ip_hash IS DISTINCT FROM OLD.ip_hash
     OR NEW.user_agent IS DISTINCT FROM OLD.user_agent
     OR NEW.device IS DISTINCT FROM OLD.device
     OR NEW.client IS DISTINCT FROM OLD.client
     OR NEW.country IS DISTINCT FROM OLD.country
     OR NEW.metadata IS DISTINCT FROM OLD.metadata
     OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'campaign event payload is immutable';
  END IF;
  RETURN NEW;
END;
$campaign_event_immutable$;

DROP TRIGGER IF EXISTS campaign_event_payload_immutable ON campaign_events;
CREATE TRIGGER campaign_event_payload_immutable
BEFORE UPDATE ON campaign_events
FOR EACH ROW
EXECUTE FUNCTION maxform_campaign_event_immutable();

CREATE TABLE IF NOT EXISTS campaign_metrics (
  workspace_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES contact_campaigns(id) ON DELETE CASCADE,
  recipient_count INTEGER NOT NULL DEFAULT 0,
  pending_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  delivered_count INTEGER NOT NULL DEFAULT 0,
  total_open_count INTEGER NOT NULL DEFAULT 0,
  unique_open_count INTEGER NOT NULL DEFAULT 0,
  total_click_count INTEGER NOT NULL DEFAULT 0,
  unique_click_count INTEGER NOT NULL DEFAULT 0,
  bounced_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  unsubscribe_count INTEGER NOT NULL DEFAULT 0,
  complaint_count INTEGER NOT NULL DEFAULT 0,
  machine_open_count INTEGER NOT NULL DEFAULT 0,
  human_open_count INTEGER NOT NULL DEFAULT 0,
  conversion_count INTEGER NOT NULL DEFAULT 0,
  revenue_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  revenue_currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  realtime_version BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, campaign_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_metrics_workspace_updated
  ON campaign_metrics(workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS campaign_daily_metrics (
  workspace_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES contact_campaigns(id) ON DELETE CASCADE,
  metric_date DATE NOT NULL,
  sent_count INTEGER NOT NULL DEFAULT 0,
  delivered_count INTEGER NOT NULL DEFAULT 0,
  total_open_count INTEGER NOT NULL DEFAULT 0,
  unique_open_count INTEGER NOT NULL DEFAULT 0,
  total_click_count INTEGER NOT NULL DEFAULT 0,
  unique_click_count INTEGER NOT NULL DEFAULT 0,
  bounced_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  unsubscribe_count INTEGER NOT NULL DEFAULT 0,
  complaint_count INTEGER NOT NULL DEFAULT 0,
  conversion_count INTEGER NOT NULL DEFAULT 0,
  revenue_amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
  revenue_currency VARCHAR(3) NOT NULL DEFAULT 'USD',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, campaign_id, metric_date)
);

CREATE INDEX IF NOT EXISTS idx_campaign_daily_metrics_campaign_date
  ON campaign_daily_metrics(campaign_id, metric_date DESC);

CREATE INDEX IF NOT EXISTS idx_campaign_daily_metrics_workspace_date
  ON campaign_daily_metrics(workspace_id, metric_date DESC);

ALTER TABLE contact_campaign_engagement_events
  ADD COLUMN IF NOT EXISTS campaign_event_id UUID
    REFERENCES campaign_events(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_campaign_engagement_event_link
  ON contact_campaign_engagement_events(campaign_event_id)
  WHERE campaign_event_id IS NOT NULL;

ALTER TABLE contact_activity
  ADD COLUMN IF NOT EXISTS source_event_id UUID
    REFERENCES campaign_events(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_activity_source_event
  ON contact_activity(source_event_id)
  WHERE source_event_id IS NOT NULL;

-- Backfill the canonical stream from the first-party ledger created by 086.
-- Provider rows retain their stable event key; first-party rows intentionally
-- remain repeatable so total opens/clicks are not collapsed.
INSERT INTO campaign_events (
  workspace_id, campaign_id, recipient_id, contact_id, message_id,
  event_type, source, provider, provider_event_id, event_key, metadata,
  occurred_at, created_at, processed_at
)
SELECT campaign.user_id,
       event.campaign_id,
       message.id,
       message.contact_id,
       message.id,
       CASE event.event_type WHEN 'open' THEN 'email_opened' ELSE 'email_clicked' END,
       event.source,
       event.provider,
       event.provider_event_id,
       CASE
         WHEN event.source = 'provider' THEN LEFT(
           COALESCE(
             NULLIF(event.provider_event_id, ''),
             event.provider || ':' || message.id::text || ':' || event.event_type || ':' || event.destination
           ), 255
         )
         ELSE ''
       END,
       COALESCE(event.metadata, '{}'::jsonb),
       event.occurred_at,
       event.occurred_at,
       NOW()
FROM contact_campaign_engagement_events event
JOIN contact_campaign_messages message ON message.id = event.message_id
JOIN contact_campaigns campaign ON campaign.id = event.campaign_id
WHERE event.campaign_event_id IS NULL
ON CONFLICT DO NOTHING;

UPDATE contact_campaign_engagement_events legacy
SET campaign_event_id = canonical.id
FROM campaign_events canonical
WHERE legacy.campaign_event_id IS NULL
  AND canonical.campaign_id = legacy.campaign_id
  AND canonical.message_id = legacy.message_id
  AND canonical.event_type = CASE legacy.event_type
    WHEN 'open' THEN 'email_opened'
    ELSE 'email_clicked'
  END
  AND canonical.source = legacy.source
  AND canonical.occurred_at = legacy.occurred_at;

-- Seed fast metrics for existing campaigns. The worker will reconcile these
-- values from campaign_events as new activity arrives.
INSERT INTO campaign_metrics (
  workspace_id, campaign_id, recipient_count, pending_count, sent_count,
  delivered_count, total_open_count, unique_open_count, total_click_count,
  unique_click_count, bounced_count, failed_count, updated_at
)
SELECT campaign.user_id,
       campaign.id,
       COUNT(message.id)::int,
       COUNT(message.id) FILTER (WHERE message.status = 'queued')::int,
       COUNT(message.id) FILTER (
         WHERE message.sent_at IS NOT NULL
            OR message.status IN ('sent', 'delivered', 'opened', 'clicked', 'bounced', 'complained')
       )::int,
       COUNT(message.id) FILTER (WHERE message.delivered_at IS NOT NULL)::int,
       COALESCE(SUM(message.open_count), 0)::int,
       COUNT(message.id) FILTER (WHERE message.opened_at IS NOT NULL)::int,
       COALESCE(SUM(message.click_count), 0)::int,
       COUNT(message.id) FILTER (WHERE message.clicked_at IS NOT NULL)::int,
       COUNT(message.id) FILTER (WHERE message.status = 'bounced')::int,
       COUNT(message.id) FILTER (WHERE message.status = 'failed')::int,
       NOW()
FROM contact_campaigns campaign
LEFT JOIN contact_campaign_messages message
  ON message.campaign_id = campaign.id
GROUP BY campaign.user_id, campaign.id
ON CONFLICT (workspace_id, campaign_id) DO UPDATE SET
  recipient_count = EXCLUDED.recipient_count,
  pending_count = EXCLUDED.pending_count,
  sent_count = EXCLUDED.sent_count,
  delivered_count = EXCLUDED.delivered_count,
  total_open_count = EXCLUDED.total_open_count,
  unique_open_count = EXCLUDED.unique_open_count,
  total_click_count = EXCLUDED.total_click_count,
  unique_click_count = EXCLUDED.unique_click_count,
  bounced_count = EXCLUDED.bounced_count,
  failed_count = EXCLUDED.failed_count,
  updated_at = NOW();

-- Historical event-day buckets are cheap to seed once and keep future reports
-- independent of the raw event table.
INSERT INTO campaign_daily_metrics (
  workspace_id, campaign_id, metric_date, sent_count, delivered_count,
  total_open_count, unique_open_count, total_click_count, unique_click_count,
  bounced_count, failed_count, unsubscribe_count, complaint_count, updated_at
)
SELECT event.workspace_id,
       event.campaign_id,
       event.occurred_at::date,
       COUNT(*) FILTER (WHERE event.event_type = 'email_sent')::int,
       COUNT(*) FILTER (WHERE event.event_type = 'email_delivered')::int,
       COUNT(*) FILTER (WHERE event.event_type = 'email_opened')::int,
       COUNT(DISTINCT event.message_id) FILTER (WHERE event.event_type = 'email_opened')::int,
       COUNT(*) FILTER (WHERE event.event_type = 'email_clicked')::int,
       COUNT(DISTINCT event.message_id) FILTER (WHERE event.event_type = 'email_clicked')::int,
       COUNT(*) FILTER (WHERE event.event_type = 'email_bounced')::int,
       COUNT(*) FILTER (WHERE event.event_type = 'email_failed')::int,
       COUNT(*) FILTER (WHERE event.event_type = 'email_unsubscribed')::int,
       COUNT(*) FILTER (WHERE event.event_type = 'spam_complaint')::int,
       NOW()
FROM campaign_events event
WHERE event.campaign_id IS NOT NULL
GROUP BY event.workspace_id, event.campaign_id, event.occurred_at::date
ON CONFLICT (workspace_id, campaign_id, metric_date) DO UPDATE SET
  sent_count = EXCLUDED.sent_count,
  delivered_count = EXCLUDED.delivered_count,
  total_open_count = EXCLUDED.total_open_count,
  unique_open_count = EXCLUDED.unique_open_count,
  total_click_count = EXCLUDED.total_click_count,
  unique_click_count = EXCLUDED.unique_click_count,
  bounced_count = EXCLUDED.bounced_count,
  failed_count = EXCLUDED.failed_count,
  unsubscribe_count = EXCLUDED.unsubscribe_count,
  complaint_count = EXCLUDED.complaint_count,
  updated_at = NOW();

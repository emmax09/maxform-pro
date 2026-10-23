-- Durable failure handling for campaign analytics.
-- A poison event must stop retrying forever while remaining inspectable and
-- alertable. The immutable event itself is retained for reconciliation.

ALTER TABLE campaign_events
  ADD COLUMN IF NOT EXISTS processing_dead_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS processing_alerted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_campaign_events_processing_dead
  ON campaign_events(processing_dead_at, created_at)
  WHERE processed_at IS NULL AND processing_dead_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS campaign_analytics_dead_letters (
  event_id UUID PRIMARY KEY REFERENCES campaign_events(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES contact_campaigns(id) ON DELETE SET NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  first_failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dead_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  alerted_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_analytics_dead_letters_workspace
  ON campaign_analytics_dead_letters(workspace_id, dead_at DESC);

CREATE INDEX IF NOT EXISTS idx_campaign_analytics_dead_letters_open
  ON campaign_analytics_dead_letters(dead_at DESC)
  WHERE resolved_at IS NULL;

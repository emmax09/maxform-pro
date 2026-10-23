-- Keep an auditable, source-aware record of every campaign open and click.
-- First-party tracking is authoritative when it exists for a message/event;
-- provider engagement webhooks remain a fallback for clients that block the
-- tracking pixel or redirect.
CREATE TABLE IF NOT EXISTS contact_campaign_engagement_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL
    REFERENCES contact_campaigns(id) ON DELETE CASCADE,
  message_id UUID NOT NULL
    REFERENCES contact_campaign_messages(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('open', 'click')),
  source TEXT NOT NULL
    CHECK (source IN ('first_party', 'provider')),
  provider TEXT NOT NULL DEFAULT '',
  provider_event_id TEXT NOT NULL DEFAULT '',
  destination TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_campaign_engagement_events_campaign
  ON contact_campaign_engagement_events(campaign_id, event_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_campaign_engagement_events_message
  ON contact_campaign_engagement_events(message_id, event_type, source, occurred_at DESC);

-- Providers retry webhooks. When they supply an event id, one retry must not
-- become another open/click. The application supplies a stable fallback key
-- for providers that do not expose an event id.
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_engagement_provider_event
  ON contact_campaign_engagement_events(provider, provider_event_id)
  WHERE source = 'provider' AND provider_event_id <> '';

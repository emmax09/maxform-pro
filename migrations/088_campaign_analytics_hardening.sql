-- Campaign analytics read-model hardening.
--
-- 087 provides the immutable event stream and campaign-level counters. This
-- migration adds the small dimensional read models used by the analytics API
-- so device/client/location/link/timeline views do not recount raw events on
-- every dashboard request. The worker rebuilds these rows idempotently from
-- the canonical stream.

ALTER TABLE campaign_events
  DROP CONSTRAINT IF EXISTS campaign_events_event_type_check;
ALTER TABLE campaign_events
  ADD CONSTRAINT campaign_events_event_type_check
  CHECK (event_type IN (
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
    'spam_complaint',
    'campaign_converted',
    'campaign_revenue_attributed'
  ));

CREATE TABLE IF NOT EXISTS campaign_metric_breakdowns (
  workspace_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES contact_campaigns(id) ON DELETE CASCADE,
  dimension TEXT NOT NULL CHECK (dimension IN ('device', 'client', 'country')),
  dimension_key TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  total_count INTEGER NOT NULL DEFAULT 0 CHECK (total_count >= 0),
  unique_count INTEGER NOT NULL DEFAULT 0 CHECK (unique_count >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, campaign_id, dimension, dimension_key)
);

CREATE INDEX IF NOT EXISTS idx_campaign_metric_breakdowns_lookup
  ON campaign_metric_breakdowns(workspace_id, campaign_id, dimension, total_count DESC);

CREATE TABLE IF NOT EXISTS campaign_hourly_metrics (
  workspace_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES contact_campaigns(id) ON DELETE CASCADE,
  metric_hour TIMESTAMPTZ NOT NULL,
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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, campaign_id, metric_hour)
);

CREATE INDEX IF NOT EXISTS idx_campaign_hourly_metrics_campaign_hour
  ON campaign_hourly_metrics(workspace_id, campaign_id, metric_hour DESC);

CREATE INDEX IF NOT EXISTS idx_campaign_events_campaign_occurred
  ON campaign_events(workspace_id, campaign_id, occurred_at DESC, id);

-- Seed the dimensional read model for existing first-party/provider opens.
WITH effective_opens AS (
  SELECT event.*
  FROM campaign_events event
  WHERE event.event_type = 'email_opened'
    AND event.campaign_id IS NOT NULL
    AND (
      event.source = 'first_party'
      OR NOT EXISTS (
        SELECT 1
        FROM campaign_events first_party
        WHERE first_party.message_id = event.message_id
          AND first_party.event_type = event.event_type
          AND first_party.source = 'first_party'
      )
    )
), dimensions AS (
  SELECT workspace_id, campaign_id, 'device'::text AS dimension,
         COALESCE(NULLIF(device, ''), NULLIF(metadata->>'device', ''), 'unknown') AS dimension_key,
         COUNT(*)::int AS total_count,
         COUNT(DISTINCT message_id)::int AS unique_count
  FROM effective_opens
  GROUP BY workspace_id, campaign_id, 4
  UNION ALL
  SELECT workspace_id, campaign_id, 'client'::text,
         COALESCE(NULLIF(client, ''), NULLIF(metadata->>'client', ''), 'unknown'),
         COUNT(*)::int, COUNT(DISTINCT message_id)::int
  FROM effective_opens
  GROUP BY workspace_id, campaign_id, 4
  UNION ALL
  SELECT workspace_id, campaign_id, 'country'::text,
         COALESCE(NULLIF(country, ''), NULLIF(metadata->>'country', ''), 'unknown'),
         COUNT(*)::int, COUNT(DISTINCT message_id)::int
  FROM effective_opens
  GROUP BY workspace_id, campaign_id, 4
)
INSERT INTO campaign_metric_breakdowns (
  workspace_id, campaign_id, dimension, dimension_key, label,
  total_count, unique_count, updated_at
)
SELECT workspace_id, campaign_id, dimension, dimension_key, dimension_key,
       total_count, unique_count, NOW()
FROM dimensions
ON CONFLICT (workspace_id, campaign_id, dimension, dimension_key) DO UPDATE SET
  label = EXCLUDED.label,
  total_count = EXCLUDED.total_count,
  unique_count = EXCLUDED.unique_count,
  updated_at = NOW();

WITH effective_events AS (
  SELECT event.*,
         (
           event.event_type IN ('email_opened', 'email_clicked')
           AND (
             event.source = 'first_party'
             OR NOT EXISTS (
               SELECT 1
               FROM campaign_events first_party
               WHERE first_party.message_id = event.message_id
                 AND first_party.event_type = event.event_type
                 AND first_party.source = 'first_party'
             )
           )
         ) AS effective
  FROM campaign_events event
  WHERE event.campaign_id IS NOT NULL
)
INSERT INTO campaign_hourly_metrics (
  workspace_id, campaign_id, metric_hour, sent_count, delivered_count,
  total_open_count, unique_open_count, total_click_count, unique_click_count,
  bounced_count, failed_count, unsubscribe_count, complaint_count, updated_at
)
SELECT workspace_id, campaign_id, DATE_TRUNC('hour', occurred_at),
       COUNT(*) FILTER (WHERE event_type = 'email_sent')::int,
       COUNT(*) FILTER (WHERE event_type = 'email_delivered')::int,
       COUNT(*) FILTER (WHERE event_type = 'email_opened' AND effective)::int,
       COUNT(DISTINCT message_id) FILTER (WHERE event_type = 'email_opened' AND effective)::int,
       COUNT(*) FILTER (WHERE event_type = 'email_clicked' AND effective)::int,
       COUNT(DISTINCT message_id) FILTER (WHERE event_type = 'email_clicked' AND effective)::int,
       COUNT(*) FILTER (WHERE event_type = 'email_bounced')::int,
       COUNT(*) FILTER (WHERE event_type = 'email_failed')::int,
       COUNT(*) FILTER (WHERE event_type = 'email_unsubscribed')::int,
       COUNT(*) FILTER (WHERE event_type = 'spam_complaint')::int,
       NOW()
FROM effective_events
GROUP BY workspace_id, campaign_id, DATE_TRUNC('hour', occurred_at)
ON CONFLICT (workspace_id, campaign_id, metric_hour) DO UPDATE SET
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

-- Populate link aggregates when a campaign's source links already exist.
WITH effective_clicks AS (
  SELECT event.campaign_id,
         event.metadata->>'destination' AS destination,
         event.message_id
  FROM campaign_events event
  WHERE event.event_type = 'email_clicked'
    AND event.campaign_id IS NOT NULL
    AND COALESCE(event.metadata->>'destination', '') <> ''
    AND (
      event.source = 'first_party'
      OR NOT EXISTS (
        SELECT 1 FROM campaign_events first_party
        WHERE first_party.message_id = event.message_id
          AND first_party.event_type = event.event_type
          AND first_party.source = 'first_party'
      )
    )
), counts AS (
  SELECT campaign_id, destination,
         COUNT(*)::int AS total_count,
         COUNT(DISTINCT message_id)::int AS unique_count
  FROM effective_clicks
  GROUP BY campaign_id, destination
)
UPDATE contact_campaign_links link
SET click_count = counts.total_count,
    unique_click_count = counts.unique_count,
    updated_at = NOW()
FROM counts
WHERE link.campaign_id = counts.campaign_id
  AND link.url = counts.destination;

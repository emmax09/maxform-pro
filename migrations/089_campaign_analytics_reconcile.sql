-- Reconcile existing campaign read models after the event-engine rollout.
-- This is safe to rerun: the raw event ledger is never changed or deleted.

CREATE OR REPLACE FUNCTION maxform_campaign_event_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $campaign_event_immutable$
BEGIN
  -- Worker bookkeeping columns are the only application-owned mutable fields.
  -- Foreign-key cleanup may null a parent reference, but it must not provide a
  -- way to edit any other part of an event payload in the same UPDATE.
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

-- Rebuild the daily view using the same provider/first-party precedence as the
-- live worker, so legacy provider webhooks cannot inflate historical opens or
-- clicks after first-party tracking is available.
DELETE FROM campaign_daily_metrics;

WITH event_rows AS (
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
), daily AS (
  SELECT workspace_id, campaign_id, occurred_at::date AS metric_date,
         COUNT(*) FILTER (WHERE event_type = 'email_sent')::int AS sent_count,
         COUNT(*) FILTER (WHERE event_type = 'email_delivered')::int AS delivered_count,
         COUNT(*) FILTER (WHERE event_type = 'email_opened' AND effective)::int AS total_open_count,
         COUNT(DISTINCT message_id) FILTER (WHERE event_type = 'email_opened' AND effective)::int AS unique_open_count,
         COUNT(*) FILTER (WHERE event_type = 'email_clicked' AND effective)::int AS total_click_count,
         COUNT(DISTINCT message_id) FILTER (WHERE event_type = 'email_clicked' AND effective)::int AS unique_click_count,
         COUNT(*) FILTER (WHERE event_type = 'email_bounced')::int AS bounced_count,
         COUNT(*) FILTER (WHERE event_type = 'email_failed')::int AS failed_count,
         COUNT(*) FILTER (WHERE event_type = 'email_unsubscribed')::int AS unsubscribe_count,
         COUNT(*) FILTER (WHERE event_type = 'spam_complaint')::int AS complaint_count
  FROM event_rows
  GROUP BY workspace_id, campaign_id, occurred_at::date
)
INSERT INTO campaign_daily_metrics (
  workspace_id, campaign_id, metric_date, sent_count, delivered_count,
  total_open_count, unique_open_count, total_click_count, unique_click_count,
  bounced_count, failed_count, unsubscribe_count, complaint_count, updated_at
)
SELECT workspace_id, campaign_id, metric_date, sent_count, delivered_count,
       total_open_count, unique_open_count, total_click_count,
       unique_click_count, bounced_count, failed_count, unsubscribe_count,
       complaint_count, NOW()
FROM daily
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

INSERT INTO campaign_daily_metrics (
  workspace_id, campaign_id, metric_date, conversion_count,
  revenue_amount, revenue_currency, updated_at
)
SELECT payment.user_id, payment.source_campaign_id,
       COALESCE(payment.paid_at, payment.created_at)::date,
       COUNT(*)::int,
       COALESCE(SUM(GREATEST(payment.total_amount - payment.refunded_amount, 0)), 0)::numeric,
       COALESCE(MIN(payment.currency), 'USD'), NOW()
FROM payment_orders payment
WHERE payment.source_campaign_id IS NOT NULL
  AND payment.status IN ('paid', 'partially_refunded', 'refunded')
GROUP BY payment.user_id, payment.source_campaign_id,
         COALESCE(payment.paid_at, payment.created_at)::date
ON CONFLICT (workspace_id, campaign_id, metric_date) DO UPDATE SET
  conversion_count = EXCLUDED.conversion_count,
  revenue_amount = EXCLUDED.revenue_amount,
  revenue_currency = EXCLUDED.revenue_currency,
  updated_at = NOW();

-- Reconcile link counters for campaigns whose source links predate the worker.
UPDATE contact_campaign_links
SET click_count = 0, unique_click_count = 0, updated_at = NOW();

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
        SELECT 1
        FROM campaign_events first_party
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

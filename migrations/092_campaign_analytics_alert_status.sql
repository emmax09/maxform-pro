-- Make dead-letter alert delivery observable.
--
-- Structured logs are always emitted by the worker. These fields additionally
-- distinguish "the alert was surfaced" from "the optional webhook accepted
-- it", so an operations team can find a broken alert integration instead of
-- treating a dead letter as successfully delivered.

ALTER TABLE campaign_analytics_dead_letters
  ADD COLUMN IF NOT EXISTS alert_attempted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS alert_delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS alert_error TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_campaign_analytics_dead_letters_alert_status
  ON campaign_analytics_dead_letters(alert_attempted_at, alert_delivered_at)
  WHERE resolved_at IS NULL;

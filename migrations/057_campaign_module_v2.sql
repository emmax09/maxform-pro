-- Campaigns v2: full-screen builder state and throttled batch sending.
--
-- Sending an entire list in one blast is a documented way to damage sender
-- reputation: providers enforce their own per-second caps, and a sudden spike
-- reads as spam behaviour to receiving servers. A campaign is therefore split
-- into waves whose size and spacing come from the connected provider's real
-- limits, recorded in provider_rate_limits below.

-- builder_state tracks progress through the split flow: a campaign is 'draft'
-- while it is being designed and becomes 'ready_to_send' when Save & Continue
-- hands it to the send wizard. It is deliberately separate from status, which
-- still describes the send lifecycle.
ALTER TABLE contact_campaigns
  ADD COLUMN IF NOT EXISTS builder_state TEXT NOT NULL DEFAULT 'draft';

ALTER TABLE contact_campaigns
  DROP CONSTRAINT IF EXISTS contact_campaigns_builder_state_check;
ALTER TABLE contact_campaigns
  ADD CONSTRAINT contact_campaigns_builder_state_check
    CHECK (builder_state IN ('draft', 'ready_to_send'));

ALTER TABLE contact_campaigns
  ADD COLUMN IF NOT EXISTS estimated_send_duration_seconds INTEGER
    CHECK (estimated_send_duration_seconds IS NULL
           OR estimated_send_duration_seconds >= 0);

-- NULL means "use the safe default computed from the provider". A workspace
-- only stores a value here when someone overrides pacing in Settings.
ALTER TABLE contact_campaigns
  ADD COLUMN IF NOT EXISTS batch_size INTEGER
    CHECK (batch_size IS NULL OR batch_size BETWEEN 1 AND 5000);

ALTER TABLE contact_campaigns
  ADD COLUMN IF NOT EXISTS batch_delay_seconds INTEGER
    CHECK (batch_delay_seconds IS NULL OR batch_delay_seconds BETWEEN 0 AND 3600);

-- A campaign that has already sent some waves must never re-send them, so the
-- dispatcher's unit of work is a durable row rather than an offset held in
-- memory. Pausing marks pending batches 'paused'; resuming flips them back.
CREATE TABLE IF NOT EXISTS campaign_send_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL
    REFERENCES contact_campaigns(id) ON DELETE CASCADE,
  batch_number INTEGER NOT NULL CHECK (batch_number > 0),
  recipient_count INTEGER NOT NULL DEFAULT 0 CHECK (recipient_count >= 0),
  sent_count INTEGER NOT NULL DEFAULT 0 CHECK (sent_count >= 0),
  failed_count INTEGER NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'paused', 'cancelled')),
  -- When this wave becomes eligible to send. Wave N is spaced from wave N-1 by
  -- the campaign's batch delay.
  scheduled_for TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dispatched_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, batch_number)
);

-- The dispatcher's hot query: the next due wave across all campaigns.
CREATE INDEX IF NOT EXISTS idx_campaign_send_batches_due
  ON campaign_send_batches(status, scheduled_for)
  WHERE status IN ('pending', 'sending');

CREATE INDEX IF NOT EXISTS idx_campaign_send_batches_campaign
  ON campaign_send_batches(campaign_id, batch_number);

-- Which wave a recipient belongs to. Assigned when batches are planned so a
-- resumed campaign picks up exactly where it stopped.
ALTER TABLE contact_campaign_messages
  ADD COLUMN IF NOT EXISTS batch_id UUID
    REFERENCES campaign_send_batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_contact_campaign_messages_batch
  ON contact_campaign_messages(batch_id)
  WHERE batch_id IS NOT NULL;

-- Published provider limits used to derive safe pacing. max_per_second is the
-- hard cap the provider itself enforces; max_per_hour is the reputation-facing
-- ceiling. Both are conservative: the goal is staying comfortably under, not
-- extracting maximum throughput.
CREATE TABLE IF NOT EXISTS provider_rate_limits (
  provider TEXT PRIMARY KEY,
  max_per_second INTEGER NOT NULL CHECK (max_per_second > 0),
  max_per_hour INTEGER NOT NULL CHECK (max_per_hour > 0),
  notes TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO provider_rate_limits (provider, max_per_second, max_per_hour, notes)
VALUES
  ('resend',    2,  3000,  'Default Resend account limit is 2 requests/second.'),
  ('sendgrid',  10, 30000, 'Shared IP pools throttle well below the API ceiling.'),
  ('ses',       14, 50000, 'A new SES account starts at 14/second; raise after review.'),
  ('postmark',  10, 25000, 'Broadcast stream limit for an established account.'),
  ('mailgun',   10, 30000, 'Flex plan sustained rate.'),
  ('smtp',      3,  1000,  'Generic SMTP relays are the most restrictive; stay low.')
ON CONFLICT (provider) DO UPDATE SET
  max_per_second = EXCLUDED.max_per_second,
  max_per_hour = EXCLUDED.max_per_hour,
  notes = EXCLUDED.notes,
  updated_at = NOW();

-- Workspace-level pacing overrides, applied to every campaign unless the
-- campaign carries its own values. NULL keeps the provider-derived default.
ALTER TABLE contact_campaign_settings
  ADD COLUMN IF NOT EXISTS batch_size INTEGER
    CHECK (batch_size IS NULL OR batch_size BETWEEN 1 AND 5000);

ALTER TABLE contact_campaign_settings
  ADD COLUMN IF NOT EXISTS batch_delay_seconds INTEGER
    CHECK (batch_delay_seconds IS NULL OR batch_delay_seconds BETWEEN 0 AND 3600);

-- Campaigns that predate the split flow were designed and sent from one
-- screen, so anything already past draft has effectively completed the builder.
UPDATE contact_campaigns
SET builder_state = 'ready_to_send'
WHERE builder_state = 'draft'
  AND status <> 'draft';

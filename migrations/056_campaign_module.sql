-- Full Campaigns module.
--
-- Extends the existing contact_campaigns tables rather than introducing a
-- parallel campaign engine: the block model matches email_templates.blocks, the
-- audience stays on contact_lists, and per-recipient rows keep living in
-- contact_campaign_messages so the send path built for transactional email is
-- reused unchanged.
--
-- Money columns follow the workspace convention of NUMERIC(14, 2) with an
-- explicit currency rather than an integer minor-unit column, so campaign
-- revenue joins payment_orders without a scaling step.

ALTER TABLE contact_campaigns
  ADD COLUMN IF NOT EXISTS exclude_list_id UUID
    REFERENCES contact_lists(id) ON DELETE SET NULL;

ALTER TABLE contact_campaigns
  ADD COLUMN IF NOT EXISTS send_strategy TEXT NOT NULL DEFAULT 'immediate';

ALTER TABLE contact_campaigns
  DROP CONSTRAINT IF EXISTS contact_campaigns_send_strategy_check;
ALTER TABLE contact_campaigns
  ADD CONSTRAINT contact_campaigns_send_strategy_check
    CHECK (send_strategy IN (
      'immediate', 'scheduled', 'timezone_optimized', 'recurring'
    ));

ALTER TABLE contact_campaigns
  ADD COLUMN IF NOT EXISTS recurrence_rule TEXT NOT NULL DEFAULT '';

ALTER TABLE contact_campaigns
  ADD COLUMN IF NOT EXISTS recurrence_requires_review BOOLEAN NOT NULL
    DEFAULT TRUE;

ALTER TABLE contact_campaigns
  ADD COLUMN IF NOT EXISTS blocks JSONB NOT NULL DEFAULT '[]';

ALTER TABLE contact_campaigns
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'newsletter';

ALTER TABLE contact_campaigns
  ADD COLUMN IF NOT EXISTS spam_score NUMERIC(5, 2);

ALTER TABLE contact_campaigns
  ADD COLUMN IF NOT EXISTS revenue_attributed NUMERIC(14, 2) NOT NULL
    DEFAULT 0 CHECK (revenue_attributed >= 0);

ALTER TABLE contact_campaigns
  ADD COLUMN IF NOT EXISTS revenue_currency VARCHAR(3) NOT NULL DEFAULT 'USD';

ALTER TABLE contact_campaigns
  ADD COLUMN IF NOT EXISTS ai_generated BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE contact_campaigns
  ADD COLUMN IF NOT EXISTS identity_id UUID
    REFERENCES email_identities(id) ON DELETE SET NULL;

ALTER TABLE contact_campaigns
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- Sent campaigns archive instead of deleting, so 'paused' and 'archived' join
-- the lifecycle and analytics stay queryable for every historical send.
ALTER TABLE contact_campaigns
  DROP CONSTRAINT IF EXISTS contact_campaigns_status_check;
ALTER TABLE contact_campaigns
  ADD CONSTRAINT contact_campaigns_status_check
    CHECK (status IN (
      'draft', 'scheduled', 'sending', 'sent', 'paused', 'cancelled',
      'archived'
    ));

CREATE INDEX IF NOT EXISTS idx_contact_campaigns_status
  ON contact_campaigns(user_id, status, scheduled_at);

-- Per-recipient engagement for the click-map, A/B split, and device breakdown.
ALTER TABLE contact_campaign_messages
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
ALTER TABLE contact_campaign_messages
  ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ;
ALTER TABLE contact_campaign_messages
  ADD COLUMN IF NOT EXISTS clicked_at TIMESTAMPTZ;
ALTER TABLE contact_campaign_messages
  ADD COLUMN IF NOT EXISTS open_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE contact_campaign_messages
  ADD COLUMN IF NOT EXISTS click_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE contact_campaign_messages
  ADD COLUMN IF NOT EXISTS variant TEXT NOT NULL DEFAULT '';
ALTER TABLE contact_campaign_messages
  ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}';

ALTER TABLE contact_campaign_messages
  DROP CONSTRAINT IF EXISTS contact_campaign_messages_status_check;
ALTER TABLE contact_campaign_messages
  ADD CONSTRAINT contact_campaign_messages_status_check
    CHECK (status IN (
      'queued', 'sending', 'sent', 'delivered', 'opened', 'clicked',
      'bounced', 'complained', 'failed', 'cancelled'
    ));

CREATE INDEX IF NOT EXISTS idx_contact_campaign_messages_engagement
  ON contact_campaign_messages(campaign_id, status);

-- Every link in a campaign is registered against the block that owns it, so
-- clicks resolve to a position in the template instead of an aggregate total.
CREATE TABLE IF NOT EXISTS contact_campaign_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL
    REFERENCES contact_campaigns(id) ON DELETE CASCADE,
  block_id TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  click_count INTEGER NOT NULL DEFAULT 0 CHECK (click_count >= 0),
  unique_click_count INTEGER NOT NULL DEFAULT 0
    CHECK (unique_click_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, block_id, url)
);

CREATE INDEX IF NOT EXISTS idx_contact_campaign_links_campaign
  ON contact_campaign_links(campaign_id, click_count DESC);

CREATE TABLE IF NOT EXISTS contact_campaign_variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL
    REFERENCES contact_campaigns(id) ON DELETE CASCADE,
  label TEXT NOT NULL CHECK (label IN ('A', 'B')),
  subject TEXT NOT NULL DEFAULT '',
  preview_text TEXT NOT NULL DEFAULT '',
  blocks JSONB NOT NULL DEFAULT '[]',
  test_percentage INTEGER NOT NULL DEFAULT 20
    CHECK (test_percentage BETWEEN 5 AND 50),
  decision_metric TEXT NOT NULL DEFAULT 'open'
    CHECK (decision_metric IN ('open', 'click')),
  decision_after_hours INTEGER NOT NULL DEFAULT 4
    CHECK (decision_after_hours BETWEEN 1 AND 168),
  sent_count INTEGER NOT NULL DEFAULT 0,
  opened_count INTEGER NOT NULL DEFAULT 0,
  clicked_count INTEGER NOT NULL DEFAULT 0,
  winner BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, label)
);

-- Campaign-specific sender defaults, frequency capping, and the compliance
-- footer address that gates a send. Suppression state itself is not duplicated
-- here: it stays in email_suppressions and contacts.unsubscribed_at.
CREATE TABLE IF NOT EXISTS contact_campaign_settings (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  identity_id UUID REFERENCES email_identities(id) ON DELETE SET NULL,
  frequency_cap_count INTEGER NOT NULL DEFAULT 3
    CHECK (frequency_cap_count BETWEEN 1 AND 50),
  frequency_cap_days INTEGER NOT NULL DEFAULT 7
    CHECK (frequency_cap_days BETWEEN 1 AND 90),
  mailing_address TEXT NOT NULL DEFAULT '',
  footer_text TEXT NOT NULL DEFAULT '',
  brand_voice TEXT NOT NULL DEFAULT 'friendly'
    CHECK (brand_voice IN ('friendly', 'direct', 'playful', 'formal')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Revenue attribution: an order placed after a campaign click is tagged back
-- to the send that produced it.
ALTER TABLE payment_orders
  ADD COLUMN IF NOT EXISTS source_campaign_id UUID
    REFERENCES contact_campaigns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payment_orders_source_campaign
  ON payment_orders(source_campaign_id)
  WHERE source_campaign_id IS NOT NULL;

-- Timezone-aware sending needs a per-contact timezone; it is inferred from
-- locale at first activity when the contact never states one.
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT '';

-- Existing drafts predate the block model. Their stored HTML stays the source
-- of truth until the builder saves structured blocks over it.
UPDATE contact_campaigns
SET blocks = jsonb_build_array(
      jsonb_build_object(
        'type', 'campaign_design',
        'version', 1,
        'legacyHtml', html_body
      )
    )
WHERE blocks = '[]'::jsonb
  AND LENGTH(TRIM(html_body)) > 0;

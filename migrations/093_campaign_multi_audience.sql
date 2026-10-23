-- Campaign audiences can target more than one CRM list or a private set of
-- email addresses. The legacy list_id column remains as the first selected
-- list for older readers, but a custom audience is allowed to have no list.

ALTER TABLE contact_campaigns
  ALTER COLUMN list_id DROP NOT NULL;

ALTER TABLE contact_campaigns
  ADD COLUMN IF NOT EXISTS audience_mode TEXT NOT NULL DEFAULT 'lists';

ALTER TABLE contact_campaigns
  DROP CONSTRAINT IF EXISTS contact_campaigns_audience_mode_check;
ALTER TABLE contact_campaigns
  ADD CONSTRAINT contact_campaigns_audience_mode_check
    CHECK (audience_mode IN ('lists', 'custom'));

ALTER TABLE contact_campaigns
  ADD COLUMN IF NOT EXISTS audience_list_ids JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE contact_campaigns
  ADD COLUMN IF NOT EXISTS custom_recipients JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE contact_campaigns
  DROP CONSTRAINT IF EXISTS contact_campaigns_audience_list_ids_array_check;
ALTER TABLE contact_campaigns
  ADD CONSTRAINT contact_campaigns_audience_list_ids_array_check
    CHECK (jsonb_typeof(audience_list_ids) = 'array');

ALTER TABLE contact_campaigns
  DROP CONSTRAINT IF EXISTS contact_campaigns_custom_recipients_array_check;
ALTER TABLE contact_campaigns
  ADD CONSTRAINT contact_campaigns_custom_recipients_array_check
    CHECK (jsonb_typeof(custom_recipients) = 'array');

-- Existing campaigns continue to resolve to their original audience.
UPDATE contact_campaigns
SET audience_list_ids = jsonb_build_array(list_id::text),
    audience_mode = 'lists'
WHERE list_id IS NOT NULL
  AND (audience_list_ids = '[]'::jsonb OR audience_list_ids IS NULL);

-- A raw address is still a first-class campaign message. contact_id remains
-- populated when an address matches a CRM contact, but is nullable for an
-- address that has not been imported into Contacts.
ALTER TABLE contact_campaign_messages
  ALTER COLUMN contact_id DROP NOT NULL;

ALTER TABLE contact_campaign_messages
  ADD COLUMN IF NOT EXISTS recipient_key TEXT
    GENERATED ALWAYS AS (LOWER(BTRIM(recipient))) STORED;

-- Existing list sends already de-duplicate by contact_id. A campaign must also
-- never send the same normalized address twice when a custom address later
-- matches an imported Contact (or when two queue attempts race each other).
DROP INDEX IF EXISTS idx_campaign_messages_custom_recipient;
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_messages_recipient
  ON contact_campaign_messages(campaign_id, recipient_key);

CREATE INDEX IF NOT EXISTS idx_contact_campaigns_audience_mode
  ON contact_campaigns(user_id, audience_mode, updated_at DESC);

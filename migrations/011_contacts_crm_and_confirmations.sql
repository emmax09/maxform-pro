ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS lifecycle_stage TEXT NOT NULL DEFAULT 'lead';

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS unsubscribed_at TIMESTAMPTZ;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'manual';

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS source_id UUID;

ALTER TABLE contacts
  DROP CONSTRAINT IF EXISTS contacts_email_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_owner_email
  ON contacts(created_by, LOWER(email));

CREATE INDEX IF NOT EXISTS idx_contacts_owner_activity
  ON contacts(created_by, last_activity_at DESC);

CREATE INDEX IF NOT EXISTS idx_contacts_owner_lifecycle
  ON contacts(created_by, lifecycle_stage);

CREATE TABLE IF NOT EXISTS contact_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  list_type TEXT NOT NULL DEFAULT 'static'
    CHECK (list_type IN ('static', 'dynamic')),
  filter_definition JSONB NOT NULL DEFAULT '[]',
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, name, list_type)
);

CREATE TABLE IF NOT EXISTS contact_list_members (
  list_id UUID NOT NULL REFERENCES contact_lists(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL DEFAULT 'manual',
  source_id UUID,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (list_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_contact_list_members_contact
  ON contact_list_members(contact_id, added_at DESC);

CREATE TABLE IF NOT EXISTS form_list_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id UUID NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  list_id UUID NOT NULL REFERENCES contact_lists(id) ON DELETE CASCADE,
  match_mode TEXT NOT NULL DEFAULT 'email'
    CHECK (match_mode IN ('email', 'email_phone')),
  field_mapping JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (form_id, list_id)
);

CREATE INDEX IF NOT EXISTS idx_form_list_mappings_form
  ON form_list_mappings(form_id);

CREATE TABLE IF NOT EXISTS contact_field_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  label TEXT NOT NULL,
  field_type TEXT NOT NULL
    CHECK (field_type IN ('text', 'number', 'date', 'select', 'checkbox')),
  options JSONB NOT NULL DEFAULT '[]',
  form_mappable BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, field_key)
);

CREATE TABLE IF NOT EXISTS contact_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  entity_type TEXT,
  entity_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contact_activity_contact
  ON contact_activity(contact_id, created_at DESC);

CREATE TABLE IF NOT EXISTS contact_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contact_notes_contact
  ON contact_notes(contact_id, created_at DESC);

CREATE TABLE IF NOT EXISTS contact_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  list_id UUID NOT NULL REFERENCES contact_lists(id) ON DELETE RESTRICT,
  subject TEXT NOT NULL,
  preview_text TEXT NOT NULL DEFAULT '',
  html_body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'cancelled')),
  scheduled_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  stats JSONB NOT NULL DEFAULT '{"sent":0,"delivered":0,"opened":0,"clicked":0,"bounced":0,"unsubscribed":0}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contact_campaigns_user
  ON contact_campaigns(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS contact_campaign_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES contact_campaigns(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  recipient TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'cancelled')),
  provider_message_id TEXT,
  last_error TEXT,
  scheduled_for TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_contact_campaign_messages_delivery
  ON contact_campaign_messages(status, scheduled_for, created_at);

CREATE TABLE IF NOT EXISTS contact_import_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed'
    CHECK (status IN ('processing', 'completed', 'failed')),
  imported_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contact_merges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  winner_contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  merged_contact_id UUID NOT NULL,
  snapshot JSONB NOT NULL DEFAULT '{}',
  merged_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contact_crm_settings (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  deduplication_mode TEXT NOT NULL DEFAULT 'email'
    CHECK (deduplication_mode IN ('email', 'email_phone')),
  lifecycle_stages JSONB NOT NULL DEFAULT '["lead","contacted","customer","past_customer"]',
  unsubscribe_footer TEXT NOT NULL DEFAULT 'You can unsubscribe from marketing emails at any time.',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

UPDATE workflow_actions
SET configuration = configuration || '{"legacyUpsert":true}'::jsonb
WHERE action_type = 'create_contact'
  AND NOT (configuration ? 'contactName')
  AND NOT (configuration ? 'legacyUpsert');

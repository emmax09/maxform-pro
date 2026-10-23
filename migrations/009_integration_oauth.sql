ALTER TABLE automation_connections
  ADD COLUMN IF NOT EXISTS auth_type VARCHAR(20) NOT NULL DEFAULT 'webhook';

ALTER TABLE automation_connections
  ADD COLUMN IF NOT EXISTS external_account_id TEXT;

ALTER TABLE automation_connections
  ADD COLUMN IF NOT EXISTS external_account_name TEXT;

ALTER TABLE automation_connections
  ADD COLUMN IF NOT EXISTS scopes JSONB NOT NULL DEFAULT '[]';

ALTER TABLE automation_connections
  ADD COLUMN IF NOT EXISTS credentials_encrypted TEXT;

ALTER TABLE automation_connections
  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ;

ALTER TABLE automation_oauth_states
  ADD COLUMN IF NOT EXISTS code_verifier TEXT;

CREATE INDEX IF NOT EXISTS idx_automation_oauth_states_expiry
  ON automation_oauth_states(expires_at);

UPDATE automation_connections
SET auth_type = CASE
  WHEN provider = 'webhook' THEN 'webhook'
  ELSE 'endpoint'
END
WHERE auth_type = 'webhook';

UPDATE automation_providers
SET logo_url = CASE id
  WHEN 'slack' THEN '/images/integrations/slack.png'
  WHEN 'google_sheets' THEN '/images/integrations/google-sheets.svg'
  WHEN 'airtable' THEN '/images/integrations/airtable.svg'
  WHEN 'hubspot' THEN '/images/integrations/hubspot.svg'
  WHEN 'mailchimp' THEN '/images/integrations/mailchimp.svg'
  WHEN 'notion' THEN '/images/integrations/notion.svg'
  ELSE logo_url
END
WHERE id IN (
  'slack',
  'google_sheets',
  'airtable',
  'hubspot',
  'mailchimp',
  'notion'
);

UPDATE automation_providers
SET enabled = FALSE
WHERE id IN ('zapier', 'make');

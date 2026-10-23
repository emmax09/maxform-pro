-- Central integrations registry.
--
-- This migration deliberately contains no payment provider, payment capability,
-- payment default, or payment route. Payments remain owned by the payments
-- module. The tables below are for non-payment workspace connections only.

CREATE TABLE IF NOT EXISTS integration_providers (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'other',
  auth_type TEXT NOT NULL DEFAULT 'oauth'
    CHECK (auth_type IN ('oauth', 'api_key', 'webhook', 'managed')),
  capabilities JSONB NOT NULL DEFAULT '[]',
  supported_modules JSONB NOT NULL DEFAULT '[]',
  platform_config JSONB NOT NULL DEFAULT '{}',
  setup_url TEXT NOT NULL DEFAULT '',
  availability_state TEXT NOT NULL DEFAULT 'active'
    CHECK (availability_state IN ('active', 'coming_soon')),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS integration_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL DEFAULT 'workspace'
    CHECK (scope_type IN ('workspace', 'personal')),
  owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  provider_key TEXT NOT NULL REFERENCES integration_providers(key) ON DELETE RESTRICT,
  connection_name TEXT NOT NULL DEFAULT '',
  external_account_id TEXT NOT NULL DEFAULT '',
  external_account_name TEXT NOT NULL DEFAULT '',
  external_account_email TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'not_connected'
    CHECK (status IN (
      'available', 'configuration_required', 'not_connected', 'connecting',
      'connected', 'partially_connected', 'reconnect_required', 'expired',
      'error', 'disabled', 'revoked'
    )),
  auth_type TEXT NOT NULL DEFAULT 'oauth',
  credentials_encrypted TEXT,
  token_expires_at TIMESTAMPTZ,
  granted_scopes JSONB NOT NULL DEFAULT '[]',
  granted_capabilities JSONB NOT NULL DEFAULT '[]',
  metadata JSONB NOT NULL DEFAULT '{}',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  reconnect_required BOOLEAN NOT NULL DEFAULT FALSE,
  last_connected_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_health_check_at TIMESTAMPTZ,
  last_error TEXT NOT NULL DEFAULT '',
  disconnected_at TIMESTAMPTZ,
  legacy_source TEXT NOT NULL DEFAULT '',
  legacy_connection_id UUID,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integration_connections_workspace
  ON integration_connections(workspace_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_integration_connections_provider
  ON integration_connections(workspace_id, provider_key, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_integration_connections_legacy
  ON integration_connections(legacy_source, legacy_connection_id)
  WHERE legacy_source <> '' AND legacy_connection_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS integration_module_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
  module_key TEXT NOT NULL,
  capabilities JSONB NOT NULL DEFAULT '[]',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (connection_id, module_key)
);

CREATE INDEX IF NOT EXISTS idx_integration_module_access_workspace
  ON integration_module_access(workspace_id, module_key, enabled);

CREATE TABLE IF NOT EXISTS integration_defaults (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module_key TEXT NOT NULL,
  purpose_key TEXT NOT NULL,
  connection_id UUID NOT NULL REFERENCES integration_connections(id) ON DELETE RESTRICT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, module_key, purpose_key)
);

CREATE TABLE IF NOT EXISTS integration_execution_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id UUID REFERENCES integration_connections(id) ON DELETE SET NULL,
  module_key TEXT NOT NULL,
  capability TEXT NOT NULL,
  action_key TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'succeeded', 'failed', 'blocked')),
  request_metadata JSONB NOT NULL DEFAULT '{}',
  response_metadata JSONB NOT NULL DEFAULT '{}',
  error_code TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_integration_execution_logs_workspace
  ON integration_execution_logs(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS integration_webhook_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  endpoint_url TEXT NOT NULL,
  secret_hash TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'error', 'revoked')),
  last_delivered_at TIMESTAMPTZ,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS integration_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES integration_webhook_subscriptions(id) ON DELETE SET NULL,
  provider_key TEXT NOT NULL,
  event_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'processed', 'failed', 'ignored')),
  payload_metadata JSONB NOT NULL DEFAULT '{}',
  error_message TEXT NOT NULL DEFAULT '',
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_integration_webhook_events_idempotency
  ON integration_webhook_events(workspace_id, idempotency_key)
  WHERE idempotency_key <> '';

CREATE TABLE IF NOT EXISTS integration_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  connection_id UUID REFERENCES integration_connections(id) ON DELETE SET NULL,
  provider_key TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integration_audit_workspace
  ON integration_audit_events(workspace_id, created_at DESC);

INSERT INTO integration_providers (
  key, name, description, category, auth_type, capabilities,
  supported_modules, platform_config, setup_url, sort_order, updated_at
)
VALUES
  ('google_workspace', 'Google Workspace', 'Calendar, Meet, Sheets, Drive, Gmail, and contacts in one connection.', 'productivity', 'oauth',
    '["calendar.read","calendar.write","availability.read","meeting.create","spreadsheet.write","file.read","file.write","email.read","email.send","contacts.read","contact.sync"]',
    '["appointments","forms","events","crm","files","documents","campaigns","reports","automations"]',
    '{"env":["GOOGLE_CLIENT_ID","GOOGLE_CLIENT_SECRET"]}', 'https://console.cloud.google.com/apis/credentials', 10, NOW()),
  ('microsoft_365', 'Microsoft 365', 'Outlook Calendar, Teams, Mail, OneDrive, and people in one connection.', 'productivity', 'oauth',
    '["calendar.read","calendar.write","availability.read","meeting.create","file.read","file.write","email.read","email.send","contacts.read","contact.sync"]',
    '["appointments","forms","events","crm","files","documents","campaigns","reports","automations"]',
    '{"env":["MICROSOFT_CLIENT_ID","MICROSOFT_CLIENT_SECRET"]}', 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps', 20, NOW()),
  ('zoom', 'Zoom', 'Create and manage video meetings from appointments and events.', 'video', 'oauth',
    '["meeting.create"]', '["appointments","events"]', '{"env":["ZOOM_CLIENT_ID","ZOOM_CLIENT_SECRET"]}', 'https://marketplace.zoom.us/develop/create', 30, NOW()),
  ('slack', 'Slack', 'Send workspace messages and operational alerts.', 'messaging', 'oauth',
    '["message.send"]', '["forms","events","crm","campaigns","automations"]', '{"env":["SLACK_CLIENT_ID","SLACK_CLIENT_SECRET"]}', 'https://api.slack.com/apps', 40, NOW()),
  ('airtable', 'Airtable', 'Write form and event data into Airtable bases.', 'data', 'oauth',
    '["spreadsheet.write","contact.sync"]', '["forms","events","crm","automations"]', '{"env":["AIRTABLE_CLIENT_ID","AIRTABLE_CLIENT_SECRET"]}', 'https://airtable.com/create/oauth', 50, NOW()),
  ('hubspot', 'HubSpot', 'Keep contacts, leads, and lifecycle activity in sync.', 'crm', 'oauth',
    '["contacts.read","contact.sync","email.read","email.send"]', '["crm","forms","events","campaigns","automations"]', '{"env":["HUBSPOT_CLIENT_ID","HUBSPOT_CLIENT_SECRET"]}', 'https://developers.hubspot.com/', 60, NOW()),
  ('mailchimp', 'Mailchimp', 'Sync audiences and campaign recipients.', 'messaging', 'oauth',
    '["contact.sync","email.send"]', '["forms","crm","campaigns","automations"]', '{"env":["MAILCHIMP_CLIENT_ID","MAILCHIMP_CLIENT_SECRET"]}', 'https://admin.mailchimp.com/account/api/', 70, NOW()),
  ('notion', 'Notion', 'Create pages and keep workspace notes connected.', 'productivity', 'oauth',
    '["file.write"]', '["forms","events","crm","documents","automations"]', '{"env":["NOTION_CLIENT_ID","NOTION_CLIENT_SECRET"]}', 'https://www.notion.so/my-integrations', 80, NOW()),
  ('calendly', 'Calendly', 'Sync scheduling availability and booking links.', 'scheduling', 'api_key',
    '["availability.read","meeting.create"]', '["appointments","events"]', '{"env":["CALENDLY_CLIENT_ID","CALENDLY_CLIENT_SECRET"]}', 'https://developer.calendly.com/', 90, NOW()),
  ('cal_com', 'Cal.com', 'Sync scheduling availability and bookings.', 'scheduling', 'api_key',
    '["availability.read","meeting.create"]', '["appointments","events"]', '{}', 'https://cal.com/docs/api', 100, NOW()),
  ('resend', 'Resend', 'Deliver workspace and campaign email.', 'email', 'api_key',
    '["email.send"]', '["forms","events","crm","campaigns","automations"]', '{}', 'https://resend.com/api-keys', 110, NOW()),
  ('sendgrid', 'SendGrid', 'Deliver transactional and campaign email.', 'email', 'api_key',
    '["email.send"]', '["forms","events","crm","campaigns","automations"]', '{}', 'https://app.sendgrid.com/guide/integrate', 120, NOW()),
  ('postmark', 'Postmark', 'Deliver reliable transactional email.', 'email', 'api_key',
    '["email.send"]', '["forms","events","crm","campaigns","automations"]', '{}', 'https://account.postmarkapp.com/servers', 130, NOW()),
  ('mailgun', 'Mailgun', 'Deliver transactional and campaign email.', 'email', 'api_key',
    '["email.send"]', '["forms","events","crm","campaigns","automations"]', '{}', 'https://app.mailgun.com/app/account/security/api_keys', 140, NOW()),
  ('ses', 'Amazon SES', 'Deliver high-volume workspace email.', 'email', 'api_key',
    '["email.send"]', '["forms","events","crm","campaigns","automations"]', '{}', 'https://console.aws.amazon.com/ses/', 150, NOW()),
  ('dropbox', 'Dropbox', 'Read and write shared workspace files.', 'storage', 'oauth',
    '["file.read","file.write"]', '["files","documents","forms","events"]', '{"env":["DROPBOX_CLIENT_ID","DROPBOX_CLIENT_SECRET"]}', 'https://www.dropbox.com/developers/apps', 160, NOW()),
  ('box', 'Box', 'Read and write shared workspace files.', 'storage', 'oauth',
    '["file.read","file.write"]', '["files","documents","forms","events"]', '{"env":["BOX_CLIENT_ID","BOX_CLIENT_SECRET"]}', 'https://developer.box.com/', 901, NOW()),
  ('custom_webhook', 'Custom webhook', 'Send signed events to any HTTPS endpoint.', 'automation', 'webhook',
    '["webhook.send"]', '["forms","events","crm","campaigns","automations","reports"]', '{}', '', 180, NOW()),
  ('zapier', 'Zapier', 'Route MaxForm events into your Zapier workflows.', 'automation', 'webhook',
    '["webhook.send"]', '["forms","events","crm","campaigns","automations"]', '{}', 'https://zapier.com/app/developer', 903, NOW()),
  ('make', 'Make', 'Route MaxForm events into your Make scenarios.', 'automation', 'webhook',
    '["webhook.send"]', '["forms","events","crm","campaigns","automations"]', '{}', 'https://www.make.com/en/developers', 200, NOW())
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  category = EXCLUDED.category,
  auth_type = EXCLUDED.auth_type,
  capabilities = EXCLUDED.capabilities,
  supported_modules = EXCLUDED.supported_modules,
  platform_config = EXCLUDED.platform_config,
  setup_url = EXCLUDED.setup_url,
  sort_order = EXCLUDED.sort_order,
  updated_at = NOW();

-- Keep the workflow foreign key useful while giving the central hub ownership
-- of the same connection record. Existing IDs are intentionally preserved.
INSERT INTO integration_connections (
  id, workspace_id, scope_type, provider_key, connection_name,
  external_account_id, external_account_name, status, auth_type,
  credentials_encrypted, token_expires_at, granted_scopes, metadata,
  reconnect_required, last_error, legacy_source, legacy_connection_id,
  created_at, updated_at
)
SELECT
  connection.id,
  connection.user_id,
  'workspace',
  CASE connection.provider WHEN 'google_sheets' THEN 'google_workspace' WHEN 'webhook' THEN 'custom_webhook' ELSE connection.provider END,
  connection.name,
  COALESCE(connection.external_account_id, ''),
  COALESCE(connection.external_account_name, connection.name),
  CASE connection.status WHEN 'connected' THEN 'connected' WHEN 'error' THEN 'error' WHEN 'disabled' THEN 'disabled' ELSE 'not_connected' END,
  COALESCE(connection.auth_type, 'oauth'),
  connection.credentials_encrypted,
  connection.token_expires_at,
  COALESCE(connection.scopes, '[]'::jsonb),
  jsonb_build_object('legacyProvider', connection.provider),
  FALSE,
  COALESCE(connection.last_error, ''),
  'automation', connection.id,
  connection.created_at, connection.updated_at
FROM automation_connections AS connection
WHERE EXISTS (SELECT 1 FROM integration_providers provider WHERE provider.key = CASE connection.provider WHEN 'google_sheets' THEN 'google_workspace' WHEN 'webhook' THEN 'custom_webhook' ELSE connection.provider END)
ON CONFLICT (id) DO NOTHING;

INSERT INTO integration_connections (
  id, workspace_id, scope_type, provider_key, connection_name,
  external_account_id, external_account_name, status, auth_type,
  credentials_encrypted, token_expires_at, granted_scopes, metadata,
  reconnect_required, last_error, legacy_source, legacy_connection_id,
  created_at, updated_at
)
SELECT
  connection.id,
  connection.user_id,
  'workspace',
  CASE connection.provider WHEN 'google_calendar' THEN 'google_workspace' WHEN 'google_meet' THEN 'google_workspace' WHEN 'outlook' THEN 'microsoft_365' WHEN 'teams' THEN 'microsoft_365' ELSE connection.provider END,
  connection.account_label,
  COALESCE(connection.external_account_id, ''),
  connection.account_label,
  CASE connection.status WHEN 'connected' THEN 'connected' WHEN 'needs_reconnect' THEN 'reconnect_required' WHEN 'error' THEN 'error' ELSE 'not_connected' END,
  COALESCE(connection.auth_type, 'oauth'),
  connection.credentials_encrypted->>'cipher',
  connection.token_expires_at,
  COALESCE(connection.scopes, '[]'::jsonb),
  jsonb_build_object('legacyProvider', connection.provider),
  connection.status = 'needs_reconnect',
  COALESCE(connection.last_error, ''),
  'scheduling', connection.id,
  connection.created_at, connection.updated_at
FROM scheduling_tool_connections AS connection
WHERE EXISTS (SELECT 1 FROM integration_providers provider WHERE provider.key = CASE connection.provider WHEN 'google_calendar' THEN 'google_workspace' WHEN 'google_meet' THEN 'google_workspace' WHEN 'outlook' THEN 'microsoft_365' WHEN 'teams' THEN 'microsoft_365' ELSE connection.provider END)
ON CONFLICT (id) DO NOTHING;

INSERT INTO integration_connections (
  id, workspace_id, scope_type, provider_key, connection_name,
  external_account_name, status, auth_type, credentials_encrypted,
  metadata, last_error, legacy_source, legacy_connection_id,
  created_at, updated_at
)
SELECT
  connection.id,
  connection.user_id,
  'workspace',
  connection.provider,
  connection.provider,
  connection.provider,
  CASE connection.status WHEN 'connected' THEN 'connected' WHEN 'attention' THEN 'error' ELSE 'not_connected' END,
  'api_key',
  connection.credentials_encrypted,
  jsonb_build_object('legacyProvider', connection.provider, 'credentialHint', connection.credential_hint, 'role', connection.role),
  COALESCE(connection.last_error, ''),
  'email', connection.id,
  connection.created_at, connection.updated_at
FROM email_provider_connections AS connection
WHERE EXISTS (SELECT 1 FROM integration_providers provider WHERE provider.key = connection.provider)
ON CONFLICT (id) DO NOTHING;

-- Existing integrations retain the module behavior they already had. New
-- connections start with no module access until an operator explicitly grants
-- it in the central hub.
INSERT INTO integration_module_access (workspace_id, connection_id, module_key, capabilities, created_at, updated_at)
SELECT connection.workspace_id, connection.id,
  CASE connection.legacy_source WHEN 'scheduling' THEN 'appointments' WHEN 'automation' THEN 'forms' ELSE 'emails' END,
  provider.capabilities,
  NOW(), NOW()
FROM integration_connections connection
JOIN integration_providers provider ON provider.key = connection.provider_key
WHERE connection.legacy_source IN ('scheduling', 'automation', 'email')
ON CONFLICT (connection_id, module_key) DO NOTHING;

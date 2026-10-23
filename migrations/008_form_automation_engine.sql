ALTER TABLE workflows
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';

ALTER TABLE workflows
  ADD COLUMN IF NOT EXISTS run_once_per_submission BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS automation_providers (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  logo_url TEXT,
  connection_mode VARCHAR(20) NOT NULL CHECK (connection_mode IN ('oauth', 'webhook')),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS automation_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL,
  name VARCHAR(120) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'untested' CHECK (status IN ('untested', 'connected', 'error', 'disabled')),
  configuration JSONB NOT NULL DEFAULT '{}',
  last_tested_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS automation_oauth_states (
  state UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL,
  return_url TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '15 minutes'),
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workflow_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  action_type VARCHAR(50) NOT NULL,
  name VARCHAR(160) NOT NULL,
  connection_id UUID REFERENCES automation_connections(id) ON DELETE SET NULL,
  configuration JSONB NOT NULL DEFAULT '{}',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workflow_conditions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  field_id TEXT NOT NULL,
  operator VARCHAR(30) NOT NULL CHECK (operator IN ('equals', 'not_equals', 'contains', 'greater_than', 'less_than', 'is_answered')),
  comparison_value TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS automation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  form_id UUID NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  submission_id UUID REFERENCES form_submissions(id) ON DELETE SET NULL,
  trigger_event VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'skipped')),
  input_data JSONB NOT NULL DEFAULT '{}',
  output_data JSONB NOT NULL DEFAULT '{}',
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS automation_run_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE,
  action_id UUID REFERENCES workflow_actions(id) ON DELETE SET NULL,
  position INTEGER NOT NULL DEFAULT 0,
  action_type VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'skipped')),
  request_data JSONB NOT NULL DEFAULT '{}',
  response_data JSONB NOT NULL DEFAULT '{}',
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_connections_user
  ON automation_connections(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_providers_enabled_order
  ON automation_providers(enabled, sort_order);

CREATE INDEX IF NOT EXISTS idx_automation_oauth_states_user_expires
  ON automation_oauth_states(user_id, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_workflow_actions_workflow_position
  ON workflow_actions(workflow_id, position);

CREATE INDEX IF NOT EXISTS idx_workflow_conditions_workflow_position
  ON workflow_conditions(workflow_id, position);

CREATE INDEX IF NOT EXISTS idx_automation_runs_form_created
  ON automation_runs(form_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_runs_workflow_created
  ON automation_runs(workflow_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_runs_submission
  ON automation_runs(submission_id);

CREATE INDEX IF NOT EXISTS idx_automation_run_steps_run_position
  ON automation_run_steps(run_id, position);

INSERT INTO automation_providers (
  id, name, description, logo_url, connection_mode, enabled, sort_order, updated_at
)
VALUES
  ('slack', 'Slack', 'Messages and channel alerts', 'https://cdn.simpleicons.org/slack/4A154B', 'oauth', TRUE, 10, NOW()),
  ('google_sheets', 'Google Sheets', 'Append responses to sheets', 'https://cdn.simpleicons.org/googlesheets/34A853', 'oauth', TRUE, 20, NOW()),
  ('zapier', 'Zapier', 'Connect thousands of apps', 'https://cdn.simpleicons.org/zapier/FF4F00', 'oauth', TRUE, 30, NOW()),
  ('make', 'Make', 'Visual integration scenarios', 'https://cdn.simpleicons.org/make/6D00CC', 'oauth', TRUE, 40, NOW()),
  ('airtable', 'Airtable', 'Create and update records', 'https://cdn.simpleicons.org/airtable/18BFFF', 'oauth', TRUE, 50, NOW()),
  ('hubspot', 'HubSpot', 'Sync contacts and leads', 'https://cdn.simpleicons.org/hubspot/FF7A59', 'oauth', TRUE, 60, NOW()),
  ('mailchimp', 'Mailchimp', 'Update audiences and tags', 'https://cdn.simpleicons.org/mailchimp/000000', 'oauth', TRUE, 70, NOW()),
  ('notion', 'Notion', 'Create database pages', 'https://cdn.simpleicons.org/notion/000000', 'oauth', TRUE, 80, NOW()),
  ('webhook', 'Custom webhook', 'Connect any HTTP endpoint', NULL, 'webhook', TRUE, 90, NOW())
ON CONFLICT (id)
DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  logo_url = EXCLUDED.logo_url,
  connection_mode = EXCLUDED.connection_mode,
  enabled = EXCLUDED.enabled,
  sort_order = EXCLUDED.sort_order,
  updated_at = NOW();

INSERT INTO workflow_actions (
  workflow_id,
  position,
  action_type,
  name,
  configuration,
  enabled
)
SELECT
  workflow.id,
  (action.ordinality - 1)::integer,
  COALESCE(NULLIF(action.value->>'type', ''), 'webhook'),
  INITCAP(REPLACE(COALESCE(NULLIF(action.value->>'type', ''), 'webhook'), '_', ' ')),
  action.value - 'type',
  TRUE
FROM workflows AS workflow
CROSS JOIN LATERAL jsonb_array_elements(
  COALESCE(workflow.actions, '[]'::jsonb)
) WITH ORDINALITY AS action(value, ordinality)
WHERE NOT EXISTS (
  SELECT 1
  FROM workflow_actions existing
  WHERE existing.workflow_id = workflow.id
);

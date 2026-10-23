-- Workspace-wide workflow engine.
--
-- The Forms automation engine owns `workflows`, `workflow_actions`,
-- `workflow_conditions`, and `automation_runs`. These tables intentionally
-- use a separate namespace so the cross-module engine cannot alter or
-- reinterpret existing form automations.

CREATE TABLE IF NOT EXISTS workspace_workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Untitled workflow',
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published')),
  trigger_type TEXT NOT NULL DEFAULT 'manual',
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  current_version INTEGER NOT NULL DEFAULT 1,
  definition_json JSONB NOT NULL DEFAULT
    '{"nodes":[],"edges":[],"viewport":{"x":0,"y":0,"zoom":1}}'::jsonb,
  webhook_key TEXT NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_workflows_webhook_key
  ON workspace_workflows(webhook_key);

CREATE INDEX IF NOT EXISTS idx_workspace_workflows_workspace_updated
  ON workspace_workflows(workspace_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_workspace_workflows_trigger
  ON workspace_workflows(workspace_id, trigger_type, status, enabled);

CREATE TABLE IF NOT EXISTS workspace_workflow_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workspace_workflows(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  definition_json JSONB NOT NULL DEFAULT
    '{"nodes":[],"edges":[],"viewport":{"x":0,"y":0,"zoom":1}}'::jsonb,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workflow_id, version)
);

CREATE INDEX IF NOT EXISTS idx_workspace_workflow_versions_workflow
  ON workspace_workflow_versions(workflow_id, version DESC);

CREATE TABLE IF NOT EXISTS workspace_workflow_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workspace_workflows(id) ON DELETE CASCADE,
  workflow_version_id UUID REFERENCES workspace_workflow_versions(id) ON DELETE SET NULL,
  trigger_type TEXT NOT NULL DEFAULT 'manual',
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'success', 'error', 'canceled')),
  trigger_payload JSONB NOT NULL DEFAULT '{}',
  output_payload JSONB NOT NULL DEFAULT '{}',
  error_json JSONB NOT NULL DEFAULT '{}',
  idempotency_key TEXT NOT NULL DEFAULT '',
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_workflow_execution_idempotency
  ON workspace_workflow_executions(workflow_id, idempotency_key)
  WHERE idempotency_key <> '';

CREATE INDEX IF NOT EXISTS idx_workspace_workflow_executions_workflow
  ON workspace_workflow_executions(workflow_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workspace_workflow_executions_status
  ON workspace_workflow_executions(status, created_at DESC);

CREATE TABLE IF NOT EXISTS workspace_workflow_node_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID NOT NULL REFERENCES workspace_workflow_executions(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  node_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'success', 'error', 'skipped')),
  input_json JSONB NOT NULL DEFAULT '{}',
  output_json JSONB NOT NULL DEFAULT '{}',
  error_json JSONB NOT NULL DEFAULT '{}',
  attempt INTEGER NOT NULL DEFAULT 1,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspace_workflow_node_runs_execution
  ON workspace_workflow_node_runs(execution_id, created_at, node_id);

CREATE TABLE IF NOT EXISTS workspace_workflow_evaluation_datasets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workspace_workflows(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Untitled dataset',
  cases_json JSONB NOT NULL DEFAULT '[]',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspace_workflow_eval_datasets_workflow
  ON workspace_workflow_evaluation_datasets(workflow_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS workspace_workflow_evaluation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id UUID NOT NULL REFERENCES workspace_workflow_evaluation_datasets(id) ON DELETE CASCADE,
  workflow_version_id UUID REFERENCES workspace_workflow_versions(id) ON DELETE SET NULL,
  results_json JSONB NOT NULL DEFAULT '[]',
  score NUMERIC(5, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspace_workflow_eval_runs_dataset
  ON workspace_workflow_evaluation_runs(dataset_id, created_at DESC);

-- A durable, workspace-scoped event ledger is the bridge between modules and
-- workflow triggers. Producers can record an event without knowing how a
-- workflow is stored, and the idempotency key prevents webhook/retry doubles.
CREATE TABLE IF NOT EXISTS workspace_workflow_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  source_module TEXT NOT NULL DEFAULT '',
  payload_json JSONB NOT NULL DEFAULT '{}',
  idempotency_key TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_workflow_events_idempotency
  ON workspace_workflow_events(workspace_id, idempotency_key)
  WHERE idempotency_key <> '';

CREATE INDEX IF NOT EXISTS idx_workspace_workflow_events_workspace_created
  ON workspace_workflow_events(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workspace_workflow_events_type
  ON workspace_workflow_events(workspace_id, event_type, created_at DESC);


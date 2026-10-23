-- Reliability and lifecycle extensions for the workspace-wide workflow engine.
-- Forms automation tables are intentionally untouched.

ALTER TABLE workspace_workflows
  DROP CONSTRAINT IF EXISTS workspace_workflows_status_check;

ALTER TABLE workspace_workflows
  ADD CONSTRAINT workspace_workflows_status_check
  CHECK (status IN ('draft', 'published', 'paused', 'archived'));

ALTER TABLE workspace_workflows
  ADD COLUMN IF NOT EXISTS published_version INTEGER,
  ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS published_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

ALTER TABLE workspace_workflow_versions
  ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS published_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS change_summary TEXT NOT NULL DEFAULT '';

ALTER TABLE workspace_workflow_executions
  DROP CONSTRAINT IF EXISTS workspace_workflow_executions_status_check;

ALTER TABLE workspace_workflow_executions
  ADD CONSTRAINT workspace_workflow_executions_status_check
  CHECK (status IN ('queued', 'running', 'waiting', 'success', 'error', 'canceled'));

ALTER TABLE workspace_workflow_executions
  ADD COLUMN IF NOT EXISTS state_json JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS resume_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS queue_job_id TEXT NOT NULL DEFAULT '';

ALTER TABLE workspace_workflow_events
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'received',
  ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS error_json JSONB NOT NULL DEFAULT '{}';

ALTER TABLE workspace_workflow_events
  DROP CONSTRAINT IF EXISTS workspace_workflow_events_status_check;

ALTER TABLE workspace_workflow_events
  ADD CONSTRAINT workspace_workflow_events_status_check
  CHECK (status IN ('received', 'processing', 'processed', 'failed'));

-- Existing published workflows keep their current behavior, but future edits
-- are isolated from the version currently serving production runs.
UPDATE workspace_workflows
SET published_version = current_version,
    published_at = COALESCE(published_at, updated_at)
WHERE status = 'published' AND published_version IS NULL;

UPDATE workspace_workflow_versions version_row
SET is_published = TRUE,
    published_at = COALESCE(version_row.published_at, workflow.updated_at)
FROM workspace_workflows workflow
WHERE workflow.id = version_row.workflow_id
  AND workflow.status = 'published'
  AND version_row.version = workflow.published_version;

CREATE INDEX IF NOT EXISTS idx_workspace_workflow_executions_ready
  ON workspace_workflow_executions(status, resume_at, created_at)
  WHERE status IN ('queued', 'waiting');

CREATE INDEX IF NOT EXISTS idx_workspace_workflow_events_ready
  ON workspace_workflow_events(status, next_attempt_at, created_at)
  WHERE status IN ('received', 'failed');

CREATE INDEX IF NOT EXISTS idx_workspace_workflow_versions_published
  ON workspace_workflow_versions(workflow_id, is_published, version DESC);

CREATE TABLE IF NOT EXISTS workspace_workflow_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'workspace',
  definition_json JSONB NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspace_workflow_templates_scope
  ON workspace_workflow_templates(workspace_id, enabled, updated_at DESC);

-- Durable audit trail for workflow lifecycle and execution decisions.
-- Historical execution rows remain workspace-scoped and can be retained or
-- pruned independently from the current workflow definition.

CREATE TABLE IF NOT EXISTS workspace_workflow_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workflow_id UUID REFERENCES workspace_workflows(id) ON DELETE SET NULL,
  execution_id UUID REFERENCES workspace_workflow_executions(id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspace_workflow_audit_workspace
  ON workspace_workflow_audit_events(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workspace_workflow_audit_workflow
  ON workspace_workflow_audit_events(workflow_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workspace_workflow_audit_execution
  ON workspace_workflow_audit_events(execution_id, created_at DESC);

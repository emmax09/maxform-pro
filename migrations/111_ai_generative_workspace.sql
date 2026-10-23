-- MaxAI generative workspace support.
--
-- These tables deliberately store drafts and signals separately from the
-- product modules. A canvas session is only an editable snapshot until the
-- person chooses to save it through the real module; it never becomes a
-- second source of truth for Forms, Events, Appointments, or any other area.

CREATE TABLE IF NOT EXISTS ai_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  explanation TEXT NOT NULL,
  related_record_type TEXT,
  related_record_id UUID,
  status TEXT NOT NULL DEFAULT 'open',
  snoozed_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_insights_severity_check'
  ) THEN
    ALTER TABLE ai_insights
      ADD CONSTRAINT ai_insights_severity_check
      CHECK (severity IN ('info', 'warning', 'critical'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_insights_status_check'
  ) THEN
    ALTER TABLE ai_insights
      ADD CONSTRAINT ai_insights_status_check
      CHECK (status IN ('open', 'dismissed', 'snoozed', 'resolved'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ai_insights_workspace_status
  ON ai_insights(workspace_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_insights_workspace_module
  ON ai_insights(workspace_id, module, created_at DESC);

-- One current signal per record. A partial unique index keeps repeated
-- background scans idempotent while allowing old dismissed signals to remain
-- as an audit trail.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_insights_current_signal
  ON ai_insights(workspace_id, module, signal_type, related_record_id)
  WHERE status IN ('open', 'snoozed') AND related_record_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS ai_canvas_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES ai_conversations(id) ON DELETE SET NULL,
  canvas_type TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  canvas_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_canvas_sessions_workspace
  ON ai_canvas_sessions(workspace_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_canvas_sessions_conversation
  ON ai_canvas_sessions(conversation_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_module_access_settings (
  workspace_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module TEXT NOT NULL,
  access_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  requires_confirmation_for TEXT[] NOT NULL DEFAULT '{}',
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, module)
);

CREATE INDEX IF NOT EXISTS idx_ai_module_access_workspace
  ON ai_module_access_settings(workspace_id, module);

COMMENT ON TABLE ai_insights IS
  'Explainable, actionable signals generated from the real workspace module data.';
COMMENT ON TABLE ai_canvas_sessions IS
  'Editable AI drafts that are rendered by the real module components before saving.';
COMMENT ON TABLE ai_module_access_settings IS
  'Per-workspace AI read/action permissions. Missing rows mean access is enabled.';

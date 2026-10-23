-- Persisted dashboard notifications. No sample rows are inserted: every row is
-- materialized from real workspace activity by the authenticated server API.
CREATE TABLE IF NOT EXISTS workspace_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL
    CHECK (
      kind IN (
        'form_submission',
        'payment_received',
        'event_registration',
        'email_delivery_issue'
      )
    ),
  priority TEXT NOT NULL DEFAULT 'info'
    CHECK (priority IN ('info', 'success', 'warning')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id UUID NOT NULL,
  action_url TEXT NOT NULL DEFAULT '/dashboard',
  metadata JSONB NOT NULL DEFAULT '{}',
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, kind, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_notifications_recent
  ON workspace_notifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workspace_notifications_unread
  ON workspace_notifications(user_id, created_at DESC)
  WHERE read_at IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'maxform_browser') THEN
    REVOKE ALL ON TABLE workspace_notifications FROM maxform_browser;
  END IF;
END
$$;

COMMENT ON TABLE workspace_notifications IS
  'Workspace-scoped dashboard notifications materialized from real operational data.';

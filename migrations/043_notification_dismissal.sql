-- Keep cleared notifications as lightweight tombstones so the activity sync
-- does not recreate them on the next dashboard refresh.
ALTER TABLE workspace_notifications
  ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_workspace_notifications_visible
  ON workspace_notifications(user_id, created_at DESC)
  WHERE dismissed_at IS NULL;


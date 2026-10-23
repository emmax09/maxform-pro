-- Source-aware file collections, user preferences, and durable storage cleanup.

CREATE TABLE IF NOT EXISTS workspace_file_settings (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  default_view TEXT NOT NULL DEFAULT 'grid'
    CHECK (default_view IN ('grid', 'list')),
  retention_days INTEGER NOT NULL DEFAULT 30
    CHECK (retention_days BETWEEN 1 AND 90),
  share_expiry_days INTEGER NOT NULL DEFAULT 7
    CHECK (share_expiry_days BETWEEN 1 AND 365),
  group_by_source BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- When imported submission media is permanently removed, retain a tiny
-- tombstone so the automatic sync does not recreate the cleared file.
CREATE TABLE IF NOT EXISTS workspace_file_sync_exclusions (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL,
  excluded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, storage_key)
);

CREATE INDEX IF NOT EXISTS idx_workspace_file_sync_exclusions_created
  ON workspace_file_sync_exclusions(user_id, excluded_at DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'maxform_browser') THEN
    REVOKE ALL ON TABLE workspace_file_settings FROM maxform_browser;
    REVOKE ALL ON TABLE workspace_file_sync_exclusions FROM maxform_browser;
  END IF;
END
$$;

COMMENT ON TABLE workspace_file_settings IS
  'User-scoped Files module view, retention, sharing, and grouping preferences.';

COMMENT ON TABLE workspace_file_sync_exclusions IS
  'Prevents permanently cleared submission media from being recreated by automatic Files sync.';

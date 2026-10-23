-- Prevent overlapping provider pulls while allowing a crashed worker to be
-- recovered automatically on the next scheduler pass.

ALTER TABLE cms_connections
  ADD COLUMN IF NOT EXISTS sync_lock_token TEXT,
  ADD COLUMN IF NOT EXISTS sync_lock_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_cms_connections_sync_lease
  ON cms_connections(sync_lock_expires_at, status);

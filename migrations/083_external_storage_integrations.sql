-- Optional external-storage relationships for Google Drive and Dropbox.
-- MaxForm remains the source of truth: these tables only describe copies,
-- imports, links, and their retryable operations.

ALTER TABLE workspace_files
  ADD COLUMN IF NOT EXISTS original_file_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS file_extension TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS checksum_sha256 TEXT;

UPDATE workspace_files file
SET original_file_name = COALESCE(NULLIF(file.original_file_name, ''), file.name),
    file_extension = COALESCE(
      NULLIF(file.file_extension, ''),
      CASE
        WHEN POSITION('.' IN reverse(file.name)) > 0
        THEN lower(right(file.name, POSITION('.' IN reverse(file.name)) - 1))
        ELSE ''
      END
    ),
    checksum_sha256 = COALESCE(file.checksum_sha256, object.checksum_sha256)
FROM storage_objects object
WHERE object.id = file.storage_object_id;

CREATE TABLE IF NOT EXISTS external_storage_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_folder_id UUID REFERENCES workspace_folders(id) ON DELETE CASCADE,
  connection_id UUID REFERENCES integration_connections(id) ON DELETE SET NULL,
  provider TEXT NOT NULL CHECK (provider IN ('google_drive', 'dropbox')),
  external_parent_folder_id TEXT NOT NULL DEFAULT '',
  external_folder_id TEXT NOT NULL,
  external_folder_name TEXT NOT NULL DEFAULT '',
  external_path TEXT NOT NULL DEFAULT '',
  external_url TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE external_storage_folders
  ADD COLUMN IF NOT EXISTS external_parent_folder_id TEXT NOT NULL DEFAULT '';

DROP INDEX IF EXISTS idx_external_storage_folders_mapping;

CREATE UNIQUE INDEX IF NOT EXISTS idx_external_storage_folders_mapping
  ON external_storage_folders(
    workspace_id, connection_id, provider, workspace_folder_id,
    external_parent_folder_id
  )
  WHERE workspace_folder_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_external_storage_folders_remote
  ON external_storage_folders(workspace_id, connection_id, provider, external_folder_id);

CREATE INDEX IF NOT EXISTS idx_external_storage_folders_workspace
  ON external_storage_folders(workspace_id, provider, updated_at DESC);

CREATE TABLE IF NOT EXISTS external_storage_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_id UUID REFERENCES workspace_files(id) ON DELETE CASCADE,
  connection_id UUID REFERENCES integration_connections(id) ON DELETE SET NULL,
  provider TEXT NOT NULL CHECK (provider IN ('google_drive', 'dropbox')),
  external_file_id TEXT NOT NULL,
  external_folder_id TEXT NOT NULL DEFAULT '',
  external_file_name TEXT NOT NULL DEFAULT '',
  external_url TEXT NOT NULL DEFAULT '',
  external_path TEXT NOT NULL DEFAULT '',
  external_revision TEXT NOT NULL DEFAULT '',
  relationship_mode TEXT NOT NULL CHECK (relationship_mode IN (
    'copied_to_external',
    'imported_to_maxform',
    'linked_external',
    'synchronized'
  )),
  sync_status TEXT NOT NULL DEFAULT 'active' CHECK (sync_status IN (
    'active',
    'pending',
    'failed',
    'reconnect_required',
    'deleted'
  )),
  last_sync_at TIMESTAMPTZ,
  last_successful_operation TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (file_id IS NOT NULL OR relationship_mode = 'linked_external')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_external_storage_links_file_connection
  ON external_storage_links(workspace_id, file_id, connection_id, relationship_mode)
  WHERE file_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_external_storage_links_remote
  ON external_storage_links(workspace_id, connection_id, provider, external_file_id);

CREATE INDEX IF NOT EXISTS idx_external_storage_links_workspace
  ON external_storage_links(workspace_id, provider, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_external_storage_links_file
  ON external_storage_links(file_id, updated_at DESC)
  WHERE file_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS external_storage_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_id UUID REFERENCES workspace_files(id) ON DELETE SET NULL,
  link_id UUID REFERENCES external_storage_links(id) ON DELETE SET NULL,
  connection_id UUID REFERENCES integration_connections(id) ON DELETE SET NULL,
  provider TEXT NOT NULL CHECK (provider IN ('google_drive', 'dropbox')),
  operation_type TEXT NOT NULL CHECK (operation_type IN (
    'copy_to_external',
    'import_to_maxform',
    'link_external',
    'create_folder',
    'bulk_copy'
  )),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued',
    'running',
    'succeeded',
    'failed',
    'cancelled'
  )),
  idempotency_key TEXT NOT NULL,
  request_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_code TEXT NOT NULL DEFAULT '',
  error_message TEXT NOT NULL DEFAULT '',
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  max_retries INTEGER NOT NULL DEFAULT 5 CHECK (max_retries BETWEEN 0 AND 20),
  next_attempt_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_external_storage_operations_queue
  ON external_storage_operations(status, next_attempt_at, created_at)
  WHERE status IN ('queued', 'failed');

CREATE INDEX IF NOT EXISTS idx_external_storage_operations_workspace
  ON external_storage_operations(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_external_storage_operations_file
  ON external_storage_operations(file_id, created_at DESC)
  WHERE file_id IS NOT NULL;

UPDATE integration_providers
SET capabilities = CASE key
  WHEN 'google_workspace' THEN '["calendar.read","calendar.write","availability.read","meeting.create","spreadsheet.write","file.read","file.write","folder.read","folder.create","file.import","file.export","contacts.read","contact.sync"]'::jsonb
  WHEN 'dropbox' THEN '["file.read","file.write","folder.read","folder.create","file.import","file.export"]'::jsonb
  ELSE capabilities
END,
updated_at = NOW()
WHERE key IN ('google_workspace', 'dropbox');

COMMENT ON TABLE external_storage_links IS
  'Optional links between an internal MaxForm file and a Google Drive or Dropbox object.';

COMMENT ON TABLE external_storage_operations IS
  'Retryable, idempotent external-storage operations. A failed provider operation never rolls back the MaxForm file.';

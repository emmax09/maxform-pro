-- Cloudflare R2 metadata-only storage catalog.
--
-- This migration is deliberately backward compatible: legacy content_data
-- columns remain readable while scripts/migrate-files-to-r2.ts uploads and
-- verifies existing payloads. After the migration script reports zero legacy
-- payloads, run scripts/finalize-r2-storage.sql to remove those columns.

CREATE TABLE IF NOT EXISTS storage_objects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'r2'
    CHECK (provider = 'r2'),
  bucket_name TEXT NOT NULL CHECK (char_length(bucket_name) BETWEEN 1 AND 255),
  object_key TEXT NOT NULL CHECK (char_length(object_key) BETWEEN 1 AND 1024),
  file_name TEXT NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 255),
  mime_type TEXT NOT NULL CHECK (char_length(mime_type) BETWEEN 1 AND 180),
  size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
  visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'public')),
  purpose TEXT NOT NULL
    CHECK (purpose IN (
      'workspace_file',
      'form_response',
      'form_asset',
      'event_asset',
      'ticket_asset',
      'email_image',
      'profile_avatar',
      'product_image',
      'crm_attachment',
      'document_template',
      'generated_document',
      'export'
    )),
  source_id UUID,
  public_url TEXT,
  etag TEXT,
  checksum_sha256 TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'ready', 'quarantined', 'deleted')),
  scan_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (scan_status IN ('pending', 'validated', 'quarantined')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  verified_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (bucket_name, object_key),
  CHECK (
    (visibility = 'public' AND public_url IS NOT NULL)
    OR visibility = 'private'
  )
);

CREATE INDEX IF NOT EXISTS idx_storage_objects_owner
  ON storage_objects(user_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_storage_objects_source
  ON storage_objects(user_id, purpose, source_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_storage_objects_pending
  ON storage_objects(created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_storage_objects_deleted
  ON storage_objects(deleted_at)
  WHERE status = 'deleted';

CREATE TABLE IF NOT EXISTS crm_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  storage_object_id UUID NOT NULL UNIQUE
    REFERENCES storage_objects(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (contact_id, storage_object_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_attachments_contact
  ON crm_attachments(user_id, contact_id, created_at DESC);

CREATE TABLE IF NOT EXISTS storage_upload_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_object_id UUID NOT NULL UNIQUE
    REFERENCES storage_objects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  multipart_upload_id TEXT,
  part_size_bytes BIGINT,
  expected_size_bytes BIGINT NOT NULL CHECK (expected_size_bytes > 0),
  expected_mime_type TEXT NOT NULL,
  field_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'aborted', 'rejected')),
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (multipart_upload_id IS NULL AND part_size_bytes IS NULL)
    OR
    (multipart_upload_id IS NOT NULL AND part_size_bytes >= 5242880)
  )
);

CREATE INDEX IF NOT EXISTS idx_storage_upload_sessions_expiry
  ON storage_upload_sessions(expires_at)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS storage_upload_rate_limits (
  identifier_hash TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1 CHECK (request_count > 0),
  PRIMARY KEY (identifier_hash, window_start)
);

CREATE INDEX IF NOT EXISTS idx_storage_upload_rate_limits_expiry
  ON storage_upload_rate_limits(window_start);

ALTER TABLE form_submission_files
  ALTER COLUMN content_data DROP NOT NULL;

ALTER TABLE form_submission_files
  DROP CONSTRAINT IF EXISTS form_submission_files_content_data_check;

ALTER TABLE form_submission_files
  ADD COLUMN IF NOT EXISTS storage_object_id UUID
    REFERENCES storage_objects(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS object_key TEXT,
  ADD COLUMN IF NOT EXISTS storage_provider TEXT,
  ADD COLUMN IF NOT EXISTS file_url TEXT,
  ADD COLUMN IF NOT EXISTS etag TEXT,
  ADD COLUMN IF NOT EXISTS checksum_sha256 TEXT;

ALTER TABLE form_submission_files
  DROP CONSTRAINT IF EXISTS form_submission_files_storage_reference_check;

ALTER TABLE form_submission_files
  ADD CONSTRAINT form_submission_files_storage_reference_check
  CHECK (
    (
      storage_object_id IS NOT NULL
      AND storage_provider = 'r2'
      AND NULLIF(object_key, '') IS NOT NULL
    )
    OR
    (
      content_data IS NOT NULL
      AND content_data ~
        '^data:[a-zA-Z0-9.+-]+/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/]+={0,2}$'
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_form_submission_files_storage_object
  ON form_submission_files(storage_object_id)
  WHERE storage_object_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_form_submission_files_object_key
  ON form_submission_files(object_key)
  WHERE object_key IS NOT NULL;

ALTER TABLE workspace_files
  DROP CONSTRAINT IF EXISTS workspace_files_content_data_check;

ALTER TABLE workspace_files
  DROP CONSTRAINT IF EXISTS workspace_files_scan_status_check;

UPDATE workspace_files
SET scan_status = 'validated'
WHERE scan_status = 'clean';

ALTER TABLE workspace_files
  ALTER COLUMN scan_status SET DEFAULT 'validated',
  ADD CONSTRAINT workspace_files_scan_status_check
  CHECK (scan_status IN ('pending', 'validated', 'quarantined'));

ALTER TABLE workspace_files
  ADD COLUMN IF NOT EXISTS storage_object_id UUID
    REFERENCES storage_objects(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS storage_provider TEXT,
  ADD COLUMN IF NOT EXISTS file_url TEXT,
  ADD COLUMN IF NOT EXISTS etag TEXT,
  ADD COLUMN IF NOT EXISTS checksum_sha256 TEXT;

ALTER TABLE workspace_files
  ADD CONSTRAINT workspace_files_storage_reference_check
  CHECK (
    (
      storage_object_id IS NOT NULL
      AND storage_provider = 'r2'
      AND NULLIF(storage_key, '') IS NOT NULL
    )
    OR
    (
      content_data IS NOT NULL
      AND content_data ~
        '^data:[a-zA-Z0-9.+-]+/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/]+={0,2}$'
    )
  ) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_workspace_files_storage_object
  ON workspace_files(storage_object_id)
  WHERE storage_object_id IS NOT NULL;

-- Keep the Files catalog in sync at write time. This replaces the previous
-- request-time INSERT/UPSERT that copied every form payload whenever a user
-- opened the Files module.
CREATE OR REPLACE FUNCTION maxform_catalog_submission_file()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner_id UUID;
  source_event_id UUID;
  source_event_title TEXT;
  source_form_title TEXT;
BEGIN
  SELECT form.created_by, form.title
  INTO owner_id, source_form_title
  FROM forms form
  WHERE form.id = NEW.form_id;

  IF owner_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT event.id, event.title
  INTO source_event_id, source_event_title
  FROM events event
  WHERE event.registration_form_id = NEW.form_id
    AND event.created_by = owner_id
  ORDER BY event.created_at DESC, event.id DESC
  LIMIT 1;

  INSERT INTO workspace_files (
    user_id,
    name,
    mime_type,
    size_bytes,
    storage_key,
    content_data,
    storage_object_id,
    storage_provider,
    file_url,
    etag,
    checksum_sha256,
    source_type,
    source_id,
    source_label,
    uploaded_by,
    scan_status,
    created_at,
    updated_at
  )
  VALUES (
    owner_id,
    NEW.file_name,
    NEW.mime_type,
    NEW.file_size,
    'forms/' || NEW.id::text,
    NEW.content_data,
    NEW.storage_object_id,
    NEW.storage_provider,
    NEW.file_url,
    NEW.etag,
    NEW.checksum_sha256,
    CASE WHEN source_event_id IS NULL
      THEN 'form_upload'
      ELSE 'event_upload'
    END,
    NEW.submission_id,
    CASE WHEN source_event_id IS NULL
      THEN 'Form: ' || COALESCE(NULLIF(source_form_title, ''), 'Untitled form')
      ELSE 'Event: ' || COALESCE(NULLIF(source_event_title, ''), 'Untitled event')
    END,
    owner_id,
    'validated',
    NEW.created_at,
    NEW.created_at
  )
  ON CONFLICT (user_id, storage_key) DO UPDATE SET
    name = EXCLUDED.name,
    mime_type = EXCLUDED.mime_type,
    size_bytes = EXCLUDED.size_bytes,
    content_data = EXCLUDED.content_data,
    storage_object_id = EXCLUDED.storage_object_id,
    storage_provider = EXCLUDED.storage_provider,
    file_url = EXCLUDED.file_url,
    etag = EXCLUDED.etag,
    checksum_sha256 = EXCLUDED.checksum_sha256,
    source_type = EXCLUDED.source_type,
    source_id = EXCLUDED.source_id,
    source_label = EXCLUDED.source_label,
    updated_at = NOW();

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_catalog_submission_file
  ON form_submission_files;

CREATE TRIGGER trg_catalog_submission_file
AFTER INSERT OR UPDATE OF
  file_name,
  mime_type,
  file_size,
  content_data,
  storage_object_id,
  object_key,
  storage_provider,
  file_url,
  etag,
  checksum_sha256
ON form_submission_files
FOR EACH ROW
EXECUTE FUNCTION maxform_catalog_submission_file();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'maxform_browser') THEN
    REVOKE ALL ON TABLE storage_objects FROM maxform_browser;
    REVOKE ALL ON TABLE crm_attachments FROM maxform_browser;
    REVOKE ALL ON TABLE storage_upload_sessions FROM maxform_browser;
    REVOKE ALL ON TABLE storage_upload_rate_limits FROM maxform_browser;
    REVOKE EXECUTE ON FUNCTION maxform_catalog_submission_file()
      FROM PUBLIC, maxform_browser;
  END IF;
END
$$;

COMMENT ON TABLE storage_objects IS
  'Metadata-only catalog for Cloudflare R2 objects. File bytes never belong in PostgreSQL.';

COMMENT ON TABLE storage_upload_sessions IS
  'Short-lived upload intents used for direct browser-to-R2 uploads and post-upload verification.';

-- Security hardening for the R2-only storage architecture.
--
-- Private files remain private R2 objects. Public assets are uploaded to the
-- private bucket first and are promoted only after server-side verification.
-- The browser never supplies authoritative object metadata.

ALTER TABLE storage_objects
  DROP CONSTRAINT IF EXISTS storage_objects_status_check;

ALTER TABLE storage_objects
  ADD CONSTRAINT storage_objects_status_check
  CHECK (status IN (
    'pending', 'ready', 'quarantined', 'deleting', 'deleted'
  ));

ALTER TABLE storage_objects
  DROP CONSTRAINT IF EXISTS storage_objects_check;

ALTER TABLE storage_objects
  ADD CONSTRAINT storage_objects_visibility_url_check
  CHECK (
    (visibility = 'public' AND public_url IS NOT NULL)
    OR
    (visibility = 'private' AND public_url IS NULL)
  );

ALTER TABLE storage_objects
  ADD CONSTRAINT storage_objects_tenant_key_check
  CHECK (object_key LIKE 'tenants/' || user_id::text || '/%')
  NOT VALID;

ALTER TABLE storage_objects
  VALIDATE CONSTRAINT storage_objects_tenant_key_check;

CREATE INDEX IF NOT EXISTS idx_storage_objects_deleting
  ON storage_objects(updated_at)
  WHERE status = 'deleting';

ALTER TABLE storage_upload_sessions
  DROP CONSTRAINT IF EXISTS storage_upload_sessions_status_check;

ALTER TABLE storage_upload_sessions
  ADD CONSTRAINT storage_upload_sessions_status_check
  CHECK (status IN (
    'pending', 'processing', 'completed', 'aborted', 'rejected'
  ));

ALTER TABLE storage_upload_sessions
  ADD COLUMN IF NOT EXISTS upload_bucket_name TEXT,
  ADD COLUMN IF NOT EXISTS upload_object_key TEXT,
  ADD COLUMN IF NOT EXISTS upload_visibility TEXT,
  ADD COLUMN IF NOT EXISTS target_bucket_name TEXT,
  ADD COLUMN IF NOT EXISTS target_object_key TEXT,
  ADD COLUMN IF NOT EXISTS target_public_url TEXT,
  ADD COLUMN IF NOT EXISTS target_visibility TEXT,
  ADD COLUMN IF NOT EXISTS staging_deleted_at TIMESTAMPTZ;

UPDATE storage_upload_sessions session
SET
  upload_bucket_name = object.bucket_name,
  upload_object_key = object.object_key,
  upload_visibility = object.visibility,
  target_bucket_name = object.bucket_name,
  target_object_key = object.object_key,
  target_public_url = object.public_url,
  target_visibility = object.visibility
FROM storage_objects object
WHERE object.id = session.storage_object_id
  AND (
    session.upload_bucket_name IS NULL
    OR session.upload_object_key IS NULL
    OR session.upload_visibility IS NULL
    OR session.target_bucket_name IS NULL
    OR session.target_object_key IS NULL
    OR session.target_visibility IS NULL
  );

ALTER TABLE storage_upload_sessions
  ALTER COLUMN upload_bucket_name SET NOT NULL,
  ALTER COLUMN upload_object_key SET NOT NULL,
  ALTER COLUMN upload_visibility SET NOT NULL,
  ALTER COLUMN target_bucket_name SET NOT NULL,
  ALTER COLUMN target_object_key SET NOT NULL,
  ALTER COLUMN target_visibility SET NOT NULL;

ALTER TABLE storage_upload_sessions
  ADD CONSTRAINT storage_upload_sessions_locations_check
  CHECK (
    upload_visibility IN ('private', 'public')
    AND target_visibility IN ('private', 'public')
    AND (
      (target_visibility = 'public' AND target_public_url IS NOT NULL)
      OR
      (target_visibility = 'private' AND target_public_url IS NULL)
    )
  );

CREATE TABLE IF NOT EXISTS storage_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  storage_object_id UUID REFERENCES storage_objects(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (char_length(action) BETWEEN 1 AND 80),
  outcome TEXT NOT NULL CHECK (outcome IN ('succeeded', 'denied', 'failed')),
  reason_code TEXT NOT NULL DEFAULT ''
    CHECK (char_length(reason_code) <= 120),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_storage_audit_events_object
  ON storage_audit_events(storage_object_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_storage_audit_events_actor
  ON storage_audit_events(actor_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_storage_audit_events_recent_failures
  ON storage_audit_events(created_at DESC)
  WHERE outcome <> 'succeeded';

CREATE OR REPLACE FUNCTION maxform_secure_submission_storage_reference()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  stored storage_objects%ROWTYPE;
BEGIN
  IF NEW.storage_object_id IS NULL THEN
    RAISE EXCEPTION 'A verified storage object is required.'
      USING ERRCODE = '23514';
  END IF;

  SELECT object.*
  INTO stored
  FROM storage_objects object
  JOIN forms form
    ON form.id = NEW.form_id
   AND form.created_by = object.user_id
  WHERE object.id = NEW.storage_object_id
    AND object.purpose = 'form_response'
    AND object.source_id = NEW.form_id
    AND object.visibility = 'private'
    AND object.public_url IS NULL
    AND object.status = 'ready'
    AND object.scan_status = 'validated'
    AND object.deleted_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM form_fields field
      WHERE field.form_id = NEW.form_id
        AND field.field_id = NEW.field_id
        AND field.field_type IN ('file', 'camera', 'signature')
    )
  LIMIT 1;

  IF stored.id IS NULL THEN
    RAISE EXCEPTION 'The file is not an authorized upload for this form field.'
      USING ERRCODE = '42501';
  END IF;

  -- R2 metadata is canonical. Never trust values supplied by a browser.
  NEW.file_name := stored.file_name;
  NEW.mime_type := stored.mime_type;
  NEW.file_size := stored.size_bytes;
  NEW.object_key := stored.object_key;
  NEW.storage_provider := 'r2';
  NEW.file_url := NULL;
  NEW.etag := stored.etag;
  NEW.checksum_sha256 := stored.checksum_sha256;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_secure_submission_storage_reference
  ON form_submission_files;

CREATE TRIGGER trg_secure_submission_storage_reference
BEFORE INSERT OR UPDATE OF
  form_id, field_id, file_name, mime_type, file_size, storage_object_id,
  object_key, storage_provider, file_url, etag, checksum_sha256
ON form_submission_files
FOR EACH ROW
EXECUTE FUNCTION maxform_secure_submission_storage_reference();

DO $$
BEGIN
  REVOKE ALL ON TABLE storage_audit_events FROM PUBLIC;
  REVOKE EXECUTE ON FUNCTION maxform_secure_submission_storage_reference()
    FROM PUBLIC;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'maxform_browser') THEN
    REVOKE ALL ON TABLE storage_audit_events FROM maxform_browser;
    REVOKE EXECUTE ON FUNCTION maxform_secure_submission_storage_reference()
      FROM maxform_browser;
  END IF;
END
$$;

COMMENT ON TABLE storage_audit_events IS
  'Security audit trail for R2 metadata operations. Never stores URLs, credentials, or file content.';

COMMENT ON FUNCTION maxform_secure_submission_storage_reference() IS
  'Authorizes form file references and copies canonical metadata from storage_objects.';

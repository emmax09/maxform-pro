-- "validated" means allowlist, metadata, and magic-byte validation passed.
-- It deliberately does not claim that an antivirus scan occurred.

ALTER TABLE storage_objects
  DROP CONSTRAINT IF EXISTS storage_objects_scan_status_check;

UPDATE storage_objects
SET scan_status = 'validated',
    updated_at = NOW()
WHERE scan_status = 'clean';

ALTER TABLE storage_objects
  ADD CONSTRAINT storage_objects_scan_status_check
  CHECK (scan_status IN ('pending', 'validated', 'quarantined'));

ALTER TABLE workspace_files
  DROP CONSTRAINT IF EXISTS workspace_files_scan_status_check;

UPDATE workspace_files
SET scan_status = 'validated',
    updated_at = NOW()
WHERE scan_status = 'clean';

ALTER TABLE workspace_files
  ALTER COLUMN scan_status SET DEFAULT 'validated',
  ADD CONSTRAINT workspace_files_scan_status_check
  CHECK (scan_status IN ('pending', 'validated', 'quarantined'));

CREATE OR REPLACE FUNCTION maxform_normalize_file_validation_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.scan_status = 'clean' THEN
    NEW.scan_status := 'validated';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_normalize_file_validation_status
  ON workspace_files;

CREATE TRIGGER trg_normalize_file_validation_status
BEFORE INSERT OR UPDATE OF scan_status
ON workspace_files
FOR EACH ROW
EXECUTE FUNCTION maxform_normalize_file_validation_status();

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

REVOKE EXECUTE ON FUNCTION maxform_secure_submission_storage_reference()
  FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'maxform_browser') THEN
    REVOKE EXECUTE ON FUNCTION maxform_secure_submission_storage_reference()
      FROM maxform_browser;
  END IF;
END
$$;

COMMENT ON COLUMN storage_objects.scan_status IS
  'Validation gate: pending, validated, or quarantined. Validated is not an antivirus claim.';

COMMENT ON COLUMN workspace_files.scan_status IS
  'Validation gate: pending, validated, or quarantined. Validated is not an antivirus claim.';

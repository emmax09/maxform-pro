-- Run only after:
--   npm run storage:migrate
--   npm run storage:verify
--
-- This finalizer is intentionally fail-closed. It will not remove the legacy
-- columns while a single database payload or known embedded data URL remains.

DO $$
DECLARE
  remaining BIGINT;
BEGIN
  SELECT
    (SELECT COUNT(*) FROM form_submission_files
      WHERE content_data IS NOT NULL)
    +
    (SELECT COUNT(*) FROM workspace_files
      WHERE content_data IS NOT NULL)
    +
    (SELECT COUNT(*) FROM profiles
      WHERE avatar_url LIKE '%data:%;base64,%')
    +
    (SELECT COUNT(*) FROM company_settings
      WHERE company_logo_url LIKE '%data:%;base64,%')
    +
    (SELECT COUNT(*) FROM payment_products
      WHERE image_url LIKE '%data:%;base64,%')
    +
    (SELECT COUNT(*) FROM forms
      WHERE fields::text LIKE '%data:%;base64,%'
         OR settings::text LIKE '%data:%;base64,%')
    +
    (SELECT COUNT(*) FROM form_fields
      WHERE options::text LIKE '%data:%;base64,%'
         OR config::text LIKE '%data:%;base64,%')
    +
    (SELECT COUNT(*) FROM form_settings
      WHERE theme::text LIKE '%data:%;base64,%'
         OR live_snapshot::text LIKE '%data:%;base64,%')
    +
    (SELECT COUNT(*) FROM form_versions
      WHERE fields::text LIKE '%data:%;base64,%')
    +
    (SELECT COUNT(*) FROM events
      WHERE branding::text LIKE '%data:%;base64,%'
         OR public_sections::text LIKE '%data:%;base64,%'
         OR section_content::text LIKE '%data:%;base64,%'
         OR seo::text LIKE '%data:%;base64,%'
         OR settings::text LIKE '%data:%;base64,%')
    +
    (SELECT COUNT(*) FROM event_ticket_designs
      WHERE front_layout::text LIKE '%data:%;base64,%'
         OR back_layout::text LIKE '%data:%;base64,%')
    +
    (SELECT COUNT(*) FROM event_ticket_design_templates
      WHERE created_by IS NOT NULL
        AND (
          theme::text LIKE '%data:%;base64,%'
          OR front_layout::text LIKE '%data:%;base64,%'
          OR back_layout::text LIKE '%data:%;base64,%'
        ))
    +
    (SELECT COUNT(*) FROM email_templates
      WHERE blocks::text LIKE '%data:%;base64,%'
         OR html_body LIKE '%data:%;base64,%')
  INTO remaining;

  IF remaining > 0 THEN
    RAISE EXCEPTION
      'R2 storage finalization blocked: % legacy payload row(s) remain.',
      remaining;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM form_submission_files file
    LEFT JOIN storage_objects object ON object.id = file.storage_object_id
    WHERE file.storage_object_id IS NULL
       OR file.storage_provider IS DISTINCT FROM 'r2'
       OR object.id IS NULL
       OR object.status IS DISTINCT FROM 'ready'
       OR object.scan_status IS DISTINCT FROM 'validated'
  ) THEN
    RAISE EXCEPTION
      'R2 storage finalization blocked: a form file has no ready R2 object.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM workspace_files file
    LEFT JOIN storage_objects object ON object.id = file.storage_object_id
    WHERE file.storage_object_id IS NULL
       OR file.storage_provider IS DISTINCT FROM 'r2'
       OR object.id IS NULL
       OR object.status IS DISTINCT FROM 'ready'
       OR object.scan_status IS DISTINCT FROM 'validated'
  ) THEN
    RAISE EXCEPTION
      'R2 storage finalization blocked: a workspace file has no ready R2 object.';
  END IF;
END
$$;

DROP TRIGGER IF EXISTS trg_catalog_submission_file
  ON form_submission_files;

ALTER TABLE form_submission_files
  DROP CONSTRAINT IF EXISTS form_submission_files_storage_reference_check;

ALTER TABLE workspace_files
  DROP CONSTRAINT IF EXISTS workspace_files_storage_reference_check;

ALTER TABLE form_submission_files
  DROP COLUMN content_data;

ALTER TABLE workspace_files
  DROP COLUMN content_data;

ALTER TABLE form_submission_files
  ADD CONSTRAINT form_submission_files_storage_reference_check
  CHECK (
    storage_object_id IS NOT NULL
    AND storage_provider = 'r2'
    AND NULLIF(object_key, '') IS NOT NULL
  );

ALTER TABLE workspace_files
  ADD CONSTRAINT workspace_files_storage_reference_check
  CHECK (
    storage_object_id IS NOT NULL
    AND storage_provider = 'r2'
    AND NULLIF(storage_key, '') IS NOT NULL
  );

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
    user_id, name, mime_type, size_bytes, storage_key,
    storage_object_id, storage_provider, file_url, etag, checksum_sha256,
    source_type, source_id, source_label, uploaded_by, scan_status,
    created_at, updated_at
  )
  VALUES (
    owner_id, NEW.file_name, NEW.mime_type, NEW.file_size,
    'forms/' || NEW.id::text,
    NEW.storage_object_id, NEW.storage_provider, NEW.file_url, NEW.etag,
    NEW.checksum_sha256,
    CASE WHEN source_event_id IS NULL THEN 'form_upload' ELSE 'event_upload' END,
    NEW.submission_id,
    CASE WHEN source_event_id IS NULL
      THEN 'Form: ' || COALESCE(NULLIF(source_form_title, ''), 'Untitled form')
      ELSE 'Event: ' || COALESCE(NULLIF(source_event_title, ''), 'Untitled event')
    END,
    owner_id, 'validated', NEW.created_at, NEW.created_at
  )
  ON CONFLICT (user_id, storage_key) DO UPDATE SET
    name = EXCLUDED.name,
    mime_type = EXCLUDED.mime_type,
    size_bytes = EXCLUDED.size_bytes,
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

CREATE TRIGGER trg_catalog_submission_file
AFTER INSERT OR UPDATE OF
  file_name, mime_type, file_size, storage_object_id, object_key,
  storage_provider, file_url, etag, checksum_sha256
ON form_submission_files
FOR EACH ROW
EXECUTE FUNCTION maxform_catalog_submission_file();

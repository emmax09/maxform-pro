-- Keep all R2 object identifiers and operational metadata server-only.
-- This migration is separate because 052 may already have been applied.

DROP TRIGGER IF EXISTS trg_secure_submission_storage_reference
  ON form_submission_files;

CREATE TRIGGER trg_secure_submission_storage_reference
BEFORE INSERT OR UPDATE OF
  form_id, field_id, file_name, mime_type, file_size, storage_object_id,
  object_key, storage_provider, file_url, etag, checksum_sha256
ON form_submission_files
FOR EACH ROW
EXECUTE FUNCTION maxform_secure_submission_storage_reference();

DROP FUNCTION IF EXISTS maxform_replace_pending_submission_content(
  UUID, UUID, UUID, JSONB, TEXT, JSONB
);

CREATE OR REPLACE FUNCTION maxform_replace_pending_submission_content(
  requested_form_id UUID,
  requested_client_key UUID,
  replacement_data JSONB,
  replacement_user_agent TEXT,
  replacement_files JSONB
)
RETURNS TABLE (
  id UUID,
  submitted_at TIMESTAMPTZ,
  submission_status TEXT,
  payment_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  authorized_submission_id UUID;
BEGIN
  SELECT submission.id
  INTO authorized_submission_id
  FROM form_submissions submission
  JOIN forms form ON form.id = submission.form_id
  WHERE submission.form_id = requested_form_id
    AND submission.client_submission_key = requested_client_key
    AND COALESCE(
      submission.data #>> '{_meta,status}',
      'completed'
    ) = 'pending_payment'
    AND form.status = 'published'
    AND COALESCE(form.settings->>'lifecycle', 'active') = 'active'
  FOR UPDATE OF submission;

  IF authorized_submission_id IS NULL THEN
    RAISE EXCEPTION 'The pending submission cannot be replaced.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE form_submissions submission
  SET data = replacement_data,
      submitted_at = NOW(),
      user_agent = LEFT(COALESCE(replacement_user_agent, ''), 500)
  WHERE submission.id = authorized_submission_id;

  DELETE FROM form_submission_answers answer
  WHERE answer.submission_id = authorized_submission_id;

  INSERT INTO form_submission_answers (
    submission_id, field_id, answer, updated_at
  )
  SELECT authorized_submission_id, item.key, item.value, NOW()
  FROM jsonb_each(replacement_data) item(key, value)
  WHERE item.key <> '_meta';

  DELETE FROM form_submission_files file
  WHERE file.submission_id = authorized_submission_id;

  INSERT INTO form_submission_files (
    id, submission_id, form_id, field_id, file_kind, file_name,
    mime_type, file_size, storage_object_id
  )
  SELECT
    (file.value->>'id')::uuid,
    authorized_submission_id,
    requested_form_id,
    file.value->>'fieldId',
    file.value->>'fileKind',
    file.value->>'fileName',
    file.value->>'mimeType',
    (file.value->>'fileSize')::integer,
    (file.value->>'storageObjectId')::uuid
  FROM jsonb_array_elements(COALESCE(replacement_files, '[]'::jsonb))
    file(value);

  RETURN QUERY
  SELECT
    submission.id,
    submission.submitted_at,
    COALESCE(
      submission.data #>> '{_meta,status}',
      'completed'
    ) AS submission_status,
    COALESCE(
      submission.data #>> '{_meta,paymentStatus}',
      ''
    ) AS payment_status
  FROM form_submissions submission
  WHERE submission.id = authorized_submission_id;
END
$$;

DO $$
BEGIN
  REVOKE EXECUTE ON FUNCTION maxform_secure_submission_storage_reference()
    FROM PUBLIC;
  REVOKE EXECUTE ON FUNCTION maxform_replace_pending_submission_content(
    UUID, UUID, JSONB, TEXT, JSONB
  ) FROM PUBLIC;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'maxform_browser') THEN
    REVOKE ALL ON TABLE storage_objects FROM maxform_browser;
    REVOKE ALL ON TABLE storage_upload_sessions FROM maxform_browser;
    REVOKE ALL ON TABLE storage_upload_rate_limits FROM maxform_browser;
    REVOKE ALL ON TABLE storage_audit_events FROM maxform_browser;
    REVOKE ALL ON TABLE crm_attachments FROM maxform_browser;
    REVOKE ALL ON TABLE form_submission_files FROM maxform_browser;
    REVOKE ALL ON TABLE workspace_files FROM maxform_browser;
    GRANT SELECT (
      id, submission_id, form_id, field_id, file_kind, file_name,
      mime_type, file_size, storage_object_id, created_at
    ) ON form_submission_files TO maxform_browser;
    GRANT INSERT (
      id, submission_id, form_id, field_id, file_kind, file_name,
      mime_type, file_size, storage_object_id
    ) ON form_submission_files TO maxform_browser;
    GRANT EXECUTE ON FUNCTION maxform_replace_pending_submission_content(
      UUID, UUID, JSONB, TEXT, JSONB
    ) TO maxform_browser;
    REVOKE EXECUTE ON FUNCTION maxform_secure_submission_storage_reference()
      FROM maxform_browser;
    REVOKE EXECUTE ON FUNCTION maxform_catalog_submission_file()
      FROM maxform_browser;
  END IF;
END
$$;

COMMENT ON TABLE form_submission_files IS
  'Form file references with browser access limited to safe columns. Private R2 metadata is copied by a security trigger and is not browser-readable.';

COMMENT ON TABLE workspace_files IS
  'Server-only file catalog metadata. Private R2 keys must never be queried directly by browser roles.';

COMMENT ON FUNCTION maxform_replace_pending_submission_content(
  UUID, UUID, JSONB, TEXT, JSONB
) IS
  'Capability-scoped replacement for a respondent-owned pending payment submission.';

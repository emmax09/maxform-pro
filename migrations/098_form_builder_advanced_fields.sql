-- Advanced, structured form blocks. Their per-field settings remain in the
-- existing JSONB config column and their answers remain JSONB, so this change
-- only widens the normalized field type constraints.

ALTER TABLE form_fields
  DROP CONSTRAINT IF EXISTS form_fields_field_type_check;

ALTER TABLE form_fields
  ADD CONSTRAINT form_fields_field_type_check
  CHECK (field_type IN (
    'shortText', 'longText', 'email', 'phone', 'number', 'url', 'password',
    'dropdown', 'multiSelect', 'radio', 'checkboxes', 'yesNo', 'rating',
    'scale', 'ranking', 'matrix', 'date', 'time', 'dateRange', 'appointment',
    'file', 'multipleFiles', 'imageChoice', 'signature', 'camera', 'section',
    'pageBreak', 'heading', 'divider', 'html', 'address', 'location',
    'product', 'coupon', 'hidden', 'calculated'
  ));

ALTER TABLE form_template_fields
  DROP CONSTRAINT IF EXISTS form_template_fields_field_type_check;

ALTER TABLE form_template_fields
  ADD CONSTRAINT form_template_fields_field_type_check
  CHECK (field_type IN (
    'shortText', 'longText', 'email', 'phone', 'number', 'url', 'password',
    'dropdown', 'multiSelect', 'radio', 'checkboxes', 'yesNo', 'rating',
    'scale', 'ranking', 'matrix', 'date', 'time', 'dateRange', 'appointment',
    'file', 'multipleFiles', 'imageChoice', 'signature', 'camera', 'section',
    'pageBreak', 'heading', 'divider', 'html', 'address', 'location',
    'product', 'coupon', 'hidden', 'calculated'
  ));

COMMENT ON COLUMN form_fields.config IS
  'Field-specific JSON configuration, including matrix rows, upload limits, media, product choices, and block styling';

-- Keep the storage authorization trigger aligned with the new multi-file
-- block. The remaining checks continue to bind each object to its workspace,
-- form, field, private visibility, scan result, and durable R2 record.
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
        AND field.field_type IN ('file', 'multipleFiles', 'camera', 'signature')
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

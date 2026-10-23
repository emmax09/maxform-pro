ALTER TABLE form_fields
  ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE form_template_fields
  ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS form_submission_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id UUID NOT NULL REFERENCES form_submissions(id) ON DELETE CASCADE,
  form_id UUID NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  field_id TEXT NOT NULL,
  file_kind TEXT NOT NULL CHECK (file_kind IN ('file', 'signature')),
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL CHECK (file_size >= 0 AND file_size <= 10485760),
  content_data TEXT NOT NULL CHECK (content_data LIKE 'data:%'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (submission_id, field_id)
);

CREATE INDEX IF NOT EXISTS idx_form_submission_files_submission
  ON form_submission_files(submission_id);

CREATE INDEX IF NOT EXISTS idx_form_submission_files_form
  ON form_submission_files(form_id, created_at DESC);

ALTER TABLE form_submission_files
  DROP CONSTRAINT IF EXISTS form_submission_files_content_data_check;

ALTER TABLE form_submission_files
  ADD CONSTRAINT form_submission_files_content_data_check
  CHECK (
    octet_length(content_data) <= 13982000
    AND content_data ~ '^data:[a-zA-Z0-9.+-]+/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/]+={0,2}$'
    AND file_size = octet_length(
      decode(split_part(content_data, ',', 2), 'base64')
    )
  );

DELETE FROM form_fields WHERE field_type = 'payment';
DELETE FROM form_template_fields WHERE field_type = 'payment';

UPDATE forms form
SET fields = COALESCE(
  (
    SELECT jsonb_agg(field.value ORDER BY field.ordinality)
    FROM jsonb_array_elements(COALESCE(form.fields, '[]'::jsonb))
      WITH ORDINALITY field(value, ordinality)
    WHERE field.value->>'type' <> 'payment'
  ),
  '[]'::jsonb
)
WHERE COALESCE(form.fields, '[]'::jsonb) @>
  '[{"type":"payment"}]'::jsonb;

UPDATE form_versions version
SET fields = COALESCE(
  (
    SELECT jsonb_agg(field.value ORDER BY field.ordinality)
    FROM jsonb_array_elements(COALESCE(version.fields, '[]'::jsonb))
      WITH ORDINALITY field(value, ordinality)
    WHERE field.value->>'type' <> 'payment'
  ),
  '[]'::jsonb
)
WHERE COALESCE(version.fields, '[]'::jsonb) @>
  '[{"type":"payment"}]'::jsonb;

UPDATE form_settings settings
SET live_snapshot = jsonb_set(
  settings.live_snapshot,
  '{fields}',
  COALESCE(
    (
      SELECT jsonb_agg(field.value ORDER BY field.ordinality)
      FROM jsonb_array_elements(
        COALESCE(settings.live_snapshot->'fields', '[]'::jsonb)
      ) WITH ORDINALITY field(value, ordinality)
      WHERE field.value->>'type' <> 'payment'
    ),
    '[]'::jsonb
  )
)
WHERE settings.live_snapshot IS NOT NULL
  AND COALESCE(settings.live_snapshot->'fields', '[]'::jsonb) @>
    '[{"type":"payment"}]'::jsonb;

ALTER TABLE form_fields
  DROP CONSTRAINT IF EXISTS form_fields_field_type_check;

ALTER TABLE form_fields
  ADD CONSTRAINT form_fields_field_type_check
  CHECK (field_type IN (
    'shortText', 'longText', 'email', 'phone', 'number', 'url',
    'dropdown', 'radio', 'checkboxes', 'yesNo', 'rating', 'ranking',
    'date', 'time', 'dateRange', 'appointment', 'file', 'imageChoice',
    'signature', 'camera', 'section', 'pageBreak', 'heading', 'divider',
    'product', 'coupon', 'hidden', 'calculated'
  ));

ALTER TABLE form_template_fields
  DROP CONSTRAINT IF EXISTS form_template_fields_field_type_check;

ALTER TABLE form_template_fields
  ADD CONSTRAINT form_template_fields_field_type_check
  CHECK (field_type IN (
    'shortText', 'longText', 'email', 'phone', 'number', 'url',
    'dropdown', 'radio', 'checkboxes', 'yesNo', 'rating', 'ranking',
    'date', 'time', 'dateRange', 'appointment', 'file', 'imageChoice',
    'signature', 'camera', 'section', 'pageBreak', 'heading', 'divider',
    'product', 'coupon', 'hidden', 'calculated'
  ));

COMMENT ON TABLE form_submission_files IS
  'Durable file and signature payloads linked to normalized form submissions';

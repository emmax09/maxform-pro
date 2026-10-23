CREATE TABLE IF NOT EXISTS form_fields (
  form_id UUID NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  field_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  field_type VARCHAR(40) NOT NULL CHECK (field_type IN ('shortText', 'longText', 'email', 'phone', 'number', 'url', 'dropdown', 'radio', 'checkboxes', 'yesNo', 'rating', 'ranking', 'date', 'time', 'dateRange', 'appointment', 'file', 'imageChoice', 'signature', 'camera', 'section', 'pageBreak', 'heading', 'divider', 'payment', 'product', 'coupon', 'hidden', 'calculated')),
  label TEXT NOT NULL,
  placeholder TEXT,
  help_text TEXT,
  required BOOLEAN NOT NULL DEFAULT FALSE,
  options JSONB,
  default_value TEXT,
  formula TEXT,
  width VARCHAR(10) CHECK (width IS NULL OR width IN ('full', 'half')),
  validation JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (form_id, field_id)
);

CREATE TABLE IF NOT EXISTS form_settings (
  form_id UUID PRIMARY KEY REFERENCES forms(id) ON DELETE CASCADE,
  theme JSONB NOT NULL DEFAULT '{}',
  payment JSONB NOT NULL DEFAULT '{}',
  confirmation JSONB NOT NULL DEFAULT '{}',
  notifications JSONB NOT NULL DEFAULT '{}',
  access_control JSONB NOT NULL DEFAULT '{}',
  limits_config JSONB NOT NULL DEFAULT '{}',
  schedule JSONB NOT NULL DEFAULT '{}',
  lifecycle VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active', 'paused')),
  current_version INTEGER NOT NULL DEFAULT 0 CHECK (current_version >= 0),
  live_snapshot JSONB,
  has_unpublished_changes BOOLEAN NOT NULL DEFAULT FALSE,
  archived_from_status VARCHAR(20) CHECK (archived_from_status IS NULL OR archived_from_status IN ('draft', 'published')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS form_logic_rules (
  form_id UUID NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  rule_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  source_field_id TEXT NOT NULL,
  operator VARCHAR(30) NOT NULL CHECK (operator IN ('equals', 'not_equals', 'contains', 'greater_than', 'less_than', 'is_answered')),
  comparison_value TEXT NOT NULL DEFAULT '',
  action VARCHAR(20) NOT NULL CHECK (action IN ('show', 'hide', 'skip_to', 'require')),
  target_field_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (form_id, rule_id)
);

CREATE TABLE IF NOT EXISTS form_versions (
  form_id UUID NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  version_id TEXT NOT NULL,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  published_at TIMESTAMPTZ NOT NULL,
  published_by TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  fields JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (form_id, version_id),
  UNIQUE (form_id, version_number)
);

CREATE TABLE IF NOT EXISTS form_templates (
  id TEXT PRIMARY KEY,
  group_name TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  payment JSONB,
  image_path TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS form_template_fields (
  template_id TEXT NOT NULL REFERENCES form_templates(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  field_type VARCHAR(40) NOT NULL CHECK (field_type IN ('shortText', 'longText', 'email', 'phone', 'number', 'url', 'dropdown', 'radio', 'checkboxes', 'yesNo', 'rating', 'ranking', 'date', 'time', 'dateRange', 'appointment', 'file', 'imageChoice', 'signature', 'camera', 'section', 'pageBreak', 'heading', 'divider', 'payment', 'product', 'coupon', 'hidden', 'calculated')),
  label TEXT NOT NULL,
  placeholder TEXT,
  help_text TEXT,
  required BOOLEAN NOT NULL DEFAULT FALSE,
  options JSONB,
  default_value TEXT,
  formula TEXT,
  width VARCHAR(10) CHECK (width IS NULL OR width IN ('full', 'half')),
  validation JSONB,
  PRIMARY KEY (template_id, position)
);

CREATE TABLE IF NOT EXISTS form_submission_answers (
  submission_id UUID NOT NULL REFERENCES form_submissions(id) ON DELETE CASCADE,
  field_id TEXT NOT NULL,
  answer JSONB NOT NULL DEFAULT 'null',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (submission_id, field_id)
);

CREATE INDEX IF NOT EXISTS idx_form_fields_form_position ON form_fields(form_id, position);

CREATE INDEX IF NOT EXISTS idx_form_logic_form_position ON form_logic_rules(form_id, position);

CREATE INDEX IF NOT EXISTS idx_form_versions_form_version ON form_versions(form_id, version_number DESC);

CREATE INDEX IF NOT EXISTS idx_form_templates_active_order ON form_templates(active, sort_order);

CREATE INDEX IF NOT EXISTS idx_submission_answers_submission ON form_submission_answers(submission_id);

ALTER TABLE form_fields DROP CONSTRAINT IF EXISTS form_fields_form_id_position_key;

ALTER TABLE form_logic_rules DROP CONSTRAINT IF EXISTS form_logic_rules_form_id_position_key;

INSERT INTO form_fields (form_id, field_id, position, field_type, label, placeholder, help_text, required, options, default_value, formula, width, validation)
SELECT form.id, field.value->>'id', (field.ordinality - 1)::integer, field.value->>'type', COALESCE(field.value->>'label', ''), field.value->>'placeholder', field.value->>'helpText', COALESCE((field.value->>'required')::boolean, FALSE), field.value->'options', field.value->>'defaultValue', field.value->>'formula', field.value->>'width', field.value->'validation'
FROM forms AS form
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(form.fields, '[]'::jsonb)) WITH ORDINALITY AS field(value, ordinality)
WHERE COALESCE(field.value->>'id', '') <> ''
ON CONFLICT (form_id, field_id) DO UPDATE SET position = EXCLUDED.position, field_type = EXCLUDED.field_type, label = EXCLUDED.label, placeholder = EXCLUDED.placeholder, help_text = EXCLUDED.help_text, required = EXCLUDED.required, options = EXCLUDED.options, default_value = EXCLUDED.default_value, formula = EXCLUDED.formula, width = EXCLUDED.width, validation = EXCLUDED.validation, updated_at = NOW();

INSERT INTO form_settings (form_id, theme, payment, confirmation, notifications, access_control, limits_config, schedule, lifecycle, current_version, live_snapshot, has_unpublished_changes, archived_from_status)
SELECT form.id, COALESCE(form.settings->'theme', '{}'::jsonb), COALESCE(form.settings->'payment', '{}'::jsonb), COALESCE(form.settings->'confirmation', '{}'::jsonb), COALESCE(form.settings->'notifications', '{}'::jsonb), COALESCE(form.settings->'access', '{}'::jsonb), COALESCE(form.settings->'limits', '{}'::jsonb), COALESCE(form.settings->'schedule', '{}'::jsonb), COALESCE(NULLIF(form.settings->>'lifecycle', ''), 'active'), COALESCE((form.settings->>'version')::integer, 0), form.settings->'liveSnapshot', COALESCE((form.settings->>'hasUnpublishedChanges')::boolean, FALSE), NULLIF(form.settings->>'archivedFromStatus', '')
FROM forms AS form
ON CONFLICT (form_id) DO UPDATE SET theme = EXCLUDED.theme, payment = EXCLUDED.payment, confirmation = EXCLUDED.confirmation, notifications = EXCLUDED.notifications, access_control = EXCLUDED.access_control, limits_config = EXCLUDED.limits_config, schedule = EXCLUDED.schedule, lifecycle = EXCLUDED.lifecycle, current_version = EXCLUDED.current_version, live_snapshot = EXCLUDED.live_snapshot, has_unpublished_changes = EXCLUDED.has_unpublished_changes, archived_from_status = EXCLUDED.archived_from_status, updated_at = NOW();

INSERT INTO form_logic_rules (form_id, rule_id, position, source_field_id, operator, comparison_value, action, target_field_id)
SELECT form.id, rule.value->>'id', (rule.ordinality - 1)::integer, rule.value->>'sourceFieldId', rule.value->>'operator', COALESCE(rule.value->>'value', ''), rule.value->>'action', rule.value->>'targetFieldId'
FROM forms AS form
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(form.settings->'logic', '[]'::jsonb)) WITH ORDINALITY AS rule(value, ordinality)
WHERE COALESCE(rule.value->>'id', '') <> ''
ON CONFLICT (form_id, rule_id) DO UPDATE SET position = EXCLUDED.position, source_field_id = EXCLUDED.source_field_id, operator = EXCLUDED.operator, comparison_value = EXCLUDED.comparison_value, action = EXCLUDED.action, target_field_id = EXCLUDED.target_field_id, updated_at = NOW();

INSERT INTO form_versions (form_id, version_id, version_number, published_at, published_by, title, description, fields)
SELECT form.id, version.value->>'id', (version.value->>'version')::integer, (version.value->>'publishedAt')::timestamptz, COALESCE(version.value->>'publishedBy', ''), COALESCE(version.value->>'title', form.title), COALESCE(version.value->>'description', ''), COALESCE(version.value->'fields', '[]'::jsonb)
FROM forms AS form
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(form.settings->'versions', '[]'::jsonb)) AS version(value)
WHERE COALESCE(version.value->>'id', '') <> ''
ON CONFLICT (form_id, version_id) DO UPDATE SET version_number = EXCLUDED.version_number, published_at = EXCLUDED.published_at, published_by = EXCLUDED.published_by, title = EXCLUDED.title, description = EXCLUDED.description, fields = EXCLUDED.fields;

INSERT INTO form_submission_answers (submission_id, field_id, answer)
SELECT submission.id, answer.key, answer.value
FROM form_submissions AS submission
CROSS JOIN LATERAL jsonb_each(COALESCE(submission.data, '{}'::jsonb)) AS answer(key, value)
WHERE answer.key <> '_meta'
ON CONFLICT (submission_id, field_id) DO UPDATE SET answer = EXCLUDED.answer, updated_at = NOW();

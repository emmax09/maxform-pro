ALTER TABLE event_ticket_design_templates
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS source_template_id TEXT
    REFERENCES event_ticket_design_templates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_event_ticket_design_templates_owner
  ON event_ticket_design_templates(created_by, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_ticket_design_templates_override
  ON event_ticket_design_templates(created_by, source_template_id)
  WHERE created_by IS NOT NULL AND source_template_id IS NOT NULL;

ALTER TABLE event_ticket_design_templates
  DROP CONSTRAINT IF EXISTS event_ticket_design_templates_front_qr_required;

ALTER TABLE event_ticket_design_templates
  ADD CONSTRAINT event_ticket_design_templates_front_qr_required
  CHECK (front_layout @> '[{"type":"qr"}]'::jsonb);

ALTER TABLE event_ticket_designs
  DROP CONSTRAINT IF EXISTS event_ticket_designs_front_qr_required;

ALTER TABLE event_ticket_designs
  ADD CONSTRAINT event_ticket_designs_front_qr_required
  CHECK (front_layout @> '[{"type":"qr"}]'::jsonb);

COMMENT ON COLUMN event_ticket_design_templates.created_by IS
  'NULL for system templates and set for workspace-owned templates and overrides.';

COMMENT ON COLUMN event_ticket_design_templates.source_template_id IS
  'System template replaced by this workspace-owned editable override.';

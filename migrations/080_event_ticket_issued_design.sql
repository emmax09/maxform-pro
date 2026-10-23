-- Keep the ticket artwork that was actually issued with each attendee.
-- Editing an event's active design must not rewrite tickets already sold.

ALTER TABLE event_attendees
  ADD COLUMN IF NOT EXISTS issued_design_id UUID
    REFERENCES event_ticket_designs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS issued_template_id TEXT,
  ADD COLUMN IF NOT EXISTS issued_theme JSONB,
  ADD COLUMN IF NOT EXISTS issued_front_layout JSONB,
  ADD COLUMN IF NOT EXISTS issued_back_layout JSONB,
  ADD COLUMN IF NOT EXISTS issued_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_event_attendees_issued_design
  ON event_attendees(event_id, issued_at)
  WHERE issued_at IS NOT NULL;

-- Existing issued tickets did not have a snapshot column. Capture the design
-- currently associated with each still-valid ticket once, without changing
-- the active event design or the ticket's signed code.
WITH resolved AS (
  SELECT attendee.id AS attendee_id,
    design.id AS design_id,
    design.template_id,
    COALESCE(design.theme, template.theme, '{}'::jsonb) AS theme,
    design.front_layout,
    design.back_layout,
    attendee.updated_at
  FROM event_attendees attendee
  LEFT JOIN LATERAL (
    SELECT saved_design.id, saved_design.template_id, saved_design.theme,
      saved_design.front_layout, saved_design.back_layout
    FROM event_ticket_designs saved_design
    WHERE saved_design.event_id = attendee.event_id
      AND (
        saved_design.ticket_type_id = attendee.ticket_type_id
        OR saved_design.ticket_type_id IS NULL
      )
    ORDER BY
      CASE WHEN saved_design.ticket_type_id = attendee.ticket_type_id
        THEN 0 ELSE 1 END,
      saved_design.updated_at DESC
    LIMIT 1
  ) design ON TRUE
  LEFT JOIN event_ticket_design_templates template
    ON template.id = design.template_id
  WHERE attendee.ticket_code IS NOT NULL
    AND attendee.ticket_status IN ('valid', 'transferred')
    AND attendee.issued_at IS NULL
)
UPDATE event_attendees attendee
SET issued_design_id = resolved.design_id,
    issued_template_id = resolved.template_id,
    issued_theme = resolved.theme,
    issued_front_layout = resolved.front_layout,
    issued_back_layout = resolved.back_layout,
    issued_at = COALESCE(resolved.updated_at, NOW())
FROM resolved
WHERE attendee.id = resolved.attendee_id;

COMMENT ON COLUMN event_attendees.issued_design_id IS
  'The event ticket design row used when this ticket was issued.';
COMMENT ON COLUMN event_attendees.issued_template_id IS
  'The reusable template identifier captured at issuance time.';
COMMENT ON COLUMN event_attendees.issued_theme IS
  'Immutable event ticket theme snapshot captured at issuance time.';
COMMENT ON COLUMN event_attendees.issued_front_layout IS
  'Immutable front ticket layout snapshot captured at issuance time.';
COMMENT ON COLUMN event_attendees.issued_back_layout IS
  'Immutable back ticket layout snapshot captured at issuance time.';

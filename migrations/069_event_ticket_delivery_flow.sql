-- Freeze event-scoped ticket artwork and repair registration field ordering for
-- events published before the current ticket delivery flow was introduced.

-- A saved event design must be a snapshot. Otherwise a later edit to the
-- reusable workspace template can change an already-published event ticket.
UPDATE event_ticket_designs design
SET theme = template.theme,
    updated_at = NOW()
FROM event_ticket_design_templates template
WHERE design.template_id = template.id
  AND design.theme IS NULL;

-- Ticketing events created before event design initialization receive the same
-- blank starting design used by the current event save path. Existing designs
-- are never overwritten.
INSERT INTO event_ticket_designs (
  event_id, template_id, theme, front_layout, back_layout, barcode_format,
  output_formats, created_at, updated_at
)
SELECT event.id,
  COALESCE(workspace_template.id, system_template.id),
  COALESCE(workspace_template.theme, system_template.theme),
  COALESCE(workspace_template.front_layout, system_template.front_layout),
  COALESCE(workspace_template.back_layout, system_template.back_layout),
  'qr', '["digital", "pdf"]'::jsonb, NOW(), NOW()
FROM events event
JOIN event_ticket_design_templates system_template
  ON system_template.id = 'studio-blank'
LEFT JOIN event_ticket_design_templates workspace_template
  ON workspace_template.created_by = event.created_by
 AND workspace_template.source_template_id = system_template.id
 AND workspace_template.active = TRUE
WHERE event.ticketing_enabled = TRUE
  AND NOT EXISTS (
    SELECT 1
    FROM event_ticket_designs design
    WHERE design.event_id = event.id
      AND design.ticket_type_id IS NULL
  );

-- The selector belongs immediately before the final form action. Keep every
-- authored field in its relative order and move only the reserved ticket field.
UPDATE forms form
SET fields = (
  SELECT COALESCE(
    jsonb_agg(
      item.value
      ORDER BY (item.value->>'id' = 'ticket-selection')::integer,
        item.ordinality
    ),
    '[]'::jsonb
  )
  FROM jsonb_array_elements(form.fields) WITH ORDINALITY AS item(value, ordinality)
),
updated_at = NOW()
WHERE EXISTS (
    SELECT 1
    FROM events event
    WHERE event.registration_form_id = form.id
      AND event.ticketing_enabled = TRUE
  )
  AND form.fields @> '[{"id":"ticket-selection"}]'::jsonb;

UPDATE form_settings settings
SET live_snapshot = jsonb_set(
      settings.live_snapshot,
      '{fields}',
      (
        SELECT COALESCE(
          jsonb_agg(
            item.value
            ORDER BY (item.value->>'id' = 'ticket-selection')::integer,
              item.ordinality
          ),
          '[]'::jsonb
        )
        FROM jsonb_array_elements(settings.live_snapshot->'fields')
          WITH ORDINALITY AS item(value, ordinality)
      ),
      TRUE
    ),
    updated_at = NOW()
WHERE settings.live_snapshot IS NOT NULL
  AND settings.live_snapshot ? 'fields'
  AND EXISTS (
    SELECT 1
    FROM events event
    WHERE event.registration_form_id = settings.form_id
      AND event.ticketing_enabled = TRUE
  )
  AND settings.live_snapshot->'fields'
    @> '[{"id":"ticket-selection"}]'::jsonb;

COMMENT ON COLUMN event_ticket_designs.theme IS
  'Event-scoped theme snapshot; reusable template edits do not alter an active event ticket';

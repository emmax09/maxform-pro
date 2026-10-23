-- Reference designs previously used authored labels such as "VIP Pass" and
-- "Floor GA" in their badge and stub. Those labels must be dynamic so the
-- issued ticket always shows the tier the attendee actually purchased.

WITH normalized_templates AS (
  SELECT
    template.id,
    jsonb_agg(
      CASE
        WHEN element.value->>'id' IN ('pass-badge', 'stub-type')
          AND element.value->>'type' = 'custom_text'
        THEN element.value
          || '{"type":"ticket_type","label":"Ticket type"}'::jsonb
          || jsonb_build_object(
            'style',
            COALESCE(element.value->'style', '{}'::jsonb)
              || '{"hideCaption":true}'::jsonb
          )
        ELSE element.value
      END
      ORDER BY element.position
    ) AS front_layout
  FROM event_ticket_design_templates template
  CROSS JOIN LATERAL jsonb_array_elements(template.front_layout)
    WITH ORDINALITY AS element(value, position)
  GROUP BY template.id
)
UPDATE event_ticket_design_templates template
SET front_layout = normalized.front_layout,
    updated_at = NOW()
FROM normalized_templates normalized
WHERE template.id = normalized.id
  AND template.front_layout IS DISTINCT FROM normalized.front_layout;

WITH normalized_designs AS (
  SELECT
    design.id,
    jsonb_agg(
      CASE
        WHEN element.value->>'id' IN ('pass-badge', 'stub-type')
          AND element.value->>'type' = 'custom_text'
        THEN element.value
          || '{"type":"ticket_type","label":"Ticket type"}'::jsonb
          || jsonb_build_object(
            'style',
            COALESCE(element.value->'style', '{}'::jsonb)
              || '{"hideCaption":true}'::jsonb
          )
        ELSE element.value
      END
      ORDER BY element.position
    ) AS front_layout
  FROM event_ticket_designs design
  CROSS JOIN LATERAL jsonb_array_elements(design.front_layout)
    WITH ORDINALITY AS element(value, position)
  GROUP BY design.id
)
UPDATE event_ticket_designs design
SET front_layout = normalized.front_layout,
    updated_at = NOW()
FROM normalized_designs normalized
WHERE design.id = normalized.id
  AND design.front_layout IS DISTINCT FROM normalized.front_layout;

COMMENT ON COLUMN event_ticket_designs.front_layout IS
  'Event ticket canvas. ticket_type blocks resolve to the purchased event_ticket_type name at render time.';

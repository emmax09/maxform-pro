-- Bring built-in ticket templates in line with the MaxForm jacket orange.
-- Keep workspace-owned templates and their custom layouts unchanged.

UPDATE event_ticket_design_templates
SET theme = REPLACE(theme::text, '#F97316', '#F93D0A')::jsonb,
    front_layout = REPLACE(front_layout::text, '#F97316', '#F93D0A')::jsonb,
    back_layout = REPLACE(back_layout::text, '#F97316', '#F93D0A')::jsonb,
    updated_at = NOW()
WHERE created_by IS NULL
  AND (
    theme::text LIKE '%#F97316%'
    OR front_layout::text LIKE '%#F97316%'
    OR back_layout::text LIKE '%#F97316%'
  );

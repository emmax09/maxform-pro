-- A deliberately minimal system template for events that want to build a
-- ticket from scratch. The QR block remains required for secure check-in;
-- every other block can be added in the ticket designer.
INSERT INTO event_ticket_design_templates (
  id, name, category, description, theme, front_layout, back_layout, sort_order
)
VALUES (
  'scratch-blank',
  'Start from scratch',
  'Blank',
  'A clean canvas with only the required secure QR block.',
  '{"background":"#FFFFFF","accent":"#65758B","text":"#18181B","muted":"#71717A","edge":"solid","motif":"none"}'::jsonb,
  '[{"id":"qr","type":"qr","label":"Secure QR","x":78,"y":36,"width":16,"style":{"hideCaption":true}}]'::jsonb,
  '[]'::jsonb,
  5
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  theme = EXCLUDED.theme,
  front_layout = EXCLUDED.front_layout,
  back_layout = EXCLUDED.back_layout,
  sort_order = EXCLUDED.sort_order,
  active = TRUE,
  updated_at = NOW();

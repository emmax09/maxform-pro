ALTER TABLE event_ticket_designs
  ADD COLUMN IF NOT EXISTS theme JSONB;

COMMENT ON COLUMN event_ticket_designs.theme IS
  'Optional event-scoped theme override. Reusable workspace ticket templates remain unchanged.';

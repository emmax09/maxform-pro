ALTER TABLE events
  ADD COLUMN IF NOT EXISTS event_code TEXT;

ALTER TABLE events
  ALTER COLUMN event_code
  SET DEFAULT ('EVT-' || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::text, '-', '') FROM 1 FOR 10)));

UPDATE events
SET event_code = 'EVT-' || UPPER(SUBSTRING(REPLACE(id::text, '-', '') FROM 1 FOR 10))
WHERE event_code IS NULL OR TRIM(event_code) = '';

ALTER TABLE events
  ALTER COLUMN event_code SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_event_code
  ON events(event_code);

ALTER TABLE events
  DROP CONSTRAINT IF EXISTS events_event_code_format;

ALTER TABLE events
  ADD CONSTRAINT events_event_code_format
  CHECK (event_code ~ '^EVT-[A-Z0-9]{10}$');

ALTER TABLE event_attendees
  ADD COLUMN IF NOT EXISTS ticket_number TEXT;

ALTER TABLE event_attendees
  ALTER COLUMN ticket_number
  SET DEFAULT ('TKT-' || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::text, '-', '') FROM 1 FOR 16)));

UPDATE event_attendees
SET ticket_number = 'TKT-' || UPPER(SUBSTRING(REPLACE(id::text, '-', '') FROM 1 FOR 16))
WHERE ticket_number IS NULL OR TRIM(ticket_number) = '';

ALTER TABLE event_attendees
  ALTER COLUMN ticket_number SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_attendees_ticket_number
  ON event_attendees(ticket_number);

ALTER TABLE event_attendees
  DROP CONSTRAINT IF EXISTS event_attendees_ticket_number_format;

ALTER TABLE event_attendees
  ADD CONSTRAINT event_attendees_ticket_number_format
  CHECK (ticket_number ~ '^TKT-[A-Z0-9]{16}$');

COMMENT ON COLUMN events.event_code IS
  'Stable public event identity used on published ticketing surfaces';

COMMENT ON COLUMN event_attendees.ticket_number IS
  'Readable database-issued identity unique to one attendee ticket';

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS ticket_prefix TEXT,
  ADD COLUMN IF NOT EXISTS ticket_prefix_configured BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE events
  ALTER COLUMN ticket_prefix
  SET DEFAULT (
    'EV' ||
    UPPER(SUBSTRING(REPLACE(gen_random_uuid()::text, '-', '') FROM 1 FOR 6)) ||
    '-'
  );

UPDATE events
SET ticket_prefix =
  'EV' || UPPER(SUBSTRING(REPLACE(event_code, 'EVT-', '') FROM 1 FOR 6)) || '-'
WHERE ticket_prefix IS NULL OR TRIM(ticket_prefix) = '';

UPDATE events event
SET ticket_prefix_configured = TRUE
WHERE event.ticketing_enabled = TRUE
  AND EXISTS (
    SELECT 1
    FROM event_attendees attendee
    WHERE attendee.event_id = event.id
  );

ALTER TABLE events
  ALTER COLUMN ticket_prefix SET NOT NULL;

ALTER TABLE events
  DROP CONSTRAINT IF EXISTS events_ticket_prefix_format;

ALTER TABLE events
  ADD CONSTRAINT events_ticket_prefix_format
  CHECK (ticket_prefix ~ '^[A-Z0-9]{2,12}-$');

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_owner_ticket_prefix
  ON events(created_by, ticket_prefix);

ALTER TABLE event_attendees
  ALTER COLUMN ticket_number DROP DEFAULT;

ALTER TABLE event_attendees
  DROP CONSTRAINT IF EXISTS event_attendees_ticket_number_format;

ALTER TABLE event_attendees
  ADD CONSTRAINT event_attendees_ticket_number_format
  CHECK (ticket_number ~ '^[A-Z0-9]{2,12}-[A-Z0-9]{12,16}$');

CREATE OR REPLACE FUNCTION maxform_assign_event_ticket_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $maxform$
DECLARE
  event_prefix TEXT;
BEGIN
  IF NEW.ticket_number IS NOT NULL AND TRIM(NEW.ticket_number) <> '' THEN
    RETURN NEW;
  END IF;

  SELECT ticket_prefix
  INTO event_prefix
  FROM events
  WHERE id = NEW.event_id;

  IF event_prefix IS NULL THEN
    RAISE EXCEPTION 'The event ticket prefix is not configured';
  END IF;

  NEW.ticket_number :=
    event_prefix ||
    UPPER(SUBSTRING(REPLACE(gen_random_uuid()::text, '-', '') FROM 1 FOR 12));

  RETURN NEW;
END;
$maxform$;

DROP TRIGGER IF EXISTS maxform_assign_event_ticket_number
  ON event_attendees;

CREATE TRIGGER maxform_assign_event_ticket_number
BEFORE INSERT ON event_attendees
FOR EACH ROW
EXECUTE FUNCTION maxform_assign_event_ticket_number();

COMMENT ON COLUMN events.ticket_prefix IS
  'Organizer-configured prefix used only for tickets issued by this event';

COMMENT ON COLUMN events.ticket_prefix_configured IS
  'Confirms the organizer reviewed the event ticket prefix before publishing';

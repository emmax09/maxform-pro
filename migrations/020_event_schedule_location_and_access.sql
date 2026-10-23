ALTER TABLE events
  ADD COLUMN IF NOT EXISTS schedule_type TEXT,
  ADD COLUMN IF NOT EXISTS event_date DATE,
  ADD COLUMN IF NOT EXISTS venue_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS invite_token TEXT,
  ADD COLUMN IF NOT EXISTS invite_message TEXT NOT NULL DEFAULT '';

UPDATE events
SET schedule_type = CASE
  WHEN ends_at IS NULL THEN 'single_day'
  ELSE 'date_range'
END
WHERE schedule_type IS NULL;

UPDATE events
SET event_date = starts_at::date
WHERE schedule_type = 'single_day'
  AND event_date IS NULL
  AND starts_at IS NOT NULL;

UPDATE events
SET invite_token =
  LOWER(SUBSTRING(REPLACE(gen_random_uuid()::text, '-', '') FROM 1 FOR 24))
WHERE invite_token IS NULL OR TRIM(invite_token) = '';

ALTER TABLE events
  ALTER COLUMN schedule_type SET DEFAULT 'single_day',
  ALTER COLUMN schedule_type SET NOT NULL,
  ALTER COLUMN invite_token SET DEFAULT
    LOWER(SUBSTRING(REPLACE(gen_random_uuid()::text, '-', '') FROM 1 FOR 24)),
  ALTER COLUMN invite_token SET NOT NULL;

ALTER TABLE events
  DROP CONSTRAINT IF EXISTS events_schedule_type_check;

ALTER TABLE events
  ADD CONSTRAINT events_schedule_type_check
  CHECK (schedule_type IN ('single_day', 'date_range'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_invite_token
  ON events(invite_token);

COMMENT ON COLUMN events.event_date IS
  'Calendar-only date used when schedule_type is single_day';

COMMENT ON COLUMN events.venue_name IS
  'Named physical venue, stored separately from its street address';

COMMENT ON COLUMN events.invite_token IS
  'Opaque token used by invite-only public event links';

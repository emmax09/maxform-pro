ALTER TABLE events
  ADD COLUMN IF NOT EXISTS range_start_date DATE,
  ADD COLUMN IF NOT EXISTS range_end_date DATE,
  ADD COLUMN IF NOT EXISTS range_schedule_mode TEXT NOT NULL DEFAULT 'continuous',
  ADD COLUMN IF NOT EXISTS schedule_start_time TIME,
  ADD COLUMN IF NOT EXISTS schedule_end_time TIME,
  ADD COLUMN IF NOT EXISTS daily_schedule JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE events
SET
  range_start_date = COALESCE(range_start_date, starts_at::date),
  range_end_date = COALESCE(range_end_date, ends_at::date),
  schedule_start_time = COALESCE(schedule_start_time, starts_at::time),
  schedule_end_time = COALESCE(schedule_end_time, ends_at::time)
WHERE schedule_type = 'date_range';

UPDATE events
SET
  event_date = COALESCE(event_date, starts_at::date),
  schedule_start_time = COALESCE(schedule_start_time, starts_at::time),
  schedule_end_time = COALESCE(schedule_end_time, ends_at::time)
WHERE schedule_type = 'single_day';

ALTER TABLE events
  DROP CONSTRAINT IF EXISTS events_range_schedule_mode_check;

ALTER TABLE events
  ADD CONSTRAINT events_range_schedule_mode_check
  CHECK (range_schedule_mode IN ('continuous', 'daily'));

ALTER TABLE events
  DROP CONSTRAINT IF EXISTS events_daily_schedule_array_check;

ALTER TABLE events
  ADD CONSTRAINT events_daily_schedule_array_check
  CHECK (JSONB_TYPEOF(daily_schedule) = 'array');

COMMENT ON COLUMN events.range_schedule_mode IS
  'Whether a multi-day event runs continuously or defines times per calendar day';

COMMENT ON COLUMN events.daily_schedule IS
  'Per-day start and end times for date-range events using daily scheduling';

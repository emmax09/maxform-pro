-- Appointments module.
--
-- The module shipped as a static mock: booking pages, bookings and integration
-- cards were all hardcoded in the client. This introduces the real schema so
-- everything the module shows is workspace data that survives a reload.
--
-- Ownership follows the rest of the product — `user_id REFERENCES users(id)` —
-- rather than a `workspaces` table, which does not exist in this database.

-- A booking page is one bookable offering: "Intro call", "Product demo".
CREATE TABLE IF NOT EXISTS booking_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  duration_minutes INTEGER NOT NULL DEFAULT 30
    CHECK (duration_minutes BETWEEN 5 AND 1440),
  -- video | phone | in_person | ask_invitee
  location_type TEXT NOT NULL DEFAULT 'video',
  location_detail TEXT NOT NULL DEFAULT '',
  -- Which connected provider mints the meeting link for a video booking.
  video_provider TEXT NOT NULL DEFAULT '',
  -- single | round_robin | collective | group
  scheduling_type TEXT NOT NULL DEFAULT 'single',
  -- Group bookings admit more than one invitee to the same slot.
  capacity INTEGER NOT NULL DEFAULT 1 CHECK (capacity > 0),
  -- Booking form fields, sharing the Forms field model.
  questions JSONB NOT NULL DEFAULT '[]',
  branding JSONB NOT NULL DEFAULT '{}',
  hosts JSONB NOT NULL DEFAULT '[]',
  price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  color TEXT NOT NULL DEFAULT '#635BFF',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_booking_pages_owner
  ON booking_pages(user_id, status, updated_at DESC);

-- Routing forms qualify a visitor before any time slot is shown, then send
-- them to the booking page their answers point at.
CREATE TABLE IF NOT EXISTS routing_forms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  -- Same field model as Forms, so the existing builder canvas can edit it.
  questions JSONB NOT NULL DEFAULT '[]',
  -- [{ id, field, operator, value, bookingPageId }] evaluated in order.
  routing_rules JSONB NOT NULL DEFAULT '[]',
  fallback_booking_page_id UUID REFERENCES booking_pages(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_routing_forms_owner
  ON routing_forms(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  booking_page_id UUID REFERENCES booking_pages(id) ON DELETE SET NULL,
  routing_form_id UUID REFERENCES routing_forms(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  invitee_name TEXT NOT NULL DEFAULT '',
  invitee_email TEXT NOT NULL DEFAULT '',
  invitee_timezone TEXT NOT NULL DEFAULT 'UTC',
  host_name TEXT NOT NULL DEFAULT '',
  host_email TEXT NOT NULL DEFAULT '',
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  -- confirmed | cancelled | rescheduled | completed | no_show
  status TEXT NOT NULL DEFAULT 'confirmed',
  location_type TEXT NOT NULL DEFAULT 'video',
  meeting_url TEXT NOT NULL DEFAULT '',
  answers JSONB NOT NULL DEFAULT '{}',
  payment_status TEXT NOT NULL DEFAULT 'not_required',
  amount_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  cancel_reason TEXT NOT NULL DEFAULT '',
  -- 'calendly' / 'cal_com' when pushed in by the migration bridge, else ''.
  external_source TEXT NOT NULL DEFAULT '',
  external_id TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_appointments_owner_time
  ON appointments(user_id, starts_at DESC);
CREATE INDEX IF NOT EXISTS idx_appointments_page
  ON appointments(booking_page_id, starts_at DESC);
-- A bridged booking must not be imported twice when a webhook is retried.
CREATE UNIQUE INDEX IF NOT EXISTS idx_appointments_external
  ON appointments(user_id, external_source, external_id)
  WHERE external_id <> '';

-- One row per weekday per owner, plus the scheduling guardrails.
CREATE TABLE IF NOT EXISTS appointment_availability (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  -- { mon: [{ start: "09:00", end: "17:00" }], ... }
  weekly_hours JSONB NOT NULL DEFAULT '{}',
  buffer_before_minutes INTEGER NOT NULL DEFAULT 0 CHECK (buffer_before_minutes >= 0),
  buffer_after_minutes INTEGER NOT NULL DEFAULT 0 CHECK (buffer_after_minutes >= 0),
  minimum_notice_minutes INTEGER NOT NULL DEFAULT 240 CHECK (minimum_notice_minutes >= 0),
  maximum_advance_days INTEGER NOT NULL DEFAULT 60 CHECK (maximum_advance_days > 0),
  daily_booking_cap INTEGER NOT NULL DEFAULT 0 CHECK (daily_booking_cap >= 0),
  slot_interval_minutes INTEGER NOT NULL DEFAULT 30 CHECK (slot_interval_minutes > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS appointment_blackout_dates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_on >= starts_on)
);

CREATE INDEX IF NOT EXISTS idx_appointment_blackouts_owner
  ON appointment_blackout_dates(user_id, starts_on);

-- Calendar sync, video conferencing, and the Calendly/Cal.com bridge all store
-- a connection the same way, so health and disconnect behave identically.
CREATE TABLE IF NOT EXISTS scheduling_tool_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- google_calendar | outlook | zoom | google_meet | teams | calendly | cal_com
  provider TEXT NOT NULL,
  -- calendar | video | scheduling
  category TEXT NOT NULL DEFAULT 'calendar',
  credentials_encrypted JSONB NOT NULL DEFAULT '{}',
  account_label TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'connected',
  health_ok BOOLEAN NOT NULL DEFAULT TRUE,
  last_error TEXT NOT NULL DEFAULT '',
  last_synced_at TIMESTAMPTZ,
  -- Secret used to authenticate inbound Calendly/Cal.com webhooks.
  webhook_secret_hash TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, provider)
);

CREATE TABLE IF NOT EXISTS embed_widgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_page_id UUID NOT NULL REFERENCES booking_pages(id) ON DELETE CASCADE,
  -- iframe | js_widget | link
  embed_type TEXT NOT NULL DEFAULT 'iframe',
  settings JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (booking_page_id, embed_type)
);

-- View-to-booked conversion needs the denominator, so a page open is recorded
-- separately from the booking it may or may not become.
CREATE TABLE IF NOT EXISTS booking_page_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_page_id UUID NOT NULL REFERENCES booking_pages(id) ON DELETE CASCADE,
  viewed_on DATE NOT NULL DEFAULT CURRENT_DATE,
  views INTEGER NOT NULL DEFAULT 0,
  UNIQUE (booking_page_id, viewed_on)
);

-- Why a day is closed, not just that it is.
--
-- "Unavailable" on its own tells a teammate nothing and tells the owner nothing
-- three months later. A reason per weekday — picked from a short list or typed —
-- makes the schedule self-explanatory, and gives blackout ranges the same
-- vocabulary through `appointment_blackout_dates.reason`, which already exists.
ALTER TABLE appointment_availability
  ADD COLUMN IF NOT EXISTS day_reasons JSONB NOT NULL DEFAULT '{}';

-- Blackout ranges carry the same picked category alongside the free text, so a
-- calendar can group "public holiday" days without re-reading prose.
ALTER TABLE appointment_blackout_dates
  ADD COLUMN IF NOT EXISTS reason_type TEXT NOT NULL DEFAULT 'other';

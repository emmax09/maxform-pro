CREATE TABLE IF NOT EXISTS event_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  image_path TEXT,
  event_defaults JSONB NOT NULL DEFAULT '{}',
  ticket_design JSONB NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  registration_form_id UUID REFERENCES forms(id) ON DELETE SET NULL,
  template_id TEXT REFERENCES event_templates(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'on_sale', 'sold_out', 'past', 'cancelled')),
  location_type TEXT NOT NULL DEFAULT 'physical'
    CHECK (location_type IN ('physical', 'online', 'hybrid')),
  address TEXT NOT NULL DEFAULT '',
  online_url TEXT NOT NULL DEFAULT '',
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  branding JSONB NOT NULL DEFAULT '{}',
  public_sections JSONB NOT NULL DEFAULT '[]',
  seo JSONB NOT NULL DEFAULT '{}',
  capacity_total INTEGER CHECK (capacity_total IS NULL OR capacity_total > 0),
  refund_policy TEXT NOT NULL DEFAULT '',
  refund_window_hours INTEGER NOT NULL DEFAULT 0 CHECK (refund_window_hours >= 0),
  access_control TEXT NOT NULL DEFAULT 'public'
    CHECK (access_control IN ('public', 'invite_only', 'password')),
  access_password_hash TEXT,
  waitlist_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  settings JSONB NOT NULL DEFAULT '{}',
  published_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_owner_updated
  ON events(created_by, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_status
  ON events(created_by, status);
CREATE INDEX IF NOT EXISTS idx_events_registration_form
  ON events(registration_form_id);

CREATE TABLE IF NOT EXISTS event_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  capacity INTEGER CHECK (capacity IS NULL OR capacity > 0),
  location TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS idx_event_sessions_event
  ON event_sessions(event_id, sort_order);

CREATE TABLE IF NOT EXISTS event_ticket_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  quantity_available INTEGER NOT NULL DEFAULT 100 CHECK (quantity_available > 0),
  min_per_order INTEGER NOT NULL DEFAULT 1 CHECK (min_per_order > 0),
  max_per_order INTEGER NOT NULL DEFAULT 10 CHECK (max_per_order > 0),
  group_multiplier INTEGER NOT NULL DEFAULT 1 CHECK (group_multiplier > 0),
  sales_start TIMESTAMPTZ,
  sales_end TIMESTAMPTZ,
  waitlist_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  color TEXT NOT NULL DEFAULT '#2563EB',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (max_per_order >= min_per_order),
  CHECK (sales_end IS NULL OR sales_start IS NULL OR sales_end > sales_start)
);

CREATE INDEX IF NOT EXISTS idx_event_ticket_types_event
  ON event_ticket_types(event_id, sort_order);

CREATE TABLE IF NOT EXISTS event_ticket_designs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  ticket_type_id UUID REFERENCES event_ticket_types(id) ON DELETE CASCADE,
  template_id TEXT,
  front_layout JSONB NOT NULL DEFAULT '[]',
  back_layout JSONB NOT NULL DEFAULT '[]',
  barcode_format TEXT NOT NULL DEFAULT 'qr'
    CHECK (barcode_format IN ('qr', 'code128')),
  output_formats JSONB NOT NULL DEFAULT '["digital", "pdf"]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_ticket_design_default
  ON event_ticket_designs(event_id)
  WHERE ticket_type_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_ticket_design_variant
  ON event_ticket_designs(event_id, ticket_type_id)
  WHERE ticket_type_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS event_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
  purchaser_name TEXT NOT NULL DEFAULT '',
  purchaser_email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'complimentary', 'refunded', 'cancelled')),
  subtotal NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  fees NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (fees >= 0),
  total_amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  source TEXT NOT NULL DEFAULT 'direct',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_orders_event
  ON event_orders(event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_orders_email
  ON event_orders(event_id, purchaser_email);

CREATE TABLE IF NOT EXISTS event_attendees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  order_id UUID REFERENCES event_orders(id) ON DELETE SET NULL,
  ticket_type_id UUID REFERENCES event_ticket_types(id) ON DELETE SET NULL,
  registration_submission_id UUID REFERENCES form_submissions(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  ticket_status TEXT NOT NULL DEFAULT 'valid'
    CHECK (ticket_status IN ('valid', 'void', 'refunded', 'transferred')),
  ticket_code TEXT UNIQUE,
  code_version INTEGER NOT NULL DEFAULT 1 CHECK (code_version > 0),
  transferred_from UUID REFERENCES event_attendees(id) ON DELETE SET NULL,
  void_reason TEXT,
  checked_in_at TIMESTAMPTZ,
  checked_in_by UUID REFERENCES users(id) ON DELETE SET NULL,
  answers JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_attendees_event
  ON event_attendees(event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_attendees_email
  ON event_attendees(event_id, email);
CREATE INDEX IF NOT EXISTS idx_event_attendees_checkin
  ON event_attendees(event_id, checked_in_at);

CREATE TABLE IF NOT EXISTS event_ticket_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  attendee_id UUID REFERENCES event_attendees(id) ON DELETE SET NULL,
  result TEXT NOT NULL
    CHECK (result IN (
      'valid', 'already_used', 'refunded', 'void', 'wrong_event',
      'invalid_signature', 'manual_override', 'offline_conflict'
    )),
  scanned_by UUID REFERENCES users(id) ON DELETE SET NULL,
  station TEXT NOT NULL DEFAULT '',
  offline_queued BOOLEAN NOT NULL DEFAULT FALSE,
  override_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (result <> 'manual_override' OR NULLIF(TRIM(override_reason), '') IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_event_ticket_scans_event
  ON event_ticket_scans(event_id, scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_event_ticket_scans_attendee
  ON event_ticket_scans(attendee_id, scanned_at DESC);

CREATE TABLE IF NOT EXISTS event_waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  ticket_type_id UUID REFERENCES event_ticket_types(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position > 0),
  status TEXT NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'invited', 'converted', 'expired', 'removed')),
  invited_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, ticket_type_id, email)
);

CREATE TABLE IF NOT EXISTS event_staff_assignments (
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL DEFAULT 'event.checkin'
    CHECK (permission IN ('event.manage', 'event.checkin', 'event.analytics')),
  station TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (event_id, user_id, permission)
);

INSERT INTO event_templates (
  id, name, category, description, image_path, event_defaults, ticket_design, sort_order
)
VALUES
  (
    'conference-summit',
    'Conference & Summit',
    'Business',
    'A polished multi-session conference with speaker, agenda, and sponsor sections.',
    '/images/form-templates/events-ticketing.webp',
    '{"locationType":"hybrid","sections":["about","agenda","speakers","sponsors","faq","venue"]}'::jsonb,
    '{"accentColor":"#2563EB","surfaceColor":"#EFF6FF","template":"conference"}'::jsonb,
    10
  ),
  (
    'concert-live',
    'Concert & Live Music',
    'Entertainment',
    'A high-energy ticketed show with lineup, venue, and sponsor sections.',
    '/images/form-templates/events-ticketing.webp',
    '{"locationType":"physical","sections":["about","speakers","sponsors","venue","faq"]}'::jsonb,
    '{"accentColor":"#DC2626","surfaceColor":"#18181B","template":"concert"}'::jsonb,
    20
  ),
  (
    'gala-formal',
    'Gala & Formal',
    'Social',
    'An elegant guest registration flow for dinners, awards, and fundraising evenings.',
    '/images/form-templates/commerce.webp',
    '{"locationType":"physical","sections":["about","agenda","sponsors","venue","faq"]}'::jsonb,
    '{"accentColor":"#A16207","surfaceColor":"#FFFBEB","template":"gala"}'::jsonb,
    30
  ),
  (
    'workshop-class',
    'Workshop & Class',
    'Education',
    'Capacity-aware registration for training, workshops, and cohort sessions.',
    '/images/form-templates/people-hiring.webp',
    '{"locationType":"physical","sections":["about","agenda","speakers","venue","faq"]}'::jsonb,
    '{"accentColor":"#059669","surfaceColor":"#ECFDF5","template":"workshop"}'::jsonb,
    40
  ),
  (
    'community-casual',
    'Community & Casual',
    'Community',
    'A friendly RSVP experience for meetups, celebrations, and local gatherings.',
    '/images/form-templates/lead-feedback.webp',
    '{"locationType":"physical","sections":["about","agenda","venue","faq"]}'::jsonb,
    '{"accentColor":"#0891B2","surfaceColor":"#ECFEFF","template":"community"}'::jsonb,
    50
  ),
  (
    'blank-event',
    'Start from blank',
    'Blank',
    'Begin with an empty event and shape every detail yourself.',
    '/images/form-templates/operations.webp',
    '{"locationType":"physical","sections":["about","venue","faq"]}'::jsonb,
    '{"accentColor":"#65758B","surfaceColor":"#F8FAFC","template":"blank"}'::jsonb,
    90
  )
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  image_path = EXCLUDED.image_path,
  event_defaults = EXCLUDED.event_defaults,
  ticket_design = EXCLUDED.ticket_design,
  active = TRUE,
  sort_order = EXCLUDED.sort_order,
  updated_at = NOW();

COMMENT ON TABLE events IS
  'Workspace events linked to a canonical MaxForm registration form.';
COMMENT ON COLUMN event_attendees.ticket_code IS
  'Server-issued HMAC-signed ticket token. Never generated in the browser.';
COMMENT ON TABLE event_ticket_scans IS
  'Append-only audit trail for scanner decisions and manual overrides.';

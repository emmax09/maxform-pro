CREATE TABLE IF NOT EXISTS event_pricing (
  event_id UUID PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  label TEXT NOT NULL DEFAULT 'Registration fee',
  sales_start TIMESTAMPTZ,
  sales_end TIMESTAMPTZ,
  tax_included BOOLEAN NOT NULL DEFAULT FALSE,
  discounts_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (sales_end IS NULL OR sales_start IS NULL OR sales_end > sales_start)
);

CREATE TABLE IF NOT EXISTS event_discount_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mode TEXT NOT NULL
    CHECK (mode IN ('first_n', 'date_window', 'promo_code', 'group_size')),
  value_type TEXT NOT NULL
    CHECK (value_type IN ('percentage', 'fixed')),
  discount_value NUMERIC(14, 2) NOT NULL CHECK (discount_value > 0),
  first_n INTEGER NOT NULL DEFAULT 0 CHECK (first_n >= 0),
  min_quantity INTEGER NOT NULL DEFAULT 1 CHECK (min_quantity > 0),
  promo_code TEXT NOT NULL DEFAULT '',
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  redemption_limit INTEGER CHECK (redemption_limit IS NULL OR redemption_limit > 0),
  active BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (value_type <> 'percentage' OR discount_value <= 100),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at),
  CHECK (mode <> 'first_n' OR first_n > 0),
  CHECK (mode <> 'group_size' OR min_quantity > 1),
  CHECK (mode <> 'promo_code' OR LENGTH(TRIM(promo_code)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_event_discount_rules_event
  ON event_discount_rules(event_id, sort_order, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_discount_rules_code
  ON event_discount_rules(event_id, UPPER(promo_code))
  WHERE mode = 'promo_code' AND promo_code <> '';

COMMENT ON TABLE event_pricing IS
  'Database-backed registration pricing for events that may not issue tickets';

COMMENT ON TABLE event_discount_rules IS
  'Event-scoped registration discount rules evaluated by the future payment module';

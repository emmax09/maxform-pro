ALTER TABLE event_pricing
  ADD COLUMN IF NOT EXISTS coupons_enabled BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN event_pricing.coupons_enabled IS
  'Whether this event checkout accepts centrally managed coupon codes.';

ALTER TABLE payment_coupons
  ADD COLUMN IF NOT EXISTS direct_target JSONB;

COMMENT ON COLUMN payment_coupons.direct_target IS
  'The exact form or event builder that created this coupon, when applicable.';

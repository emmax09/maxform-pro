CREATE TABLE IF NOT EXISTS payment_coupon_redemptions (
  order_id UUID PRIMARY KEY REFERENCES payment_orders(id) ON DELETE CASCADE,
  coupon_id UUID NOT NULL REFERENCES payment_coupons(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'redeemed', 'released')),
  expires_at TIMESTAMPTZ,
  redeemed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_coupon_redemptions_availability
  ON payment_coupon_redemptions(coupon_id, status, expires_at);

INSERT INTO payment_coupon_redemptions (
  order_id, coupon_id, status, redeemed_at, created_at, updated_at
)
SELECT payment_order.id, payment_order.coupon_id, 'redeemed',
       COALESCE(payment_order.paid_at, payment_order.updated_at),
       payment_order.created_at, NOW()
FROM payment_orders payment_order
WHERE payment_order.coupon_id IS NOT NULL
  AND payment_order.status IN (
    'paid', 'partially_refunded', 'refunded'
  )
ON CONFLICT (order_id) DO NOTHING;

CREATE OR REPLACE FUNCTION maxform_reserve_payment_coupon(
  requested_coupon_id UUID,
  requested_order_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $maxform$
DECLARE
  coupon_record payment_coupons%ROWTYPE;
  current_status TEXT;
  reserved_count INTEGER;
BEGIN
  SELECT coupon.*
  INTO coupon_record
  FROM payment_coupons coupon
  JOIN payment_orders payment_order
    ON payment_order.id = requested_order_id
   AND payment_order.coupon_id = coupon.id
   AND payment_order.user_id = coupon.user_id
  WHERE coupon.id = requested_coupon_id
    AND coupon.active = TRUE
    AND (coupon.starts_at IS NULL OR coupon.starts_at <= NOW())
    AND (coupon.ends_at IS NULL OR coupon.ends_at > NOW())
  FOR UPDATE OF coupon;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  SELECT status
  INTO current_status
  FROM payment_coupon_redemptions
  WHERE order_id = requested_order_id;

  IF current_status = 'redeemed' THEN
    RETURN TRUE;
  END IF;

  IF current_status = 'reserved' AND EXISTS (
    SELECT 1
    FROM payment_coupon_redemptions
    WHERE order_id = requested_order_id
      AND (expires_at IS NULL OR expires_at > NOW())
  ) THEN
    RETURN TRUE;
  END IF;

  SELECT COUNT(*)::integer
  INTO reserved_count
  FROM payment_coupon_redemptions
  WHERE coupon_id = requested_coupon_id
    AND status = 'reserved'
    AND (expires_at IS NULL OR expires_at > NOW())
    AND order_id <> requested_order_id;

  IF coupon_record.redemption_limit IS NOT NULL
     AND coupon_record.redemption_count + reserved_count
       >= coupon_record.redemption_limit THEN
    RETURN FALSE;
  END IF;

  INSERT INTO payment_coupon_redemptions (
    order_id, coupon_id, status, expires_at, redeemed_at,
    created_at, updated_at
  )
  VALUES (
    requested_order_id, requested_coupon_id, 'reserved',
    NOW() + INTERVAL '24 hours', NULL, NOW(), NOW()
  )
  ON CONFLICT (order_id)
  DO UPDATE SET
    coupon_id = EXCLUDED.coupon_id,
    status = 'reserved',
    expires_at = EXCLUDED.expires_at,
    redeemed_at = NULL,
    updated_at = NOW();

  RETURN TRUE;
END;
$maxform$;

CREATE OR REPLACE FUNCTION maxform_redeem_payment_coupon(
  requested_order_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $maxform$
DECLARE
  coupon_record payment_coupons%ROWTYPE;
  redemption_record payment_coupon_redemptions%ROWTYPE;
BEGIN
  SELECT coupon.*
  INTO coupon_record
  FROM payment_orders payment_order
  JOIN payment_coupons coupon ON coupon.id = payment_order.coupon_id
  WHERE payment_order.id = requested_order_id
    AND payment_order.user_id = coupon.user_id
  FOR UPDATE OF coupon;

  IF NOT FOUND THEN
    RETURN TRUE;
  END IF;

  SELECT *
  INTO redemption_record
  FROM payment_coupon_redemptions
  WHERE order_id = requested_order_id
  FOR UPDATE;

  IF FOUND AND redemption_record.status = 'redeemed' THEN
    RETURN TRUE;
  END IF;

  IF NOT FOUND
     OR redemption_record.status <> 'reserved'
     OR (
       redemption_record.expires_at IS NOT NULL
       AND redemption_record.expires_at <= NOW()
     ) THEN
    RETURN FALSE;
  END IF;

  UPDATE payment_coupon_redemptions
  SET status = 'redeemed',
      expires_at = NULL,
      redeemed_at = NOW(),
      updated_at = NOW()
  WHERE order_id = requested_order_id;

  UPDATE payment_coupons
  SET redemption_count = redemption_count + 1,
      updated_at = NOW()
  WHERE id = coupon_record.id;

  RETURN TRUE;
END;
$maxform$;

CREATE OR REPLACE FUNCTION maxform_release_payment_coupon(
  requested_order_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
AS $maxform$
BEGIN
  UPDATE payment_coupon_redemptions
  SET status = 'released',
      expires_at = NULL,
      updated_at = NOW()
  WHERE order_id = requested_order_id
    AND status = 'reserved';
END;
$maxform$;

COMMENT ON TABLE payment_coupon_redemptions IS
  'Order-scoped coupon reservations that prevent concurrent over-redemption';

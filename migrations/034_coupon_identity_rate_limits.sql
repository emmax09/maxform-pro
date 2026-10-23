ALTER TABLE payment_coupons
  ADD COLUMN IF NOT EXISTS redemption_limit_per_identity INTEGER
    CHECK (
      redemption_limit_per_identity IS NULL
      OR redemption_limit_per_identity > 0
    );

ALTER TABLE payment_coupon_redemptions
  ADD COLUMN IF NOT EXISTS ip_hash TEXT,
  ADD COLUMN IF NOT EXISTS device_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_ip_limit
  ON payment_coupon_redemptions(coupon_id, ip_hash, status)
  WHERE ip_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_device_limit
  ON payment_coupon_redemptions(coupon_id, device_hash, status)
  WHERE device_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION maxform_reserve_payment_coupon(
  requested_coupon_id UUID,
  requested_order_id UUID,
  requested_ip_hash TEXT,
  requested_device_hash TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $maxform$
DECLARE
  coupon_record payment_coupons%ROWTYPE;
  current_status TEXT;
  order_customer_email TEXT;
  reserved_count INTEGER;
  customer_redemption_count INTEGER;
  ip_redemption_count INTEGER;
  device_redemption_count INTEGER;
BEGIN
  SELECT LOWER(TRIM(payment_order.customer_email))
  INTO order_customer_email
  FROM payment_orders payment_order
  WHERE payment_order.id = requested_order_id;

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

  IF coupon_record.redemption_limit_per_customer IS NOT NULL THEN
    IF COALESCE(order_customer_email, '') = '' THEN
      RETURN FALSE;
    END IF;

    SELECT COUNT(*)::integer
    INTO customer_redemption_count
    FROM payment_coupon_redemptions redemption
    JOIN payment_orders payment_order ON payment_order.id = redemption.order_id
    WHERE redemption.coupon_id = requested_coupon_id
      AND LOWER(TRIM(payment_order.customer_email)) = order_customer_email
      AND (
        redemption.status = 'redeemed'
        OR (
          redemption.status = 'reserved'
          AND (redemption.expires_at IS NULL OR redemption.expires_at > NOW())
        )
      )
      AND redemption.order_id <> requested_order_id;

    IF customer_redemption_count
       >= coupon_record.redemption_limit_per_customer THEN
      RETURN FALSE;
    END IF;
  END IF;

  IF coupon_record.redemption_limit_per_identity IS NOT NULL THEN
    IF requested_ip_hash IS NOT NULL THEN
      SELECT COUNT(*)::integer
      INTO ip_redemption_count
      FROM payment_coupon_redemptions redemption
      WHERE redemption.coupon_id = requested_coupon_id
        AND redemption.ip_hash = requested_ip_hash
        AND (
          redemption.status = 'redeemed'
          OR (
            redemption.status = 'reserved'
            AND (redemption.expires_at IS NULL OR redemption.expires_at > NOW())
          )
        )
        AND redemption.order_id <> requested_order_id;
      IF ip_redemption_count >= coupon_record.redemption_limit_per_identity THEN
        RETURN FALSE;
      END IF;
    END IF;

    IF requested_device_hash IS NOT NULL THEN
      SELECT COUNT(*)::integer
      INTO device_redemption_count
      FROM payment_coupon_redemptions redemption
      WHERE redemption.coupon_id = requested_coupon_id
        AND redemption.device_hash = requested_device_hash
        AND (
          redemption.status = 'redeemed'
          OR (
            redemption.status = 'reserved'
            AND (redemption.expires_at IS NULL OR redemption.expires_at > NOW())
          )
        )
        AND redemption.order_id <> requested_order_id;
      IF device_redemption_count >= coupon_record.redemption_limit_per_identity THEN
        RETURN FALSE;
      END IF;
    END IF;
  END IF;

  INSERT INTO payment_coupon_redemptions (
    order_id, coupon_id, status, expires_at, redeemed_at, ip_hash, device_hash,
    created_at, updated_at
  )
  VALUES (
    requested_order_id, requested_coupon_id, 'reserved',
    NOW() + INTERVAL '24 hours', NULL, requested_ip_hash, requested_device_hash,
    NOW(), NOW()
  )
  ON CONFLICT (order_id)
  DO UPDATE SET
    coupon_id = EXCLUDED.coupon_id,
    status = 'reserved',
    expires_at = EXCLUDED.expires_at,
    redeemed_at = NULL,
    ip_hash = EXCLUDED.ip_hash,
    device_hash = EXCLUDED.device_hash,
    updated_at = NOW();

  RETURN TRUE;
END;
$maxform$;

COMMENT ON COLUMN payment_coupons.redemption_limit_per_identity IS
  'Maximum successful or active reserved uses from either one hashed IP address or one hashed browser device ID.';

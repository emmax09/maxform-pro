ALTER TABLE payment_refunds
  ADD COLUMN IF NOT EXISTS idempotency_key UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_refunds_idempotency
  ON payment_refunds(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION maxform_reserve_payment_refund(
  requested_user_id UUID,
  requested_order_id UUID,
  requested_refund_id UUID,
  requested_idempotency_key UUID,
  requested_amount NUMERIC,
  requested_reason TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $maxform$
DECLARE
  order_record payment_orders%ROWTYPE;
BEGIN
  SELECT *
  INTO order_record
  FROM payment_orders
  WHERE id = requested_order_id
    AND user_id = requested_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM payment_refunds
    WHERE user_id = requested_user_id
      AND idempotency_key = requested_idempotency_key
  ) THEN
    RETURN TRUE;
  END IF;

  IF order_record.status NOT IN ('paid', 'partially_refunded')
     OR order_record.provider IS NULL
     OR TRIM(order_record.provider_reference) = ''
     OR requested_amount <= 0
     OR requested_amount >
       order_record.total_amount - order_record.refunded_amount THEN
    RETURN FALSE;
  END IF;

  INSERT INTO payment_refunds (
    id, user_id, order_id, provider, provider_refund_id, amount, currency,
    reason, status, idempotency_key, requested_at, created_at, updated_at
  )
  VALUES (
    requested_refund_id, requested_user_id, requested_order_id,
    order_record.provider, '', requested_amount, order_record.currency,
    requested_reason, 'pending', requested_idempotency_key,
    NOW(), NOW(), NOW()
  );

  UPDATE payment_orders
  SET refunded_amount = refunded_amount + requested_amount,
      status = CASE
        WHEN refunded_amount + requested_amount >= total_amount
          THEN 'refunded'
        ELSE 'partially_refunded'
      END,
      updated_at = NOW()
  WHERE id = requested_order_id;

  RETURN TRUE;
END;
$maxform$;

CREATE OR REPLACE FUNCTION maxform_release_payment_refund(
  requested_refund_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
AS $maxform$
DECLARE
  refund_record payment_refunds%ROWTYPE;
BEGIN
  SELECT *
  INTO refund_record
  FROM payment_refunds
  WHERE id = requested_refund_id
  FOR UPDATE;

  IF NOT FOUND OR refund_record.status <> 'pending' THEN
    RETURN;
  END IF;

  UPDATE payment_refunds
  SET status = 'failed',
      failure_reason = 'Provider rejected the refund request',
      completed_at = NOW(),
      updated_at = NOW()
  WHERE id = requested_refund_id;

  UPDATE payment_orders
  SET refunded_amount = GREATEST(
        0,
        refunded_amount - refund_record.amount
      ),
      status = CASE
        WHEN GREATEST(0, refunded_amount - refund_record.amount) = 0
          THEN 'paid'
        ELSE 'partially_refunded'
      END,
      updated_at = NOW()
  WHERE id = refund_record.order_id;
END;
$maxform$;

COMMENT ON COLUMN payment_refunds.idempotency_key IS
  'Client-generated UUID that makes refund transport retries safe';

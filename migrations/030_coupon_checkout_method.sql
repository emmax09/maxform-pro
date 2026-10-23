-- Allow fully discounted public checkouts to complete without an external
-- payment provider while keeping provider connections, webhooks, and refunds
-- limited to real payment rails.

DO $payment_orders_provider_constraint$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT con.conname
  INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'payment_orders'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%provider%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE payment_orders DROP CONSTRAINT %I', constraint_name);
  END IF;

  ALTER TABLE payment_orders
    ADD CONSTRAINT payment_orders_provider_check
    CHECK (provider IS NULL OR provider IN ('stripe', 'paypal', 'paystack', 'opay', 'coupon'));
END;
$payment_orders_provider_constraint$;

DO $checkout_attempts_provider_constraint$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT con.conname
  INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'checkout_attempts'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%provider%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE checkout_attempts DROP CONSTRAINT %I', constraint_name);
  END IF;

  ALTER TABLE checkout_attempts
    ADD CONSTRAINT checkout_attempts_provider_check
    CHECK (provider IN ('stripe', 'paypal', 'paystack', 'opay', 'coupon'));
END;
$checkout_attempts_provider_constraint$;

DO $payments_provider_constraint$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT con.conname
  INTO constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  WHERE rel.relname = 'payments'
    AND con.contype = 'c'
    AND pg_get_constraintdef(con.oid) ILIKE '%provider%';

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE payments DROP CONSTRAINT %I', constraint_name);
  END IF;

  ALTER TABLE payments
    ADD CONSTRAINT payments_provider_check
    CHECK (provider IS NULL OR provider IN ('stripe', 'paypal', 'paystack', 'opay', 'coupon'));
END;
$payments_provider_constraint$;

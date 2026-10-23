CREATE TABLE IF NOT EXISTS payment_provider_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL
    CHECK (provider IN ('stripe', 'paypal', 'paystack', 'opay')),
  auth_type TEXT NOT NULL
    CHECK (auth_type IN ('oauth', 'api_key')),
  status TEXT NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'attention', 'disconnected')),
  external_account_id TEXT NOT NULL DEFAULT '',
  external_account_name TEXT NOT NULL DEFAULT '',
  credentials_encrypted TEXT NOT NULL,
  credential_hint TEXT NOT NULL DEFAULT '',
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  health_ok BOOLEAN NOT NULL DEFAULT TRUE,
  last_checked_at TIMESTAMPTZ,
  last_error TEXT NOT NULL DEFAULT '',
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, provider)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_provider_default
  ON payment_provider_connections(user_id)
  WHERE is_default = TRUE AND status = 'connected';

CREATE INDEX IF NOT EXISTS idx_payment_provider_health
  ON payment_provider_connections(user_id, status, health_ok);

CREATE TABLE IF NOT EXISTS payment_provider_oauth_states (
  state UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL
    CHECK (provider IN ('stripe', 'paypal')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_provider_oauth_expiry
  ON payment_provider_oauth_states(expires_at);

CREATE TABLE IF NOT EXISTS payment_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sku TEXT NOT NULL DEFAULT '',
  price NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'USD'
    CHECK (currency ~ '^[A-Z]{3}$'),
  billing_type TEXT NOT NULL DEFAULT 'one_time'
    CHECK (billing_type IN ('one_time', 'recurring')),
  billing_interval TEXT
    CHECK (billing_interval IS NULL OR billing_interval IN ('week', 'month', 'quarter', 'year')),
  source_type TEXT NOT NULL DEFAULT 'catalog'
    CHECK (source_type IN ('catalog', 'form', 'event', 'ticket_type')),
  source_id UUID,
  image_url TEXT NOT NULL DEFAULT '',
  tax_code TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_products_source
  ON payment_products(user_id, source_type, source_id)
  WHERE source_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_products_sku
  ON payment_products(user_id, UPPER(sku))
  WHERE sku <> '';

CREATE INDEX IF NOT EXISTS idx_payment_products_owner
  ON payment_products(user_id, active, updated_at DESC);

CREATE TABLE IF NOT EXISTS payment_coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  discount_type TEXT NOT NULL
    CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value NUMERIC(14, 2) NOT NULL CHECK (discount_value > 0),
  currency VARCHAR(3)
    CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  redemption_limit INTEGER CHECK (redemption_limit IS NULL OR redemption_limit > 0),
  redemption_count INTEGER NOT NULL DEFAULT 0 CHECK (redemption_count >= 0),
  minimum_amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (minimum_amount >= 0),
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  applies_to JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (discount_type <> 'percentage' OR discount_value <= 100),
  CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_coupons_code
  ON payment_coupons(user_id, UPPER(code));

CREATE TABLE IF NOT EXISTS payment_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_number TEXT NOT NULL,
  source_type TEXT NOT NULL
    CHECK (source_type IN ('form', 'event', 'invoice', 'manual', 'subscription')),
  source_id UUID,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL DEFAULT '',
  customer_email TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('draft', 'pending', 'processing', 'paid', 'failed', 'cancelled', 'partially_refunded', 'refunded')),
  provider TEXT
    CHECK (provider IS NULL OR provider IN ('stripe', 'paypal', 'paystack', 'opay')),
  provider_reference TEXT NOT NULL DEFAULT '',
  subtotal NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount_amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  tax_amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
  total_amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  refunded_amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'USD'
    CHECK (currency ~ '^[A-Z]{3}$'),
  coupon_id UUID REFERENCES payment_coupons(id) ON DELETE SET NULL,
  payment_method_summary TEXT NOT NULL DEFAULT '',
  failure_reason TEXT NOT NULL DEFAULT '',
  paid_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, order_number),
  CHECK (discount_amount <= subtotal + tax_amount),
  CHECK (refunded_amount <= total_amount)
);

CREATE INDEX IF NOT EXISTS idx_payment_orders_owner
  ON payment_orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_orders_status
  ON payment_orders(user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_orders_customer
  ON payment_orders(user_id, LOWER(customer_email));

CREATE TABLE IF NOT EXISTS payment_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES payment_orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES payment_products(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  total_amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_order_items_order
  ON payment_order_items(order_id);

CREATE TABLE IF NOT EXISTS payment_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id UUID REFERENCES payment_orders(id) ON DELETE SET NULL,
  invoice_number TEXT NOT NULL,
  customer_name TEXT NOT NULL DEFAULT '',
  customer_email TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'open', 'paid', 'overdue', 'void')),
  amount_due NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (amount_due >= 0),
  amount_paid NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'USD'
    CHECK (currency ~ '^[A-Z]{3}$'),
  due_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  memo TEXT NOT NULL DEFAULT '',
  line_items JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, invoice_number)
);

CREATE INDEX IF NOT EXISTS idx_payment_invoices_owner
  ON payment_invoices(user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS payment_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id UUID REFERENCES payment_products(id) ON DELETE SET NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  provider_connection_id UUID REFERENCES payment_provider_connections(id) ON DELETE SET NULL,
  provider_subscription_id TEXT NOT NULL DEFAULT '',
  customer_name TEXT NOT NULL DEFAULT '',
  customer_email TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('trialing', 'active', 'past_due', 'paused', 'cancelled', 'ended')),
  amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'USD'
    CHECK (currency ~ '^[A-Z]{3}$'),
  interval_unit TEXT NOT NULL DEFAULT 'month'
    CHECK (interval_unit IN ('week', 'month', 'quarter', 'year')),
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_subscriptions_owner
  ON payment_subscriptions(user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS payment_refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES payment_orders(id) ON DELETE CASCADE,
  provider TEXT NOT NULL
    CHECK (provider IN ('stripe', 'paypal', 'paystack', 'opay')),
  provider_refund_id TEXT NOT NULL DEFAULT '',
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  currency VARCHAR(3) NOT NULL DEFAULT 'USD'
    CHECK (currency ~ '^[A-Z]{3}$'),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'cancelled')),
  failure_reason TEXT NOT NULL DEFAULT '',
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_refunds_owner
  ON payment_refunds(user_id, status, requested_at DESC);

CREATE TABLE IF NOT EXISTS checkout_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL
    CHECK (provider IN ('stripe', 'paypal', 'paystack', 'opay')),
  source_type TEXT NOT NULL
    CHECK (source_type IN ('form', 'event', 'invoice', 'subscription')),
  source_id UUID NOT NULL,
  submission_id UUID REFERENCES form_submissions(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'redirected', 'processing', 'confirmed', 'failed', 'expired')),
  order_id UUID REFERENCES payment_orders(id) ON DELETE SET NULL,
  checkout_url TEXT NOT NULL DEFAULT '',
  provider_reference TEXT NOT NULL DEFAULT '',
  error_code TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
);

ALTER TABLE checkout_attempts
  ADD COLUMN IF NOT EXISTS submission_id UUID REFERENCES form_submissions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_checkout_attempts_reconcile
  ON checkout_attempts(status, created_at)
  WHERE status IN ('pending', 'redirected', 'processing');

CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  provider TEXT NOT NULL
    CHECK (provider IN ('stripe', 'paypal', 'paystack', 'opay')),
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT '',
  processing_status TEXT NOT NULL DEFAULT 'processed'
    CHECK (processing_status IN ('received', 'processed', 'ignored', 'failed')),
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_event_id)
);

ALTER TABLE forms
  ADD COLUMN IF NOT EXISTS payment_provider_override TEXT;

ALTER TABLE event_ticket_types
  ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES payment_products(id) ON DELETE SET NULL;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS order_id UUID REFERENCES payment_orders(id) ON DELETE SET NULL;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS provider_reference TEXT;

UPDATE payments payment
SET user_id = form.created_by
FROM form_submissions submission
JOIN forms form ON form.id = submission.form_id
WHERE payment.submission_id = submission.id
  AND payment.user_id IS NULL;

DO $payment_provider_constraint$
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
    CHECK (provider IS NULL OR provider IN ('stripe', 'paypal', 'paystack', 'opay'));
END;
$payment_provider_constraint$;

CREATE INDEX IF NOT EXISTS idx_payments_owner
  ON payments(user_id, payment_date DESC);

COMMENT ON TABLE payment_provider_connections IS
  'Encrypted workspace-owned merchant account connections. Raw credentials are never selected by browser queries.';
COMMENT ON TABLE payment_provider_oauth_states IS
  'Short-lived, single-use state records for in-dashboard merchant onboarding.';
COMMENT ON TABLE payment_orders IS
  'Canonical commerce orders shared by forms, events, invoices, and subscriptions.';
COMMENT ON TABLE checkout_attempts IS
  'Idempotent hosted-checkout attempts reconciled through signed provider webhooks.';

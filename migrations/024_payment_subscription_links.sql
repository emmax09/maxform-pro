ALTER TABLE payment_subscriptions
  ADD COLUMN IF NOT EXISTS initial_order_id UUID
    REFERENCES payment_orders(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_subscriptions_initial_order
  ON payment_subscriptions(initial_order_id)
  WHERE initial_order_id IS NOT NULL;

COMMENT ON COLUMN payment_subscriptions.initial_order_id IS
  'The first confirmed MaxForm order that created this recurring agreement';

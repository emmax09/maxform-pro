-- Keep the workspace-level analytics endpoint fast as response, payment, and
-- contact history grows. All indexes mirror the owner + time access patterns.
CREATE INDEX IF NOT EXISTS idx_forms_owner_status
  ON forms(created_by, status);

CREATE INDEX IF NOT EXISTS idx_contacts_owner_created
  ON contacts(created_by, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_owner_starts
  ON events(created_by, starts_at ASC);

CREATE INDEX IF NOT EXISTS idx_payment_orders_owner_paid_at
  ON payment_orders(user_id, paid_at DESC)
  WHERE status = 'paid';

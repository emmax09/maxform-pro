-- Hybrid billing: a subscription unlocks the platform, and only the resources
-- that cost money to run are metered. This adds the subscription record and a
-- credit ledger so AI credit balances are derived from real entries rather
-- than a hard-coded number in the UI.

CREATE TABLE IF NOT EXISTS workspace_subscriptions (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'trial'
    CHECK (plan IN ('trial', 'starter', 'pro', 'business', 'enterprise')),
  status TEXT NOT NULL DEFAULT 'trialing'
    CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'expired')),
  -- The metered window. Allowances reset when a new period starts.
  period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  period_end TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
  -- Storage bought on top of the plan, in bytes.
  extra_storage_bytes BIGINT NOT NULL DEFAULT 0 CHECK (extra_storage_bytes >= 0),
  -- Extra outbound email bought for the current period.
  extra_emails INTEGER NOT NULL DEFAULT 0 CHECK (extra_emails >= 0),
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE workspace_subscriptions IS
  'One row per workspace: current plan, metered period, and purchased add-ons.';

-- Every credit movement, so a balance is always the sum of real entries and a
-- workspace can see exactly where its credits went.
CREATE TABLE IF NOT EXISTS workspace_credit_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Positive grants credits, negative spends them.
  delta INTEGER NOT NULL CHECK (delta <> 0),
  kind TEXT NOT NULL
    CHECK (kind IN ('plan_grant', 'pack_purchase', 'spend', 'adjustment', 'expiry')),
  -- The AI action that spent the credits, for the usage breakdown.
  action TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  -- Purchased credits roll over for a limited window; NULL never expires.
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspace_credit_ledger_recent
  ON workspace_credit_ledger(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workspace_credit_ledger_spend
  ON workspace_credit_ledger(user_id, created_at DESC)
  WHERE kind = 'spend';

COMMENT ON TABLE workspace_credit_ledger IS
  'Append-only AI credit movements. Balance = SUM(delta) over unexpired rows.';

-- Receipts for subscription charges and add-on purchases.
CREATE TABLE IF NOT EXISTS workspace_billing_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL
    CHECK (kind IN ('subscription', 'ai_credits', 'storage', 'emails', 'refund')),
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'paid'
    CHECK (status IN ('paid', 'pending', 'failed', 'refunded')),
  reference TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspace_billing_events_recent
  ON workspace_billing_events(user_id, created_at DESC);

COMMENT ON TABLE workspace_billing_events IS
  'Billing history rows. No sample data: every row comes from a real charge.';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'maxform_browser') THEN
    REVOKE ALL ON TABLE workspace_subscriptions FROM maxform_browser;
    REVOKE ALL ON TABLE workspace_credit_ledger FROM maxform_browser;
    REVOKE ALL ON TABLE workspace_billing_events FROM maxform_browser;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS workspace_regional_settings (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  currency VARCHAR(3) NOT NULL DEFAULT 'USD'
    CHECK (currency ~ '^[A-Z]{3}$'),
  timezone TEXT NOT NULL DEFAULT 'UTC',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspace_regional_settings_currency
  ON workspace_regional_settings(currency);

COMMENT ON TABLE workspace_regional_settings IS
  'Workspace-wide currency and IANA timezone preferences.';

COMMENT ON COLUMN workspace_regional_settings.currency IS
  'ISO 4217 currency code used as the workspace default.';

COMMENT ON COLUMN workspace_regional_settings.timezone IS
  'IANA timezone used for workspace dates and scheduling.';

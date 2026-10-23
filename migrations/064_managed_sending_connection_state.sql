-- Keep Managed Sending connection state separate from active delivery state.
-- Connecting Managed Sending only makes it available to the workspace; the
-- workspace owner must explicitly select it as the active provider.

ALTER TABLE email_settings
  ADD COLUMN IF NOT EXISTS managed_sending_enabled BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE email_settings
SET managed_sending_enabled = TRUE
WHERE active_provider = 'resend'
  AND active_provider_mode = 'managed';

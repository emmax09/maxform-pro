-- A separate secret is required for provider delivery-event webhooks so rotating
-- analytics tracking never breaks the workspace inbound-mail endpoint.
ALTER TABLE email_provider_connections
  ADD COLUMN IF NOT EXISTS event_token_hash TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_email_logs_provider_message
  ON email_logs(user_id, provider, provider_message_id)
  WHERE provider_message_id <> '';

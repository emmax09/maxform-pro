-- Sender is an additional transactional email provider. Its public API uses
-- bearer tokens and the documented /v2/message/send endpoint.

ALTER TABLE email_provider_connections
  DROP CONSTRAINT IF EXISTS email_provider_connections_provider_check;

ALTER TABLE email_provider_connections
  ADD CONSTRAINT email_provider_connections_provider_check
  CHECK (provider IN ('resend', 'sender', 'smtp', 'sendgrid', 'postmark', 'mailgun', 'ses'));

ALTER TABLE email_sending_domains
  DROP CONSTRAINT IF EXISTS email_sending_domains_provider_check;

ALTER TABLE email_sending_domains
  ADD CONSTRAINT email_sending_domains_provider_check
  CHECK (provider IN ('resend', 'sender', 'sendgrid', 'postmark', 'mailgun', 'ses'));

INSERT INTO provider_rate_limits (provider, max_per_second, max_per_hour, notes)
VALUES ('sender', 5, 10000, 'Conservative Sender transactional pacing; account limits remain authoritative.')
ON CONFLICT (provider) DO UPDATE SET
  max_per_second = EXCLUDED.max_per_second,
  max_per_hour = EXCLUDED.max_per_hour,
  notes = EXCLUDED.notes,
  updated_at = NOW();

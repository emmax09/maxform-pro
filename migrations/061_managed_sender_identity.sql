-- Store managed sender parts separately so the visible address can be
-- regenerated when MaxForm changes its managed sending domain.

ALTER TABLE email_identities
  ADD COLUMN IF NOT EXISTS sender_prefix TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS managed_domain TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS generated_sender_email TEXT NOT NULL DEFAULT '';

UPDATE email_identities
SET managed_domain = COALESCE(NULLIF(managed_domain, ''), NULLIF(split_part(managed_sender_email, '@', 2), '')), 
    sender_prefix = COALESCE(
      NULLIF(sender_prefix, ''),
      NULLIF(regexp_replace(lower(sender_name), '[^a-z0-9]+', '', 'g'), ''),
      'maxform'
    ),
    generated_sender_email = CASE
      WHEN sending_mode = 'managed' THEN CONCAT(
        COALESCE(
          NULLIF(sender_prefix, ''),
          NULLIF(regexp_replace(lower(sender_name), '[^a-z0-9]+', '', 'g'), ''),
          'maxform'
        ),
        '@',
        COALESCE(NULLIF(managed_domain, ''), NULLIF(split_part(managed_sender_email, '@', 2), ''))
      )
      ELSE generated_sender_email
    END,
    managed_sender_email = CASE
      WHEN sending_mode = 'managed' THEN CONCAT(
        COALESCE(
          NULLIF(sender_prefix, ''),
          NULLIF(regexp_replace(lower(sender_name), '[^a-z0-9]+', '', 'g'), ''),
          'maxform'
        ),
        '@',
        COALESCE(NULLIF(managed_domain, ''), NULLIF(split_part(managed_sender_email, '@', 2), ''))
      )
      ELSE managed_sender_email
    END
WHERE sending_mode = 'managed';

CREATE INDEX IF NOT EXISTS idx_email_identity_managed_sender
  ON email_identities(managed_domain, sender_prefix);

DROP VIEW IF EXISTS email_identity_settings;

CREATE VIEW email_identity_settings AS
SELECT
  id,
  user_id,
  sender_name,
  reply_to AS reply_to_email,
  sending_mode,
  sender_prefix,
  managed_domain,
  generated_sender_email,
  managed_sender_email,
  custom_domain,
  domain_verified,
  created_at,
  updated_at
FROM email_identities;

-- Central sender routing and provider-domain metadata.
-- This migration is additive so existing workspaces keep their provider
-- connections, templates, identities, and delivery history.

ALTER TABLE email_provider_connections
  ADD COLUMN IF NOT EXISTS validation_mode TEXT NOT NULL DEFAULT 'delivery'
    CHECK (validation_mode IN ('api', 'delivery')),
  ADD COLUMN IF NOT EXISTS access_mode TEXT NOT NULL DEFAULT 'send'
    CHECK (access_mode IN ('send', 'send_receive')),
  ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error_detail TEXT NOT NULL DEFAULT '';

ALTER TABLE email_identities
  ADD COLUMN IF NOT EXISTS sending_mode TEXT NOT NULL DEFAULT 'managed'
    CHECK (sending_mode IN ('managed', 'custom')),
  ADD COLUMN IF NOT EXISTS managed_sender_email TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS custom_sender_email TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS custom_domain TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS domain_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS domain_verification_status TEXT NOT NULL DEFAULT 'not_required'
    CHECK (domain_verification_status IN ('not_required', 'pending', 'verified', 'failed')),
  ADD COLUMN IF NOT EXISTS domain_verification_records JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS domain_last_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS domain_verified_at TIMESTAMPTZ;

ALTER TABLE email_logs
  ADD COLUMN IF NOT EXISTS email_type TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS provider_error_detail TEXT NOT NULL DEFAULT '';

UPDATE email_logs
SET email_type = COALESCE(NULLIF(email_type, ''), module)
WHERE email_type = '';

-- Existing identities are retained. Their old sender_email remains available
-- as a compatibility value until the owner saves the new managed/custom form.
UPDATE email_identities
SET custom_domain = COALESCE(NULLIF(custom_domain, ''), CASE WHEN status = 'verified' THEN domain ELSE '' END),
    domain_verification_status = CASE
      WHEN status = 'verified' AND domain <> '' THEN 'verified'
      ELSE domain_verification_status
    END,
    domain_verified = CASE
      WHEN status = 'verified' AND domain <> '' THEN TRUE
      ELSE domain_verified
    END
WHERE sending_mode = 'managed';

CREATE TABLE IF NOT EXISTS email_sending_domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_connection_id UUID NOT NULL REFERENCES email_provider_connections(id) ON DELETE CASCADE,
  provider TEXT NOT NULL
    CHECK (provider IN ('resend', 'sendgrid', 'postmark', 'mailgun', 'ses')),
  domain TEXT NOT NULL,
  provider_domain_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'verified', 'failed', 'unknown')),
  dns_records JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_error TEXT NOT NULL DEFAULT '',
  last_error_detail TEXT NOT NULL DEFAULT '',
  last_checked_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_sending_domains_owner_provider_domain
  ON email_sending_domains(user_id, provider_connection_id, LOWER(domain));

CREATE INDEX IF NOT EXISTS idx_email_sending_domains_owner_status
  ON email_sending_domains(user_id, status, updated_at DESC);

-- Compatibility projection for integrations that use the provider-neutral
-- email_identity_settings name. email_identities remains the canonical table
-- because existing templates and campaigns reference it by foreign key.
CREATE OR REPLACE VIEW email_identity_settings AS
SELECT
  id,
  user_id,
  sender_name,
  reply_to AS reply_to_email,
  sending_mode,
  managed_sender_email,
  custom_domain,
  domain_verified,
  created_at,
  updated_at
FROM email_identities;

-- A workspace can keep every supported provider connected, but only one may be
-- active for delivery. Older fallback selections are deliberately made inactive.
UPDATE email_provider_connections
SET role = 'none', updated_at = NOW()
WHERE role = 'fallback';

ALTER TABLE email_provider_connections
  ADD COLUMN IF NOT EXISTS inbound_token_hash TEXT NOT NULL DEFAULT '';

-- Keep one sender identity per workspace. Existing installations are compacted
-- deterministically before the database constraint is added.
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY user_id ORDER BY is_default DESC, updated_at DESC, created_at DESC) AS position
  FROM email_identities
)
DELETE FROM email_identities identity
USING ranked
WHERE identity.id = ranked.id AND ranked.position > 1;

DROP INDEX IF EXISTS idx_email_identity_owner_email;
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_identity_singleton
  ON email_identities(user_id);

CREATE TABLE IF NOT EXISTS email_inbound_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_connection_id UUID REFERENCES email_provider_connections(id) ON DELETE SET NULL,
  provider TEXT NOT NULL DEFAULT '',
  provider_message_id TEXT NOT NULL DEFAULT '',
  sender TEXT NOT NULL DEFAULT '',
  recipient TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  html_body TEXT NOT NULL DEFAULT '',
  text_body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'read', 'archived')),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_inbound_provider_message
  ON email_inbound_messages(user_id, provider, provider_message_id)
  WHERE provider_message_id <> '';

CREATE INDEX IF NOT EXISTS idx_email_inbound_workspace_recent
  ON email_inbound_messages(user_id, received_at DESC);

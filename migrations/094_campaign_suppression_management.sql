-- Give workspace owners enough context to review suppression records without
-- weakening the single, workspace-scoped suppression guard used by sending.

ALTER TABLE email_suppressions
  ADD COLUMN IF NOT EXISTS reason_detail TEXT NOT NULL DEFAULT '';

ALTER TABLE email_suppressions
  ADD COLUMN IF NOT EXISTS source_message_id UUID
    REFERENCES contact_campaign_messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_email_suppressions_reason
  ON email_suppressions(user_id, reason, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_suppressions_source_message
  ON email_suppressions(source_message_id)
  WHERE source_message_id IS NOT NULL;

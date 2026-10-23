-- Preserve the ticket instances behind event email deliveries and allow the
-- queue to record an intentional skip when an event template is disabled after
-- a message has already been queued.

ALTER TABLE email_logs
  ADD COLUMN IF NOT EXISTS related_ticket_ids JSONB NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'email_logs'::regclass
      AND conname = 'email_logs_related_ticket_ids_array'
  ) THEN
    ALTER TABLE email_logs
      ADD CONSTRAINT email_logs_related_ticket_ids_array
      CHECK (jsonb_typeof(related_ticket_ids) = 'array');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_email_logs_related_ticket_ids
  ON email_logs USING GIN (related_ticket_ids);

ALTER TABLE email_logs
  DROP CONSTRAINT IF EXISTS email_logs_status_check;

ALTER TABLE email_logs
  ADD CONSTRAINT email_logs_status_check
  CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'complained', 'failed', 'skipped'));

COMMENT ON COLUMN email_logs.related_ticket_ids IS
  'UUIDs of event ticket instances represented by this email; contains identifiers only, never public download tokens.';

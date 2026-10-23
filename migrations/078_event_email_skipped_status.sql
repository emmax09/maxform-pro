-- Event-level mail toggles can be changed after a message is queued. Keep the
-- queue audit trail without delivering a message that is now disabled.
ALTER TABLE email_logs
  DROP CONSTRAINT IF EXISTS email_logs_status_check;

ALTER TABLE email_logs
  ADD CONSTRAINT email_logs_status_check CHECK (
    status IN (
      'queued', 'sending', 'sent', 'delivered', 'opened', 'clicked',
      'bounced', 'complained', 'failed', 'skipped'
    )
  );

-- Persist message headers so queued and scheduled campaign sends retain their
-- unsubscribe and deliverability headers when the worker delivers them later.
ALTER TABLE email_logs
  ADD COLUMN IF NOT EXISTS custom_headers JSONB NOT NULL DEFAULT '{}'::jsonb;

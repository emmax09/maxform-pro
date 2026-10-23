CREATE TABLE IF NOT EXISTS automation_email_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  action_id UUID NOT NULL REFERENCES workflow_actions(id) ON DELETE CASCADE,
  form_id UUID NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  submission_id UUID NOT NULL REFERENCES form_submissions(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'cancelled')),
  recipient TEXT NOT NULL,
  reply_to TEXT,
  subject TEXT NOT NULL,
  text_body TEXT NOT NULL,
  html_body TEXT,
  template_data JSONB NOT NULL DEFAULT '{}',
  provider_message_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  scheduled_for TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (action_id, submission_id)
);

CREATE INDEX IF NOT EXISTS idx_automation_email_outbox_delivery
  ON automation_email_outbox(status, scheduled_for, created_at);

CREATE INDEX IF NOT EXISTS idx_automation_email_outbox_user
  ON automation_email_outbox(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_email_outbox_submission
  ON automation_email_outbox(submission_id);

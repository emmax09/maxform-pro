-- Public responses receive a stable browser-generated key. It lets a submit
-- retry (or a browser back/forward cycle) resolve to the same response instead
-- of adding another dashboard entry.
ALTER TABLE form_submissions
  ADD COLUMN IF NOT EXISTS client_submission_key UUID;

CREATE UNIQUE INDEX IF NOT EXISTS form_submissions_form_client_submission_key_unique
  ON form_submissions (form_id, client_submission_key)
  WHERE client_submission_key IS NOT NULL;

-- Pending payment responses are intentionally invisible to form owners until
-- the checkout service atomically marks payment as complete.
CREATE INDEX IF NOT EXISTS form_submissions_visible_response_index
  ON form_submissions (form_id, submitted_at DESC)
  WHERE COALESCE(data #>> '{_meta,status}', 'completed') <> 'pending_payment';

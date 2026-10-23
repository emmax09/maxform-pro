-- Performance indexes for cached dashboard/module hydration and large-list filters.

CREATE INDEX IF NOT EXISTS idx_forms_owner_status_updated
  ON forms(created_by, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_forms_owner_created
  ON forms(created_by, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_forms_slug_lower
  ON forms(LOWER(slug));

CREATE INDEX IF NOT EXISTS idx_forms_project_updated
  ON forms(project_id, updated_at DESC)
  WHERE project_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_form_submissions_form_submitted
  ON form_submissions(form_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_form_submissions_form_status_submitted
  ON form_submissions(form_id, (data->'_meta'->>'status'), submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_form_submissions_submitter_submitted
  ON form_submissions(submitted_by, submitted_at DESC)
  WHERE submitted_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_form_submission_answers_field
  ON form_submission_answers(field_id, submission_id);

CREATE INDEX IF NOT EXISTS idx_contacts_owner_updated
  ON contacts(created_by, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_contacts_owner_company
  ON contacts(created_by, LOWER(company))
  WHERE COALESCE(company, '') <> '';

CREATE INDEX IF NOT EXISTS idx_contacts_owner_status_email
  ON contacts(created_by, lifecycle_stage, LOWER(email));

CREATE INDEX IF NOT EXISTS idx_contact_lists_user_updated
  ON contact_lists(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_contact_campaigns_user_status_updated
  ON contact_campaigns(user_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_slug_lower
  ON events(LOWER(slug));

CREATE INDEX IF NOT EXISTS idx_events_owner_status_updated
  ON events(created_by, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_event_attendees_event_status_email
  ON event_attendees(event_id, ticket_status, LOWER(email));

CREATE INDEX IF NOT EXISTS idx_event_ticket_scans_event_created
  ON event_ticket_scans(event_id, scanned_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_orders_user_updated
  ON payment_orders(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_orders_source_status_created
  ON payment_orders(source_type, source_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_orders_customer_status
  ON payment_orders(user_id, LOWER(customer_email), status);

CREATE INDEX IF NOT EXISTS idx_checkout_attempts_idempotency_status
  ON checkout_attempts(idempotency_key, status);

CREATE INDEX IF NOT EXISTS idx_workflows_owner_form_updated
  ON workflows(created_by, form_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_runs_status_created
  ON automation_runs(status, created_at DESC);

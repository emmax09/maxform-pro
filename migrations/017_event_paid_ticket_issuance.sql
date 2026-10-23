CREATE UNIQUE INDEX IF NOT EXISTS idx_event_orders_payment
  ON event_orders(payment_id)
  WHERE payment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_attendees_registration_submission
  ON event_attendees(registration_submission_id)
  WHERE registration_submission_id IS NOT NULL;

CREATE OR REPLACE FUNCTION maxform_issue_paid_event_ticket()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $maxform$
DECLARE
  matched_event_id UUID;
  matched_ticket_type_id UUID;
  submission_data JSONB;
  saved_order_id UUID;
BEGIN
  IF NEW.status <> 'completed' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'completed' THEN
    RETURN NEW;
  END IF;

  SELECT event.id, ticket_type.id, submission.data
  INTO matched_event_id, matched_ticket_type_id, submission_data
  FROM form_submissions submission
  JOIN events event
    ON event.registration_form_id = submission.form_id
   AND event.ticketing_enabled = TRUE
  JOIN event_ticket_types ticket_type
    ON ticket_type.event_id = event.id
   AND ticket_type.active = TRUE
   AND LOWER(ticket_type.name) =
     LOWER(COALESCE(submission.data->>'ticket-selection', ''))
  WHERE submission.id = NEW.submission_id
  LIMIT 1;

  IF matched_event_id IS NULL OR matched_ticket_type_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO event_orders (
    event_id, payment_id, purchaser_name, purchaser_email, status,
    subtotal, fees, total_amount, currency, source, metadata,
    created_at, updated_at
  )
  VALUES (
    matched_event_id,
    NEW.id,
    COALESCE(NULLIF(submission_data->>'full-name', ''), 'Attendee'),
    COALESCE(submission_data->>'email', ''),
    'paid',
    NEW.amount,
    0,
    NEW.amount,
    UPPER(COALESCE(NULLIF(NEW.currency, ''), 'USD')),
    'event_registration',
    jsonb_build_object('submissionId', NEW.submission_id),
    NOW(),
    NOW()
  )
  ON CONFLICT (payment_id) WHERE payment_id IS NOT NULL
  DO UPDATE SET
    status = 'paid',
    total_amount = EXCLUDED.total_amount,
    currency = EXCLUDED.currency,
    updated_at = NOW()
  RETURNING id INTO saved_order_id;

  INSERT INTO event_attendees (
    event_id, order_id, ticket_type_id, registration_submission_id,
    full_name, email, phone, ticket_status, answers,
    created_at, updated_at
  )
  VALUES (
    matched_event_id,
    saved_order_id,
    matched_ticket_type_id,
    NEW.submission_id,
    COALESCE(NULLIF(submission_data->>'full-name', ''), 'Attendee'),
    COALESCE(submission_data->>'email', ''),
    COALESCE(submission_data->>'phone', ''),
    'valid',
    submission_data - '_meta',
    NOW(),
    NOW()
  )
  ON CONFLICT (registration_submission_id)
    WHERE registration_submission_id IS NOT NULL
  DO UPDATE SET
    order_id = EXCLUDED.order_id,
    ticket_type_id = EXCLUDED.ticket_type_id,
    full_name = EXCLUDED.full_name,
    email = EXCLUDED.email,
    phone = EXCLUDED.phone,
    ticket_status = 'valid',
    answers = EXCLUDED.answers,
    updated_at = NOW();

  RETURN NEW;
END;
$maxform$;

DROP TRIGGER IF EXISTS maxform_issue_paid_event_ticket_insert
  ON payments;

CREATE TRIGGER maxform_issue_paid_event_ticket_insert
AFTER INSERT ON payments
FOR EACH ROW
WHEN (NEW.status = 'completed')
EXECUTE FUNCTION maxform_issue_paid_event_ticket();

DROP TRIGGER IF EXISTS maxform_issue_paid_event_ticket_update
  ON payments;

CREATE TRIGGER maxform_issue_paid_event_ticket_update
AFTER UPDATE OF status ON payments
FOR EACH ROW
WHEN (NEW.status = 'completed')
EXECUTE FUNCTION maxform_issue_paid_event_ticket();

COMMENT ON FUNCTION maxform_issue_paid_event_ticket() IS
  'Creates the database-backed event order and attendee ticket after payment completion';

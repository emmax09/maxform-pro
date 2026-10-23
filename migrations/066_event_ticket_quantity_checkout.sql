-- Allow one paid registration to issue every ticket purchased for its ticket type.
-- The first attendee keeps the submission link used by verification and the
-- remaining attendees are still attached to the same event order.

CREATE OR REPLACE FUNCTION maxform_issue_paid_event_ticket()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $maxform$
DECLARE
  matched_event_id UUID;
  matched_ticket_type_id UUID;
  submission_data JSONB;
  saved_order_id UUID;
  raw_ticket_answer TEXT;
  ticket_name TEXT;
  ticket_quantity INTEGER := 1;
  ticket_index INTEGER;
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
  WHERE submission.id = NEW.submission_id
  LIMIT 1;

  IF matched_event_id IS NULL OR matched_ticket_type_id IS NULL THEN
    RETURN NEW;
  END IF;

  raw_ticket_answer := COALESCE(submission_data->>'ticket-selection', '');
  ticket_name := raw_ticket_answer;
  IF LEFT(raw_ticket_answer, 1) = '{' THEN
    BEGIN
      ticket_name := COALESCE(raw_ticket_answer::jsonb->>'name', raw_ticket_answer);
      ticket_quantity := GREATEST(
        1,
        COALESCE((raw_ticket_answer::jsonb->>'quantity')::INTEGER, 1)
      );
    EXCEPTION WHEN OTHERS THEN
      ticket_name := raw_ticket_answer;
      ticket_quantity := 1;
    END;
  END IF;

  SELECT ticket_type.id
  INTO matched_ticket_type_id
  FROM event_ticket_types ticket_type
  WHERE ticket_type.event_id = matched_event_id
    AND ticket_type.active = TRUE
    AND LOWER(ticket_type.name) = LOWER(ticket_name)
  LIMIT 1;

  IF matched_ticket_type_id IS NULL THEN
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
    jsonb_build_object('submissionId', NEW.submission_id, 'quantity', ticket_quantity),
    NOW(),
    NOW()
  )
  ON CONFLICT (payment_id) WHERE payment_id IS NOT NULL
  DO UPDATE SET
    status = 'paid',
    total_amount = EXCLUDED.total_amount,
    currency = EXCLUDED.currency,
    metadata = EXCLUDED.metadata,
    updated_at = NOW()
  RETURNING id INTO saved_order_id;

  FOR ticket_index IN 1..ticket_quantity LOOP
    INSERT INTO event_attendees (
      event_id, order_id, ticket_type_id, registration_submission_id,
      full_name, email, phone, ticket_status, answers,
      created_at, updated_at
    )
    VALUES (
      matched_event_id,
      saved_order_id,
      matched_ticket_type_id,
      CASE WHEN ticket_index = 1 THEN NEW.submission_id ELSE NULL END,
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
  END LOOP;

  RETURN NEW;
END;
$maxform$;

COMMENT ON FUNCTION maxform_issue_paid_event_ticket() IS
  'Creates one secure attendee ticket for every ticket purchased in a paid event registration';

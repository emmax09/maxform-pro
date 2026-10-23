-- A public browser may save a paid form response as pending, but it must never
-- mark that response as completed. The checkout server uses the privileged
-- server database role and is the only path that can finalize payment.
CREATE OR REPLACE FUNCTION maxform_enforce_paid_submission_state()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $maxform$
DECLARE
  payment_required BOOLEAN := FALSE;
BEGIN
  -- This guard is specifically for the database credential included in the
  -- browser build. Server-side writes remain available to verified checkout,
  -- refund, and administrative workflows.
  IF SESSION_USER <> 'maxform_browser' THEN
    RETURN NEW;
  END IF;

  SELECT
    COALESCE(
      COALESCE(
        form_settings.live_snapshot->'payment'->>'enabled',
        form_settings.payment->>'enabled',
        'false'
      ) = 'true',
      FALSE
    )
    OR EXISTS (
      SELECT 1
      FROM events event
      WHERE event.registration_form_id = form.id
        AND (
          (
            COALESCE(event.ticketing_enabled, FALSE) = TRUE
            AND EXISTS (
              SELECT 1
              FROM event_ticket_types ticket_type
              WHERE ticket_type.event_id = event.id
                AND ticket_type.active = TRUE
                AND ticket_type.price > 0
            )
          )
          OR (
            COALESCE(event.ticketing_enabled, FALSE) = FALSE
            AND EXISTS (
              SELECT 1
              FROM event_pricing pricing
              WHERE pricing.event_id = event.id
                AND pricing.enabled = TRUE
                AND pricing.amount > 0
            )
          )
        )
    )
  INTO payment_required
  FROM forms form
  LEFT JOIN form_settings ON form_settings.form_id = form.id
  WHERE form.id = NEW.form_id
    AND form.status = 'published';

  IF payment_required
    AND (
      COALESCE(NEW.data #>> '{_meta,status}', '') <> 'pending_payment'
      OR COALESCE(NEW.data #>> '{_meta,paymentStatus}', '') <> 'pending'
    )
  THEN
    RAISE EXCEPTION
      USING ERRCODE = '42501',
        MESSAGE = 'Paid responses must be finalized by secure checkout.';
  END IF;

  RETURN NEW;
END;
$maxform$;

DROP TRIGGER IF EXISTS enforce_paid_submission_server_finalization
  ON form_submissions;

CREATE TRIGGER enforce_paid_submission_server_finalization
BEFORE INSERT OR UPDATE OF data ON form_submissions
FOR EACH ROW
EXECUTE FUNCTION maxform_enforce_paid_submission_state();

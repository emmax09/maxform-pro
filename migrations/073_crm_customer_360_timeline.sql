-- Customer 360 and universal CRM timeline.
--
-- CRM remains a relationship layer over the existing module records. This
-- projection stores only the event envelope needed for a fast, filterable
-- timeline; the source record remains authoritative in its own module table.

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS job_title TEXT NOT NULL DEFAULT '';

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS address JSONB NOT NULL DEFAULT '{}';

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS preferred_channel TEXT NOT NULL DEFAULT '';

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS next_action TEXT NOT NULL DEFAULT '';

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS next_action_at TIMESTAMPTZ;

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS next_action TEXT NOT NULL DEFAULT '';

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS next_action_at TIMESTAMPTZ;

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS risk_level TEXT NOT NULL DEFAULT 'unknown';

ALTER TABLE deals
  DROP CONSTRAINT IF EXISTS deals_risk_level_check;

ALTER TABLE deals
  ADD CONSTRAINT deals_risk_level_check
  CHECK (risk_level IN ('unknown', 'healthy', 'watch', 'at_risk'));

CREATE TABLE IF NOT EXISTS crm_contact_relationships (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  related_contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (contact_id, related_contact_id, relationship_type),
  CHECK (contact_id <> related_contact_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_contact_relationships_related
  ON crm_contact_relationships(user_id, related_contact_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS crm_timeline_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
  deal_id UUID REFERENCES deals(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  source_module TEXT NOT NULL,
  related_record_id UUID,
  related_record_type TEXT NOT NULL DEFAULT '',
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dedupe_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_timeline_workspace_time
  ON crm_timeline_events(user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_crm_timeline_contact_time
  ON crm_timeline_events(contact_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_crm_timeline_source_time
  ON crm_timeline_events(user_id, source_module, occurred_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_timeline_dedupe
  ON crm_timeline_events(user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS crm_audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  before_state JSONB NOT NULL DEFAULT '{}',
  after_state JSONB NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_crm_audit_workspace_time
  ON crm_audit_events(user_id, created_at DESC);

-- One safe write path for all source-module adapters.
CREATE OR REPLACE FUNCTION maxform_crm_record_timeline(
  p_user_id UUID,
  p_contact_id UUID,
  p_company_id UUID,
  p_deal_id UUID,
  p_event_type TEXT,
  p_source_module TEXT,
  p_related_record_id UUID,
  p_related_record_type TEXT,
  p_actor_user_id UUID,
  p_title TEXT,
  p_detail TEXT,
  p_metadata JSONB,
  p_occurred_at TIMESTAMPTZ,
  p_dedupe_key TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $crm_timeline$
BEGIN
  IF p_user_id IS NULL OR NULLIF(BTRIM(COALESCE(p_title, '')), '') IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO crm_timeline_events (
    user_id, contact_id, company_id, deal_id, event_type, source_module,
    related_record_id, related_record_type, actor_user_id, title, detail,
    metadata, occurred_at, dedupe_key, created_at
  )
  VALUES (
    p_user_id, p_contact_id, p_company_id, p_deal_id, p_event_type,
    COALESCE(NULLIF(BTRIM(p_source_module), ''), 'crm'), p_related_record_id,
    COALESCE(p_related_record_type, ''), p_actor_user_id, BTRIM(p_title),
    COALESCE(p_detail, ''), COALESCE(p_metadata, '{}'::jsonb),
    COALESCE(p_occurred_at, NOW()), NULLIF(BTRIM(p_dedupe_key), ''), NOW()
  )
  ON CONFLICT (user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL
  DO UPDATE SET
    contact_id = EXCLUDED.contact_id,
    company_id = EXCLUDED.company_id,
    deal_id = EXCLUDED.deal_id,
    event_type = EXCLUDED.event_type,
    source_module = EXCLUDED.source_module,
    related_record_type = EXCLUDED.related_record_type,
    actor_user_id = EXCLUDED.actor_user_id,
    title = EXCLUDED.title,
    detail = EXCLUDED.detail,
    metadata = EXCLUDED.metadata,
    occurred_at = EXCLUDED.occurred_at;
END;
$crm_timeline$;

CREATE OR REPLACE FUNCTION maxform_crm_activity_source(
  p_entity_type TEXT,
  p_metadata JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $crm_source$
DECLARE
  source TEXT := LOWER(BTRIM(COALESCE(p_metadata->>'sourceModule', '')));
BEGIN
  IF source <> '' THEN
    RETURN source;
  END IF;
  RETURN CASE LOWER(COALESCE(p_entity_type, ''))
    WHEN 'submission' THEN 'forms'
    WHEN 'payment_order' THEN 'payments'
    WHEN 'payment_refund' THEN 'payments'
    WHEN 'event' THEN 'events'
    WHEN 'event_attendee' THEN 'events'
    WHEN 'appointment' THEN 'appointments'
    WHEN 'document' THEN 'documents'
    WHEN 'document_event' THEN 'documents'
    WHEN 'file' THEN 'files'
    WHEN 'contact_campaign' THEN 'campaigns'
    ELSE 'crm'
  END;
END;
$crm_source$;

CREATE OR REPLACE FUNCTION maxform_crm_sync_contact_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $crm_contact_activity$
DECLARE
  source_module TEXT;
BEGIN
  source_module := maxform_crm_activity_source(NEW.entity_type, NEW.metadata);
  PERFORM maxform_crm_record_timeline(
    NEW.user_id,
    NEW.contact_id,
    contact.company_id,
    CASE WHEN NEW.entity_type = 'deal' THEN NEW.entity_id ELSE NULL END,
    NEW.activity_type,
    source_module,
    NEW.entity_id,
    COALESCE(NEW.entity_type, ''),
    NEW.user_id,
    NEW.title,
    NEW.detail,
    COALESCE(NEW.metadata, '{}'::jsonb),
    NEW.created_at,
    'contact_activity:' || NEW.id::text
  )
  FROM contacts contact
  WHERE contact.id = NEW.contact_id
    AND contact.created_by = NEW.user_id;
  RETURN NEW;
END;
$crm_contact_activity$;

DROP TRIGGER IF EXISTS maxform_crm_sync_contact_activity
  ON contact_activity;

CREATE TRIGGER maxform_crm_sync_contact_activity
AFTER INSERT OR UPDATE OF title, detail, metadata, created_at
ON contact_activity
FOR EACH ROW
EXECUTE FUNCTION maxform_crm_sync_contact_activity();

CREATE OR REPLACE FUNCTION maxform_crm_sync_crm_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $crm_crm_activity$
BEGIN
  PERFORM maxform_crm_record_timeline(
    NEW.user_id,
    NEW.contact_id,
    NEW.company_id,
    NEW.deal_id,
    NEW.activity_type,
    'crm',
    NEW.id,
    'crm_activity',
    NEW.actor_user_id,
    NEW.title,
    NEW.detail,
    COALESCE(NEW.metadata, '{}'::jsonb),
    NEW.created_at,
    'crm_activity:' || NEW.id::text
  );
  RETURN NEW;
END;
$crm_crm_activity$;

DROP TRIGGER IF EXISTS maxform_crm_sync_crm_activity
  ON crm_activities;

CREATE TRIGGER maxform_crm_sync_crm_activity
AFTER INSERT OR UPDATE OF title, detail, metadata, created_at
ON crm_activities
FOR EACH ROW
EXECUTE FUNCTION maxform_crm_sync_crm_activity();

CREATE OR REPLACE FUNCTION maxform_crm_sync_event_attendee()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $crm_event_attendee$
DECLARE
  event_owner UUID;
  event_title TEXT;
  ticket_name TEXT;
  contact_record UUID;
  company_record UUID;
BEGIN
  SELECT event.created_by, event.title, ticket.name
  INTO event_owner, event_title, ticket_name
  FROM events event
  LEFT JOIN event_ticket_types ticket ON ticket.id = NEW.ticket_type_id
  WHERE event.id = NEW.event_id;

  SELECT contact.id, contact.company_id
  INTO contact_record, company_record
  FROM contacts contact
  WHERE contact.created_by = event_owner
    AND LOWER(contact.email) = LOWER(NEW.email)
  ORDER BY contact.updated_at DESC
  LIMIT 1;

  IF NEW.checked_in_at IS NOT NULL THEN
    PERFORM maxform_crm_record_timeline(
      event_owner, contact_record, company_record, NULL,
      'event_checked_in', 'events', NEW.id, 'event_attendee', NEW.checked_in_by,
      'Attendee checked in',
      COALESCE(event_title, 'Event') || ' · ' || COALESCE(NEW.full_name, NEW.email),
      jsonb_build_object('eventId', NEW.event_id, 'ticketType', ticket_name,
        'ticketNumber', NEW.ticket_number),
      NEW.checked_in_at, 'event_attendee:' || NEW.id::text || ':checked_in'
    );
  ELSE
    PERFORM maxform_crm_record_timeline(
      event_owner, contact_record, company_record, NULL,
      'event_registered', 'events', NEW.id, 'event_attendee', NULL,
      'Event registration',
      COALESCE(event_title, 'Event') || ' · ' || COALESCE(ticket_name, 'Ticket'),
      jsonb_build_object('eventId', NEW.event_id, 'ticketType', ticket_name,
        'ticketNumber', NEW.ticket_number),
      NEW.created_at, 'event_attendee:' || NEW.id::text || ':registered'
    );
  END IF;
  RETURN NEW;
END;
$crm_event_attendee$;

DROP TRIGGER IF EXISTS maxform_crm_sync_event_attendee
  ON event_attendees;

CREATE TRIGGER maxform_crm_sync_event_attendee
AFTER INSERT OR UPDATE OF checked_in_at, checked_in_by, ticket_status, email
ON event_attendees
FOR EACH ROW
EXECUTE FUNCTION maxform_crm_sync_event_attendee();

CREATE OR REPLACE FUNCTION maxform_crm_sync_event_scan()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $crm_event_scan$
DECLARE
  event_owner UUID;
  event_title TEXT;
  contact_record UUID;
  company_record UUID;
  attendee_email TEXT;
BEGIN
  SELECT event.created_by, event.title, attendee.email
  INTO event_owner, event_title, attendee_email
  FROM events event
  LEFT JOIN event_attendees attendee ON attendee.id = NEW.attendee_id
  WHERE event.id = NEW.event_id;

  SELECT contact.id, contact.company_id
  INTO contact_record, company_record
  FROM contacts contact
  WHERE contact.created_by = event_owner
    AND LOWER(contact.email) = LOWER(attendee_email)
  ORDER BY contact.updated_at DESC
  LIMIT 1;

  PERFORM maxform_crm_record_timeline(
    event_owner, contact_record, company_record, NULL,
    CASE WHEN NEW.result = 'valid' THEN 'event_checked_in' ELSE 'event_check_attempt' END,
    'events', NEW.id, 'event_ticket_scan', NEW.scanned_by,
    CASE WHEN NEW.result = 'valid' THEN 'Ticket checked in' ELSE 'Ticket check-in attempt' END,
    COALESCE(event_title, 'Event') || ' · ' || NEW.result,
    COALESCE(NEW.metadata, '{}'::jsonb) || jsonb_build_object(
      'eventId', NEW.event_id, 'attendeeId', NEW.attendee_id, 'result', NEW.result
    ),
    NEW.scanned_at, 'event_ticket_scan:' || NEW.id::text
  );
  RETURN NEW;
END;
$crm_event_scan$;

DROP TRIGGER IF EXISTS maxform_crm_sync_event_scan
  ON event_ticket_scans;

CREATE TRIGGER maxform_crm_sync_event_scan
AFTER INSERT ON event_ticket_scans
FOR EACH ROW
EXECUTE FUNCTION maxform_crm_sync_event_scan();

CREATE OR REPLACE FUNCTION maxform_crm_sync_payment_order()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $crm_payment_order$
DECLARE
  contact_record UUID := NEW.contact_id;
  company_record UUID;
BEGIN
  IF contact_record IS NULL THEN
    SELECT contact.id, contact.company_id
    INTO contact_record, company_record
    FROM contacts contact
    WHERE contact.created_by = NEW.user_id
      AND LOWER(contact.email) = LOWER(NEW.customer_email)
    ORDER BY contact.updated_at DESC
    LIMIT 1;
  ELSE
    SELECT contact.company_id INTO company_record
    FROM contacts contact
    WHERE contact.id = contact_record AND contact.created_by = NEW.user_id;
  END IF;

  PERFORM maxform_crm_record_timeline(
    NEW.user_id, contact_record, company_record, NULL,
    CASE WHEN NEW.status IN ('paid', 'partially_refunded', 'refunded')
      THEN 'payment_received' ELSE 'payment_updated' END,
    'payments', NEW.id, 'payment_order', NULL,
    CASE WHEN NEW.status IN ('paid', 'partially_refunded', 'refunded')
      THEN 'Payment received' ELSE 'Payment updated' END,
    COALESCE(NEW.order_number, 'Order') || ' · ' || NEW.currency || ' ' || NEW.total_amount,
    jsonb_build_object(
      'orderId', NEW.id, 'orderNumber', NEW.order_number,
      'status', NEW.status, 'amount', NEW.total_amount,
      'currency', NEW.currency, 'sourceType', NEW.source_type
    ),
    COALESCE(NEW.paid_at, NEW.updated_at),
    'payment_order:' || NEW.id::text || ':' || NEW.status
  );
  RETURN NEW;
END;
$crm_payment_order$;

DROP TRIGGER IF EXISTS maxform_crm_sync_payment_order
  ON payment_orders;

CREATE TRIGGER maxform_crm_sync_payment_order
AFTER INSERT OR UPDATE OF contact_id, customer_email, status, total_amount,
  paid_at, updated_at
ON payment_orders
FOR EACH ROW
EXECUTE FUNCTION maxform_crm_sync_payment_order();

CREATE OR REPLACE FUNCTION maxform_crm_sync_appointment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $crm_appointment$
DECLARE
  contact_record UUID := NEW.contact_id;
  company_record UUID;
BEGIN
  IF contact_record IS NULL THEN
    SELECT contact.id, contact.company_id
    INTO contact_record, company_record
    FROM contacts contact
    WHERE contact.created_by = NEW.user_id
      AND LOWER(contact.email) = LOWER(NEW.invitee_email)
    ORDER BY contact.updated_at DESC
    LIMIT 1;
  ELSE
    SELECT contact.company_id INTO company_record
    FROM contacts contact
    WHERE contact.id = contact_record AND contact.created_by = NEW.user_id;
  END IF;

  PERFORM maxform_crm_record_timeline(
    NEW.user_id, contact_record, company_record, NULL,
    CASE NEW.status WHEN 'cancelled' THEN 'appointment_cancelled'
      WHEN 'rescheduled' THEN 'appointment_rescheduled'
      ELSE 'appointment_booked' END,
    'appointments', NEW.id, 'appointment', NULL,
    CASE NEW.status WHEN 'cancelled' THEN 'Appointment cancelled'
      WHEN 'rescheduled' THEN 'Appointment rescheduled'
      ELSE 'Appointment booked' END,
    COALESCE(
      (SELECT page.name FROM booking_pages page WHERE page.id = NEW.booking_page_id),
      'Appointment'
    ) || ' · ' || NEW.starts_at,
    jsonb_build_object('bookingPageId', NEW.booking_page_id,
      'status', NEW.status, 'locationType', NEW.location_type,
      'meetingUrl', NEW.meeting_url),
    NEW.created_at, 'appointment:' || NEW.id::text || ':' || NEW.status
  );
  RETURN NEW;
END;
$crm_appointment$;

DROP TRIGGER IF EXISTS maxform_crm_sync_appointment
  ON appointments;

CREATE TRIGGER maxform_crm_sync_appointment
AFTER INSERT OR UPDATE OF contact_id, invitee_email, starts_at, status,
  meeting_url, updated_at
ON appointments
FOR EACH ROW
EXECUTE FUNCTION maxform_crm_sync_appointment();

CREATE OR REPLACE FUNCTION maxform_crm_sync_document()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $crm_document$
DECLARE
  company_record UUID;
  contact_record UUID := NEW.contact_id;
BEGIN
  IF contact_record IS NOT NULL THEN
    SELECT contact.company_id INTO company_record
    FROM contacts contact
    WHERE contact.id = contact_record AND contact.created_by = NEW.user_id;
  END IF;

  PERFORM maxform_crm_record_timeline(
    NEW.user_id, contact_record, company_record, NULL,
    'document_' || NEW.status, 'documents', NEW.id, 'document', NULL,
    'Document ' || REPLACE(NEW.status, '_', ' '), NEW.title,
    jsonb_build_object('documentId', NEW.id, 'status', NEW.status),
    NEW.updated_at, 'document:' || NEW.id::text || ':' || NEW.status
  );
  RETURN NEW;
END;
$crm_document$;

DROP TRIGGER IF EXISTS maxform_crm_sync_document
  ON workspace_documents;

CREATE TRIGGER maxform_crm_sync_document
AFTER INSERT OR UPDATE OF contact_id, title, status, updated_at
ON workspace_documents
FOR EACH ROW
EXECUTE FUNCTION maxform_crm_sync_document();

CREATE OR REPLACE FUNCTION maxform_crm_sync_campaign_message()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $crm_campaign_message$
DECLARE
  campaign_user UUID;
  campaign_name TEXT;
BEGIN
  SELECT campaign.user_id, campaign.name
  INTO campaign_user, campaign_name
  FROM contact_campaigns campaign
  WHERE campaign.id = NEW.campaign_id;

  PERFORM maxform_crm_record_timeline(
    campaign_user, NEW.contact_id, contact.company_id, NULL,
    'campaign_' || NEW.status, 'campaigns', NEW.id, 'campaign_message', NULL,
    'Campaign ' || REPLACE(NEW.status, '_', ' '),
    COALESCE(campaign_name, 'Campaign'),
    jsonb_build_object('campaignId', NEW.campaign_id, 'status', NEW.status,
      'sentAt', NEW.sent_at, 'openedAt', NEW.opened_at, 'clickedAt', NEW.clicked_at),
    COALESCE(NEW.sent_at, NEW.updated_at),
    'campaign_message:' || NEW.id::text || ':' || NEW.status
  )
  FROM contacts contact
  WHERE contact.id = NEW.contact_id
    AND contact.created_by = campaign_user;
  RETURN NEW;
END;
$crm_campaign_message$;

DROP TRIGGER IF EXISTS maxform_crm_sync_campaign_message
  ON contact_campaign_messages;

CREATE TRIGGER maxform_crm_sync_campaign_message
AFTER INSERT OR UPDATE OF contact_id, status, sent_at, opened_at, clicked_at,
  updated_at
ON contact_campaign_messages
FOR EACH ROW
EXECUTE FUNCTION maxform_crm_sync_campaign_message();

-- Checkout and event registration can be written before the contact upsert
-- finishes. When a contact later appears, link the existing source records so
-- the timeline is complete without requiring a second application workflow.
CREATE OR REPLACE FUNCTION maxform_crm_link_contact_sources()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $crm_link_contact_sources$
BEGIN
  UPDATE payment_orders
  SET contact_id = NEW.id, updated_at = NOW()
  WHERE user_id = NEW.created_by
    AND contact_id IS NULL
    AND LOWER(TRIM(customer_email)) = LOWER(TRIM(NEW.email));

  UPDATE appointments
  SET contact_id = NEW.id, updated_at = NOW()
  WHERE user_id = NEW.created_by
    AND contact_id IS NULL
    AND LOWER(TRIM(invitee_email)) = LOWER(TRIM(NEW.email));

  UPDATE event_attendees attendee
  SET updated_at = NOW()
  FROM events event
  WHERE event.id = attendee.event_id
    AND event.created_by = NEW.created_by
    AND LOWER(TRIM(attendee.email)) = LOWER(TRIM(NEW.email));

  RETURN NEW;
END;
$crm_link_contact_sources$;

DROP TRIGGER IF EXISTS maxform_crm_link_contact_sources
  ON contacts;

CREATE TRIGGER maxform_crm_link_contact_sources
AFTER INSERT OR UPDATE OF email
ON contacts
FOR EACH ROW
EXECUTE FUNCTION maxform_crm_link_contact_sources();

-- Backfill both the existing CRM history and source records created before
-- this migration. Every insert is idempotent and can safely be re-run.
INSERT INTO crm_timeline_events (
  user_id, contact_id, company_id, deal_id, event_type, source_module,
  related_record_id, related_record_type, actor_user_id, title, detail,
  metadata, occurred_at, dedupe_key, created_at
)
SELECT activity.user_id, activity.contact_id, contact.company_id,
  CASE WHEN activity.entity_type = 'deal' THEN activity.entity_id ELSE NULL END,
  activity.activity_type, maxform_crm_activity_source(activity.entity_type, activity.metadata),
  activity.entity_id, COALESCE(activity.entity_type, ''), activity.user_id,
  activity.title, activity.detail, COALESCE(activity.metadata, '{}'::jsonb),
  activity.created_at, 'contact_activity:' || activity.id::text, NOW()
FROM contact_activity activity
JOIN contacts contact ON contact.id = activity.contact_id
WHERE contact.created_by = activity.user_id
ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

INSERT INTO crm_timeline_events (
  user_id, contact_id, company_id, deal_id, event_type, source_module,
  related_record_id, related_record_type, actor_user_id, title, detail,
  metadata, occurred_at, dedupe_key, created_at
)
SELECT activity.user_id, activity.contact_id, activity.company_id,
  activity.deal_id, activity.activity_type, 'crm', activity.id,
  'crm_activity', activity.actor_user_id, activity.title, activity.detail,
  COALESCE(activity.metadata, '{}'::jsonb), activity.created_at,
  'crm_activity:' || activity.id::text, NOW()
FROM crm_activities activity
ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

INSERT INTO crm_timeline_events (
  user_id, contact_id, company_id, event_type, source_module,
  related_record_id, related_record_type, title, detail, metadata,
  occurred_at, dedupe_key, created_at
)
SELECT event.created_by, contact.id, contact.company_id, 'event_registered',
  'events', attendee.id, 'event_attendee', 'Event registration',
  event.title || ' · ' || COALESCE(ticket.name, 'Ticket'),
  jsonb_build_object('eventId', event.id, 'ticketType', ticket.name,
    'ticketNumber', attendee.ticket_number),
  attendee.created_at, 'event_attendee:' || attendee.id::text || ':registered', NOW()
FROM event_attendees attendee
JOIN events event ON event.id = attendee.event_id
LEFT JOIN event_ticket_types ticket ON ticket.id = attendee.ticket_type_id
JOIN contacts contact
  ON contact.created_by = event.created_by
 AND LOWER(contact.email) = LOWER(attendee.email)
WHERE attendee.checked_in_at IS NULL
ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

INSERT INTO crm_timeline_events (
  user_id, contact_id, company_id, event_type, source_module,
  related_record_id, related_record_type, title, detail, metadata,
  occurred_at, dedupe_key, created_at
)
SELECT event.created_by, contact.id, contact.company_id, 'event_checked_in',
  'events', attendee.id, 'event_attendee', 'Attendee checked in', event.title,
  jsonb_build_object('eventId', event.id, 'ticketNumber', attendee.ticket_number),
  attendee.checked_in_at, 'event_attendee:' || attendee.id::text || ':checked_in', NOW()
FROM event_attendees attendee
JOIN events event ON event.id = attendee.event_id
JOIN contacts contact
  ON contact.created_by = event.created_by
 AND LOWER(contact.email) = LOWER(attendee.email)
WHERE attendee.checked_in_at IS NOT NULL
ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

INSERT INTO crm_timeline_events (
  user_id, contact_id, company_id, event_type, source_module,
  related_record_id, related_record_type, title, detail, metadata,
  occurred_at, dedupe_key, created_at
)
SELECT appointment.user_id, contact.id, contact.company_id,
  CASE appointment.status WHEN 'cancelled' THEN 'appointment_cancelled'
    WHEN 'rescheduled' THEN 'appointment_rescheduled'
    ELSE 'appointment_booked' END,
  'appointments', appointment.id, 'appointment', 'Appointment ' || appointment.status,
  COALESCE(page.name, 'Appointment'),
  jsonb_build_object('bookingPageId', appointment.booking_page_id,
    'status', appointment.status), appointment.created_at,
  'appointment:' || appointment.id::text || ':' || appointment.status, NOW()
FROM appointments appointment
LEFT JOIN booking_pages page ON page.id = appointment.booking_page_id
JOIN contacts contact
  ON contact.created_by = appointment.user_id
 AND (contact.id = appointment.contact_id
      OR LOWER(contact.email) = LOWER(appointment.invitee_email))
ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

INSERT INTO crm_timeline_events (
  user_id, contact_id, company_id, event_type, source_module,
  related_record_id, related_record_type, title, detail, metadata,
  occurred_at, dedupe_key, created_at
)
SELECT document.user_id, contact.id, contact.company_id,
  'document_' || document.status, 'documents', document.id, 'document',
  'Document ' || REPLACE(document.status, '_', ' '), document.title,
  jsonb_build_object('documentId', document.id, 'status', document.status),
  document.updated_at, 'document:' || document.id::text || ':' || document.status, NOW()
FROM workspace_documents document
JOIN contacts contact
  ON contact.created_by = document.user_id
 AND (contact.id = document.contact_id
      OR EXISTS (
        SELECT 1 FROM document_signers signer
        WHERE signer.document_id = document.id
          AND LOWER(signer.email) = LOWER(contact.email)
      ))
ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

INSERT INTO crm_timeline_events (
  user_id, contact_id, company_id, event_type, source_module,
  related_record_id, related_record_type, title, detail, metadata,
  occurred_at, dedupe_key, created_at
)
SELECT campaign.user_id, contact.id, contact.company_id,
  'campaign_' || message.status, 'campaigns', message.id, 'campaign_message',
  'Campaign ' || REPLACE(message.status, '_', ' '), campaign.name,
  jsonb_build_object('campaignId', campaign.id, 'status', message.status),
  COALESCE(message.sent_at, message.updated_at),
  'campaign_message:' || message.id::text || ':' || message.status, NOW()
FROM contact_campaign_messages message
JOIN contact_campaigns campaign ON campaign.id = message.campaign_id
JOIN contacts contact
  ON contact.id = message.contact_id AND contact.created_by = campaign.user_id
ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'maxform_browser') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE crm_contact_relationships, crm_timeline_events, crm_audit_events
      TO maxform_browser;
  END IF;
END
$$;

COMMENT ON TABLE crm_timeline_events IS
  'Workspace-scoped event envelope for the CRM Customer 360 timeline; source modules remain authoritative.';

COMMENT ON TABLE crm_audit_events IS
  'Workspace-scoped CRM audit trail for record changes and governance reporting.';

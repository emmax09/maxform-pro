import { query } from "../src/lib/db";
import { configuredAppUrl } from "./app-url";
import {
  getEmailWorkspace,
} from "./workspace-email";
import { scheduleEmail, sendEmailNow } from "./email-service";
import { createEventTicketDownloadToken } from "./event-ticket-download";

type Row = Record<string, unknown>;

const text = (value: unknown) => value == null ? "" : String(value);
const bool = (value: unknown) => value === true || value === "t" || value === 1;
const emailPattern = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const publicOrigin = () => configuredAppUrl();
const publicUrl = (path: string) => `${publicOrigin()}${path}`;
const json = <T>(value: unknown, fallback: T): T => {
  if (value && typeof value === "object") return value as T;
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? parsed as T : fallback;
  } catch {
    return fallback;
  }
};

const definitions = [
  ["event_registration_confirmation", "Registration confirmation", "Sent when a registration is accepted."],
  ["event_payment_confirmation", "Payment confirmation", "Sent after a paid registration is confirmed."],
  ["event_ticket_confirmation", "Ticket confirmation", "Sent when a ticket registration is confirmed."],
  ["event_ticket_delivery", "Ticket delivery", "Sent after successful verified checkout when purchased ticket files have been issued."],
  ["event_reminder", "Event reminder", "Scheduled before the event starts."],
  ["event_online_access", "Online access", "Contains the attendee meeting link when applicable."],
  ["event_schedule_update", "Schedule update", "Sent when the event schedule changes."],
  ["event_updated", "Event updated", "Sent when published event details change."],
  ["event_rescheduled", "Event rescheduled", "Sent when the event date or time changes."],
  ["event_cancelled", "Event cancelled", "Sent when the event is cancelled."],
  ["event_checkin_confirmation", "Check-in confirmation", "Sent after an attendee is checked in."],
  ["event_refund_confirmation", "Refund confirmation", "Sent after a ticket refund is completed."],
  ["event_waitlist_confirmation", "Waitlist confirmation", "Sent when an attendee joins the waitlist."],
  ["event_waitlist_promoted", "Waitlist promotion", "Sent when a waitlisted attendee gets a place."],
] as const;

const definitionFor = (key: string) => definitions.find(([candidate]) => candidate === key);

const safeTemplate = (row: Row | undefined) => row ? {
  id: text(row.id),
  key: text(row.key),
  module: text(row.module),
  name: text(row.name),
  subject: text(row.subject),
  htmlBody: text(row.html_body),
  textBody: text(row.text_body),
  blocks: json<unknown[]>(row.blocks, []),
  identityId: text(row.identity_id) || null,
  isCustom: bool(row.is_custom),
  updatedAt: text(row.updated_at),
} : null;

const eventContext = async (userId: string, eventId: string) => {
  const result = await query(`
    SELECT event.id, event.ticketing_enabled, event.location_type,
      event.waitlist_enabled, event.settings,
      EXISTS (
        SELECT 1 FROM event_ticket_types ticket
        WHERE ticket.event_id = event.id AND ticket.active = TRUE AND ticket.price > 0
      ) AS has_paid_tickets,
      EXISTS (
        SELECT 1 FROM event_ticket_types ticket
        WHERE ticket.event_id = event.id
      ) AS has_ticket_types,
      COALESCE(pricing.enabled = TRUE AND pricing.amount > 0, FALSE) AS has_paid_registration
    FROM events event
    LEFT JOIN event_pricing pricing ON pricing.event_id = event.id
    WHERE event.id = $1 AND event.created_by = $2
    LIMIT 1
  `, [eventId, userId]);
  const event = result.rows[0] as Row | undefined;
  if (!event) throw new Error("Event was not found.");
  return event;
};

const applicable = (key: string, event: Row) => {
  if (["event_payment_confirmation", "event_refund_confirmation"].includes(key)) return bool(event.has_paid_tickets) || bool(event.has_paid_registration);
  if (["event_ticket_confirmation", "event_ticket_delivery", "event_checkin_confirmation"].includes(key)) return bool(event.ticketing_enabled) || bool(event.has_ticket_types);
  if (key === "event_online_access") return ["online", "hybrid"].includes(text(event.location_type));
  if (["event_waitlist_confirmation", "event_waitlist_promoted"].includes(key)) return bool(event.waitlist_enabled);
  return true;
};

const eventMailEnabled = (settings: unknown, key: string) => {
  const parsed = json<Record<string, unknown>>(settings, {});
  const mailSettings = parsed.mailSettings && typeof parsed.mailSettings === "object"
    ? parsed.mailSettings as Row
    : {};
  const value = mailSettings[key];
  return value && typeof value === "object"
    ? (value as Row).enabled !== false
    : value !== false;
};

export const listEventMailSettings = async (userId: string, eventId: string) => {
  const event = await eventContext(userId, eventId);
  const workspace = await getEmailWorkspace(userId, {});
  const templates = (workspace.templates || []) as unknown as Row[];
  const settings = json<Record<string, unknown>>(event.settings, {});
  const enabledMap = settings.mailSettings && typeof settings.mailSettings === "object"
    ? settings.mailSettings as Row
    : {};
  return definitions.map(([key, name, description]) => {
    const global = templates.find((template) => text(template.key) === key && text(template.module) === "events");
    const setting = enabledMap[key];
    const enabled = typeof setting === "object" && setting !== null
      ? (setting as Row).enabled !== false
      : setting !== false;
    return {
      key,
      name,
      description,
      enabled,
      applicable: applicable(key, event),
      reminderHours: key === "event_reminder" && typeof setting === "object" && setting !== null
        ? Math.min(168, Math.max(1, Number((setting as Row).hoursBefore || 24) || 24))
        : undefined,
      template: safeTemplate(global),
    };
  });
};

export const toggleEventMailSetting = async (userId: string, eventId: string, key: string, enabled: boolean) => {
  const definition = definitionFor(key);
  if (!definition) throw new Error("That event email is not available.");
  const event = await eventContext(userId, eventId);
  const settings = json<Record<string, unknown>>(event.settings, {});
  const mailSettings = settings.mailSettings && typeof settings.mailSettings === "object"
    ? settings.mailSettings as Row
    : {};
  await query(`UPDATE events SET settings = $1::jsonb, updated_at = NOW() WHERE id = $2 AND created_by = $3`, [JSON.stringify({ ...settings, mailSettings: { ...mailSettings, [key]: { enabled: enabled === true } } }), eventId, userId]);
  return { updated: true };
};

export const setEventReminderHours = async (userId: string, eventId: string, hoursBefore: number) => {
  const event = await eventContext(userId, eventId);
  const hours = Math.min(168, Math.max(1, Math.round(Number(hoursBefore) || 24)));
  const settings = json<Record<string, unknown>>(event.settings, {});
  const mailSettings = settings.mailSettings && typeof settings.mailSettings === "object"
    ? settings.mailSettings as Row
    : {};
  const current = mailSettings.event_reminder && typeof mailSettings.event_reminder === "object"
    ? mailSettings.event_reminder as Row
    : { enabled: mailSettings.event_reminder !== false };
  await query(
    `UPDATE events SET settings = $1::jsonb, updated_at = NOW() WHERE id = $2 AND created_by = $3`,
    [JSON.stringify({ ...settings, mailSettings: { ...mailSettings, event_reminder: { ...current, hoursBefore: hours } } }), eventId, userId],
  );
  return { hoursBefore: hours };
};

/** Send attendee lifecycle messages after the ticket/order transaction has
 * completed. A ticket order is one delivery unit: the purchaser receives one
 * message containing every issued ticket, even when the order contains a
 * quantity greater than one. Delivery failures are intentionally isolated
 * from ticket issuance; the email log/provider retry path remains
 * authoritative. */
export const sendEventAttendeeEmailsNow = async (eventId: string, attendeeId: string, paid = false) => {
  const result = await query(`
    SELECT attendee.id, attendee.event_id, attendee.email, attendee.full_name,
      attendee.ticket_number, attendee.ticket_code, attendee.ticket_type_id,
      attendee.issued_at,
      ticket.name AS ticket_type, ticket.price AS ticket_price, ticket.currency,
      event.created_by, event.status, event.title, event.description, event.slug,
      event.event_date, event.schedule_start_time, event.schedule_end_time,
      event.timezone, event.location_type, event.venue_name, event.address,
      event.online_url, event.settings, event.event_code, owner.short_id,
      COALESCE(event_preferences.support_email, '') AS support_email,
      event_order.id AS event_order_id,
      event_order.status AS event_order_status,
      event_order.purchaser_email, event_order.purchaser_name,
      event_order.total_amount AS event_order_total_amount,
      event_order.currency AS event_order_currency,
      payment.order_number, payment.total_amount, payment.currency AS payment_currency,
      checkout.idempotency_key AS checkout_key
    FROM event_attendees attendee
    JOIN events event ON event.id = attendee.event_id
    JOIN users owner ON owner.id = event.created_by
    LEFT JOIN event_module_preferences event_preferences
      ON event_preferences.user_id = event.created_by
    LEFT JOIN event_ticket_types ticket ON ticket.id = attendee.ticket_type_id
    LEFT JOIN event_orders event_order ON event_order.id = attendee.order_id
    LEFT JOIN payments event_payment ON event_payment.id = event_order.payment_id
    LEFT JOIN payment_orders payment ON payment.id = event_payment.order_id
    LEFT JOIN LATERAL (
      SELECT attempt.idempotency_key
      FROM checkout_attempts attempt
      WHERE attempt.order_id = payment.id
        AND attempt.status = 'confirmed'
      ORDER BY attempt.confirmed_at DESC NULLS LAST, attempt.created_at DESC
      LIMIT 1
    ) checkout ON TRUE
    WHERE attendee.id = $1 AND attendee.event_id = $2
      AND attendee.ticket_status IN ('valid', 'transferred')
    LIMIT 1
  `, [attendeeId, eventId]);
  const row = result.rows[0] as Row | undefined;
  if (!row || !text(row.ticket_code)) return;

  const orderId = text(row.event_order_id);
  const ticketRows = orderId
    ? await query(`
        SELECT attendee.id, attendee.email, attendee.full_name,
          attendee.ticket_number, attendee.ticket_code, attendee.issued_at,
          ticket.name AS ticket_type, ticket.price AS ticket_price, ticket.currency
        FROM event_attendees attendee
        LEFT JOIN event_ticket_types ticket ON ticket.id = attendee.ticket_type_id
        WHERE attendee.event_id = $1
          AND attendee.order_id = $2
          AND attendee.ticket_status IN ('valid', 'transferred')
          AND attendee.ticket_code IS NOT NULL
        ORDER BY attendee.created_at, attendee.id
      `, [eventId, orderId])
    : { rows: [row] };
  // The purchaser must receive every ticket in the order even when tickets
  // were assigned to different attendees or an attendee email is blank. The
  // purchaser address is validated separately below; filtering this list by
  // attendee.email silently dropped tickets from otherwise valid orders.
  const purchasedTickets = (ticketRows.rows as Row[]).filter((ticket) =>
    text(ticket.ticket_code),
  );
  if (!purchasedTickets.length) return;
  const relatedTicketIds = purchasedTickets
    .map((ticket) => text(ticket.id))
    .filter((id) => uuidPattern.test(id));

  const primaryTicket = purchasedTickets.find((ticket) => text(ticket.id) === attendeeId) || purchasedTickets[0];
  const onlineAccess = ["published", "on_sale", "sold_out", "past"].includes(text(row.status)) &&
    ["online", "hybrid"].includes(text(row.location_type)) && Boolean(text(row.online_url));
  const eventUrl = `/event/${encodeURIComponent(text(row.short_id))}/${encodeURIComponent(text(row.slug))}`;
  const checkoutUrl = text(row.checkout_key)
    ? publicUrl(`/payments/verify/${encodeURIComponent(text(row.checkout_key))}`)
    : "";
  const freeOrderToken = !checkoutUrl
    ? createEventTicketDownloadToken({
        eventId,
        ...(orderId ? { orderId } : { attendeeId: text(primaryTicket.id) }),
      })
    : "";
  const orderSummaryUrl = checkoutUrl || publicUrl(`/ticket/${encodeURIComponent(freeOrderToken)}`);
  const ticketItems = purchasedTickets.map((ticket) => ({
    holder: text(ticket.full_name),
    type: text(ticket.ticket_type) || "Admission",
    number: text(ticket.ticket_number),
    code: text(ticket.ticket_code),
    price: Number(ticket.ticket_price || 0),
    currency: text(ticket.currency) || "USD",
    downloadUrl: orderSummaryUrl,
  }));
  const deliveryVersion = purchasedTickets
    .map((ticket) => text(ticket.issued_at))
    .filter(Boolean)
    .sort()
    .at(-1) || "issued";
  const eventSettings = json<Record<string, unknown>>(row.settings, {});
  const mailSettings = eventSettings.mailSettings && typeof eventSettings.mailSettings === "object"
    ? eventSettings.mailSettings as Row
    : {};
  const deliverySettingIsExplicit = Object.prototype.hasOwnProperty.call(mailSettings, "event_ticket_delivery");
  const deliveryEnabled = eventMailEnabled(row.settings, "event_ticket_delivery") &&
    (deliverySettingIsExplicit || eventMailEnabled(row.settings, "event_ticket_confirmation"));
  const attendeeLevelDelivery = eventSettings.attendeeTicketDelivery === true ||
    (eventSettings.ticketDelivery && typeof eventSettings.ticketDelivery === "object" &&
      (eventSettings.ticketDelivery as Row).attendeeLevel === true);
  const purchaserEmail = emailPattern.test(text(row.purchaser_email))
    ? text(row.purchaser_email).trim().toLowerCase()
    : text(primaryTicket.email).trim().toLowerCase();
  const purchaserName = text(row.purchaser_name) || text(primaryTicket.full_name) || "Attendee";
  const order = {
    number: text(row.order_number) || (orderId ? `Event order ${orderId.slice(0, 8).toUpperCase()}` : ""),
    total: Number(row.total_amount ?? row.event_order_total_amount ?? 0),
    currency: text(row.payment_currency) || text(row.event_order_currency) || text(primaryTicket.currency) || "USD",
    summaryUrl: orderSummaryUrl,
  };
  const variablesFor = (recipient: string, name: string, tickets: typeof ticketItems) => {
    const selected = tickets[0] || ticketItems[0];
    return {
      contact: { name, email: recipient },
      attendee: { fullName: name, email: recipient },
      event: {
        name: text(row.title),
        description: text(row.description),
        format: text(row.location_type),
        date: text(row.event_date),
        startTime: text(row.schedule_start_time),
        endTime: text(row.schedule_end_time),
        timezone: text(row.timezone) || "UTC",
        location: text(row.venue_name) || (onlineAccess ? "Online event" : text(row.address)),
        onlineLink: onlineAccess ? text(row.online_url) : "",
        calendarUrl: orderSummaryUrl || publicUrl(eventUrl),
        onlineAccess,
        attendeeMeetingLink: onlineAccess ? text(row.online_url) : "",
        meetingProvider: onlineAccess ? "Online meeting" : "",
        supportEmail: text(row.support_email),
      },
      ticket: {
        holder: selected.holder,
        type: selected.type,
        number: selected.number,
        code: selected.code,
        quantity: tickets.length,
        price: selected.price,
        currency: selected.currency,
        downloadUrl: orderSummaryUrl,
        checkInInstructions: "Present this ticket at the event entrance for validation.",
      },
      tickets: {
        quantity: tickets.length,
        summary: tickets.map((ticket) => `${ticket.type} · ${ticket.number}`).join(" | "),
        numbers: tickets.map((ticket) => ticket.number).filter(Boolean).join(", "),
        codes: tickets.map((ticket) => ticket.code).filter(Boolean).join(", "),
        items: tickets,
      },
      order,
    };
  };
  const variables = {
    ...variablesFor(purchaserEmail, purchaserName, ticketItems),
  };
  const jobs: Promise<unknown>[] = [];
  if (deliveryEnabled && purchaserEmail) jobs.push(sendEmailNow({
    userId: text(row.created_by),
    templateKey: "event_ticket_delivery",
    to: purchaserEmail,
    sourceEventId: eventId,
    relatedTicketIds,
    idempotencyKey: `event-ticket-delivery:${eventId}:${orderId || attendeeId}:${deliveryVersion}`,
    variables,
  }));
  if (attendeeLevelDelivery && text(row.email).trim().toLowerCase() !== purchaserEmail && emailPattern.test(text(row.email))) {
    const assignedTicket = ticketItems.find((ticket) => text(ticket.number) === text(row.ticket_number)) || ticketItems[0];
    if (!assignedTicket) return;
    const attendeeToken = createEventTicketDownloadToken({
      eventId,
      attendeeId,
    });
    jobs.push(sendEmailNow({
      userId: text(row.created_by),
      templateKey: "event_ticket_delivery",
      to: text(row.email).trim().toLowerCase(),
      sourceEventId: eventId,
      relatedTicketIds: uuidPattern.test(attendeeId) ? [attendeeId] : [],
      idempotencyKey: `event-ticket-delivery:${eventId}:${orderId || attendeeId}:${deliveryVersion}:attendee:${attendeeId}`,
      variables: variablesFor(
        text(row.email).trim().toLowerCase(),
        text(row.full_name) || "Attendee",
        [{ ...assignedTicket, downloadUrl: publicUrl(`/ticket/${encodeURIComponent(attendeeToken)}`) }],
      ),
    }));
  }
  if (paid && eventMailEnabled(row.settings, "event_payment_confirmation")) jobs.push(sendEmailNow({
    userId: text(row.created_by),
    templateKey: "event_payment_confirmation",
    to: purchaserEmail,
    sourceEventId: eventId,
    relatedTicketIds,
    idempotencyKey: `event-payment-confirmation:${eventId}:${orderId || attendeeId}`,
    variables,
  }));
  if (onlineAccess && eventMailEnabled(row.settings, "event_online_access") && purchaserEmail) jobs.push(sendEmailNow({
    userId: text(row.created_by),
    templateKey: "event_online_access",
    to: purchaserEmail,
    sourceEventId: eventId,
    relatedTicketIds,
    idempotencyKey: `event-online-access:${eventId}:${orderId || attendeeId}`,
    variables,
  }));
  await Promise.allSettled(jobs);
};

/** Send lifecycle messages for an event registration that does not create a
 * ticket instance (for example a free RSVP or a paid event-price checkout).
 * The submission id is the stable occurrence key, so retries cannot send a
 * second confirmation. */
export const sendEventRegistrationEmailNow = async (eventId: string, submissionId: string, paid = false) => {
  const result = await query(`
    SELECT event.id, event.created_by, event.status, event.title, event.description, event.slug,
      event.event_date, event.schedule_start_time, event.schedule_end_time,
      event.timezone, event.location_type, event.venue_name, event.address,
      event.online_url, event.settings, event.event_code, owner.short_id,
      submission.data AS submission_data, form.fields AS form_fields,
      form_settings.live_snapshot
    FROM events event
    JOIN users owner ON owner.id = event.created_by
    JOIN forms form ON form.id = event.registration_form_id
    LEFT JOIN form_settings ON form_settings.form_id = form.id
    JOIN form_submissions submission
      ON submission.id = $2 AND submission.form_id = form.id
    WHERE event.id = $1
    LIMIT 1
  `, [eventId, submissionId]);
  const row = result.rows[0] as Row | undefined;
  if (!row) return;
  const answers = json<Record<string, unknown>>(row.submission_data, {});
  const snapshot = json<Record<string, unknown>>(row.live_snapshot, {});
  const snapshotFields = Array.isArray(snapshot.fields) ? snapshot.fields : [];
  const fields = (snapshotFields.length ? snapshotFields : json<unknown[]>(row.form_fields, []))
    .filter((field): field is Row => Boolean(field && typeof field === "object" && !Array.isArray(field)));
  // Annotated because it recurses through its own map(): without a declared
  // return type the compiler cannot infer one and falls back to `any`.
  const valueText = (value: unknown): string => {
    if (value == null) return "";
    if (typeof value === "string" || typeof value === "number") return String(value).trim();
    if (Array.isArray(value)) return value.map(valueText).filter(Boolean).join(", ");
    return "";
  };
  const emailPattern = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
  const emailField = fields.find((field) => text(field.type).toLowerCase() === "email");
  const email = valueText(emailField ? answers[text(emailField.id)] : "") || Object.values(answers).map(valueText).find((value) => emailPattern.test(value)) || "";
  if (!emailPattern.test(email)) return;
  const labelOf = (field: Row) => `${text(field.label)} ${text(field.name)}`.toLowerCase();
  const firstField = fields.find((field) => /\bfirst\b/.test(labelOf(field)));
  const lastField = fields.find((field) => /\blast\b|surname/.test(labelOf(field)));
  const fullField = fields.find((field) => /full.?name|attendee.?name|your name/.test(labelOf(field)));
  const firstName = valueText(firstField ? answers[text(firstField.id)] : "");
  const lastName = valueText(lastField ? answers[text(lastField.id)] : "");
  const fullName = valueText(fullField ? answers[text(fullField.id)] : "") || [firstName, lastName].filter(Boolean).join(" ") || "Attendee";
  const settings = json<Record<string, unknown>>(row.settings, {});
  const meetingIntegration = settings.meetingIntegration && typeof settings.meetingIntegration === "object" ? settings.meetingIntegration as Row : {};
  const locationType = text(row.location_type);
  const onlineAccess = ["published", "on_sale", "sold_out", "past"].includes(text(row.status)) &&
    ["online", "hybrid"].includes(locationType) && Boolean(text(row.online_url));
  const eventUrl = `/event/${encodeURIComponent(text(row.short_id))}/${encodeURIComponent(text(row.slug))}`;
  const variables = {
    contact: { name: fullName, email },
    event: {
      name: text(row.title),
      description: text(row.description),
      format: locationType,
      date: text(row.event_date),
      startTime: text(row.schedule_start_time),
      endTime: text(row.schedule_end_time),
      timezone: text(row.timezone) || "UTC",
      location: locationType === "online" ? "Online event" : [text(row.venue_name), text(row.address)].filter(Boolean).join(", ") || (locationType === "hybrid" ? "Hybrid event" : "Venue to be announced"),
      calendarUrl: eventUrl,
      onlineAccess,
      attendeeMeetingLink: onlineAccess ? text(row.online_url) : "",
      meetingProvider: onlineAccess ? text(meetingIntegration.providerLabel || meetingIntegration.provider) : "",
    },
    ticket: { holder: fullName, type: "", number: "", code: "", price: 0, currency: "" },
    order: { number: "", total: 0 },
  };
  const jobs: Promise<unknown>[] = [];
  if (eventMailEnabled(row.settings, "event_registration_confirmation")) jobs.push(sendEmailNow({
    userId: text(row.created_by),
    templateKey: "event_registration_confirmation",
    to: email,
    sourceEventId: eventId,
    idempotencyKey: `event-registration-confirmation:${eventId}:${submissionId}`,
    variables,
  }));
  if (paid && eventMailEnabled(row.settings, "event_payment_confirmation")) jobs.push(sendEmailNow({
    userId: text(row.created_by),
    templateKey: "event_payment_confirmation",
    to: email,
    sourceEventId: eventId,
    idempotencyKey: `event-payment-confirmation:${eventId}:${submissionId}`,
    variables,
  }));
  if (onlineAccess && eventMailEnabled(row.settings, "event_online_access")) jobs.push(sendEmailNow({
    userId: text(row.created_by),
    templateKey: "event_online_access",
    to: email,
    sourceEventId: eventId,
    idempotencyKey: `event-online-access:${eventId}:${submissionId}`,
    variables,
  }));
  await Promise.allSettled(jobs);
};

/** Notify every registered attendee when an event is cancelled. Ticketed
 * attendees and simple event registrations use the same event template and
 * idempotency key shape, so a retry cannot send a second cancellation notice. */
export const sendEventCancellationEmailsNow = async (eventId: string) => {
  const eventResult = await query(`
    SELECT event.id, event.created_by, event.title, event.description, event.slug,
      event.event_date, event.range_start_date, event.schedule_start_time,
      event.schedule_end_time, event.timezone, event.location_type,
      event.venue_name, event.address, event.settings, event.event_code,
      owner.short_id
    FROM events event
    JOIN users owner ON owner.id = event.created_by
    WHERE event.id = $1
    LIMIT 1
  `, [eventId]);
  const event = eventResult.rows[0] as Row | undefined;
  if (!event) return;
  const [attendeeResult, registrationResult] = await Promise.all([
    query(`
      SELECT attendee.id AS attendee_id, attendee.email, attendee.full_name, attendee.ticket_number,
        attendee.ticket_code, ticket.name AS ticket_type,
        ticket.price AS ticket_price, ticket.currency, payment.order_number,
        payment.total_amount, COALESCE(payment.currency, event_order.currency) AS payment_currency
      FROM event_attendees attendee
      LEFT JOIN event_ticket_types ticket ON ticket.id = attendee.ticket_type_id
      LEFT JOIN event_orders event_order ON event_order.id = attendee.order_id
      LEFT JOIN payments event_payment ON event_payment.id = event_order.payment_id
      LEFT JOIN payment_orders payment ON payment.id = event_payment.order_id
      WHERE attendee.event_id = $1
        AND attendee.email IS NOT NULL
        AND attendee.email <> ''
        AND attendee.ticket_status IN ('valid', 'transferred')
    `, [eventId]),
    query(`
      SELECT submission.data AS submission_data, form.fields AS form_fields,
        form_settings.live_snapshot
      FROM events event
      JOIN forms form ON form.id = event.registration_form_id
      LEFT JOIN form_settings ON form_settings.form_id = form.id
      JOIN form_submissions submission ON submission.form_id = form.id
      WHERE event.id = $1
        AND event.ticketing_enabled = FALSE
        AND COALESCE(submission.data #>> '{_meta,status}', 'completed') = 'completed'
    `, [eventId]),
  ]);
  const eventSettings = json<Record<string, unknown>>(event.settings, {});
  const meetingIntegration = eventSettings.meetingIntegration && typeof eventSettings.meetingIntegration === "object"
    ? eventSettings.meetingIntegration as Row
    : {};
  const eventUrl = `/event/${encodeURIComponent(text(event.short_id))}/${encodeURIComponent(text(event.slug))}`;
  const date = text(event.event_date) || text(event.range_start_date);
  const locationType = text(event.location_type);
  const location = locationType === "online"
    ? "Online event"
    : [text(event.venue_name), text(event.address)].filter(Boolean).join(", ") || (locationType === "hybrid" ? "Hybrid event" : "Venue to be announced");
  const sent = new Set<string>();
  const jobs: Promise<unknown>[] = [];
  const addRecipientDelivery = (input: { email: string; name: string; ticket?: Row; order?: Row; ticketInstanceIds?: string[] }) => {
    const email = text(input.email).trim().toLowerCase();
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) || sent.has(email)) return;
    sent.add(email);
    const ticket = input.ticket || {};
    const order = input.order || {};
    jobs.push(sendEmailNow({
      userId: text(event.created_by),
      templateKey: "event_cancelled",
      to: email,
      sourceEventId: eventId,
      relatedTicketIds: (input.ticketInstanceIds || []).filter((id) => uuidPattern.test(id)),
      idempotencyKey: `event-cancelled:${eventId}:${email}`,
      variables: {
        contact: { name: text(input.name) || "Attendee", email },
        event: {
          name: text(event.title),
          description: text(event.description),
          format: locationType,
          date,
          startTime: text(event.schedule_start_time),
          endTime: text(event.schedule_end_time),
          timezone: text(event.timezone) || "UTC",
          location,
          calendarUrl: eventUrl,
          attendeeMeetingLink: "",
          onlineAccess: false,
          meetingProvider: text(meetingIntegration.providerLabel || meetingIntegration.provider),
          cancellationReason: text(eventSettings.cancellationReason),
        },
        ticket: {
          holder: text(input.name),
          type: text(ticket.ticket_type),
          number: text(ticket.ticket_number),
          code: text(ticket.ticket_code),
          price: Number(ticket.ticket_price || 0),
          currency: text(ticket.currency) || "USD",
        },
        order: {
          number: text(order.order_number),
          total: Number(order.total_amount || 0),
        },
      },
    }));
  };
  for (const row of attendeeResult.rows as Row[]) {
    addRecipientDelivery({
      email: text(row.email),
      name: text(row.full_name),
      ticket: row,
      order: row,
      ticketInstanceIds: uuidPattern.test(text(row.attendee_id)) ? [text(row.attendee_id)] : [],
    });
  }
  // Annotated because it recurses through its own map(): without a declared
  // return type the compiler cannot infer one and falls back to `any`.
  const valueText = (value: unknown): string => {
    if (value == null) return "";
    if (typeof value === "string" || typeof value === "number") return String(value).trim();
    if (Array.isArray(value)) return value.map(valueText).filter(Boolean).join(", ");
    return "";
  };
  const emailPattern = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
  for (const row of registrationResult.rows as Row[]) {
    const answers = json<Record<string, unknown>>(row.submission_data, {});
    const snapshot = json<Record<string, unknown>>(row.live_snapshot, {});
    const snapshotFields = Array.isArray(snapshot.fields) ? snapshot.fields : [];
    const fields = (snapshotFields.length ? snapshotFields : json<unknown[]>(row.form_fields, []))
      .filter((field): field is Row => Boolean(field && typeof field === "object" && !Array.isArray(field)));
    const emailField = fields.find((field) => text(field.type).toLowerCase() === "email");
    const email = valueText(emailField ? answers[text(emailField.id)] : "") || Object.values(answers).map(valueText).find((value) => emailPattern.test(value)) || "";
    const nameField = fields.find((field) => /full.?name|attendee.?name|your name/i.test(`${text(field.label)} ${text(field.name)}`));
    addRecipientDelivery({ email, name: valueText(nameField ? answers[text(nameField.id)] : "") });
  }
  await Promise.allSettled(jobs);
};

type LifecycleRecipient = {
  key: string;
  email: string;
  name: string;
  ticket?: Row;
  order?: Row;
  ticketInstanceIds?: string[];
};

const eventLifecycleContext = async (eventId: string) => {
  const result = await query(`
    SELECT event.id, event.created_by, event.title, event.description, event.slug,
      event.event_date, event.range_start_date, event.schedule_start_time,
      event.schedule_end_time, event.starts_at, event.timezone,
      event.location_type, event.venue_name, event.address, event.online_url,
      event.settings, event.event_code, event.updated_at, owner.short_id
    FROM events event
    JOIN users owner ON owner.id = event.created_by
    WHERE event.id = $1
    LIMIT 1
  `, [eventId]);
  return result.rows[0] as Row | undefined;
};

const valueText = (value: unknown): string => {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (Array.isArray(value)) return value.map(valueText).filter(Boolean).join(", ");
  return "";
};

const submissionRecipient = (row: Row): LifecycleRecipient | null => {
  const answers = json<Record<string, unknown>>(row.submission_data, {});
  const snapshot = json<Record<string, unknown>>(row.live_snapshot, {});
  const snapshotFields = Array.isArray(snapshot.fields) ? snapshot.fields : [];
  const fields = (snapshotFields.length ? snapshotFields : json<unknown[]>(row.form_fields, []))
    .filter((field): field is Row => Boolean(field && typeof field === "object" && !Array.isArray(field)));
  const emailField = fields.find((field) => text(field.type).toLowerCase() === "email");
  const email = valueText(emailField ? answers[text(emailField.id)] : "") || Object.values(answers).map(valueText).find((value) => emailPattern.test(value)) || "";
  if (!emailPattern.test(email)) return null;
  const labelOf = (field: Row) => `${text(field.label)} ${text(field.name)}`.toLowerCase();
  const fullField = fields.find((field) => /full.?name|attendee.?name|your name/.test(labelOf(field)));
  const firstField = fields.find((field) => /\bfirst\b/.test(labelOf(field)));
  const lastField = fields.find((field) => /\blast\b|surname/.test(labelOf(field)));
  const firstName = valueText(firstField ? answers[text(firstField.id)] : "");
  const lastName = valueText(lastField ? answers[text(lastField.id)] : "");
  return {
    key: `submission:${text(row.submission_id)}`,
    email: email.toLowerCase(),
    name: valueText(fullField ? answers[text(fullField.id)] : "") || [firstName, lastName].filter(Boolean).join(" ") || "Attendee",
  };
};

const lifecycleVariables = (
  event: Row,
  recipient: LifecycleRecipient,
  templateKey: string,
) => {
  const settings = json<Record<string, unknown>>(event.settings, {});
  const meetingIntegration = settings.meetingIntegration && typeof settings.meetingIntegration === "object"
    ? settings.meetingIntegration as Row
    : {};
  const locationType = text(event.location_type);
  const date = text(event.event_date) || text(event.range_start_date);
  const onlineAccess = ["online", "hybrid"].includes(locationType) &&
    Boolean(text(event.online_url)) &&
    ["event_reminder", "event_online_access"].includes(templateKey);
  const eventUrl = `/event/${encodeURIComponent(text(event.short_id))}/${encodeURIComponent(text(event.slug))}`;
  const ticket = recipient.ticket || {};
  const order = recipient.order || {};
  return {
    contact: { name: recipient.name || "Attendee", email: recipient.email },
    event: {
      name: text(event.title),
      description: text(event.description),
      format: locationType,
      date,
      startTime: text(event.schedule_start_time),
      endTime: text(event.schedule_end_time),
      timezone: text(event.timezone) || "UTC",
      location: locationType === "online"
        ? "Online event"
        : [text(event.venue_name), text(event.address)].filter(Boolean).join(", ") || (locationType === "hybrid" ? "Hybrid event" : "Venue to be announced"),
      calendarUrl: eventUrl,
      onlineAccess,
      attendeeMeetingLink: onlineAccess ? text(event.online_url) : "",
      meetingProvider: text(meetingIntegration.providerLabel || meetingIntegration.provider),
      cancellationReason: text(settings.cancellationReason),
    },
    ticket: {
      holder: recipient.name,
      type: text(ticket.ticket_type),
      number: text(ticket.ticket_number),
      code: text(ticket.ticket_code),
      price: Number(ticket.ticket_price || 0),
      currency: text(ticket.currency) || "USD",
    },
    order: {
      number: text(order.order_number),
      total: Number(order.total_amount || 0),
    },
  };
};

const sendEventLifecycle = async (
  eventId: string,
  templateKey: string,
  recipients: LifecycleRecipient[],
  occurrence: string,
  scheduledFor?: string | Date | null,
) => {
  const event = await eventLifecycleContext(eventId);
  if (!event || !eventMailEnabled(event.settings, templateKey)) return;
  const seen = new Set<string>();
  const sendAt = scheduledFor ? new Date(scheduledFor).getTime() : Number.NaN;
  const scheduled = Number.isFinite(sendAt) && sendAt > Date.now() + 1_000;
  const jobs = recipients.flatMap((recipient) => {
    const email = text(recipient.email).trim().toLowerCase();
    if (!emailPattern.test(email) || seen.has(email)) return [];
    seen.add(email);
    const input = {
      userId: text(event.created_by),
      templateKey,
      to: email,
      sourceEventId: eventId,
      idempotencyKey: `event-${templateKey}:${eventId}:${recipient.key}:${occurrence}`,
      ...(scheduled ? { scheduledFor } : {}),
      relatedTicketIds: (recipient.ticketInstanceIds || []).filter((id) => uuidPattern.test(id)),
      variables: lifecycleVariables(event, { ...recipient, email }, templateKey),
    };
    return [scheduled ? scheduleEmail(input) : sendEmailNow(input)];
  });
  await Promise.allSettled(jobs);
};

const eventAttendeeRecipients = async (eventId: string, orderId = "", includeRefunded = false) => {
  const result = await query(`
    SELECT attendee.id AS attendee_id, attendee.email, attendee.full_name,
      attendee.ticket_number, attendee.ticket_code,
      ticket.name AS ticket_type, ticket.price AS ticket_price,
      ticket.currency, payment.order_number, payment.total_amount,
      COALESCE(payment.currency, event_order.currency) AS payment_currency
    FROM event_attendees attendee
    LEFT JOIN event_ticket_types ticket ON ticket.id = attendee.ticket_type_id
    LEFT JOIN event_orders event_order ON event_order.id = attendee.order_id
    LEFT JOIN payments event_payment ON event_payment.id = event_order.payment_id
    LEFT JOIN payment_orders payment ON payment.id = event_payment.order_id
    WHERE attendee.event_id = $1
      AND ($2::uuid IS NULL OR attendee.order_id = $2::uuid)
      AND attendee.email IS NOT NULL AND attendee.email <> ''
      AND (
        attendee.ticket_status IN ('valid', 'transferred')
        OR ($3::boolean = TRUE AND attendee.ticket_status = 'refunded')
      )
      ORDER BY attendee.created_at
  `, [eventId, orderId || null, includeRefunded]);
  return (result.rows as Row[]).map((row) => ({
    key: `attendee:${text(row.attendee_id)}`,
    email: text(row.email),
    name: text(row.full_name),
    ticket: row,
    order: row,
    ticketInstanceIds: uuidPattern.test(text(row.attendee_id)) ? [text(row.attendee_id)] : [],
  } satisfies LifecycleRecipient));
};

const eventRegistrationRecipients = async (eventId: string) => {
  const result = await query(`
    SELECT submission.id AS submission_id, submission.data AS submission_data,
      form.fields AS form_fields, form_settings.live_snapshot
    FROM events event
    JOIN forms form ON form.id = event.registration_form_id
    LEFT JOIN form_settings ON form_settings.form_id = form.id
    JOIN form_submissions submission ON submission.form_id = form.id
    WHERE event.id = $1
      AND event.ticketing_enabled = FALSE
      AND COALESCE(submission.data #>> '{_meta,status}', 'completed') = 'completed'
  `, [eventId]);
  return (result.rows as Row[]).map(submissionRecipient).filter((item): item is LifecycleRecipient => Boolean(item));
};

export const sendEventUpdateEmailsNow = async (
  eventId: string,
  kind: "event_updated" | "event_rescheduled",
) => {
  const event = await eventLifecycleContext(eventId);
  if (!event) return;
  const [attendees, registrations] = await Promise.all([
    eventAttendeeRecipients(eventId),
    eventRegistrationRecipients(eventId),
  ]);
  await sendEventLifecycle(
    eventId,
    kind,
    [...attendees, ...registrations],
    text(event.updated_at) || new Date().toISOString(),
  );
};

export const sendEventCheckinEmailNow = async (eventId: string, attendeeId: string) => {
  const recipients = (await eventAttendeeRecipients(eventId)).filter((recipient) => recipient.key === `attendee:${attendeeId}`);
  if (!recipients.length) return;
  await sendEventLifecycle(eventId, "event_checkin_confirmation", recipients, attendeeId);
};

export const sendEventRefundEmailsNow = async (
  eventId: string,
  orderId: string,
  refundId: string,
) => {
  const linkedOrders = await query(`
    SELECT event_order.id
    FROM event_orders event_order
    JOIN payments payment ON payment.id = event_order.payment_id
    WHERE payment.order_id = $1
      AND event_order.event_id = $2
    ORDER BY event_order.created_at DESC
    LIMIT 1
  `, [orderId, eventId]);
  const eventOrderId = text((linkedOrders.rows[0] as Row | undefined)?.id);
  const recipients = eventOrderId
    ? await eventAttendeeRecipients(eventId, eventOrderId, true)
    : [];
  if (recipients.length) {
    await sendEventLifecycle(eventId, "event_refund_confirmation", recipients, refundId);
    return;
  }
  const eventResult = await query(`
    SELECT payment_order.customer_email AS email,
      payment_order.customer_name AS name,
      payment_order.order_number, payment_order.total_amount
    FROM payment_orders payment_order
    WHERE payment_order.id = $1 AND payment_order.source_id = $2
    LIMIT 1
  `, [orderId, eventId]);
  const row = eventResult.rows[0] as Row | undefined;
  if (row && emailPattern.test(text(row.email))) {
    await sendEventLifecycle(eventId, "event_refund_confirmation", [{
      key: `order:${orderId}`,
      email: text(row.email),
      name: text(row.name) || "Attendee",
      order: row,
    }], refundId);
  }
};

export const sendEventReminderEmailsNow = async (eventId: string) => {
  const event = await eventLifecycleContext(eventId);
  if (!event || !text(event.starts_at)) return;
  const startsAt = new Date(text(event.starts_at));
  if (!Number.isFinite(startsAt.getTime())) return;
  const settings = json<Record<string, unknown>>(event.settings, {});
  const mailSettings = settings.mailSettings && typeof settings.mailSettings === "object"
    ? settings.mailSettings as Row
    : {};
  const reminderSetting = mailSettings.event_reminder && typeof mailSettings.event_reminder === "object"
    ? mailSettings.event_reminder as Row
    : {};
  const leadHours = Math.min(168, Math.max(1, Number(reminderSetting.hoursBefore || 24) || 24));
  const sendAt = new Date(startsAt.getTime() - leadHours * 60 * 60 * 1000);
  const [attendees, registrations] = await Promise.all([
    eventAttendeeRecipients(eventId),
    eventRegistrationRecipients(eventId),
  ]);
  await sendEventLifecycle(
    eventId,
    "event_reminder",
    [...attendees, ...registrations],
    `${startsAt.toISOString()}:${leadHours}`,
    sendAt,
  );
};

export const sendEventWaitlistEmailNow = async (
  eventId: string,
  waitlistId: string,
  templateKey: "event_waitlist_confirmation" | "event_waitlist_promoted",
) => {
  const result = await query(`
    SELECT waitlist.id, waitlist.email, waitlist.full_name,
      waitlist.position, waitlist.expires_at,
      event.title, event.description, event.slug, event.event_date,
      event.range_start_date, event.schedule_start_time, event.schedule_end_time,
      event.starts_at, event.timezone, event.location_type, event.venue_name,
      event.address, event.online_url, event.settings, event.created_by,
      owner.short_id
    FROM event_waitlist waitlist
    JOIN events event ON event.id = waitlist.event_id
    JOIN users owner ON owner.id = event.created_by
    WHERE waitlist.id = $1 AND waitlist.event_id = $2
    LIMIT 1
  `, [waitlistId, eventId]);
  const row = result.rows[0] as Row | undefined;
  if (!row || !emailPattern.test(text(row.email))) return;
  await sendEventLifecycle(eventId, templateKey, [{
    key: `waitlist:${waitlistId}`,
    email: text(row.email),
    name: text(row.full_name) || "Attendee",
  }], `${waitlistId}:${text(row.position)}:${text(row.expires_at)}`);
};

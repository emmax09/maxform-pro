/**
 * Appointments workspace API.
 *
 * One request returns everything the module needs to render — booking pages,
 * routing forms, bookings, availability, connections — because the module shows
 * them side by side and a tab change should not mean a new round trip.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import { neon } from "@neondatabase/serverless";
import { jwtVerify } from "jose";
import { configuredAppUrl } from "./app-url";
import { sendEmailNow } from "./email-service";
import { workspaceScopeFor } from "./workspace-access";
import { dispatchWorkspaceWorkflowEvent } from "./workflows-data";

type DatabaseRow = Record<string, unknown>;
type RecordValue = Record<string, unknown>;

class AppointmentsError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "appointments_error",
  ) {
    super(message);
  }
}

const database = () => {
  const url = process.env.DATABASE_URL || "";
  if (!url) {
    throw new AppointmentsError(
      "Appointments are temporarily unavailable. Please try again shortly.",
      503,
      "appointments_unavailable",
    );
  }
  return neon(url);
};

const signingSecret = () => {
  const secret = process.env.JWT_SECRET || "";
  if (secret.length < 32) {
    throw new AppointmentsError(
      "Appointments are temporarily unavailable. Please try again shortly.",
      503,
      "appointments_unavailable",
    );
  }
  return new TextEncoder().encode(secret);
};

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const text = (value: unknown, maximum: number) =>
  String(value ?? "").trim().slice(0, maximum);

const count = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
};

const jsonValue = (value: unknown, fallback: unknown) => {
  if (value === undefined || value === null) return fallback;
  return value;
};

const slugify = (value: string, fallback: string) =>
  value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) ||
  fallback;

const json = (response: ServerResponse, status: number, value: RecordValue) => {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "private, no-store, max-age=0");
  response.setHeader("Vary", "Authorization");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.end(JSON.stringify(value));
};

const authenticatedUserId = async (request: IncomingMessage) => {
  const authorization = String(request.headers.authorization || "");
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  if (!token) {
    throw new AppointmentsError(
      "Your session has expired. Sign in and try again.",
      401,
      "authentication_required",
    );
  }
  try {
    const { payload } = await jwtVerify(token, signingSecret(), {
      audience: "maxform-dashboard",
      issuer: "maxform",
    });
    const userId = String(payload.userId || "");
    if (!isUuid(userId)) throw new Error("Invalid user");
    // The workspace this request acts in. Identical to the signed-in id
    // for a workspace owner; an added member resolves to the workspace
    // they belong to, so every query below reads the same rows.
    return workspaceScopeFor(userId);
  } catch (error) {
    if (error instanceof AppointmentsError) throw error;
    throw new AppointmentsError(
      "Your session has expired. Sign in and try again.",
      401,
      "authentication_required",
    );
  }
};

const readBody = async (request: IncomingMessage) => {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 400_000) {
      throw new AppointmentsError("This appointment request is too large.", 413);
    }
  }
  if (!body) return {} as RecordValue;
  try {
    const value = JSON.parse(body) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Invalid request");
    }
    return value as RecordValue;
  } catch {
    throw new AppointmentsError("This appointment request could not be read.");
  }
};

/* ------------------------------------------------------------------ shapes */

const LOCATION_TYPES = ["video", "phone", "in_person", "ask_invitee"];
const SCHEDULING_TYPES = ["single", "round_robin", "collective", "group"];
const APPOINTMENT_STATUSES = [
  "confirmed",
  "cancelled",
  "rescheduled",
  "completed",
  "no_show",
];
const oneOf = (value: unknown, allowed: string[], fallback: string) => {
  const candidate = text(value, 40);
  return allowed.includes(candidate) ? candidate : fallback;
};

const safeBookingPage = (row: DatabaseRow) => ({
  id: text(row.id, 64),
  slug: text(row.slug, 80),
  name: text(row.name, 160),
  description: text(row.description, 2000),
  durationMinutes: count(row.duration_minutes, 30),
  locationType: text(row.location_type, 40),
  locationDetail: text(row.location_detail, 500),
  videoProvider: text(row.video_provider, 40),
  schedulingType: text(row.scheduling_type, 40),
  capacity: count(row.capacity, 1),
  questions: Array.isArray(row.questions) ? row.questions : [],
  branding: (row.branding as RecordValue) || {},
  hosts: Array.isArray(row.hosts) ? row.hosts : [],
  priceCents: count(row.price_cents, 0),
  currency: text(row.currency, 8) || "USD",
  color: text(row.color, 16) || "#635BFF",
  status: text(row.status, 24) || "draft",
  bookings: count(row.booking_count, 0),
  views: count(row.view_count, 0),
  updatedAt: row.updated_at ? String(row.updated_at) : null,
});

const safeRoutingForm = (row: DatabaseRow) => ({
  id: text(row.id, 64),
  slug: text(row.slug, 80),
  name: text(row.name, 160),
  description: text(row.description, 2000),
  questions: Array.isArray(row.questions) ? row.questions : [],
  routingRules: Array.isArray(row.routing_rules) ? row.routing_rules : [],
  fallbackBookingPageId: row.fallback_booking_page_id
    ? text(row.fallback_booking_page_id, 64)
    : null,
  status: text(row.status, 24) || "draft",
  updatedAt: row.updated_at ? String(row.updated_at) : null,
});

const safeAppointment = (row: DatabaseRow) => ({
  id: text(row.id, 64),
  bookingPageId: row.booking_page_id ? text(row.booking_page_id, 64) : null,
  bookingPageName: text(row.booking_page_name, 160),
  routingFormId: row.routing_form_id ? text(row.routing_form_id, 64) : null,
  inviteeName: text(row.invitee_name, 200),
  inviteeEmail: text(row.invitee_email, 320),
  inviteeTimezone: text(row.invitee_timezone, 64) || "UTC",
  hostName: text(row.host_name, 200),
  hostEmail: text(row.host_email, 320),
  startsAt: String(row.starts_at || ""),
  endsAt: String(row.ends_at || ""),
  status: text(row.status, 24) || "confirmed",
  locationType: text(row.location_type, 40),
  meetingUrl: text(row.meeting_url, 800),
  answers: (row.answers as RecordValue) || {},
  paymentStatus: text(row.payment_status, 32) || "not_required",
  amountCents: count(row.amount_cents, 0),
  currency: text(row.currency, 8) || "USD",
  externalSource: text(row.external_source, 32),
  color: text(row.color, 16) || "#635BFF",
  createdAt: row.created_at ? String(row.created_at) : null,
  updatedAt: row.updated_at ? String(row.updated_at) : null,
});

type AppointmentNotificationTemplate =
  | "appointment_confirmed"
  | "appointment_rescheduled"
  | "appointment_cancelled";

export const appointmentNotificationTemplate = (
  previous: DatabaseRow | undefined,
  next: DatabaseRow,
): AppointmentNotificationTemplate | null => {
  const nextStatus = text(next.status, 24) || "confirmed";
  const previousStatus = text(previous?.status, 24);
  const nextStartsAt = String(next.starts_at || "");
  const previousStartsAt = String(previous?.starts_at || "");

  if (!previous) return nextStatus === "confirmed" ? "appointment_confirmed" : null;
  if (nextStatus === "cancelled" && previousStatus !== "cancelled") {
    return "appointment_cancelled";
  }
  if (
    nextStatus !== "cancelled" &&
    (nextStartsAt !== previousStartsAt ||
      (nextStatus === "rescheduled" && previousStatus !== "rescheduled"))
  ) {
    return "appointment_rescheduled";
  }
  if (nextStatus === "confirmed" && previousStatus !== "confirmed") {
    return "appointment_confirmed";
  }
  return null;
};

const safeTimeZone = (value: unknown) => {
  const candidate = text(value, 64) || "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return "UTC";
  }
};

const calendarTimestamp = (value: unknown) => {
  const date = new Date(String(value || ""));
  return Number.isFinite(date.valueOf())
    ? date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
    : "";
};

const appointmentNotificationVariables = (
  row: DatabaseRow,
  page: DatabaseRow | undefined,
  previous: DatabaseRow | undefined,
) => {
  const timezone = safeTimeZone(row.invitee_timezone);
  const startsAt = new Date(String(row.starts_at || ""));
  const previousStartsAt = new Date(String(previous?.starts_at || row.starts_at || ""));
  const dateFormat = new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeZone: timezone,
  });
  const timeFormat = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
    timeZoneName: "short",
  });
  const durationFromDates = Math.max(
    1,
    Math.round(
      (new Date(String(row.ends_at || "")).valueOf() - startsAt.valueOf()) / 60_000,
    ),
  );
  const duration = Math.max(1, count(page?.duration_minutes, durationFromDates));
  const origin = configuredAppUrl();
  const bookingUrl = origin && text(page?.slug, 80)
    ? `${origin}/book/${encodeURIComponent(text(page?.slug, 80))}`
    : "";
  const meetingUrl = text(row.meeting_url, 800);
  const actionUrl = meetingUrl || bookingUrl || (origin ? `${origin}/dashboard?tab=appointments` : "");
  const locationDetail = text(page?.location_detail, 500);
  const location = locationDetail || (meetingUrl ? "Online meeting" : text(row.location_type, 40).replace(/_/g, " ") || "To be confirmed");
  const service = text(page?.name, 160) || "Appointment";
  const startStamp = calendarTimestamp(row.starts_at);
  const endStamp = calendarTimestamp(row.ends_at);
  const calendarUrl = startStamp && endStamp
    ? `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(service)}&dates=${startStamp}%2F${endStamp}&details=${encodeURIComponent(actionUrl)}&location=${encodeURIComponent(location)}`
    : actionUrl;
  const mapUrl = locationDetail
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(locationDetail)}`
    : actionUrl;

  return {
    action: { url: actionUrl },
    contact: {
      name: text(row.invitee_name, 200) || "there",
      email: text(row.invitee_email, 320),
    },
    appointment: {
      date: Number.isFinite(startsAt.valueOf()) ? dateFormat.format(startsAt) : "Scheduled date",
      time: Number.isFinite(startsAt.valueOf()) ? timeFormat.format(startsAt) : "Scheduled time",
      previousDate: Number.isFinite(previousStartsAt.valueOf())
        ? `${dateFormat.format(previousStartsAt)} at ${timeFormat.format(previousStartsAt)}`
        : "the previous time",
      duration: `${duration} minutes`,
      host: text(row.host_name, 200) || "Your host",
      service,
      location,
      calendarUrl,
      mapUrl,
    },
  };
};

const sendAppointmentNotification = async (
  userId: string,
  row: DatabaseRow,
  previous: DatabaseRow | undefined,
) => {
  const templateKey = appointmentNotificationTemplate(previous, row);
  const recipient = text(row.invitee_email, 320).toLowerCase();
  if (!templateKey || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    return { status: "not_required" as const };
  }

  const sql = database();
  const pageId = text(row.booking_page_id, 64);
  const pageRows = isUuid(pageId)
    ? await sql.query(
        `SELECT name, slug, duration_minutes, location_type, location_detail
         FROM booking_pages
         WHERE id = $1 AND user_id = $2
         LIMIT 1`,
        [pageId, userId],
      )
    : [];

  try {
    const email = await sendEmailNow({
      userId,
      templateKey,
      to: recipient,
      sourceEventId: text(row.id, 64),
      idempotencyKey: `appointment:${text(row.id, 64)}:${templateKey}:${String(row.starts_at || "")}`,
      emailClassification: "APPOINTMENT",
      variables: appointmentNotificationVariables(row, pageRows[0] as DatabaseRow | undefined, previous),
    });
    return {
      status: "sent" as const,
      emailId: String(email.id || ""),
      provider: "provider" in email ? String(email.provider || "") : "",
    };
  } catch (error) {
    console.error("[appointments-email] immediate notification failed", {
      appointmentId: text(row.id, 64),
      templateKey,
      type: error instanceof Error ? error.name : typeof error,
    });
    return {
      status: "failed" as const,
      error: "The appointment was saved, but its notification email could not be sent.",
    };
  }
};

const safeAvailability = (row: DatabaseRow | undefined) => ({
  timezone: text(row?.timezone, 64) || "UTC",
  weeklyHours: (row?.weekly_hours as RecordValue) || {},
  // { mon: { type: "public_holiday", note: "Independence Day" } }
  dayReasons: (row?.day_reasons as RecordValue) || {},
  bufferBeforeMinutes: count(row?.buffer_before_minutes, 0),
  bufferAfterMinutes: count(row?.buffer_after_minutes, 0),
  minimumNoticeMinutes: count(row?.minimum_notice_minutes, 240),
  maximumAdvanceDays: count(row?.maximum_advance_days, 60),
  dailyBookingCap: count(row?.daily_booking_cap, 0),
  slotIntervalMinutes: count(row?.slot_interval_minutes, 30),
});

const safeConnection = (row: DatabaseRow) => ({
  id: text(row.id, 64),
  provider: text(row.provider, 40),
  category: text(row.category, 24),
  accountLabel: text(row.account_label, 200),
  status: text(row.status, 24),
  healthOk: row.health_ok === true,
  lastError: text(row.last_error, 300),
  lastSyncedAt: row.last_synced_at ? String(row.last_synced_at) : null,
  authType: text(row.auth_type, 16) || "oauth",
  connectedAt: row.connected_at ? String(row.connected_at) : null,
  tokenExpiresAt: row.token_expires_at ? String(row.token_expires_at) : null,
  scopes: Array.isArray(row.scopes) ? (row.scopes as string[]).map((v) => String(v)) : [],
  // The stored credential never leaves the server — only whether one exists, so
  // the card can tell a real connection from a half-finished one.
  hasCredential: Boolean(
    (row.credentials_encrypted as { cipher?: string } | null)?.cipher,
  ),
  hasWebhook: Boolean(text(row.webhook_secret_hash, 128)),
});

const safeBlackout = (row: DatabaseRow) => ({
  id: text(row.id, 64),
  startsOn: String(row.starts_on || "").slice(0, 10),
  endsOn: String(row.ends_on || "").slice(0, 10),
  reason: text(row.reason, 200),
  reasonType: text(row.reason_type, 40) || "other",
});

/* ------------------------------------------------------------------- reads */

const loadWorkspace = async (userId: string) => {
  const sql = database();
  await sql`INSERT INTO appointment_availability (user_id) VALUES (${userId}) ON CONFLICT (user_id) DO NOTHING`;
  const [pages, forms, bookings, revenue, availability, blackouts, connections] = await Promise.all([
    sql.query(
      `SELECT page.*,
              COUNT(booking.id) FILTER (WHERE booking.status <> 'cancelled')::int AS booking_count,
              COALESCE(views.total, 0)::int AS view_count
       FROM booking_pages page
       LEFT JOIN appointments booking ON booking.booking_page_id = page.id
       LEFT JOIN (
         SELECT booking_page_id, SUM(views)::int AS total
         FROM booking_page_views GROUP BY booking_page_id
       ) views ON views.booking_page_id = page.id
       WHERE page.user_id = $1
       GROUP BY page.id, views.total
       ORDER BY page.updated_at DESC`,
      [userId],
    ),
    sql.query(`SELECT * FROM routing_forms WHERE user_id = $1 ORDER BY updated_at DESC`, [userId]),
    sql.query(
      `SELECT booking.*, page.name AS booking_page_name, page.color
       FROM appointments booking
       LEFT JOIN booking_pages page ON page.id = booking.booking_page_id
       WHERE booking.user_id = $1
       ORDER BY booking.starts_at DESC
       LIMIT 500`,
      [userId],
    ),
    // Payment totals come from the Payments module rather than being tracked
    // twice — a paid booking is a payment record, not a separate ledger.
    sql.query(
      `SELECT COALESCE(SUM(amount_cents), 0)::int AS paid_cents,
              COUNT(*)::int AS paid_count
       FROM appointments
       WHERE user_id = $1 AND payment_status = 'paid'`,
      [userId],
    ),
    sql.query(`SELECT * FROM appointment_availability WHERE user_id = $1`, [userId]),
    sql.query(
      `SELECT * FROM appointment_blackout_dates WHERE user_id = $1 ORDER BY starts_on`,
      [userId],
    ),
    sql.query(
      `SELECT * FROM scheduling_tool_connections WHERE user_id = $1 ORDER BY provider`,
      [userId],
    ),
  ]);

  return {
    bookingPages: (pages as DatabaseRow[]).map(safeBookingPage),
    routingForms: (forms as DatabaseRow[]).map(safeRoutingForm),
    appointments: (bookings as DatabaseRow[]).map(safeAppointment),
    availability: safeAvailability((availability as DatabaseRow[])[0]),
    blackoutDates: (blackouts as DatabaseRow[]).map(safeBlackout),
    connections: (connections as DatabaseRow[]).map(safeConnection),
    payments: {
      paidCents: count((revenue as DatabaseRow[])[0]?.paid_cents, 0),
      paidCount: count((revenue as DatabaseRow[])[0]?.paid_count, 0),
      pendingCount: (bookings as DatabaseRow[]).filter(
        (row) => text(row.payment_status, 32) === "pending",
      ).length,
    },
  };
};

const loadAnalytics = async (userId: string, days: number) => {
  const sql = database();
  const window = Math.min(365, Math.max(7, days));
  const [trend, byPage, byHost, slots] = await Promise.all([
    sql.query(
      `SELECT DATE(starts_at) AS day,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE status = 'no_show')::int AS no_shows,
              COALESCE(SUM(amount_cents) FILTER (WHERE payment_status = 'paid'), 0)::int AS revenue_cents
       FROM appointments
       WHERE user_id = $1 AND starts_at >= NOW() - ($2 || ' days')::interval
       GROUP BY day ORDER BY day`,
      [userId, String(window)],
    ),
    sql.query(
      `SELECT page.id, page.name,
              COUNT(booking.id)::int AS booked,
              COUNT(booking.id) FILTER (WHERE booking.status = 'no_show')::int AS no_shows,
              COALESCE(views.total, 0)::int AS views,
              COALESCE(SUM(booking.amount_cents) FILTER (WHERE booking.payment_status = 'paid'), 0)::int AS revenue_cents
       FROM booking_pages page
       LEFT JOIN appointments booking
         ON booking.booking_page_id = page.id
        AND booking.starts_at >= NOW() - ($2 || ' days')::interval
       LEFT JOIN (
         SELECT booking_page_id, SUM(views)::int AS total FROM booking_page_views GROUP BY booking_page_id
       ) views ON views.booking_page_id = page.id
       WHERE page.user_id = $1
       GROUP BY page.id, page.name, views.total
       ORDER BY booked DESC`,
      [userId, String(window)],
    ),
    sql.query(
      `SELECT COALESCE(NULLIF(host_name, ''), 'Unassigned') AS host,
              COUNT(*)::int AS booked,
              COUNT(*) FILTER (WHERE status = 'no_show')::int AS no_shows
       FROM appointments
       WHERE user_id = $1 AND starts_at >= NOW() - ($2 || ' days')::interval
       GROUP BY host ORDER BY booked DESC LIMIT 20`,
      [userId, String(window)],
    ),
    sql.query(
      `SELECT EXTRACT(HOUR FROM starts_at)::int AS hour, COUNT(*)::int AS booked
       FROM appointments
       WHERE user_id = $1 AND starts_at >= NOW() - ($2 || ' days')::interval
       GROUP BY hour ORDER BY hour`,
      [userId, String(window)],
    ),
  ]);

  return {
    days: window,
    trend: (trend as DatabaseRow[]).map((row) => ({
      date: String(row.day || "").slice(0, 10),
      total: count(row.total),
      noShows: count(row.no_shows),
      revenueCents: count(row.revenue_cents),
    })),
    pages: (byPage as DatabaseRow[]).map((row) => ({
      id: text(row.id, 64),
      name: text(row.name, 160),
      booked: count(row.booked),
      noShows: count(row.no_shows),
      views: count(row.views),
      revenueCents: count(row.revenue_cents),
      // The number the spec cares about: openers who actually booked.
      conversion: count(row.views) ? (count(row.booked) / count(row.views)) * 100 : 0,
    })),
    hosts: (byHost as DatabaseRow[]).map((row) => ({
      host: text(row.host, 200),
      booked: count(row.booked),
      noShows: count(row.no_shows),
    })),
    popularHours: (slots as DatabaseRow[]).map((row) => ({
      hour: count(row.hour),
      booked: count(row.booked),
    })),
  };
};

/* ------------------------------------------------------------------ writes */

const saveBookingPage = async (userId: string, input: RecordValue) => {
  const sql = database();
  const id = text(input.id, 64);
  const name = text(input.name, 160) || "Untitled booking page";
  const slug = slugify(text(input.slug, 80) || name, `page-${Date.now()}`);
  const values = [
    userId,
    slug,
    name,
    text(input.description, 2000),
    Math.min(1440, Math.max(5, count(input.durationMinutes, 30))),
    oneOf(input.locationType, LOCATION_TYPES, "video"),
    text(input.locationDetail, 500),
    text(input.videoProvider, 40),
    oneOf(input.schedulingType, SCHEDULING_TYPES, "single"),
    Math.max(1, count(input.capacity, 1)),
    JSON.stringify(jsonValue(input.questions, [])),
    JSON.stringify(jsonValue(input.branding, {})),
    JSON.stringify(jsonValue(input.hosts, [])),
    Math.max(0, count(input.priceCents, 0)),
    text(input.currency, 8) || "USD",
    text(input.color, 16) || "#635BFF",
    text(input.status, 24) === "live" ? "live" : "draft",
  ];

  const rows = id && isUuid(id)
    ? await sql.query(
        `UPDATE booking_pages SET slug = $2, name = $3, description = $4, duration_minutes = $5,
           location_type = $6, location_detail = $7, video_provider = $8, scheduling_type = $9,
           capacity = $10, questions = $11::jsonb, branding = $12::jsonb, hosts = $13::jsonb,
           price_cents = $14, currency = $15, color = $16, status = $17, updated_at = NOW()
         WHERE id = $18 AND user_id = $1 RETURNING *`,
        [...values, id],
      )
    : await sql.query(
        `INSERT INTO booking_pages (user_id, slug, name, description, duration_minutes,
           location_type, location_detail, video_provider, scheduling_type, capacity,
           questions, branding, hosts, price_cents, currency, color, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb, $14, $15, $16, $17)
         RETURNING *`,
        values,
      );

  const row = (rows as DatabaseRow[])[0];
  if (!row) throw new AppointmentsError("This booking page could not be saved.", 404);
  return safeBookingPage(row);
};

/**
 * Server-side module service used by MaxAI after an approval. It intentionally
 * exposes the same normalisation and owner predicate as the appointments API;
 * the assistant cannot pass an arbitrary workspace id to this function.
 */
export const saveBookingPageForAssistant = saveBookingPage;

const saveRoutingForm = async (userId: string, input: RecordValue) => {
  const sql = database();
  const id = text(input.id, 64);
  const name = text(input.name, 160) || "Untitled routing form";
  const fallback = text(input.fallbackBookingPageId, 64);
  const values = [
    userId,
    slugify(text(input.slug, 80) || name, `routing-${Date.now()}`),
    name,
    text(input.description, 2000),
    JSON.stringify(jsonValue(input.questions, [])),
    JSON.stringify(jsonValue(input.routingRules, [])),
    isUuid(fallback) ? fallback : null,
    text(input.status, 24) === "live" ? "live" : "draft",
  ];

  const rows = id && isUuid(id)
    ? await sql.query(
        `UPDATE routing_forms SET slug = $2, name = $3, description = $4, questions = $5::jsonb,
           routing_rules = $6::jsonb, fallback_booking_page_id = $7, status = $8, updated_at = NOW()
         WHERE id = $9 AND user_id = $1 RETURNING *`,
        [...values, id],
      )
    : await sql.query(
        `INSERT INTO routing_forms (user_id, slug, name, description, questions, routing_rules,
           fallback_booking_page_id, status)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8) RETURNING *`,
        values,
      );

  const row = (rows as DatabaseRow[])[0];
  if (!row) throw new AppointmentsError("This routing form could not be saved.", 404);
  return safeRoutingForm(row);
};

/**
 * Evaluates a routing form's rules against submitted answers.
 *
 * First matching rule wins, so the editor's ordering is the priority order; an
 * unmatched submission falls back to the form's default page rather than
 * leaving the visitor with nowhere to go.
 */
const routeSubmission = async (formId: string, answers: RecordValue) => {
  const sql = database();
  const rows = await sql.query(`SELECT * FROM routing_forms WHERE id = $1 LIMIT 1`, [formId]);
  const form = (rows as DatabaseRow[])[0];
  if (!form) throw new AppointmentsError("This routing form is no longer available.", 404);

  const rules = Array.isArray(form.routing_rules) ? form.routing_rules : [];
  for (const entry of rules as RecordValue[]) {
    const field = text(entry.field, 120);
    const expected = text(entry.value, 300).toLowerCase();
    const operator = text(entry.operator, 24) || "equals";
    const actual = text(answers[field], 300).toLowerCase();
    const matched =
      operator === "contains"
        ? Boolean(actual) && actual.includes(expected)
        : operator === "not_equals"
          ? actual !== expected
          : actual === expected;
    if (matched && isUuid(text(entry.bookingPageId, 64))) {
      return { bookingPageId: text(entry.bookingPageId, 64), matchedRuleId: text(entry.id, 64) };
    }
  }
  return {
    bookingPageId: form.fallback_booking_page_id ? text(form.fallback_booking_page_id, 64) : null,
    matchedRuleId: "",
  };
};

const saveAppointment = async (userId: string, input: RecordValue) => {
  const sql = database();
  const id = text(input.id, 64);
  const previousRows = id && isUuid(id)
    ? await sql.query(
        `SELECT id, status, starts_at
         FROM appointments
         WHERE id = $1 AND user_id = $2
         LIMIT 1`,
        [id, userId],
      )
    : [];
  const previous = previousRows[0] as DatabaseRow | undefined;
  const pageId = text(input.bookingPageId, 64);
  const routingId = text(input.routingFormId, 64);
  const startsAt = text(input.startsAt, 40);
  const endsAt = text(input.endsAt, 40);
  if (!startsAt || !endsAt) {
    throw new AppointmentsError("An appointment needs a start and end time.");
  }
  if (isUuid(pageId)) {
    const pageRows = await sql.query(
      `SELECT id FROM booking_pages WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [pageId, userId],
    );
    if (!(pageRows as DatabaseRow[])[0]) {
      throw new AppointmentsError("That booking page is not in this workspace.", 403);
    }
  }
  if (isUuid(routingId)) {
    const routingRows = await sql.query(
      `SELECT id FROM routing_forms WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [routingId, userId],
    );
    if (!(routingRows as DatabaseRow[])[0]) {
      throw new AppointmentsError("That routing form is not in this workspace.", 403);
    }
  }
  const values = [
    userId,
    isUuid(pageId) ? pageId : null,
    isUuid(routingId) ? routingId : null,
    text(input.inviteeName, 200),
    text(input.inviteeEmail, 320).toLowerCase(),
    text(input.inviteeTimezone, 64) || "UTC",
    text(input.hostName, 200),
    text(input.hostEmail, 320).toLowerCase(),
    startsAt,
    endsAt,
    oneOf(input.status, APPOINTMENT_STATUSES, "confirmed"),
    oneOf(input.locationType, LOCATION_TYPES, "video"),
    text(input.meetingUrl, 800),
    JSON.stringify(jsonValue(input.answers, {})),
    text(input.paymentStatus, 32) || "not_required",
    Math.max(0, count(input.amountCents, 0)),
    text(input.currency, 8) || "USD",
  ];

  const rows = id && isUuid(id)
    ? await sql.query(
        `UPDATE appointments SET booking_page_id = $2, routing_form_id = $3, invitee_name = $4,
           invitee_email = $5, invitee_timezone = $6, host_name = $7, host_email = $8,
           starts_at = $9, ends_at = $10, status = $11, location_type = $12, meeting_url = $13,
           answers = $14::jsonb, payment_status = $15, amount_cents = $16, currency = $17,
           updated_at = NOW()
         WHERE id = $18 AND user_id = $1 RETURNING *`,
        [...values, id],
      )
    : await sql.query(
        `INSERT INTO appointments (user_id, booking_page_id, routing_form_id, invitee_name,
           invitee_email, invitee_timezone, host_name, host_email, starts_at, ends_at, status,
           location_type, meeting_url, answers, payment_status, amount_cents, currency)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15, $16, $17)
         RETURNING *`,
        values,
      );

  const row = (rows as DatabaseRow[])[0];
  if (!row) throw new AppointmentsError("This appointment could not be saved.", 404);
  const workflowEvent = !previous
    ? "appointment_created"
    : text(row.status, 24) === "cancelled" && text(previous.status, 24) !== "cancelled"
      ? "appointment_cancelled"
      : String(row.starts_at || "") !== String(previous.starts_at || "")
        ? "appointment_rescheduled"
        : "";
  return {
    appointment: safeAppointment(row),
    notification: await sendAppointmentNotification(userId, row, previous),
    workflowEvent,
  };
};

/** Server-side appointment write used by MaxAI after explicit approval. */
export const saveAppointmentForAssistant = saveAppointment;

const saveAvailability = async (userId: string, input: RecordValue) => {
  const sql = database();
  const rows = await sql.query(
    `INSERT INTO appointment_availability (user_id, timezone, weekly_hours, buffer_before_minutes,
       buffer_after_minutes, minimum_notice_minutes, maximum_advance_days, daily_booking_cap,
       slot_interval_minutes, updated_at, day_reasons)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, NOW(), $10::jsonb)
     ON CONFLICT (user_id) DO UPDATE SET timezone = EXCLUDED.timezone,
       weekly_hours = EXCLUDED.weekly_hours,
       day_reasons = EXCLUDED.day_reasons,
       buffer_before_minutes = EXCLUDED.buffer_before_minutes,
       buffer_after_minutes = EXCLUDED.buffer_after_minutes,
       minimum_notice_minutes = EXCLUDED.minimum_notice_minutes,
       maximum_advance_days = EXCLUDED.maximum_advance_days,
       daily_booking_cap = EXCLUDED.daily_booking_cap,
       slot_interval_minutes = EXCLUDED.slot_interval_minutes,
       updated_at = NOW()
     RETURNING *`,
    [
      userId,
      text(input.timezone, 64) || "UTC",
      JSON.stringify(jsonValue(input.weeklyHours, {})),
      Math.max(0, count(input.bufferBeforeMinutes, 0)),
      Math.max(0, count(input.bufferAfterMinutes, 0)),
      Math.max(0, count(input.minimumNoticeMinutes, 240)),
      Math.max(1, count(input.maximumAdvanceDays, 60)),
      Math.max(0, count(input.dailyBookingCap, 0)),
      Math.max(5, count(input.slotIntervalMinutes, 30)),
      JSON.stringify(jsonValue(input.dayReasons, {})),
    ],
  );
  return safeAvailability((rows as DatabaseRow[])[0]);
};

/** The public origin an embed snippet should point at. */
const publicOrigin = (request: IncomingMessage) => {
  const configured = configuredAppUrl();
  if (configured) return configured;
  const host = String(request.headers["x-forwarded-host"] || request.headers.host || "");
  const proto = String(request.headers["x-forwarded-proto"] || "https").split(",")[0];
  return host ? `${proto}://${host}` : "";
};

const embedSnippet = async (userId: string, pageId: string, kind: string, origin: string) => {
  const sql = database();
  const rows = await sql.query(
    `SELECT slug, name FROM booking_pages WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [pageId, userId],
  );
  const page = (rows as DatabaseRow[])[0];
  if (!page) throw new AppointmentsError("That booking page could not be found.", 404);
  const url = `${origin}/book/${text(page.slug, 80)}`;
  const title = text(page.name, 160).replace(/"/g, "&quot;");
  const embedType = ["iframe", "js_widget", "link"].includes(kind) ? kind : "iframe";
  const snippet =
    embedType === "link"
      ? url
      : embedType === "js_widget"
        ? `<div id="maxform-booking"></div>\n<script src="${origin}/embed/booking.js" data-page="${text(page.slug, 80)}" data-target="#maxform-booking" async></script>`
        : `<iframe src="${url}?embed=1" title="${title}" width="100%" height="720" frameborder="0" style="border:0;min-width:320px" loading="lazy"></iframe>`;

  await sql.query(
    `INSERT INTO embed_widgets (booking_page_id, embed_type, settings)
     VALUES ($1, $2, '{}'::jsonb)
     ON CONFLICT (booking_page_id, embed_type) DO NOTHING`,
    [pageId, embedType],
  );
  return { embedType, snippet, url };
};

/* ---------------------------------------------------------------- dispatch */

const remove = async (table: string, userId: string, id: string) => {
  if (!isUuid(id)) throw new AppointmentsError("That record could not be found.", 404);
  const sql = database();
  await sql.query(`DELETE FROM ${table} WHERE id = $1 AND user_id = $2`, [id, userId]);
  return { deleted: true };
};

const removeAppointment = async (userId: string, id: string) => {
  if (!isUuid(id)) throw new AppointmentsError("That record could not be found.", 404);
  const sql = database();
  const rows = await sql.query(
    `SELECT * FROM appointments WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [id, userId],
  );
  const appointment = (rows as DatabaseRow[])[0];
  const result = await remove("appointments", userId, id);
  if (appointment) {
    await dispatchWorkspaceWorkflowEvent(
      userId,
      "appointment_cancelled",
      { id, appointment: safeAppointment(appointment) as unknown as RecordValue },
      `appointment_cancelled:${id}:${String(appointment.updated_at || Date.now())}`,
    ).catch(() => undefined);
  }
  return result;
};

export const handleAppointmentsData = async (
  request: IncomingMessage,
  response: ServerResponse,
) => {
  try {
    const url = new URL(request.url || "/", "http://localhost");
    const action = url.searchParams.get("action") || "workspace";
    const userId = await authenticatedUserId(request);

    if (request.method === "GET") {
      if (action === "workspace") return json(response, 200, await loadWorkspace(userId));
      if (action === "analytics") {
        const days = count(url.searchParams.get("days"), 30);
        return json(response, 200, await loadAnalytics(userId, days));
      }
      if (action === "embed-snippet") {
        const pageId = String(url.searchParams.get("bookingPageId") || "");
        const kind = String(url.searchParams.get("embedType") || "iframe");
        if (!isUuid(pageId)) throw new AppointmentsError("Choose a booking page first.");
        return json(
          response,
          200,
          await embedSnippet(userId, pageId, kind, publicOrigin(request)),
        );
      }
      throw new AppointmentsError("That appointments request is not supported.", 404);
    }

    if (request.method !== "POST") {
      throw new AppointmentsError("That appointments request is not supported.", 405);
    }

    const body = await readBody(request);
    switch (action) {
      case "save-booking-page":
        return json(response, 200, { bookingPage: await saveBookingPage(userId, body) });
      case "delete-booking-page":
        return json(response, 200, await remove("booking_pages", userId, text(body.id, 64)));
      case "save-routing-form":
        return json(response, 200, { routingForm: await saveRoutingForm(userId, body) });
      case "delete-routing-form":
        return json(response, 200, await remove("routing_forms", userId, text(body.id, 64)));
      case "route-submission":
        return json(
          response,
          200,
          await routeSubmission(text(body.routingFormId, 64), (body.answers as RecordValue) || {}),
        );
      case "save-appointment": {
        const saved = await saveAppointment(userId, body);
        try {
          if (saved.workflowEvent) {
            await dispatchWorkspaceWorkflowEvent(
              userId,
              saved.workflowEvent,
              {
                id: saved.appointment.id,
                appointment: saved.appointment as unknown as RecordValue,
              },
              `${saved.workflowEvent}:${saved.appointment.id}:${saved.appointment.updatedAt || saved.appointment.createdAt || Date.now()}`,
            );
          }
        } catch {
          // Workflow delivery must never make an appointment save fail.
        }
        return json(response, 200, saved);
      }
      case "delete-appointment":
        return json(response, 200, await removeAppointment(userId, text(body.id, 64)));
      case "save-availability":
        return json(response, 200, { availability: await saveAvailability(userId, body) });
      case "add-blackout": {
        const sql = database();
        const rows = await sql.query(
          `INSERT INTO appointment_blackout_dates (user_id, starts_on, ends_on, reason, reason_type)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [
            userId,
            text(body.startsOn, 10),
            text(body.endsOn, 10) || text(body.startsOn, 10),
            text(body.reason, 200),
            text(body.reasonType, 40) || "other",
          ],
        );
        return json(response, 200, { blackout: safeBlackout((rows as DatabaseRow[])[0]) });
      }
      case "delete-blackout":
        return json(
          response,
          200,
          await remove("appointment_blackout_dates", userId, text(body.id, 64)),
        );
      default:
        throw new AppointmentsError("That appointments request is not supported.", 404);
    }
  } catch (error) {
    if (error instanceof AppointmentsError) {
      return json(response, error.status, { error: error.message, code: error.code });
    }
    return json(response, 500, {
      error: "Appointments are temporarily unavailable. Please try again shortly.",
      code: "appointments_unavailable",
    });
  }
};

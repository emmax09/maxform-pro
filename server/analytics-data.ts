import type { IncomingMessage, ServerResponse } from "node:http";

import { neon } from "@neondatabase/serverless";
import { jwtVerify } from "jose";

import { cacheKey, cached } from "./cache";
import { workspaceScopeFor } from "./workspace-access";

class AnalyticsDataError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "analytics_data_error",
  ) {
    super(message);
  }
}

const database = () => {
  const url = process.env.DATABASE_URL || "";
  if (!url) {
    throw new AnalyticsDataError(
      "Analytics is temporarily unavailable. Please try again shortly.",
      503,
      "analytics_unavailable",
    );
  }
  return neon(url);
};

const jwtSigningSecret = () => {
  const secret = process.env.JWT_SECRET || "";
  if (secret.length < 32) {
    throw new AnalyticsDataError(
      "Analytics is temporarily unavailable. Please try again shortly.",
      503,
      "analytics_unavailable",
    );
  }
  return new TextEncoder().encode(secret);
};

const json = (
  response: ServerResponse,
  status: number,
  value: Record<string, unknown>,
) => {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "private, no-store, max-age=0");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("Vary", "Authorization");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  );
  response.end(JSON.stringify(value));
};

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

const authenticatedUserId = async (request: IncomingMessage) => {
  const authorization = String(request.headers.authorization || "");
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  if (!token) {
    throw new AnalyticsDataError(
      "Please sign in again to view analytics.",
      401,
      "authentication_required",
    );
  }

  try {
    const { payload } = await jwtVerify(token, jwtSigningSecret(), {
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
    if (error instanceof AnalyticsDataError) throw error;
    throw new AnalyticsDataError(
      "Your session has expired. Sign in and try again.",
      401,
      "authentication_required",
    );
  }
};

const analyticsRange = (value: string | null) => {
  const days = Number(value || 30);
  if (![7, 30, 90, 365].includes(days)) {
    throw new AnalyticsDataError("Choose a valid analytics period.");
  }
  return days;
};

const visibleSubmissionFilter = `
  COALESCE(submission.data #>> '{_meta,status}', 'completed') <> 'pending_payment'
`;

export const listAnalytics = async (userId: string, days: number) => {
  const sql = database();
  const [
    summaryRows,
    daily,
    topForms,
    lifecycle,
    responseSources,
    countries,
    revenueSources,
    providers,
    upcomingEvents,
  ] = await Promise.all([
    sql.query(
      `WITH config AS (
         SELECT COALESCE(
           (SELECT currency FROM workspace_regional_settings WHERE user_id = $1),
           'USD'
         ) AS currency
       )
       SELECT
         (SELECT currency FROM config) AS currency,
         (SELECT COUNT(*)::int FROM forms form
          WHERE form.created_by = $1 AND form.status = 'published') AS published_forms,
         (SELECT COUNT(*)::int
          FROM form_submissions submission
          JOIN forms form ON form.id = submission.form_id
          WHERE form.created_by = $1
            AND ${visibleSubmissionFilter}
            AND submission.submitted_at >= NOW() - ($2::int * INTERVAL '1 day')) AS responses,
         (SELECT COUNT(*)::int
          FROM form_submissions submission
          JOIN forms form ON form.id = submission.form_id
          WHERE form.created_by = $1
            AND ${visibleSubmissionFilter}
            AND submission.submitted_at >= NOW() - ($2::int * 2 * INTERVAL '1 day')
            AND submission.submitted_at < NOW() - ($2::int * INTERVAL '1 day')) AS previous_responses,
         (SELECT COUNT(*)::int FROM contacts contact
          WHERE contact.created_by = $1
            AND contact.created_at >= NOW() - ($2::int * INTERVAL '1 day')) AS contacts,
         (SELECT COUNT(*)::int FROM contacts contact
          WHERE contact.created_by = $1
            AND contact.created_at >= NOW() - ($2::int * 2 * INTERVAL '1 day')
            AND contact.created_at < NOW() - ($2::int * INTERVAL '1 day')) AS previous_contacts,
         (SELECT COUNT(*)::int
          FROM event_attendees attendee
          JOIN events event ON event.id = attendee.event_id
          WHERE event.created_by = $1
            AND attendee.ticket_status = 'valid'
            AND attendee.created_at >= NOW() - ($2::int * INTERVAL '1 day')) AS event_registrations,
         (SELECT COUNT(*)::int
          FROM event_attendees attendee
          JOIN events event ON event.id = attendee.event_id
          WHERE event.created_by = $1
            AND attendee.ticket_status = 'valid'
            AND attendee.created_at >= NOW() - ($2::int * 2 * INTERVAL '1 day')
            AND attendee.created_at < NOW() - ($2::int * INTERVAL '1 day')) AS previous_event_registrations,
         (SELECT COUNT(*)::int
          FROM event_attendees attendee
          JOIN events event ON event.id = attendee.event_id
          WHERE event.created_by = $1
            AND attendee.ticket_status = 'valid'
            AND attendee.checked_in_at >= NOW() - ($2::int * INTERVAL '1 day')) AS checked_ins,
         (SELECT COUNT(*)::int FROM payment_orders payment_order
          WHERE payment_order.user_id = $1
            AND payment_order.status IN (
              'paid', 'partially_refunded', 'refunded'
            )
            AND payment_order.paid_at >= NOW() - ($2::int * INTERVAL '1 day')) AS paid_orders,
         (SELECT COUNT(*)::int FROM payment_orders payment_order
          WHERE payment_order.user_id = $1
            AND payment_order.status IN (
              'paid', 'partially_refunded', 'refunded'
            )
            AND payment_order.paid_at >= NOW() - ($2::int * 2 * INTERVAL '1 day')
            AND payment_order.paid_at < NOW() - ($2::int * INTERVAL '1 day')) AS previous_paid_orders,
         (SELECT COUNT(*)::int FROM payment_orders payment_order
          WHERE payment_order.user_id = $1
            AND payment_order.status NOT IN ('draft', 'cancelled')
            AND payment_order.created_at >= NOW() - ($2::int * INTERVAL '1 day')) AS payment_attempts,
         (SELECT COALESCE(SUM(
            GREATEST(payment_order.total_amount - payment_order.refunded_amount, 0)
          ), 0)::numeric
          FROM payment_orders payment_order
          WHERE payment_order.user_id = $1
            AND payment_order.status IN (
              'paid', 'partially_refunded', 'refunded'
            )
            AND payment_order.currency = (SELECT currency FROM config)
            AND payment_order.paid_at >= NOW() - ($2::int * INTERVAL '1 day')) AS paid_revenue,
         (SELECT COALESCE(SUM(
            GREATEST(payment_order.total_amount - payment_order.refunded_amount, 0)
          ), 0)::numeric
          FROM payment_orders payment_order
          WHERE payment_order.user_id = $1
            AND payment_order.status IN (
              'paid', 'partially_refunded', 'refunded'
            )
            AND payment_order.currency = (SELECT currency FROM config)
            AND payment_order.paid_at >= NOW() - ($2::int * 2 * INTERVAL '1 day')
            AND payment_order.paid_at < NOW() - ($2::int * INTERVAL '1 day')) AS previous_paid_revenue,
         (SELECT COUNT(*)::int FROM payment_orders payment_order
          WHERE payment_order.user_id = $1
            AND payment_order.status IN (
              'paid', 'partially_refunded', 'refunded'
            )
            AND payment_order.currency <> (SELECT currency FROM config)
            AND payment_order.paid_at >= NOW() - ($2::int * INTERVAL '1 day')) AS other_currency_paid_orders,
         (SELECT COUNT(*)::int FROM events event
          WHERE event.created_by = $1
            AND event.status IN ('published', 'on_sale', 'sold_out')
            AND event.starts_at >= NOW()) AS upcoming_events`,
      [userId, days],
    ),
    sql.query(
      `WITH dates AS (
         SELECT generate_series(
           CURRENT_DATE - ($2::int - 1),
           CURRENT_DATE,
           INTERVAL '1 day'
         )::date AS date
       ), response_counts AS (
         SELECT submission.submitted_at::date AS date, COUNT(*)::int AS responses
         FROM form_submissions submission
         JOIN forms form ON form.id = submission.form_id
         WHERE form.created_by = $1
           AND ${visibleSubmissionFilter}
           AND submission.submitted_at >= CURRENT_DATE - ($2::int - 1)
         GROUP BY submission.submitted_at::date
       ), contact_counts AS (
         SELECT contact.created_at::date AS date, COUNT(*)::int AS contacts
         FROM contacts contact
         WHERE contact.created_by = $1
           AND contact.created_at >= CURRENT_DATE - ($2::int - 1)
         GROUP BY contact.created_at::date
       ), registration_counts AS (
         SELECT attendee.created_at::date AS date, COUNT(*)::int AS registrations
         FROM event_attendees attendee
         JOIN events event ON event.id = attendee.event_id
         WHERE event.created_by = $1
           AND attendee.ticket_status = 'valid'
           AND attendee.created_at >= CURRENT_DATE - ($2::int - 1)
         GROUP BY attendee.created_at::date
       ), payment_counts AS (
         SELECT payment_order.paid_at::date AS date,
                COUNT(*)::int AS paid_orders,
                COALESCE(SUM(
                  GREATEST(
                    payment_order.total_amount - payment_order.refunded_amount,
                    0
                  )
                ), 0)::numeric AS revenue
         FROM payment_orders payment_order
         WHERE payment_order.user_id = $1
           AND payment_order.status IN (
             'paid', 'partially_refunded', 'refunded'
           )
           AND payment_order.currency = COALESCE(
             (SELECT currency FROM workspace_regional_settings WHERE user_id = $1),
             'USD'
           )
           AND payment_order.paid_at >= CURRENT_DATE - ($2::int - 1)
         GROUP BY payment_order.paid_at::date
       )
       SELECT dates.date::text AS date,
              COALESCE(response_counts.responses, 0)::int AS responses,
              COALESCE(contact_counts.contacts, 0)::int AS contacts,
              COALESCE(registration_counts.registrations, 0)::int AS registrations,
              COALESCE(payment_counts.paid_orders, 0)::int AS paid_orders,
              COALESCE(payment_counts.revenue, 0)::numeric AS revenue
       FROM dates
       LEFT JOIN response_counts ON response_counts.date = dates.date
       LEFT JOIN contact_counts ON contact_counts.date = dates.date
       LEFT JOIN registration_counts ON registration_counts.date = dates.date
       LEFT JOIN payment_counts ON payment_counts.date = dates.date
       ORDER BY dates.date`,
      [userId, days],
    ),
    sql.query(
      `SELECT form.id, form.title,
              COUNT(submission.id)::int AS responses,
              EXISTS(
                SELECT 1 FROM events event
                WHERE event.registration_form_id = form.id
              ) AS is_event_registration
       FROM forms form
       JOIN form_submissions submission ON submission.form_id = form.id
       WHERE form.created_by = $1
         AND ${visibleSubmissionFilter}
         AND submission.submitted_at >= NOW() - ($2::int * INTERVAL '1 day')
       GROUP BY form.id, form.title
       ORDER BY responses DESC, form.title ASC
       LIMIT 6`,
      [userId, days],
    ),
    sql.query(
      `SELECT COALESCE(NULLIF(contact.lifecycle_stage, ''), 'Unassigned') AS label,
              COUNT(*)::int AS value
       FROM contacts contact
       WHERE contact.created_by = $1
         AND contact.created_at >= NOW() - ($2::int * INTERVAL '1 day')
       GROUP BY COALESCE(NULLIF(contact.lifecycle_stage, ''), 'Unassigned')
       ORDER BY value DESC, label ASC
       LIMIT 6`,
      [userId, days],
    ),
    sql.query(
      `SELECT CASE
                WHEN EXISTS(
                  SELECT 1 FROM events event
                  WHERE event.registration_form_id = form.id
                ) THEN 'Event registrations'
                ELSE 'Form responses'
              END AS label,
              COUNT(*)::int AS value
       FROM form_submissions submission
       JOIN forms form ON form.id = submission.form_id
       WHERE form.created_by = $1
         AND ${visibleSubmissionFilter}
         AND submission.submitted_at >= NOW() - ($2::int * INTERVAL '1 day')
       GROUP BY label
       ORDER BY value DESC, label ASC`,
      [userId, days],
    ),
    sql.query(
      `SELECT NULLIF(BTRIM(submission.data #>> '{_meta,country}'), '') AS label,
              COUNT(*)::int AS value
       FROM form_submissions submission
       JOIN forms form ON form.id = submission.form_id
       WHERE form.created_by = $1
         AND ${visibleSubmissionFilter}
         AND submission.submitted_at >= NOW() - ($2::int * INTERVAL '1 day')
         AND NULLIF(BTRIM(submission.data #>> '{_meta,country}'), '') IS NOT NULL
       GROUP BY NULLIF(BTRIM(submission.data #>> '{_meta,country}'), '')
       ORDER BY value DESC, label ASC
       LIMIT 6`,
      [userId, days],
    ),
    sql.query(
      `SELECT CASE
                WHEN payment_order.source_type = 'manual'
                  AND payment_order.metadata->>'sourceModule' = 'stores'
                  THEN 'Connected stores'
                WHEN payment_order.source_type = 'form' THEN 'Forms'
                WHEN payment_order.source_type = 'event' THEN 'Events'
                WHEN payment_order.source_type = 'invoice' THEN 'Invoices'
                WHEN payment_order.source_type = 'subscription' THEN 'Subscriptions'
                ELSE 'Manual'
              END AS label,
              COUNT(*)::int AS orders,
              COALESCE(SUM(
                GREATEST(
                  payment_order.total_amount - payment_order.refunded_amount,
                  0
                )
              ), 0)::numeric AS revenue
       FROM payment_orders payment_order
       WHERE payment_order.user_id = $1
         AND payment_order.status IN (
           'paid', 'partially_refunded', 'refunded'
         )
         AND payment_order.currency = COALESCE(
           (SELECT currency FROM workspace_regional_settings WHERE user_id = $1),
           'USD'
         )
         AND payment_order.paid_at >= NOW() - ($2::int * INTERVAL '1 day')
       GROUP BY 1
       ORDER BY revenue DESC, label ASC`,
      [userId, days],
    ),
    sql.query(
      `SELECT COALESCE(NULLIF(payment_order.provider, ''), 'Unspecified') AS label,
              COUNT(*)::int AS value
       FROM payment_orders payment_order
       WHERE payment_order.user_id = $1
         AND payment_order.status IN (
           'paid', 'partially_refunded', 'refunded'
         )
         AND payment_order.paid_at >= NOW() - ($2::int * INTERVAL '1 day')
       GROUP BY COALESCE(NULLIF(payment_order.provider, ''), 'Unspecified')
       ORDER BY value DESC, label ASC
       LIMIT 6`,
      [userId, days],
    ),
    sql.query(
      `SELECT event.id, event.title, event.starts_at, event.capacity_total,
              COUNT(attendee.id) FILTER (
                WHERE attendee.ticket_status = 'valid'
              )::int AS registrations,
              COUNT(attendee.id) FILTER (
                WHERE attendee.ticket_status = 'valid'
                  AND attendee.checked_in_at IS NOT NULL
              )::int AS checked_ins
       FROM events event
       LEFT JOIN event_attendees attendee ON attendee.event_id = event.id
       WHERE event.created_by = $1
         AND event.status IN ('published', 'on_sale', 'sold_out')
         AND event.starts_at >= NOW()
       GROUP BY event.id, event.title, event.starts_at, event.capacity_total
       ORDER BY event.starts_at ASC
       LIMIT 6`,
      [userId],
    ),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    rangeDays: days,
    summary: summaryRows[0] || {},
    daily,
    topForms,
    lifecycle,
    responseSources,
    countries,
    revenueSources,
    providers,
    upcomingEvents,
  };
};

export async function handleAnalyticsData(
  request: IncomingMessage,
  response: ServerResponse,
) {
  try {
    if (request.method !== "GET") {
      throw new AnalyticsDataError("This analytics action is not available.", 404);
    }
    const url = new URL(request.url || "/", "http://localhost");
    const userId = await authenticatedUserId(request);
    const days = analyticsRange(url.searchParams.get("range"));
    // A dozen aggregate queries over the whole workspace. The dashboard polls
    // this on every visit, and a minute of drift on trend charts is invisible,
    // so the assembled payload is cached rather than each query.
    json(
      response,
      200,
      await cached(cacheKey("analytics", userId, days), 60, () =>
        listAnalytics(userId, days),
      ),
    );
  } catch (error) {
    if (error instanceof AnalyticsDataError) {
      json(response, error.status, { error: error.message, code: error.code });
      return;
    }
    const databaseCode =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code || "")
        : "";
    console.error("[analytics-data] unexpected request failure", {
      code: databaseCode || "unknown",
      type: error instanceof Error ? error.name : typeof error,
    });
    json(response, 500, {
      error: "Analytics could not be loaded right now. Please try again.",
      code: "analytics_data_error",
    });
  }
}

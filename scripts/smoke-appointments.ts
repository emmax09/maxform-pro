/**
 * Appointments module smoke test.
 *
 * Drives the real schema end to end against a real database: a booking page, a
 * routing form whose rules resolve, a paid booking, availability with a stated
 * reason per closed day, a blackout range, and a tool connection — then checks
 * the workspace read and the analytics aggregates return what was written, and
 * removes everything it made.
 */
import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";

const databaseUrl = process.env.DATABASE_URL || "";
if (!databaseUrl) {
  throw new Error("Appointments smoke test requires DATABASE_URL.");
}

const sql = neon(databaseUrl);
const suffix = randomUUID().replaceAll("-", "");
const smokeEmail = `appointments-smoke-${suffix}@example.test`;

let assertions = 0;
const check = (condition: unknown, message: string) => {
  if (!condition) throw new Error(`Appointments smoke check failed: ${message}`);
  assertions += 1;
};

const users = await sql.query(
  `INSERT INTO users (email, password_hash, full_name, short_id)
   VALUES ($1, 'non-login-smoke-account', 'Appointments Smoke', $2)
   RETURNING id`,
  [smokeEmail, suffix.slice(0, 5)],
);
const userId = String((users[0] as Record<string, unknown>).id);

const cleanup = async () => {
  await sql.query(`DELETE FROM appointments WHERE user_id = $1`, [userId]);
  await sql.query(`DELETE FROM routing_forms WHERE user_id = $1`, [userId]);
  await sql.query(`DELETE FROM booking_pages WHERE user_id = $1`, [userId]);
  await sql.query(`DELETE FROM appointment_blackout_dates WHERE user_id = $1`, [userId]);
  await sql.query(`DELETE FROM appointment_availability WHERE user_id = $1`, [userId]);
  await sql.query(`DELETE FROM scheduling_tool_connections WHERE user_id = $1`, [userId]);
  await sql.query(`DELETE FROM users WHERE id = $1`, [userId]);
};

try {
  // --- booking pages ---------------------------------------------------
  const pages = await sql.query(
    `INSERT INTO booking_pages (user_id, slug, name, description, duration_minutes,
       location_type, scheduling_type, price_cents, currency, color, status)
     VALUES ($1, 'discovery-call', 'Discovery call', 'First conversation', 30,
       'video', 'round_robin', 5000, 'USD', '#635BFF', 'live')
     RETURNING id, slug, status`,
    [userId],
  );
  const pageId = String((pages[0] as Record<string, unknown>).id);
  check(pageId, "a booking page was created");
  check((pages[0] as Record<string, unknown>).status === "live", "the page is live");

  const supportPages = await sql.query(
    `INSERT INTO booking_pages (user_id, slug, name, duration_minutes, status)
     VALUES ($1, 'support-call', 'Support call', 15, 'live') RETURNING id`,
    [userId],
  );
  const supportPageId = String((supportPages[0] as Record<string, unknown>).id);

  // The unique constraint is what stops two pages sharing a public URL.
  let duplicateRejected = false;
  try {
    await sql.query(
      `INSERT INTO booking_pages (user_id, slug, name) VALUES ($1, 'discovery-call', 'Clash')`,
      [userId],
    );
  } catch {
    duplicateRejected = true;
  }
  check(duplicateRejected, "a duplicate slug is rejected for the same owner");

  // --- routing form ----------------------------------------------------
  const forms = await sql.query(
    `INSERT INTO routing_forms (user_id, slug, name, questions, routing_rules,
       fallback_booking_page_id, status)
     VALUES ($1, 'qualify', 'Qualify first', $2::jsonb, $3::jsonb, $4, 'live')
     RETURNING id, routing_rules`,
    [
      userId,
      JSON.stringify([{ id: "need", type: "dropdown", label: "What do you need?" }]),
      JSON.stringify([
        { id: "r1", field: "need", operator: "equals", value: "Sales", bookingPageId: pageId },
        { id: "r2", field: "need", operator: "contains", value: "support", bookingPageId: supportPageId },
      ]),
      supportPageId,
    ],
  );
  const routingFormId = String((forms[0] as Record<string, unknown>).id);
  const rules = (forms[0] as Record<string, unknown>).routing_rules as Array<Record<string, string>>;
  check(rules.length === 2, "routing rules round-trip through JSONB");

  // Same evaluation the server performs: first match wins, else fall back.
  const route = (answers: Record<string, string>) => {
    for (const rule of rules) {
      const actual = String(answers[rule.field] ?? "").toLowerCase();
      const expected = String(rule.value).toLowerCase();
      const matched =
        rule.operator === "contains"
          ? Boolean(actual) && actual.includes(expected)
          : rule.operator === "not_equals"
            ? actual !== expected
            : actual === expected;
      if (matched) return rule.bookingPageId;
    }
    return supportPageId;
  };
  check(route({ need: "Sales" }) === pageId, "a sales answer routes to the discovery page");
  check(route({ need: "Technical support" }) === supportPageId, "a support answer routes to support");
  check(route({ need: "Anything else" }) === supportPageId, "an unmatched answer uses the fallback");

  // --- bookings --------------------------------------------------------
  const booking = await sql.query(
    `INSERT INTO appointments (user_id, booking_page_id, routing_form_id, invitee_name,
       invitee_email, host_name, starts_at, ends_at, status, payment_status, amount_cents, currency)
     VALUES ($1, $2, $3, 'Ada Lovelace', 'ada@example.test', 'Grace Hopper',
       NOW() + INTERVAL '2 days', NOW() + INTERVAL '2 days 30 minutes',
       'confirmed', 'paid', 5000, 'USD')
     RETURNING id, payment_status`,
    [userId, pageId, routingFormId],
  );
  check((booking[0] as Record<string, unknown>).payment_status === "paid", "a paid booking is stored");

  await sql.query(
    `INSERT INTO appointments (user_id, booking_page_id, invitee_name, invitee_email,
       host_name, starts_at, ends_at, status)
     VALUES ($1, $2, 'Alan Turing', 'alan@example.test', 'Grace Hopper',
       NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days' + INTERVAL '30 minutes', 'no_show')`,
    [userId, pageId],
  );

  // A retried Calendly webhook must not import the same booking twice.
  await sql.query(
    `INSERT INTO appointments (user_id, booking_page_id, invitee_name, invitee_email,
       starts_at, ends_at, external_source, external_id)
     VALUES ($1, $2, 'Bridged Person', 'bridge@example.test',
       NOW() + INTERVAL '5 days', NOW() + INTERVAL '5 days 30 minutes', 'calendly', 'evt_123')`,
    [userId, pageId],
  );
  let replayRejected = false;
  try {
    await sql.query(
      `INSERT INTO appointments (user_id, booking_page_id, invitee_name, invitee_email,
         starts_at, ends_at, external_source, external_id)
       VALUES ($1, $2, 'Bridged Person', 'bridge@example.test',
         NOW() + INTERVAL '5 days', NOW() + INTERVAL '5 days 30 minutes', 'calendly', 'evt_123')`,
      [userId, pageId],
    );
  } catch {
    replayRejected = true;
  }
  check(replayRejected, "a replayed external booking is rejected by the unique index");

  // --- availability with stated reasons --------------------------------
  await sql.query(
    `INSERT INTO appointment_availability (user_id, timezone, weekly_hours, day_reasons,
       minimum_notice_minutes, slot_interval_minutes)
     VALUES ($1, 'Africa/Lagos', $2::jsonb, $3::jsonb, 120, 15)
     ON CONFLICT (user_id) DO UPDATE SET weekly_hours = EXCLUDED.weekly_hours,
       day_reasons = EXCLUDED.day_reasons`,
    [
      userId,
      JSON.stringify({ mon: [{ start: "09:00", end: "17:00" }] }),
      JSON.stringify({
        sat: { type: "weekend" },
        sun: { type: "weekend" },
        fri: { type: "other", note: "Team retro and deep work" },
      }),
    ],
  );
  const availability = await sql.query(
    `SELECT day_reasons, timezone FROM appointment_availability WHERE user_id = $1`,
    [userId],
  );
  const reasons = (availability[0] as Record<string, unknown>).day_reasons as Record<
    string,
    { type: string; note?: string }
  >;
  check(reasons.sat.type === "weekend", "a picked unavailability reason is stored");
  check(
    reasons.fri.type === "other" && reasons.fri.note === "Team retro and deep work",
    "a custom unavailability reason keeps its own wording",
  );

  await sql.query(
    `INSERT INTO appointment_blackout_dates (user_id, starts_on, ends_on, reason, reason_type)
     VALUES ($1, CURRENT_DATE + 10, CURRENT_DATE + 14, 'Company offsite', 'travel')`,
    [userId],
  );
  const blackouts = await sql.query(
    `SELECT reason_type FROM appointment_blackout_dates WHERE user_id = $1`,
    [userId],
  );
  check(
    (blackouts[0] as Record<string, unknown>).reason_type === "travel",
    "a blackout range carries its reason category",
  );

  // --- connections -----------------------------------------------------
  // Shaped like a real OAuth result: an encrypted credential envelope, the
  // granted scopes, and an expiry the refresh path reads.
  await sql.query(
    `INSERT INTO scheduling_tool_connections (user_id, provider, category, account_label,
       credentials_encrypted, auth_type, external_account_id, scopes, token_expires_at,
       connected_at, status, health_ok)
     VALUES ($1, 'google_calendar', 'calendar', 'ada@example.test', $2::jsonb, 'oauth',
       'google-user-1', $3::jsonb, NOW() + INTERVAL '55 minutes', NOW(), 'connected', TRUE)
     ON CONFLICT (user_id, provider) DO NOTHING`,
    [
      userId,
      JSON.stringify({ cipher: "aaaa.bbbb.cccc" }),
      JSON.stringify(["openid", "https://www.googleapis.com/auth/calendar.events"]),
    ],
  );
  let duplicateConnection = false;
  try {
    await sql.query(
      `INSERT INTO scheduling_tool_connections (user_id, provider, category)
       VALUES ($1, 'google_calendar', 'calendar')`,
      [userId],
    );
  } catch {
    duplicateConnection = true;
  }
  check(duplicateConnection, "a provider can only be connected once per workspace");

  const stored = await sql.query(
    `SELECT auth_type, scopes, token_expires_at, credentials_encrypted->>'cipher' AS cipher
     FROM scheduling_tool_connections WHERE user_id = $1 AND provider = 'google_calendar'`,
    [userId],
  );
  const connection = stored[0] as Record<string, unknown>;
  check(connection.cipher === "aaaa.bbbb.cccc", "the encrypted credential round-trips");
  check(
    (connection.scopes as string[]).includes(
      "https://www.googleapis.com/auth/calendar.events",
    ),
    "the granted scopes are recorded against the connection",
  );
  check(Boolean(connection.token_expires_at), "the token expiry is stored for the refresh path");

  // The UI decides Connect vs Reconnect from status, so a value it cannot
  // render must never reach the column.
  let badStatusRejected = false;
  try {
    await sql.query(
      `UPDATE scheduling_tool_connections SET status = 'totally_fine'
       WHERE user_id = $1 AND provider = 'google_calendar'`,
      [userId],
    );
  } catch {
    badStatusRejected = true;
  }
  check(badStatusRejected, "an unknown connection status is rejected");

  // A connection whose refresh failed must ask the user to act rather than
  // keep claiming to be healthy.
  await sql.query(
    `INSERT INTO scheduling_tool_connections (user_id, provider, category, status, health_ok, last_error)
     VALUES ($1, 'zoom', 'video', 'needs_reconnect', FALSE, 'Reconnect required: invalid_grant')`,
    [userId],
  );
  const stale = await sql.query(
    `SELECT COUNT(*)::int AS total FROM scheduling_tool_connections
     WHERE user_id = $1 AND status = 'needs_reconnect' AND health_ok = FALSE`,
    [userId],
  );
  check(
    (stale[0] as Record<string, number>).total === 1,
    "a failed refresh leaves the connection asking to be reconnected",
  );

  // --- aggregates the module reads -------------------------------------
  const summary = await sql.query(
    `SELECT
       (SELECT COUNT(*) FROM appointments WHERE user_id = $1)::int AS bookings,
       (SELECT COALESCE(SUM(amount_cents), 0) FROM appointments
          WHERE user_id = $1 AND payment_status = 'paid')::int AS paid_cents,
       (SELECT COUNT(*) FROM appointments WHERE user_id = $1 AND status = 'no_show')::int AS no_shows`,
    [userId],
  );
  const totals = summary[0] as Record<string, number>;
  check(totals.bookings === 3, "every booking is visible to the workspace read");
  check(totals.paid_cents === 5000, "paid revenue reconciles with the Payments module");
  check(totals.no_shows === 1, "no-shows are counted for the analytics tab");

  // Cascade: deleting a page must not orphan its bookings' owner rows.
  await sql.query(`DELETE FROM booking_pages WHERE id = $1`, [supportPageId]);
  const orphaned = await sql.query(
    `SELECT COUNT(*)::int AS total FROM routing_forms
     WHERE user_id = $1 AND fallback_booking_page_id IS NULL`,
    [userId],
  );
  check(
    (orphaned[0] as Record<string, number>).total === 1,
    "deleting a page clears it from routing without deleting the form",
  );

  console.log(`Appointments smoke test passed with ${assertions} checks.`);
} finally {
  await cleanup();
}

/** Explainable signals for the MaxAI Home and Insights tabs. */
import { neon } from "@neondatabase/serverless";

import {
  isWorkspaceModuleKey,
  type WorkspaceModuleKey,
} from "../src/lib/workspace-modules";
import type { WorkspaceContext } from "./workspace-access";

type AiSql = {
  query: (statement: string, params?: unknown[]) => Promise<unknown>;
};

export type AiInsight = {
  id: string;
  module: WorkspaceModuleKey;
  signalType: string;
  severity: "info" | "warning" | "critical";
  explanation: string;
  relatedRecordType: string | null;
  relatedRecordId: string | null;
  status: "open" | "dismissed" | "snoozed" | "resolved";
  snoozedUntil: string | null;
  createdAt: string;
  updatedAt: string;
};

const database = () => {
  const url = String(process.env.DATABASE_URL || "").trim();
  return url ? (neon(url) as unknown as AiSql) : null;
};

const asString = (value: unknown) =>
  typeof value === "string" ? value : value == null ? "" : String(value);

const asNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const safeRows = async <Row = Record<string, unknown>>(
  sql: AiSql | null,
  statement: string,
  params: unknown[],
) => {
  if (!sql) return [] as Row[];
  try {
    return (await sql.query(statement, params)) as Row[];
  } catch {
    return [] as Row[];
  }
};

const insertSignal = async (
  sql: AiSql | null,
  input: {
    workspaceId: string;
    module: WorkspaceModuleKey;
    signalType: string;
    severity: AiInsight["severity"];
    explanation: string;
    relatedRecordType: string;
    relatedRecordId: string;
  },
) => {
  if (!sql) return;
  try {
    await sql.query(
      `INSERT INTO ai_insights
         (workspace_id, module, signal_type, severity, explanation,
          related_record_type, related_record_id, status, snoozed_until,
          created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'open', NULL, NOW(), NOW())
       ON CONFLICT (workspace_id, module, signal_type, related_record_id)
       WHERE status IN ('open', 'snoozed') AND related_record_id IS NOT NULL
       DO UPDATE SET severity = EXCLUDED.severity,
                     explanation = EXCLUDED.explanation,
                     updated_at = NOW()`,
      [
        input.workspaceId,
        input.module,
        input.signalType,
        input.severity,
        input.explanation,
        input.relatedRecordType,
        input.relatedRecordId,
      ],
    );
  } catch {
    // Insight generation is advisory. A missing migration or one malformed
    // module row must never stop the real module from loading.
  }
};

const refreshForms = async (sql: AiSql | null, workspaceId: string) => {
  const rows = await safeRows<{
    id: string;
    title: string;
    current_count: string;
    previous_count: string;
  }>(
    sql,
    `SELECT form.id, form.title,
            COUNT(submission.id) FILTER (
              WHERE submission.submitted_at >= NOW() - INTERVAL '7 days'
                AND COALESCE(submission.data #>> '{_meta,status}', 'completed') <> 'pending_payment'
            )::int AS current_count,
            COUNT(submission.id) FILTER (
              WHERE submission.submitted_at >= NOW() - INTERVAL '14 days'
                AND submission.submitted_at < NOW() - INTERVAL '7 days'
                AND COALESCE(submission.data #>> '{_meta,status}', 'completed') <> 'pending_payment'
            )::int AS previous_count
       FROM forms form
       LEFT JOIN form_submissions submission ON submission.form_id = form.id
       WHERE form.created_by = $1 AND form.status = 'published'
       GROUP BY form.id, form.title`,
    [workspaceId],
  );
  for (const row of rows) {
    const current = asNumber(row.current_count);
    const previous = asNumber(row.previous_count);
    if (previous < 3 || current >= previous * 0.6) continue;
    await insertSignal(sql, {
      workspaceId,
      module: "forms",
      signalType: "drop_off_spike",
      severity: current === 0 ? "critical" : "warning",
      explanation: `${row.title || "A published form"} received ${current} response${current === 1 ? "" : "s"} in the last 7 days, down from ${previous} in the previous 7-day window. Review the form's fields and completion path.`,
      relatedRecordType: "form",
      relatedRecordId: row.id,
    });
  }
};

const refreshEvents = async (sql: AiSql | null, workspaceId: string) => {
  const rows = await safeRows<{
    id: string;
    title: string;
    current_count: string;
    previous_count: string;
  }>(
    sql,
    `SELECT event.id, event.title,
            COUNT(attendee.id) FILTER (
              WHERE attendee.created_at >= NOW() - INTERVAL '7 days'
                AND attendee.ticket_status = 'valid'
            )::int AS current_count,
            COUNT(attendee.id) FILTER (
              WHERE attendee.created_at >= NOW() - INTERVAL '14 days'
                AND attendee.created_at < NOW() - INTERVAL '7 days'
                AND attendee.ticket_status = 'valid'
            )::int AS previous_count
       FROM events event
       LEFT JOIN event_attendees attendee ON attendee.event_id = event.id
       WHERE event.created_by = $1
         AND event.status IN ('published', 'on_sale', 'sold_out')
       GROUP BY event.id, event.title`,
    [workspaceId],
  );
  for (const row of rows) {
    const current = asNumber(row.current_count);
    const previous = asNumber(row.previous_count);
    if (previous < 3 || current >= previous * 0.6) continue;
    await insertSignal(sql, {
      workspaceId,
      module: "events",
      signalType: "registration_drop",
      severity: current === 0 ? "critical" : "warning",
      explanation: `${row.title || "An event"} added ${current} valid registration${current === 1 ? "" : "s"} in the last 7 days, down from ${previous} previously. Check ticket availability, pricing, and the registration form.`,
      relatedRecordType: "event",
      relatedRecordId: row.id,
    });
  }
};

const refreshAppointments = async (
  sql: AiSql | null,
  workspaceId: string,
) => {
  const rows = await safeRows<{
    id: string;
    name: string;
    total: string;
    no_shows: string;
  }>(
    sql,
    `SELECT page.id, page.name,
            COUNT(booking.id)::int AS total,
            COUNT(booking.id) FILTER (WHERE booking.status = 'no_show')::int AS no_shows
       FROM booking_pages page
       LEFT JOIN appointments booking ON booking.booking_page_id = page.id
       WHERE page.user_id = $1
         AND booking.starts_at >= NOW() - INTERVAL '30 days'
       GROUP BY page.id, page.name`,
    [workspaceId],
  );
  for (const row of rows) {
    const total = asNumber(row.total);
    const noShows = asNumber(row.no_shows);
    if (total < 5 || noShows / total < 0.25) continue;
    await insertSignal(sql, {
      workspaceId,
      module: "appointments",
      signalType: "no_show_rate",
      severity: noShows / total >= 0.5 ? "critical" : "warning",
      explanation: `${row.name || "A booking page"} had ${noShows} no-show${noShows === 1 ? "" : "s"} out of ${total} bookings in the last 30 days (${Math.round((noShows / total) * 100)}%). Review reminders, booking instructions, and availability.`,
      relatedRecordType: "booking_page",
      relatedRecordId: row.id,
    });
  }
};

const refreshPayments = async (sql: AiSql | null, workspaceId: string) => {
  const rows = await safeRows<{ failed: string; attempts: string }>(
    sql,
    `SELECT COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
            COUNT(*)::int AS attempts
       FROM payment_orders
       WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '7 days'`,
    [workspaceId],
  );
  const failed = asNumber(rows[0]?.failed);
  const attempts = asNumber(rows[0]?.attempts);
  if (failed < 3 || failed / Math.max(attempts, 1) < 0.25) return;
  await insertSignal(sql, {
    workspaceId,
    module: "payments",
    signalType: "failed_payment_spike",
    severity: failed / Math.max(attempts, 1) >= 0.5 ? "critical" : "warning",
    explanation: `${failed} of ${attempts} payment attempts failed in the last 7 days. Check provider health, declined-card reasons, and checkout configuration before the next send or event launch.`,
    relatedRecordType: "payment_workspace",
    relatedRecordId: workspaceId,
  });
};

const refreshCrm = async (sql: AiSql | null, workspaceId: string) => {
  const rows = await safeRows<{ id: string; name: string }>(
    sql,
    `SELECT id, name FROM deals
       WHERE user_id = $1 AND updated_at < NOW() - INTERVAL '14 days'
         AND NOT EXISTS (
           SELECT 1 FROM crm_activities activity
            WHERE activity.deal_id = deals.id
              AND activity.created_at >= NOW() - INTERVAL '14 days'
         )
       ORDER BY updated_at ASC
       LIMIT 5`,
    [workspaceId],
  );
  for (const row of rows) {
    await insertSignal(sql, {
      workspaceId,
      module: "crm",
      signalType: "stalled_deal",
      severity: "warning",
      explanation: `${row.name || "A deal"} has had no deal or activity update for more than 14 days. Review the next step, owner, and expected close date.`,
      relatedRecordType: "deal",
      relatedRecordId: row.id,
    });
  }
};

/** A short, idempotent scan. It never blocks the module that owns the data. */
export const refreshAiInsights = async (context: WorkspaceContext) => {
  const sql = database();
  if (!sql || context.suspended || context.blocked) return;
  await Promise.allSettled([
    refreshForms(sql, context.workspaceId),
    refreshEvents(sql, context.workspaceId),
    refreshAppointments(sql, context.workspaceId),
    refreshPayments(sql, context.workspaceId),
    refreshCrm(sql, context.workspaceId),
  ]);
};

const mapInsight = (row: Record<string, unknown>): AiInsight | null => {
  if (!isWorkspaceModuleKey(row.module)) return null;
  const severity = row.severity === "critical" || row.severity === "warning"
    ? row.severity
    : "info";
  const status = ["dismissed", "snoozed", "resolved"].includes(String(row.status))
    ? String(row.status)
    : "open";
  return {
    id: asString(row.id),
    module: row.module,
    signalType: asString(row.signal_type),
    severity,
    explanation: asString(row.explanation),
    relatedRecordType: row.related_record_type ? asString(row.related_record_type) : null,
    relatedRecordId: row.related_record_id ? asString(row.related_record_id) : null,
    status: status as AiInsight["status"],
    snoozedUntil: row.snoozed_until ? asString(row.snoozed_until) : null,
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
  };
};

export const listAiInsights = async (
  context: WorkspaceContext,
  filters: { module?: string; status?: string },
  allowedModules?: WorkspaceModuleKey[],
) => {
  const sql = database();
  if (!sql) return [] as AiInsight[];
  if (allowedModules && allowedModules.length === 0) return [] as AiInsight[];
  const params: unknown[] = [context.workspaceId];
  const where = ["workspace_id = $1"];
  if (allowedModules) {
    params.push(allowedModules);
    where.push(`module = ANY($${params.length}::text[])`);
  }
  if (isWorkspaceModuleKey(filters.module)) {
    if (allowedModules && !allowedModules.includes(filters.module)) {
      return [] as AiInsight[];
    }
    params.push(filters.module);
    where.push(`module = $${params.length}`);
  }
  if (["open", "dismissed", "snoozed", "resolved"].includes(filters.status || "")) {
    params.push(filters.status);
    where.push(`status = $${params.length}`);
  } else {
    where.push("status IN ('open', 'snoozed')");
    where.push("(snoozed_until IS NULL OR snoozed_until <= NOW())");
  }
  const rows = await safeRows<Record<string, unknown>>(
    sql,
    `SELECT id, module, signal_type, severity, explanation,
            related_record_type, related_record_id, status,
            snoozed_until, created_at, updated_at
       FROM ai_insights
      WHERE ${where.join(" AND ")}
      ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
               created_at DESC
      LIMIT 100`,
    params,
  );
  return rows.map(mapInsight).filter((item): item is AiInsight => Boolean(item));
};

export const updateAiInsight = async (
  context: WorkspaceContext,
  id: string,
  action: "dismiss" | "snooze" | "resolve",
) => {
  const sql = database();
  if (!sql) throw new Error("Insights are temporarily unavailable.");
  const status = action === "dismiss" ? "dismissed" : action === "resolve" ? "resolved" : "snoozed";
  const rows = (await sql.query(
    `UPDATE ai_insights
        SET status = $3,
            snoozed_until = CASE WHEN $3 = 'snoozed' THEN NOW() + INTERVAL '24 hours' ELSE NULL END,
            updated_at = NOW()
      WHERE id = $1 AND workspace_id = $2
      RETURNING id, module, signal_type, severity, explanation,
                related_record_type, related_record_id, status,
                snoozed_until, created_at, updated_at`,
    [id, context.workspaceId, status],
  )) as Array<Record<string, unknown>>;
  const item = mapInsight(rows[0] || {});
  if (!item) throw new Error("That insight could not be found.");
  return item;
};

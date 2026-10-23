import type { IncomingMessage, ServerResponse } from "node:http";

import { neon } from "@neondatabase/serverless";
import { jwtVerify } from "jose";
import { workspaceScopeFor } from "./workspace-access";

type DatabaseRow = Record<string, unknown>;
type RecordValue = Record<string, unknown>;

export type WorkspaceNotification = {
  actionUrl: string;
  createdAt: string;
  id: string;
  kind:
    | "form_submission"
    | "payment_received"
    | "event_registration"
    | "email_delivery_issue";
  message: string;
  metadata: Record<string, unknown>;
  priority: "info" | "success" | "warning";
  readAt: string | null;
  title: string;
};

export type WorkspaceNotificationList = {
  notifications: WorkspaceNotification[];
  unreadCount: number;
};

class NotificationsError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "notifications_error",
  ) {
    super(message);
  }
}

const database = () => {
  const url = process.env.DATABASE_URL || "";
  if (!url) {
    throw new NotificationsError(
      "Notifications are temporarily unavailable.",
      503,
      "notifications_unavailable",
    );
  }
  return neon(url);
};

const signingSecret = () => {
  const secret = process.env.JWT_SECRET || "";
  if (secret.length < 32) {
    throw new NotificationsError(
      "Notifications are temporarily unavailable.",
      503,
      "notifications_unavailable",
    );
  }
  return new TextEncoder().encode(secret);
};

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

const text = (value: unknown, maximum: number) =>
  String(value ?? "").trim().slice(0, maximum);

const json = (
  response: ServerResponse,
  status: number,
  value: RecordValue,
) => {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "private, no-store, max-age=0");
  response.setHeader("Pragma", "no-cache");
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
    throw new NotificationsError(
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
    if (error instanceof NotificationsError) throw error;
    throw new NotificationsError(
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
    if (body.length > 12_000) {
      throw new NotificationsError("This notification request is too large.", 413);
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
    throw new NotificationsError("This notification request could not be read.");
  }
};

const notificationFor = (row: DatabaseRow): WorkspaceNotification => ({
  actionUrl: text(row.action_url, 500) || "/dashboard",
  createdAt: String(row.created_at || ""),
  id: text(row.id, 64),
  kind: text(row.kind, 40) as WorkspaceNotification["kind"],
  message: text(row.message, 500),
  metadata:
    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {},
  priority: text(row.priority, 16) as WorkspaceNotification["priority"],
  readAt: row.read_at ? String(row.read_at) : null,
  title: text(row.title, 180),
});

/**
 * Materialize notifications from real workspace records. The unique source
 * key makes this safe to run on every refresh and also backfills activity that
 * happened before the notification table was introduced.
 */
export async function syncWorkspaceNotifications(userId: string) {
  const sql = database();
  await Promise.all([
    sql.query(
      `INSERT INTO workspace_notifications (
         user_id, kind, priority, title, message, source_type, source_id,
         action_url, metadata, created_at, updated_at
       )
       SELECT
         $1,
         'form_submission',
         'info',
         'New form response',
         'A new response was submitted to ' || COALESCE(NULLIF(form.title, ''), 'Untitled form') || '.',
         'form_submission',
         submission.id,
         '/dashboard?tab=forms&section=responses',
         jsonb_build_object('formId', form.id, 'formTitle', form.title),
         submission.submitted_at,
         NOW()
       FROM form_submissions submission
       JOIN forms form ON form.id = submission.form_id
       WHERE form.created_by = $1
         AND COALESCE(submission.data #>> '{_meta,status}', 'completed') <> 'pending_payment'
         AND NOT EXISTS (
           SELECT 1
           FROM events event
           WHERE event.registration_form_id = form.id
         )
         AND submission.submitted_at >= NOW() - INTERVAL '90 days'
       ON CONFLICT (user_id, kind, source_type, source_id) DO NOTHING`,
      [userId],
    ),
    sql.query(
      `INSERT INTO workspace_notifications (
         user_id, kind, priority, title, message, source_type, source_id,
         action_url, metadata, created_at, updated_at
       )
       SELECT
         $1,
         'payment_received',
         'success',
         'Payment received',
         'Order ' || COALESCE(NULLIF(payment.order_number, ''), 'payment') ||
           ' was confirmed.',
         'payment_order',
         payment.id,
         '/dashboard?tab=payments&section=orders',
         jsonb_build_object(
           'amount', payment.total_amount,
           'currency', payment.currency,
           'orderNumber', payment.order_number
         ),
         COALESCE(payment.paid_at, payment.updated_at, payment.created_at),
         NOW()
       FROM payment_orders payment
       WHERE payment.user_id = $1
         AND payment.status = 'paid'
         AND COALESCE(payment.paid_at, payment.updated_at, payment.created_at)
           >= NOW() - INTERVAL '90 days'
       ON CONFLICT (user_id, kind, source_type, source_id) DO NOTHING`,
      [userId],
    ),
    sql.query(
      `INSERT INTO workspace_notifications (
         user_id, kind, priority, title, message, source_type, source_id,
         action_url, metadata, created_at, updated_at
       )
       SELECT
         $1,
         'event_registration',
         'info',
         'New event registration',
         'A new attendee registered for ' ||
           COALESCE(NULLIF(event.title, ''), 'your event') || '.',
         'event_attendee',
         attendee.id,
         '/dashboard?tab=events&section=tickets',
         jsonb_build_object('eventId', event.id, 'eventTitle', event.title),
         attendee.created_at,
         NOW()
       FROM event_attendees attendee
       JOIN events event ON event.id = attendee.event_id
       WHERE event.created_by = $1
         AND attendee.ticket_status = 'valid'
         AND attendee.created_at >= NOW() - INTERVAL '90 days'
       ON CONFLICT (user_id, kind, source_type, source_id) DO NOTHING`,
      [userId],
    ),
    sql.query(
      `INSERT INTO workspace_notifications (
         user_id, kind, priority, title, message, source_type, source_id,
         action_url, metadata, created_at, updated_at
       )
       SELECT
         $1,
         'email_delivery_issue',
         'warning',
         CASE
           WHEN email.status = 'bounced' THEN 'Email bounced'
           WHEN email.status = 'complained' THEN 'Email complaint received'
           ELSE 'Email delivery failed'
         END,
         CASE
           WHEN NULLIF(email.subject, '') IS NOT NULL
             THEN 'Delivery issue for “' || LEFT(email.subject, 160) || '”.'
           ELSE 'An email could not be delivered.'
         END,
         'email_log',
         email.id,
         '/dashboard?tab=emails',
         jsonb_build_object(
           'status', email.status,
           'templateKey', email.template_key
         ),
         COALESCE(email.sent_at, email.updated_at, email.created_at),
         NOW()
       FROM email_logs email
       WHERE email.user_id = $1
         AND email.status IN ('failed', 'bounced', 'complained')
         AND COALESCE(email.sent_at, email.updated_at, email.created_at)
           >= NOW() - INTERVAL '90 days'
       ON CONFLICT (user_id, kind, source_type, source_id)
       DO UPDATE SET
         title = EXCLUDED.title,
         message = EXCLUDED.message,
         metadata = EXCLUDED.metadata,
         updated_at = NOW()`,
      [userId],
    ),
  ]);

  await sql.query(
    `DELETE FROM workspace_notifications
     WHERE user_id = $1
       AND kind = 'email_delivery_issue'
       AND NOT EXISTS (
         SELECT 1
         FROM email_logs email
         WHERE email.id = workspace_notifications.source_id
       )`,
    [userId],
  );

  await sql.query(
    `DELETE FROM workspace_notifications
     WHERE user_id = $1
       AND created_at < NOW() - INTERVAL '180 days'`,
    [userId],
  );
}

export async function listWorkspaceNotifications(
  userId: string,
): Promise<WorkspaceNotificationList> {
  await syncWorkspaceNotifications(userId);
  const sql = database();
  const [rows, unreadRows] = await Promise.all([
    sql.query(
      `SELECT id, kind, priority, title, message, action_url, metadata,
              read_at, created_at
       FROM workspace_notifications
       WHERE user_id = $1
         AND dismissed_at IS NULL
       ORDER BY created_at DESC, id DESC
       LIMIT 50`,
      [userId],
    ),
    sql.query(
      `SELECT COUNT(*)::int AS count
       FROM workspace_notifications
       WHERE user_id = $1
         AND dismissed_at IS NULL
         AND read_at IS NULL`,
      [userId],
    ),
  ]);
  return {
    notifications: rows.map((row) => notificationFor(row as DatabaseRow)),
    unreadCount: Number((unreadRows[0] as DatabaseRow | undefined)?.count || 0),
  };
}

export async function markWorkspaceNotificationRead(
  userId: string,
  notificationId: string,
) {
  if (!isUuid(notificationId)) {
    throw new NotificationsError("Choose a valid notification.");
  }
  const rows = await database().query(
    `UPDATE workspace_notifications
     SET read_at = COALESCE(read_at, NOW()),
         updated_at = NOW()
     WHERE id = $1
       AND user_id = $2
       AND dismissed_at IS NULL
     RETURNING id, read_at`,
    [notificationId, userId],
  );
  if (!rows[0]) {
    throw new NotificationsError("This notification was not found.", 404);
  }
  return {
    id: String(rows[0].id),
    readAt: String(rows[0].read_at),
  };
}

export async function markAllWorkspaceNotificationsRead(userId: string) {
  const rows = await database().query(
    `UPDATE workspace_notifications
     SET read_at = NOW(),
         updated_at = NOW()
     WHERE user_id = $1
       AND dismissed_at IS NULL
       AND read_at IS NULL
     RETURNING id`,
    [userId],
  );
  return { updated: rows.length };
}

export async function clearWorkspaceNotifications(userId: string) {
  const rows = await database().query(
    `UPDATE workspace_notifications
     SET dismissed_at = NOW(),
         read_at = COALESCE(read_at, NOW()),
         updated_at = NOW()
     WHERE user_id = $1
       AND dismissed_at IS NULL
     RETURNING id`,
    [userId],
  );
  return { cleared: rows.length };
}

export async function handleNotificationsData(
  request: IncomingMessage,
  response: ServerResponse,
) {
  try {
    const url = new URL(request.url || "/", "http://localhost");
    const action = url.searchParams.get("action") || "list";
    const userId = await authenticatedUserId(request);

    if (request.method === "GET" && action === "list") {
      json(response, 200, await listWorkspaceNotifications(userId));
      return;
    }
    if (request.method === "POST" && action === "read") {
      const body = await readBody(request);
      json(response, 200, {
        notification: await markWorkspaceNotificationRead(
          userId,
          String(body.id || ""),
        ),
      });
      return;
    }
    if (request.method === "POST" && action === "read-all") {
      json(response, 200, await markAllWorkspaceNotificationsRead(userId));
      return;
    }
    if (request.method === "POST" && action === "clear-all") {
      json(response, 200, await clearWorkspaceNotifications(userId));
      return;
    }

    json(response, 404, {
      code: "notification_action_not_found",
      error: "This notification action is not available.",
    });
  } catch (error) {
    if (error instanceof NotificationsError) {
      json(response, error.status, {
        code: error.code,
        error: error.message,
      });
      return;
    }
    const databaseCode =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code || "")
        : "";
    console.error("[notifications-data] unexpected request failure", {
      code: databaseCode || "unknown",
      type: error instanceof Error ? error.name : typeof error,
    });
    json(response, 500, {
      code: "notifications_unavailable",
      error: "Notifications could not be loaded. Please try again.",
    });
  }
}

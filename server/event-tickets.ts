import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { neon } from "@neondatabase/serverless";
import { jwtVerify } from "jose";
import { sendEventCheckinEmailNow } from "./event-mail";
import { parseEventTicketDownloadToken } from "./event-ticket-download";
import { workspaceScopeFor } from "./workspace-access";
import { dispatchWorkspaceWorkflowEvent } from "./workflows-data";

type DatabaseRow = Record<string, unknown>;

const databaseUrl = () => process.env.DATABASE_URL || "";

const sqlClient = () => {
  const url = databaseUrl();
  if (!url) throw new Error("DATABASE_URL is not configured");
  return neon(url);
};

const json = (
  response: ServerResponse,
  status: number,
  value: Record<string, unknown>,
) => {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.end(JSON.stringify(value));
};

const readBody = async (request: IncomingMessage) => {
  let value = "";
  for await (const chunk of request) {
    value += chunk;
    if (value.length > 1_000_000) throw new Error("Request is too large");
  }
  return value ? (JSON.parse(value) as Record<string, unknown>) : {};
};

const authenticatedUserId = async (request: IncomingMessage) => {
  const authorization = String(request.headers.authorization || "");
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  if (!token) throw new Error("AUTHENTICATION_REQUIRED");
  const signingSecret = process.env.JWT_SECRET || "";
  if (signingSecret.length < 32) throw new Error("AUTHENTICATION_REQUIRED");
  const secret = new TextEncoder().encode(signingSecret);
  try {
    const { payload } = await jwtVerify(token, secret, {
      audience: "maxform-dashboard",
      issuer: "maxform",
    });
    const userId = String(payload.userId || "");
    if (!/^[0-9a-f-]{36}$/i.test(userId)) {
      throw new Error("AUTHENTICATION_REQUIRED");
    }
    // The workspace this request acts in. Identical to the signed-in id
    // for a workspace owner; an added member resolves to the workspace
    // they belong to, so every query below reads the same rows.
    return workspaceScopeFor(userId);
  } catch {
    throw new Error("AUTHENTICATION_REQUIRED");
  }
};

const ticketSecret = () => {
  const secret =
    process.env.EVENT_TICKET_SECRET || process.env.JWT_SECRET || "";
  if (secret.length < 32) throw new Error("TICKET_SERVICE_UNAVAILABLE");
  return secret;
};

const sign = (payload: string) =>
  createHmac("sha256", ticketSecret()).update(payload).digest("base64url");

const createTicketCode = (
  eventId: string,
  attendeeId: string,
  version: number,
) => {
  const payload = Buffer.from(
    JSON.stringify({ e: eventId, t: attendeeId, v: version }),
  ).toString("base64url");
  return `mfe1.${payload}.${sign(payload)}`;
};

const parseTicketCode = (token: string) => {
  const [prefix, payload, signature] = token.split(".");
  if (prefix !== "mfe1" || !payload || !signature) return null;
  const expected = Buffer.from(sign(payload));
  const actual = Buffer.from(signature);
  if (
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  ) {
    return null;
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    const eventId = String(parsed.e || "");
    const attendeeId = String(parsed.t || "");
    const version = Number(parsed.v || 0);
    if (!eventId || !attendeeId || !version) return null;
    return { eventId, attendeeId, version };
  } catch {
    return null;
  }
};

const ownedEvent = async (
  sql: ReturnType<typeof sqlClient>,
  eventId: string,
  userId: string,
) => {
  const rows = (await sql.query(
    `SELECT id FROM events WHERE id = $1 AND created_by = $2 LIMIT 1`,
    [eventId, userId],
  )) as DatabaseRow[];
  return Boolean(rows[0]);
};

export const validatorTokenPattern = /^[A-Za-z0-9_-]{22}$/;

export const createWorkspaceValidatorToken = () =>
  randomBytes(16).toString("base64url");

const requestAddress = (request: IncomingMessage) => {
  const forwarded =
    process.env.TRUST_PROXY_HEADERS === "true"
      ? String(request.headers["x-forwarded-for"] || "")
          .split(",")[0]
          .trim()
      : "";
  return forwarded || request.socket.remoteAddress || "unknown";
};

const enforceValidatorRateLimit = async (
  sql: ReturnType<typeof sqlClient>,
  request: IncomingMessage,
  maskedId: string,
) => {
  const identityHash = createHmac("sha256", ticketSecret())
    .update(`maxform:ticket-validator:${maskedId}:${requestAddress(request)}`)
    .digest("hex");
  const rows = (await sql.query(
    `WITH pruned AS (
       DELETE FROM event_ticket_validator_rate_limits
       WHERE window_started_at < NOW() - INTERVAL '24 hours'
     ), limited AS (
       INSERT INTO event_ticket_validator_rate_limits (
         identity_hash, request_count, window_started_at, updated_at
       ) VALUES ($1, 1, NOW(), NOW())
       ON CONFLICT (identity_hash) DO UPDATE
       SET request_count = CASE
             WHEN event_ticket_validator_rate_limits.window_started_at
               <= NOW() - INTERVAL '1 minute' THEN 1
             ELSE event_ticket_validator_rate_limits.request_count + 1
           END,
           window_started_at = CASE
             WHEN event_ticket_validator_rate_limits.window_started_at
               <= NOW() - INTERVAL '1 minute' THEN NOW()
             ELSE event_ticket_validator_rate_limits.window_started_at
           END,
           updated_at = NOW()
       RETURNING request_count
     )
     SELECT request_count FROM limited`,
    [identityHash],
  )) as DatabaseRow[];
  if (Number(rows[0]?.request_count || 0) > 60) {
    throw new Error("RATE_LIMITED");
  }
};

const workspaceValidatorLink = async (
  sql: ReturnType<typeof sqlClient>,
  userId: string,
) => {
  const maskedId = createWorkspaceValidatorToken();
  const rows = (await sql.query(
    `INSERT INTO workspace_ticket_validator_links (
       user_id, masked_id, active, created_at, updated_at
     ) VALUES ($1, $2, TRUE, NOW(), NOW())
     ON CONFLICT (user_id) DO UPDATE
     SET active = TRUE, updated_at = NOW()
     RETURNING masked_id, rotated_at`,
    [userId, maskedId],
  )) as DatabaseRow[];
  const savedMaskedId = String(rows[0]?.masked_id || "");
  return {
    maskedId: savedMaskedId,
    path: `/${savedMaskedId}/checkin`,
    rotatedAt: String(rows[0]?.rotated_at || ""),
  };
};

const rotateWorkspaceValidatorLink = async (
  sql: ReturnType<typeof sqlClient>,
  userId: string,
) => {
  const maskedId = createWorkspaceValidatorToken();
  const rows = (await sql.query(
    `INSERT INTO workspace_ticket_validator_links (
       user_id, masked_id, active, created_at, rotated_at, updated_at
     ) VALUES ($1, $2, TRUE, NOW(), NOW(), NOW())
     ON CONFLICT (user_id) DO UPDATE
     SET masked_id = $2, active = TRUE,
       rotated_at = NOW(), updated_at = NOW()
     RETURNING masked_id, rotated_at`,
    [userId, maskedId],
  )) as DatabaseRow[];
  const savedMaskedId = String(rows[0]?.masked_id || "");
  return {
    maskedId: savedMaskedId,
    path: `/${savedMaskedId}/checkin`,
    rotatedAt: String(rows[0]?.rotated_at || ""),
  };
};

const publicValidatorWorkspace = async (
  sql: ReturnType<typeof sqlClient>,
  maskedId: string,
) => {
  if (!validatorTokenPattern.test(maskedId)) throw new Error("INVALID_LINK");
  const rows = (await sql.query(
    `SELECT link.user_id,
       COALESCE(
         NULLIF(company.company_name, ''),
         NULLIF(preferences.organizer_name, ''),
         NULLIF(owner.full_name, ''),
         'Event team'
       ) AS workspace_name,
       COALESCE(company.company_logo_url, '') AS workspace_logo_url,
       COALESCE(NULLIF(company.brand_color, ''), '#F93D0A') AS workspace_brand_color
     FROM workspace_ticket_validator_links link
     JOIN users owner ON owner.id = link.user_id
     LEFT JOIN company_settings company ON company.user_id = link.user_id
     LEFT JOIN event_module_preferences preferences
       ON preferences.user_id = link.user_id
     WHERE link.masked_id = $1 AND link.active = TRUE
     LIMIT 1`,
    [maskedId],
  )) as DatabaseRow[];
  const row = rows[0];
  if (!row) throw new Error("INVALID_LINK");
  return {
    brandColor: /^#[0-9A-F]{6}$/i.test(String(row.workspace_brand_color || ""))
      ? String(row.workspace_brand_color).toUpperCase()
      : "#F93D0A",
    logoUrl: String(row.workspace_logo_url || ""),
    userId: String(row.user_id || ""),
    workspaceName: String(row.workspace_name || "Event team"),
  };
};

export async function issueStoredEventTicket(
  eventId: string,
  attendeeId: string,
) {
  if (!eventId || !attendeeId) return null;
  const sql = sqlClient();
  const attendees = (await sql.query(
    `SELECT attendee.id, attendee.code_version, attendee.ticket_number,
       attendee.ticket_code, attendee.issued_at,
       design.id AS design_id, design.template_id,
       COALESCE(design.theme, template.theme, '{}'::jsonb) AS design_theme,
       design.front_layout AS design_front_layout,
       design.back_layout AS design_back_layout
     FROM event_attendees attendee
     LEFT JOIN LATERAL (
       SELECT saved_design.id, saved_design.template_id,
         saved_design.theme, saved_design.front_layout,
         saved_design.back_layout
       FROM event_ticket_designs saved_design
       WHERE saved_design.event_id = attendee.event_id
         AND (
           saved_design.ticket_type_id = attendee.ticket_type_id
           OR saved_design.ticket_type_id IS NULL
         )
       ORDER BY
         CASE WHEN saved_design.ticket_type_id = attendee.ticket_type_id
           THEN 0 ELSE 1 END,
         saved_design.updated_at DESC
       LIMIT 1
     ) design ON TRUE
     LEFT JOIN event_ticket_design_templates template
       ON template.id = design.template_id
     WHERE attendee.id = $1
       AND attendee.event_id = $2
     LIMIT 1`,
    [attendeeId, eventId],
  )) as DatabaseRow[];
  const attendee = attendees[0];
  if (!attendee) return null;
  const ticketCode =
    String(attendee.ticket_code || "") ||
    createTicketCode(
      eventId,
      attendeeId,
      Number(attendee.code_version || 1),
    );
  await sql.query(
    `UPDATE event_attendees
     SET ticket_code = COALESCE(ticket_code, $1),
         issued_design_id = COALESCE(issued_design_id, $2::uuid),
         issued_template_id = COALESCE(issued_template_id, $3),
         issued_theme = COALESCE(issued_theme, $4::jsonb),
         issued_front_layout = COALESCE(issued_front_layout, $5::jsonb),
         issued_back_layout = COALESCE(issued_back_layout, $6::jsonb),
         issued_at = COALESCE(issued_at, NOW()),
         updated_at = NOW()
     WHERE id = $7
       AND event_id = $8`,
    [
      ticketCode,
      attendee.design_id || null,
      String(attendee.template_id || "") || null,
      JSON.stringify(attendee.design_theme || {}),
      JSON.stringify(attendee.design_front_layout || []),
      JSON.stringify(attendee.design_back_layout || []),
      attendeeId,
      eventId,
    ],
  );
  return {
    attendeeId,
    ticketCode,
    ticketNumber: String(attendee.ticket_number || ""),
    designId: String(attendee.design_id || ""),
    templateId: String(attendee.template_id || ""),
  };
}

const logScan = async (
  sql: ReturnType<typeof sqlClient>,
  input: {
    eventId: string;
    attendeeId?: string;
    result: string;
    userId?: string | null;
    station: string;
    overrideReason?: string;
  },
) => {
  await sql.query(
    `INSERT INTO event_ticket_scans (
       event_id, attendee_id, result, scanned_by, station, override_reason,
       scanned_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      input.eventId,
      input.attendeeId || null,
      input.result,
      input.userId || null,
      input.station,
      input.overrideReason || null,
    ],
  );
};

async function issueTicket(
  sql: ReturnType<typeof sqlClient>,
  userId: string,
  body: Record<string, unknown>,
) {
  const eventId = String(body.eventId || "");
  const attendeeId = String(body.attendeeId || "");
  if (!eventId || !attendeeId) {
    throw new Error("INVALID_REQUEST");
  }
  const attendees = (await sql.query(
    `SELECT attendee.id, attendee.code_version, attendee.ticket_number
     FROM event_attendees attendee
     JOIN events event ON event.id = attendee.event_id
     WHERE attendee.id = $1
       AND attendee.event_id = $2
       AND event.created_by = $3
     LIMIT 1`,
    [attendeeId, eventId, userId],
  )) as DatabaseRow[];
  const attendee = attendees[0];
  if (!attendee) throw new Error("NOT_FOUND");
  return issueStoredEventTicket(eventId, attendeeId);
}

async function scanTicket(
  sql: ReturnType<typeof sqlClient>,
  workspaceUserId: string,
  body: Record<string, unknown>,
  actorUserId: string | null = workspaceUserId,
  allowOverride = true,
) {
  const requestedEventId = String(body.eventId || "");
  const station = String(body.station || "").trim() || "Main entrance";
  const overrideReason = String(body.overrideReason || "").trim();
  if (
    requestedEventId &&
    !(await ownedEvent(sql, requestedEventId, workspaceUserId))
  ) {
    throw new Error("NOT_FOUND");
  }

  let attendeeId = String(body.attendeeId || "");
  const ticketCode = String(body.ticketCode || "").trim();
  let parsedTicket: ReturnType<typeof parseTicketCode> = null;
  let resolvedEventId = requestedEventId;
  if (ticketCode) {
    parsedTicket = parseTicketCode(ticketCode);
    if (parsedTicket) {
      if (
        requestedEventId &&
        parsedTicket.eventId !== requestedEventId
      ) {
        return {
          result: "wrong_event",
          message: "This ticket belongs to a different event.",
        };
      }
      resolvedEventId = parsedTicket.eventId;
      attendeeId = parsedTicket.attendeeId;
    } else {
      const numberRows = (await sql.query(
        `SELECT attendee.id, attendee.event_id
         FROM event_attendees attendee
         JOIN events event ON event.id = attendee.event_id
         WHERE event.created_by = $1
           AND UPPER(attendee.ticket_number) = UPPER($2)
         LIMIT 1`,
        [workspaceUserId, ticketCode],
      )) as DatabaseRow[];
      attendeeId = String(numberRows[0]?.id || "");
      resolvedEventId = String(numberRows[0]?.event_id || resolvedEventId);
      if (!attendeeId) {
        return {
          result: "invalid_signature",
          message: "This ticket number or QR code is not valid.",
        };
      }
      if (requestedEventId && resolvedEventId !== requestedEventId) {
        return {
          result: "wrong_event",
          message: "This ticket belongs to a different event.",
        };
      }
    }
  }
  if (!attendeeId) throw new Error("INVALID_REQUEST");

  const attendeeRows = (await sql.query(
    `SELECT attendee.id, attendee.event_id, attendee.full_name,
       attendee.ticket_status, attendee.checked_in_at, attendee.code_version,
       attendee.ticket_code, attendee.ticket_number,
       ticket_type.name AS ticket_type_name,
       staff.full_name AS checked_in_by_name,
       event.title AS event_title
     FROM event_attendees attendee
     JOIN events event ON event.id = attendee.event_id
     LEFT JOIN event_ticket_types ticket_type ON ticket_type.id = attendee.ticket_type_id
     LEFT JOIN users staff ON staff.id = attendee.checked_in_by
     WHERE attendee.id = $1
       AND event.created_by = $2
     LIMIT 1`,
    [attendeeId, workspaceUserId],
  )) as DatabaseRow[];
  const attendee = attendeeRows[0];
  if (!attendee) {
    return {
      result: "invalid_signature",
      message: "This ticket number or QR code is not valid.",
    };
  }
  resolvedEventId = String(attendee.event_id || resolvedEventId);
  if (requestedEventId && resolvedEventId !== requestedEventId) {
    return {
      result: "wrong_event",
      message: "This ticket is not registered for this event.",
    };
  }
  if (
    parsedTicket &&
    (String(attendee.ticket_code || "") !== ticketCode ||
      Number(attendee.code_version || 0) !==
        Number(parsedTicket.version || -1))
  ) {
    return {
      result: "invalid_signature",
      message: "This ticket has been replaced and is no longer valid.",
    };
  }

  const status = String(attendee.ticket_status || "");
  const eventResult = {
    eventId: resolvedEventId,
    eventTitle: String(attendee.event_title || "Event"),
  };
  if (overrideReason && allowOverride && actorUserId) {
    await sql.query(
      `UPDATE event_attendees
       SET checked_in_at = COALESCE(checked_in_at, NOW()),
           checked_in_by = $1,
           updated_at = NOW()
       WHERE id = $2 AND event_id = $3`,
      [actorUserId, attendeeId, resolvedEventId],
    );
    await logScan(sql, {
      eventId: resolvedEventId,
      attendeeId,
      result: "manual_override",
      userId: actorUserId,
      station,
      overrideReason,
    });
    void sendEventCheckinEmailNow(resolvedEventId, attendeeId).catch(() => undefined);
    void dispatchWorkspaceWorkflowEvent(
      workspaceUserId,
      "attendee_checked_in",
      { id: attendeeId, attendeeId, eventId: resolvedEventId, result: "manual_override" },
      `attendee_checked_in:${attendeeId}`,
    ).catch(() => undefined);
    return {
      result: "manual_override",
      attendeeName: String(attendee.full_name || "Attendee"),
      ticketTypeName: String(attendee.ticket_type_name || "Ticket"),
      ticketNumber: String(attendee.ticket_number || ""),
      ...eventResult,
      message: `Override recorded for ${String(attendee.full_name || "attendee")}.`,
    };
  }

  if (status === "refunded" || status === "void") {
    await logScan(sql, {
      eventId: resolvedEventId,
      attendeeId,
      result: status,
      userId: actorUserId,
      station,
    });
    return {
      result: status,
      attendeeName: String(attendee.full_name || "Attendee"),
      ticketNumber: String(attendee.ticket_number || ""),
      ...eventResult,
      message:
        status === "refunded"
          ? "This ticket was refunded. Do not admit."
          : "This ticket was voided. Do not admit.",
    };
  }
  if (status !== "valid") {
    await logScan(sql, {
      eventId: resolvedEventId,
      attendeeId,
      result: "void",
      userId: actorUserId,
      station,
    });
    return {
      result: "void",
      attendeeName: String(attendee.full_name || "Attendee"),
      ticketNumber: String(attendee.ticket_number || ""),
      ...eventResult,
      message: "This ticket is no longer valid.",
    };
  }

  const updated = (await sql.query(
    `UPDATE event_attendees
     SET checked_in_at = NOW(), checked_in_by = $1, updated_at = NOW()
     WHERE id = $2
       AND event_id = $3
       AND ticket_status = 'valid'
       AND checked_in_at IS NULL
     RETURNING checked_in_at`,
    [actorUserId, attendeeId, resolvedEventId],
  )) as DatabaseRow[];
  if (updated[0]) {
    await logScan(sql, {
      eventId: resolvedEventId,
      attendeeId,
      result: "valid",
      userId: actorUserId,
      station,
    });
    void sendEventCheckinEmailNow(resolvedEventId, attendeeId).catch(() => undefined);
    void dispatchWorkspaceWorkflowEvent(
      workspaceUserId,
      "attendee_checked_in",
      { id: attendeeId, attendeeId, eventId: resolvedEventId, result: "valid" },
      `attendee_checked_in:${attendeeId}`,
    ).catch(() => undefined);
    return {
      result: "valid",
      attendeeName: String(attendee.full_name || "Attendee"),
      ticketTypeName: String(attendee.ticket_type_name || "Ticket"),
      ticketNumber: String(attendee.ticket_number || ""),
      checkedInAt: String(updated[0].checked_in_at || ""),
      ...eventResult,
      message: `Welcome, ${String(attendee.full_name || "attendee")}.`,
    };
  }

  const latest = (await sql.query(
    `SELECT attendee.checked_in_at, staff.full_name AS checked_in_by_name
     FROM event_attendees attendee
     LEFT JOIN users staff ON staff.id = attendee.checked_in_by
     WHERE attendee.id = $1`,
    [attendeeId],
  )) as DatabaseRow[];
  await logScan(sql, {
    eventId: resolvedEventId,
    attendeeId,
    result: "already_used",
    userId: actorUserId,
    station,
  });
  return {
    result: "already_used",
    attendeeName: String(attendee.full_name || "Attendee"),
    ticketNumber: String(attendee.ticket_number || ""),
    checkedInAt: String(latest[0]?.checked_in_at || ""),
    checkedInByName: String(latest[0]?.checked_in_by_name || ""),
    ...eventResult,
    message: "This ticket has already been checked in.",
  };
}

const jsonValue = <T>(value: unknown, fallback: T): T => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as T;
  }
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? parsed as T : fallback;
  } catch {
    return fallback;
  }
};

const publicTicketDownload = async (
  sql: ReturnType<typeof sqlClient>,
  token: string,
) => {
  const scope = parseEventTicketDownloadToken(token);
  if (!scope) throw new Error("INVALID_LINK");

  const rows = (await sql.query(
    `SELECT attendee.id AS attendee_id, attendee.full_name AS attendee_name,
       attendee.email AS attendee_email, attendee.ticket_code,
       attendee.ticket_number, attendee.issued_at,
       event.id AS event_id, event.title AS event_title,
       event.description AS event_description, event.status AS event_status,
       event.event_code, event.event_date, event.range_start_date,
       event.starts_at, event.ends_at, event.schedule_start_time,
       event.schedule_end_time, event.timezone, event.venue_name,
       event.address, event.online_url, event.refund_policy, event.seo,
       COALESCE(
         payment.order_number,
         CASE WHEN event_order.id IS NOT NULL
           THEN 'Event order ' || UPPER(SUBSTRING(REPLACE(event_order.id::text, '-', '') FROM 1 FOR 8))
           ELSE ''
         END
       ) AS order_code,
       ticket_type.name AS ticket_type_name, ticket_type.price AS ticket_price,
       ticket_type.currency AS ticket_currency,
       CASE WHEN attendee.issued_at IS NOT NULL
         THEN COALESCE(attendee.issued_theme, '{}'::jsonb)
         ELSE COALESCE(design.theme, template.theme, '{}'::jsonb)
       END AS ticket_theme,
       CASE WHEN attendee.issued_at IS NOT NULL
         THEN COALESCE(attendee.issued_front_layout, '[]'::jsonb)
         ELSE COALESCE(design.front_layout, template.front_layout, '[]'::jsonb)
       END AS ticket_front_layout,
       CASE WHEN attendee.issued_at IS NOT NULL
         THEN COALESCE(attendee.issued_back_layout, '[]'::jsonb)
         ELSE COALESCE(design.back_layout, template.back_layout, '[]'::jsonb)
       END AS ticket_back_layout,
       CASE WHEN attendee.issued_at IS NOT NULL
         THEN COALESCE(attendee.issued_template_id, design.template_id)
         ELSE COALESCE(design.template_id, template.id)
       END AS ticket_template_id,
       owner.short_id AS workspace_id,
       COALESCE(
         NULLIF(company.company_name, ''),
         NULLIF(preferences.organizer_name, ''),
         NULLIF(owner.full_name, ''),
         'Event team'
       ) AS workspace_name,
       COALESCE(company.company_logo_url, '') AS workspace_logo_url,
       COALESCE(NULLIF(company.brand_color, ''), '#F93D0A') AS workspace_brand_color
     FROM event_attendees attendee
     JOIN events event ON event.id = attendee.event_id
     JOIN users owner ON owner.id = event.created_by
     LEFT JOIN company_settings company ON company.user_id = event.created_by
     LEFT JOIN event_module_preferences preferences
       ON preferences.user_id = event.created_by
     LEFT JOIN event_ticket_types ticket_type
       ON ticket_type.id = attendee.ticket_type_id
     LEFT JOIN event_orders event_order
       ON event_order.id = attendee.order_id
     LEFT JOIN payments event_payment
       ON event_payment.id = event_order.payment_id
     LEFT JOIN payment_orders payment
       ON payment.id = event_payment.order_id
     LEFT JOIN LATERAL (
       SELECT saved_design.*
       FROM event_ticket_designs saved_design
       WHERE saved_design.event_id = attendee.event_id
         AND (
           saved_design.ticket_type_id = attendee.ticket_type_id
           OR saved_design.ticket_type_id IS NULL
         )
       ORDER BY
         CASE WHEN saved_design.ticket_type_id = attendee.ticket_type_id
           THEN 0 ELSE 1 END,
         saved_design.updated_at DESC
       LIMIT 1
     ) design ON TRUE
     LEFT JOIN event_ticket_design_templates template
       ON template.id = design.template_id
     WHERE attendee.event_id = $1
       AND attendee.ticket_status = 'valid'
       AND attendee.ticket_code IS NOT NULL
       AND (
         ($2::uuid IS NOT NULL AND attendee.order_id = $2::uuid)
         OR ($3::uuid IS NOT NULL AND attendee.id = $3::uuid)
       )
       AND event.status <> 'cancelled'
     ORDER BY attendee.created_at, attendee.id`,
    [scope.eventId, scope.orderId || null, scope.attendeeId || null],
  )) as DatabaseRow[];

  if (!rows.length) throw new Error("INVALID_LINK");
  const first = rows[0];
  const workspaceBrandColor = String(first.workspace_brand_color || "");
  const ticket = (row: DatabaseRow) => ({
    attendeeEmail: String(row.attendee_email || ""),
    attendeeName: String(row.attendee_name || ""),
    code: String(row.ticket_code || ""),
    design: {
      backLayout: jsonValue(row.ticket_back_layout, []),
      frontLayout: jsonValue(row.ticket_front_layout, []),
      templateId: String(row.ticket_template_id || ""),
      theme: jsonValue(row.ticket_theme, {}),
    },
    endsAt: String(row.ends_at || ""),
    eventCode: String(row.event_code || ""),
    eventDescription: String(row.event_description || ""),
    eventTitle: String(row.event_title || "Event"),
    location: String(row.venue_name || row.address || row.online_url || ""),
    number: String(row.ticket_number || ""),
    onlineUrl: String(row.online_url || ""),
    orderCode: String(row.order_code || ""),
    price: Number(row.ticket_price || 0),
    seo: jsonValue(row.seo, {}),
    startsAt: String(row.starts_at || row.event_date || row.range_start_date || ""),
    terms: String(row.refund_policy || "Present this ticket at the event entrance."),
    ticketType: String(row.ticket_type_name || "Admission"),
    timezone: String(row.timezone || "UTC"),
    venue: String(row.venue_name || ""),
  });

  return {
    tickets: rows.map(ticket),
    workspace: {
      accentColor: /^#[0-9A-F]{6}$/i.test(workspaceBrandColor)
        ? workspaceBrandColor
        : "#F93D0A",
      logoUrl: String(first.workspace_logo_url || ""),
      name: String(first.workspace_name || "Event team"),
    },
  };
};

export async function handleEventTickets(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const url = new URL(request.url || "/", "http://localhost");
  const action = url.searchParams.get("action");
  if (request.method === "GET" && action === "download") {
    try {
      const result = await publicTicketDownload(
        sqlClient(),
        String(url.searchParams.get("token") || ""),
      );
      json(response, 200, result);
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      json(response, code === "INVALID_LINK" ? 404 : 400, {
        message:
          code === "INVALID_LINK"
            ? "This ticket link is invalid, expired, or no longer available."
            : "We could not load this ticket. Please request a new ticket link.",
      });
    }
    return;
  }
  if (request.method !== "POST") {
    json(response, 405, {
      message: "This ticket action is not available.",
    });
    return;
  }
  try {
    const body = await readBody(request);
    const sql = sqlClient();
    if (action === "public-info" || action === "public-scan") {
      const maskedId = String(body.maskedId || "").trim();
      await enforceValidatorRateLimit(sql, request, maskedId);
      const workspace = await publicValidatorWorkspace(sql, maskedId);
      if (action === "public-info") {
        json(response, 200, {
          brandColor: workspace.brandColor,
          logoUrl: workspace.logoUrl,
          maskedId,
          workspaceName: workspace.workspaceName,
        });
        return;
      }
      const result = await scanTicket(
        sql,
        workspace.userId,
        body,
        null,
        false,
      );
      await sql.query(
        `UPDATE workspace_ticket_validator_links
         SET last_used_at = NOW(), updated_at = NOW()
         WHERE masked_id = $1`,
        [maskedId],
      );
      json(response, 200, result);
      return;
    }
    const userId = await authenticatedUserId(request);
    const result =
      action === "issue"
        ? await issueTicket(sql, userId, body)
        : action === "scan"
          ? await scanTicket(sql, userId, body)
          : action === "validator-link"
            ? await workspaceValidatorLink(sql, userId)
            : action === "rotate-validator-link"
              ? await rotateWorkspaceValidatorLink(sql, userId)
              : null;
    if (!result) {
      json(response, 400, {
        message: "Choose a valid ticket action.",
      });
      return;
    }
    json(response, 200, result);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (
      ![
        "AUTHENTICATION_REQUIRED",
        "NOT_FOUND",
        "INVALID_LINK",
        "RATE_LIMITED",
      ].includes(code)
    ) {
      console.error("[event-tickets] unexpected request failure", {
        type: error instanceof Error ? error.name : typeof error,
      });
    }
    const status =
      code === "AUTHENTICATION_REQUIRED"
        ? 401
        : code === "RATE_LIMITED"
          ? 429
          : code === "INVALID_LINK"
            ? 404
            : code === "NOT_FOUND"
              ? 404
              : 400;
    const message =
      code === "AUTHENTICATION_REQUIRED"
        ? "Your session has expired. Sign in again to continue."
        : code === "RATE_LIMITED"
          ? "Too many validation attempts were received. Wait a minute and try again."
          : code === "INVALID_LINK"
            ? "This validator link is invalid or has been replaced."
            : code === "NOT_FOUND"
              ? "That event or ticket could not be found."
              : "We could not complete that ticket action. Please try again.";
    json(response, status, { message });
  }
}

import { randomUUID } from "node:crypto";

import { publishCampaignAnalytics } from "./campaign-realtime";
import {
  createCampaignDatabase,
  type CampaignDatabase,
} from "./campaign-database";
import {
  campaignQueueConfigured,
  enqueueCampaignMetricsJob,
} from "./campaign-queue";

type DatabaseRow = Record<string, unknown>;
type SqlClient = CampaignDatabase;

export type CampaignEventType =
  | "campaign_created"
  | "campaign_scheduled"
  | "campaign_queued"
  | "email_sent"
  | "email_delivered"
  | "email_opened"
  | "email_clicked"
  | "email_bounced"
  | "email_failed"
  | "email_unsubscribed"
  | "spam_complaint"
  | "campaign_converted"
  | "campaign_revenue_attributed";

export type CampaignEventSource = "system" | "first_party" | "provider" | "api";

export type CampaignEventInput = {
  workspaceId?: string;
  campaignId: string;
  messageId?: string;
  contactId?: string;
  eventType: CampaignEventType;
  source?: CampaignEventSource;
  provider?: string;
  providerEventId?: string;
  eventKey?: string;
  ipHash?: string;
  userAgent?: string;
  device?: string;
  client?: string;
  country?: string;
  metadata?: Record<string, unknown>;
  occurredAt?: Date | string;
};

export type CampaignAnalyticsMetricSnapshot = {
  campaignId: string;
  workspaceId: string;
  version: number;
  updatedAt: string;
  metrics: Record<string, number>;
};

const database = () => {
  const url = String(process.env.DATABASE_URL || "").trim();
  if (!url) throw new Error("Campaign analytics database is unavailable.");
  return createCampaignDatabase(url);
};

const text = (value: unknown, max = 2_000) =>
  String(value ?? "").trim().slice(0, max);

const number = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const uuid = (value: unknown) => {
  const candidate = text(value, 64);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    candidate,
  )
    ? candidate
    : "";
};

const json = (value: unknown, max = 20_000) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length > max) return { truncated: true };
    return JSON.parse(serialized) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const eventStatusMap: Record<string, CampaignEventType> = {
  delivered: "email_delivered",
  opened: "email_opened",
  clicked: "email_clicked",
  bounced: "email_bounced",
  complained: "spam_complaint",
};

export const campaignEventTypeForStatus = (status: string) =>
  eventStatusMap[status] || null;

const eventKeyFor = (input: CampaignEventInput, messageId: string) => {
  const supplied = text(input.eventKey, 255);
  if (supplied) return supplied;
  if (input.source !== "provider") return "";
  const provider = text(input.provider, 64);
  const providerEventId = text(input.providerEventId, 255);
  if (!provider && !providerEventId) return "";
  const destination = text(
    input.metadata && typeof input.metadata === "object"
      ? (input.metadata as Record<string, unknown>).destination
      : "",
    2_048,
  );
  const stableEvent = providerEventId
    ? providerEventId
    : `${messageId}:${destination}`;
  return `${provider}:${stableEvent}:${input.eventType}`.slice(
    0,
    255,
  );
};

const metricNames = [
  "recipients",
  "pending",
  "sent",
  "delivered",
  "total_opens",
  "unique_opens",
  "total_clicks",
  "unique_clicks",
  "bounced",
  "failed",
  "unsubscribed",
  "complaints",
  "machine_opens",
  "human_opens",
  "conversions",
  "revenue",
] as const;

const snapshotFromRow = (row: DatabaseRow): CampaignAnalyticsMetricSnapshot => {
  const columns: Record<(typeof metricNames)[number], string> = {
    recipients: "recipient_count",
    pending: "pending_count",
    sent: "sent_count",
    delivered: "delivered_count",
    total_opens: "total_open_count",
    unique_opens: "unique_open_count",
    total_clicks: "total_click_count",
    unique_clicks: "unique_click_count",
    bounced: "bounced_count",
    failed: "failed_count",
    unsubscribed: "unsubscribe_count",
    complaints: "complaint_count",
    machine_opens: "machine_open_count",
    human_opens: "human_open_count",
    conversions: "conversion_count",
    revenue: "revenue_amount",
  };
  const metrics = Object.fromEntries(
    metricNames.map((name) => [name, number(row[name] ?? row[columns[name]])]),
  );
  return {
    campaignId: text(row.campaign_id, 64),
    workspaceId: text(row.workspace_id, 64),
    version: number(row.realtime_version),
    updatedAt: text(row.updated_at),
    metrics,
  };
};

/**
 * Append one event to the durable campaign stream. The event payload is
 * written once and never used as an ad-hoc request counter. A worker later
 * materializes it into campaign_metrics and campaign_daily_metrics.
 */
export const recordCampaignEvent = async (input: CampaignEventInput) => {
  const sql = database();
  const campaignId = uuid(input.campaignId);
  const messageId = uuid(input.messageId);
  const contactId = uuid(input.contactId);
  const workspaceId = uuid(input.workspaceId);
  if (!campaignId) return { matched: false, eventRecorded: false };

  const context = (await sql.query(
    `SELECT campaign.id AS campaign_id,
            campaign.user_id AS workspace_id,
            message.id AS message_id,
            COALESCE(message.contact_id, contact.id) AS contact_id
     FROM contact_campaigns campaign
     LEFT JOIN contact_campaign_messages message
       ON message.id = $2::uuid
      AND message.campaign_id = campaign.id
     LEFT JOIN contacts contact
       ON contact.id = $4::uuid
      AND contact.created_by = campaign.user_id
     WHERE campaign.id = $1::uuid
       AND ($3::uuid IS NULL OR campaign.user_id = $3::uuid)
       AND ($2::uuid IS NULL OR message.id IS NOT NULL)
     LIMIT 1`,
    [campaignId, messageId || null, workspaceId || null, contactId || null],
  )) as DatabaseRow[];
  const row = context[0];
  if (!row) return { matched: false, eventRecorded: false };

  const metadata = json(input.metadata);
  const eventKey = eventKeyFor(input, text(row.message_id, 64));
  const occurredCandidate =
    input.occurredAt instanceof Date
      ? input.occurredAt
      : input.occurredAt
        ? new Date(String(input.occurredAt))
        : new Date();
  const occurredAt = Number.isNaN(occurredCandidate.getTime())
    ? new Date().toISOString()
    : occurredCandidate.toISOString();
  const inserted = (await sql.query(
    `INSERT INTO campaign_events (
       workspace_id, campaign_id, recipient_id, contact_id, message_id,
       event_type, source, provider, provider_event_id, event_key,
       ip_hash, user_agent, device, client, country, metadata,
       occurred_at, created_at
     )
     VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4::uuid, $3::uuid, $5, $6, $7, $8,
       $9, $10, $11, $12, $13, $14, $15::jsonb, $16::timestamptz, NOW()
     )
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      text(row.workspace_id, 64),
      text(row.campaign_id, 64),
      text(row.message_id, 64) || null,
      text(row.contact_id, 64) || null,
      input.eventType,
      input.source || "system",
      text(input.provider, 64),
      text(input.providerEventId, 255),
      eventKey,
      text(input.ipHash, 128),
      text(input.userAgent, 500),
      text(input.device, 64) || text(metadata.device, 64),
      text(input.client, 64) || text(metadata.client, 64),
      text(input.country, 64),
      JSON.stringify(metadata),
      occurredAt,
    ],
  )) as DatabaseRow[];
  const eventId = text(inserted[0]?.id, 64);
  return {
    matched: true,
    campaignId: text(row.campaign_id, 64),
    workspaceId: text(row.workspace_id, 64),
    messageId: text(row.message_id, 64),
    contactId: text(row.contact_id, 64),
    eventId,
    eventRecorded: Boolean(eventId),
  };
};

const refreshCampaignHourlyMetrics = async (
  sql: SqlClient,
  workspaceId: string,
  campaignId: string,
) => {
  await sql.query(
    `DELETE FROM campaign_hourly_metrics
     WHERE workspace_id = $1::uuid AND campaign_id = $2::uuid`,
    [workspaceId, campaignId],
  );
  await sql.query(
    `WITH event_rows AS (
       SELECT event.*,
              (
                event.event_type IN ('email_opened', 'email_clicked')
                AND (
                  event.source = 'first_party'
                  OR NOT EXISTS (
                    SELECT 1 FROM campaign_events first_party
                    WHERE first_party.message_id = event.message_id
                      AND first_party.event_type = event.event_type
                      AND first_party.source = 'first_party'
                  )
                )
              ) AS effective
       FROM campaign_events event
       WHERE event.workspace_id = $1::uuid
         AND event.campaign_id = $2::uuid
     ), hourly AS (
       SELECT workspace_id, campaign_id,
              DATE_TRUNC('hour', occurred_at) AS metric_hour,
              COUNT(*) FILTER (WHERE event_type = 'email_sent')::int AS sent_count,
              COUNT(*) FILTER (WHERE event_type = 'email_delivered')::int AS delivered_count,
              COUNT(*) FILTER (WHERE event_type = 'email_opened' AND effective)::int AS total_open_count,
              COUNT(DISTINCT message_id) FILTER (WHERE event_type = 'email_opened' AND effective)::int AS unique_open_count,
              COUNT(*) FILTER (WHERE event_type = 'email_clicked' AND effective)::int AS total_click_count,
              COUNT(DISTINCT message_id) FILTER (WHERE event_type = 'email_clicked' AND effective)::int AS unique_click_count,
              COUNT(*) FILTER (WHERE event_type = 'email_bounced')::int AS bounced_count,
              COUNT(*) FILTER (WHERE event_type = 'email_failed')::int AS failed_count,
              COUNT(*) FILTER (WHERE event_type = 'email_unsubscribed')::int AS unsubscribe_count,
              COUNT(*) FILTER (WHERE event_type = 'spam_complaint')::int AS complaint_count
       FROM event_rows
       GROUP BY workspace_id, campaign_id, DATE_TRUNC('hour', occurred_at)
     )
     INSERT INTO campaign_hourly_metrics (
       workspace_id, campaign_id, metric_hour, sent_count, delivered_count,
       total_open_count, unique_open_count, total_click_count,
       unique_click_count, bounced_count, failed_count, unsubscribe_count,
       complaint_count, updated_at
     )
     SELECT workspace_id, campaign_id, metric_hour, sent_count, delivered_count,
            total_open_count, unique_open_count, total_click_count,
            unique_click_count, bounced_count, failed_count, unsubscribe_count,
            complaint_count, NOW()
     FROM hourly
     ON CONFLICT (workspace_id, campaign_id, metric_hour) DO UPDATE SET
       sent_count = EXCLUDED.sent_count,
       delivered_count = EXCLUDED.delivered_count,
       total_open_count = EXCLUDED.total_open_count,
       unique_open_count = EXCLUDED.unique_open_count,
       total_click_count = EXCLUDED.total_click_count,
       unique_click_count = EXCLUDED.unique_click_count,
       bounced_count = EXCLUDED.bounced_count,
       failed_count = EXCLUDED.failed_count,
       unsubscribe_count = EXCLUDED.unsubscribe_count,
       complaint_count = EXCLUDED.complaint_count,
       updated_at = NOW()`,
    [workspaceId, campaignId],
  );
};

const refreshCampaignBreakdowns = async (
  sql: SqlClient,
  workspaceId: string,
  campaignId: string,
) => {
  await sql.query(
    `DELETE FROM campaign_metric_breakdowns
     WHERE workspace_id = $1::uuid AND campaign_id = $2::uuid`,
    [workspaceId, campaignId],
  );
  await sql.query(
    `WITH effective_opens AS (
       SELECT event.*
       FROM campaign_events event
       WHERE event.workspace_id = $1::uuid
         AND event.campaign_id = $2::uuid
         AND event.event_type = 'email_opened'
         AND (
           event.source = 'first_party'
           OR NOT EXISTS (
             SELECT 1 FROM campaign_events first_party
             WHERE first_party.message_id = event.message_id
               AND first_party.event_type = event.event_type
               AND first_party.source = 'first_party'
           )
         )
     ), dimensions AS (
       SELECT workspace_id, campaign_id, 'device'::text AS dimension,
              COALESCE(NULLIF(device, ''), NULLIF(metadata->>'device', ''), 'unknown') AS dimension_key,
              COUNT(*)::int AS total_count,
              COUNT(DISTINCT message_id)::int AS unique_count
       FROM effective_opens
       GROUP BY workspace_id, campaign_id, 4
       UNION ALL
       SELECT workspace_id, campaign_id, 'client'::text,
              COALESCE(NULLIF(client, ''), NULLIF(metadata->>'client', ''), 'unknown'),
              COUNT(*)::int, COUNT(DISTINCT message_id)::int
       FROM effective_opens
       GROUP BY workspace_id, campaign_id, 4
       UNION ALL
       SELECT workspace_id, campaign_id, 'country'::text,
              COALESCE(NULLIF(country, ''), NULLIF(metadata->>'country', ''), 'unknown'),
              COUNT(*)::int, COUNT(DISTINCT message_id)::int
       FROM effective_opens
       GROUP BY workspace_id, campaign_id, 4
     )
     INSERT INTO campaign_metric_breakdowns (
       workspace_id, campaign_id, dimension, dimension_key, label,
       total_count, unique_count, updated_at
     )
     SELECT workspace_id, campaign_id, dimension, dimension_key, dimension_key,
            total_count, unique_count, NOW()
     FROM dimensions
     ON CONFLICT (workspace_id, campaign_id, dimension, dimension_key) DO UPDATE SET
       label = EXCLUDED.label,
       total_count = EXCLUDED.total_count,
       unique_count = EXCLUDED.unique_count,
       updated_at = NOW()`,
    [workspaceId, campaignId],
  );

  await sql.query(
    `UPDATE contact_campaign_links
     SET click_count = 0, unique_click_count = 0, updated_at = NOW()
     WHERE campaign_id = $1::uuid`,
    [campaignId],
  );
  await sql.query(
    `WITH effective_clicks AS (
       SELECT event.metadata->>'destination' AS destination,
              event.message_id
       FROM campaign_events event
       WHERE event.workspace_id = $1::uuid
         AND event.campaign_id = $2::uuid
         AND event.event_type = 'email_clicked'
         AND COALESCE(event.metadata->>'destination', '') <> ''
         AND (
           event.source = 'first_party'
           OR NOT EXISTS (
             SELECT 1 FROM campaign_events first_party
             WHERE first_party.message_id = event.message_id
               AND first_party.event_type = event.event_type
               AND first_party.source = 'first_party'
           )
         )
     ), counts AS (
       SELECT destination, COUNT(*)::int AS total_count,
              COUNT(DISTINCT message_id)::int AS unique_count
       FROM effective_clicks
       GROUP BY destination
     )
     UPDATE contact_campaign_links link
     SET click_count = counts.total_count,
         unique_click_count = counts.unique_count,
         updated_at = NOW()
     FROM counts
     WHERE link.campaign_id = $2::uuid
       AND link.url = counts.destination`,
    [workspaceId, campaignId],
  );
};

const refreshDailyMetrics = async (
  sql: SqlClient,
  workspaceId: string,
  campaignId: string,
) => {
  await sql.query(
    `DELETE FROM campaign_daily_metrics
     WHERE workspace_id = $1::uuid AND campaign_id = $2::uuid`,
    [workspaceId, campaignId],
  );
  await sql.query(
    `WITH event_rows AS (
       SELECT event.*,
              (
                event.event_type IN ('email_opened', 'email_clicked')
                AND (
                  event.source = 'first_party'
                  OR NOT EXISTS (
                    SELECT 1
                    FROM campaign_events first_party
                    WHERE first_party.message_id = event.message_id
                      AND first_party.event_type = event.event_type
                      AND first_party.source = 'first_party'
                  )
                )
              ) AS effective
       FROM campaign_events event
       WHERE event.workspace_id = $1::uuid
         AND event.campaign_id = $2::uuid
     ), daily AS (
       SELECT workspace_id, campaign_id, occurred_at::date AS metric_date,
              COUNT(*) FILTER (WHERE event_type = 'email_sent')::int AS sent_count,
              COUNT(*) FILTER (WHERE event_type = 'email_delivered')::int AS delivered_count,
              COUNT(*) FILTER (WHERE event_type = 'email_opened' AND effective)::int AS total_open_count,
              COUNT(DISTINCT message_id) FILTER (WHERE event_type = 'email_opened' AND effective)::int AS unique_open_count,
              COUNT(*) FILTER (WHERE event_type = 'email_clicked' AND effective)::int AS total_click_count,
              COUNT(DISTINCT message_id) FILTER (WHERE event_type = 'email_clicked' AND effective)::int AS unique_click_count,
              COUNT(*) FILTER (WHERE event_type = 'email_bounced')::int AS bounced_count,
              COUNT(*) FILTER (WHERE event_type = 'email_failed')::int AS failed_count,
              COUNT(*) FILTER (WHERE event_type = 'email_unsubscribed')::int AS unsubscribe_count,
              COUNT(*) FILTER (WHERE event_type = 'spam_complaint')::int AS complaint_count
       FROM event_rows
       GROUP BY workspace_id, campaign_id, occurred_at::date
     )
     INSERT INTO campaign_daily_metrics (
       workspace_id, campaign_id, metric_date, sent_count, delivered_count,
       total_open_count, unique_open_count, total_click_count,
       unique_click_count, bounced_count, failed_count, unsubscribe_count,
       complaint_count, updated_at
     )
     SELECT workspace_id, campaign_id, metric_date, sent_count, delivered_count,
            total_open_count, unique_open_count, total_click_count,
            unique_click_count, bounced_count, failed_count, unsubscribe_count,
            complaint_count, NOW()
     FROM daily
     ON CONFLICT (workspace_id, campaign_id, metric_date) DO UPDATE SET
       sent_count = EXCLUDED.sent_count,
       delivered_count = EXCLUDED.delivered_count,
       total_open_count = EXCLUDED.total_open_count,
       unique_open_count = EXCLUDED.unique_open_count,
       total_click_count = EXCLUDED.total_click_count,
       unique_click_count = EXCLUDED.unique_click_count,
       bounced_count = EXCLUDED.bounced_count,
       failed_count = EXCLUDED.failed_count,
       unsubscribe_count = EXCLUDED.unsubscribe_count,
       complaint_count = EXCLUDED.complaint_count,
       updated_at = NOW()`,
    [workspaceId, campaignId],
  );

  // Orders are the revenue/conversion boundary shared with Payments. This
  // stays a separate upsert so a campaign with no orders never needs a fake
  // revenue event.
  await sql.query(
    `INSERT INTO campaign_daily_metrics (
       workspace_id, campaign_id, metric_date, conversion_count,
       revenue_amount, revenue_currency, updated_at
     )
     SELECT payment.user_id, payment.source_campaign_id,
            COALESCE(payment.paid_at, payment.created_at)::date,
            COUNT(*)::int,
            COALESCE(SUM(GREATEST(payment.total_amount - payment.refunded_amount, 0)), 0)::numeric,
            COALESCE(MIN(payment.currency), 'USD'), NOW()
     FROM payment_orders payment
     WHERE payment.user_id = $1::uuid
       AND payment.source_campaign_id = $2::uuid
       AND payment.status IN ('paid', 'partially_refunded', 'refunded')
     GROUP BY payment.user_id, payment.source_campaign_id,
              COALESCE(payment.paid_at, payment.created_at)::date
     ON CONFLICT (workspace_id, campaign_id, metric_date) DO UPDATE SET
       conversion_count = EXCLUDED.conversion_count,
       revenue_amount = EXCLUDED.revenue_amount,
       revenue_currency = EXCLUDED.revenue_currency,
       updated_at = NOW()`,
    [workspaceId, campaignId],
  );
};

/** Rebuild one campaign's materialized counters from its immutable stream. */
export const refreshCampaignMetrics = async (
  sql: SqlClient,
  workspaceId: string,
  campaignId: string,
) => {
  const totals = (await sql.query(
    `WITH event_rows AS (
       SELECT event.*,
              (
                event.event_type IN ('email_opened', 'email_clicked')
                AND (
                  event.source = 'first_party'
                  OR NOT EXISTS (
                    SELECT 1
                    FROM campaign_events first_party
                    WHERE first_party.message_id = event.message_id
                      AND first_party.event_type = event.event_type
                      AND first_party.source = 'first_party'
                  )
                )
              ) AS effective
       FROM campaign_events event
       WHERE event.workspace_id = $1::uuid
         AND event.campaign_id = $2::uuid
     ), engagement AS (
       SELECT message_id,
              COUNT(*) FILTER (WHERE event_type = 'email_opened' AND effective)::int AS total_opens,
              COUNT(*) FILTER (WHERE event_type = 'email_clicked' AND effective)::int AS total_clicks,
              COUNT(*) FILTER (WHERE event_type = 'email_opened' AND effective AND metadata->>'isMachine' = 'true')::int AS machine_opens,
              COUNT(*) FILTER (WHERE event_type = 'email_opened' AND effective AND COALESCE(metadata->>'isMachine', 'false') <> 'true')::int AS human_opens,
              BOOL_OR(event_type = 'email_opened' AND effective) AS opened,
              BOOL_OR(event_type = 'email_clicked' AND effective) AS clicked,
              BOOL_OR(event_type = 'email_sent') AS sent_event,
              BOOL_OR(event_type = 'email_delivered') AS delivered_event,
              BOOL_OR(event_type = 'email_bounced') AS bounced_event,
              BOOL_OR(event_type = 'email_failed') AS failed_event
       FROM event_rows
       WHERE message_id IS NOT NULL
       GROUP BY message_id
     ), message_state AS (
       SELECT message.id,
              message.status,
              message.sent_at,
              message.delivered_at,
              message.opened_at,
              message.clicked_at,
              message.open_count,
              message.click_count,
              engagement.*
       FROM contact_campaign_messages message
       LEFT JOIN engagement ON engagement.message_id = message.id
       WHERE message.campaign_id = $2::uuid
     )
     SELECT
       COUNT(*)::int AS recipients,
       COUNT(*) FILTER (
         WHERE sent_at IS NOT NULL
            OR sent_event
            OR status IN ('sent', 'delivered', 'opened', 'clicked', 'bounced', 'complained')
       )::int AS sent,
       COUNT(*) FILTER (WHERE delivered_at IS NOT NULL OR delivered_event)::int AS delivered,
       COUNT(*) FILTER (
         WHERE CASE WHEN message_id IS NOT NULL THEN COALESCE(opened, FALSE)
                   ELSE opened_at IS NOT NULL END
       )::int AS unique_opens,
       COALESCE(SUM(CASE WHEN message_id IS NOT NULL THEN total_opens ELSE COALESCE(open_count, 0) END), 0)::int AS total_opens,
       COUNT(*) FILTER (
         WHERE CASE WHEN message_id IS NOT NULL THEN COALESCE(clicked, FALSE)
                   ELSE clicked_at IS NOT NULL END
       )::int AS unique_clicks,
       COALESCE(SUM(CASE WHEN message_id IS NOT NULL THEN total_clicks ELSE COALESCE(click_count, 0) END), 0)::int AS total_clicks,
       COUNT(*) FILTER (WHERE status IN ('queued', 'processing', 'sending'))::int AS pending,
       COUNT(*) FILTER (WHERE status = 'bounced' OR bounced_event)::int AS bounced,
       COUNT(*) FILTER (WHERE status = 'failed' OR failed_event)::int AS failed,
       COALESCE((SELECT COUNT(*) FROM event_rows WHERE event_type = 'email_unsubscribed'), 0)::int AS unsubscribed,
       COALESCE((SELECT COUNT(*) FROM event_rows WHERE event_type = 'spam_complaint'), 0)::int AS complaints,
       COALESCE(SUM(machine_opens), 0)::int AS machine_opens,
       COALESCE(SUM(human_opens), 0)::int AS human_opens
     FROM message_state`,
    [workspaceId, campaignId],
  )) as DatabaseRow[];
  const revenue = (await sql.query(
    `SELECT COUNT(*)::int AS conversions,
            COALESCE(SUM(GREATEST(total_amount - refunded_amount, 0)), 0)::numeric AS revenue,
            COALESCE(MIN(currency), 'USD') AS currency
     FROM payment_orders
     WHERE user_id = $1::uuid
       AND source_campaign_id = $2::uuid
       AND status IN ('paid', 'partially_refunded', 'refunded')`,
    [workspaceId, campaignId],
  )) as DatabaseRow[];
  const row = totals[0] || {};
  const revenueRow = revenue[0] || {};
  const upserted = (await sql.query(
    `INSERT INTO campaign_metrics (
       workspace_id, campaign_id, recipient_count, pending_count,
       sent_count, delivered_count, total_open_count, unique_open_count,
       total_click_count, unique_click_count, bounced_count, failed_count,
       unsubscribe_count, complaint_count, machine_open_count,
       human_open_count, conversion_count, revenue_amount, revenue_currency,
       realtime_version, updated_at
     )
     SELECT
       $1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
       $13, $14, $15, $16, $17, $18, $19, 1, NOW()
     FROM contact_campaigns campaign
     WHERE campaign.id = $2::uuid AND campaign.user_id = $1::uuid
     ON CONFLICT (workspace_id, campaign_id) DO UPDATE SET
       recipient_count = EXCLUDED.recipient_count,
       pending_count = EXCLUDED.pending_count,
       sent_count = EXCLUDED.sent_count,
       delivered_count = EXCLUDED.delivered_count,
       total_open_count = EXCLUDED.total_open_count,
       unique_open_count = EXCLUDED.unique_open_count,
       total_click_count = EXCLUDED.total_click_count,
       unique_click_count = EXCLUDED.unique_click_count,
       bounced_count = EXCLUDED.bounced_count,
       failed_count = EXCLUDED.failed_count,
       unsubscribe_count = EXCLUDED.unsubscribe_count,
       complaint_count = EXCLUDED.complaint_count,
       machine_open_count = EXCLUDED.machine_open_count,
       human_open_count = EXCLUDED.human_open_count,
       conversion_count = EXCLUDED.conversion_count,
       revenue_amount = EXCLUDED.revenue_amount,
       revenue_currency = EXCLUDED.revenue_currency,
       realtime_version = campaign_metrics.realtime_version + 1,
       updated_at = NOW()
     RETURNING *`,
    [
      workspaceId,
      campaignId,
      number(row.recipients),
      number(row.pending),
      number(row.sent),
      number(row.delivered),
      number(row.total_opens),
      number(row.unique_opens),
      number(row.total_clicks),
      number(row.unique_clicks),
      number(row.bounced),
      number(row.failed),
      number(row.unsubscribed),
      number(row.complaints),
      number(row.machine_opens),
      number(row.human_opens),
      number(revenueRow.conversions),
      number(revenueRow.revenue),
      text(revenueRow.currency, 3) || "USD",
      ],
  )) as DatabaseRow[];
  // A campaign can be deleted while a claimed analytics event is being
  // processed (for example, a serverless request can outlive a workspace
  // cleanup). The event's FK is intentionally SET NULL, so silently discard
  // the materialization when its parent no longer exists instead of allowing
  // a stale background job to poison the whole batch with an FK error.
  if (!upserted.length) return null;
  await refreshDailyMetrics(sql, workspaceId, campaignId);
  await refreshCampaignHourlyMetrics(sql, workspaceId, campaignId);
  await refreshCampaignBreakdowns(sql, workspaceId, campaignId);

  const metricRow = upserted[0] || {};
  await sql.query(
    `UPDATE contact_campaigns campaign
     SET stats = jsonb_build_object(
       'recipients', $3::int,
       'pending', $4::int,
       'sent', $5::int,
       'delivered', $6::int,
       'opened', $8::int,
       'clicked', $10::int,
       'total_opens', $7::int,
       'total_clicks', $9::int,
       'bounced', $11::int,
       'failed', $12::int,
       'unsubscribed', $13::int,
       'complained', $14::int
     ),
     revenue_attributed = $15::numeric,
     revenue_currency = $16::text,
     updated_at = NOW()
     WHERE campaign.id = $2::uuid AND campaign.user_id = $1::uuid`,
    [
      workspaceId,
      campaignId,
      number(metricRow.recipient_count),
      number(metricRow.pending_count),
      number(metricRow.sent_count),
      number(metricRow.delivered_count),
      number(metricRow.total_open_count),
      number(metricRow.unique_open_count),
      number(metricRow.total_click_count),
      number(metricRow.unique_click_count),
      number(metricRow.bounced_count),
      number(metricRow.failed_count),
      number(metricRow.unsubscribe_count),
      number(metricRow.complaint_count),
      number(metricRow.revenue_amount),
      text(metricRow.revenue_currency, 3) || "USD",
    ],
  );

  const snapshot = snapshotFromRow({
    ...metricRow,
    campaign_id: campaignId,
    workspace_id: workspaceId,
  });
  void publishCampaignAnalytics(snapshot);
  return snapshot;
};

const applyClaimedEvents = async (
  sql: SqlClient,
  rows: DatabaseRow[],
) => {
  if (!rows.length) return;
  const eventIds = rows.map((row) => text(row.id, 64));
  await sql.query(
    `WITH affected AS (
       SELECT DISTINCT event.message_id
       FROM campaign_events event
       WHERE event.id = ANY($1::uuid[])
         AND event.message_id IS NOT NULL
     ), event_rows AS (
       SELECT event.*,
              (
                event.event_type IN ('email_opened', 'email_clicked')
                AND (
                  event.source = 'first_party'
                  OR NOT EXISTS (
                    SELECT 1 FROM campaign_events first_party
                    WHERE first_party.message_id = event.message_id
                      AND first_party.event_type = event.event_type
                      AND first_party.source = 'first_party'
                  )
                )
              ) AS effective
       FROM campaign_events event
       JOIN affected ON affected.message_id = event.message_id
     ), state AS (
       SELECT message_id,
              BOOL_OR(event_type = 'email_sent') AS sent_event,
              BOOL_OR(event_type = 'email_delivered') AS delivered_event,
              BOOL_OR(event_type = 'email_opened' AND effective) AS opened_event,
              BOOL_OR(event_type = 'email_clicked' AND effective) AS clicked_event,
              BOOL_OR(event_type = 'email_bounced') AS bounced_event,
              BOOL_OR(event_type = 'email_failed') AS failed_event,
              BOOL_OR(event_type = 'spam_complaint') AS complaint_event,
              COUNT(*) FILTER (WHERE event_type = 'email_opened' AND effective)::int AS total_opens,
              COUNT(*) FILTER (WHERE event_type = 'email_clicked' AND effective)::int AS total_clicks,
              MIN(occurred_at) FILTER (WHERE event_type = 'email_sent') AS sent_at,
              MIN(occurred_at) FILTER (WHERE event_type = 'email_delivered') AS delivered_at,
              MIN(occurred_at) FILTER (WHERE event_type = 'email_opened' AND effective) AS opened_at,
              MIN(occurred_at) FILTER (WHERE event_type = 'email_clicked' AND effective) AS clicked_at
       FROM event_rows
       GROUP BY message_id
     )
     UPDATE contact_campaign_messages message
     SET status = CASE
         WHEN message.status = 'complained' OR state.complaint_event THEN 'complained'
         WHEN state.bounced_event THEN 'bounced'
         WHEN state.clicked_event THEN 'clicked'
         WHEN state.opened_event THEN 'opened'
         WHEN state.delivered_event THEN 'delivered'
         WHEN state.sent_event THEN 'sent'
         WHEN state.failed_event THEN 'failed'
         ELSE message.status
       END,
       sent_at = COALESCE(message.sent_at, state.sent_at),
       delivered_at = COALESCE(message.delivered_at, state.delivered_at),
       opened_at = COALESCE(message.opened_at, state.opened_at),
       clicked_at = COALESCE(message.clicked_at, state.clicked_at),
       open_count = CASE WHEN state.opened_event THEN state.total_opens ELSE message.open_count END,
       click_count = CASE WHEN state.clicked_event THEN state.total_clicks ELSE message.click_count END,
       updated_at = NOW()
     FROM state
     WHERE message.id = state.message_id`,
    [eventIds],
  );

  await sql.query(
    `UPDATE email_logs log
     SET status = CASE
       WHEN log.status IN ('bounced', 'complained') THEN log.status
       WHEN event.event_type = 'email_delivered' AND log.status IN ('opened', 'clicked') THEN log.status
       WHEN event.event_type = 'email_opened' AND log.status = 'clicked' THEN log.status
       WHEN event.event_type = 'email_sent' THEN 'sent'
       WHEN event.event_type = 'email_delivered' THEN 'delivered'
       WHEN event.event_type = 'email_opened' THEN 'opened'
       WHEN event.event_type = 'email_clicked' THEN 'clicked'
       WHEN event.event_type = 'email_bounced' THEN 'bounced'
       WHEN event.event_type = 'spam_complaint' THEN 'complained'
       WHEN event.event_type = 'email_failed' THEN 'failed'
       ELSE log.status
     END,
     updated_at = NOW()
     FROM campaign_events event
     JOIN contact_campaign_messages message ON message.id = event.message_id
     WHERE event.id = ANY($1::uuid[])
       AND event.message_id IS NOT NULL
       AND TRIM(BOTH '<>' FROM COALESCE(log.provider_message_id, '')) =
           TRIM(BOTH '<>' FROM COALESCE(message.provider_message_id, ''))
       AND log.provider_message_id <> ''`,
    [eventIds],
  );

  await sql.query(
    `INSERT INTO contact_activity (
       contact_id, user_id, activity_type, title, detail,
       entity_type, entity_id, metadata, source_event_id, created_at
     )
     SELECT event.contact_id,
            event.workspace_id,
            'campaign_' || event.event_type,
            CASE event.event_type
              WHEN 'email_sent' THEN 'Campaign email sent'
              WHEN 'email_delivered' THEN 'Campaign email delivered'
              WHEN 'email_opened' THEN 'Campaign email opened'
              WHEN 'email_clicked' THEN 'Campaign link clicked'
              WHEN 'email_bounced' THEN 'Campaign email bounced'
              WHEN 'email_failed' THEN 'Campaign email failed'
              WHEN 'email_unsubscribed' THEN 'Unsubscribed from campaign email'
              WHEN 'spam_complaint' THEN 'Marked campaign email as spam'
              ELSE 'Campaign activity'
            END,
            CASE WHEN event.event_type = 'email_clicked' AND event.metadata->>'destination' <> ''
              THEN LEFT(event.metadata->>'destination', 500)
              ELSE ''
            END,
            'contact_campaign', event.campaign_id,
            COALESCE(event.metadata, '{}'::jsonb) || jsonb_build_object(
              'campaignId', event.campaign_id,
              'messageId', event.message_id,
              'eventId', event.id,
              'source', event.source
            ),
            event.id,
            event.occurred_at
     FROM campaign_events event
     WHERE event.id = ANY($1::uuid[])
       AND event.contact_id IS NOT NULL
     ON CONFLICT DO NOTHING`,
    [eventIds],
  );

  await sql.query(
    `UPDATE contacts contact
     SET last_activity_at = GREATEST(
       COALESCE(contact.last_activity_at, event.occurred_at),
       event.occurred_at
     ),
     updated_at = NOW()
     FROM (
       SELECT contact_id, MAX(occurred_at) AS occurred_at
       FROM campaign_events
       WHERE id = ANY($1::uuid[]) AND contact_id IS NOT NULL
       GROUP BY contact_id
     ) event
     WHERE contact.id = event.contact_id`,
    [eventIds],
  );
};

const claimEvents = async (
  sql: SqlClient,
  limit: number,
  campaignId?: string,
  workspaceId?: string,
) => {
  const rows = (await sql.query(
    `WITH claimable AS (
       SELECT event.id
       FROM campaign_events event
       WHERE event.processed_at IS NULL
         AND event.processing_dead_at IS NULL
         AND (
           event.processing_started_at IS NULL
           OR event.processing_started_at < NOW() - INTERVAL '5 minutes'
         )
         AND ($2::uuid IS NULL OR event.campaign_id = $2::uuid)
         AND ($3::uuid IS NULL OR event.workspace_id = $3::uuid)
       ORDER BY event.created_at, event.id
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     UPDATE campaign_events event
     SET processing_started_at = NOW(),
         processing_attempts = event.processing_attempts + 1,
         processing_error = ''
     FROM claimable
     WHERE event.id = claimable.id
     RETURNING event.id, event.campaign_id, event.workspace_id,
               event.processing_attempts`,
    [limit, uuid(campaignId) || null, uuid(workspaceId) || null],
  )) as DatabaseRow[];
  return rows;
};

const MAX_ANALYTICS_ATTEMPTS = 5;

const alertDeadLetters = async (sql: SqlClient, eventIds: string[]) => {
  if (!eventIds.length) return;
  const rows = (await sql.query(
    `SELECT event.id, event.workspace_id, event.campaign_id,
            event.processing_attempts, event.processing_error,
            dead.alert_attempted_at, dead.alert_delivered_at, dead.alert_error
     FROM campaign_events event
     JOIN campaign_analytics_dead_letters dead ON dead.event_id = event.id
     WHERE event.id = ANY($1::uuid[])
       AND event.processing_dead_at IS NOT NULL
       AND event.processing_alerted_at IS NULL`,
    [eventIds],
  )) as DatabaseRow[];
  if (!rows.length) return;

  // The database row is the durable alert surface. Structured logs make this
  // visible to Vercel/Datadog/Sentry even when no webhook is configured.
  console.error("[campaign-analytics] events moved to dead letter", {
    count: rows.length,
    events: rows.map((row) => ({
      eventId: text(row.id, 64),
      workspaceId: text(row.workspace_id, 64),
      campaignId: text(row.campaign_id, 64),
      attempts: number(row.processing_attempts),
      reason: text(row.processing_error, 300),
    })),
  });

  const webhook = text(process.env.CAMPAIGN_ANALYTICS_ALERT_WEBHOOK_URL, 2_048);
  let webhookDeliveredAt: string | null = null;
  let alertError = "";
  if (webhook) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2_000);
      try {
        const result = await fetch(webhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source: "campaign-analytics",
            type: "dead_letter",
            events: rows.map((row) => ({
              eventId: text(row.id, 64),
              workspaceId: text(row.workspace_id, 64),
              campaignId: text(row.campaign_id, 64),
              attempts: number(row.processing_attempts),
              reason: text(row.processing_error, 1_000),
            })),
          }),
          signal: controller.signal,
        });
        if (!result.ok) {
          throw new Error(`Alert webhook returned HTTP ${result.status}.`);
        }
        webhookDeliveredAt = new Date().toISOString();
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      alertError = error instanceof Error
        ? error.message.slice(0, 1_000)
        : "Alert webhook failed.";
      console.error("[campaign-analytics] dead-letter webhook failed", {
        type: error instanceof Error ? error.name : typeof error,
        message: alertError,
      });
    }
  }

  // The structured log above is the durable in-platform alert surface. Mark
  // it as surfaced even if an optional external webhook is unavailable, while
  // retaining the delivery outcome in the dead-letter row for operations.
  await sql.query(
    `UPDATE campaign_events
     SET processing_alerted_at = NOW()
     WHERE id = ANY($1::uuid[])`,
    [rows.map((row) => text(row.id, 64))],
  );
  await sql.query(
    `UPDATE campaign_analytics_dead_letters
     SET alerted_at = NOW(),
         alert_attempted_at = NOW(),
         alert_delivered_at = $2::timestamptz,
         alert_error = $3,
         updated_at = NOW()
     WHERE event_id = ANY($1::uuid[])`,
    [
      rows.map((row) => text(row.id, 64)),
      webhookDeliveredAt,
      alertError,
    ],
  );
};

const ANALYTICS_CLAIM_CHUNK_SIZE = 1_000;
const ANALYTICS_MAX_DRAIN_SIZE = 25_000;

/**
 * Process a bounded drain. Events are claimed in small lock-friendly chunks,
 * then projected as one set and each affected campaign is materialized once.
 * Keeping the rows claimed until materialization succeeds preserves crash-safe
 * retries without doing a full campaign rebuild after every 1,000 events.
 */
export const processCampaignAnalyticsEvents = async (input: {
  limit?: number;
  campaignId?: string;
  workspaceId?: string;
} = {}) => {
  const sql = database();
  const drainLimit = Math.max(
    1,
    Math.min(ANALYTICS_MAX_DRAIN_SIZE, Math.floor(input.limit || 1_000)),
  );
  const rows: DatabaseRow[] = [];
  const campaigns = new Map<string, string>();
  try {
    while (rows.length < drainLimit) {
      const chunk = await claimEvents(
        sql,
        Math.min(ANALYTICS_CLAIM_CHUNK_SIZE, drainLimit - rows.length),
        input.campaignId,
        input.workspaceId,
      );
      if (!chunk.length) break;
      rows.push(...chunk);
      chunk.forEach((row) => {
        const campaignId = text(row.campaign_id, 64);
        const workspaceId = text(row.workspace_id, 64);
        if (campaignId && workspaceId) campaigns.set(campaignId, workspaceId);
      });
    }

    if (!rows.length) {
      return { processed: 0, campaigns: 0, retryable: 0, deadLettered: 0 };
    }

    await applyClaimedEvents(sql, rows);

    // The aggregate queries read the complete immutable stream, including an
    // event that may arrive while this drain is running. Events arriving after
    // the read remain unprocessed and cause the next worker to reconcile, so a
    // second full rebuild here is unnecessary.
    for (const [campaignId, workspaceId] of campaigns) {
      await refreshCampaignMetrics(sql, workspaceId, campaignId);
    }
    const eventIds = rows.map((row) => text(row.id, 64));
    await sql.query(
      `UPDATE campaign_events
       SET processed_at = NOW(), processing_started_at = NULL,
           processing_error = '', processing_dead_at = NULL,
           processing_alerted_at = NULL
       WHERE id = ANY($1::uuid[])`,
      [eventIds],
    );
    return {
      processed: rows.length,
      campaigns: campaigns.size,
      retryable: 0,
      deadLettered: 0,
    };
  } catch (error) {
    if (!rows.length) throw error;
    const reason =
      error instanceof Error ? error.message : "Analytics worker failed.";
    const deadIds = rows
      .filter((row) => number(row.processing_attempts) >= MAX_ANALYTICS_ATTEMPTS)
      .map((row) => text(row.id, 64));
    const retryIds = rows
      .filter((row) => number(row.processing_attempts) < MAX_ANALYTICS_ATTEMPTS)
      .map((row) => text(row.id, 64));
    if (deadIds.length) {
      await sql.query(
        `UPDATE campaign_events
         SET processing_started_at = NULL,
             processing_dead_at = NOW(),
             processing_error = LEFT($2, 1_000)
         WHERE id = ANY($1::uuid[])`,
        [deadIds, reason],
      );
      await sql.query(
        `INSERT INTO campaign_analytics_dead_letters (
           event_id, workspace_id, campaign_id, attempts, reason,
           first_failed_at, dead_at, updated_at
         )
         SELECT event.id, event.workspace_id, event.campaign_id,
                event.processing_attempts, event.processing_error,
                NOW(), NOW(), NOW()
         FROM campaign_events event
         WHERE event.id = ANY($1::uuid[])
         ON CONFLICT (event_id) DO UPDATE SET
           attempts = EXCLUDED.attempts,
           reason = EXCLUDED.reason,
           dead_at = EXCLUDED.dead_at,
           first_failed_at = campaign_analytics_dead_letters.first_failed_at,
           updated_at = NOW()`,
        [deadIds],
      );
      await alertDeadLetters(sql, deadIds);
    }
    if (retryIds.length) {
      await sql.query(
        `UPDATE campaign_events
         SET processing_started_at = NULL,
             processing_error = LEFT($2, 1_000)
         WHERE id = ANY($1::uuid[])`,
        [retryIds, reason],
      );
    }
    console.error("[campaign-analytics] batch failed", {
      retryable: retryIds.length,
      deadLettered: deadIds.length,
      type: error instanceof Error ? error.name : typeof error,
    });
    return {
      processed: 0,
      campaigns: 0,
      retryable: retryIds.length,
      deadLettered: deadIds.length,
    };
  }
};

let workerPromise: Promise<unknown> | null = null;
let workerRerunRequested = false;

/**
 * Best-effort low-latency kick. The durable cron worker remains the recovery
 * path when a serverless runtime ends immediately after the tracking response.
 */
export const kickCampaignAnalyticsWorker = (campaignId?: string) => {
  if (campaignQueueConfigured()) {
    void enqueueCampaignMetricsJob({ campaignId }).catch((error) => {
      console.error("[campaign-analytics] queue enqueue failed", {
        type: error instanceof Error ? error.name : typeof error,
      });
    });
    return;
  }
  void campaignId;
  workerRerunRequested = true;
  if (workerPromise) return;
  workerPromise = (async () => {
    do {
      workerRerunRequested = false;
      let failed = false;
      try {
        // Drain the shared durable stream rather than pinning the worker to
        // the first campaign that happened to wake it. The event rows carry
        // workspace ownership and the worker applies that scope internally.
        await processCampaignAnalyticsEvents({ limit: 250 });
      } catch (error) {
        failed = true;
        console.error("[campaign-analytics] background batch failed", {
          type: error instanceof Error ? error.name : typeof error,
          message: error instanceof Error ? error.message.slice(0, 300) : "",
          position: String((error as { position?: unknown })?.position || ""),
        });
      }
      // Do not hot-loop a poison event. It remains claimable for the durable
      // cron retry path after its processing marker is cleared. New events
      // arriving during a successful batch are drained immediately; after a
      // failure, the next cron tick provides bounded retry/backoff.
      if (failed) workerRerunRequested = false;
    } while (workerRerunRequested);
  })().finally(() => {
    workerPromise = null;
  });
};

export const getCampaignMetricSnapshot = async (
  workspaceId: string,
  campaignId: string,
) => {
  const rows = (await database().query(
    `SELECT * FROM campaign_metrics
     WHERE workspace_id = $1::uuid AND campaign_id = $2::uuid
     LIMIT 1`,
    [workspaceId, campaignId],
  )) as DatabaseRow[];
  return rows[0] ? snapshotFromRow(rows[0]) : null;
};

/** Used by the authenticated realtime endpoint to verify workspace ownership. */
export const campaignBelongsToWorkspace = async (
  workspaceId: string,
  campaignId: string,
) => {
  const rows = (await database().query(
    `SELECT id FROM contact_campaigns
     WHERE id = $1::uuid AND user_id = $2::uuid LIMIT 1`,
    [campaignId, workspaceId],
  )) as DatabaseRow[];
  return Boolean(rows[0]);
};

// Keep the import of randomUUID meaningful for callers that need a unique
// non-provider lifecycle key without exposing a second event-id generator.
export const uniqueCampaignEventKey = (prefix: string) =>
  `${text(prefix, 80)}:${randomUUID()}`.slice(0, 255);

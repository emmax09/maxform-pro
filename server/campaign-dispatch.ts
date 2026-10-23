/**
 * Campaign batch dispatcher.
 *
 * Recipients are queued into contact_campaign_messages by the send wizard and
 * split into campaign_send_batches waves here. A cron tick claims whichever
 * waves are due and hands their messages to the normal workspace email path,
 * so campaigns reuse the same provider, suppression and logging behaviour as
 * every other email the platform sends.
 *
 * Two properties matter most:
 *  - A recipient is never sent to twice. Each message carries an idempotency
 *    key derived from the campaign and contact, so a retried wave, a resumed
 *    campaign, or two overlapping cron ticks all collapse to one send.
 *  - A paused campaign stops immediately. Pausing marks pending waves 'paused',
 *    and the dispatcher only ever claims 'pending' ones.
 */
import { randomUUID } from "node:crypto";

import {
  campaignBulkThreshold,
  campaignDeliveryMode,
  fallbackRateLimit,
  planCampaignBatches,
  providerSendIntervalMs,
  sustainedRatePerSecond,
  type BatchPlan,
  type CampaignDeliveryMode,
  type ProviderRateLimit,
} from "./campaign-batching";
import {
  campaignListUnsubscribeHeaders,
  campaignSendAllowed,
  campaignUnsubscribeUrl,
  decorateCampaignEmail,
} from "./campaign-tracking";
import {
  kickCampaignAnalyticsWorker,
  recordCampaignEvent,
} from "./campaign-analytics-engine";
import {
  deliverWorkspaceEmailBatch,
  getWorkspaceEmailDeliveryState,
  getWorkspaceEmailProviderLimits,
} from "./workspace-email";
import { consumeCampaignRateLimits } from "./campaign-rate-limit";
import { dispatchWorkspaceWorkflowEvent } from "./workflows-data";
import {
  evaluateCampaignReputation,
  providerQueueIsPaused,
} from "./campaign-reputation";
import {
  acquireQueueLock,
  releaseQueueLock,
} from "../src/lib/queue/redis";
import { createCampaignDatabase } from "./campaign-database";

type DatabaseRow = Record<string, unknown>;

export class CampaignDispatchError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "campaign_dispatch_error",
  ) {
    super(message);
  }
}

class CampaignRateLimitError extends CampaignDispatchError {
  constructor(readonly retryAfterMs: number) {
    super("Campaign sending is temporarily rate limited.", 429, "campaign_rate_limited");
  }
}

class CampaignDeliveryRetryableError extends CampaignDispatchError {
  constructor(message: string) {
    super(message, 503, "campaign_delivery_retryable");
  }
}

const database = () => {
  const url = process.env.DATABASE_URL || "";
  if (!url) {
    throw new CampaignDispatchError(
      "Campaign sending is temporarily unavailable.",
      503,
      "campaign_dispatch_unavailable",
    );
  }
  return createCampaignDatabase(url);
};

const asString = (value: unknown) => String(value ?? "");
const asNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const recordDispatchEvent = (
  workspaceId: string,
  campaignId: string,
  messageId: string,
  eventType: "email_sent" | "email_delivered" | "email_failed",
  metadata: Record<string, unknown> = {},
) => {
  // Analytics and workflows are separate consumers of the same lifecycle
  // moment. The engagement events (opened, clicked, bounced) reach workflows
  // through campaign-tracking; the send itself only happens here, so without
  // this dispatch `trigger.email_sent` could never fire.
  if (eventType === "email_sent" || eventType === "email_delivered") {
    void dispatchWorkspaceWorkflowEvent(
      workspaceId,
      eventType,
      { id: messageId, messageId, campaignId, ...metadata },
      `${eventType}:${messageId}`,
    ).catch(() => undefined);
  }
  void recordCampaignEvent({
    workspaceId,
    campaignId,
    messageId,
    eventType,
    source: "system",
    eventKey: `${eventType}:${messageId}`,
    metadata,
  })
    .then(() => kickCampaignAnalyticsWorker(campaignId))
    .catch((error) => {
      // Delivery must not be turned into a false failure because analytics
      // infrastructure is briefly unavailable. The durable worker will retry
      // the event on the next campaign dispatch tick.
      console.error("[campaign-dispatch] lifecycle event failed", {
        type: error instanceof Error ? error.name : typeof error,
      });
    });
};

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

const composeMailingAddress = (row: DatabaseRow) =>
  [
    asString(row.address_line1).trim(),
    asString(row.address_line2).trim(),
    [asString(row.city).trim(), asString(row.state_region).trim()]
      .filter(Boolean)
      .join(", "),
    asString(row.postal_code).trim(),
    asString(row.country).trim(),
  ]
    .filter(Boolean)
    .join("\n");

const campaignDeliveryContext = async (userId: string, campaignId: string) => {
  const rows = (await database().query(
    `SELECT campaign_settings.mailing_address,
            company.address, company.address_line1, company.address_line2,
            company.city, company.state_region, company.postal_code,
            company.country,
            COALESCE(
              NULLIF(identity.custom_domain, ''),
              NULLIF(identity.domain, ''),
              NULLIF(split_part(identity.sender_email, '@', 2), ''),
              ''
            ) AS sending_domain
     FROM (SELECT $1::uuid AS user_id) owner
     LEFT JOIN contact_campaign_settings campaign_settings
       ON campaign_settings.user_id = owner.user_id
     LEFT JOIN company_settings company
       ON company.user_id = owner.user_id
     LEFT JOIN contact_campaigns campaign
       ON campaign.id = $2::uuid AND campaign.user_id = owner.user_id
     LEFT JOIN email_settings email_settings
       ON email_settings.user_id = owner.user_id
     LEFT JOIN email_identities identity
       ON identity.id = COALESCE(campaign.identity_id, email_settings.default_identity_id)
     LIMIT 1`,
    [userId, campaignId],
  )) as DatabaseRow[];
  const row = rows[0] || {};
  return {
    mailingAddress:
      composeMailingAddress(row) || asString(row.mailing_address).trim() || asString(row.address).trim(),
    sendingDomain: asString(row.sending_domain).trim().toLowerCase(),
  };
};

/**
 * The rate limits of the provider this workspace actually sends through. A
 * workspace without an active provider gets the most conservative row in the
 * table, never an optimistic default.
 */
export async function resolveWorkspaceRateLimit(
  userId: string,
): Promise<ProviderRateLimit> {
  const activeDelivery = await getWorkspaceEmailDeliveryState(userId);
  if (!activeDelivery) return fallbackRateLimit;
  const liveLimits = await getWorkspaceEmailProviderLimits(userId);
  const rows = (await database().query(
    `SELECT limits.provider, limits.max_per_second, limits.max_per_hour, limits.max_batch_size
     FROM provider_rate_limits limits
     WHERE limits.provider = $1
     LIMIT 1`,
    [activeDelivery.provider],
  )) as DatabaseRow[];
  const row = rows[0];
  if (!row) return fallbackRateLimit;
  return {
    provider: asString(row.provider),
    maxPerSecond: liveLimits?.maxPerSecond || asNumber(row.max_per_second),
    maxPerHour: asNumber(row.max_per_hour),
    maxBatchSize: liveLimits?.maxBatchSize || asNumber(row.max_batch_size) || undefined,
  };
}

type CampaignThrottleLimits = {
  workspacePerMinute: number;
  domainPerMinute: number;
  campaignPerMinute: number;
  providerPerMinute: number;
  providerMaxBatchSize: number;
  slowed: boolean;
};

const safeCampaignBatchSize = (limits: CampaignThrottleLimits) =>
  Math.max(
    1,
    Math.min(
      limits.workspacePerMinute,
      limits.domainPerMinute,
      limits.campaignPerMinute,
      limits.providerPerMinute,
      limits.providerMaxBatchSize,
    ),
  );

const resolveCampaignThrottleLimits = async (
  userId: string,
  provider: string,
  campaignId: string,
): Promise<CampaignThrottleLimits> => {
  const rows = (await database().query(
    `SELECT COALESCE(settings.send_rate_per_minute,
                     CASE settings.workspace_tier
                       WHEN 'enterprise' THEN 5000
                       WHEN 'established' THEN 500
                       ELSE 50
                     END) AS workspace_per_minute,
            COALESCE(settings.domain_rate_per_minute, 100) AS domain_per_minute,
            COALESCE(settings.campaign_rate_per_minute, 500) AS campaign_per_minute,
            COALESCE(reputation.temporary_failure_rate, 0) AS temporary_failure_rate,
            limits.max_per_second, limits.max_per_hour, limits.max_batch_size
     FROM (SELECT $1::uuid AS user_id) owner
     LEFT JOIN email_settings settings ON settings.user_id = owner.user_id
     LEFT JOIN provider_rate_limits limits ON limits.provider = $2
     LEFT JOIN campaign_reputation_snapshots reputation
       ON reputation.workspace_id = owner.user_id
      AND reputation.campaign_id = $3::uuid
     LIMIT 1`,
    [userId, provider, campaignId],
  )) as DatabaseRow[];
  const row = rows[0] || {};
  const providerPerMinute = Math.max(
    1,
    Math.floor(
      Math.min(
        asNumber(row.max_per_second) * 60 || fallbackRateLimit.maxPerSecond * 60,
        asNumber(row.max_per_hour) / 60 || fallbackRateLimit.maxPerHour / 60,
      ),
    ),
  );
  const slowThresholdValue = Number(
    process.env.CAMPAIGN_TEMPORARY_FAILURE_SLOW_RATE || 0.1,
  );
  const slowThreshold = Number.isFinite(slowThresholdValue)
    ? Math.max(0, slowThresholdValue)
    : 0.1;
  return {
    workspacePerMinute: Math.max(1, asNumber(row.workspace_per_minute) || 50),
    domainPerMinute: Math.max(1, asNumber(row.domain_per_minute) || 100),
    campaignPerMinute: Math.max(1, asNumber(row.campaign_per_minute) || 500),
    providerPerMinute,
    providerMaxBatchSize: Math.max(1, asNumber(row.max_batch_size) || 100),
    slowed: asNumber(row.temporary_failure_rate) > slowThreshold,
  };
};

/** Pacing overrides a workspace or campaign has set, if any. */
const resolvePacingOverrides = async (userId: string, campaignId: string) => {
  const rows = (await database().query(
    `SELECT campaign.batch_size AS campaign_batch_size,
            campaign.batch_delay_seconds AS campaign_batch_delay,
            settings.batch_size AS workspace_batch_size,
            settings.batch_delay_seconds AS workspace_batch_delay
     FROM contact_campaigns campaign
     LEFT JOIN contact_campaign_settings settings ON settings.user_id = $2
     WHERE campaign.id = $1 AND campaign.user_id = $2
     LIMIT 1`,
    [campaignId, userId],
  )) as DatabaseRow[];
  const row = rows[0];
  if (!row) return null;
  return {
    batchSize:
      row.campaign_batch_size != null
        ? asNumber(row.campaign_batch_size)
        : row.workspace_batch_size != null
          ? asNumber(row.workspace_batch_size)
          : null,
    batchDelaySeconds:
      row.campaign_batch_delay != null
        ? asNumber(row.campaign_batch_delay)
        : row.workspace_batch_delay != null
          ? asNumber(row.workspace_batch_delay)
          : null,
  };
};

type CampaignDispatchPlan = BatchPlan & {
  provider: string;
  deliveryMode: CampaignDeliveryMode;
  directRecipientLimit: number;
};

const DIRECT_REQUEST_BUDGET_SECONDS = 30;

/**
 * Direct sends must remain small enough to finish inside an interactive
 * request. ToSend has a true batch endpoint; providers that accept one message
 * per request are capped by thirty seconds of their sustained throughput.
 */
const resolveCampaignDeliveryPlan = (input: {
  recipientCount: number;
  limit: ProviderRateLimit;
  overrides: { batchSize?: number | null; batchDelaySeconds?: number | null };
  maximumBatchSize: number;
}): CampaignDispatchPlan => {
  const recipientCount = Math.max(
    0,
    Math.floor(Number(input.recipientCount) || 0),
  );
  const configuredThreshold = campaignBulkThreshold(
    process.env.CAMPAIGN_BULK_THRESHOLD,
  );
  const providerDirectCapacity =
    input.limit.provider.toLowerCase() === "tosend"
      ? input.maximumBatchSize
      : Math.max(
          1,
          Math.floor(
            sustainedRatePerSecond(input.limit) *
              DIRECT_REQUEST_BUDGET_SECONDS,
          ),
        );
  const directRecipientLimit = Math.max(
    1,
    Math.min(
      configuredThreshold,
      input.maximumBatchSize,
      providerDirectCapacity,
    ),
  );
  const deliveryMode = campaignDeliveryMode(
    recipientCount,
    directRecipientLimit,
  );

  if (deliveryMode === "direct") {
    return {
      provider: input.limit.provider,
      deliveryMode,
      directRecipientLimit,
      batchSize: Math.max(1, recipientCount),
      batchDelaySeconds: 0,
      batchCount: recipientCount ? 1 : 0,
      estimatedDurationSeconds: recipientCount
        ? Math.max(
            1,
            Math.ceil(recipientCount / sustainedRatePerSecond(input.limit)),
          )
        : 0,
    };
  }

  return {
    provider: input.limit.provider,
    deliveryMode,
    directRecipientLimit,
    ...planCampaignBatches({
      recipientCount,
      limit: input.limit,
      overrides: input.overrides,
    }),
  };
};

/**
 * Previews the pacing a send would use without committing to it, so the wizard
 * can promise a duration that matches what the dispatcher will really do.
 */
export async function previewCampaignPacing(
  userId: string,
  campaignId: string,
  recipientCount: number,
) {
  const [limit, overrides] = await Promise.all([
    resolveWorkspaceRateLimit(userId),
    resolvePacingOverrides(userId, campaignId),
  ]);
  const throttle = await resolveCampaignThrottleLimits(
    userId,
    limit.provider,
    campaignId,
  );
  const maximumBatchSize = safeCampaignBatchSize(throttle);
  const effectiveOverrides = {
    ...(overrides || {}),
    batchSize: Math.min(
      maximumBatchSize,
      Math.max(1, asNumber(overrides?.batchSize) || maximumBatchSize),
    ),
  };
  return resolveCampaignDeliveryPlan({
    recipientCount,
    limit,
    overrides: effectiveOverrides,
    maximumBatchSize,
  });
}

/**
 * Splits a campaign's already-queued recipients into waves. Wave N is spaced
 * from wave N-1 by the plan's delay, starting at `startAt`.
 *
 * Called after the wizard queues recipients, and again on resume so the
 * remaining recipients are re-timed from now rather than from the original
 * schedule.
 */
export async function planCampaignSend(
  userId: string,
  campaignId: string,
  startAt: Date = new Date(),
): Promise<CampaignDispatchPlan> {
  const sql = database();
  const pendingRows = (await sql.query(
    `SELECT COUNT(*)::int AS count
     FROM contact_campaign_messages message
     JOIN contact_campaigns campaign ON campaign.id = message.campaign_id
     WHERE message.campaign_id = $1
       AND campaign.user_id = $2
       AND message.status = 'queued'
       AND message.batch_id IS NULL`,
    [campaignId, userId],
  )) as DatabaseRow[];
  const pendingCount = asNumber(pendingRows[0]?.count);

  const [limit, overrides] = await Promise.all([
    resolveWorkspaceRateLimit(userId),
    resolvePacingOverrides(userId, campaignId),
  ]);
  const throttle = await resolveCampaignThrottleLimits(
    userId,
    limit.provider,
    campaignId,
  );
  const maximumBatchSize = safeCampaignBatchSize(throttle);
  const effectiveOverrides = {
    ...(overrides || {}),
    batchSize: Math.min(
      maximumBatchSize,
      Math.max(1, asNumber(overrides?.batchSize) || maximumBatchSize),
    ),
  };
  const plan = resolveCampaignDeliveryPlan({
    recipientCount: pendingCount,
    limit,
    overrides: effectiveOverrides,
    maximumBatchSize,
  });

  if (!plan.batchCount) {
    await sql.query(
      `UPDATE contact_campaigns
       SET batch_size = $3, batch_delay_seconds = $4,
           estimated_send_duration_seconds = 0, updated_at = NOW()
       WHERE id = $1 AND user_id = $2`,
      [campaignId, userId, plan.batchSize, plan.batchDelaySeconds],
    );
    return plan;
  }

  // Continue numbering after any wave this campaign already sent, so a resume
  // never collides with the batches that came before it.
  const existing = (await sql.query(
    `SELECT COALESCE(MAX(batch_number), 0)::int AS highest
     FROM campaign_send_batches WHERE campaign_id = $1`,
    [campaignId],
  )) as DatabaseRow[];
  const offset = asNumber(existing[0]?.highest);

  // One set-based statement handles the full recipient population. The old
  // implementation performed two round trips per batch, which becomes a
  // material bottleneck for a 500,000-recipient campaign.
  await sql.query(
    `WITH pending AS (
       SELECT message.id,
              FLOOR((ROW_NUMBER() OVER (
                ORDER BY message.scheduled_for, message.created_at, message.id
              ) - 1) / $3::numeric)::int AS batch_index
       FROM contact_campaign_messages message
       JOIN contact_campaigns campaign ON campaign.id = message.campaign_id
       WHERE message.campaign_id = $1::uuid
         AND campaign.user_id = $2::uuid
         AND message.status = 'queued'
         AND message.batch_id IS NULL
     ), grouped AS (
       SELECT batch_index, COUNT(*)::int AS recipient_count
       FROM pending
       GROUP BY batch_index
     ), inserted AS (
       INSERT INTO campaign_send_batches (
         campaign_id, batch_number, recipient_count, status, scheduled_for
       )
       SELECT $1::uuid,
              $4::int + grouped.batch_index + 1,
              grouped.recipient_count,
              'pending',
              $5::timestamptz + grouped.batch_index * ($6::int * INTERVAL '1 second')
       FROM grouped
       ON CONFLICT (campaign_id, batch_number) DO UPDATE SET
         recipient_count = EXCLUDED.recipient_count,
         status = 'pending',
         scheduled_for = EXCLUDED.scheduled_for,
         updated_at = NOW()
       RETURNING id, batch_number
     )
     UPDATE contact_campaign_messages message
     SET batch_id = inserted.id,
         scheduled_for = $5::timestamptz + pending.batch_index * ($6::int * INTERVAL '1 second'),
         updated_at = NOW()
     FROM pending
     JOIN inserted
       ON inserted.batch_number = $4::int + pending.batch_index + 1
     WHERE message.id = pending.id`,
    [campaignId, userId, plan.batchSize, offset, startAt.toISOString(), plan.batchDelaySeconds],
  );

  await sql.query(
    `UPDATE contact_campaigns
     SET batch_size = $3, batch_delay_seconds = $4,
         estimated_send_duration_seconds = $5, updated_at = NOW()
     WHERE id = $1 AND user_id = $2`,
    [
      campaignId,
      userId,
      plan.batchSize,
      plan.batchDelaySeconds,
      plan.estimatedDurationSeconds,
    ],
  );
  return plan;
}

/**
 * Sends one wave. Every message is keyed on the campaign and contact, so a
 * repeated call is a no-op for anyone already sent rather than a second email.
 */
type CampaignBatchDispatchOptions = {
  retryOnTemporaryFailure?: boolean;
};

const sendBatchMessages = async (
  batchId: string,
  options: CampaignBatchDispatchOptions = {},
) => {
  const sql = database();
  const rows = (await sql.query(
    `SELECT message.id, message.contact_id, message.recipient,
            campaign.id AS campaign_id, campaign.user_id, campaign.subject,
            campaign.html_body, campaign.identity_id,
            contact.full_name, contact.company
     FROM contact_campaign_messages message
     JOIN contact_campaigns campaign ON campaign.id = message.campaign_id
     LEFT JOIN contacts contact ON contact.id = message.contact_id
     WHERE message.batch_id = $1
       AND message.status = 'queued'`,
    [batchId],
  )) as DatabaseRow[];
  if (!rows.length) return { sent: 0, failed: 0, skipped: 0 };
  if (!campaignSendAllowed()) {
    throw new Error(
      "Campaign sending is not enabled. Use a stable HTTPS application URL in production, or explicitly enable development campaign sending for a local smoke test.",
    );
  }

  const { stageBulkEmail, deliverEmail } = await import(
    "./email-service"
  );
  const userId = asString(rows[0].user_id);
  const campaignId = asString(rows[0].campaign_id);
  const [deliveryContext, rateLimit] = await Promise.all([
    campaignDeliveryContext(userId, campaignId),
    resolveWorkspaceRateLimit(userId),
  ]);
  if (await providerQueueIsPaused(userId, rateLimit.provider)) {
    throw new CampaignDispatchError(
      "This provider queue is paused while sender reputation is reviewed.",
      503,
      "provider_queue_paused",
    );
  }
  const throttle = await resolveCampaignThrottleLimits(
    userId,
    rateLimit.provider,
    campaignId,
  );
  // Temporary failures above the slow threshold are a reputation signal even
  // when they are not high enough to pause the campaign. Halving the shared
  // campaign/provider reservations and doubling the request interval gives a
  // provider time to recover without creating a second burst on another worker.
  const effectiveThrottle = throttle.slowed
    ? {
        workspacePerMinute: throttle.workspacePerMinute,
        domainPerMinute: throttle.domainPerMinute,
        campaignPerMinute: Math.max(1, Math.floor(throttle.campaignPerMinute / 2)),
        providerPerMinute: Math.max(1, Math.floor(throttle.providerPerMinute / 2)),
      }
    : throttle;
  const reservation = await consumeCampaignRateLimits({
    workspaceId: userId,
    campaignId,
    provider: rateLimit.provider,
    domain: deliveryContext.sendingDomain,
    amount: rows.length,
    ...effectiveThrottle,
  });
  if (!reservation.allowed) throw new CampaignRateLimitError(reservation.retryAfterMs);
  const sendIntervalMs = providerSendIntervalMs(rateLimit) * (throttle.slowed ? 2 : 1);
  let nextSendSlot = 0;
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  // ToSend accepts up to 100 independent messages in one request and returns
  // an ordered per-message result. Queue the whole wave first, then let the
  // centralized workspace service atomically claim and finalize each log. A
  // partial response therefore retries only rejected recipients; accepted
    // recipients remain sent and are never submitted again.
  if (rateLimit.provider.toLowerCase() === "tosend") {
    const prepared: Array<{ row: DatabaseRow; messageId: string; lockKey: string; lockToken: string; logId: string }> = [];
    for (const [index, row] of rows.entries()) {
      const messageId = asString(row.id);
      const rowCampaignId = asString(row.campaign_id);
      const claimed = (await sql.query(
        `UPDATE contact_campaign_messages
         SET status = 'processing', processing_started_at = NOW(),
             attempt_count = attempt_count + 1, updated_at = NOW()
         WHERE id = $1::uuid AND status = 'queued'
         RETURNING id`,
        [messageId],
      )) as DatabaseRow[];
      if (!claimed[0]) continue;
      const lockKey = `campaign:${rowCampaignId}:recipient:${messageId}`;
      const lockToken = randomUUID();
      const locked = await acquireQueueLock(lockKey, lockToken, 120_000);
      if (!locked) {
        await sql.query(
          `UPDATE contact_campaign_messages
           SET status = 'queued', processing_started_at = NULL, updated_at = NOW()
           WHERE id = $1::uuid AND status = 'processing'`,
          [messageId],
        );
        continue;
      }
      let retainedLock = false;
      try {
        if (index % 10 === 0) {
          await sql.query(
            `UPDATE campaign_send_batches
             SET last_heartbeat_at = NOW(), updated_at = NOW()
             WHERE id = $1::uuid AND status = 'sending'`,
            [batchId],
          );
        }
        const blocked = (await sql.query(
          `SELECT contact.unsubscribed_at, suppression.id AS suppression_id
           FROM contact_campaign_messages message
           LEFT JOIN contacts contact ON contact.id = message.contact_id
           LEFT JOIN email_suppressions suppression
             ON suppression.user_id = $2::uuid
            AND LOWER(TRIM(suppression.recipient)) = LOWER(TRIM(message.recipient))
           WHERE message.id = $1::uuid
             AND (contact.unsubscribed_at IS NOT NULL OR suppression.id IS NOT NULL)
           LIMIT 1`,
          [messageId, userId],
        )) as DatabaseRow[];
        if (blocked[0]) {
          skipped += 1;
          await sql.query(
            `UPDATE contact_campaign_messages
             SET status = 'skipped', processing_started_at = NULL,
                 failure_kind = 'suppressed', failure_reason = 'Recipient is unsubscribed or suppressed.',
                 suppression_reason = 'suppressed', skipped_at = NOW(), updated_at = NOW()
             WHERE id = $1::uuid AND status = 'processing'`,
            [messageId],
          );
          continue;
        }
        const queued = await stageBulkEmail({
          userId,
          to: asString(row.recipient),
          identityId: row.identity_id ? asString(row.identity_id) : undefined,
          idempotencyKey: `campaign-${campaignId}-${messageId}`,
          sourceEventId: campaignId,
          emailClassification: "CAMPAIGN",
          headers: campaignListUnsubscribeHeaders(campaignUnsubscribeUrl(messageId)),
          override: {
            module: "contacts",
            subject: asString(row.subject),
            html: decorateCampaignEmail(
              asString(row.html_body),
              messageId,
              deliveryContext.mailingAddress,
            ),
          },
          variables: {
            contact: { name: asString(row.full_name), company: asString(row.company) },
            unsubscribe: { url: campaignUnsubscribeUrl(messageId) },
          },
          autoDeliver: false,
        });
        prepared.push({ row, messageId, lockKey, lockToken, logId: queued.id });
        retainedLock = true;
      } catch (error) {
        const reason = error instanceof Error ? error.message.slice(0, 400) : "Send could not be queued.";
        const errorCode = asString((error as { code?: unknown })?.code);
        const suppressed = errorCode === "recipient_suppressed" || /suppressed|unsubscribe/i.test(reason);
        if (suppressed) skipped += 1;
        else failed += 1;
        await sql.query(
          `UPDATE contact_campaign_messages
           SET status = $3, processing_started_at = NULL,
               failure_kind = $4, failure_reason = $2,
               suppression_reason = CASE WHEN $3 = 'skipped' THEN 'suppressed' ELSE suppression_reason END,
               skipped_at = CASE WHEN $3 = 'skipped' THEN NOW() ELSE skipped_at END,
               updated_at = NOW()
           WHERE id = $1::uuid AND status = 'processing'`,
          [messageId, reason, suppressed ? "skipped" : "failed", suppressed ? "suppressed" : "permanent"],
        );
        recordDispatchEvent(userId, rowCampaignId, messageId, "email_failed", { error: reason });
      } finally {
        if (!retainedLock) await releaseQueueLock(lockKey, lockToken);
      }
    }

    let batchFailed = false;
    if (prepared.length) {
      try {
        await deliverWorkspaceEmailBatch(
          prepared.map((item) => item.logId),
          {
            retryOnTemporaryFailure:
              options.retryOnTemporaryFailure !== false,
          },
        );
      } catch (error) {
        batchFailed = true;
        const reason = error instanceof Error ? error.message.slice(0, 400) : "The provider batch could not be completed.";
        await sql.query(
          `UPDATE contact_campaign_messages
           SET status = 'queued', processing_started_at = NULL,
               failure_kind = 'temporary', failure_reason = $2, updated_at = NOW()
           WHERE id = ANY($1::uuid[]) AND status = 'processing'`,
          [prepared.map((item) => item.messageId), reason],
        );
      }
    }

    try {
      if (batchFailed) throw new CampaignDeliveryRetryableError("The provider batch could not be completed. The wave will retry automatically.");
      const logRows = (await sql.query(
        `SELECT id, status, last_error, provider_message_id, provider,
                provider_response, provider_error_detail
         FROM email_logs
         WHERE id = ANY($1::uuid[])`,
        [prepared.map((item) => item.logId)],
      )) as DatabaseRow[];
      const byLogId = new Map(logRows.map((log) => [asString(log.id), log]));
      let shouldRetry = false;
      for (const item of prepared) {
        const log = byLogId.get(item.logId);
        if (!log) {
          failed += 1;
          await sql.query(
            `UPDATE contact_campaign_messages
             SET status = 'failed', processing_started_at = NULL,
                 failure_kind = 'permanent', failure_reason = 'The email delivery log was not found.', updated_at = NOW()
             WHERE id = $1::uuid AND status = 'processing'`,
            [item.messageId],
          );
          continue;
        }
        const status = asString(log.status);
        if (["sent", "delivered", "opened", "clicked"].includes(status)) {
          sent += 1;
          await sql.query(
            `UPDATE contact_campaign_messages
             SET status = 'sent', provider = $2, provider_message_id = NULLIF($3, ''),
                 accepted_at = COALESCE(accepted_at, NOW()), sent_at = COALESCE(sent_at, NOW()),
                 processing_started_at = NULL, failure_kind = '', failure_reason = '', updated_at = NOW()
             WHERE id = $1::uuid AND status = 'processing'`,
            [item.messageId, asString(log.provider) || rateLimit.provider, asString(log.provider_message_id)],
          );
          recordDispatchEvent(userId, campaignId, item.messageId, "email_sent", {
            provider: asString(log.provider) || rateLimit.provider,
            providerMessageId: asString(log.provider_message_id),
          });
          continue;
        }
        if (status === "queued" || status === "sending") {
          shouldRetry = true;
          await sql.query(
            `UPDATE contact_campaign_messages
             SET status = 'queued', processing_started_at = NULL,
                 failure_kind = 'temporary', failure_reason = $2, updated_at = NOW()
             WHERE id = $1::uuid AND status = 'processing'`,
            [item.messageId, asString(log.provider_error_detail) || asString(log.last_error) || "The provider is temporarily unavailable."],
          );
          continue;
        }
        if (status === "unknown") {
          await sql.query(
            `UPDATE contact_campaign_messages
             SET status = 'unknown', processing_started_at = NULL,
                 failure_kind = 'unknown', failure_reason = $2, updated_at = NOW()
             WHERE id = $1::uuid AND status = 'processing'`,
            [item.messageId, asString(log.last_error) || "The provider response was uncertain. Reconciliation is required."],
          );
          failed += 1;
          continue;
        }
        const suppressed = /suppressed|unsubscribe|complaint|bounce/i.test(asString(log.last_error));
        if (suppressed) skipped += 1;
        else failed += 1;
        await sql.query(
          `UPDATE contact_campaign_messages
           SET status = $3, processing_started_at = NULL,
               failure_kind = $4, failure_reason = $2,
               suppression_reason = CASE WHEN $3 = 'skipped' THEN 'suppressed' ELSE suppression_reason END,
               skipped_at = CASE WHEN $3 = 'skipped' THEN NOW() ELSE skipped_at END,
               updated_at = NOW()
           WHERE id = $1::uuid AND status = 'processing'`,
          [item.messageId, asString(log.last_error) || "The provider did not accept this message.", suppressed ? "skipped" : "failed", suppressed ? "suppressed" : "permanent"],
        );
        recordDispatchEvent(userId, campaignId, item.messageId, "email_failed", { providerStatus: status });
      }
      if (shouldRetry) throw new CampaignDeliveryRetryableError("Some recipients are waiting for a provider retry.");
    } finally {
      await Promise.all(prepared.map((item) => releaseQueueLock(item.lockKey, item.lockToken)));
    }
    return { sent, failed, skipped };
  }

  for (const [index, row] of rows.entries()) {
    const messageId = asString(row.id);
    const rowCampaignId = asString(row.campaign_id);
    const claimed = (await sql.query(
      `UPDATE contact_campaign_messages
       SET status = 'processing', processing_started_at = NOW(),
           attempt_count = attempt_count + 1, updated_at = NOW()
       WHERE id = $1::uuid AND status = 'queued'
       RETURNING id`,
      [messageId],
    )) as DatabaseRow[];
    if (!claimed[0]) continue;

    const lockKey = `campaign:${rowCampaignId}:recipient:${messageId}`;
    const lockToken = randomUUID();
    const locked = await acquireQueueLock(lockKey, lockToken, 120_000);
    if (!locked) {
      await sql.query(
        `UPDATE contact_campaign_messages
         SET status = 'queued', processing_started_at = NULL, updated_at = NOW()
         WHERE id = $1::uuid AND status = 'processing'`,
        [messageId],
      );
      continue;
    }
    try {
      if (index % 10 === 0) {
        await sql.query(
          `UPDATE campaign_send_batches
           SET last_heartbeat_at = NOW(), updated_at = NOW()
           WHERE id = $1::uuid AND status = 'sending'`,
          [batchId],
        );
      }
      // Re-check the suppression state after the durable claim and immediately
      // before provider work. A contact can unsubscribe or be suppressed after
      // audience materialization while a long campaign is still draining.
      const blocked = (await sql.query(
        `SELECT contact.unsubscribed_at, suppression.id AS suppression_id
         FROM contact_campaign_messages message
         LEFT JOIN contacts contact ON contact.id = message.contact_id
         LEFT JOIN email_suppressions suppression
           ON suppression.user_id = $2::uuid
          AND LOWER(TRIM(suppression.recipient)) = LOWER(TRIM(message.recipient))
         WHERE message.id = $1::uuid
           AND (contact.unsubscribed_at IS NOT NULL OR suppression.id IS NOT NULL)
         LIMIT 1`,
        [messageId, userId],
      )) as DatabaseRow[];
      if (blocked[0]) {
        skipped += 1;
        const suppressionReason = blocked[0].unsubscribed_at
          ? "unsubscribed"
          : "suppressed";
        await sql.query(
          `UPDATE contact_campaign_messages
           SET status = 'skipped', processing_started_at = NULL,
               failure_kind = 'suppressed',
               failure_reason = 'Recipient is unsubscribed or suppressed.',
               suppression_reason = $2,
               skipped_at = NOW(), updated_at = NOW()
           WHERE id = $1::uuid AND status = 'processing'`,
          [messageId, suppressionReason],
        );
        continue;
      }
      // A wave is claimed atomically, but the provider still sees one request
      // per recipient. Pace those requests at the same sustained rate used by
      // the batch planner so a 100+ recipient list never becomes a burst.
      const remainingWait = nextSendSlot - Date.now();
      if (remainingWait > 0) await wait(remainingWait);
      nextSendSlot = Date.now() + sendIntervalMs;

      const queued = await stageBulkEmail({
        userId: asString(row.user_id),
        to: asString(row.recipient),
        identityId: row.identity_id ? asString(row.identity_id) : undefined,
        // The stable part of this key is what guarantees a resumed or retried
        // wave never produces a duplicate email.
        // Message id is stable even for a custom address that is not present
        // in Contacts, and is unique within this campaign.
        idempotencyKey: `campaign-${campaignId}-${messageId}`,
         sourceEventId: campaignId,
         emailClassification: "CAMPAIGN",
         headers: campaignListUnsubscribeHeaders(campaignUnsubscribeUrl(messageId)),
        override: {
          module: "contacts",
          subject: asString(row.subject),
          html: decorateCampaignEmail(
            asString(row.html_body),
            messageId,
            deliveryContext.mailingAddress,
          ),
        },
        variables: {
          contact: {
            name: asString(row.full_name),
            company: asString(row.company),
          },
          unsubscribe: { url: campaignUnsubscribeUrl(messageId) },
        },
        // Campaign dispatch owns delivery for this message. Prevent
        // the transactional background path from racing the explicit await
        // below and causing a false "provider did not accept" result.
        autoDeliver: false,
      });
      await deliverEmail(queued.id, {
        retryOnTemporaryFailure: options.retryOnTemporaryFailure !== false,
      });

      // deliverWorkspaceEmail records the outcome rather than throwing, so the
      // stored status is the only honest signal. Marking every message 'sent'
      // regardless would report a delivered campaign that never left.
      const logs = (await sql.query(
        `SELECT status, last_error, provider_message_id, provider,
                provider_response, provider_error_detail
         FROM email_logs WHERE id = $1 LIMIT 1`,
        [queued.id],
      )) as DatabaseRow[];
      const status = asString(logs[0]?.status);
      const log = logs[0] || {};
      if (status === "queued" || status === "sending") {
        await sql.query(
          `UPDATE contact_campaign_messages
           SET status = 'queued', processing_started_at = NULL,
               failure_kind = 'temporary', failure_reason = $2, updated_at = NOW()
           WHERE id = $1::uuid AND status = 'processing'`,
          [
            messageId,
            asString(log.provider_error_detail) ||
              asString(log.last_error) ||
              "The provider is temporarily unavailable.",
          ],
        );
        throw new CampaignDeliveryRetryableError(
          asString(log.last_error) || "The provider is temporarily unavailable.",
        );
      }
      const delivered = ["sent", "delivered", "opened", "clicked"].includes(
        status,
      );

      if (!delivered) {
        const suppressed = /suppressed|unsubscribe|complaint|bounce/i.test(
          asString(log.last_error),
        );
        if (suppressed) skipped += 1;
        else failed += 1;
        await sql.query(
          `UPDATE contact_campaign_messages
           SET status = $3, processing_started_at = NULL,
               failure_kind = $4, failure_reason = $2,
               suppression_reason = CASE WHEN $3 = 'skipped' THEN 'suppressed' ELSE suppression_reason END,
               skipped_at = CASE WHEN $3 = 'skipped' THEN NOW() ELSE skipped_at END,
               updated_at = NOW()
           WHERE id = $1::uuid AND status = 'processing'`,
          [
            messageId,
            asString(log.last_error) ||
              (status === "queued"
                ? "No email provider accepted this message."
                : "The provider did not accept this message."),
            suppressed ? "skipped" : "failed",
            suppressed ? "suppressed" : "permanent",
          ],
        );
        recordDispatchEvent(
          asString(row.user_id),
          rowCampaignId,
          messageId,
          "email_failed",
          { providerStatus: status },
        );
        continue;
      }

      await sql.query(
        `UPDATE contact_campaign_messages
         SET status = CASE
               WHEN COALESCE(($3::jsonb ->> 'outcome'), '') = 'bounce' THEN 'hard_bounce'
               WHEN COALESCE(($3::jsonb ->> 'outcome'), '') = 'complaint' THEN 'complained'
               ELSE 'sent'
             END,
             sent_at = COALESCE(sent_at, NOW()),
             provider_message_id = NULLIF($2, ''),
             processing_started_at = NULL,
             failure_kind = CASE
               WHEN COALESCE(($3::jsonb ->> 'outcome'), '') = 'bounce' THEN 'hard_bounce'
               WHEN COALESCE(($3::jsonb ->> 'outcome'), '') = 'complaint' THEN 'complaint'
               ELSE failure_kind
             END,
             updated_at = NOW()
         WHERE id = $1::uuid AND status = 'processing'`,
        [messageId, asString(log.provider_message_id), JSON.stringify(log.provider_response || {})],
      );
      recordDispatchEvent(
        asString(row.user_id),
        rowCampaignId,
        messageId,
        "email_sent",
        {
          provider: asString(log.provider),
          providerMessageId: asString(log.provider_message_id),
        },
      );
      if (status === "delivered") {
        recordDispatchEvent(
          asString(row.user_id),
          rowCampaignId,
          messageId,
          "email_delivered",
          { provider: asString(log.provider) },
        );
      }
      sent += 1;
    } catch (error) {
      if (error instanceof CampaignDeliveryRetryableError || error instanceof CampaignRateLimitError) {
        throw error;
      }
      failed += 1;
      const reason =
        error instanceof Error ? error.message.slice(0, 400) : "Send failed.";
      const errorCode = asString((error as { code?: unknown })?.code);
      const suppressed = errorCode === "recipient_suppressed" || /suppressed/i.test(reason);
      await sql.query(
        `UPDATE contact_campaign_messages
         SET status = $3, processing_started_at = NULL,
             failure_kind = $4, failure_reason = $2,
             suppression_reason = CASE WHEN $3 = 'skipped' THEN 'suppressed' ELSE suppression_reason END,
             skipped_at = CASE WHEN $3 = 'skipped' THEN NOW() ELSE skipped_at END,
             updated_at = NOW()
         WHERE id = $1::uuid AND status = 'processing'`,
        [messageId, reason, suppressed ? "skipped" : "failed", suppressed ? "suppressed" : "permanent"],
      );
      recordDispatchEvent(
        asString(row.user_id),
        rowCampaignId,
        messageId,
        "email_failed",
        { error: reason },
      );
    } finally {
      await releaseQueueLock(lockKey, lockToken);
    }
  }
  return { sent, failed, skipped };
};

/**
 * Marks a campaign sent once no wave is left to run. A campaign whose waves
 * are paused stays paused; only a fully dispatched one completes.
 */
const completeCampaignIfDone = async (campaignId: string) => {
  const rows = await database().query(
    `UPDATE contact_campaigns
     SET status = 'sent', sent_at = COALESCE(sent_at, NOW()), updated_at = NOW()
     WHERE id = $1
        AND status IN ('queued', 'sending')
       AND NOT EXISTS (
         SELECT 1 FROM campaign_send_batches
          WHERE campaign_id = $1 AND status IN ('pending', 'queued', 'sending')
       )
     RETURNING id, user_id`,
    [campaignId],
  );
  const completed = (rows as DatabaseRow[])[0];
  if (completed) {
    await Promise.allSettled([
      dispatchWorkspaceWorkflowEvent(String(completed.user_id || ""), "campaign_sent", {
        id: campaignId,
        status: "sent",
      }, `campaign_sent:${campaignId}`),
    ]);
  }
};

/**
 * Claims and delivers one batch. BullMQ workers and the legacy cron backstop
 * both call this function; the conditional PostgreSQL claim is the final
 * authority that prevents two instances from sending the same wave.
 */
export async function dispatchCampaignBatch(
  batchId: string,
  options: CampaignBatchDispatchOptions = {},
) {
  if (!isUuid(batchId)) return null;
  const sql = database();
  const claimed = (await sql.query(
    `UPDATE campaign_send_batches batch
     SET status = 'sending', dispatched_at = COALESCE(batch.dispatched_at, NOW()),
         started_at = COALESCE(batch.started_at, NOW()),
         attempt_count = batch.attempt_count + 1,
         last_heartbeat_at = NOW(), updated_at = NOW()
     WHERE batch.id = $1::uuid
       AND batch.status IN ('pending', 'queued')
       AND batch.scheduled_for <= NOW()
       AND EXISTS (
         SELECT 1 FROM contact_campaigns campaign
         WHERE campaign.id = batch.campaign_id
           AND campaign.status IN ('scheduled', 'queued', 'sending')
       )
     RETURNING batch.id, batch.campaign_id`,
    [batchId],
  )) as DatabaseRow[];
  const batch = claimed[0];
  if (!batch) return null;
  const campaignId = asString(batch.campaign_id);
  try {
    await sql.query(
      `UPDATE contact_campaigns
       SET status = 'sending', updated_at = NOW()
       WHERE id = $1::uuid AND status IN ('scheduled', 'queued')`,
      [campaignId],
    );
    const result = await sendBatchMessages(batchId, options);
    await sql.query(
      `UPDATE campaign_send_batches
       SET status = 'sent', sent_count = $2, failed_count = $3,
           processed_count = $2::int + $3::int + $4::int, skipped_count = $4::int,
           completed_at = NOW(), last_heartbeat_at = NOW(), updated_at = NOW()
       WHERE id = $1::uuid`,
      [batchId, result.sent, result.failed, result.skipped],
    );
    await evaluateCampaignReputation(campaignId);
    await completeCampaignIfDone(campaignId);
    kickCampaignAnalyticsWorker(campaignId);
    return { batchId, campaignId, ...result };
  } catch (error) {
    // Temporary provider outcomes are written on the recipient rows before
    // this error is raised. Refresh reputation here as well as on a completed
    // wave so the >10% slow-down and >20% pause thresholds take effect even
    // when the first attempt of a batch fails.
    await evaluateCampaignReputation(campaignId).catch((reputationError) => {
      console.error("[campaign-dispatch] reputation update failed", {
        type: reputationError instanceof Error ? reputationError.name : typeof reputationError,
      });
    });
    const reason = error instanceof Error ? error.message.slice(0, 400) : "Batch dispatch failed.";
    if (options.retryOnTemporaryFailure === false) {
      // Interactive small campaigns never disappear into a delayed retry. Any
      // recipient already accepted remains sent; only unfinished rows fail.
      await sql.query(
        `UPDATE contact_campaign_messages
         SET status = 'failed', processing_started_at = NULL,
             failure_kind = 'temporary', failure_reason = $2,
             updated_at = NOW()
         WHERE batch_id = $1::uuid
           AND status IN ('queued', 'processing', 'sending')`,
        [batchId, reason],
      );
      await sql.query(
        `UPDATE campaign_send_batches batch
         SET status = 'failed',
             sent_count = (
               SELECT COUNT(*)::int FROM contact_campaign_messages message
               WHERE message.batch_id = batch.id
                 AND message.status IN ('sent', 'delivered', 'opened', 'clicked')
             ),
             failed_count = (
               SELECT COUNT(*)::int FROM contact_campaign_messages message
               WHERE message.batch_id = batch.id
                 AND message.status IN ('failed', 'bounced', 'hard_bounce', 'complained', 'unknown')
             ),
             skipped_count = (
               SELECT COUNT(*)::int FROM contact_campaign_messages message
               WHERE message.batch_id = batch.id AND message.status = 'skipped'
             ),
             processed_count = batch.recipient_count,
             completed_at = NOW(), last_error = $2,
             last_heartbeat_at = NOW(), updated_at = NOW()
         WHERE batch.id = $1::uuid AND batch.status = 'sending'`,
        [batchId, reason],
      );
      await sql.query(
        `UPDATE contact_campaigns
         SET status = 'failed', updated_at = NOW()
         WHERE id = $1::uuid AND status IN ('scheduled', 'queued', 'sending')`,
        [campaignId],
      );
      throw error;
    }

    const retryAfter = error instanceof CampaignRateLimitError
      ? error.retryAfterMs
      : error instanceof CampaignDispatchError && error.code === "provider_queue_paused"
        ? 5 * 60_000
        : 30_000;
    await sql.query(
      `UPDATE campaign_send_batches
       SET status = CASE
         WHEN EXISTS (
           SELECT 1 FROM contact_campaigns campaign
           WHERE campaign.id = campaign_send_batches.campaign_id
             AND campaign.status = 'paused'
         ) THEN 'paused'
         ELSE 'pending'
       END,
           scheduled_for = NOW() + ($2::int * INTERVAL '1 millisecond'),
           last_error = $3, last_heartbeat_at = NOW(), updated_at = NOW()
       WHERE id = $1::uuid AND status = 'sending'`,
      [batchId, retryAfter, reason],
    );
    throw error;
  }
}

/**
 * Reclaims waves abandoned by a crashed worker. Heartbeats are refreshed while
 * a large wave is draining, so only genuinely stale work is made available to
 * another worker. Once the bounded attempt budget is exhausted, the wave and
 * campaign become visibly failed instead of remaining stuck in `sending`.
 */
export async function recoverStaleCampaignBatches(
  requestedAgeMinutes = Number(process.env.CAMPAIGN_BATCH_STALE_MINUTES || 15),
) {
  const sql = database();
  const ageMinutes = Math.max(
    5,
    Math.min(1_440, Math.floor(Number(requestedAgeMinutes) || 15)),
  );
  const maxAttempts = Math.max(
    1,
    Math.min(10, Math.floor(Number(process.env.QUEUE_MAX_ATTEMPTS || 5))),
  );
  const rows = (await sql.query(
    `UPDATE campaign_send_batches batch
     SET status = CASE
           WHEN campaign.status = 'paused' THEN 'paused'
           WHEN campaign.status = 'cancelled' THEN 'cancelled'
           WHEN batch.attempt_count >= $2 THEN 'failed'
           ELSE 'pending'
         END,
         scheduled_for = CASE WHEN campaign.status IN ('paused', 'cancelled')
           OR batch.attempt_count >= $2
           THEN batch.scheduled_for ELSE NOW() END,
         last_error = CASE
           WHEN campaign.status IN ('paused', 'cancelled') THEN batch.last_error
           WHEN batch.attempt_count >= $2
             THEN 'The delivery worker stopped during this batch.'
           ELSE 'The previous delivery worker stopped. Retrying the batch.'
         END,
         updated_at = NOW(), last_heartbeat_at = NOW()
     FROM contact_campaigns campaign
     WHERE batch.status = 'sending'
       AND campaign.id = batch.campaign_id
       AND COALESCE(batch.last_heartbeat_at, batch.updated_at)
           <= NOW() - ($1::int * INTERVAL '1 minute')
     RETURNING batch.id, batch.campaign_id, batch.status`,
    [ageMinutes, maxAttempts],
  )) as DatabaseRow[];
  const failedCampaigns = Array.from(
    new Set(
      rows
        .filter((row) => asString(row.status) === "failed")
        .map((row) => asString(row.campaign_id))
        .filter(Boolean),
    ),
  );
  if (failedCampaigns.length) {
    await sql.query(
      `UPDATE contact_campaigns
       SET status = 'failed', updated_at = NOW()
       WHERE id = ANY($1::uuid[]) AND status IN ('scheduled', 'queued', 'sending')`,
      [failedCampaigns],
    );
  }
  return {
    reclaimed: rows.filter((row) => asString(row.status) === "pending").length,
    failed: rows.filter((row) => asString(row.status) === "failed").length,
  };
}

/**
 * The cron entry point: claims every wave that is due and sends it.
 *
 * Claiming uses a conditional UPDATE so two overlapping ticks cannot both take
 * the same wave — the second one's UPDATE matches no row.
 */
export async function dispatchDueCampaignBatches(
  maxBatches = 5,
  workspaceId?: string,
) {
  const sql = database();
  await recoverStaleCampaignBatches();
  const limit = Math.max(1, Math.min(50, Math.floor(maxBatches) || 5));
  const dispatched: Array<{
    batchId: string;
    campaignId: string;
    sent: number;
    failed: number;
  }> = [];

  for (let index = 0; index < limit; index += 1) {
    const claimed = (await sql.query(
      `UPDATE campaign_send_batches
       SET status = 'sending', dispatched_at = COALESCE(dispatched_at, NOW()),
           started_at = COALESCE(started_at, NOW()),
           attempt_count = attempt_count + 1,
           last_heartbeat_at = NOW(), updated_at = NOW()
       WHERE id = (
         SELECT batch.id
         FROM campaign_send_batches batch
         JOIN contact_campaigns campaign ON campaign.id = batch.campaign_id
         WHERE batch.status IN ('pending', 'queued')
         AND batch.scheduled_for <= NOW()
           AND campaign.status IN ('scheduled', 'queued', 'sending')
           AND ($1::uuid IS NULL OR campaign.user_id = $1::uuid)
         ORDER BY batch.scheduled_for, batch.batch_number
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, campaign_id`,
      [workspaceId || null],
    )) as DatabaseRow[];
    const batch = claimed[0];
    if (!batch) break;

    const batchId = asString(batch.id);
    const campaignId = asString(batch.campaign_id);
    try {
      // A scheduled campaign becomes an active send only when its first due
      // wave is claimed. This keeps it visible as scheduled until the exact
      // due instant, while allowing the existing sending lifecycle to finish
      // and update analytics normally.
      await sql.query(
        `UPDATE contact_campaigns
         SET status = 'sending', updated_at = NOW()
         WHERE id = $1 AND status IN ('scheduled', 'queued')`,
        [campaignId],
      );
      const result = await sendBatchMessages(batchId);
      await sql.query(
        `UPDATE campaign_send_batches
         SET status = 'sent', sent_count = $2, failed_count = $3,
             processed_count = $2::int + $3::int + $4::int, skipped_count = $4::int,
             completed_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [batchId, result.sent, result.failed, result.skipped],
      );
       await evaluateCampaignReputation(campaignId);
       await completeCampaignIfDone(campaignId);
      // Delivery events wake the analytics worker as they are appended. This
      // explicit kick also covers an empty/fully-failed wave without blocking
      // dispatch on a full campaign read-model rebuild.
      kickCampaignAnalyticsWorker(campaignId);
      dispatched.push({ batchId, campaignId, ...result });
    } catch (error) {
      // The wave goes back to pending so the next tick retries it. Recipients
      // already sent inside it are protected by their idempotency key.
      console.error("[campaign-dispatch] batch failed", {
        type: error instanceof Error ? error.name : typeof error,
        message: error instanceof Error ? error.message.slice(0, 300) : "",
        position: String((error as { position?: unknown })?.position || ""),
        detail: String((error as { detail?: unknown })?.detail || ""),
      });
      await evaluateCampaignReputation(campaignId).catch((reputationError) => {
        console.error("[campaign-dispatch] reputation update failed", {
          type: reputationError instanceof Error ? reputationError.name : typeof reputationError,
        });
      });
      await sql.query(
        `UPDATE campaign_send_batches
         SET status = CASE
           WHEN EXISTS (
             SELECT 1 FROM contact_campaigns campaign
             WHERE campaign.id = campaign_send_batches.campaign_id
               AND campaign.status = 'paused'
           ) THEN 'paused'
           ELSE 'pending'
         END,
             scheduled_for = NOW() + ($2::int * INTERVAL '1 millisecond'),
             last_error = $3, updated_at = NOW()
         WHERE id = $1`,
        [
          batchId,
          error instanceof CampaignRateLimitError ? error.retryAfterMs : 30_000,
          error instanceof Error
            ? error.message.slice(0, 400)
            : "Batch dispatch failed.",
        ],
      );
      break;
    }
  }
  return { dispatched, batchCount: dispatched.length };
}

/**
 * Sends the campaign's first due wave immediately so the user sees progress
 * straight away instead of waiting for the next cron tick.
 */
export async function dispatchFirstCampaignBatch(
  campaignId: string,
  options: CampaignBatchDispatchOptions = {},
) {
  if (!isUuid(campaignId)) return { sent: 0, failed: 0 };
  const sql = database();
  const due = (await sql.query(
    `SELECT id FROM campaign_send_batches
     WHERE campaign_id = $1::uuid AND status IN ('pending', 'queued')
       AND scheduled_for <= NOW()
     ORDER BY batch_number LIMIT 1`,
    [campaignId],
  )) as DatabaseRow[];
  const batchId = asString(due[0]?.id);
  if (!batchId) return { sent: 0, failed: 0 };
  const result = await dispatchCampaignBatch(batchId, options);
  return result || { sent: 0, failed: 0 };
}

export type CampaignSendProgress = {
  campaignId: string;
  status: string;
  batchSize: number;
  batchDelaySeconds: number;
  estimatedSendDurationSeconds: number;
  totalRecipients: number;
  sent: number;
  failed: number;
  pending: number;
  batchesTotal: number;
  batchesSent: number;
  nextBatchAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
};

/** Live "1,240 of 5,000 delivered" state for the campaign detail view. */
export async function getCampaignSendProgress(
  userId: string,
  campaignId: string,
): Promise<CampaignSendProgress> {
  if (!isUuid(campaignId)) {
    throw new CampaignDispatchError("That campaign is not available.", 404);
  }
  const sql = database();
  const rows = (await sql.query(
    `SELECT campaign.id, campaign.status, campaign.sent_at,
            COALESCE(campaign.batch_size, 0)::int AS batch_size,
            COALESCE(campaign.batch_delay_seconds, 0)::int AS batch_delay,
            COALESCE(campaign.estimated_send_duration_seconds, 0)::int
              AS estimated_duration,
            (SELECT COUNT(*) FROM contact_campaign_messages
              WHERE campaign_id = campaign.id)::int AS total_recipients,
            (SELECT COUNT(*) FROM contact_campaign_messages
              WHERE campaign_id = campaign.id
                AND status IN ('sent', 'delivered', 'opened', 'clicked'))::int
              AS sent_count,
            (SELECT COUNT(*) FROM contact_campaign_messages
              WHERE campaign_id = campaign.id
                AND status IN ('failed', 'bounced', 'hard_bounce', 'complained'))::int AS failed_count,
            (SELECT COUNT(*) FROM contact_campaign_messages
              WHERE campaign_id = campaign.id
                AND status IN ('queued', 'processing', 'sending'))::int
              AS pending_count,
            (SELECT COUNT(*) FROM campaign_send_batches
              WHERE campaign_id = campaign.id)::int AS batches_total,
            (SELECT COUNT(*) FROM campaign_send_batches
              WHERE campaign_id = campaign.id AND status = 'sent')::int
              AS batches_sent,
            (SELECT MIN(scheduled_for) FROM campaign_send_batches
              WHERE campaign_id = campaign.id AND status IN ('pending', 'queued'))
              AS next_batch_at,
            (SELECT MIN(dispatched_at) FROM campaign_send_batches
              WHERE campaign_id = campaign.id AND dispatched_at IS NOT NULL)
              AS started_at
     FROM contact_campaigns campaign
     WHERE campaign.id = $1 AND campaign.user_id = $2
     LIMIT 1`,
    [campaignId, userId],
  )) as DatabaseRow[];
  const row = rows[0];
  if (!row) {
    throw new CampaignDispatchError("That campaign is not available.", 404);
  }
  return {
    campaignId: asString(row.id),
    status: asString(row.status),
    batchSize: asNumber(row.batch_size),
    batchDelaySeconds: asNumber(row.batch_delay),
    estimatedSendDurationSeconds: asNumber(row.estimated_duration),
    totalRecipients: asNumber(row.total_recipients),
    sent: asNumber(row.sent_count),
    failed: asNumber(row.failed_count),
    pending: asNumber(row.pending_count),
    batchesTotal: asNumber(row.batches_total),
    batchesSent: asNumber(row.batches_sent),
    nextBatchAt: row.next_batch_at ? String(row.next_batch_at) : null,
    startedAt: row.started_at ? String(row.started_at) : null,
    completedAt: row.sent_at ? String(row.sent_at) : null,
  };
}

/** Halts a send: pending waves stop, anything already dispatched stands. */
export async function pauseCampaignBatches(campaignId: string) {
  const rows = (await database().query(
    `UPDATE campaign_send_batches
     SET status = 'paused', updated_at = NOW()
     WHERE campaign_id = $1 AND status IN ('pending', 'queued')
     RETURNING id`,
    [campaignId],
  )) as DatabaseRow[];
  return rows.length;
}

/**
 * Restarts a paused send. Remaining waves are re-timed from now so the pause
 * does not compress the rest of the campaign into an unpaced burst.
 */
export async function resumeCampaignBatches(
  campaignId: string,
  startAt: Date = new Date(),
) {
  const sql = database();
  const paused = (await sql.query(
    `SELECT id FROM campaign_send_batches
     WHERE campaign_id = $1 AND status = 'paused'
     ORDER BY batch_number`,
    [campaignId],
  )) as DatabaseRow[];
  if (!paused.length) return 0;

  const delayRows = (await sql.query(
    `SELECT COALESCE(batch_delay_seconds, 60)::int AS delay
     FROM contact_campaigns WHERE id = $1 LIMIT 1`,
    [campaignId],
  )) as DatabaseRow[];
  const delay = Math.max(0, asNumber(delayRows[0]?.delay) || 60);

  for (let index = 0; index < paused.length; index += 1) {
    const scheduledFor = new Date(
      startAt.getTime() + index * delay * 1_000,
    ).toISOString();
    await sql.query(
      `UPDATE campaign_send_batches
       SET status = 'pending', scheduled_for = $2::timestamptz,
           updated_at = NOW()
       WHERE id = $1`,
      [asString(paused[index].id), scheduledFor],
    );
  }
  await sql.query(
    `UPDATE contact_campaign_messages
     SET status = 'queued', updated_at = NOW()
     WHERE campaign_id = $1
       AND status = 'cancelled'
       AND batch_id IS NOT NULL`,
    [campaignId],
  );
  return paused.length;
}

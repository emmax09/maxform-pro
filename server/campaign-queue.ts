import {
  enqueueBulkJobs,
  enqueueJob,
  queueAvailable,
  QUEUE_NAMES,
  type CampaignDeliveryJob,
  type CampaignMetricsJob,
  type CampaignOrchestratorJob,
  type CampaignWebhookJob,
  type EmailDeadLetterJob,
  type ToSendWebhookJob,
  type TransactionalEmailJob,
} from "../src/lib/queue/queues";
import { createCampaignDatabase } from "./campaign-database";

type DatabaseRow = Record<string, unknown>;

export class CampaignQueueError extends Error {
  constructor(
    message: string,
    readonly status = 503,
    readonly code = "campaign_queue_unavailable",
  ) {
    super(message);
  }
}

const database = () => {
  const url = String(process.env.DATABASE_URL || "").trim();
  if (!url) throw new CampaignQueueError("The campaign queue database is unavailable.");
  return createCampaignDatabase(url);
};

const uuid = (value: unknown) => {
  const candidate = String(value ?? "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)
    ? candidate
    : "";
};

const delayUntil = (value?: Date | string | null) => {
  if (!value) return 0;
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : 0;
};

const requireQueueIfConfigured = () => {
  if (queueAvailable()) return true;
  const required = process.env.QUEUE_REQUIRED === "true" || process.env.NODE_ENV === "production";
  if (required) {
    throw new CampaignQueueError(
      "Campaign delivery is not configured. Set the Upstash Redis TCP credentials before enabling production sending.",
    );
  }
  return false;
};

export const campaignQueueConfigured = queueAvailable;

export const enqueueCampaignOrchestratorJob = async (input: {
  campaignId: string;
  workspaceId: string;
  reason: CampaignOrchestratorJob["reason"];
  runAt?: Date | string | null;
}) => {
  const campaignId = uuid(input.campaignId);
  const workspaceId = uuid(input.workspaceId);
  if (!campaignId || !workspaceId) throw new CampaignQueueError("The campaign queue payload is invalid.", 400, "invalid_queue_payload");
  if (!requireQueueIfConfigured()) return { enqueued: false, jobId: null as string | null };
  const job = await enqueueJob<CampaignOrchestratorJob>(
    QUEUE_NAMES.orchestrator,
    "orchestrate-campaign",
    { campaignId, workspaceId, reason: input.reason },
    {
      delay: delayUntil(input.runAt),
      priority: 10,
      jobId: `campaign-orchestrator-${campaignId}-${input.reason}-${new Date(input.runAt || Date.now()).getTime()}`,
    },
  );
  return { enqueued: Boolean(job), jobId: job?.id || null };
};

export const enqueueCampaignDeliveryJob = async (input: CampaignDeliveryJob & { runAt?: Date | string | null }) => {
  const batchId = uuid(input.batchId);
  const campaignId = uuid(input.campaignId);
  const workspaceId = uuid(input.workspaceId);
  if (!batchId || !campaignId || !workspaceId) throw new CampaignQueueError("The delivery queue payload is invalid.", 400, "invalid_queue_payload");
  if (!requireQueueIfConfigured()) return { enqueued: false, jobId: null as string | null };
  const job = await enqueueJob<CampaignDeliveryJob>(
    QUEUE_NAMES.delivery,
    "deliver-campaign-batch",
    { batchId, campaignId, workspaceId },
    {
      delay: delayUntil(input.runAt),
      priority: 10,
      jobId: `campaign-delivery-${batchId}`,
    },
  );
  return { enqueued: Boolean(job), jobId: job?.id || null };
};

/** Enqueue all durable waves for a campaign after the orchestrator validates it. */
export const enqueueCampaignBatches = async (campaignId: string, workspaceId: string) => {
  const campaign = uuid(campaignId);
  const workspace = uuid(workspaceId);
  if (!campaign || !workspace) throw new CampaignQueueError("The campaign queue payload is invalid.", 400, "invalid_queue_payload");
  if (!requireQueueIfConfigured()) return { enqueued: 0 };
  const rows = (await database().query(
    `SELECT batch.id, batch.scheduled_for
     FROM campaign_send_batches batch
     JOIN contact_campaigns campaign ON campaign.id = batch.campaign_id
     WHERE batch.campaign_id = $1::uuid
       AND campaign.user_id = $2::uuid
       AND batch.status = 'pending'
     ORDER BY batch.batch_number`,
    [campaign, workspace],
  )) as DatabaseRow[];
  const jobs = rows.map((row) => ({
    name: "deliver-campaign-batch",
    data: {
      batchId: String(row.id),
      campaignId: campaign,
      workspaceId: workspace,
    } satisfies CampaignDeliveryJob,
      opts: {
        delay: delayUntil(row.scheduled_for ? String(row.scheduled_for) : null),
        priority: 10,
        jobId: `campaign-delivery-${String(row.id)}`,
    },
  }));
  const added = await enqueueBulkJobs(QUEUE_NAMES.delivery, jobs);
  if (added.length) {
    await database().query(
      `UPDATE campaign_send_batches
       SET status = 'queued', queue_job_id = 'campaign-delivery-' || id::text,
           updated_at = NOW()
       WHERE id = ANY($1::uuid[]) AND status = 'pending'`,
      [rows.map((row) => String(row.id))],
    );
  }
  return { enqueued: added.length };
};

export const enqueueCampaignMetricsJob = async (input: CampaignMetricsJob = {}) => {
  if (!requireQueueIfConfigured()) return { enqueued: false, jobId: null as string | null };
  // Coalesce analytics kicks within one minute. A job id that includes every
  // millisecond would turn a busy webhook stream into an unbounded queue even
  // though one rebuild sees all events that arrived during that window.
  const minute = Math.floor(Date.now() / 60_000);
  const job = await enqueueJob<CampaignMetricsJob>(
    QUEUE_NAMES.metrics,
    "rebuild-campaign-metrics",
    input,
    {
      priority: 20,
      jobId: `campaign-metrics-${input.campaignId || "all"}-${minute}`,
    },
  );
  return { enqueued: Boolean(job), jobId: job?.id || null };
};

export const enqueueCampaignWebhookJob = async (input: CampaignWebhookJob) => {
  if (!requireQueueIfConfigured()) return { enqueued: false, jobId: null as string | null };
  const eventKey = input.providerEventId || `${input.provider}:${input.providerMessageId}:${input.status}:${input.destination || ""}`;
  const job = await enqueueJob<CampaignWebhookJob>(
    QUEUE_NAMES.webhooks,
    "process-provider-event",
    input,
    { jobId: `campaign-webhook-${eventKey.slice(0, 180)}` },
  );
  return { enqueued: Boolean(job), jobId: job?.id || null };
};

/**
 * Replays webhook rows that were accepted by the HTTP endpoint while Redis or
 * the worker was unavailable. The database row is the durable outbox; the
 * BullMQ job is only the delivery mechanism for that outbox.
 */
export const enqueuePendingCampaignWebhookEvents = async (limit = 100) => {
  if (!requireQueueIfConfigured()) return { enqueued: 0 };
  const rows = (await database().query(
    `SELECT id, workspace_id, provider, provider_event_id,
            provider_message_id, event_type, destination
     FROM campaign_webhook_events
     WHERE processed_at IS NULL
     ORDER BY created_at
     LIMIT $1`,
    [Math.max(1, Math.min(500, Math.floor(limit) || 100))],
  )) as DatabaseRow[];
  const jobs = rows.map((row) => ({
    name: "process-provider-event",
    data: {
      webhookEventId: String(row.id),
      workspaceId: String(row.workspace_id),
      provider: String(row.provider),
      providerEventId: String(row.provider_event_id),
      providerMessageId: String(row.provider_message_id),
      status: String(row.event_type) as CampaignWebhookJob["status"],
      destination: String(row.destination || ""),
    } satisfies CampaignWebhookJob,
    opts: { jobId: `campaign-webhook-${String(row.id)}` },
  }));
  const added = await enqueueBulkJobs(QUEUE_NAMES.webhooks, jobs);
  return { enqueued: added.length };
};

export const enqueueTransactionalEmailJob = async (logId: string, runAt?: Date | string | null) => {
  const id = uuid(logId);
  if (!id) return { enqueued: false, jobId: null as string | null };
  if (!requireQueueIfConfigured()) return { enqueued: false, jobId: null as string | null };
  const job = await enqueueJob<TransactionalEmailJob>(
    QUEUE_NAMES.transactional,
    "deliver-transactional-email",
    { logId: id },
    { delay: delayUntil(runAt), priority: 1, jobId: `transactional-email-${id}` },
  );
  return { enqueued: Boolean(job), jobId: job?.id || null };
};

export const enqueueToSendWebhookJob = async (webhookEventId: string) => {
  const id = uuid(webhookEventId);
  if (!id) throw new CampaignQueueError("The email webhook payload is invalid.", 400, "invalid_webhook_payload");
  if (!requireQueueIfConfigured()) return { enqueued: false, jobId: null as string | null };
  const job = await enqueueJob<ToSendWebhookJob>(
    QUEUE_NAMES.webhooks,
    "process-tosend-webhook",
    { webhookEventId: id },
    { priority: 2, jobId: `tosend-webhook-${id}` },
  );
  return { enqueued: Boolean(job), jobId: job?.id || null };
};

export const enqueueEmailDeadLetterJob = async (input: EmailDeadLetterJob) => {
  if (!requireQueueIfConfigured()) return { enqueued: false, jobId: null as string | null };
  const jobId = `dead-letter-${input.originalQueue}-${input.originalJobId}`.slice(0, 220);
  const job = await enqueueJob<EmailDeadLetterJob>(
    QUEUE_NAMES.deadLetter,
    "record-email-dead-letter",
    input,
    { attempts: 1, priority: 1, jobId },
  );
  return { enqueued: Boolean(job), jobId: job?.id || null };
};

import { QueueEvents, Worker, type Job } from "bullmq";
import { randomUUID } from "node:crypto";

import {
  QUEUE_NAMES,
  LEGACY_QUEUE_NAMES,
  type CampaignDeliveryJob,
  type CampaignMetricsJob,
  type CampaignOrchestratorJob,
  type CampaignWebhookJob,
  type EmailDeadLetterJob,
  type ToSendWebhookJob,
  type TransactionalEmailJob,
} from "../src/lib/queue/queues";
import { getQueueRedis, closeQueueRedis } from "../src/lib/queue/redis";
import {
  enqueueCampaignBatches,
  enqueueEmailDeadLetterJob,
  enqueuePendingCampaignWebhookEvents,
} from "./campaign-queue";
import { dispatchCampaignBatch } from "./campaign-dispatch";
import { processCampaignAnalyticsEvents } from "./campaign-analytics-engine";
import { recordCampaignMessageEvent } from "./campaign-tracking";
import { deliverWorkspaceEmail, processToSendWebhookEvent } from "./workspace-email";
import { createCampaignDatabase } from "./campaign-database";

type DatabaseRow = Record<string, unknown>;
type QueueWorker = Worker;

const prefix = () => String(process.env.QUEUE_PREFIX || "maxform").trim() || "maxform";
const concurrency = (name: string, fallback: number) => Math.max(
  1,
  Math.min(100, Math.floor(Number(process.env[name] || fallback))),
);

const database = () => {
  const url = String(process.env.DATABASE_URL || "").trim();
  if (!url) throw new Error("Campaign worker database is unavailable.");
  return createCampaignDatabase(url);
};

const campaignOrchestrator = async (job: Job<CampaignOrchestratorJob>) => {
  const { campaignId, workspaceId } = job.data;
  const rows = (await database().query(
    `SELECT id, status, scheduled_at
     FROM contact_campaigns
     WHERE id = $1::uuid AND user_id = $2::uuid
       AND status IN ('scheduled', 'queued', 'sending')
     LIMIT 1`,
    [campaignId, workspaceId],
  )) as DatabaseRow[];
  if (!rows[0]) return { ignored: true, reason: "campaign_not_active" };
  const result = await enqueueCampaignBatches(campaignId, workspaceId);
  await database().query(
    `UPDATE contact_campaigns
     SET status = CASE WHEN status = 'scheduled' THEN 'queued' ELSE status END,
         updated_at = NOW()
     WHERE id = $1::uuid AND user_id = $2::uuid
       AND status IN ('scheduled', 'queued')`,
    [campaignId, workspaceId],
  );
  return result;
};

const campaignDelivery = async (job: Job<CampaignDeliveryJob>) => {
  const result = await dispatchCampaignBatch(job.data.batchId);
  return result || { ignored: true, reason: "batch_already_claimed_or_not_due" };
};

const campaignWebhook = async (job: Job<CampaignWebhookJob>) => {
  try {
    // The HTTP receiver also applies this transition for a fast response, but
    // the durable outbox worker must be able to complete it after a web
    // process dies between persistence and enqueueing.
    await database().query(
      `UPDATE email_logs
       SET status = CASE
         WHEN status IN ('bounced', 'complained') THEN status
         WHEN $1 = 'delivered' AND status IN ('opened', 'clicked') THEN status
         WHEN $1 = 'opened' AND status = 'clicked' THEN status
         ELSE $1
       END,
       provider_response = jsonb_set(
         COALESCE(provider_response, '{}'::jsonb),
         '{delivery_event}',
         jsonb_build_object('status', $1, 'receivedAt', NOW()),
         TRUE
       ),
       updated_at = NOW()
       WHERE user_id = $2::uuid
         AND provider = $3
         AND trim(BOTH '<>' FROM provider_message_id) = trim(BOTH '<>' FROM $4)`,
      [
        job.data.status,
        job.data.workspaceId,
        job.data.provider,
        job.data.providerMessageId,
      ],
    );
    const result = await recordCampaignMessageEvent({
      providerMessageId: job.data.providerMessageId,
      providerEventId: job.data.providerEventId,
      status: job.data.status,
      userId: job.data.workspaceId,
      provider: job.data.provider,
      source: "provider",
      destination: job.data.destination,
    });
    if (job.data.webhookEventId) {
      await database().query(
        `UPDATE campaign_webhook_events
         SET processed_at = NOW(), attempts = attempts + 1,
             processing_error = '', updated_at = NOW()
         WHERE id = $1::uuid`,
        [job.data.webhookEventId],
      );
    }
    return result;
  } catch (error) {
    if (job.data.webhookEventId) {
      await database().query(
        `UPDATE campaign_webhook_events
         SET attempts = attempts + 1, processing_error = $2,
             updated_at = NOW()
         WHERE id = $1::uuid`,
        [
          job.data.webhookEventId,
          error instanceof Error ? error.message.slice(0, 1_000) : String(error).slice(0, 1_000),
        ],
      ).catch(() => undefined);
    }
    throw error;
  }
};

const toSendWebhook = async (job: Job<ToSendWebhookJob>) =>
  processToSendWebhookEvent(job.data.webhookEventId);

const emailWebhook = async (job: Job<CampaignWebhookJob | ToSendWebhookJob>) => {
  if (job.name === "process-tosend-webhook") {
    return toSendWebhook(job as Job<ToSendWebhookJob>);
  }
  return campaignWebhook(job as Job<CampaignWebhookJob>);
};

const campaignMetrics = async (job: Job<CampaignMetricsJob>) =>
  processCampaignAnalyticsEvents({
    limit: 5_000,
    campaignId: job.data.campaignId,
    workspaceId: job.data.workspaceId,
  });

const transactionalEmail = async (job: Job<TransactionalEmailJob>) => {
  await deliverWorkspaceEmail(job.data.logId);
  return { logId: job.data.logId };
};

const emailDeadLetter = async (job: Job<EmailDeadLetterJob>) => {
  const data = job.data;
  await database().query(
    `INSERT INTO email_dead_letter_events (
       job_id, queue_name, provider, workspace_id, campaign_id,
       recipient_id, attempts, error_category, error_message, payload
     ) VALUES ($1, $2, $3, NULLIF($4, '')::uuid, NULLIF($5, '')::uuid,
              NULLIF($6, '')::uuid, 1, $7, $8, $9::jsonb)
     ON CONFLICT (queue_name, job_id) DO UPDATE SET
       attempts = email_dead_letter_events.attempts + 1,
       error_category = EXCLUDED.error_category,
       error_message = EXCLUDED.error_message,
       payload = EXCLUDED.payload`,
    [
      data.originalJobId,
      data.originalQueue,
      data.provider || "",
      data.workspaceId || "",
      data.campaignId || "",
      data.recipientId || "",
      data.errorCategory || "worker_attempts_exhausted",
      (data.errorMessage || "Email job permanently failed.").slice(0, 1_000),
      JSON.stringify(data.payload || {}),
    ],
  );
  console.error("[email-worker] dead-lettered email job", {
    queue: data.originalQueue,
    jobId: data.originalJobId,
    provider: data.provider || "",
  });
  return { recorded: true };
};

const markPermanentlyFailed = async (job: Job, error: Error) => {
  if (job.name === "orchestrate-campaign") {
    const data = job.data as Partial<CampaignOrchestratorJob>;
    if (!data.campaignId || !data.workspaceId) return;
    await database().query(
      `UPDATE contact_campaigns
       SET status = 'failed', updated_at = NOW()
       WHERE id = $1::uuid AND user_id = $2::uuid
         AND status IN ('scheduled', 'queued', 'sending')`,
      [data.campaignId, data.workspaceId],
    );
    return;
  }
  if (job.name === "deliver-transactional-email") {
    const data = job.data as Partial<TransactionalEmailJob>;
    if (data.logId) {
      await database().query(
        `UPDATE email_logs
         SET status = 'failed', last_error = $2,
             provider_error_detail = 'worker_attempts_exhausted', updated_at = NOW()
         WHERE id = $1::uuid AND status IN ('queued', 'sending')`,
        [data.logId, error.message.slice(0, 1_000)],
      );
    }
    return;
  }
  if (job.name === "process-tosend-webhook") {
    const data = job.data as Partial<ToSendWebhookJob>;
    if (data.webhookEventId) {
      await database().query(
        `UPDATE email_provider_webhook_events
         SET attempts = attempts + 1, processing_error = $2, updated_at = NOW()
         WHERE id = $1::uuid AND processed_at IS NULL`,
        [data.webhookEventId, error.message.slice(0, 1_000)],
      );
    }
    return;
  }
  if (job.name !== "deliver-campaign-batch") return;
  const data = job.data as Partial<CampaignDeliveryJob>;
  if (!data.batchId) return;
  await database().query(
    `UPDATE campaign_send_batches
     SET status = 'failed', last_error = $2, completed_at = COALESCE(completed_at, NOW()), updated_at = NOW()
     WHERE id = $1::uuid AND status IN ('pending', 'queued', 'sending')`,
    [data.batchId, error.message.slice(0, 1_000)],
  );
  if (data.campaignId) {
    await database().query(
      `UPDATE contact_campaigns
       SET status = 'failed', updated_at = NOW()
       WHERE id = $1::uuid AND status IN ('queued', 'sending', 'scheduled')`,
      [data.campaignId],
    );
  }
};

const attachFailureLogging = (worker: QueueWorker) => {
  worker.on("failed", (job, error) => {
    if (!job) return;
    const attempts = Number(job.opts.attempts || 1);
    console.error("[campaign-worker] job failed", {
      queue: worker.name,
      jobId: job.id,
      attemptsMade: job.attemptsMade,
      attempts,
      type: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
    });
    if (job.attemptsMade >= attempts) {
      const failure = error instanceof Error ? error : new Error(String(error));
      void markPermanentlyFailed(job, failure)
        .then(() => enqueueEmailDeadLetterJob({
          originalQueue: worker.name,
          originalJobId: String(job.id || "unknown"),
          provider: typeof (job.data as { provider?: unknown })?.provider === "string" ? String((job.data as { provider?: unknown }).provider) : "",
          workspaceId: typeof (job.data as { workspaceId?: unknown })?.workspaceId === "string" ? String((job.data as { workspaceId?: unknown }).workspaceId) : "",
          campaignId: typeof (job.data as { campaignId?: unknown })?.campaignId === "string" ? String((job.data as { campaignId?: unknown }).campaignId) : "",
          recipientId: typeof (job.data as { recipientId?: unknown })?.recipientId === "string" ? String((job.data as { recipientId?: unknown }).recipientId) : "",
          errorCategory: failure.name,
          errorMessage: failure.message.slice(0, 1_000),
          payload: job.data as Record<string, unknown>,
        })).catch(() => undefined);
    }
  });
};

export const startCampaignWorkers = () => {
  const connection = getQueueRedis();
  if (!connection) {
    throw new Error(
      "BullMQ workers require REDIS_URL or the split UPSTASH_REDIS_HOST, UPSTASH_REDIS_PORT, and UPSTASH_REDIS_PASSWORD configuration.",
    );
  }
  const options = { connection, prefix: prefix() };
  const workers: QueueWorker[] = [
    new Worker(QUEUE_NAMES.orchestrator, campaignOrchestrator, {
      ...options,
      concurrency: concurrency("CAMPAIGN_ORCHESTRATOR_CONCURRENCY", 2),
    }),
    new Worker(QUEUE_NAMES.delivery, campaignDelivery, {
      ...options,
      concurrency: concurrency("CAMPAIGN_DELIVERY_CONCURRENCY", 5),
    }),
    new Worker(QUEUE_NAMES.webhooks, emailWebhook, {
      ...options,
      concurrency: concurrency("EMAIL_WEBHOOK_CONCURRENCY", 10),
    }),
    new Worker(QUEUE_NAMES.metrics, campaignMetrics, {
      ...options,
      concurrency: concurrency("CAMPAIGN_METRICS_CONCURRENCY", 1),
    }),
    new Worker(QUEUE_NAMES.transactional, transactionalEmail, {
      ...options,
      concurrency: concurrency("TRANSACTIONAL_EMAIL_CONCURRENCY", 10),
    }),
    new Worker(QUEUE_NAMES.deadLetter, emailDeadLetter, {
      ...options,
      concurrency: concurrency("EMAIL_DEAD_LETTER_CONCURRENCY", 2),
    }),
  ];
  // Drain jobs created before the queue namespace was prefixed with
  // email-. This keeps rolling deployments lossless while all new jobs use
  // the production queue names above.
  workers.push(
    new Worker(LEGACY_QUEUE_NAMES.orchestrator, campaignOrchestrator, { ...options, concurrency: concurrency("CAMPAIGN_ORCHESTRATOR_CONCURRENCY", 2) }),
    new Worker(LEGACY_QUEUE_NAMES.delivery, campaignDelivery, { ...options, concurrency: concurrency("CAMPAIGN_DELIVERY_CONCURRENCY", 5) }),
    new Worker(LEGACY_QUEUE_NAMES.webhooks, campaignWebhook, { ...options, concurrency: concurrency("CAMPAIGN_WEBHOOK_CONCURRENCY", 10) }),
    new Worker(LEGACY_QUEUE_NAMES.metrics, campaignMetrics, { ...options, concurrency: concurrency("CAMPAIGN_METRICS_CONCURRENCY", 1) }),
    new Worker(LEGACY_QUEUE_NAMES.transactional, transactionalEmail, { ...options, concurrency: concurrency("TRANSACTIONAL_EMAIL_CONCURRENCY", 10) }),
  );
  const queueEvents = Array.from(new Set(Object.values(QUEUE_NAMES))).map(
    (name) => new QueueEvents(name, options),
  );
  queueEvents.forEach((events) => {
    events.on("error", (error) => {
      console.error("[campaign-worker] queue events error", {
        queue: events.name,
        type: error instanceof Error ? error.name : typeof error,
      });
    });
  });
  const workerId = `email-worker-${process.pid}-${randomUUID()}`;
  const heartbeat = async () => {
    await database().query(
      `INSERT INTO email_worker_heartbeats (worker_id, queue_name, last_seen_at, metadata)
       VALUES ($1, $2, NOW(), $3::jsonb)
       ON CONFLICT (worker_id) DO UPDATE SET last_seen_at = NOW(), metadata = EXCLUDED.metadata`,
      [workerId, "email", JSON.stringify({ queues: Object.values(QUEUE_NAMES) })],
    ).catch(() => undefined);
  };
  void heartbeat();
  const heartbeatTimer = setInterval(() => void heartbeat(), 30_000);
  heartbeatTimer.unref?.();
  workers.forEach(attachFailureLogging);
  workers.forEach((worker) => {
    worker.on("error", (error) => {
      console.error("[campaign-worker] worker error", {
        queue: worker.name,
        type: error instanceof Error ? error.name : typeof error,
        message: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
      });
    });
  });
  return {
    workers,
    close: async () => {
      clearInterval(heartbeatTimer);
      await Promise.all(workers.map((worker) => worker.close().catch(() => undefined)));
      await Promise.all(queueEvents.map((events) => events.close().catch(() => undefined)));
      await database().query(`DELETE FROM email_worker_heartbeats WHERE worker_id = $1`, [workerId]).catch(() => undefined);
      await closeQueueRedis();
    },
  };
};

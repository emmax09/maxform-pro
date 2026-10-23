import { Queue, type JobsOptions } from "bullmq";

import { getQueueRedis, queueRedisConfigured } from "./redis";

export const QUEUE_NAMES = {
  transactional: "email-transactional",
  orchestrator: "email-campaign-orchestrator",
  delivery: "email-campaign-delivery",
  webhooks: "email-webhook-processing",
  metrics: "email-metrics",
  deadLetter: "email-dead-letter",
  workflow: "workspace-workflows",
} as const;

/** Names used before the centralized email queue namespace was introduced. */
export const LEGACY_QUEUE_NAMES = {
  orchestrator: "campaign-orchestrator",
  delivery: "campaign-delivery",
  webhooks: "campaign-webhooks",
  metrics: "campaign-metrics",
  transactional: "transactional-email",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export type CampaignOrchestratorJob = {
  campaignId: string;
  workspaceId: string;
  reason: "scheduled" | "send_now" | "resume" | "retry";
};

export type CampaignDeliveryJob = {
  batchId: string;
  campaignId: string;
  workspaceId: string;
};

export type CampaignWebhookJob = {
  webhookEventId?: string;
  workspaceId: string;
  provider: string;
  providerMessageId: string;
  providerEventId?: string;
  status: "delivered" | "opened" | "clicked" | "bounced" | "complained";
  destination?: string;
};

export type CampaignMetricsJob = {
  campaignId?: string;
  workspaceId?: string;
};

export type TransactionalEmailJob = {
  logId: string;
};

export type ToSendWebhookJob = {
  webhookEventId: string;
};

export type EmailDeadLetterJob = {
  originalQueue: string;
  originalJobId: string;
  provider?: string;
  workspaceId?: string;
  campaignId?: string;
  recipientId?: string;
  errorCategory?: string;
  errorMessage?: string;
  payload?: Record<string, unknown>;
};

export type WorkflowExecutionJob = {
  executionId: string;
  workspaceId: string;
};

export type WorkflowEventJob = {
  eventId: string;
  workspaceId: string;
};

const queues = new Map<string, Queue>();

const prefix = () => String(process.env.QUEUE_PREFIX || "maxform").trim() || "maxform";

const defaultJobOptions = (): JobsOptions => ({
  attempts: Math.max(1, Math.min(10, Number(process.env.QUEUE_MAX_ATTEMPTS || 5))),
  backoff: {
    type: "exponential",
    delay: Math.max(1_000, Number(process.env.QUEUE_RETRY_DELAY_MS || 30_000)),
  },
  removeOnComplete: { age: 24 * 60 * 60, count: 10_000 },
  removeOnFail: { age: 7 * 24 * 60 * 60, count: 50_000 },
});

export const getQueue = (name: QueueName) => {
  if (!queueRedisConfigured()) return null;
  const existing = queues.get(name);
  if (existing) return existing;
  const connection = getQueueRedis();
  if (!connection) return null;
  const queue = new Queue(name, {
    connection,
    prefix: prefix(),
    defaultJobOptions: defaultJobOptions(),
  });
  queues.set(name, queue);
  return queue;
};

export const queueAvailable = () => queueRedisConfigured();

export const closeQueues = async () => {
  const active = Array.from(queues.values());
  queues.clear();
  await Promise.all(active.map((queue) => queue.close().catch(() => undefined)));
};

export const enqueueJob = async <Payload extends object>(
  name: QueueName,
  jobName: string,
  payload: Payload,
  options: JobsOptions = {},
) => {
  const queue = getQueue(name);
  if (!queue) return null;
  return queue.add(jobName, payload, {
    ...defaultJobOptions(),
    ...options,
  });
};

export const enqueueBulkJobs = async <Payload extends object>(
  name: QueueName,
  jobs: Array<{ name: string; data: Payload; opts?: JobsOptions }>,
) => {
  const queue = getQueue(name);
  if (!queue || !jobs.length) return [];
  return queue.addBulk(
    jobs.map((job) => ({
      name: job.name,
      data: job.data,
      opts: { ...defaultJobOptions(), ...(job.opts || {}) },
    })),
  );
};

import { Worker, type Job } from "bullmq";

import { QUEUE_NAMES, type WorkflowEventJob, type WorkflowExecutionJob } from "../src/lib/queue/queues";
import { closeQueueRedis, getQueueRedis } from "../src/lib/queue/redis";
import { processWorkflowEvent, runStoredWorkflowExecution } from "./workflows-data";

type WorkflowJob = WorkflowEventJob | WorkflowExecutionJob;

export const startWorkflowWorkers = () => {
  const connection = getQueueRedis();
  if (!connection) {
    throw new Error("Workflow workers require REDIS_URL or the split Upstash Redis TCP credentials.");
  }
  const worker = new Worker<WorkflowJob>(
    QUEUE_NAMES.workflow,
    async (job: Job<WorkflowJob>) => {
      if (job.name === "dispatch-workflow-event") {
        const data = job.data as WorkflowEventJob;
        return processWorkflowEvent(data.eventId, data.workspaceId);
      }
      const data = job.data as WorkflowExecutionJob;
      return runStoredWorkflowExecution(data.workspaceId, data.executionId);
    },
    {
      connection,
      prefix: String(process.env.QUEUE_PREFIX || "maxform").trim() || "maxform",
      concurrency: Math.max(1, Math.min(25, Number(process.env.WORKFLOW_WORKER_CONCURRENCY || 5))),
      limiter: { max: 100, duration: 1_000 },
    },
  );
  worker.on("completed", (job) => {
    console.info("[workflow-worker] completed", { jobId: job.id, name: job.name });
  });
  worker.on("failed", (job, error) => {
    console.error("[workflow-worker] failed", {
      jobId: job?.id,
      name: job?.name,
      type: error.name,
      message: error.message,
    });
  });
  worker.on("error", (error) => {
    console.error("[workflow-worker] worker error", { type: error.name, message: error.message });
  });
  return {
    workers: [worker],
    close: async () => {
      await worker.close().catch(() => undefined);
      await closeQueueRedis();
    },
  };
};

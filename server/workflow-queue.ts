import {
  enqueueJob,
  queueAvailable,
  QUEUE_NAMES,
  type WorkflowEventJob,
  type WorkflowExecutionJob,
} from "../src/lib/queue/queues";

export const workflowQueueConfigured = queueAvailable;

export const enqueueWorkflowExecution = async (input: WorkflowExecutionJob, delay = 0) => {
  if (!queueAvailable()) return { enqueued: false, jobId: null as string | null };
  const job = await enqueueJob<WorkflowExecutionJob>(
    QUEUE_NAMES.workflow,
    "execute-workflow",
    input,
    {
      delay: Math.max(0, Math.min(86_400_000, Math.floor(delay))),
      priority: 5,
      jobId: `workflow-execution-${input.executionId}`,
    },
  );
  return { enqueued: Boolean(job), jobId: job?.id ? String(job.id) : null };
};

export const enqueueWorkflowEvent = async (input: WorkflowEventJob, delay = 0) => {
  if (!queueAvailable()) return { enqueued: false, jobId: null as string | null };
  const job = await enqueueJob<WorkflowEventJob>(
    QUEUE_NAMES.workflow,
    "dispatch-workflow-event",
    input,
    {
      delay: Math.max(0, Math.min(86_400_000, Math.floor(delay))),
      priority: 3,
      jobId: `workflow-event-${input.eventId}`,
    },
  );
  return { enqueued: Boolean(job), jobId: job?.id ? String(job.id) : null };
};

import { startWorkflowWorkers } from "../src/workers/workflow.worker";

const runtime = startWorkflowWorkers();
console.info("[workflow-worker] started", {
  queues: runtime.workers.map((worker) => worker.name),
});

const shutdown = async (signal: string) => {
  console.info(`[workflow-worker] shutting down after ${signal}`);
  await runtime.close();
  process.exit(0);
};

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

import { startCampaignWorkers } from "../src/workers/campaign.worker";

const runtime = startCampaignWorkers();
console.info("[campaign-worker] started", {
  queues: runtime.workers.map((worker) => worker.name),
});

const shutdown = async (signal: string) => {
  console.info(`[campaign-worker] shutting down after ${signal}`);
  await runtime.close();
  process.exit(0);
};

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));


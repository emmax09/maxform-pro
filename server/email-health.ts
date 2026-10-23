import type { IncomingMessage, ServerResponse } from "node:http";

import { getQueue, QUEUE_NAMES, type QueueName } from "../src/lib/queue/queues";
import { createCampaignDatabase } from "./campaign-database";

type JsonObject = Record<string, unknown>;

const text = (value: unknown, max = 500) => String(value ?? "").trim().slice(0, max);
const required = () => process.env.NODE_ENV === "production" || process.env.QUEUE_REQUIRED === "true";

const responseJson = (response: ServerResponse, status: number, value: JsonObject) => {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(JSON.stringify(value));
};

const secretFromRequest = (request: IncomingMessage) => {
  const authorization = request.headers.authorization;
  const bearer = Array.isArray(authorization) ? authorization[0] : authorization;
  if (bearer?.startsWith("Bearer ")) return bearer.slice(7).trim();
  const header = request.headers["x-email-health-secret"];
  return Array.isArray(header) ? header[0] || "" : String(header || "");
};

const database = () => {
  const url = text(process.env.DATABASE_URL, 2_000);
  if (!url) throw new Error("DATABASE_URL is not configured.");
  return createCampaignDatabase(url);
};

export const handleEmailHealth = async (request: IncomingMessage, response: ServerResponse) => {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return responseJson(response, 405, { error: "method_not_allowed" });
  }
  const configuredSecret = text(process.env.EMAIL_HEALTH_SECRET || process.env.EMAIL_WORKER_SECRET || process.env.CRON_SECRET, 500);
  if (!configuredSecret || secretFromRequest(request) !== configuredSecret) {
    return responseJson(response, 401, { error: "unauthorized" });
  }

  const checks: JsonObject = {};
  let databaseReady = false;
  let schemaReady = true;
  try {
    const sql = database();
    await sql.query("SELECT 1 AS ok");
    databaseReady = true;
    const [providers, campaigns, workers, deadLetters] = await Promise.all([
      sql.query(`SELECT COUNT(*)::int AS connected, COUNT(*) FILTER (WHERE health_ok = TRUE)::int AS healthy FROM email_provider_connections WHERE status = 'connected'`),
      sql.query(`SELECT COUNT(*) FILTER (WHERE status IN ('scheduled', 'queued', 'sending'))::int AS active FROM contact_campaigns`),
      sql.query(`SELECT COUNT(*) FILTER (WHERE last_seen_at >= NOW() - INTERVAL '2 minutes')::int AS live, MAX(last_seen_at) AS last_seen_at FROM email_worker_heartbeats`),
      sql.query(`SELECT COUNT(*) FILTER (WHERE resolved_at IS NULL)::int AS open FROM email_dead_letter_events`),
    ]).catch((error) => {
      schemaReady = false;
      console.error("[email-health] optional schema check failed", { type: error instanceof Error ? error.name : typeof error });
      return [[], [], [], []] as unknown as Array<JsonObject[]>;
    });
    checks.providers = providers[0] || { connected: 0, healthy: 0 };
    checks.campaigns = campaigns[0] || { active: 0 };
    checks.workers = workers[0] || { live: 0, last_seen_at: null };
    checks.deadLetters = deadLetters[0] || { open: 0 };
  } catch (error) {
    checks.databaseError = error instanceof Error ? error.name : "database_error";
  }

  const queues: JsonObject[] = [];
  let queueReady = true;
  for (const name of Object.values(QUEUE_NAMES)) {
    try {
      const queue = getQueue(name as QueueName);
      if (!queue) {
        queueReady = false;
        queues.push({ name, available: false });
        continue;
      }
      const counts = await queue.getJobCounts("waiting", "active", "delayed", "failed", "completed");
      queues.push({ name, available: true, counts });
    } catch (error) {
      queueReady = false;
      queues.push({ name, available: false, error: error instanceof Error ? error.name : "queue_error" });
    }
  }
  const workerReady = !required() || Number((checks.workers as JsonObject | undefined)?.live || 0) > 0;
  const ok = databaseReady && schemaReady && (!required() || queueReady) && workerReady;
  return responseJson(response, ok ? 200 : 503, {
    ok,
    checkedAt: new Date().toISOString(),
    required: required(),
    database: { ready: databaseReady, schemaReady },
    queue: { ready: queueReady, queues },
    ...checks,
  });
};

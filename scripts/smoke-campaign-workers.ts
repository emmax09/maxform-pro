import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";

import { neon, neonConfig } from "@neondatabase/serverless";

import { recordCampaignEvent } from "../server/campaign-analytics-engine";
import { enqueueCampaignMetricsJob } from "../server/campaign-queue";
import { closeQueueRedis } from "../src/lib/queue/redis";
import { closeQueues } from "../src/lib/queue/queues";

const databaseUrl = process.env.DATABASE_URL || "";
if (!databaseUrl) throw new Error("Worker smoke test requires DATABASE_URL.");

// The smoke test must not turn a transient DNS/connectivity blip into an
// orphaned disposable workspace. Production workers still rely on BullMQ's
// retry policy for database failures; this wrapper only hardens test setup and
// polling.
const nativeFetch = globalThis.fetch;
neonConfig.fetchFunction = async (input, init = {}) => {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await nativeFetch(input, {
        ...init,
        signal: init.signal || AbortSignal.timeout(15_000),
      });
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
};

const sql = neon(databaseUrl);
const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

type SmokeWorkspace = { userId: string; campaignId: string };

const cleanupWorkspace = async (workspace: SmokeWorkspace | null) => {
  if (!workspace) return;
  await sql.query(`DELETE FROM campaign_analytics_dead_letters WHERE workspace_id = $1`, [workspace.userId]);
  await sql.query(`DELETE FROM campaign_reputation_snapshots WHERE workspace_id = $1`, [workspace.userId]);
  await sql.query(`DELETE FROM campaign_provider_queue_state WHERE workspace_id = $1`, [workspace.userId]);
  await sql.query(`DELETE FROM company_settings WHERE user_id = $1`, [workspace.userId]);
  await sql.query(`DELETE FROM email_logs WHERE user_id = $1`, [workspace.userId]);
  await sql.query(`DELETE FROM email_settings WHERE user_id = $1`, [workspace.userId]);
  await sql.query(`DELETE FROM contact_campaigns WHERE user_id = $1`, [workspace.userId]);
  await sql.query(`DELETE FROM contacts WHERE created_by = $1`, [workspace.userId]);
  await sql.query(`DELETE FROM contact_lists WHERE user_id = $1`, [workspace.userId]);
  await sql.query(`DELETE FROM users WHERE id = $1`, [workspace.userId]);
};

const createQueuedMetricsJob = async (label: string): Promise<SmokeWorkspace & { jobId: string | null }> => {
  const suffix = randomUUID().replaceAll("-", "");
  const users = await sql.query(
    `INSERT INTO users (email, password_hash, full_name, short_id)
     VALUES ($1, 'campaign-worker-smoke', $2, $3) RETURNING id`,
    [`campaign-worker-${label}-${suffix}@example.test`, `Campaign Worker ${label}`, suffix.slice(0, 5)],
  );
  const userId = String(users[0].id);
  const lists = await sql.query(
    `INSERT INTO contact_lists (user_id, created_by, name, list_type)
     VALUES ($1, $1, $2, 'static') RETURNING id`,
    [userId, `Worker ${label} list`],
  );
  const contacts = await sql.query(
    `INSERT INTO contacts (created_by, full_name, email)
     VALUES ($1, $2, $3) RETURNING id`,
    [userId, `Worker ${label} contact`, `worker-${label}-${suffix}@example.test`],
  );
  const campaigns = await sql.query(
    `INSERT INTO contact_campaigns (user_id, name, list_id, subject, html_body, status)
     VALUES ($1, $2, $3, 'Worker smoke', '<p>Worker smoke</p>', 'sent') RETURNING id`,
    [userId, `Worker ${label} campaign`, String(lists[0].id)],
  );
  const campaignId = String(campaigns[0].id);
  const messages = await sql.query(
    `INSERT INTO contact_campaign_messages (campaign_id, contact_id, recipient, status, sent_at)
     VALUES ($1, $2, $3, 'sent', NOW()) RETURNING id`,
    [campaignId, String(contacts[0].id), `worker-${label}-${suffix}@example.test`],
  );
  await recordCampaignEvent({
    workspaceId: userId,
    campaignId,
    messageId: String(messages[0].id),
    eventType: "email_opened",
    source: "first_party",
    metadata: { smoke: label },
  });
  const queued = await enqueueCampaignMetricsJob({ workspaceId: userId, campaignId });
  await closeQueues();
  await closeQueueRedis();
  return { userId, campaignId, jobId: queued.jobId };
};

const processed = async (workspace: SmokeWorkspace) => {
  const rows = await sql.query(
    `SELECT processed_at FROM campaign_events
     WHERE workspace_id = $1 AND campaign_id = $2
     ORDER BY created_at DESC LIMIT 1`,
    [workspace.userId, workspace.campaignId],
  );
  return Boolean(rows[0]?.processed_at);
};

const waitForProcessed = async (workspace: SmokeWorkspace, timeoutMs = 45_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await processed(workspace)) return true;
    await wait(1_000);
  }
  return false;
};

const startWorker = async (label: string) => {
  const windows = process.platform === "win32";
  const child = spawn(
    windows ? (process.env.ComSpec || "cmd.exe") : "npm",
    windows ? ["/d", "/s", "/c", "npm run worker:campaigns"] : ["run", "worker:campaigns"],
    {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    },
  );
  const started = new Promise<void>((resolve, reject) => {
    let output = "";
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes("[campaign-worker] started")) resolve();
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== null && code !== 0) reject(new Error(`${label} exited before startup (${code}): ${output.slice(-500)}`));
    });
  });
  await Promise.race([
    started,
    wait(15_000).then(() => { throw new Error(`${label} did not report startup.`); }),
  ]);
  return child;
};

const stopWorker = async (child: ChildProcessWithoutNullStreams | null) => {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32" && child.pid) {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
      killer.once("exit", () => resolve());
      killer.once("error", () => resolve());
    });
  } else {
    child.kill("SIGTERM");
  }
  await wait(500);
};

let firstWorkspace: SmokeWorkspace | null = null;
let reconnectWorkspace: SmokeWorkspace | null = null;
let workerA: ChildProcessWithoutNullStreams | null = null;
let workerB: ChildProcessWithoutNullStreams | null = null;
let workerC: ChildProcessWithoutNullStreams | null = null;

try {
  [workerA, workerB] = await Promise.all([startWorker("worker-a"), startWorker("worker-b")]);
  firstWorkspace = await createQueuedMetricsJob("multi-instance");
  const multiInstanceProcessed = await waitForProcessed(firstWorkspace);
  if (!multiInstanceProcessed) throw new Error("Two worker instances did not process the metrics job.");

  await stopWorker(workerA);
  await stopWorker(workerB);
  workerA = null;
  workerB = null;

  reconnectWorkspace = await createQueuedMetricsJob("reconnect");
  await wait(2_000);
  if (await processed(reconnectWorkspace)) throw new Error("The reconnect job processed while all workers were stopped.");

  workerC = await startWorker("worker-reconnect");
  const reconnected = await waitForProcessed(reconnectWorkspace);
  if (!reconnected) throw new Error("A fresh worker did not process the queued reconnect job.");

  console.log("Campaign worker smoke passed: multi-instance consumption and restart recovery verified.");
} finally {
  await stopWorker(workerA);
  await stopWorker(workerB);
  await stopWorker(workerC);
  await cleanupWorkspace(firstWorkspace);
  await cleanupWorkspace(reconnectWorkspace);
  await closeQueues();
  await closeQueueRedis();
}

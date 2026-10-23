import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { dispatchDueCampaignBatches } from "./campaign-dispatch";
import { enqueuePendingCampaignWebhookEvents } from "./campaign-queue";

/**
 * The cron endpoint that drives campaign sending.
 *
 * Vercel calls this on a schedule; each call claims whichever waves are due and
 * sends them. It is deliberately the only way a wave goes out on a timer, so
 * pacing cannot be bypassed by hitting a user-facing route repeatedly.
 */

const json = (
  response: ServerResponse,
  status: number,
  value: Record<string, unknown>,
) => {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(JSON.stringify(value));
};

const digest = (value: string) => createHash("sha256").update(value).digest();

const matchesSecret = (supplied: string, expected: string) => {
  // Hashing first keeps the comparison constant-length; timingSafeEqual then
  // keeps it constant-time.
  const a = digest(supplied);
  const b = digest(expected);
  return timingSafeEqual(a, b);
};

/**
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Without a configured
 * secret the endpoint refuses to run rather than defaulting to open: an
 * unauthenticated dispatcher would let anyone drain a workspace's send quota.
 */
const authorized = (request: IncomingMessage) => {
  const expected = String(process.env.CRON_SECRET || "").trim();
  if (expected.length < 16) return false;
  const header = String(request.headers.authorization || "").trim();
  const supplied = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!supplied) return false;
  return matchesSecret(supplied, expected);
};

export async function handleCampaignDispatch(
  request: IncomingMessage,
  response: ServerResponse,
) {
  try {
    if (request.method !== "POST" && request.method !== "GET") {
      json(response, 405, {
        code: "method_not_allowed",
        error: "This dispatch method is not available.",
      });
      return;
    }
    if (!authorized(request)) {
      json(response, 401, {
        code: "dispatch_unauthorized",
        error: "This endpoint requires the scheduler credential.",
      });
      return;
    }
    const url = new URL(request.url || "/", "http://localhost");
    const requested = Number(url.searchParams.get("batches"));
    const webhooks = await enqueuePendingCampaignWebhookEvents(100);
    const result = await dispatchDueCampaignBatches(
      Number.isFinite(requested) && requested > 0 ? requested : 5,
    );
    json(response, 200, {
      dispatched: result.batchCount,
      batches: result.dispatched,
      webhooksQueued: webhooks.enqueued,
    });
  } catch (error) {
    console.error("[campaign-dispatch] unexpected failure", {
      type: error instanceof Error ? error.name : typeof error,
    });
    json(response, 500, {
      code: "dispatch_failed",
      error: "Campaign batches could not be dispatched.",
    });
  }
}

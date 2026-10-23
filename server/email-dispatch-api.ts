import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { drainQueuedWorkspaceEmails } from "./workspace-email";

const json = (response: ServerResponse, status: number, value: Record<string, unknown>) => {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(JSON.stringify(value));
};

const digest = (value: string) => createHash("sha256").update(value).digest();

const authorized = (request: IncomingMessage) => {
  const expected = String(process.env.EMAIL_WORKER_SECRET || process.env.CRON_SECRET || "").trim();
  if (expected.length < 16) return false;
  const header = String(request.headers.authorization || "").trim();
  const supplied = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!supplied) return false;
  return timingSafeEqual(digest(supplied), digest(expected));
};

/**
 * Durable backstop for queued transactional email. User-facing requests may
 * attempt immediate delivery, but this authenticated scheduler drains rows
 * that outlive a serverless invocation.
 */
export async function handleEmailDispatch(request: IncomingMessage, response: ServerResponse) {
  if (request.method !== "GET" && request.method !== "POST") {
    json(response, 405, { code: "method_not_allowed", error: "This dispatch method is not available." });
    return;
  }
  if (!authorized(request)) {
    json(response, 401, { code: "dispatch_unauthorized", error: "This endpoint requires the scheduler credential." });
    return;
  }
  try {
    const url = new URL(request.url || "/", "http://localhost");
    const requested = Number(url.searchParams.get("emails"));
    const result = await drainQueuedWorkspaceEmails(Number.isFinite(requested) && requested > 0 ? requested : 50);
    json(response, 200, result);
  } catch (error) {
    console.error("[email-dispatch] unexpected failure", {
      type: error instanceof Error ? error.name : typeof error,
    });
    json(response, 500, { code: "dispatch_failed", error: "Queued email could not be dispatched." });
  }
}

import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { jwtVerify } from "jose";

import {
  campaignBelongsToWorkspace,
  getCampaignMetricSnapshot,
  processCampaignAnalyticsEvents,
} from "./campaign-analytics-engine";
import {
  getSharedCampaignAnalytics,
  subscribeCampaignAnalytics,
} from "./campaign-realtime";
import { getCampaignAnalytics } from "./contacts-data";
import { workspaceScopeFor } from "./workspace-access";

type Row = Record<string, unknown>;

class AnalyticsAuthError extends Error {}

const text = (value: unknown, max = 2_000) =>
  String(value ?? "").trim().slice(0, max);

const uuid = (value: unknown) => {
  const candidate = text(value, 64);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    candidate,
  )
    ? candidate
    : "";
};

const json = (response: ServerResponse, status: number, value: Row) => {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "private, no-store, max-age=0");
  response.setHeader("Vary", "Authorization");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.end(JSON.stringify(value));
};

const signingSecret = () => {
  const secret = text(process.env.JWT_SECRET, 500);
  if (secret.length < 32) throw new Error("Analytics authentication is unavailable.");
  return new TextEncoder().encode(secret);
};

const authenticatedUserId = async (request: IncomingMessage) => {
  const header = text(request.headers.authorization, 1_000);
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) throw new AnalyticsAuthError("Please sign in again to view analytics.");
  const secret = signingSecret();
  let payload;
  try {
    ({ payload } = await jwtVerify(token, secret, {
      audience: "maxform-dashboard",
      issuer: "maxform",
    }));
  } catch {
    throw new AnalyticsAuthError("Your session has expired. Sign in and try again.");
  }
  const userId = uuid(payload.userId);
  if (!userId) throw new AnalyticsAuthError("Your session has expired. Sign in and try again.");
  // The workspace this request acts in. Identical to the signed-in id for
  // a workspace owner; an added member resolves to the workspace they
  // belong to, so every query below reads and writes the same rows.
  return workspaceScopeFor(userId);
};

const campaignIdFromRequest = (request: IncomingMessage) => {
  const url = new URL(request.url || "/", "http://localhost");
  const queryId = uuid(url.searchParams.get("campaignId"));
  if (queryId) return queryId;
  const match = url.pathname.match(/\/api\/campaigns\/([^/]+)\/analytics(?:\/)?$/i);
  return uuid(match?.[1]);
};

const authenticationError = (error: unknown) => error instanceof AnalyticsAuthError;

/**
 * Compatibility-friendly analytics API. The existing Contacts response is
 * preserved for the current screen, while `engine` exposes the materialized
 * version and metric snapshot for new consumers.
 */
export async function handleCampaignAnalyticsApi(
  request: IncomingMessage,
  response: ServerResponse,
) {
  try {
    if (request.method !== "GET") {
      json(response, 405, { error: "Use GET for campaign analytics." });
      return;
    }
    const workspaceId = await authenticatedUserId(request);
    const campaignId = campaignIdFromRequest(request);
    if (!campaignId) {
      json(response, 400, { error: "A valid campaign id is required." });
      return;
    }
    if (!(await campaignBelongsToWorkspace(workspaceId, campaignId))) {
      json(response, 404, { error: "That campaign is not available." });
      return;
    }
    const [analytics, engine] = await Promise.all([
      getCampaignAnalytics(workspaceId, campaignId),
      getCampaignMetricSnapshot(workspaceId, campaignId),
    ]);
    json(response, 200, { result: { ...analytics, engine } });
  } catch (error) {
    json(response, authenticationError(error) ? 401 : 500, {
      error: error instanceof Error
        ? authenticationError(error)
          ? error.message
          : "Campaign analytics is temporarily unavailable."
        : "Campaign analytics is temporarily unavailable.",
    });
  }
}

const stream = (response: ServerResponse, event: string, value: unknown) => {
  if (response.writableEnded) return;
  response.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`);
};

/** Authenticated server-sent updates for a single campaign. */
export async function handleCampaignAnalyticsStream(
  request: IncomingMessage,
  response: ServerResponse,
) {
  // Annotated rather than inferred: without it the placeholder narrows the
  // variable to `() => undefined`, which the real unsubscribe does not match.
  let unsubscribe: () => void = () => undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let aggregatePoller: ReturnType<typeof setInterval> | undefined;
  let sharedPoller: ReturnType<typeof setInterval> | undefined;
  try {
    if (request.method !== "GET") {
      json(response, 405, { error: "Use GET for campaign analytics updates." });
      return;
    }
    const workspaceId = await authenticatedUserId(request);
    const campaignId = campaignIdFromRequest(request);
    if (!campaignId || !(await campaignBelongsToWorkspace(workspaceId, campaignId))) {
      json(response, 404, { error: "That campaign is not available." });
      return;
    }
    response.statusCode = 200;
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.setHeader("X-Accel-Buffering", "no");
    response.setHeader("Vary", "Authorization");
    response.setHeader("X-Content-Type-Options", "nosniff");
    const initialSnapshot = await getCampaignMetricSnapshot(workspaceId, campaignId);
    let lastVersion = initialSnapshot?.version || 0;
    stream(response, "ready", {
      campaignId,
      snapshot: initialSnapshot,
    });
    unsubscribe = subscribeCampaignAnalytics(campaignId, (payload) => {
      if (payload.workspaceId === workspaceId && payload.version > lastVersion) {
        lastVersion = payload.version;
        stream(response, "analytics_update", payload);
      }
    });
    // Redis is the shared cross-instance signal. Postgres remains the durable
    // recovery path for Redis outages, expired snapshots, and reconnects.
    sharedPoller = setInterval(() => {
      void getSharedCampaignAnalytics(workspaceId, campaignId)
        .then((snapshot) => {
          if (!snapshot || snapshot.version <= lastVersion) return;
          lastVersion = snapshot.version;
          stream(response, "analytics_update", snapshot);
        })
        .catch(() => undefined);
    }, 1_000);
    aggregatePoller = setInterval(() => {
      void getCampaignMetricSnapshot(workspaceId, campaignId)
        .then((snapshot) => {
          if (!snapshot || snapshot.version <= lastVersion) return;
          lastVersion = snapshot.version;
          stream(response, "analytics_update", snapshot);
        })
        .catch(() => undefined);
    }, 5_000);
    heartbeat = setInterval(
      () => stream(response, "heartbeat", { at: new Date().toISOString() }),
      20_000,
    );
    const close = () => {
      unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
      if (aggregatePoller) clearInterval(aggregatePoller);
      if (sharedPoller) clearInterval(sharedPoller);
    };
    request.once("close", close);
    response.once("close", close);
  } catch (error) {
    unsubscribe();
    if (heartbeat) clearInterval(heartbeat);
    if (aggregatePoller) clearInterval(aggregatePoller);
    if (sharedPoller) clearInterval(sharedPoller);
    if (!response.headersSent) {
      json(response, authenticationError(error) ? 401 : 500, {
        error: error instanceof Error ? error.message : "Campaign analytics stream is unavailable.",
      });
    } else if (!response.writableEnded) {
      response.end();
    }
  }
}

// Keep the route name explicit at the API boundary. Existing deployments use
// /api/campaigns/realtime, while the implementation name describes the SSE
// transport and is also useful to the Vite middleware.
export const handleCampaignAnalyticsRealtime = handleCampaignAnalyticsStream;

const schedulerAuthorized = (request: IncomingMessage) => {
  const expected = text(
    process.env.CAMPAIGN_ANALYTICS_WORKER_SECRET || process.env.CRON_SECRET,
    500,
  );
  const supplied = text(request.headers.authorization, 1_000);
  if (expected.length < 16 || !supplied.startsWith("Bearer ")) return false;
  const expectedHash = createHash("sha256").update(expected).digest();
  const suppliedHash = createHash("sha256")
    .update(supplied.slice("Bearer ".length).trim())
    .digest();
  return timingSafeEqual(expectedHash, suppliedHash);
};

/** Cron endpoint for durable processing after a serverless request ends. */
export async function handleCampaignAnalyticsWorker(
  request: IncomingMessage,
  response: ServerResponse,
) {
  if (request.method !== "GET" && request.method !== "POST") {
    json(response, 405, { error: "Use GET or POST for the analytics worker." });
    return;
  }
  if (!schedulerAuthorized(request)) {
    json(response, 401, { error: "This worker requires the scheduler credential." });
    return;
  }
  try {
    const url = new URL(request.url || "/", "http://localhost");
    const requested = Number(url.searchParams.get("limit"));
    const result = await processCampaignAnalyticsEvents({
      limit: Number.isFinite(requested) && requested > 0 ? requested : 5_000,
    });
    json(response, 200, { result });
  } catch (error) {
    console.error("[campaign-analytics-worker] failed", {
      type: error instanceof Error ? error.name : typeof error,
    });
    json(response, 500, { error: "Campaign analytics could not be processed." });
  }
}

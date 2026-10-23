/**
 * Shared realtime transport for campaign analytics.
 *
 * The durable source is campaign_metrics in Postgres. Redis carries the most
 * recent immutable metric snapshot between serverless instances, while the
 * local fan-out keeps same-instance viewers immediate. The SSE endpoint uses
 * the Redis snapshot as its fast cross-instance path and Postgres as recovery.
 */
import { withRedis } from "./redis";

export type CampaignAnalyticsRealtimePayload = {
  campaignId: string;
  workspaceId: string;
  version: number;
  updatedAt: string;
  metrics: Record<string, number>;
};

type Listener = (payload: CampaignAnalyticsRealtimePayload) => void;

const listeners = new Map<string, Set<Listener>>();

const realtimeKey = (workspaceId: string, campaignId: string) =>
  `mf:v1:campaign-realtime:${workspaceId}:${campaignId}`;

const isSnapshot = (value: unknown): value is CampaignAnalyticsRealtimePayload => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CampaignAnalyticsRealtimePayload>;
  return (
    typeof candidate.campaignId === "string" &&
    typeof candidate.workspaceId === "string" &&
    Number.isFinite(Number(candidate.version)) &&
    typeof candidate.metrics === "object" &&
    candidate.metrics !== null
  );
};

export const subscribeCampaignAnalytics = (
  campaignId: string,
  listener: Listener,
) => {
  const current = listeners.get(campaignId) || new Set<Listener>();
  current.add(listener);
  listeners.set(campaignId, current);
  return () => {
    current.delete(listener);
    if (!current.size) listeners.delete(campaignId);
  };
};

export const publishCampaignAnalytics = async (
  payload: CampaignAnalyticsRealtimePayload,
) => {
  listeners.get(payload.campaignId)?.forEach((listener) => {
    try {
      listener(payload);
    } catch (error) {
      // A broken viewer must never prevent another viewer from receiving the
      // same aggregate update.
      console.error("[campaign-realtime] listener failed", {
        type: error instanceof Error ? error.name : typeof error,
      });
    }
  });

  await withRedis(
    "campaign_realtime_publish",
    async (redis) => {
      await redis.set(realtimeKey(payload.workspaceId, payload.campaignId), payload, {
        ex: 120,
      });
      return true;
    },
    false,
  );
};

/** Read the shared cross-instance snapshot without making Redis mandatory. */
export const getSharedCampaignAnalytics = async (
  workspaceId: string,
  campaignId: string,
) => {
  const value = await withRedis<CampaignAnalyticsRealtimePayload | null>(
    "campaign_realtime_read",
    (redis) =>
      redis.get<CampaignAnalyticsRealtimePayload>(
        realtimeKey(workspaceId, campaignId),
      ),
    null,
  );
  if (
    !isSnapshot(value) ||
    value.workspaceId !== workspaceId ||
    value.campaignId !== campaignId
  ) {
    return null;
  }
  return value;
};

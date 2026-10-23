export type CampaignAnalyticsRealtimePayload = {
  campaignId: string;
  workspaceId: string;
  version: number;
  updatedAt: string;
  metrics: Record<string, number>;
};

type SubscribeInput = {
  campaignId: string;
  onUpdate: (payload: CampaignAnalyticsRealtimePayload) => void;
  onError?: () => void;
};

const parseEvent = (
  eventName: string,
  data: string,
  onUpdate: SubscribeInput["onUpdate"],
) => {
  if (!["analytics_update", "ready"].includes(eventName) || !data) return;
  try {
    const payload = JSON.parse(data) as CampaignAnalyticsRealtimePayload;
    if (payload?.campaignId && payload.metrics) onUpdate(payload);
  } catch {
    // A malformed server frame should not tear down a healthy analytics view.
  }
};

/**
 * Opens the authenticated campaign analytics stream. The dashboard receives
 * invalidation signals here; it keeps its existing query/data presentation and
 * never needs a browser-side polling timer.
 */
export const subscribeCampaignAnalyticsRealtime = ({
  campaignId,
  onUpdate,
  onError,
}: SubscribeInput) => {
  const controller = new AbortController();
  let stopped = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let retryAttempt = 0;

  const run = async () => {
    try {
      const token =
        typeof localStorage === "undefined"
          ? ""
          : localStorage.getItem("access_token") || "";
      const response = await fetch(
        `/api/campaigns/realtime?campaignId=${encodeURIComponent(campaignId)}`,
        {
          headers: {
            Accept: "text/event-stream",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          cache: "no-store",
          signal: controller.signal,
        },
      );
      if (!response.ok || !response.body) throw new Error("stream_unavailable");
      retryAttempt = 0;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let eventName = "message";
      let data: string[] = [];

      const flush = () => {
        if (data.length) parseEvent(eventName, data.join("\n"), onUpdate);
        eventName = "message";
        data = [];
      };

      while (!stopped) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        lines.forEach((line) => {
          if (!line) {
            flush();
          } else if (line.startsWith("event:")) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            data.push(line.slice(5).trimStart());
          }
        });
      }
      if (!stopped) {
        const delay = Math.min(30_000, 1_000 * 2 ** retryAttempt);
        retryAttempt += 1;
        retryTimer = setTimeout(() => void run(), delay);
      }
    } catch (error) {
      if (!stopped && (error as { name?: string })?.name !== "AbortError") {
        onError?.();
        const delay = Math.min(30_000, 1_000 * 2 ** retryAttempt);
        retryAttempt += 1;
        retryTimer = setTimeout(() => void run(), delay);
      }
    }
  };
  void run();

  return () => {
    stopped = true;
    controller.abort();
    if (retryTimer) clearTimeout(retryTimer);
  };
};

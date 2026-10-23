import type { IncomingMessage, ServerResponse } from "node:http";

import { handleCampaignAnalyticsRealtime } from "../../server/campaign-analytics-api";

export default async function campaignRealtimeHandler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  await handleCampaignAnalyticsRealtime(request, response);
}


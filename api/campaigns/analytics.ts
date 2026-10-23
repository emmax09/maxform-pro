import type { IncomingMessage, ServerResponse } from "node:http";

import { handleCampaignAnalyticsApi } from "../../server/campaign-analytics-api";

export default async function campaignAnalyticsHandler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  await handleCampaignAnalyticsApi(request, response);
}


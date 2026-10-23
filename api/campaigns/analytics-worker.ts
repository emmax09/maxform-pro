import type { IncomingMessage, ServerResponse } from "node:http";

import { handleCampaignAnalyticsWorker } from "../../server/campaign-analytics-api";

export default async function campaignAnalyticsWorkerHandler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  await handleCampaignAnalyticsWorker(request, response);
}


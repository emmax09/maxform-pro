import type { IncomingMessage, ServerResponse } from "node:http";

import { handleCampaignAnalyticsApi } from "../../../server/campaign-analytics-api";

export default async function campaignAnalyticsByIdHandler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  await handleCampaignAnalyticsApi(request, response);
}

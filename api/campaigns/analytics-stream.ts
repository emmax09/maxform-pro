import type { IncomingMessage, ServerResponse } from "node:http";

import { handleCampaignAnalyticsStream } from "../../server/campaign-analytics-api";

export default async function campaignAnalyticsStreamHandler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  await handleCampaignAnalyticsStream(request, response);
}

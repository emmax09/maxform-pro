import type { IncomingMessage, ServerResponse } from "node:http";

import { handleCampaignTracking } from "../../server/campaign-tracking";

export default async function campaignTrackingHandler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  await handleCampaignTracking(request, response);
}

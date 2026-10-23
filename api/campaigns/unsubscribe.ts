import type { IncomingMessage, ServerResponse } from "node:http";

import { handleCampaignUnsubscribe } from "../../server/campaign-tracking";

export default async function campaignUnsubscribeHandler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  await handleCampaignUnsubscribe(request, response);
}

import type { IncomingMessage, ServerResponse } from "node:http";

import { handleCampaignDispatch } from "../../server/campaign-dispatch-api";

export default async function campaignDispatchHandler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  await handleCampaignDispatch(request, response);
}

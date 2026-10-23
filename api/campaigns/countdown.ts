import type { IncomingMessage, ServerResponse } from "node:http";

import { handleCampaignCountdown } from "../../server/campaign-countdown";

export default async function campaignCountdownHandler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  await handleCampaignCountdown(request, response);
}

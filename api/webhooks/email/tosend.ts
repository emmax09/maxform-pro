import type { IncomingMessage, ServerResponse } from "node:http";

import { handleToSendWebhook } from "../../../server/tosend-webhook";

export const config = {
  api: { bodyParser: false },
};

export default async function toSendWebhookHandler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  await handleToSendWebhook(request, response);
}

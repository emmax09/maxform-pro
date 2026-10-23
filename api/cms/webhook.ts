import type { IncomingMessage, ServerResponse } from "node:http";

import { handleCmsWebhook } from "../../server/cms-data";

export default async function cmsWebhookHandler(request: IncomingMessage, response: ServerResponse) {
  await handleCmsWebhook(request, response);
}

import type { IncomingMessage, ServerResponse } from "node:http";

import { handleWorkflowWebhook } from "../../server/workflows-data";

export default async function workflowWebhookHandler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  await handleWorkflowWebhook(request, response);
}


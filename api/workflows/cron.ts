import type { IncomingMessage, ServerResponse } from "node:http";

import { handleWorkflowCron } from "../../server/workflows-data";

export default async function workflowCronHandler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  await handleWorkflowCron(request, response);
}


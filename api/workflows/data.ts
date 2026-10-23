import type { IncomingMessage, ServerResponse } from "node:http";

import { handleWorkflowsData } from "../../server/workflows-data";

export default async function workflowsDataHandler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  await handleWorkflowsData(request, response);
}


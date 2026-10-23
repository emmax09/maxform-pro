import type { IncomingMessage, ServerResponse } from "node:http";

import { handleSchedulingIntegrations } from "../../server/scheduling-oauth";

export default async function schedulingIntegrationsHandler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  await handleSchedulingIntegrations(request, response);
}

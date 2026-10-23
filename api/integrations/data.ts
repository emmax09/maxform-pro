import type { IncomingMessage, ServerResponse } from "node:http";

import { handleIntegrationsData } from "../../server/integrations-data";

export default async function integrationsDataHandler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  await handleIntegrationsData(request, response);
}

import type { IncomingMessage, ServerResponse } from "node:http";

import { handleIntegrationOAuth } from "../../server/integration-oauth";

export default async function oauthHandler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  await handleIntegrationOAuth(request, response);
}

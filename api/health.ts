import type { IncomingMessage, ServerResponse } from "node:http";

import { handleHealth } from "../server/health";

export default async function healthHandler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  await handleHealth(request, response);
}

import type { IncomingMessage, ServerResponse } from "node:http";

import { handleEmailHealth } from "../../../server/email-health";

export default async function emailHealthHandler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  await handleEmailHealth(request, response);
}

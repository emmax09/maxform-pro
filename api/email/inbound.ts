import type { IncomingMessage, ServerResponse } from "node:http";

import { handleEmailInbound } from "../../server/email-inbound";

export default async function emailInboundHandler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  await handleEmailInbound(request, response);
}

import type { IncomingMessage, ServerResponse } from "node:http";

import { handleEmailDispatch } from "../../server/email-dispatch-api";

export default async function emailDispatchHandler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  await handleEmailDispatch(request, response);
}

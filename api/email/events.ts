import type { IncomingMessage, ServerResponse } from "node:http";

import { handleEmailEvents } from "../../server/email-events";

export default async function emailEventsHandler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  await handleEmailEvents(request, response);
}

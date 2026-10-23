import type { IncomingMessage, ServerResponse } from "node:http";

import { handleEventsData } from "../../server/events-data";

export default async function eventsDataHandler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  await handleEventsData(request, response);
}

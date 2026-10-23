import type { IncomingMessage, ServerResponse } from "node:http";

import { handleEventTickets } from "../../server/event-tickets";

export default async function eventTicketsHandler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  await handleEventTickets(request, response);
}


import type { IncomingMessage, ServerResponse } from "node:http";

import { handleNotificationsData } from "../../server/notifications-data";

export default async function notificationsDataHandler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  await handleNotificationsData(request, response);
}

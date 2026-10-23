import type { IncomingMessage, ServerResponse } from "node:http";

import { handleCrmData } from "../../server/crm-data";

export default async function crmDataHandler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  await handleCrmData(request, response);
}

import type { IncomingMessage, ServerResponse } from "node:http";

import { handleEmailAutomation } from "../../server/email-automation";

export default async function emailAutomationHandler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  await handleEmailAutomation(request, response);
}

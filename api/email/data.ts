import type { IncomingMessage, ServerResponse } from "node:http";

import { handleEmailData } from "../../server/email-data";

export default async function emailDataHandler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  await handleEmailData(request, response);
}

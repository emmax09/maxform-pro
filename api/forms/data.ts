import type { IncomingMessage, ServerResponse } from "node:http";

import { handleFormsData } from "../../server/forms-data";

export default async function formsDataHandler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  await handleFormsData(request, response);
}

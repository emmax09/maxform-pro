import type { IncomingMessage, ServerResponse } from "node:http";

import { handleCmsCron } from "../../server/cms-data";

export default async function cmsCronHandler(request: IncomingMessage, response: ServerResponse) {
  await handleCmsCron(request, response);
}

import type { IncomingMessage, ServerResponse } from "node:http";

import { handleCmsData } from "../../server/cms-data";

export default async function cmsDataHandler(request: IncomingMessage, response: ServerResponse) {
  await handleCmsData(request, response);
}

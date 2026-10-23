import type { IncomingMessage, ServerResponse } from "node:http";

import { handlePublicSubmissionLocation } from "../../server/public-submission-location";

export default async function publicSubmissionLocationHandler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  await handlePublicSubmissionLocation(request, response);
}

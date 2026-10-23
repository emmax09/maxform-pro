import type { IncomingMessage, ServerResponse } from "node:http";

import { handleProjectsData } from "../../server/projects-data";

export default async function projectsDataHandler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  await handleProjectsData(request, response);
}

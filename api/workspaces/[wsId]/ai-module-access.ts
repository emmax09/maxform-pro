import type { IncomingMessage, ServerResponse } from "node:http";

import { handleAiModuleAccess } from "../../../server/ai-assistant";

export default async function aiModuleAccessHandler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  await handleAiModuleAccess(request, response);
}

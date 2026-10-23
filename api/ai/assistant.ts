import type { IncomingMessage, ServerResponse } from "node:http";

import { handleAiAssistant } from "../../server/ai-assistant";

export default async function aiAssistantHandler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  await handleAiAssistant(request, response);
}

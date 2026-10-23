import type { IncomingMessage, ServerResponse } from "node:http";

import { handleSettings } from "../server/settings";

export default async function settingsHandler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  await handleSettings(request, response);
}

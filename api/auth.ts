import type { IncomingMessage, ServerResponse } from "node:http";

import { handleAuth } from "../server/auth";

export default async function authHandler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  await handleAuth(request, response);
}

import type { IncomingMessage, ServerResponse } from "node:http";

import { handleStorageApi } from "../server/storage-api";

export default async function storageHandler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  await handleStorageApi(request, response);
}

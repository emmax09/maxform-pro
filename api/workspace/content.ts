import type { IncomingMessage, ServerResponse } from "node:http";

import { handleFilesDocumentsData } from "../../server/files-documents-data";

export default async function workspaceContentHandler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  await handleFilesDocumentsData(request, response);
}

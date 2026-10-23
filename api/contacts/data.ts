import type { IncomingMessage, ServerResponse } from "node:http";

import { handleContactsData } from "../../server/contacts-data";

export default async function contactsDataHandler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  await handleContactsData(request, response);
}

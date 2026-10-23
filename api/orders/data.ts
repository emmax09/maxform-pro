import type { IncomingMessage, ServerResponse } from "node:http";

import { handleOrdersData } from "../../server/orders-data";

export default async function ordersDataHandler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  await handleOrdersData(request, response);
}

import type { IncomingMessage, ServerResponse } from "node:http";

import { handlePaymentData } from "../../server/payment-data";

export default async function paymentDataHandler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  await handlePaymentData(request, response);
}

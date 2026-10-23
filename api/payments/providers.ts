import type { IncomingMessage, ServerResponse } from "node:http";

import { handlePaymentProviders } from "../../server/payment-providers";

export default async function paymentProvidersHandler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  await handlePaymentProviders(request, response);
}

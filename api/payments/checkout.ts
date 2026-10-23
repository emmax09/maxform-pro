import type { IncomingMessage, ServerResponse } from "node:http";

import { handlePaymentCheckout } from "../../server/payment-checkout";

export default async function paymentCheckoutHandler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  await handlePaymentCheckout(request, response);
}

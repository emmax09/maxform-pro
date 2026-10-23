import type { IncomingMessage, ServerResponse } from "node:http";

import { handleOnboardingData } from "../server/onboarding-data";

export default async function onboardingHandler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  await handleOnboardingData(request, response);
}

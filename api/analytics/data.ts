import type { IncomingMessage, ServerResponse } from "node:http";

import { handleAnalyticsData } from "../../server/analytics-data";

export default async function analyticsDataHandler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  await handleAnalyticsData(request, response);
}

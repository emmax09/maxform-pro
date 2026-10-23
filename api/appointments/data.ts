import type { IncomingMessage, ServerResponse } from "node:http";

import { handleAppointmentsData } from "../../server/appointments-data";

export default async function appointmentsDataHandler(
  request: IncomingMessage,
  response: ServerResponse,
) {
  await handleAppointmentsData(request, response);
}

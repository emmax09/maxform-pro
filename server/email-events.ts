import type { IncomingMessage, ServerResponse } from "node:http";

import { WorkspaceEmailError, receiveWorkspaceEmailDeliveryEvent } from "./workspace-email";

type Row = Record<string, unknown>;
type DeliveryStatus = "delivered" | "opened" | "clicked" | "bounced" | "complained";

const reply = (response: ServerResponse, status: number, value: Row) => {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.end(JSON.stringify(value));
};

const readRaw = async (request: IncomingMessage) => {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) throw new WorkspaceEmailError("Email event is too large.", 413);
  }
  return body;
};

const record = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const nested = (value: Row, path: string[]) => path.reduce<unknown>((current, key) => current && typeof current === "object" && !Array.isArray(current) ? (current as Row)[key] : undefined, value);
const stringAt = (value: Row, paths: string[][]) => {
  for (const path of paths) {
    const candidate = nested(value, path);
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return "";
};

const eventStatus = (value: string): DeliveryStatus | null => {
  const event = value.toLowerCase();
  if (/complaint|spam/.test(event)) return "complained";
  if (/bounce/.test(event)) return "bounced";
  if (/click/.test(event)) return "clicked";
  if (/open/.test(event)) return "opened";
  if (/deliver/.test(event)) return "delivered";
  return null;
};

export const normaliseEvent = (raw: string, contentType: string) => {
  let parsed: unknown;
  if (contentType.includes("application/json")) {
    try { parsed = JSON.parse(raw || "{}"); } catch { throw new WorkspaceEmailError("The provider sent invalid email event data.", 400); }
  } else if (contentType.includes("application/x-www-form-urlencoded")) {
    parsed = Object.fromEntries(new URLSearchParams(raw));
  } else {
    throw new WorkspaceEmailError("Email events must use JSON or form data.", 415);
  }
  const payload = Array.isArray(parsed) ? record(parsed[0]) : record(parsed);
  const sns = typeof payload.Message === "string" ? (() => { try { return record(JSON.parse(payload.Message)); } catch { return {}; } })() : {};
  const data = record(payload.data);
  const eventData = record(payload["event-data"]);
  const source = Object.keys(sns).length ? sns : payload;
  const status = eventStatus(stringAt(source, [["type"], ["event"], ["RecordType"], ["notificationType"], ["eventType"], ["eventType", "value"], ["event", "type"]]) || stringAt(data, [["type"], ["event"]]) || stringAt(eventData, [["event"], ["severity"]]));
  const providerMessageId = stringAt(source, [["email_id"], ["message_id"], ["MessageID"], ["sg_message_id"], ["mail", "messageId"], ["mail", "message_id"], ["data", "email_id"], ["event-data", "id"], ["event-data", "message", "headers", "message-id"]]) || stringAt(data, [["email_id"], ["message_id"]]) || stringAt(eventData, [["id"], ["message", "headers", "message-id"]]);
  const providerEventId = stringAt(source, [["event_id"], ["eventId"], ["event-id"], ["event", "id"]]) || stringAt(data, [["event_id"], ["eventId"]]) || stringAt(eventData, [["event_id"], ["eventId"]]);
  const destination = stringAt(source, [["link"], ["data", "link"], ["event-data", "link"]]) || stringAt(data, [["link"]]) || stringAt(eventData, [["link"]]);
  if (!status || !providerMessageId) throw new WorkspaceEmailError("The provider event is missing a supported status or message id.", 400, "invalid_email_event");
  return {
    status,
    providerMessageId,
    ...(providerEventId ? { providerEventId } : {}),
    ...(destination ? { destination } : {}),
  };
};

export async function handleEmailEvents(request: IncomingMessage, response: ServerResponse) {
  try {
    if (request.method !== "POST") {
      reply(response, 405, { error: "Use POST for email events." });
      return;
    }
    const url = new URL(request.url || "/", "http://localhost");
    const event = normaliseEvent(await readRaw(request), String(request.headers["content-type"] || "").toLowerCase());
    reply(response, 202, await receiveWorkspaceEmailDeliveryEvent({ connectionId: url.searchParams.get("connection") || "", token: url.searchParams.get("token") || "", ...event }));
  } catch (error) {
    if (error instanceof WorkspaceEmailError) {
      reply(response, error.status, { error: error.message, code: error.code });
      return;
    }
    console.error("[email-events] unexpected request failure", { type: error instanceof Error ? error.name : typeof error });
    reply(response, 500, { error: "Email event could not be accepted." });
  }
}

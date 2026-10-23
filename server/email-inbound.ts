import type { IncomingMessage, ServerResponse } from "node:http";

import { WorkspaceEmailError, receiveWorkspaceEmail } from "./workspace-email";

const reply = (response: ServerResponse, status: number, value: Record<string, unknown>) => {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(JSON.stringify(value));
};

const readRaw = async (request: IncomingMessage) => {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) throw new WorkspaceEmailError("Inbound email is too large.", 413);
  }
  return body;
};

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const valueFor = (source: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value;
    if (Array.isArray(value)) {
      const first = value.find((item): item is string => typeof item === "string" && Boolean(item.trim()));
      if (first) return first;
    }
  }
  return "";
};

export const normaliseInbound = (raw: string, contentType: string) => {
  let payload: Record<string, unknown> = {};
  if (contentType.includes("application/json")) {
    try { payload = record(JSON.parse(raw)); } catch { throw new WorkspaceEmailError("The provider sent invalid email data.", 400); }
  } else if (contentType.includes("application/x-www-form-urlencoded")) {
    payload = Object.fromEntries(new URLSearchParams(raw));
  } else {
    payload = { text: raw };
  }
  // SES/SNS wraps its original mail notification in a Message JSON string.
  const envelope = typeof payload.Message === "string" ? (() => { try { return record(JSON.parse(payload.Message)); } catch { return {}; } })() : {};
  const data = record(payload.data);
  const headers = record(envelope.mail);
  const commonHeaders = record(headers.commonHeaders);
  return {
    providerMessageId: valueFor(payload, ["MessageID", "message-id", "message_id", "email_id"]) || valueFor(data, ["email_id", "id"]) || valueFor(headers, ["messageId"]),
    sender: valueFor(payload, ["From", "from", "sender"]) || valueFor(data, ["from"]) || valueFor(commonHeaders, ["from"]),
    recipient: valueFor(payload, ["To", "to", "recipient"]) || valueFor(data, ["to"]) || valueFor(commonHeaders, ["to"]),
    subject: valueFor(payload, ["Subject", "subject"]) || valueFor(data, ["subject"]) || valueFor(commonHeaders, ["subject"]),
    html: valueFor(payload, ["HtmlBody", "html", "stripped-html"]) || valueFor(data, ["html"]),
    text: valueFor(payload, ["TextBody", "text", "stripped-text"]) || valueFor(data, ["text"]) || (Object.keys(payload).length ? "" : raw),
  };
};

export async function handleEmailInbound(request: IncomingMessage, response: ServerResponse) {
  try {
    if (request.method !== "POST") {
      reply(response, 405, { error: "Use POST for inbound email." });
      return;
    }
    const url = new URL(request.url || "/", "http://localhost");
    const connectionId = url.searchParams.get("connection") || "";
    const token = url.searchParams.get("token") || "";
    const raw = await readRaw(request);
    const message = normaliseInbound(raw, String(request.headers["content-type"] || "").toLowerCase());
    reply(response, 202, await receiveWorkspaceEmail({ connectionId, token, ...message }));
  } catch (error) {
    if (error instanceof WorkspaceEmailError) {
      reply(response, error.status, { error: error.message, code: error.code });
      return;
    }
    console.error("[email-inbound] unexpected request failure", { type: error instanceof Error ? error.name : typeof error });
    reply(response, 500, { error: "Inbound email could not be accepted." });
  }
}

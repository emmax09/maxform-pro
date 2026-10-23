import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { enqueueToSendWebhookJob } from "./campaign-queue";
import { createCampaignDatabase } from "./campaign-database";

type JsonObject = Record<string, unknown>;

export type ToSendWebhookEvent = {
  eventType: "bounced" | "complaint";
  providerMessageId: string;
  providerEventId: string;
  recipient: string;
  hardBounce: boolean;
  reason: string;
  occurredAt: string;
  payload: JsonObject;
};

const text = (value: unknown, max = 2_000) => String(value ?? "").trim().slice(0, max);

const object = (value: unknown): JsonObject =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};

const responseJson = (response: ServerResponse, status: number, value: JsonObject) => {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(JSON.stringify(value));
};

const header = (request: IncomingMessage, name: string) => {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] || "" : String(value || "");
};

export const readRawBody = async (request: IncomingMessage, maximumBytes = 1_000_000) => {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    total += buffer.length;
    if (total > maximumBytes) throw new Error("Webhook payload is too large.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
};

export const verifyToSendWebhookSignature = (
  rawBody: Buffer | string,
  suppliedSignature: string,
  secret: string,
) => {
  if (!secret || !suppliedSignature) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const received = Buffer.from(suppliedSignature.trim());
  const calculated = Buffer.from(expected);
  return received.length === calculated.length && timingSafeEqual(received, calculated);
};

export const parseToSendWebhook = (rawBody: Buffer | string, eventHeader = "") => {
  let parsed: JsonObject;
  try {
    const value = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : rawBody);
    parsed = object(value);
  } catch {
    throw new Error("ToSend webhook payload is not valid JSON.");
  }
  const data = object(parsed.data);
  const eventType = text(parsed.type || eventHeader, 40).toLowerCase();
  if (eventType !== "bounced" && eventType !== "complaint") {
    throw new Error("Unsupported ToSend webhook event.");
  }
  if (eventHeader && text(eventHeader, 40).toLowerCase() !== eventType) {
    throw new Error("ToSend webhook event header does not match the payload.");
  }
  const providerMessageId = text(data.message_id || object(parsed.mail).id, 255);
  const recipientValue = text(data.email, 320).toLowerCase();
  const occurredAt = text(data.timestamp || parsed.created_at, 80) || new Date().toISOString();
  const reason = text(data.reason || data.feedback_type || object(parsed.mail).error_message, 1_000);
  if (!providerMessageId || !recipientValue) {
    throw new Error("ToSend webhook is missing message_id or email.");
  }
  const hardBounce = eventType === "bounced" && (
    data.is_hard_bounce === true ||
    text(data.bounce_type, 40).toLowerCase() === "permanent"
  );
  const providerEventId = `tosend:${eventType}:${providerMessageId}:${occurredAt}:${recipientValue}`.slice(0, 255);
  return {
    eventType,
    providerMessageId,
    providerEventId,
    recipient: recipientValue,
    hardBounce,
    reason,
    occurredAt,
    payload: parsed,
  } satisfies ToSendWebhookEvent;
};

const database = () => {
  const url = text(process.env.DATABASE_URL, 2_000);
  if (!url) throw new Error("The email webhook database is unavailable.");
  return createCampaignDatabase(url);
};

const queueRequired = () => process.env.NODE_ENV === "production" || process.env.QUEUE_REQUIRED === "true";

/**
 * Receives ToSend's raw signed body, persists it before acknowledging, then
 * hands the durable event to BullMQ. The raw body is never reconstructed for
 * signature verification.
 */
export const handleToSendWebhook = async (request: IncomingMessage, response: ServerResponse) => {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return responseJson(response, 405, { error: "method_not_allowed" });
  }
  const secret = text(process.env.TOSEND_WEBHOOK_SECRET, 500);
  const unsignedDevelopment = process.env.NODE_ENV !== "production" && process.env.TOSEND_ALLOW_UNSIGNED_WEBHOOKS === "true";
  if (!secret && !unsignedDevelopment) {
    return responseJson(response, 503, { error: "webhook_secret_not_configured" });
  }
  let rawBody: Buffer;
  try {
    rawBody = await readRawBody(request);
  } catch (error) {
    return responseJson(response, 413, { error: error instanceof Error ? error.message : "invalid_webhook_body" });
  }
  const signature = header(request, "x-tosend-signature");
  if (secret && !verifyToSendWebhookSignature(rawBody, signature, secret)) {
    return responseJson(response, 401, { error: "invalid_webhook_signature" });
  }
  let event: ToSendWebhookEvent;
  try {
    event = parseToSendWebhook(rawBody, header(request, "x-tosend-event"));
  } catch (error) {
    return responseJson(response, 400, { error: error instanceof Error ? error.message : "invalid_webhook_payload" });
  }

  let rows: JsonObject[];
  try {
    rows = await database().query(
      `INSERT INTO email_provider_webhook_events (
         provider, provider_event_id, provider_message_id, event_type,
         recipient, payload
       ) VALUES ('tosend', $1, $2, $3, $4, $5::jsonb)
       ON CONFLICT (provider, provider_event_id) DO UPDATE
         SET updated_at = NOW()
       RETURNING id, processed_at`,
      [event.providerEventId, event.providerMessageId, event.eventType, event.recipient, JSON.stringify(event.payload)],
    ) as JsonObject[];
  } catch (error) {
    console.error("[tosend-webhook] persistence failed", { type: error instanceof Error ? error.name : typeof error });
    return responseJson(response, 503, { error: "webhook_persistence_unavailable" });
  }
  const webhookEventId = text(rows[0]?.id, 64);
  if (!webhookEventId) return responseJson(response, 503, { error: "webhook_persistence_unavailable" });
  if (rows[0]?.processed_at) return responseJson(response, 202, { accepted: true, duplicate: true });

  try {
    const queued = await enqueueToSendWebhookJob(webhookEventId);
    if (queued.enqueued) return responseJson(response, 202, { accepted: true, queued: true });
    if (queueRequired()) return responseJson(response, 503, { error: "webhook_queue_unavailable" });
    const { processToSendWebhookEvent } = await import("./workspace-email");
    await processToSendWebhookEvent(webhookEventId);
    return responseJson(response, 202, { accepted: true, queued: false, processed: true });
  } catch (error) {
    console.error("[tosend-webhook] processing enqueue failed", { type: error instanceof Error ? error.name : typeof error });
    return responseJson(response, queueRequired() ? 503 : 202, {
      accepted: !queueRequired(),
      error: queueRequired() ? "webhook_queue_unavailable" : "webhook_processing_deferred",
    });
  }
};

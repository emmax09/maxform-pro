import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  parseToSendWebhook,
  verifyToSendWebhookSignature,
} from "./tosend-webhook";

const payload = JSON.stringify({
  type: "bounced",
  data: {
    email: "recipient@example.com",
    message_id: "tosend-message-1",
    is_hard_bounce: true,
    reason: "smtp; 550 no such user",
    timestamp: "2026-08-06T10:00:00.000Z",
  },
  created_at: "2026-08-06T10:00:01.000Z",
});

describe("ToSend webhooks", () => {
  it("verifies the exact raw bytes with HMAC-SHA256", () => {
    const secret = "webhook-secret-123";
    const signature = `sha256=${createHmac("sha256", secret).update(Buffer.from(payload)).digest("hex")}`;
    expect(verifyToSendWebhookSignature(Buffer.from(payload), signature, secret)).toBe(true);
    expect(verifyToSendWebhookSignature(Buffer.from(`${payload} `), signature, secret)).toBe(false);
    expect(verifyToSendWebhookSignature(Buffer.from(payload), signature.slice(0, -1), secret)).toBe(false);
  });

  it("normalizes hard bounces for suppression and delivery reconciliation", () => {
    expect(parseToSendWebhook(payload, "bounced")).toMatchObject({
      eventType: "bounced",
      providerMessageId: "tosend-message-1",
      recipient: "recipient@example.com",
      hardBounce: true,
      reason: "smtp; 550 no such user",
    });
  });

  it("accepts complaints and rejects mismatched or unsupported events", () => {
    const complaint = JSON.stringify({ type: "complaint", data: { email: "recipient@example.com", message_id: "m-2", reason: "abuse" } });
    expect(parseToSendWebhook(complaint)).toMatchObject({ eventType: "complaint", hardBounce: false });
    expect(() => parseToSendWebhook(payload, "complaint")).toThrow(/does not match/);
    expect(() => parseToSendWebhook(JSON.stringify({ type: "delivered", data: {} }))).toThrow(/Unsupported/);
  });
});

import { describe, expect, it } from "vitest";

import { normaliseInbound } from "./email-inbound";

describe("email inbound payload normalisation", () => {
  it("normalises JSON provider payloads", () => {
    expect(normaliseInbound(JSON.stringify({
      MessageID: "provider-1",
      From: "Sender <sender@example.com>",
      To: "inbox@example.com",
      Subject: "Hello",
      TextBody: "Message body",
    }), "application/json")).toEqual({
      providerMessageId: "provider-1",
      sender: "Sender <sender@example.com>",
      recipient: "inbox@example.com",
      subject: "Hello",
      html: "",
      text: "Message body",
    });
  });

  it("unwraps an SNS-style JSON message", () => {
    expect(normaliseInbound(JSON.stringify({
      Message: JSON.stringify({
        mail: {
          messageId: "ses-1",
          commonHeaders: { from: ["sender@example.com"], to: ["inbox@example.com"], subject: "Reply" },
        },
        content: "ignored",
      }),
    }), "application/json")).toMatchObject({
      providerMessageId: "ses-1",
      sender: "sender@example.com",
      recipient: "inbox@example.com",
      subject: "Reply",
    });
  });
});

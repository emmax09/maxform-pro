import { describe, expect, it } from "vitest";

import { normaliseEvent } from "./email-events";

describe("email delivery-event normalisation", () => {
  it("normalises a delivered event", () => {
    expect(normaliseEvent(JSON.stringify({
      type: "email.delivered",
      data: { email_id: "provider-1" },
    }), "application/json")).toEqual({
      status: "delivered",
      providerMessageId: "provider-1",
    });
  });

  it("normalises a bounce event from a form payload", () => {
    expect(normaliseEvent("event=bounce&message_id=provider-2", "application/x-www-form-urlencoded")).toEqual({
      status: "bounced",
      providerMessageId: "provider-2",
    });
  });

  it("keeps the clicked destination from a Resend event", () => {
    expect(normaliseEvent(JSON.stringify({
      type: "email.clicked",
      data: { email_id: "provider-3", link: "https://example.com/offer" },
    }), "application/json")).toEqual({
      status: "clicked",
      providerMessageId: "provider-3",
      destination: "https://example.com/offer",
    });
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createEventTicketDownloadToken,
  parseEventTicketDownloadToken,
} from "./event-ticket-download";

const eventId = "12b60c13-a582-40fb-b70a-07e907e1a7f0";
const orderId = "9d8c0a9b-dc1b-4e7a-9f2d-3f7779e25e10";
const attendeeId = "e85db125-3453-4754-92c7-24dc23bca100";
const originalEnvironment = { ...process.env };

describe("public event ticket download tokens", () => {
  beforeEach(() => {
    process.env.EVENT_TICKET_DOWNLOAD_SECRET = "ticket-download-test-secret".repeat(3);
  });

  afterEach(() => {
    process.env = { ...originalEnvironment };
  });

  it("round-trips an opaque order-scoped token", () => {
    const token = createEventTicketDownloadToken({ eventId, orderId });

    expect(token).toMatch(/^mft1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(token).not.toContain(eventId);
    expect(parseEventTicketDownloadToken(token)).toEqual({
      version: 1,
      eventId,
      orderId,
      attendeeId: undefined,
    });
  });

  it("round-trips an attendee-scoped token and rejects tampering", () => {
    const token = createEventTicketDownloadToken({ eventId, attendeeId });
    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;

    expect(parseEventTicketDownloadToken(token)).toMatchObject({
      version: 1,
      eventId,
      attendeeId,
    });
    expect(parseEventTicketDownloadToken(tampered)).toBeNull();
  });

  it("does not create a token without an order or attendee scope", () => {
    expect(() => createEventTicketDownloadToken({ eventId })).toThrow(
      "INVALID_TICKET_SCOPE",
    );
  });
});

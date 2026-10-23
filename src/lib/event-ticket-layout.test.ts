import { describe, expect, it } from "vitest";

import type { TicketCanvasElement } from "@/components/events/event-types";
import {
  ensureTicketQr,
  normalizeTicketPrefix,
  suggestedTicketPrefix,
} from "@/lib/events";

describe("ticket QR layout guard", () => {
  it("adds a secure QR when a front layout does not contain one", () => {
    const layout: TicketCanvasElement[] = [
      {
        id: "event-name",
        type: "event_name",
        label: "Event name",
        x: 8,
        y: 12,
        width: 58,
      },
    ];

    const secured = ensureTicketQr(layout);

    expect(secured.some((element) => element.type === "qr")).toBe(true);
    expect(layout).toHaveLength(1);
  });

  it("keeps the QR fully inside the printable ticket surface", () => {
    const secured = ensureTicketQr([
      {
        id: "qr",
        type: "qr",
        label: "Secure QR",
        x: 98,
        y: 98,
        width: 80,
      },
    ]);
    const qr = secured.find((element) => element.type === "qr");

    // Width clamps to the printable maximum, and the square plus its number
    // and caption still fit above the bottom edge of a 2.6:1 ticket.
    expect(qr?.width).toBe(24);
    expect(qr?.x).toBeLessThanOrEqual(76);
    expect(qr?.y).toBeLessThanOrEqual(100 - 24 * 2.6 - 9);
  });

  it("gives a captionless QR the room it actually needs", () => {
    const secured = ensureTicketQr([
      {
        id: "qr",
        type: "qr",
        label: "Secure QR",
        x: 60,
        y: 90,
        width: 10,
        style: { hideCaption: true },
      },
    ]);
    const qr = secured.find((element) => element.type === "qr");

    expect(qr?.y).toBeCloseTo(100 - 10 * 2.6, 5);
  });
});

describe("event ticket prefix", () => {
  it("normalizes the organizer value into one uppercase trailing prefix", () => {
    expect(normalizeTicketPrefix(" vip-pass-- ")).toBe("VIPPASS-");
    expect(normalizeTicketPrefix("a")).toBe("A-");
  });

  it("creates a bounded suggestion from the event name", () => {
    expect(suggestedTicketPrefix("Lagos Product Summit")).toBe(
      "LAGOSPRO-",
    );
  });
});

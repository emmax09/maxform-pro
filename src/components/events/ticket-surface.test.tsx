// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type {
  EventTicketDesignTemplate,
  TicketCanvasElement,
} from "@/components/events/event-types";
import { TicketSurface } from "@/components/events/ticket-surface";
import {
  TICKET_MOTIFS,
  sampleTicketNumber,
  sampleTicketResolver,
  ticketLuminance,
  ticketMotifStyle,
  ticketRgba,
} from "@/lib/ticket-theme";
import { ensureTicketQr } from "@/lib/events";

const theme = (
  overrides: Partial<EventTicketDesignTemplate["theme"]> = {},
): EventTicketDesignTemplate["theme"] => ({
  background: "#0B0B0D",
  accent: "#F43F5E",
  text: "#FFFFFF",
  muted: "#A1A1AA",
  edge: "solid",
  motif: "none",
  backgroundImage: "",
  ...overrides,
});

const layout: TicketCanvasElement[] = [
  {
    id: "kicker",
    type: "custom_text",
    label: "ADMIT ONE",
    x: 7,
    y: 9,
    width: 48,
    size: "small",
  },
  {
    id: "attendee",
    type: "attendee_name",
    label: "Attendee",
    x: 7,
    y: 56,
    width: 59,
    size: "medium",
  },
  { id: "qr", type: "qr", label: "Secure QR", x: 73, y: 23, width: 19 },
];

describe("ticket colors", () => {
  it("derives motif tints from the template accent", () => {
    expect(ticketRgba("#F43F5E", 0.08)).toBe("rgba(244, 63, 94, 0.08)");
    expect(ticketRgba("#fff", 0.5)).toBe("rgba(255, 255, 255, 0.5)");
  });

  it("falls back to a neutral tint for an unusable color", () => {
    expect(ticketRgba("not-a-color", 0.2)).toBe("rgba(113, 113, 122, 0.2)");
  });

  it("separates dark ticket stock from light ticket stock", () => {
    expect(ticketLuminance("#0B0B0D")).toBeLessThan(0.45);
    expect(ticketLuminance("#F7F9FC")).toBeGreaterThan(0.45);
  });
});

describe("ticket motifs", () => {
  it("paints every motif offered in the designer", () => {
    for (const motif of TICKET_MOTIFS) {
      const style = ticketMotifStyle(theme({ motif: motif.value }));
      if (motif.value === "none") {
        expect(style).toBeNull();
        continue;
      }
      expect(style?.backgroundImage).toContain("rgba(244, 63, 94");
    }
  });

  it("ignores a motif the renderer does not know", () => {
    expect(ticketMotifStyle(theme({ motif: "sparkles" }))).toBeNull();
  });
});

describe("ticket surface", () => {
  it("renders a caption above the live value", () => {
    render(
      <TicketSurface
        elements={layout}
        qrValue="MAXFORM:TEST"
        resolve={sampleTicketResolver}
        side="front"
        theme={theme()}
        ticketNumber={sampleTicketNumber}
      />,
    );

    expect(screen.getByText("Attendee")).toBeInTheDocument();
    expect(screen.getByText("Sarah Johnson")).toBeInTheDocument();
    expect(screen.getByText("ADMIT ONE")).toBeInTheDocument();
    expect(screen.getByText(sampleTicketNumber)).toBeInTheDocument();
  });

  it("adds a tear-off stub only for a perforated ticket", () => {
    const { container, rerender } = render(
      <TicketSurface
        elements={layout}
        qrValue="MAXFORM:TEST"
        resolve={sampleTicketResolver}
        side="front"
        theme={theme({ edge: "solid" })}
        ticketNumber={sampleTicketNumber}
      />,
    );
    expect(container.querySelectorAll("[data-ticket-perforation]")).toHaveLength(
      0,
    );

    rerender(
      <TicketSurface
        elements={layout}
        qrValue="MAXFORM:TEST"
        resolve={sampleTicketResolver}
        side="front"
        theme={theme({ edge: "perforated" })}
        ticketNumber={sampleTicketNumber}
      />,
    );
    expect(
      container.querySelectorAll("[data-ticket-perforation]").length,
    ).toBeGreaterThan(0);
  });
});

describe("issued ticket identity", () => {
  it("adds a readable dynamic ticket-number block when the layout hides it", () => {
    const normalized = ensureTicketQr([
      {
        id: "secure-qr",
        type: "qr",
        label: "Secure QR",
        x: 70,
        y: 20,
        width: 18,
        style: { hideCaption: true },
      },
    ]);

    expect(normalized).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "ticket_number" }),
      ]),
    );
  });

  it("keeps the exact checkout-issued number visible on the ticket", () => {
    const issuedNumber = "VIP-7A91B20C4D33";
    const elements: TicketCanvasElement[] = [
      {
        id: "ticket-number",
        type: "ticket_number",
        label: "Ticket number",
        x: 7,
        y: 72,
        width: 45,
        size: "small",
      },
    ];

    render(
      <TicketSurface
        elements={elements}
        qrValue="MAXFORM:ISSUED"
        resolve={(element) => ({
          caption: element.label,
          text: issuedNumber,
        })}
        side="front"
        theme={theme()}
        ticketNumber={issuedNumber}
      />,
    );

    expect(screen.getByText(issuedNumber)).toBeInTheDocument();
  });
});

import type { CSSProperties } from "react";

import type {
  EventTicketDesignTemplate,
  TicketCanvasElement,
  TicketFontFamily,
} from "@/components/events/event-types";

export type TicketTheme = EventTicketDesignTemplate["theme"];

/**
 * Ticket proportions. A printed admission ticket is a long landscape strip,
 * not a card, so width : height is set from the reference ticket artwork.
 */
export const TICKET_ASPECT = 2.6;

/** Where the tear-off stub starts on a perforated ticket, in percent. */
export const TICKET_STUB_X = 74;

const FONT_STACKS = {
  sans: "Inter, -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
  display: "Geist, Inter, system-ui, sans-serif",
  serif: "Georgia, 'Iowan Old Style', 'Times New Roman', serif",
  mono: "ui-monospace, SFMono-Regular, 'JetBrains Mono', Menlo, monospace",
} as const;

export const ticketFontStack = (family: TicketFontFamily | undefined) =>
  family && family !== "inherit" ? FONT_STACKS[family] : undefined;

export const TICKET_MOTIFS: Array<{ value: string; label: string }> = [
  { value: "none", label: "None" },
  { value: "grid", label: "Grid" },
  { value: "dots", label: "Dot matrix" },
  { value: "rule", label: "Ruled lines" },
  { value: "bars", label: "Diagonal bars" },
  { value: "stripes", label: "Vertical stripes" },
  { value: "chevron", label: "Chevron" },
  { value: "blocks", label: "Color blocks" },
  { value: "carbon", label: "Carbon weave" },
  { value: "waves", label: "Waves" },
  { value: "rays", label: "Sunburst" },
  { value: "topo", label: "Topographic" },
  { value: "confetti", label: "Confetti" },
  { value: "monogram", label: "Monogram rings" },
];

const channels = (hex: string) => {
  const value = (hex || "").trim().replace("#", "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((character) => character + character)
          .join("")
      : value;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [0, 2, 4].map((offset) => parseInt(full.slice(offset, offset + 2), 16));
};

export const ticketRgba = (hex: string, alpha: number) => {
  const parsed = channels(hex);
  if (!parsed) return `rgba(113, 113, 122, ${alpha})`;
  return `rgba(${parsed[0]}, ${parsed[1]}, ${parsed[2]}, ${alpha})`;
};

/** Perceived brightness on a 0-1 scale, used to keep hairlines visible. */
export const ticketLuminance = (hex: string) => {
  const parsed = channels(hex);
  if (!parsed) return 1;
  const [red, green, blue] = parsed.map((value) => value / 255);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

export const ticketMotifStyle = (theme: TicketTheme): CSSProperties | null => {
  // Dark ticket stock swallows a tint, so the same motif needs more alpha
  // there to stay a texture rather than disappear.
  const boost = ticketLuminance(theme.background) < 0.45 ? 1.9 : 1;
  const faint = ticketRgba(theme.accent, 0.035 * boost);
  const soft = ticketRgba(theme.accent, 0.055 * boost);
  const strong = ticketRgba(theme.accent, 0.085 * boost);
  switch (theme.motif) {
    case "grid":
      return {
        backgroundImage: `linear-gradient(${soft} 1px, transparent 1px), linear-gradient(90deg, ${soft} 1px, transparent 1px)`,
        backgroundSize: "22px 22px",
      };
    case "dots":
      return {
        backgroundImage: `radial-gradient(${strong} 1.1px, transparent 1.2px)`,
        backgroundSize: "14px 14px",
      };
    case "rule":
      return {
        backgroundImage: `repeating-linear-gradient(0deg, transparent 0 21px, ${soft} 21px 22px)`,
      };
    case "bars":
      return {
        backgroundImage: `repeating-linear-gradient(135deg, transparent 0 18px, ${soft} 18px 21px)`,
      };
    case "stripes":
      return {
        backgroundImage: `repeating-linear-gradient(90deg, ${faint} 0 6px, transparent 6px 16px)`,
      };
    case "chevron":
      return {
        backgroundImage: `repeating-linear-gradient(45deg, ${soft} 0 2px, transparent 2px 14px), repeating-linear-gradient(-45deg, ${faint} 0 2px, transparent 2px 14px)`,
      };
    case "blocks":
      return {
        backgroundImage: `repeating-linear-gradient(90deg, ${soft} 0 14px, transparent 14px 28px), repeating-linear-gradient(0deg, ${faint} 0 14px, transparent 14px 28px)`,
      };
    case "carbon":
      return {
        backgroundImage: `repeating-linear-gradient(45deg, ${soft} 0 1px, transparent 1px 5px), repeating-linear-gradient(-45deg, ${faint} 0 1px, transparent 1px 5px)`,
      };
    case "waves":
      return {
        backgroundImage: `radial-gradient(circle at 50% 100%, transparent 66%, ${soft} 67%, ${soft} 69%, transparent 70%)`,
        backgroundSize: "46px 24px",
      };
    case "rays":
      return {
        backgroundImage: `repeating-conic-gradient(from 200deg at 96% 6%, ${faint} 0deg 3deg, transparent 3deg 11deg)`,
      };
    case "topo":
      return {
        backgroundImage: `repeating-radial-gradient(ellipse at 22% 118%, transparent 0 26px, ${soft} 26px 27px)`,
      };
    case "confetti":
      return {
        backgroundImage: `radial-gradient(${strong} 1.6px, transparent 1.8px), radial-gradient(${soft} 2.4px, transparent 2.6px), radial-gradient(${faint} 1.2px, transparent 1.4px)`,
        backgroundSize: "56px 56px, 84px 84px, 38px 38px",
        backgroundPosition: "0 0, 22px 34px, 44px 12px",
      };
    case "monogram":
      return {
        backgroundImage: `repeating-radial-gradient(circle at 88% 84%, transparent 0 15px, ${soft} 15px 16px)`,
      };
    default:
      return null;
  }
};

export type TicketElementValue = {
  caption?: string;
  text?: string;
};

export type TicketElementResolver = (
  element: TicketCanvasElement,
) => TicketElementValue;

const SAMPLE = {
  eventName: "Maxform Connect 2026",
  eventTagline: "Innovation Summit & User Conference",
  eventDetails: "Sat 17 Oct · 9:00 AM · Eko Convention Centre",
  eventDate: "Saturday, October 17, 2026",
  eventTime: "9:00 AM – 6:00 PM",
  venue: "Eko Convention Centre",
  address: "Victoria Island, Lagos",
  organizer: "Maxform Events",
  attendee: "Sarah Johnson",
  attendeeEmail: "hello@maxform.com",
  ticketType: "VIP Pass",
  ticketPrice: "₦25,000",
  ticketNumber: "MF26-VIP-A12-03",
  orderCode: "ORD-4821-7735",
  eventCode: "MF26",
  terms:
    "This ticket is non-transferable. Please present a valid ID with your ticket at entry.",
};

export const sampleTicketNumber = SAMPLE.ticketNumber;

/** Preview values used when a template is shown outside a real event. */
export const sampleTicketResolver: TicketElementResolver = (element) => {
  const captioned = (text: string) => ({ caption: element.label, text });
  switch (element.type) {
    case "event_name":
      return { text: SAMPLE.eventName };
    case "event_tagline":
      return { text: SAMPLE.eventTagline };
    case "event_details":
      return captioned(SAMPLE.eventDetails);
    case "event_date":
      return captioned(SAMPLE.eventDate);
    case "event_time":
      return captioned(SAMPLE.eventTime);
    case "venue":
      return captioned(SAMPLE.venue);
    case "address":
      return captioned(SAMPLE.address);
    case "organizer":
      return captioned(SAMPLE.organizer);
    case "attendee_name":
      return captioned(SAMPLE.attendee);
    case "attendee_email":
      return captioned(SAMPLE.attendeeEmail);
    case "ticket_type":
      return captioned(SAMPLE.ticketType);
    case "ticket_price":
      return captioned(SAMPLE.ticketPrice);
    case "ticket_number":
      return captioned(SAMPLE.ticketNumber);
    case "order_code":
      return captioned(SAMPLE.orderCode);
    case "event_code":
      return captioned(SAMPLE.eventCode);
    case "terms":
      return { text: element.label || SAMPLE.terms };
    default:
      return { text: element.label || "Custom text" };
  }
};

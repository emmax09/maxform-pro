import type {
  EventTicketDesignTemplate,
  TicketCanvasElement,
  TicketElementStyle,
  TicketElementType,
} from "@/components/events/event-types";
import { TICKET_ASPECT } from "@/lib/ticket-theme";

export type TicketSide = "front" | "back";
export type TicketLayoutKey = "frontLayout" | "backLayout";

export const layoutKeyFor = (side: TicketSide): TicketLayoutKey =>
  side === "front" ? "frontLayout" : "backLayout";

export const TICKET_ELEMENT_LABELS: Record<TicketElementType, string> = {
  event_name: "Event name",
  event_tagline: "Tagline",
  event_details: "Date & venue",
  event_date: "Date",
  event_time: "Time",
  venue: "Venue",
  address: "Address",
  organizer: "Organizer",
  attendee_name: "Attendee",
  attendee_email: "Attendee email",
  ticket_type: "Purchased ticket type",
  ticket_price: "Price",
  ticket_number: "Ticket number",
  order_code: "Order code",
  event_code: "Event code",
  qr: "Secure QR",
  barcode: "Barcode",
  logo: "Logo",
  image: "Image",
  custom_text: "Custom text",
  terms: "Terms",
  panel: "Panel",
  divider: "Divider",
};

/** Types whose text comes from the live event, attendee, or ticket record. */
export const TICKET_BOUND_TYPES: TicketElementType[] = [
  "event_name",
  "event_tagline",
  "event_details",
  "event_date",
  "event_time",
  "venue",
  "address",
  "organizer",
  "attendee_name",
  "attendee_email",
  "ticket_type",
  "ticket_price",
  "ticket_number",
  "order_code",
  "event_code",
];

export const isBoundElement = (element: TicketCanvasElement) =>
  TICKET_BOUND_TYPES.includes(element.type);

const CAPTIONED: TicketElementType[] = [
  "event_details",
  "event_date",
  "event_time",
  "venue",
  "address",
  "organizer",
  "attendee_name",
  "attendee_email",
  "ticket_type",
  "ticket_price",
  "ticket_number",
  "order_code",
  "event_code",
];

export const hasCaption = (element: TicketCanvasElement) =>
  CAPTIONED.includes(element.type);

export const defaultWidthFor = (type: TicketElementType) => {
  switch (type) {
    case "qr":
      return 11;
    case "barcode":
      return 20;
    case "logo":
      return 14;
    case "image":
      return 20;
    case "panel":
      return 100;
    case "divider":
      return 14;
    case "terms":
      return 34;
    case "event_name":
      return 46;
    default:
      return 30;
  }
};

export const defaultSizeFor = (
  type: TicketElementType,
): TicketCanvasElement["size"] =>
  type === "event_name"
    ? "large"
    : type === "attendee_name" || type === "event_tagline"
      ? "medium"
      : "small";

/** Height of an element as a share of the ticket height, used for snapping. */
export const approximateHeight = (element: TicketCanvasElement) => {
  if (element.type === "panel") return element.style?.height ?? 20;
  if (element.type === "divider") return 1;
  if (element.type === "qr") {
    return element.width * TICKET_ASPECT * (element.style?.hideCaption ? 1 : 1.3);
  }
  if (element.type === "barcode") return element.style?.height ?? 26;
  if (element.type === "logo") return 14;
  if (element.type === "image") return element.width * 0.75 * TICKET_ASPECT;
  const line =
    element.size === "large" ? 12.6 : element.size === "medium" ? 7.2 : 5.4;
  const caption = hasCaption(element) && !element.style?.hideCaption ? 4.4 : 0;
  return line + caption;
};

export const clampElement = (
  element: TicketCanvasElement,
): TicketCanvasElement => {
  const width =
    element.type === "qr"
      ? Math.max(5, Math.min(24, element.width))
      : Math.max(2, Math.min(100, element.width));
  return {
    ...element,
    width,
    x: Math.max(0, Math.min(100 - width, element.x)),
    y: Math.max(0, Math.min(99, element.y)),
  };
};

export const round = (value: number, decimals = 1) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/** Strips keys that are empty so an untouched element stays free of style noise. */
export const cleanElementStyle = (
  style: TicketElementStyle,
): TicketElementStyle | undefined => {
  const next: TicketElementStyle = { ...style };
  (Object.keys(next) as Array<keyof TicketElementStyle>).forEach((key) => {
    const value = next[key];
    if (
      value == null ||
      value === "" ||
      value === false ||
      (typeof value === "number" && Number.isNaN(value))
    ) {
      delete next[key];
    }
  });
  return Object.keys(next).length ? next : undefined;
};

export const templateElementCount = (template: EventTicketDesignTemplate) =>
  template.frontLayout.length + template.backLayout.length;

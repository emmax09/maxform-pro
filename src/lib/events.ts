import {
  defaultFormSettings,
  defaultPayment,
  type FormField,
  type FormRecord,
} from "../components/forms/form-types";
import {
  defaultPreloaderSettings,
  normalizePreloaderSettings,
} from "../components/shared/preloader-config";
import type {
  EventAttendee,
  EventBranding,
  EventCheckedInPage,
  EventDailySchedule,
  EventDiscountRule,
  EventModulePreferences,
  EventPricing,
  EventRecord,
  EventScan,
  EventSectionContent,
  EventSectionKey,
  EventSeo,
  EventTemplate,
  EventTicketDesign,
  EventTicketDesignTemplate,
  EventTicketType,
  PublicTicketValidatorInfo,
  TicketValidationResult,
  TicketCanvasElement,
  WorkspaceTicketValidatorLink,
} from "../components/events/event-types";
import { query, type QueryResult } from "./db";
import { TICKET_ASPECT } from "./ticket-theme";
import {
  deactivateEventTicketPaymentProduct,
  hasConnectedPaymentProvider,
  syncEventTicketPaymentProduct,
} from "./payments";
import {
  createWorkspaceForm,
  deleteWorkspaceForm,
  listWorkspaceForms,
  saveWorkspaceForm,
} from "./forms";
import { compare, hash } from "bcrypt-ts";
import {
  DEFAULT_WORKSPACE_ACCENT,
  LEGACY_EVENT_ACCENTS,
  inferAccentColorMode,
  resolveAccentColor,
  workspaceAccentColor,
} from "./workspace-branding";

type DatabaseRow = Record<string, unknown>;

type EventsServerDependencies = {
  deactivateTicketProduct: (
    userId: string,
    ticketTypeId: string,
  ) => Promise<unknown>;
  hasConnectedPaymentProvider: typeof hasConnectedPaymentProvider;
  issueStoredTicket: (
    eventId: string,
    attendeeId: string,
  ) => Promise<Record<string, unknown> | null>;
  syncTicketProduct: (
    userId: string,
    ticketTypeId: string,
  ) => Promise<unknown>;
  createMeeting?: (
    userId: string,
    eventId: string,
    provider: "google_meet" | "teams" | "zoom",
    previousIntegration?: DatabaseRow | null,
  ) => Promise<Record<string, unknown>>;
  cancelMeeting?: (
    userId: string,
    eventId: string,
    previousIntegration?: DatabaseRow | null,
  ) => Promise<Record<string, unknown>>;
  sendEventCancellationEmails?: (
    eventId: string,
  ) => Promise<void>;
  sendEventUpdateEmails?: (
    eventId: string,
    kind: "event_updated" | "event_rescheduled",
  ) => Promise<void>;
  sendEventReminderEmails?: (
    eventId: string,
  ) => Promise<void>;
  sendEventAttendeeEmails?: (
    eventId: string,
    attendeeId: string,
    paid?: boolean,
  ) => Promise<void>;
  sendEventWaitlistEmail?: (
    eventId: string,
    waitlistId: string,
    kind: "event_waitlist_confirmation" | "event_waitlist_promoted",
  ) => Promise<void>;
};

let eventsServerDependencies: EventsServerDependencies | null = null;

export const configureEventsServerDependencies = (
  dependencies: EventsServerDependencies,
) => {
  eventsServerDependencies = dependencies;
};

const browserRuntime = () => typeof window !== "undefined";

const eventsDataRequest = async <T>(
  operation: string,
  args: Record<string, unknown> = {},
) => {
  const token =
    typeof localStorage === "undefined"
      ? ""
      : localStorage.getItem("access_token") || "";
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);
  let response: Response;
  try {
    response = await fetch("/api/events/data", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ operation, args }),
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("The events request took too long. Please try again.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
  const result = (await response.json().catch(() => ({}))) as {
    error?: string;
    value?: T;
  };
  if (!response.ok) {
    throw new Error(result.error || "Events could not be loaded.");
  }
  return result.value as T;
};

const eventRpc = <T>(
  operation: string,
  args: Record<string, unknown> = {},
) => eventsDataRequest<T>(operation, args);

const eventPaymentProviderConnected = (
  ...args: Parameters<typeof hasConnectedPaymentProvider>
) =>
  eventsServerDependencies
    ? eventsServerDependencies.hasConnectedPaymentProvider(...args)
    : hasConnectedPaymentProvider(...args);

const syncTicketPaymentProduct = (userId: string, ticketTypeId: string) =>
  eventsServerDependencies
    ? eventsServerDependencies.syncTicketProduct(userId, ticketTypeId)
    : syncEventTicketPaymentProduct(userId, ticketTypeId);

const deactivateTicketPaymentProduct = (
  userId: string,
  ticketTypeId: string,
) =>
  eventsServerDependencies
    ? eventsServerDependencies.deactivateTicketProduct(userId, ticketTypeId)
    : deactivateEventTicketPaymentProduct(userId, ticketTypeId);

const asString = (value: unknown) =>
  typeof value === "string" ? value : value == null ? "" : String(value);

const asDateOnly = (value: unknown) => {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const asNumber = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const asBoolean = (value: unknown) =>
  value === true || value === "true" || value === 1;

function asJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return typeof value === "object" ? (value as T) : fallback;
}

export const normalizeEventSlug = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

export const normalizeTicketPrefix = (value: string) => {
  const core = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);
  return core ? `${core}-` : "";
};

export const suggestedTicketPrefix = (value: string) => {
  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return normalizeTicketPrefix(compact.slice(0, 8) || "TKT");
};

const validCalendarDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(new Date(`${value}T00:00:00`).getTime());

const validTime = (value: string) =>
  /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);

const timeMinutes = (value: string) => {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
};

const validDailyTime = (startTime: string, endTime: string) =>
  validTime(startTime) &&
  (!endTime ||
    (validTime(endTime) && timeMinutes(endTime) > timeMinutes(startTime)));

export const buildEventDateRange = (
  startDate: string,
  endDate: string,
  maximumDays = 366,
) => {
  if (!validCalendarDate(startDate) || !validCalendarDate(endDate)) return [];
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (end < start) return [];
  const dates: string[] = [];
  const current = new Date(start);
  while (current <= end && dates.length < maximumDays) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
};

const defaultBranding = (
  accentColor = DEFAULT_WORKSPACE_ACCENT,
): EventBranding => ({
  accentColor,
  accentColorMode: "workspace",
  backgroundColor: "#F8FAFC",
  borderColor: "#E4E7EC",
  bodyFontSize: "medium",
  buttonTextColor: "#FFFFFF",
  contentWidth: "standard",
  cornerRadius: 8,
  coverImageUrl: "",
  fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
  headingFontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
  headingWeight: 600,
  heroAlignment: "left",
  heroBackgroundColor: "#101828",
  heroHeight: "standard",
  heroOverlayOpacity: 45,
  heroTextColor: "#FFFFFF",
  logoUrl: "",
  mutedTextColor: "#667085",
  preloader: defaultPreloaderSettings(),
  surfaceColor: "#FFFFFF",
  textColor: "#101828",
});

const normalizeEventBranding = (
  value: unknown,
  workspaceAccent: unknown = DEFAULT_WORKSPACE_ACCENT,
): EventBranding => {
  const effectiveWorkspaceAccent = workspaceAccentColor(workspaceAccent);
  const defaults = defaultBranding(effectiveWorkspaceAccent);
  const branding = asJson<Partial<EventBranding>>(value, {});
  const accentColorMode =
    branding.accentColorMode === "custom" ||
    branding.accentColorMode === "workspace"
      ? branding.accentColorMode
      : inferAccentColorMode(
          branding.accentColor,
          effectiveWorkspaceAccent,
          LEGACY_EVENT_ACCENTS,
        );
  return {
    ...defaults,
    ...branding,
    accentColorMode,
    accentColor: resolveAccentColor(
      branding.accentColor,
      effectiveWorkspaceAccent,
      branding.accentColorMode || accentColorMode,
      LEGACY_EVENT_ACCENTS,
    ),
    preloader: normalizePreloaderSettings(branding.preloader),
  };
};

const defaultSeo = (): EventSeo => ({
  title: "",
  description: "",
  shareImageUrl: "",
});

const defaultSections: EventSectionKey[] = [];

export const defaultEventPricing = (currency = "USD"): EventPricing => ({
  enabled: false,
  amount: 0,
  currency: currency.toUpperCase(),
  label: "Registration fee",
  salesStart: "",
  salesEnd: "",
  taxIncluded: false,
  couponsEnabled: false,
  discountsEnabled: false,
});

export type EventPublishRequirement = {
  id: string;
  label: string;
  complete: boolean;
  tab: "details" | "registration" | "pricing" | "ticket_types" | "settings";
};

const selectedEventMeetingProvider = (event: EventRecord) => {
  const meetingIntegration = event.settings?.meetingIntegration;
  if (!meetingIntegration || typeof meetingIntegration !== "object") return "manual";
  return String((meetingIntegration as Record<string, unknown>).provider || "manual") || "manual";
};

export const isValidEventMeetingUrl = (value: string, allowInsecure = false) => {
  const candidate = value.trim();
  if (!candidate) return false;
  try {
    const protocol = new URL(candidate).protocol;
    return protocol === "https:" || (allowInsecure && protocol === "http:");
  } catch {
    return false;
  }
};

const eventScheduleInstants = (event: EventRecord) => {
  const startDate = event.scheduleType === "date_range" ? event.rangeStartDate : event.eventDate;
  const endDate = event.scheduleType === "date_range" ? event.rangeEndDate || startDate : startDate;
  const firstDaily = event.dailySchedule.find((item) => item.date === startDate);
  const lastDaily = [...event.dailySchedule].reverse().find((item) => item.date === endDate);
  const startTime = event.scheduleType === "date_range" && event.rangeScheduleMode === "daily"
    ? firstDaily?.startTime || event.startTime
    : event.startTime;
  const endTime = event.scheduleType === "date_range" && event.rangeScheduleMode === "daily"
    ? lastDaily?.endTime || event.endTime
    : event.endTime;
  if (!startDate || !startTime) return { startsAt: null, endsAt: null };
  try {
    const offset = (timestamp: number) => {
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone: event.timezone || "UTC", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(timestamp));
      const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
      return Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute), Number(values.second)) - timestamp;
    };
    const toUtc = (date: string, time: string) => {
      const local = Date.parse(`${date}T${time}:00.000Z`);
      if (!Number.isFinite(local)) return null;
      let guess = local;
      for (let index = 0; index < 4; index += 1) guess = local - offset(guess);
      return new Date(guess).toISOString();
    };
    return { startsAt: toUtc(startDate, startTime), endsAt: endDate && endTime ? toUtc(endDate, endTime) : null };
  } catch {
    return { startsAt: null, endsAt: null };
  }
};

export function getEventPublishRequirements(
  event: EventRecord,
  ticketTypeCount = event.ticketTypeCount,
): EventPublishRequirement[] {
  const rangeDates = buildEventDateRange(
    event.rangeStartDate,
    event.rangeEndDate,
  );
  const hasValidSchedule =
    event.scheduleType === "single_day"
      ? validCalendarDate(event.eventDate) &&
        validDailyTime(event.startTime, event.endTime)
      : rangeDates.length > 1 &&
        (event.rangeScheduleMode === "continuous"
          ? validTime(event.startTime) && validTime(event.endTime)
          : rangeDates.every((date) => {
              const schedule = event.dailySchedule.find(
                (item) => item.date === date,
              );
              return Boolean(
                schedule &&
                  validDailyTime(schedule.startTime, schedule.endTime),
              );
            }));
  const hasPhysicalLocation = Boolean(
    event.venueName.trim() && event.address.trim(),
  );
  const meetingProvider = selectedEventMeetingProvider(event);
  const hasOnlineMeeting = meetingProvider !== "manual"
    ? Boolean(event.onlineUrl.trim()) || ["google_meet", "teams", "zoom"].includes(meetingProvider)
    : isValidEventMeetingUrl(event.onlineUrl);
  const hasLocation =
    event.locationType === "physical"
      ? hasPhysicalLocation
      : event.locationType === "online"
        ? hasOnlineMeeting
        : Boolean(hasPhysicalLocation && hasOnlineMeeting);
  const requirements: EventPublishRequirement[] = [
    {
      id: "title",
      label: "Event name",
      complete: event.title.trim().length >= 3,
      tab: "details",
    },
    {
      id: "description",
      label: "Event description",
      complete: event.description.trim().length >= 20,
      tab: "details",
    },
    {
      id: "schedule",
      label:
        event.scheduleType === "single_day"
          ? "Event date and start time"
          : event.rangeScheduleMode === "daily"
            ? "Daily event schedule"
            : "Valid event date range and times",
      complete: hasValidSchedule,
      tab: "details",
    },
    {
      id: "location",
      label:
        event.locationType === "hybrid"
          ? "Venue and online meeting"
          : event.locationType === "online"
            ? "Online meeting or link"
            : "Venue name and address",
      complete: hasLocation,
      tab: "details",
    },
    {
      id: "sections",
      label: "At least one public page section",
      complete: event.publicSections.length > 0,
      tab: "details",
    },
    {
      id: "registration",
      label: "Linked registration form",
      complete: Boolean(event.registrationFormId),
      tab: "registration",
    },
    {
      id: "slug",
      label: "Public event URL",
      complete: normalizeEventSlug(event.slug).length >= 3,
      tab: "settings",
    },
  ];
  if (event.accessControl === "password") {
    requirements.push({
      id: "access-password",
      label: "Event access password",
      complete:
        event.accessPassword.trim().length >= 6 || event.accessPasswordSet,
      tab: "settings",
    });
  }
  if (event.accessControl === "invite_only") {
    requirements.push({
      id: "invite-link",
      label: "Invitation link",
      complete: event.inviteToken.trim().length >= 16,
      tab: "settings",
    });
  }
  if (event.ticketingEnabled) {
    requirements.push(
      {
        id: "ticket-prefix",
        label: "Confirmed ticket prefix",
        complete:
          event.ticketPrefixConfigured &&
          normalizeTicketPrefix(event.ticketPrefix).length >= 3,
        tab: "settings",
      },
      {
        id: "ticket-types",
        label: "At least one active ticket type",
        complete: ticketTypeCount > 0,
        tab: "ticket_types",
      },
    );
  } else if (event.pricing.enabled) {
    requirements.push({
      id: "registration-price",
      label: "Registration price",
      complete:
        event.pricing.amount > 0 &&
        /^[A-Z]{3}$/.test(event.pricing.currency),
      tab: "pricing",
    });
  }
  return requirements;
}

export function getEventDiscountRuleIssue(rule: EventDiscountRule) {
  if (!rule.name.trim()) return "Add a name for this discount.";
  if (rule.value <= 0) return "Discount value must be greater than zero.";
  if (rule.valueType === "percentage" && rule.value > 100) {
    return "Percentage discounts cannot exceed 100%.";
  }
  if (rule.mode === "first_n" && rule.firstN < 1) {
    return "Set how many early registrations receive this discount.";
  }
  if (rule.mode === "group_size" && rule.minQuantity < 2) {
    return "Group discounts require at least two registrations.";
  }
  if (rule.mode === "promo_code" && !rule.code.trim()) {
    return "Add the promo code attendees will enter.";
  }
  if (
    rule.mode === "date_window" &&
    (!rule.startsAt ||
      !rule.endsAt ||
      new Date(rule.endsAt) <= new Date(rule.startsAt))
  ) {
    return "Choose a valid discount start and end time.";
  }
  return "";
}

export const defaultEventSectionContent = (): EventSectionContent => ({
  about: {
    heading: "About this event",
    body: "",
  },
  agenda: [],
  speakers: [],
  sponsors: [],
  faq: [],
  venue: {
    name: "",
    address: "",
    directions: "",
    mapUrl: "",
  },
});

export const defaultEventModulePreferences = (
  timezone = "UTC",
): EventModulePreferences => ({
  organizerName: "",
  replyToEmail: "",
  supportEmail: "",
  defaultTimezone: timezone,
  defaultAccessControl: "public",
  defaultTicketingEnabled: false,
  defaultWaitlistEnabled: false,
  defaultRefundPolicy: "",
  registrationConfirmation:
    "You are registered. Event details have been sent to your email.",
});

// Matches the system ticket gallery: a long admission ticket with a dark
// body, an admission bar, a QR, and a tear-off stub carrying the barcode.
const defaultFrontLayout = (): TicketCanvasElement[] =>
  [
  {
    "id": "body-panel",
    "type": "panel",
    "label": "Panel",
    "x": 0,
    "y": 0,
    "width": 74,
    "style": {
      "backgroundColor": "#1C1C1E",
      "height": 100
    }
  },
  {
    "id": "stub-panel",
    "type": "panel",
    "label": "Panel",
    "x": 74,
    "y": 0,
    "width": 26,
    "style": {
      "backgroundColor": "#F7F5F0",
      "height": 100
    }
  },
  {
    "id": "admit-bar",
    "type": "panel",
    "label": "Panel",
    "x": 0,
    "y": 78,
    "width": 74,
    "style": {
      "backgroundColor": "#111113",
      "height": 22
    }
  },
  {
    "id": "event-name",
    "type": "event_name",
    "label": "Event name",
    "x": 4,
    "y": 22,
    "width": 46,
    "size": "large",
    "style": {
      "textColor": "#FFFFFF",
      "fontWeight": 800,
      "textTransform": "uppercase",
      "hideCaption": true,
      "lineHeight": 96
    }
  },
  {
    "id": "event-tagline",
    "type": "event_tagline",
    "label": "Tagline",
    "x": 4,
    "y": 46,
    "width": 44,
    "size": "small",
    "style": {
      "textColor": "#A1A1AA",
      "fontScale": 112
    }
  },
  {
    "id": "event-date",
    "type": "event_date",
    "label": "Date",
    "x": 4,
    "y": 65,
    "width": 30,
    "size": "small",
    "style": {
      "showIcon": true,
      "hideCaption": true,
      "textColor": "#FFFFFF",
      "captionColor": "#F93D0A",
      "fontWeight": 500
    }
  },
  {
    "id": "venue",
    "type": "venue",
    "label": "Venue",
    "x": 4,
    "y": 71.5,
    "width": 30,
    "size": "small",
    "style": {
      "showIcon": true,
      "hideCaption": true,
      "textColor": "#FFFFFF",
      "captionColor": "#F93D0A",
      "fontWeight": 500
    }
  },
  {
    "id": "admit",
    "type": "custom_text",
    "label": "Admit one",
    "x": 4,
    "y": 85,
    "width": 14,
    "size": "small",
    "style": {
      "textColor": "#F93D0A",
      "letterSpacing": 16,
      "textTransform": "uppercase",
      "fontWeight": 700,
      "fontScale": 88
    }
  },
  {
    "id": "attendee",
    "type": "attendee_name",
    "label": "Attendee",
    "x": 22,
    "y": 82,
    "width": 18,
    "size": "small",
    "style": {
      "textColor": "#FFFFFF",
      "captionColor": "#A1A1AA",
      "fontWeight": 600
    }
  },
  {
    "id": "ticket-type",
    "type": "ticket_type",
    "label": "Ticket",
    "x": 43,
    "y": 82,
    "width": 16,
    "size": "small",
    "style": {
      "textColor": "#FFFFFF",
      "captionColor": "#A1A1AA",
      "fontWeight": 600
    }
  },
  {
    "id": "qr",
    "type": "qr",
    "label": "Secure QR",
    "x": 60,
    "y": 40,
    "width": 10,
    "style": {
      "hideCaption": true,
      "borderRadius": 8
    }
  },
  {
    "id": "stub-name",
    "type": "event_name",
    "label": "Event name",
    "x": 77,
    "y": 14,
    "width": 20,
    "size": "small",
    "style": {
      "textColor": "#18181B",
      "fontWeight": 800,
      "textTransform": "uppercase",
      "hideCaption": true,
      "fontScale": 128,
      "lineHeight": 112
    }
  },
  {
    "id": "stub-rule",
    "type": "divider",
    "label": "Divider",
    "x": 77,
    "y": 34,
    "width": 12,
    "style": {
      "textColor": "#F93D0A",
      "borderWidth": 3
    }
  },
  {
    "id": "stub-type",
    "type": "ticket_type",
    "label": "Ticket",
    "x": 77,
    "y": 40,
    "width": 20,
    "size": "small",
    "style": {
      "textColor": "#F93D0A",
      "hideCaption": true,
      "letterSpacing": 12,
      "textTransform": "uppercase",
      "fontWeight": 700
    }
  },
  {
    "id": "barcode",
    "type": "barcode",
    "label": "Barcode",
    "x": 77,
    "y": 52,
    "width": 20,
    "style": {
      "height": 30,
      "textColor": "#18181B"
    }
  }
] as TicketCanvasElement[];

const defaultBackLayout = (): TicketCanvasElement[] =>
  [
  {
    "id": "body-panel",
    "type": "panel",
    "label": "Panel",
    "x": 0,
    "y": 0,
    "width": 74,
    "style": {
      "backgroundColor": "#F7F5F0",
      "height": 100
    }
  },
  {
    "id": "stub-panel",
    "type": "panel",
    "label": "Panel",
    "x": 74,
    "y": 0,
    "width": 26,
    "style": {
      "backgroundColor": "#1C1C1E",
      "height": 100
    }
  },
  {
    "id": "back-title",
    "type": "custom_text",
    "label": "Ticket details",
    "x": 4,
    "y": 24,
    "width": 34,
    "size": "medium",
    "style": {
      "textColor": "#18181B",
      "fontWeight": 800,
      "textTransform": "uppercase",
      "fontScale": 108
    }
  },
  {
    "id": "title-rule",
    "type": "divider",
    "label": "Divider",
    "x": 4,
    "y": 36,
    "width": 8,
    "style": {
      "textColor": "#F93D0A",
      "borderWidth": 3
    }
  },
  {
    "id": "event-time",
    "type": "event_time",
    "label": "Doors",
    "x": 4,
    "y": 46,
    "width": 32,
    "size": "small",
    "style": {
      "showIcon": true,
      "hideCaption": true,
      "textColor": "#18181B",
      "captionColor": "#F93D0A",
      "fontWeight": 500
    }
  },
  {
    "id": "venue-back",
    "type": "venue",
    "label": "Venue",
    "x": 4,
    "y": 55,
    "width": 32,
    "size": "small",
    "style": {
      "showIcon": true,
      "hideCaption": true,
      "textColor": "#18181B",
      "captionColor": "#F93D0A",
      "fontWeight": 500
    }
  },
  {
    "id": "order",
    "type": "order_code",
    "label": "Order",
    "x": 4,
    "y": 64,
    "width": 32,
    "size": "small",
    "style": {
      "showIcon": true,
      "hideCaption": true,
      "textColor": "#18181B",
      "captionColor": "#F93D0A",
      "fontWeight": 500
    }
  },
  {
    "id": "terms",
    "type": "terms",
    "label": "Terms & refund policy",
    "x": 40,
    "y": 46,
    "width": 30,
    "size": "small",
    "style": {
      "textColor": "#52525B",
      "fontScale": 92,
      "lineHeight": 150
    }
  },
  {
    "id": "qr-back",
    "type": "qr",
    "label": "Secure QR",
    "x": 79,
    "y": 16,
    "width": 16,
    "style": {
      "hideCaption": true,
      "borderRadius": 8
    }
  },
  {
    "id": "barcode-back",
    "type": "barcode",
    "label": "Barcode",
    "x": 77,
    "y": 62,
    "width": 20,
    "style": {
      "height": 26,
      "textColor": "#FFFFFF"
    }
  }
] as TicketCanvasElement[];

export const ensureTicketQr = (layout: TicketCanvasElement[]) => {
  const next = structuredClone(layout);
  const withQr = next.some((element) => element.type === "qr")
    ? next
    : [
        ...next,
        {
          id: "secure-qr",
          type: "qr" as const,
          label: "Secure QR",
          x: 60,
          y: 22,
          width: 11,
        },
      ];
  const normalized = withQr.map((element) => {
    if (element.type !== "qr") return element;
    const width = Math.max(5, Math.min(24, element.width || 11));
    // The block is square, plus the number and caption underneath unless the
    // template hides them. Heights are in percent of the ticket height.
    const blockHeight =
      width * TICKET_ASPECT + (element.style?.hideCaption ? 0 : 9);
    return {
      ...element,
      width,
      x: Math.max(0, Math.min(100 - width, element.x)),
      y: Math.max(0, Math.min(Math.max(0, 100 - blockHeight), element.y)),
    };
  });
  const showsTicketNumber = normalized.some(
    (element) =>
      element.type === "ticket_number" ||
      ((element.type === "barcode" || element.type === "qr") &&
        !element.style?.hideCaption),
  );
  if (showsTicketNumber) return normalized;

  // Every issued ticket needs a readable identity in addition to its secure
  // QR payload. The value is resolved from the attendee created at checkout.
  return [
    ...normalized,
    {
      id: normalized.some((element) => element.id === "issued-ticket-number")
        ? "issued-ticket-number-live"
        : "issued-ticket-number",
      type: "ticket_number",
      label: "Ticket number",
      x: 6,
      y: 84,
      width: 38,
      size: "small",
      style: {
        fontWeight: 700,
        letterSpacing: 8,
      },
    } as TicketCanvasElement,
  ];
};

const ticketSelectionField = (): FormField => ({
  id: "ticket-selection",
  type: "dropdown",
  label: "Choose your ticket",
  options: [],
  required: true,
  width: "full",
});

/**
 * Ticket options and availability belong to the event. The rest of this
 * block belongs to the registration form builder and must survive event
 * saves, including per-block typography, colours, borders, and spacing.
 */
const mergeTicketSelectionField = (
  previous: FormField | undefined,
  options: string[],
  ticketLimits?: NonNullable<FormField["config"]>["ticketLimits"],
): FormField => {
  const next = {
    ...ticketSelectionField(),
    ...(previous ? structuredClone(previous) : {}),
    id: "ticket-selection",
    type: "dropdown" as const,
    options: [...options],
  };
  if (ticketLimits) {
    next.config = {
      ...next.config,
      ticketLimits,
    };
  }
  return next;
};

const registrationFields = (ticketingEnabled: boolean): FormField[] => [
  {
    id: "attendee-step",
    type: "pageBreak",
    label: "Attendee details",
    width: "full",
  },
  {
    id: "full-name",
    type: "shortText",
    label: "Full name",
    placeholder: "Your full name",
    required: true,
    width: "half",
  },
  {
    id: "email",
    type: "email",
    label: "Email address",
    placeholder: "you@example.com",
    required: true,
    width: "half",
  },
  {
    id: "phone",
    type: "phone",
    label: "Phone number",
    required: false,
    width: "half",
  },
  {
    id: "additional-step",
    type: "pageBreak",
    label: "Additional details",
    width: "full",
  },
  {
    id: "dietary",
    type: "longText",
    label: "Dietary or accessibility needs",
    required: false,
    width: "full",
  },
  {
    id: "waiver",
    type: "file",
    label: "Supporting document",
    helpText: "Optional ID, waiver, or event document.",
    required: false,
    width: "full",
  },
  {
    id: "registration-source",
    type: "hidden",
    label: "Registration source",
    defaultValue: "event",
    width: "full",
  },
  ...(ticketingEnabled ? [ticketSelectionField()] : []),
];

const mapTemplate = (row: DatabaseRow): EventTemplate => ({
  id: asString(row.id),
  name: asString(row.name),
  category: asString(row.category),
  description: asString(row.description),
  imagePath: asString(row.image_path),
  eventDefaults: asJson(row.event_defaults, {}),
  ticketDesign: asJson(row.ticket_design, {}),
});

const mapTicketType = (row: DatabaseRow): EventTicketType => ({
  id: asString(row.id),
  eventId: asString(row.event_id),
  name: asString(row.name),
  description: asString(row.description),
  price: asNumber(row.price),
  currency: asString(row.currency) || "USD",
  quantityAvailable: asNumber(row.quantity_available),
  soldCount: asNumber(row.sold_count),
  minPerOrder: asNumber(row.min_per_order) || 1,
  maxPerOrder: asNumber(row.max_per_order) || 10,
  groupMultiplier: asNumber(row.group_multiplier) || 1,
  salesStart: asString(row.sales_start),
  salesEnd: asString(row.sales_end),
  waitlistEnabled: asBoolean(row.waitlist_enabled),
  color: asString(row.color) || "#F93D0A",
  active: asBoolean(row.active),
  sortOrder: asNumber(row.sort_order),
});

const mapEventPricing = (value: unknown): EventPricing => {
  const row = asJson<DatabaseRow>(value, {});
  return {
    enabled: asBoolean(row.enabled),
    amount: asNumber(row.amount),
    currency: asString(row.currency),
    label: asString(row.label) || "Registration fee",
    salesStart: asString(row.sales_start),
    salesEnd: asString(row.sales_end),
    taxIncluded: asBoolean(row.tax_included),
    couponsEnabled: asBoolean(row.coupons_enabled),
    discountsEnabled: asBoolean(row.discounts_enabled),
  };
};

const mapEventDiscountRule = (row: DatabaseRow): EventDiscountRule => ({
  id: asString(row.id),
  eventId: asString(row.event_id),
  name: asString(row.name),
  mode: (asString(row.mode) || "first_n") as EventDiscountRule["mode"],
  valueType: (asString(row.value_type) ||
    "percentage") as EventDiscountRule["valueType"],
  value: asNumber(row.discount_value),
  firstN: asNumber(row.first_n),
  minQuantity: asNumber(row.min_quantity) || 1,
  code: asString(row.promo_code),
  startsAt: asString(row.starts_at),
  endsAt: asString(row.ends_at),
  redemptionLimit:
    row.redemption_limit == null ? null : asNumber(row.redemption_limit),
  active: asBoolean(row.active),
  sortOrder: asNumber(row.sort_order),
});

const normalizeSectionContent = (value: unknown): EventSectionContent => {
  const parsed = asJson<Partial<EventSectionContent>>(value, {});
  const defaults = defaultEventSectionContent();
  return {
    about: {
      ...defaults.about,
      ...(parsed.about || {}),
    },
    agenda: Array.isArray(parsed.agenda) ? parsed.agenda : [],
    speakers: Array.isArray(parsed.speakers) ? parsed.speakers : [],
    sponsors: Array.isArray(parsed.sponsors)
      ? parsed.sponsors.map((sponsor) => ({
          id: asString((sponsor as DatabaseRow).id) || crypto.randomUUID(),
          name: asString((sponsor as DatabaseRow).name),
          description: asString((sponsor as DatabaseRow).description),
          website: asString((sponsor as DatabaseRow).website),
          logoUrl: asString((sponsor as DatabaseRow).logoUrl),
        }))
      : [],
    faq: Array.isArray(parsed.faq) ? parsed.faq : [],
    venue: {
      ...defaults.venue,
      ...(parsed.venue || {}),
    },
  };
};

const mapDailySchedule = (value: unknown): EventDailySchedule[] =>
  asJson<DatabaseRow[]>(value, [])
    .map((item) => ({
      date: asDateOnly(item.date),
      startTime: asString(item.startTime || item.start_time).slice(0, 5),
      endTime: asString(item.endTime || item.end_time).slice(0, 5),
    }))
    .filter((item) => item.date);

const mapEvent = (
  row: DatabaseRow,
  registrationForm: FormRecord | null,
): EventRecord => {
  const branding = asJson<Partial<EventBranding>>(row.branding, {});
  const workspaceAccent = workspaceAccentColor(row.workspace_brand_color);
  const seo = asJson<Partial<EventSeo>>(row.seo, {});
  return {
    id: asString(row.id),
    eventCode: asString(row.event_code),
    createdBy: asString(row.created_by),
    registrationFormId: asString(row.registration_form_id) || null,
    registrationForm,
    templateId: asString(row.template_id) || null,
    projectId: asString(row.project_id) || null,
    title: asString(row.title) || "Untitled event",
    slug: asString(row.slug),
    description: asString(row.description),
    status: (asString(row.status) || "draft") as EventRecord["status"],
    scheduleType: (asString(row.schedule_type) ||
      "single_day") as EventRecord["scheduleType"],
    eventDate: asDateOnly(row.event_date),
    rangeStartDate: asDateOnly(row.range_start_date),
    rangeEndDate: asDateOnly(row.range_end_date),
    rangeScheduleMode: (asString(row.range_schedule_mode) ||
      "continuous") as EventRecord["rangeScheduleMode"],
    startTime: asString(row.schedule_start_time).slice(0, 5),
    endTime: asString(row.schedule_end_time).slice(0, 5),
    dailySchedule: mapDailySchedule(row.daily_schedule),
    locationType: (asString(row.location_type) ||
      "physical") as EventRecord["locationType"],
    venueName: asString(row.venue_name),
    address: asString(row.address),
    onlineUrl: asString(row.online_url),
    startsAt: asString(row.starts_at),
    endsAt: asString(row.ends_at),
    timezone: asString(row.timezone) || "UTC",
    branding: normalizeEventBranding(branding, workspaceAccent),
    publicSections: asJson<EventSectionKey[]>(
      row.public_sections,
      defaultSections,
    ),
    seo: { ...defaultSeo(), ...seo },
    capacityTotal: row.capacity_total == null ? null : asNumber(row.capacity_total),
    refundPolicy: asString(row.refund_policy),
    refundWindowHours: asNumber(row.refund_window_hours),
    accessControl: (asString(row.access_control) ||
      "public") as EventRecord["accessControl"],
    accessPassword: "",
    accessPasswordSet: Boolean(asString(row.access_password_hash)),
    inviteToken: asString(row.invite_token),
    inviteMessage: asString(row.invite_message),
    waitlistEnabled: asBoolean(row.waitlist_enabled),
    ticketingEnabled: asBoolean(row.ticketing_enabled),
    ticketPrefix: asString(row.ticket_prefix),
    ticketPrefixConfigured: asBoolean(row.ticket_prefix_configured),
    pricing: mapEventPricing(row.event_pricing),
    discountRules: asJson<DatabaseRow[]>(
      row.event_discount_rules,
      [],
    ).map(mapEventDiscountRule),
    sectionContent: normalizeSectionContent(row.section_content),
    settings: asJson(row.settings, {}),
    ticketTypeCount: asNumber(row.ticket_type_count),
    minimumTicketPrice: asNumber(row.minimum_ticket_price),
    maximumTicketPrice: asNumber(row.maximum_ticket_price),
    ticketCurrency: asString(row.ticket_currency),
    soldCount: asNumber(row.sold_count),
    attendeeCount: asNumber(row.attendee_count),
    checkedInCount: asNumber(row.checked_in_count),
    revenue: asNumber(row.revenue),
    createdAt: asString(row.created_at),
    updatedAt: asString(row.updated_at),
  };
};

const eventSelect = `
  event.*,
  (SELECT company.brand_color
   FROM company_settings company
   WHERE company.user_id = event.created_by
   LIMIT 1) AS workspace_brand_color,
  (SELECT COUNT(*) FROM event_ticket_types ticket_type
    WHERE ticket_type.event_id = event.id AND ticket_type.active = TRUE) AS ticket_type_count,
  (SELECT MIN(ticket_type.price) FROM event_ticket_types ticket_type
    WHERE ticket_type.event_id = event.id AND ticket_type.active = TRUE) AS minimum_ticket_price,
  (SELECT MAX(ticket_type.price) FROM event_ticket_types ticket_type
    WHERE ticket_type.event_id = event.id AND ticket_type.active = TRUE) AS maximum_ticket_price,
  (SELECT MIN(ticket_type.currency) FROM event_ticket_types ticket_type
    WHERE ticket_type.event_id = event.id AND ticket_type.active = TRUE) AS ticket_currency,
  (SELECT COUNT(*) FROM event_attendees attendee
    WHERE attendee.event_id = event.id
      AND attendee.ticket_status IN ('valid', 'transferred')) AS sold_count,
  (SELECT COUNT(*) FROM event_attendees attendee
    WHERE attendee.event_id = event.id
      AND attendee.ticket_status = 'valid') AS attendee_count,
  (SELECT COUNT(*) FROM event_attendees attendee
    WHERE attendee.event_id = event.id
      AND attendee.checked_in_at IS NOT NULL) AS checked_in_count,
  (SELECT COALESCE(SUM(event_order.total_amount), 0)
    FROM event_orders event_order
    WHERE event_order.event_id = event.id
      AND event_order.status = 'paid') AS revenue,
  (SELECT TO_JSONB(pricing)
   FROM event_pricing pricing
   WHERE pricing.event_id = event.id) AS event_pricing,
  (SELECT COALESCE(
      JSONB_AGG(TO_JSONB(discount_rule) ORDER BY discount_rule.sort_order, discount_rule.created_at),
      '[]'::jsonb
    )
   FROM event_discount_rules discount_rule
   WHERE discount_rule.event_id = event.id) AS event_discount_rules`;

async function createUniqueEventSlug(title: string) {
  const base = normalizeEventSlug(title) || "event";
  let candidate = base;
  let suffix = 2;
  while (!(await isEventSlugAvailable(candidate))) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export async function isEventSlugAvailable(slug: string, eventId = "") {
  if (browserRuntime()) {
    return eventRpc<boolean>("isEventSlugAvailable", { slug, eventId });
  }
  const normalized = normalizeEventSlug(slug);
  if (!normalized || normalized !== slug || normalized.length < 3) return false;
  const result = await query(
    `SELECT id
     FROM events
     WHERE slug = $1 AND id::text <> $2
     LIMIT 1`,
    [normalized, eventId],
  );
  return result.rows.length === 0;
}

export async function listEventTemplates() {
  if (browserRuntime()) {
    return eventRpc<EventTemplate[]>("listEventTemplates");
  }
  const result = await query(
    `SELECT id, name, category, description, image_path,
       event_defaults, ticket_design
     FROM event_templates
     WHERE active = TRUE
     ORDER BY sort_order, name`,
  );
  return result.rows.map((row) => mapTemplate(row as DatabaseRow));
}

const mapTicketDesignTemplate = (
  row: DatabaseRow,
): EventTicketDesignTemplate => {
  const theme = asJson<Partial<EventTicketDesignTemplate["theme"]>>(
    row.theme,
    {},
  );
  return {
    id: asString(row.id),
    createdBy: asString(row.created_by) || null,
    sourceTemplateId: asString(row.source_template_id) || null,
    isSystem: !asString(row.created_by),
    name: asString(row.name),
    category: asString(row.category),
    description: asString(row.description),
    theme: {
      background: theme.background || "#FFFFFF",
      accent: theme.accent || "#F93D0A",
      text: theme.text || "#18181B",
      muted: theme.muted || "#71717A",
      edge:
        theme.edge === "perforated" || theme.edge === "double"
          ? theme.edge
          : "solid",
      motif: theme.motif || "none",
      backgroundImage: theme.backgroundImage || "",
    },
    frontLayout: ensureTicketQr(
      asJson<TicketCanvasElement[]>(
        row.front_layout,
        defaultFrontLayout(),
      ),
    ),
    backLayout: asJson<TicketCanvasElement[]>(
      row.back_layout,
      defaultBackLayout(),
    ),
  };
};

export async function listEventTicketDesignTemplates(userId: string) {
  if (browserRuntime()) {
    return eventRpc<EventTicketDesignTemplate[]>(
      "listEventTicketDesignTemplates",
    );
  }
  const result = await query(
    `SELECT template.*
     FROM event_ticket_design_templates template
     WHERE template.active = TRUE
       AND (
         template.created_by = $1
         OR (
           template.created_by IS NULL
           AND NOT EXISTS (
             SELECT 1
             FROM event_ticket_design_templates workspace_template
             WHERE workspace_template.created_by = $1
               AND workspace_template.source_template_id = template.id
               AND workspace_template.active = TRUE
           )
         )
       )
     ORDER BY (template.created_by IS NOT NULL) DESC,
       template.sort_order, template.name`,
    [userId],
  );
  return result.rows.map((row) =>
    mapTicketDesignTemplate(row as DatabaseRow),
  );
}

export async function saveEventTicketDesignTemplate(
  userId: string,
  template: EventTicketDesignTemplate,
) {
  if (browserRuntime()) {
    return eventRpc<EventTicketDesignTemplate>(
      "saveEventTicketDesignTemplate",
      { template },
    );
  }
  const frontLayout = ensureTicketQr(template.frontLayout);
  const theme = {
    ...template.theme,
    edge:
      template.theme.edge === "perforated" ||
      template.theme.edge === "double"
        ? template.theme.edge
        : "solid",
  };
  const values = [
    template.name.trim() || "Untitled ticket",
    template.category.trim() || "Custom",
    template.description.trim(),
    JSON.stringify(theme),
    JSON.stringify(frontLayout),
    JSON.stringify(template.backLayout),
  ];
  if (template.id && template.createdBy === userId) {
    const result = await query(
      `UPDATE event_ticket_design_templates
       SET name = $1, category = $2, description = $3,
         theme = $4::jsonb, front_layout = $5::jsonb,
         back_layout = $6::jsonb, updated_at = NOW()
       WHERE id = $7 AND created_by = $8
       RETURNING *`,
      [...values, template.id, userId],
    );
    if (!result.rows[0]) throw new Error("Ticket template was not found");
    return mapTicketDesignTemplate(result.rows[0] as DatabaseRow);
  }

  const sourceTemplateId = template.isSystem
    ? template.id
    : template.sourceTemplateId;
  const result = await query(
    `INSERT INTO event_ticket_design_templates (
       id, created_by, source_template_id, name, category, description,
       theme, front_layout, back_layout, active, sort_order,
       created_at, updated_at
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb,
       TRUE, 5, NOW(), NOW()
     )
     ON CONFLICT (created_by, source_template_id)
       WHERE created_by IS NOT NULL AND source_template_id IS NOT NULL
     DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category,
       description = EXCLUDED.description, theme = EXCLUDED.theme,
       front_layout = EXCLUDED.front_layout,
       back_layout = EXCLUDED.back_layout, active = TRUE, updated_at = NOW()
     RETURNING *`,
    [
      crypto.randomUUID(),
      userId,
      sourceTemplateId || null,
      ...values,
    ],
  );
  return mapTicketDesignTemplate(result.rows[0] as DatabaseRow);
}

const mapModulePreferences = (
  row: DatabaseRow | undefined,
  timezone = "UTC",
): EventModulePreferences => {
  const defaults = defaultEventModulePreferences(timezone);
  if (!row) return defaults;
  return {
    organizerName: asString(row.organizer_name),
    replyToEmail: asString(row.reply_to_email),
    supportEmail: asString(row.support_email),
    defaultTimezone: asString(row.default_timezone) || timezone,
    defaultAccessControl:
      asString(row.default_access_control) === "invite_only" ||
      asString(row.default_access_control) === "password"
        ? (asString(
            row.default_access_control,
          ) as EventModulePreferences["defaultAccessControl"])
        : "public",
    defaultTicketingEnabled: asBoolean(row.default_ticketing_enabled),
    defaultWaitlistEnabled: asBoolean(row.default_waitlist_enabled),
    defaultRefundPolicy: asString(row.default_refund_policy),
    registrationConfirmation:
      asString(row.registration_confirmation) ||
      defaults.registrationConfirmation,
  };
};

export async function getEventModulePreferences(
  userId: string,
  timezone = "UTC",
) {
  if (browserRuntime()) {
    return eventRpc<EventModulePreferences>("getEventModulePreferences", {
      timezone,
    });
  }
  const result = await query(
    `SELECT organizer_name, reply_to_email, support_email,
       default_timezone, default_access_control, default_ticketing_enabled,
       default_waitlist_enabled, default_refund_policy,
       registration_confirmation
     FROM event_module_preferences
     WHERE user_id = $1
     LIMIT 1`,
    [userId],
  );
  return mapModulePreferences(
    result.rows[0] as DatabaseRow | undefined,
    timezone,
  );
}

export async function saveEventModulePreferences(
  userId: string,
  preferences: EventModulePreferences,
) {
  if (browserRuntime()) {
    return eventRpc<EventModulePreferences>("saveEventModulePreferences", {
      preferences,
    });
  }
  const result = await query(
    `INSERT INTO event_module_preferences (
       user_id, organizer_name, reply_to_email, support_email,
       default_timezone, default_access_control, default_ticketing_enabled,
       default_waitlist_enabled, default_refund_policy,
       registration_confirmation, created_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
     ON CONFLICT (user_id)
     DO UPDATE SET organizer_name = EXCLUDED.organizer_name,
       reply_to_email = EXCLUDED.reply_to_email,
       support_email = EXCLUDED.support_email,
       default_timezone = EXCLUDED.default_timezone,
       default_access_control = EXCLUDED.default_access_control,
       default_ticketing_enabled = EXCLUDED.default_ticketing_enabled,
       default_waitlist_enabled = EXCLUDED.default_waitlist_enabled,
       default_refund_policy = EXCLUDED.default_refund_policy,
       registration_confirmation = EXCLUDED.registration_confirmation,
       updated_at = NOW()
     RETURNING *`,
    [
      userId,
      preferences.organizerName.trim(),
      preferences.replyToEmail.trim(),
      preferences.supportEmail.trim(),
      preferences.defaultTimezone,
      preferences.defaultAccessControl,
      preferences.defaultTicketingEnabled,
      preferences.defaultWaitlistEnabled,
      preferences.defaultRefundPolicy,
      preferences.registrationConfirmation,
    ],
  );
  return mapModulePreferences(result.rows[0] as DatabaseRow);
}

export async function listEvents(userId: string) {
  if (browserRuntime()) {
    return eventRpc<EventRecord[]>("listEvents");
  }
  const [eventResult, forms] = await Promise.all([
    query(
      `SELECT ${eventSelect}
       FROM events event
       WHERE event.created_by = $1
       ORDER BY event.updated_at DESC`,
      [userId],
    ),
    listWorkspaceForms(userId, { includeEventRegistrationForms: true }),
  ]);
  const formMap = new Map(forms.map((form) => [form.id, form]));
  return eventResult.rows.map((row) => {
    const item = row as DatabaseRow;
    const formId = asString(item.registration_form_id);
    return mapEvent(item, formMap.get(formId) || null);
  });
}

export async function getEvent(userId: string, eventId: string) {
  if (browserRuntime()) {
    return eventRpc<EventRecord | null>("getEvent", { eventId });
  }
  const events = await listEvents(userId);
  return events.find((event) => event.id === eventId) || null;
}

export async function createEvent(
  userId: string,
  input: {
    title: string;
    template?: EventTemplate | null;
    currency: string;
    timezone: string;
    ticketingEnabled: boolean;
    ticketPrefix?: string;
    preferences?: EventModulePreferences;
    /** Set when the event is created from inside a project. */
    projectId?: string | null;
  },
) {
  if (browserRuntime()) {
    return eventRpc<EventRecord>("createEvent", { input });
  }
  const title = input.title.trim() || input.template?.name || "Untitled event";
  const requestedTicketPrefix = input.ticketingEnabled
    ? normalizeTicketPrefix(
        input.ticketPrefix || suggestedTicketPrefix(title),
      )
    : normalizeTicketPrefix(
        `EV${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`,
      );
  if (input.ticketingEnabled && requestedTicketPrefix.length < 3) {
    throw new Error("Choose a ticket prefix before creating the event.");
  }
  if (input.ticketingEnabled) {
    const duplicate = await query(
      `SELECT id
       FROM events
       WHERE created_by = $1 AND ticket_prefix = $2
       LIMIT 1`,
      [userId, requestedTicketPrefix],
    );
    if (duplicate.rows[0]) {
      throw new Error("That ticket prefix is already used by another event.");
    }
  }
  const defaults = input.template?.eventDefaults || {};
  const ticketTheme = input.template?.ticketDesign || {};
  const workspaceResult = await query<{ brand_color: unknown }>(
    `SELECT brand_color
     FROM company_settings
     WHERE user_id = $1
     LIMIT 1`,
    [userId],
  );
  const workspaceAccent = workspaceAccentColor(
    workspaceResult.rows[0]?.brand_color,
  );
  const locationType =
    defaults.locationType === "online" || defaults.locationType === "hybrid"
      ? defaults.locationType
      : "physical";
  const sections: EventSectionKey[] = [];
  const accentColor = workspaceAccent;
  const preferences =
    input.preferences || defaultEventModulePreferences(input.timezone);
  const sectionContent = defaultEventSectionContent();
  const formSettings = defaultFormSettings();
  formSettings.theme.accentColor = accentColor;
  formSettings.payment.currency = input.currency;
  formSettings.payment.enabled = false;
  formSettings.confirmation = {
    ...formSettings.confirmation,
    title: "You are registered",
    message: preferences.registrationConfirmation,
  };
  const registrationForm = await createWorkspaceForm(userId, {
    title: `${title} registration`,
    description: `Registration and ticket details for ${title}.`,
    fields: registrationFields(input.ticketingEnabled),
    settings: formSettings,
  });
  try {
    const slug = await createUniqueEventSlug(title);
    const result = await query(
      `INSERT INTO events (
         created_by, registration_form_id, template_id, title, slug,
         description, status, location_type, timezone, branding,
         public_sections, seo, ticketing_enabled, ticket_prefix,
         ticket_prefix_configured, section_content, access_control,
         waitlist_enabled, refund_policy, settings, project_id,
         created_at, updated_at
       )
       VALUES (
         $1, $2, $3, $4, $5, '', 'draft', $6, $7, $8::jsonb,
         $9::jsonb, $10::jsonb, $11, $12, $13, $14::jsonb, $15,
         $16, $17, $18::jsonb,
         (SELECT id FROM projects WHERE id = $19::uuid AND created_by = $1),
         NOW(), NOW()
       )
       RETURNING id`,
      [
        userId,
        registrationForm.id,
        input.template?.id || null,
        title,
        slug,
        locationType,
        input.timezone,
        JSON.stringify(defaultBranding(accentColor)),
        JSON.stringify(sections),
        JSON.stringify(defaultSeo()),
        input.ticketingEnabled,
        requestedTicketPrefix,
        input.ticketingEnabled,
        JSON.stringify(sectionContent),
        preferences.defaultAccessControl,
        preferences.defaultWaitlistEnabled,
        preferences.defaultRefundPolicy,
        JSON.stringify({
          ticketSurfaceColor:
            asString(ticketTheme.surfaceColor) || "#EFF6FF",
        }),
        input.projectId || null,
      ],
    );
    const eventId = asString((result.rows[0] as DatabaseRow).id);
    await query(
      `INSERT INTO event_pricing (
         event_id, enabled, amount, currency, label, tax_included,
         discounts_enabled, created_at, updated_at
       )
       VALUES ($1, FALSE, 0, $2, 'Registration fee', FALSE, FALSE, NOW(), NOW())
       ON CONFLICT (event_id) DO NOTHING`,
      [eventId, input.currency.toUpperCase()],
    );
    if (input.ticketingEnabled) {
      const ticketTemplateIds: Record<string, string> = {
        conference: "summit-grid",
        concert: "noir-stage",
        gala: "atelier-gala",
        workshop: "field-notes",
        community: "festival-color",
        blank: "studio-blank",
      };
      const designTemplateId =
        ticketTemplateIds[asString(ticketTheme.template)] || "studio-blank";
      await query(
        `INSERT INTO event_ticket_designs (
           event_id, template_id, theme, front_layout, back_layout,
           barcode_format, output_formats, created_at, updated_at
         )
         SELECT $1, COALESCE(workspace_template.id, template.id),
           COALESCE(workspace_template.theme, template.theme),
           COALESCE(workspace_template.front_layout, template.front_layout),
           COALESCE(workspace_template.back_layout, template.back_layout),
           'qr', '["digital", "pdf"]'::jsonb, NOW(), NOW()
         FROM event_ticket_design_templates template
         LEFT JOIN event_ticket_design_templates workspace_template
           ON workspace_template.created_by = $3
          AND workspace_template.source_template_id = template.id
          AND workspace_template.active = TRUE
         WHERE template.id = $2`,
        [eventId, designTemplateId, userId],
      );
    }
    const event = await getEvent(userId, eventId);
    if (!event) throw new Error("Event could not be reloaded after creation");
    return event;
  } catch (error) {
    await deleteWorkspaceForm(userId, registrationForm.id);
    throw error;
  }
}

export async function saveEvent(
  userId: string,
  event: EventRecord,
  options: {
    publishing?: boolean;
    syncPricing?: boolean;
    syncRegistration?: boolean;
    validatePublishing?: boolean;
    validateTicketing?: boolean;
  } = {},
) {
  if (browserRuntime()) {
    return eventRpc<EventRecord>("saveEvent", { event, options });
  }
  const ticketPrefix = normalizeTicketPrefix(event.ticketPrefix);
  const isPublishing =
    options.publishing === true &&
    ["published", "on_sale", "sold_out"].includes(event.status);
  const selectedMeetingProvider = selectedEventMeetingProvider(event);
  const automaticMeetingProvider = ["google_meet", "teams", "zoom"].includes(selectedMeetingProvider)
    ? selectedMeetingProvider as "google_meet" | "teams" | "zoom"
    : null;
  const shouldValidatePublishing =
    isPublishing && options.validatePublishing !== false;
  const shouldValidateTicketing =
    options.validateTicketing === true || shouldValidatePublishing;
  const workspaceResult = await query<{ brand_color: unknown }>(
    `SELECT brand_color
     FROM company_settings
     WHERE user_id = $1
     LIMIT 1`,
    [userId],
  );
  const branding = normalizeEventBranding(
    event.branding,
    workspaceAccentColor(workspaceResult.rows[0]?.brand_color),
  );
  const previousResult = await query(
    `SELECT status, title, description, location_type, event_date,
       range_start_date, range_end_date, range_schedule_mode,
       schedule_start_time, schedule_end_time, daily_schedule, timezone,
       settings, online_url
     FROM events
     WHERE id = $1 AND created_by = $2
     LIMIT 1`,
    [event.id, userId],
  );
  const previousEvent = previousResult.rows[0] as DatabaseRow | undefined;
  const previousEventStatus = asString(previousEvent?.status);
  const previousSettings = asJson<DatabaseRow>(previousEvent?.settings, {});
  const previousIntegration = previousSettings.meetingIntegration && typeof previousSettings.meetingIntegration === "object"
    ? previousSettings.meetingIntegration as DatabaseRow
    : null;
  if (shouldValidatePublishing && ["online", "hybrid"].includes(event.locationType)) {
    if (!automaticMeetingProvider && !isValidEventMeetingUrl(event.onlineUrl, process.env.ALLOW_INSECURE_EVENT_LINKS === "true")) {
      throw new Error("Add a valid HTTPS meeting link or choose a connected meeting provider before publishing.");
    }
    if (automaticMeetingProvider && !eventsServerDependencies?.createMeeting) {
      throw new Error("Automatic meeting creation is not available. Connect a meeting provider and try again.");
    }
  }
  let accessPasswordHash: string | null = null;
  if (event.accessControl === "password") {
    const nextPassword = event.accessPassword.trim();
    if (nextPassword && nextPassword.length < 6) {
      throw new Error("Use at least 6 characters for the event password.");
    }
    if (nextPassword) {
      accessPasswordHash = await hash(nextPassword, 10);
    } else {
      const currentAccess = await query(
        `SELECT access_password_hash
         FROM events
         WHERE id = $1 AND created_by = $2
         LIMIT 1`,
        [event.id, userId],
      );
      accessPasswordHash =
        asString(
          (currentAccess.rows[0] as DatabaseRow | undefined)
            ?.access_password_hash,
        ) || null;
    }
    if (shouldValidatePublishing && !accessPasswordHash) {
      throw new Error("Set an event password before publishing.");
    }
  }
  const inviteToken =
    event.inviteToken.trim().length >= 16
      ? event.inviteToken.trim()
      : crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  if (
    event.ticketingEnabled &&
    shouldValidatePublishing &&
    ticketPrefix.length < 3
  ) {
    throw new Error("Choose a ticket prefix before publishing this event.");
  }
  if (
    event.ticketingEnabled &&
    shouldValidatePublishing &&
    !event.ticketPrefixConfigured
  ) {
    throw new Error("Review the ticket prefix before publishing this event.");
  }
  for (const discount of event.discountRules) {
    if (!discount.active) continue;
    const issue = getEventDiscountRuleIssue(discount);
    if (issue) throw new Error(issue);
  }
  let ticketTypeCount = event.ticketTypeCount;
  let hasPaidTickets = false;
  if (event.ticketingEnabled && shouldValidateTicketing) {
    const current = await query(
      `SELECT event.ticket_prefix,
         EXISTS (
           SELECT 1
           FROM event_attendees attendee
           WHERE attendee.event_id = event.id
         ) AS has_issued_tickets,
         EXISTS (
           SELECT 1
           FROM events duplicate
           WHERE duplicate.created_by = event.created_by
             AND duplicate.ticket_prefix = $3
             AND duplicate.id <> event.id
         ) AS duplicate_prefix,
         (
           SELECT COUNT(*)::int
           FROM event_ticket_types ticket_type
           WHERE ticket_type.event_id = event.id
             AND ticket_type.active = TRUE
         ) AS ticket_type_count,
         (
           SELECT COALESCE(BOOL_OR(ticket_type.price > 0), FALSE)
           FROM event_ticket_types ticket_type
           WHERE ticket_type.event_id = event.id
             AND ticket_type.active = TRUE
         ) AS has_paid_tickets
       FROM events event
       WHERE event.id = $1 AND event.created_by = $2
       LIMIT 1`,
      [event.id, userId, ticketPrefix],
    );
    const currentEvent = current.rows[0] as DatabaseRow | undefined;
    ticketTypeCount = asNumber(currentEvent?.ticket_type_count);
    hasPaidTickets = asBoolean(currentEvent?.has_paid_tickets);
    if (
      asBoolean(currentEvent?.has_issued_tickets) &&
      asString(currentEvent?.ticket_prefix) !== ticketPrefix
    ) {
      throw new Error(
        "The ticket prefix is locked because this event has issued tickets.",
      );
    }
    if (asBoolean(currentEvent?.duplicate_prefix)) {
      throw new Error("That ticket prefix is already used by another event.");
    }
  }
  if (shouldValidatePublishing) {
    const missing = getEventPublishRequirements(
      event,
      ticketTypeCount,
    ).filter((requirement) => !requirement.complete);
    if (missing.length) {
      throw new Error(
        `Complete ${missing[0].label.toLowerCase()} before publishing.`,
      );
    }
    const isPaidEvent = event.ticketingEnabled
      ? hasPaidTickets
      : event.pricing.enabled && event.pricing.amount > 0;
    if (isPaidEvent) {
      if (!(await eventPaymentProviderConnected(userId))) {
        throw new Error(
          "Connect a healthy payment provider before publishing this paid event.",
        );
      }
    }
  }
  let savedOnlineUrl = event.onlineUrl;
  let savedSettings = event.settings;
  const initialStatus = isPublishing && automaticMeetingProvider ? "draft" : event.status;
  const scheduleInstants = eventScheduleInstants(event);
  const result = await query(
    `UPDATE events
     SET title = $1,
         slug = $2,
         description = $3,
         status = $4,
         location_type = $5,
         venue_name = $6,
         address = $7,
         online_url = $8,
         schedule_type = $9,
         event_date = $10,
         starts_at = $11,
         ends_at = $12,
         timezone = $13,
         branding = $14::jsonb,
         public_sections = $15::jsonb,
         seo = $16::jsonb,
         capacity_total = $17,
         refund_policy = $18,
         refund_window_hours = $19,
         access_control = $20,
         access_password_hash = $21,
         invite_token = $22,
         invite_message = $23,
         waitlist_enabled = $24,
         ticketing_enabled = $25,
         ticket_prefix = $26,
         ticket_prefix_configured = $27,
         section_content = $28::jsonb,
         settings = $29::jsonb,
         range_start_date = $30,
         range_end_date = $31,
         range_schedule_mode = $32,
         schedule_start_time = $33,
         schedule_end_time = $34,
         daily_schedule = $35::jsonb,
         published_at = CASE
           WHEN $4 IN ('published', 'on_sale') AND published_at IS NULL THEN NOW()
           ELSE published_at
         END,
         cancelled_at = CASE WHEN $4 = 'cancelled' THEN NOW() ELSE NULL END,
         updated_at = NOW()
     WHERE id = $36 AND created_by = $37
     RETURNING id`,
    [
      event.title.trim() || "Untitled event",
      normalizeEventSlug(event.slug),
      event.description,
      initialStatus,
      event.locationType,
      event.venueName,
      event.address,
      event.onlineUrl,
      event.scheduleType,
      event.scheduleType === "single_day" ? event.eventDate || null : null,
      scheduleInstants.startsAt,
      scheduleInstants.endsAt,
      event.timezone,
      JSON.stringify(branding),
      JSON.stringify(event.publicSections),
      JSON.stringify(event.seo),
      event.capacityTotal,
      event.refundPolicy,
      event.refundWindowHours,
      event.accessControl,
      accessPasswordHash,
      inviteToken,
      event.inviteMessage,
      event.waitlistEnabled,
      event.ticketingEnabled,
      ticketPrefix || suggestedTicketPrefix(event.title),
      event.ticketPrefixConfigured,
      JSON.stringify(event.sectionContent),
      JSON.stringify(event.settings),
      event.scheduleType === "date_range"
        ? event.rangeStartDate || null
        : null,
      event.scheduleType === "date_range" ? event.rangeEndDate || null : null,
      event.rangeScheduleMode,
      event.startTime || null,
      event.endTime || null,
      JSON.stringify(
        event.scheduleType === "date_range" &&
          event.rangeScheduleMode === "daily"
          ? event.dailySchedule
          : [],
      ),
      event.id,
      userId,
    ],
  );
  if (!result.rows[0]) throw new Error("Event was not found");
  const liveMeetingStatuses = ["published", "on_sale", "sold_out"];
  const shouldSyncMeeting =
    Boolean(automaticMeetingProvider && eventsServerDependencies?.createMeeting) &&
    (isPublishing || liveMeetingStatuses.includes(event.status));
  if (shouldSyncMeeting && automaticMeetingProvider && eventsServerDependencies?.createMeeting) {
    try {
      const meeting = await eventsServerDependencies.createMeeting(
        userId,
        event.id,
        automaticMeetingProvider,
        previousIntegration,
      );
      savedOnlineUrl = String(meeting.joinUrl || "");
      savedSettings = {
        ...event.settings,
        meetingIntegration: meeting,
        meetingSync: {
          status: "synced",
          provider: automaticMeetingProvider,
          lastSyncedAt: new Date().toISOString(),
          lastError: "",
        },
      };
      await query(
        `UPDATE events
         SET online_url = $1, settings = $2::jsonb, status = $3,
             published_at = CASE WHEN $3 IN ('published', 'on_sale') AND published_at IS NULL THEN NOW() ELSE published_at END,
             updated_at = NOW()
         WHERE id = $4 AND created_by = $5`,
        [savedOnlineUrl, JSON.stringify(savedSettings), event.status, event.id, userId],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "The meeting provider could not create a meeting.";
      const failedSettings = {
        ...event.settings,
        meetingSync: {
          status: "error",
          provider: automaticMeetingProvider,
          lastSyncedAt: new Date().toISOString(),
          lastError: message.slice(0, 300),
        },
      };
      if (isPublishing) {
        await query(
          `UPDATE events SET status = 'draft', settings = $1::jsonb, updated_at = NOW() WHERE id = $2 AND created_by = $3`,
          [JSON.stringify(failedSettings), event.id, userId],
        );
        throw new Error(`The ${automaticMeetingProvider.replace("_", " ")} meeting could not be created. ${message}`);
      }
      // A provider outage must not discard an otherwise valid event edit. Keep
      // the event saved and expose a reconnect-required state for retry.
      savedSettings = {
        ...failedSettings,
        meetingSync: {
          ...failedSettings.meetingSync,
          status: "reconnect_required",
        },
      };
      await query(
        `UPDATE events SET settings = $1::jsonb, updated_at = NOW() WHERE id = $2 AND created_by = $3`,
        [JSON.stringify(savedSettings), event.id, userId],
      );
    }
  }
  const existingMeeting = previousIntegration || event.settings?.meetingIntegration;
  const shouldCancelMeeting =
    event.status === "cancelled" &&
    existingMeeting &&
    typeof existingMeeting === "object" &&
    String((existingMeeting as DatabaseRow).status || "") !== "cancelled" &&
    Boolean(String((existingMeeting as DatabaseRow).provider || ""));
  if (shouldCancelMeeting && eventsServerDependencies?.cancelMeeting) {
    const cancellation = await eventsServerDependencies.cancelMeeting(userId, event.id, previousIntegration);
    if (cancellation && typeof cancellation === "object") {
      if (typeof cancellation.onlineUrl === "string") {
        savedOnlineUrl = cancellation.onlineUrl;
      }
      if (cancellation.settings && typeof cancellation.settings === "object") {
        savedSettings = cancellation.settings as DatabaseRow;
      }
    }
  }
  if (
    event.status === "cancelled" &&
    previousEventStatus !== "cancelled" &&
    eventsServerDependencies?.sendEventCancellationEmails
  ) {
    void eventsServerDependencies
      .sendEventCancellationEmails(event.id)
      .catch(() => undefined);
  }
  if (
    previousEvent &&
    eventsServerDependencies?.sendEventUpdateEmails &&
    ["published", "on_sale", "sold_out"].includes(previousEventStatus) &&
    ["published", "on_sale", "sold_out"].includes(event.status) &&
    event.status !== "cancelled"
  ) {
    const previousSchedule = JSON.stringify({
      status: previousEventStatus,
      title: asString(previousEvent.title),
      description: asString(previousEvent.description),
      locationType: asString(previousEvent.location_type),
      eventDate: asString(previousEvent.event_date),
      rangeStartDate: asString(previousEvent.range_start_date),
      rangeEndDate: asString(previousEvent.range_end_date),
      rangeScheduleMode: asString(previousEvent.range_schedule_mode),
      startTime: asString(previousEvent.schedule_start_time),
      endTime: asString(previousEvent.schedule_end_time),
      dailySchedule: asJson(previousEvent.daily_schedule, []),
      timezone: asString(previousEvent.timezone),
      venueName: asString(previousEvent.venue_name),
      address: asString(previousEvent.address),
      onlineUrl: asString(previousEvent.online_url),
    });
    const nextSchedule = JSON.stringify({
      status: event.status,
      title: event.title,
      description: event.description,
      locationType: event.locationType,
      eventDate: event.eventDate,
      rangeStartDate: event.rangeStartDate,
      rangeEndDate: event.rangeEndDate,
      rangeScheduleMode: event.rangeScheduleMode,
      startTime: event.startTime,
      endTime: event.endTime,
      dailySchedule: event.dailySchedule,
      timezone: event.timezone,
      venueName: event.venueName,
      address: event.address,
      onlineUrl: savedOnlineUrl,
    });
    if (previousSchedule !== nextSchedule) {
      const previousTime = JSON.stringify({
        eventDate: asString(previousEvent.event_date),
        rangeStartDate: asString(previousEvent.range_start_date),
        rangeEndDate: asString(previousEvent.range_end_date),
        rangeScheduleMode: asString(previousEvent.range_schedule_mode),
        startTime: asString(previousEvent.schedule_start_time),
        endTime: asString(previousEvent.schedule_end_time),
        dailySchedule: asJson(previousEvent.daily_schedule, []),
        timezone: asString(previousEvent.timezone),
      });
      const nextTime = JSON.stringify({
        eventDate: event.eventDate,
        rangeStartDate: event.rangeStartDate,
        rangeEndDate: event.rangeEndDate,
        rangeScheduleMode: event.rangeScheduleMode,
        startTime: event.startTime,
        endTime: event.endTime,
        dailySchedule: event.dailySchedule,
        timezone: event.timezone,
      });
      void eventsServerDependencies
        .sendEventUpdateEmails(event.id, previousTime === nextTime ? "event_updated" : "event_rescheduled")
        .catch(() => undefined);
    }
  }
  if (
    eventsServerDependencies?.sendEventReminderEmails &&
    ["published", "on_sale", "sold_out"].includes(event.status)
  ) {
    void eventsServerDependencies
      .sendEventReminderEmails(event.id)
      .catch(() => undefined);
  }
  const pricing = {
    ...defaultEventPricing(event.pricing.currency || "USD"),
    ...event.pricing,
    currency: (event.pricing.currency || "USD").toUpperCase(),
  };
  const discountPayload = event.discountRules.map((rule, index) => ({
    id: rule.id || crypto.randomUUID(),
    event_id: event.id,
    name: rule.name.trim(),
    mode: rule.mode,
    value_type: rule.valueType,
    discount_value: rule.value,
    first_n: rule.firstN,
    min_quantity: rule.minQuantity,
    promo_code: rule.code.trim().toUpperCase(),
    starts_at: rule.startsAt || null,
    ends_at: rule.endsAt || null,
    redemption_limit: rule.redemptionLimit,
    active: rule.active,
    sort_order: index,
  }));
  if (options.syncPricing === true) await query(
    `WITH saved_pricing AS (
       INSERT INTO event_pricing (
         event_id, enabled, amount, currency, label, sales_start, sales_end,
         tax_included, discounts_enabled, coupons_enabled, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
       ON CONFLICT (event_id)
       DO UPDATE SET enabled = EXCLUDED.enabled,
         amount = EXCLUDED.amount,
         currency = EXCLUDED.currency,
         label = EXCLUDED.label,
         sales_start = EXCLUDED.sales_start,
         sales_end = EXCLUDED.sales_end,
         tax_included = EXCLUDED.tax_included,
         discounts_enabled = EXCLUDED.discounts_enabled,
         coupons_enabled = EXCLUDED.coupons_enabled,
         updated_at = NOW()
       RETURNING event_id
     ),
     saved_discounts AS (
       INSERT INTO event_discount_rules (
         id, event_id, name, mode, value_type, discount_value, first_n,
         min_quantity, promo_code, starts_at, ends_at, redemption_limit,
         active, sort_order, created_at, updated_at
       )
       SELECT item.id, item.event_id, item.name, item.mode, item.value_type,
         item.discount_value, item.first_n, item.min_quantity, item.promo_code,
         item.starts_at, item.ends_at, item.redemption_limit, item.active,
         item.sort_order, NOW(), NOW()
       FROM JSONB_TO_RECORDSET($11::jsonb) AS item(
         id UUID, event_id UUID, name TEXT, mode TEXT, value_type TEXT,
         discount_value NUMERIC, first_n INTEGER, min_quantity INTEGER,
         promo_code TEXT, starts_at TIMESTAMPTZ, ends_at TIMESTAMPTZ,
         redemption_limit INTEGER, active BOOLEAN, sort_order INTEGER
       )
       ON CONFLICT (id)
       DO UPDATE SET name = EXCLUDED.name,
         mode = EXCLUDED.mode,
         value_type = EXCLUDED.value_type,
         discount_value = EXCLUDED.discount_value,
         first_n = EXCLUDED.first_n,
         min_quantity = EXCLUDED.min_quantity,
         promo_code = EXCLUDED.promo_code,
         starts_at = EXCLUDED.starts_at,
         ends_at = EXCLUDED.ends_at,
         redemption_limit = EXCLUDED.redemption_limit,
         active = EXCLUDED.active,
         sort_order = EXCLUDED.sort_order,
         updated_at = NOW()
       WHERE event_discount_rules.event_id = EXCLUDED.event_id
       RETURNING id
     ),
     removed_discounts AS (
       DELETE FROM event_discount_rules discount
       WHERE discount.event_id = $1
         AND NOT EXISTS (
           SELECT 1 FROM saved_discounts saved
           WHERE saved.id = discount.id
         )
       RETURNING id
     ),
     saved_design AS (
       INSERT INTO event_ticket_designs (
          event_id, template_id, theme, front_layout, back_layout,
          barcode_format, output_formats, created_at, updated_at
        )
       SELECT event.id, COALESCE(workspace_template.id, template.id),
         COALESCE(workspace_template.theme, template.theme),
         COALESCE(workspace_template.front_layout, template.front_layout),
         COALESCE(workspace_template.back_layout, template.back_layout),
         'qr', '["digital", "pdf"]'::jsonb, NOW(), NOW()
       FROM events event
       JOIN event_ticket_design_templates template
         ON template.id = 'studio-blank'
       LEFT JOIN event_ticket_design_templates workspace_template
        ON workspace_template.created_by = $12
        AND workspace_template.source_template_id = template.id
        AND workspace_template.active = TRUE
       WHERE event.id = $1 AND event.created_by = $12
        AND $13::boolean = TRUE
         AND NOT EXISTS (
           SELECT 1 FROM event_ticket_designs design
           WHERE design.event_id = event.id
             AND design.ticket_type_id IS NULL
         )
       RETURNING event_id
     )
     SELECT event_id FROM saved_pricing`,
    [
      event.id,
      !event.ticketingEnabled && pricing.enabled,
      pricing.amount,
      pricing.currency,
      pricing.label.trim() || "Registration fee",
      pricing.salesStart || null,
      pricing.salesEnd || null,
      pricing.taxIncluded,
      pricing.discountsEnabled,
      pricing.couponsEnabled,
      JSON.stringify(discountPayload),
      userId,
      event.ticketingEnabled,
    ],
  );
  let savedRegistrationForm = event.registrationForm;
  const registrationNeedsPublication =
    Boolean(event.registrationForm) &&
    isPublishing &&
    (event.registrationForm!.status !== "published" ||
      event.registrationForm!.settings.hasUnpublishedChanges);
  if (
    event.registrationForm &&
    (options.syncRegistration === true || registrationNeedsPublication)
  ) {
    const reserved = new Set([
      "ticket-selection",
      "payment-step",
      "ticket-payment",
    ]);
    const withoutTicketing = event.registrationForm.fields.filter(
      (field) => !reserved.has(field.id),
    );
    let fields = withoutTicketing;
    if (event.ticketingEnabled) {
      const ticketResult = await query(
        `SELECT COALESCE(
                  JSONB_AGG(name ORDER BY sort_order, created_at),
                  '[]'::jsonb
                ) AS names,
                COALESCE(JSONB_OBJECT_AGG(
                  name,
                  JSONB_BUILD_OBJECT(
                    'color', color,
                    'currency', currency,
                    'description', description,
                    'min', GREATEST(1, COALESCE(min_per_order, 1)),
                    'max', GREATEST(
                      GREATEST(1, COALESCE(min_per_order, 1)),
                      COALESCE(max_per_order, 1)
                    ),
                    'price', GREATEST(0, COALESCE(price, 0)),
                    'remaining', GREATEST(
                      0,
                      COALESCE(quantity_available, 0) - (
                        SELECT COUNT(*)
                        FROM event_attendees attendee
                        WHERE attendee.ticket_type_id = event_ticket_types.id
                          AND attendee.ticket_status IN ('valid', 'transferred')
                      )
                    )
                  )
                ) FILTER (WHERE name IS NOT NULL), '{}'::jsonb) AS ticket_limits
         FROM event_ticket_types
         WHERE event_id = $1 AND active = TRUE`,
        [event.id],
      );
      const ticketSummary = ticketResult.rows[0] as DatabaseRow | undefined;
      const options = asJson<string[]>(ticketSummary?.names, []);
      const ticketLimits = asJson<
        NonNullable<FormField["config"]>["ticketLimits"]
      >(ticketSummary?.ticket_limits, {});
      const previousTicketField = event.registrationForm.fields.find(
        (field) => field.id === "ticket-selection",
      );
      const ticketField = mergeTicketSelectionField(
        previousTicketField,
        options,
        ticketLimits,
      );
      fields = [...withoutTicketing, ticketField];
    }
    const shouldCreateVersion =
      isPublishing &&
      (event.registrationForm.status !== "published" ||
        event.registrationForm.settings.hasUnpublishedChanges);
    const nextVersion = shouldCreateVersion
      ? event.registrationForm.settings.version + 1
      : event.registrationForm.settings.version;
    const registrationPaymentEnabled = event.ticketingEnabled
      ? false
      : pricing.enabled && pricing.amount > 0;
    const payment = {
      ...defaultPayment(),
      enabled: registrationPaymentEnabled,
      mode: "fixed" as const,
      productId: "",
      amount: registrationPaymentEnabled ? pricing.amount : 0,
      currency: pricing.currency,
      provider: "workspace" as const,
    };
    const form: FormRecord = {
      ...event.registrationForm,
      fields,
      status: isPublishing
        ? "published"
        : event.registrationForm.status,
      settings: {
        ...event.registrationForm.settings,
        payment,
        version: nextVersion,
        versions: shouldCreateVersion
          ? [
              ...event.registrationForm.settings.versions,
              {
                id: crypto.randomUUID(),
                version: nextVersion,
                publishedAt: new Date().toISOString(),
                publishedBy: "Workspace member",
                fields: structuredClone(fields),
                title: event.registrationForm.title,
                description: event.registrationForm.description,
              },
            ]
          : event.registrationForm.settings.versions,
        liveSnapshot: isPublishing
          ? {
              fields: structuredClone(fields),
              theme: {
                ...event.registrationForm.settings.theme,
              },
              payment,
              version: nextVersion,
              title: event.registrationForm.title,
              description: event.registrationForm.description,
            }
          : event.registrationForm.settings.liveSnapshot,
        hasUnpublishedChanges: isPublishing
          ? false
          : event.registrationForm.status === "published"
            ? true
            : event.registrationForm.settings.hasUnpublishedChanges,
      },
    };
    savedRegistrationForm = await saveWorkspaceForm(userId, form);
  }
  const savedDiscountRules = event.discountRules.map((rule, index) => ({
    ...rule,
    id: discountPayload[index]?.id || rule.id,
    eventId: event.id,
    code: rule.code.trim().toUpperCase(),
    sortOrder: index,
  }));
  return {
    ...event,
    branding,
    title: event.title.trim() || "Untitled event",
    slug: normalizeEventSlug(event.slug),
    accessPassword: "",
    accessPasswordSet:
      event.accessControl === "password" && Boolean(accessPasswordHash),
    inviteToken,
    ticketPrefix: ticketPrefix || suggestedTicketPrefix(event.title),
    pricing,
    onlineUrl: savedOnlineUrl,
    settings: savedSettings,
    status: event.status,
    discountRules: savedDiscountRules,
    registrationForm: savedRegistrationForm,
    updatedAt: new Date().toISOString(),
  };
}

export async function deleteEvent(userId: string, event: EventRecord) {
  if (browserRuntime()) {
    return eventRpc<void>("deleteEvent", { event });
  }
  const result = await query(
    `DELETE FROM events
     WHERE id = $1 AND created_by = $2
     RETURNING registration_form_id`,
    [event.id, userId],
  );
  const formId = asString((result.rows[0] as DatabaseRow | undefined)?.registration_form_id);
  if (formId) await deleteWorkspaceForm(userId, formId);
}

export async function listEventTicketTypes(
  userId: string,
  eventId: string,
) {
  if (browserRuntime()) {
    return eventRpc<EventTicketType[]>("listEventTicketTypes", { eventId });
  }
  const result = await query(
    `SELECT ticket_type.*,
       (SELECT COUNT(*)
        FROM event_attendees attendee
        WHERE attendee.ticket_type_id = ticket_type.id
          AND attendee.ticket_status IN ('valid', 'transferred')) AS sold_count
     FROM event_ticket_types ticket_type
     JOIN events event ON event.id = ticket_type.event_id
     WHERE ticket_type.event_id = $1 AND event.created_by = $2
     ORDER BY ticket_type.sort_order, ticket_type.created_at`,
    [eventId, userId],
  );
  return result.rows.map((row) => mapTicketType(row as DatabaseRow));
}

async function syncEventRegistrationTicketOptions(
  userId: string,
  eventId: string,
) {
  const [eventResult, ticketResult, forms] = await Promise.all([
    query(
      `SELECT registration_form_id
       FROM events
       WHERE id = $1 AND created_by = $2`,
      [eventId, userId],
    ),
    query(
      `SELECT name, description, price, currency, color, min_per_order,
         max_per_order, quantity_available,
         (SELECT COUNT(*)
          FROM event_attendees attendee
          WHERE attendee.ticket_type_id = event_ticket_types.id
            AND attendee.ticket_status IN ('valid', 'transferred')) AS sold_count
       FROM event_ticket_types
       WHERE event_id = $1 AND active = TRUE
       ORDER BY sort_order, created_at`,
      [eventId],
    ),
    listWorkspaceForms(userId, { includeEventRegistrationForms: true }),
  ]);
  const formId = asString(
    (eventResult.rows[0] as DatabaseRow | undefined)?.registration_form_id,
  );
  const form = forms.find((item) => item.id === formId);
  if (!form) return;
  const options = ticketResult.rows.map((row) =>
    asString((row as DatabaseRow).name),
  );
  const ticketLimits = Object.fromEntries(
    ticketResult.rows.map((row) => {
      const item = row as DatabaseRow;
      const remaining = Math.max(
        0,
        asNumber(item.quantity_available) - asNumber(item.sold_count),
      );
      return [
        asString(item.name),
        {
          color: asString(item.color),
          currency: asString(item.currency),
          description: asString(item.description),
          min: Math.max(1, asNumber(item.min_per_order) || 1),
          max: Math.max(1, asNumber(item.max_per_order) || 1),
          price: Math.max(0, asNumber(item.price)),
          remaining,
        },
      ];
    }),
  );
  const previousTicketField = form.fields.find(
    (field) => field.id === "ticket-selection",
  );
  const ticketField = mergeTicketSelectionField(
    previousTicketField,
    options,
    ticketLimits,
  );
  const fields = [
    ...form.fields.filter((field) => field.id !== "ticket-selection"),
    ticketField,
  ];
  await saveWorkspaceForm(userId, {
    ...form,
    fields,
    settings: {
      ...form.settings,
      hasUnpublishedChanges: true,
    },
  });
}

export async function saveEventTicketType(
  userId: string,
  ticket: Omit<EventTicketType, "id" | "soldCount"> & { id?: string },
) {
  if (browserRuntime()) {
    return eventRpc<EventTicketType>("saveEventTicketType", { ticket });
  }
  const integerAtLeast = (value: number, minimum: number) =>
    Number.isFinite(value) ? Math.max(minimum, Math.floor(value)) : minimum;
  const normalizeDate = (value: string) => {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new Error("Use a valid sales date and time.");
    }
    return date.toISOString();
  };
  const salesStart = normalizeDate(ticket.salesStart || "");
  const salesEnd = normalizeDate(ticket.salesEnd || "");
  if (salesStart && salesEnd && new Date(salesEnd) <= new Date(salesStart)) {
    throw new Error("Sales end must be after sales start.");
  }
  const currency = String(ticket.currency || "USD").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new Error("Choose a valid three-letter currency.");
  }
  const price = Number(ticket.price);
  if (!Number.isFinite(price) || price < 0) {
    throw new Error("Ticket price must be zero or greater.");
  }
  const minPerOrder = integerAtLeast(ticket.minPerOrder, 1);
  const normalizedTicket = {
    ...ticket,
    name: String(ticket.name || "").trim(),
    description: String(ticket.description || ""),
    price,
    currency,
    quantityAvailable: integerAtLeast(ticket.quantityAvailable, 1),
    minPerOrder,
    maxPerOrder: Math.max(
      minPerOrder,
      integerAtLeast(ticket.maxPerOrder, minPerOrder),
    ),
    groupMultiplier: integerAtLeast(ticket.groupMultiplier, 1),
    salesStart,
    salesEnd,
    sortOrder: integerAtLeast(ticket.sortOrder, 0),
  };
  if (!normalizedTicket.name) throw new Error("Add a ticket name.");
  const result = ticket.id
    ? await query(
        `UPDATE event_ticket_types ticket_type
         SET name = $1, description = $2, price = $3, currency = $4,
             quantity_available = $5, min_per_order = $6, max_per_order = $7,
             group_multiplier = $8, sales_start = $9, sales_end = $10,
             waitlist_enabled = $11, color = $12, active = $13,
             sort_order = $14, updated_at = NOW()
         FROM events event
         WHERE ticket_type.id = $15
           AND event.id = ticket_type.event_id
           AND event.created_by = $16
           AND ticket_type.event_id = $17
         RETURNING ticket_type.*`,
        [
          normalizedTicket.name,
          normalizedTicket.description,
          normalizedTicket.price,
          normalizedTicket.currency,
          normalizedTicket.quantityAvailable,
          normalizedTicket.minPerOrder,
          normalizedTicket.maxPerOrder,
          normalizedTicket.groupMultiplier,
          normalizedTicket.salesStart || null,
          normalizedTicket.salesEnd || null,
          normalizedTicket.waitlistEnabled,
          normalizedTicket.color,
          normalizedTicket.active,
          normalizedTicket.sortOrder,
          normalizedTicket.id,
          userId,
          normalizedTicket.eventId,
        ],
      )
    : await query(
        `INSERT INTO event_ticket_types (
           event_id, name, description, price, currency, quantity_available,
           min_per_order, max_per_order, group_multiplier, sales_start,
           sales_end, waitlist_enabled, color, active, sort_order
         )
         SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
           $13, $14, $15
         FROM events event
         WHERE event.id = $1 AND event.created_by = $16
         RETURNING *`,
        [
          normalizedTicket.eventId,
          normalizedTicket.name,
          normalizedTicket.description,
          normalizedTicket.price,
          normalizedTicket.currency,
          normalizedTicket.quantityAvailable,
          normalizedTicket.minPerOrder,
          normalizedTicket.maxPerOrder,
          normalizedTicket.groupMultiplier,
          normalizedTicket.salesStart || null,
          normalizedTicket.salesEnd || null,
          normalizedTicket.waitlistEnabled,
          normalizedTicket.color,
          normalizedTicket.active,
          normalizedTicket.sortOrder,
          userId,
        ],
      );
  if (!result.rows[0]) throw new Error("Ticket type could not be saved");
  const saved = mapTicketType({
    ...(result.rows[0] as DatabaseRow),
    sold_count: 0,
  });
  // The ticket row is the source of truth. Payment-product and form-option
  // synchronization are secondary side effects; a transient failure in
  // either must not make an otherwise successful ticket edit look unsaved.
  try {
    await syncTicketPaymentProduct(userId, saved.id);
  } catch {
    // The next ticket/workspace refresh can retry the payment product sync.
  }
  try {
    await syncEventRegistrationTicketOptions(userId, normalizedTicket.eventId);
  } catch {
    // Public forms also hydrate current ticket limits directly from the event.
  }
  return saved;
}

export type EventMeetingProvider = "google_meet" | "teams" | "zoom";

export type EventMeetingProviderOption = {
  key: EventMeetingProvider;
  label: string;
  setupProviderKey: string;
  connected: boolean;
  accountLabel: string;
  connectedProvider: string;
  calendarDescription: string;
};

export const listEventMeetingProviders = async () => {
  if (browserRuntime()) {
    return eventRpc<EventMeetingProviderOption[]>("listEventMeetingProviders");
  }
  throw new Error("Meeting providers can only be loaded from the Events workspace.");
};

export const createEventMeeting = async (eventId: string, provider: EventMeetingProvider) => {
  if (browserRuntime()) {
    return eventRpc<{
      eventId: string;
      provider: EventMeetingProvider;
      providerLabel?: string;
      connectionId?: string;
      externalMeetingId: string;
      calendarEventId: string;
      joinUrl: string;
      hostUrl: string;
      calendarSynced: boolean;
      reused: boolean;
      updatedAt?: string;
    }>("createEventMeeting", { eventId, provider });
  }
  throw new Error("Meeting links can only be created from the Events workspace.");
};

export const syncEventMeeting = async (eventId: string) => {
  if (browserRuntime()) return eventRpc<{ eventId: string; provider: EventMeetingProvider; synced: boolean }>("syncEventMeeting", { eventId });
  throw new Error("Meeting links can only be synced from the Events workspace.");
};

export const cancelEventMeeting = async (eventId: string) => {
  if (browserRuntime()) return eventRpc<{ eventId: string; cancelled: boolean }>("cancelEventMeeting", { eventId });
  throw new Error("Meeting links can only be cancelled from the Events workspace.");
};

export type EventMailTemplate = {
  id: string;
  key: string;
  module: string;
  name: string;
  subject: string;
  htmlBody: string;
  textBody: string;
  blocks: unknown[];
  identityId: string | null;
  isCustom: boolean;
  updatedAt: string;
};

export type EventMailSetting = {
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  applicable: boolean;
  reminderHours?: number;
  template: EventMailTemplate | null;
};

export const listEventMailSettings = async (eventId: string) => {
  if (browserRuntime()) return eventRpc<EventMailSetting[]>("listEventMailSettings", { eventId });
  throw new Error("Event email settings can only be loaded from the Events workspace.");
};

export const toggleEventMailSetting = async (eventId: string, key: string, enabled: boolean) => {
  if (browserRuntime()) return eventRpc<{ updated: boolean }>("toggleEventMailSetting", { eventId, key, enabled });
  throw new Error("Event email settings can only be changed from the Events workspace.");
};

export const setEventReminderHours = async (eventId: string, hoursBefore: number) => {
  if (browserRuntime()) return eventRpc<{ hoursBefore: number }>("setEventReminderHours", { eventId, hoursBefore });
  throw new Error("Event mail settings can only be changed from the Events workspace.");
};

export async function deleteEventTicketType(
  userId: string,
  eventId: string,
  ticketTypeId: string,
) {
  if (browserRuntime()) {
    return eventRpc<void>("deleteEventTicketType", {
      eventId,
      ticketTypeId,
    });
  }
  const result = await query(
    `DELETE FROM event_ticket_types ticket_type
     USING events event
     WHERE ticket_type.id = $1
       AND ticket_type.event_id = $2
       AND event.id = ticket_type.event_id
       AND event.created_by = $3
     RETURNING ticket_type.id`,
    [ticketTypeId, eventId, userId],
  );
  if (result.rows[0]) {
    await deactivateTicketPaymentProduct(userId, ticketTypeId);
  }
  await syncEventRegistrationTicketOptions(userId, eventId);
}

const mapDesign = (row: DatabaseRow): EventTicketDesign => ({
  id: asString(row.id),
  eventId: asString(row.event_id),
  ticketTypeId: asString(row.ticket_type_id) || null,
  templateId: asString(row.template_id) || "blank",
  theme: row.theme
    ? asJson<EventTicketDesignTemplate["theme"] | undefined>(row.theme, undefined)
    : undefined,
  frontLayout: ensureTicketQr(
    asJson<TicketCanvasElement[]>(row.front_layout, defaultFrontLayout()),
  ),
  backLayout: asJson<TicketCanvasElement[]>(row.back_layout, defaultBackLayout()),
  barcodeFormat: "qr",
  outputFormats: asJson<string[]>(row.output_formats, ["digital", "pdf"]),
});

export async function getEventTicketDesign(
  userId: string,
  eventId: string,
  ticketTypeId: string | null = null,
) {
  if (browserRuntime()) {
    return eventRpc<EventTicketDesign | null>("getEventTicketDesign", {
      eventId,
      ticketTypeId,
    });
  }
  const result = await query(
    `SELECT design.*
     FROM event_ticket_designs design
     JOIN events event ON event.id = design.event_id
     WHERE design.event_id = $1
       AND design.ticket_type_id IS NOT DISTINCT FROM $2::uuid
       AND event.created_by = $3
     LIMIT 1`,
    [eventId, ticketTypeId, userId],
  );
  return result.rows[0] ? mapDesign(result.rows[0] as DatabaseRow) : null;
}

/**
 * Every design saved for an event: the shared one (ticketTypeId null) plus any
 * per-ticket-type override.
 */
export async function listEventTicketDesigns(userId: string, eventId: string) {
  if (browserRuntime()) {
    return eventRpc<EventTicketDesign[]>("listEventTicketDesigns", {
      eventId,
    });
  }
  const result = await query(
    `SELECT design.*
     FROM event_ticket_designs design
     JOIN events event ON event.id = design.event_id
     WHERE design.event_id = $1 AND event.created_by = $2
     ORDER BY design.ticket_type_id NULLS FIRST`,
    [eventId, userId],
  );
  return result.rows.map((row) => mapDesign(row as DatabaseRow));
}

/**
 * Resolves the design an issued ticket should use: the ticket type's own
 * design when it has one, otherwise the event's shared design.
 */
export const resolveTicketDesign = (
  designs: EventTicketDesign[],
  ticketTypeId: string | null,
) =>
  (ticketTypeId
    ? designs.find((design) => design.ticketTypeId === ticketTypeId)
    : null) ||
  designs.find((design) => design.ticketTypeId === null) ||
  null;

export async function saveEventTicketDesign(
  userId: string,
  design: Omit<EventTicketDesign, "id"> & { id?: string },
) {
  if (browserRuntime()) {
    return eventRpc<EventTicketDesign>("saveEventTicketDesign", { design });
  }
  // The table has one partial unique index for the shared design and another
  // for per-ticket-type designs, so the upsert has to target the right one.
  const conflictTarget = design.ticketTypeId
    ? "(event_id, ticket_type_id) WHERE ticket_type_id IS NOT NULL"
    : "(event_id) WHERE ticket_type_id IS NULL";
  let result: QueryResult<DatabaseRow>;
  try {
    result = await query(
      `INSERT INTO event_ticket_designs (
       event_id, ticket_type_id, template_id, theme, front_layout, back_layout,
       barcode_format, output_formats, created_at, updated_at
     )
     SELECT $1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8::jsonb, NOW(), NOW()
     FROM events event
     WHERE event.id = $1 AND event.created_by = $9
     ON CONFLICT ${conflictTarget}
     DO UPDATE SET template_id = EXCLUDED.template_id,
       theme = EXCLUDED.theme,
       front_layout = EXCLUDED.front_layout,
       back_layout = EXCLUDED.back_layout,
       barcode_format = EXCLUDED.barcode_format,
       output_formats = EXCLUDED.output_formats,
       updated_at = NOW()
     RETURNING *`,
      [
        design.eventId,
        design.ticketTypeId,
        design.templateId,
        design.theme ? JSON.stringify(design.theme) : null,
        JSON.stringify(ensureTicketQr(design.frontLayout)),
        JSON.stringify(design.backLayout),
        "qr",
        JSON.stringify(design.outputFormats),
        userId,
      ],
    );
  } catch (error) {
    // Older installations may have the design table but not the optional
    // event-scoped theme column yet. Keep activation/editing functional while
    // the migration catches up; newer databases always use the themed path.
    const message = error instanceof Error ? error.message : String(error);
    if (!/theme|column .* does not exist/i.test(message)) throw error;
    result = await query(
      `INSERT INTO event_ticket_designs (
         event_id, ticket_type_id, template_id, front_layout, back_layout,
         barcode_format, output_formats, created_at, updated_at
       )
       SELECT $1, $2, $3, $4::jsonb, $5::jsonb, $6, $7::jsonb, NOW(), NOW()
       FROM events event
       WHERE event.id = $1 AND event.created_by = $8
       ON CONFLICT ${conflictTarget}
       DO UPDATE SET template_id = EXCLUDED.template_id,
         front_layout = EXCLUDED.front_layout,
         back_layout = EXCLUDED.back_layout,
         barcode_format = EXCLUDED.barcode_format,
         output_formats = EXCLUDED.output_formats,
         updated_at = NOW()
       RETURNING *`,
      [
        design.eventId,
        design.ticketTypeId,
        design.templateId,
        JSON.stringify(ensureTicketQr(design.frontLayout)),
        JSON.stringify(design.backLayout),
        "qr",
        JSON.stringify(design.outputFormats),
        userId,
      ],
    );
  }
  if (!result.rows[0]) throw new Error("Ticket design could not be saved");
  return mapDesign(result.rows[0] as DatabaseRow);
}

/** Drops a ticket type's own design so it falls back to the shared one. */
export async function deleteEventTicketDesign(
  userId: string,
  eventId: string,
  ticketTypeId: string | null,
) {
  if (browserRuntime()) {
    return eventRpc<void>("deleteEventTicketDesign", {
      eventId,
      ticketTypeId,
    });
  }
  if (ticketTypeId) {
    await query(
      `DELETE FROM event_ticket_designs design
       USING events event
       WHERE design.event_id = $1
         AND design.ticket_type_id = $2::uuid
         AND event.id = design.event_id
         AND event.created_by = $3`,
      [eventId, ticketTypeId, userId],
    );
    return;
  }
  await query(
    `DELETE FROM event_ticket_designs design
     USING events event
     WHERE design.event_id = $1
       AND design.ticket_type_id IS NULL
       AND event.id = design.event_id
       AND event.created_by = $2`,
    [eventId, userId],
  );
}

const mapAttendee = (row: DatabaseRow): EventAttendee => ({
  id: asString(row.id),
  eventId: asString(row.event_id),
  orderId: asString(row.order_id) || null,
  ticketTypeId: asString(row.ticket_type_id) || null,
  ticketTypeName: asString(row.ticket_type_name) || "Unassigned",
  fullName: asString(row.full_name),
  email: asString(row.email),
  phone: asString(row.phone),
  ticketStatus: (asString(row.ticket_status) || "valid") as EventAttendee["ticketStatus"],
  ticketCode: asString(row.ticket_code),
  ticketNumber: asString(row.ticket_number),
  checkedInAt: asString(row.checked_in_at),
  checkedInByName: asString(row.checked_in_by_name),
  createdAt: asString(row.created_at),
});

export async function listEventAttendees(userId: string, eventId: string) {
  if (browserRuntime()) {
    return eventRpc<EventAttendee[]>("listEventAttendees", { eventId });
  }
  const result = await query(
    `SELECT attendee.*,
       ticket_type.name AS ticket_type_name,
       staff.full_name AS checked_in_by_name
     FROM event_attendees attendee
     JOIN events event ON event.id = attendee.event_id
     LEFT JOIN event_ticket_types ticket_type ON ticket_type.id = attendee.ticket_type_id
     LEFT JOIN users staff ON staff.id = attendee.checked_in_by
     WHERE attendee.event_id = $1 AND event.created_by = $2
     ORDER BY attendee.created_at DESC`,
    [eventId, userId],
  );
  return result.rows.map((row) => mapAttendee(row as DatabaseRow));
}

async function callTicketApi(
  action:
    | "issue"
    | "scan"
    | "validator-link"
    | "rotate-validator-link",
  body: Record<string, unknown>,
) {
  if (eventsServerDependencies && action === "issue") {
    return eventsServerDependencies.issueStoredTicket(
      asString(body.eventId),
      asString(body.attendeeId),
    );
  }
  const token = localStorage.getItem("access_token");
  const response = await fetch(`/api/events/tickets?action=${action}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const result = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      asString(result.message) || "We could not complete that ticket action.",
    );
  }
  return result;
}

export async function issueComplimentaryTicket(
  userId: string,
  input: {
    eventId: string;
    ticketTypeId: string;
    fullName: string;
    email: string;
    phone: string;
    currency: string;
  },
) {
  if (browserRuntime()) {
    return eventRpc<EventAttendee>("issueComplimentaryTicket", { input });
  }
  const result = await query(
    `WITH owned_event AS (
       SELECT id FROM events WHERE id = $1 AND created_by = $2
     ),
     saved_order AS (
       INSERT INTO event_orders (
         event_id, purchaser_name, purchaser_email, status, subtotal, fees,
         total_amount, currency, source, created_at, updated_at
       )
       SELECT id, $3, $4, 'complimentary', 0, 0, 0, $5, 'manual', NOW(), NOW()
       FROM owned_event
       RETURNING id, event_id
     )
     INSERT INTO event_attendees (
       event_id, order_id, ticket_type_id, full_name, email, phone,
       ticket_status, answers, created_at, updated_at
     )
     SELECT saved_order.event_id, saved_order.id, $6, $3, $4, $7,
       'valid', '{}'::jsonb, NOW(), NOW()
     FROM saved_order
     RETURNING id`,
    [
      input.eventId,
      userId,
      input.fullName,
      input.email,
      input.currency,
      input.ticketTypeId,
      input.phone,
    ],
  );
  const attendeeId = asString((result.rows[0] as DatabaseRow | undefined)?.id);
  if (!attendeeId) throw new Error("The complimentary ticket could not be issued");
  await callTicketApi("issue", {
    eventId: input.eventId,
    attendeeId,
  });
  // The complimentary order and issued ticket are committed before this
  // asynchronous lifecycle email is dispatched. Delivery failures must not
  // make a valid free registration appear to have failed.
  void Promise.resolve(
    eventsServerDependencies?.sendEventAttendeeEmails?.(
      input.eventId,
      attendeeId,
      false,
    ),
  ).catch(() => undefined);
  const attendees = await listEventAttendees(userId, input.eventId);
  const attendee = attendees.find((item) => item.id === attendeeId);
  if (!attendee) throw new Error("The attendee could not be reloaded");
  return attendee;
}

export async function transferEventTicket(
  userId: string,
  attendee: EventAttendee,
  input: { fullName: string; email: string; phone: string },
) {
  if (browserRuntime()) {
    return eventRpc<void>("transferEventTicket", { attendee, input });
  }
  const result = await query(
    `WITH original AS (
       UPDATE event_attendees attendee
       SET ticket_status = 'transferred',
           void_reason = 'Transferred to a new attendee',
           ticket_code = NULL,
           updated_at = NOW()
       FROM events event
       WHERE attendee.id = $1
         AND event.id = attendee.event_id
         AND event.created_by = $2
         AND attendee.ticket_status = 'valid'
       RETURNING attendee.*
     )
     INSERT INTO event_attendees (
       event_id, order_id, ticket_type_id, full_name, email, phone,
       ticket_status, code_version, transferred_from, answers,
       created_at, updated_at
     )
     SELECT event_id, order_id, ticket_type_id, $3, $4, $5, 'valid',
       code_version + 1, id, answers, NOW(), NOW()
     FROM original
     RETURNING id, event_id`,
    [attendee.id, userId, input.fullName, input.email, input.phone],
  );
  const row = result.rows[0] as DatabaseRow | undefined;
  if (!row) throw new Error("Only a valid ticket can be transferred");
  await callTicketApi("issue", {
    eventId: asString(row.event_id),
    attendeeId: asString(row.id),
  });
}

export async function voidEventTicket(
  userId: string,
  attendeeId: string,
  reason: string,
) {
  if (browserRuntime()) {
    return eventRpc<void>("voidEventTicket", { attendeeId, reason });
  }
  const result = await query(
    `UPDATE event_attendees attendee
     SET ticket_status = 'void',
         ticket_code = NULL,
         void_reason = $1,
         updated_at = NOW()
     FROM events event
     WHERE attendee.id = $2
       AND event.id = attendee.event_id
       AND event.created_by = $3
       AND attendee.ticket_status = 'valid'
     RETURNING attendee.id`,
    [reason, attendeeId, userId],
  );
  if (!result.rows[0]) throw new Error("Only a valid ticket can be voided");
}

export async function checkInEventTicket(input: {
  eventId?: string;
  ticketCode?: string;
  attendeeId?: string;
  station: string;
  overrideReason?: string;
}) {
  return callTicketApi("scan", input) as Promise<TicketValidationResult>;
}

export async function getWorkspaceTicketValidatorLink() {
  return callTicketApi(
    "validator-link",
    {},
  ) as Promise<WorkspaceTicketValidatorLink>;
}

export async function rotateWorkspaceTicketValidatorLink() {
  return callTicketApi(
    "rotate-validator-link",
    {},
  ) as Promise<WorkspaceTicketValidatorLink>;
}

async function callPublicTicketValidator<T>(
  action: "public-info" | "public-scan",
  body: Record<string, unknown>,
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`/api/events/tickets?action=${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const result = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!response.ok) {
      throw new Error(
        asString(result.message) || "Ticket validation is unavailable.",
      );
    }
    return result as T;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("Ticket validation took too long. Please try again.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function getPublicTicketValidator(maskedId: string) {
  return callPublicTicketValidator<PublicTicketValidatorInfo>("public-info", {
    maskedId,
  });
}

export async function validatePublicTicket(input: {
  maskedId: string;
  ticketCode: string;
  station: string;
}) {
  return callPublicTicketValidator<TicketValidationResult>("public-scan", input);
}

export async function listCheckedInAttendees(
  userId: string,
  eventId: string,
  page = 1,
  pageSize = 10,
) {
  if (browserRuntime()) {
    return eventRpc<EventCheckedInPage>("listCheckedInAttendees", {
      eventId,
      page,
      pageSize,
    });
  }
  const totalResult = await query(
    `SELECT COUNT(*) AS total
     FROM event_attendees attendee
     JOIN events event ON event.id = attendee.event_id
     WHERE attendee.event_id = $1
       AND event.created_by = $2
       AND attendee.checked_in_at IS NOT NULL`,
    [eventId, userId],
  );
  const total = asNumber((totalResult.rows[0] as DatabaseRow | undefined)?.total);
  const safePageSize = Math.min(50, Math.max(1, Math.floor(pageSize || 10)));
  const totalPages = Math.max(1, Math.ceil(total / safePageSize));
  const safePage = Math.min(totalPages, Math.max(1, Math.floor(page || 1)));
  const result = await query(
    `SELECT attendee.*,
       ticket_type.name AS ticket_type_name,
       staff.full_name AS checked_in_by_name
     FROM event_attendees attendee
     JOIN events event ON event.id = attendee.event_id
     LEFT JOIN event_ticket_types ticket_type ON ticket_type.id = attendee.ticket_type_id
     LEFT JOIN users staff ON staff.id = attendee.checked_in_by
     WHERE attendee.event_id = $1
       AND event.created_by = $2
       AND attendee.checked_in_at IS NOT NULL
     ORDER BY attendee.checked_in_at DESC, attendee.created_at DESC
     LIMIT $3 OFFSET $4`,
    [eventId, userId, safePageSize, (safePage - 1) * safePageSize],
  );
  return {
    items: result.rows.map((row) => mapAttendee(row as DatabaseRow)),
    page: safePage,
    pageSize: safePageSize,
    total,
  } satisfies EventCheckedInPage;
}

export async function listEventScans(userId: string, eventId: string) {
  if (browserRuntime()) {
    return eventRpc<EventScan[]>("listEventScans", { eventId });
  }
  const result = await query(
    `SELECT scan.*,
       attendee.full_name AS attendee_name
     FROM event_ticket_scans scan
     JOIN events event ON event.id = scan.event_id
     LEFT JOIN event_attendees attendee ON attendee.id = scan.attendee_id
     WHERE scan.event_id = $1 AND event.created_by = $2
     ORDER BY scan.scanned_at DESC
     LIMIT 250`,
    [eventId, userId],
  );
  return result.rows.map((row) => {
    const item = row as DatabaseRow;
    return {
      id: asString(item.id),
      attendeeId: asString(item.attendee_id) || null,
      attendeeName: asString(item.attendee_name),
      result: asString(item.result) as EventScan["result"],
      station: asString(item.station),
      overrideReason: asString(item.override_reason),
      scannedAt: asString(item.scanned_at),
    } satisfies EventScan;
  });
}

export type PublicEventData = {
  event: EventRecord;
  ownerShortId: string;
  registrationFormSlug: string;
  ticketTypes: EventTicketType[];
};

export async function getPublicEvent(
  slug: string,
  workspaceId?: string,
): Promise<PublicEventData | null> {
  if (browserRuntime()) {
    return eventRpc<PublicEventData | null>("getPublicEvent", {
      slug,
      workspaceId,
    });
  }
  const result = await query(
    `SELECT ${eventSelect},
       form.slug AS registration_form_slug,
       owner.short_id AS owner_short_id
     FROM events event
     LEFT JOIN forms form ON form.id = event.registration_form_id
     JOIN users owner ON owner.id = event.created_by
     WHERE event.slug = $1
       AND event.status IN ('published', 'on_sale', 'sold_out', 'past')
       AND ($2::text IS NULL OR owner.short_id = $2::text)
     LIMIT 1`,
    [slug, workspaceId || null],
  );
  if (!result.rows[0]) return null;
  const row = result.rows[0] as DatabaseRow;
  const tickets = await query(
    `SELECT ticket_type.*,
       (SELECT COUNT(*) FROM event_attendees attendee
        WHERE attendee.ticket_type_id = ticket_type.id
          AND attendee.ticket_status IN ('valid', 'transferred')) AS sold_count
     FROM event_ticket_types ticket_type
     WHERE ticket_type.event_id = $1
       AND ticket_type.active = TRUE
     ORDER BY ticket_type.sort_order`,
    [asString(row.id)],
  );
  const event = mapEvent(row, null);
  event.inviteToken = "";
  // Public event pages may describe an online event, but they must never leak
  // a join/host URL or the provider connection metadata before registration.
  const meetingIntegration = event.settings?.meetingIntegration;
  event.onlineUrl = "";
  event.settings = meetingIntegration && typeof meetingIntegration === "object"
    ? {
        meetingProvider: String((meetingIntegration as Record<string, unknown>).providerLabel || (meetingIntegration as Record<string, unknown>).provider || ""),
      }
    : {};
  return {
    event,
    ownerShortId: asString(row.owner_short_id),
    registrationFormSlug: asString(row.registration_form_slug),
    ticketTypes: tickets.rows.map((item) =>
      mapTicketType(item as DatabaseRow),
    ),
  };
}

export async function verifyPublicEventPassword(
  slug: string,
  password: string,
  workspaceId?: string,
) {
  if (browserRuntime()) {
    return eventRpc<boolean>("verifyPublicEventPassword", {
      slug,
      password,
      workspaceId,
    });
  }
  const result = await query(
    `SELECT access_password_hash
     FROM events event
     WHERE event.slug = $1
       AND event.access_control = 'password'
       AND event.status IN ('published', 'on_sale', 'sold_out', 'past')
       AND (
         $2::text IS NULL
         OR event.created_by = (SELECT id FROM users WHERE short_id = $2::text)
       )
     LIMIT 1`,
    [slug, workspaceId || null],
  );
  const passwordHash = asString(
    (result.rows[0] as DatabaseRow | undefined)?.access_password_hash,
  );
  if (!passwordHash || !password) return false;
  try {
    return await compare(password, passwordHash);
  } catch {
    return false;
  }
}

export async function verifyPublicEventInvitation(
  slug: string,
  inviteToken: string,
  workspaceId?: string,
) {
  if (browserRuntime()) {
    return eventRpc<boolean>("verifyPublicEventInvitation", {
      slug,
      inviteToken,
      workspaceId,
    });
  }
  if (inviteToken.trim().length < 16) return false;
  const result = await query(
    `SELECT event.id
     FROM events event
     WHERE event.slug = $1
       AND event.invite_token = $2
       AND event.access_control = 'invite_only'
       AND event.status IN ('published', 'on_sale', 'sold_out', 'past')
       AND (
         $3::text IS NULL
         OR event.created_by = (SELECT id FROM users WHERE short_id = $3::text)
       )
     LIMIT 1`,
    [slug, inviteToken.trim(), workspaceId || null],
  );
  return Boolean(result.rows[0]);
}

export type EventWaitlistEntry = {
  id: string;
  eventId: string;
  ticketTypeId: string;
  fullName: string;
  email: string;
  position: number;
  status: "waiting" | "invited" | "converted" | "expired" | "removed";
  expiresAt: string;
};

const mapEventWaitlistEntry = (row: DatabaseRow): EventWaitlistEntry => ({
  id: asString(row.id),
  eventId: asString(row.event_id),
  ticketTypeId: asString(row.ticket_type_id),
  fullName: asString(row.full_name),
  email: asString(row.email),
  position: asNumber(row.position),
  status: (asString(row.status) || "waiting") as EventWaitlistEntry["status"],
  expiresAt: asString(row.expires_at),
});

export async function joinEventWaitlist(input: {
  slug: string;
  workspaceId?: string;
  ticketTypeId: string;
  fullName: string;
  email: string;
}) {
  if (browserRuntime()) {
    return eventRpc<EventWaitlistEntry>("joinEventWaitlist", { input });
  }
  const fullName = input.fullName.trim().replace(/\s+/g, " ").slice(0, 160);
  const email = input.email.trim().toLowerCase().slice(0, 254);
  if (fullName.length < 2 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) {
    throw new Error("Enter your name and a valid email address to join the waitlist.");
  }
  if (!/^[0-9a-f-]{36}$/i.test(input.ticketTypeId)) {
    throw new Error("Choose a valid ticket type for the waitlist.");
  }
  const result = await query(`
    WITH target AS (
      SELECT event.id AS event_id
      FROM events event
      JOIN users owner ON owner.id = event.created_by
      JOIN event_ticket_types ticket
        ON ticket.event_id = event.id
       AND ticket.id = $3::uuid
       AND ticket.active = TRUE
       AND ticket.waitlist_enabled = TRUE
      WHERE event.slug = $1
        AND ($2::text IS NULL OR owner.short_id = $2::text)
        AND event.status IN ('published', 'on_sale', 'sold_out', 'past')
        AND event.waitlist_enabled = TRUE
      LIMIT 1
    ), saved AS (
      INSERT INTO event_waitlist (
        event_id, ticket_type_id, full_name, email, position, status,
        created_at, updated_at
      )
      SELECT target.event_id, $3::uuid, $4, $5,
        COALESCE((
          SELECT MAX(position) + 1
          FROM event_waitlist current_waitlist
          WHERE current_waitlist.event_id = target.event_id
            AND current_waitlist.ticket_type_id = $3::uuid
            AND current_waitlist.status = 'waiting'
        ), 1), 'waiting', NOW(), NOW()
      FROM target
      ON CONFLICT (event_id, ticket_type_id, email)
      DO UPDATE SET full_name = EXCLUDED.full_name,
        status = CASE WHEN event_waitlist.status IN ('removed', 'expired') THEN 'waiting' ELSE event_waitlist.status END,
        updated_at = NOW()
      RETURNING *
    ) SELECT saved.* FROM saved
  `, [input.slug.trim(), input.workspaceId?.trim() || null, input.ticketTypeId, fullName, email]);
  const row = result.rows[0] as DatabaseRow | undefined;
  if (!row) throw new Error("This ticket is not currently accepting waitlist entries.");
  const sendConfirmation = eventsServerDependencies?.sendEventWaitlistEmail;
  if (sendConfirmation) {
    void sendConfirmation(
      asString(row.event_id),
      asString(row.id),
      "event_waitlist_confirmation",
    ).catch(() => undefined);
  }
  return mapEventWaitlistEntry(row);
}

export async function promoteEventWaitlist(userId: string, waitlistId: string) {
  if (browserRuntime()) {
    return eventRpc<EventWaitlistEntry>("promoteEventWaitlist", { waitlistId });
  }
  const result = await query(`
    UPDATE event_waitlist waitlist
    SET status = 'invited', invited_at = NOW(),
      expires_at = NOW() + INTERVAL '48 hours', updated_at = NOW()
    FROM events event
    WHERE waitlist.id = $1
      AND event.id = waitlist.event_id
      AND event.created_by = $2
      AND waitlist.status = 'waiting'
    RETURNING waitlist.*
  `, [waitlistId, userId]);
  const row = result.rows[0] as DatabaseRow | undefined;
  if (!row) throw new Error("This waitlist entry is no longer available to promote.");
  const sendPromotion = eventsServerDependencies?.sendEventWaitlistEmail;
  if (sendPromotion) {
    void sendPromotion(
      asString(row.event_id),
      asString(row.id),
      "event_waitlist_promoted",
    ).catch(() => undefined);
  }
  return mapEventWaitlistEntry(row);
}

import type { FormRecord } from "@/components/forms/form-types";
import type { PreloaderSettings } from "@/components/shared/preloader-config";

export type EventStatus =
  | "draft"
  | "published"
  | "on_sale"
  | "sold_out"
  | "past"
  | "cancelled";

export type EventLocationType = "physical" | "online" | "hybrid";
export type EventAccessControl = "public" | "invite_only" | "password";

export type EventSectionKey =
  | "about"
  | "agenda"
  | "speakers"
  | "sponsors"
  | "faq"
  | "venue";

export type EventBranding = {
  accentColor: string;
  /** Whether the accent follows workspace branding or is an event override. */
  accentColorMode?: "workspace" | "custom";
  backgroundColor: string;
  borderColor: string;
  bodyFontSize: "small" | "medium" | "large";
  buttonTextColor: string;
  contentWidth: "narrow" | "standard" | "wide";
  cornerRadius: number;
  coverImageUrl: string;
  fontFamily: string;
  headingFontFamily: string;
  headingWeight: 500 | 600 | 700;
  heroAlignment: "left" | "center";
  heroBackgroundColor: string;
  heroHeight: "compact" | "standard" | "immersive";
  heroOverlayOpacity: number;
  heroTextColor: string;
  logoUrl: string;
  mutedTextColor: string;
  preloader: PreloaderSettings;
  surfaceColor: string;
  textColor: string;
};

export type EventSeo = {
  title: string;
  description: string;
  shareImageUrl: string;
};

export type EventAgendaItem = {
  id: string;
  time: string;
  title: string;
  description: string;
};

export type EventSpeaker = {
  id: string;
  name: string;
  role: string;
  bio: string;
  imageUrl: string;
};

export type EventSponsor = {
  id: string;
  name: string;
  description: string;
  website: string;
  logoUrl: string;
};

export type EventFaqItem = {
  id: string;
  question: string;
  answer: string;
};

export type EventSectionContent = {
  about: {
    heading: string;
    body: string;
  };
  agenda: EventAgendaItem[];
  speakers: EventSpeaker[];
  sponsors: EventSponsor[];
  faq: EventFaqItem[];
  venue: {
    name: string;
    address: string;
    directions: string;
    mapUrl: string;
  };
};

export type EventPricing = {
  enabled: boolean;
  amount: number;
  currency: string;
  label: string;
  salesStart: string;
  salesEnd: string;
  taxIncluded: boolean;
  couponsEnabled: boolean;
  discountsEnabled: boolean;
};

export type EventDiscountRule = {
  id: string;
  eventId: string;
  name: string;
  mode: "first_n" | "date_window" | "promo_code" | "group_size";
  valueType: "percentage" | "fixed";
  value: number;
  firstN: number;
  minQuantity: number;
  code: string;
  startsAt: string;
  endsAt: string;
  redemptionLimit: number | null;
  active: boolean;
  sortOrder: number;
};

export type EventDailySchedule = {
  date: string;
  startTime: string;
  endTime: string;
};

export type EventRecord = {
  id: string;
  eventCode: string;
  createdBy: string;
  registrationFormId: string | null;
  registrationForm: FormRecord | null;
  templateId: string | null;
  /** Optional project grouping; null means the event is unassigned. */
  projectId: string | null;
  title: string;
  slug: string;
  description: string;
  status: EventStatus;
  scheduleType: "single_day" | "date_range";
  eventDate: string;
  rangeStartDate: string;
  rangeEndDate: string;
  rangeScheduleMode: "continuous" | "daily";
  startTime: string;
  endTime: string;
  dailySchedule: EventDailySchedule[];
  locationType: EventLocationType;
  venueName: string;
  address: string;
  onlineUrl: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  branding: EventBranding;
  publicSections: EventSectionKey[];
  seo: EventSeo;
  capacityTotal: number | null;
  refundPolicy: string;
  refundWindowHours: number;
  accessControl: EventAccessControl;
  accessPassword: string;
  accessPasswordSet: boolean;
  inviteToken: string;
  inviteMessage: string;
  waitlistEnabled: boolean;
  ticketingEnabled: boolean;
  ticketPrefix: string;
  ticketPrefixConfigured: boolean;
  pricing: EventPricing;
  discountRules: EventDiscountRule[];
  sectionContent: EventSectionContent;
  settings: Record<string, unknown>;
  ticketTypeCount: number;
  minimumTicketPrice: number;
  maximumTicketPrice: number;
  ticketCurrency: string;
  soldCount: number;
  attendeeCount: number;
  checkedInCount: number;
  revenue: number;
  createdAt: string;
  updatedAt: string;
};

export type EventTemplate = {
  id: string;
  name: string;
  category: string;
  description: string;
  imagePath: string;
  eventDefaults: Record<string, unknown>;
  ticketDesign: Record<string, unknown>;
};

export type EventTicketType = {
  id: string;
  eventId: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  quantityAvailable: number;
  soldCount: number;
  minPerOrder: number;
  maxPerOrder: number;
  groupMultiplier: number;
  salesStart: string;
  salesEnd: string;
  waitlistEnabled: boolean;
  color: string;
  active: boolean;
  sortOrder: number;
};

export type TicketFontFamily =
  | "inherit"
  | "sans"
  | "serif"
  | "mono"
  | "display";

/**
 * Per-element overrides on top of the template theme. Every value is optional:
 * an unset key means "inherit from the template".
 */
export type TicketElementStyle = {
  fontFamily?: TicketFontFamily;
  /** Percent of the size preset, 50-250. */
  fontScale?: number;
  fontWeight?: number;
  fontStyle?: "normal" | "italic";
  /** Hundredths of an em, -10 to 60. */
  letterSpacing?: number;
  /** Percent, 90-260. */
  lineHeight?: number;
  textTransform?: "none" | "uppercase" | "lowercase" | "capitalize";
  textColor?: string;
  captionColor?: string;
  backgroundColor?: string;
  /** Percent, applied to the block background only. */
  backgroundOpacity?: number;
  borderColor?: string;
  borderWidth?: number;
  borderRadius?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  marginTop?: number;
  marginRight?: number;
  marginBottom?: number;
  marginLeft?: number;
  /** Percent, 10-100. */
  opacity?: number;
  /** Degrees, -30 to 30. */
  rotation?: number;
  /** Hides the small uppercase label above the value. */
  hideCaption?: boolean;
  /** Draws the type's icon before the value (calendar, pin, clock...). */
  showIcon?: boolean;
  /** Height as a share of the ticket height, for panels and dividers. */
  height?: number;
};

export type TicketElementType =
  // Live values pulled from the event, attendee, or ticket record.
  | "event_name"
  | "event_tagline"
  | "event_details"
  | "event_date"
  | "event_time"
  | "venue"
  | "address"
  | "organizer"
  | "attendee_name"
  | "attendee_email"
  | "ticket_type"
  | "ticket_price"
  | "ticket_number"
  | "order_code"
  | "event_code"
  // Codes.
  | "qr"
  | "barcode"
  // Authored content and decoration.
  | "logo"
  | "image"
  | "custom_text"
  | "terms"
  | "panel"
  | "divider";

export type TicketCanvasElement = {
  id: string;
  type: TicketElementType;
  label: string;
  value?: string;
  x: number;
  y: number;
  width: number;
  align?: "left" | "center" | "right";
  size?: "small" | "medium" | "large";
  style?: TicketElementStyle;
};

export type EventTicketDesign = {
  id: string;
  eventId: string;
  ticketTypeId: string | null;
  templateId: string;
  /** Event-only theme overrides; the reusable template remains unchanged. */
  theme?: EventTicketDesignTemplate["theme"];
  frontLayout: TicketCanvasElement[];
  backLayout: TicketCanvasElement[];
  barcodeFormat: "qr" | "code128";
  outputFormats: string[];
};

export type EventTicketDesignTemplate = {
  id: string;
  createdBy: string | null;
  sourceTemplateId: string | null;
  isSystem: boolean;
  name: string;
  category: string;
  description: string;
  theme: {
    background: string;
    accent: string;
    text: string;
    muted: string;
    edge: "solid" | "perforated" | "double";
    motif: string;
    backgroundImage?: string;
  };
  frontLayout: TicketCanvasElement[];
  backLayout: TicketCanvasElement[];
};

export type EventModulePreferences = {
  organizerName: string;
  replyToEmail: string;
  supportEmail: string;
  defaultTimezone: string;
  defaultAccessControl: EventAccessControl;
  defaultTicketingEnabled: boolean;
  defaultWaitlistEnabled: boolean;
  defaultRefundPolicy: string;
  registrationConfirmation: string;
};

export type EventAttendee = {
  id: string;
  eventId: string;
  orderId: string | null;
  ticketTypeId: string | null;
  ticketTypeName: string;
  fullName: string;
  email: string;
  phone: string;
  ticketStatus: "valid" | "void" | "refunded" | "transferred";
  ticketCode: string;
  ticketNumber: string;
  checkedInAt: string;
  checkedInByName: string;
  createdAt: string;
};

export type EventScan = {
  id: string;
  attendeeId: string | null;
  attendeeName: string;
  result:
    | "valid"
    | "already_used"
    | "refunded"
    | "void"
    | "wrong_event"
    | "invalid_signature"
    | "manual_override"
    | "offline_conflict";
  station: string;
  overrideReason: string;
  scannedAt: string;
};

export type EventCheckedInPage = {
  items: EventAttendee[];
  page: number;
  pageSize: number;
  total: number;
};

export type WorkspaceTicketValidatorLink = {
  maskedId: string;
  path: string;
  rotatedAt: string;
};

export type PublicTicketValidatorInfo = {
  brandColor: string;
  logoUrl: string;
  maskedId: string;
  workspaceName: string;
};

export type TicketValidationResult = {
  result:
    | "valid"
    | "already_used"
    | "refunded"
    | "void"
    | "wrong_event"
    | "invalid_signature"
    | "manual_override";
  message: string;
  attendeeName?: string;
  ticketTypeName?: string;
  ticketNumber?: string;
  eventId?: string;
  eventTitle?: string;
  checkedInAt?: string;
  checkedInByName?: string;
};

export type EventsTab =
  | "all"
  | "templates"
  | "email_templates"
  | "tickets"
  | "checkin"
  | "pricing"
  | "analytics"
  | "settings";

export type EventEditorTab =
  | "details"
  | "preloader"
  | "registration"
  | "pricing"
  | "ticket_types"
  | "attendees"
  | "analytics"
  | "mail_settings"
  | "settings";

/**
 * Appointments client.
 *
 * Mirrors the email/campaign clients: one workspace read, and a narrow set of
 * writes that each return the saved record so the caller can update in place
 * rather than refetching everything.
 */
const token = () => localStorage.getItem("access_token") || "";

const headers = () => ({
  "Content-Type": "application/json",
  ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
});

export class AppointmentsRequestError extends Error {
  constructor(
    message: string,
    readonly code = "appointments_error",
    readonly status = 400,
  ) {
    super(message);
    this.name = "AppointmentsRequestError";
  }
}

const request = async <T>(
  action: string,
  init: RequestInit = {},
  query: Record<string, string> = {},
) => {
  const params = new URLSearchParams({ action, ...query });
  const response = await fetch(`/api/appointments/data?${params.toString()}`, {
    ...init,
    headers: { ...headers(), ...(init.headers || {}) },
  });

  // A non-JSON body means something upstream answered instead of the API — an
  // error page or a re-auth redirect. Treating it as data would hand the module
  // an object with none of its fields and blank the tab.
  let parsed: unknown;
  let readable = true;
  try {
    parsed = await response.json();
  } catch {
    readable = false;
  }
  const value = (readable && parsed && typeof parsed === "object" ? parsed : {}) as T & {
    error?: string;
    code?: string;
  };
  if (!response.ok) {
    throw new AppointmentsRequestError(
      value.error || "Appointments could not be updated.",
      value.code || "appointments_request_failed",
      response.status,
    );
  }
  if (!readable || !parsed || typeof parsed !== "object") {
    throw new AppointmentsRequestError(
      "Appointments returned an unexpected response. Please try again.",
      "appointments_invalid_response",
      response.status,
    );
  }
  return value;
};

export type BookingPageLocation = "video" | "phone" | "in_person" | "ask_invitee";
export type SchedulingType = "single" | "round_robin" | "collective" | "group";
export type AppointmentStatus =
  | "confirmed"
  | "cancelled"
  | "rescheduled"
  | "completed"
  | "no_show";

export type BookingPageQuestion = {
  id: string;
  type: string;
  label: string;
  required?: boolean;
  options?: string[];
};

export type BookingPageHost = { id: string; name: string; email: string };

export type BookingPage = {
  id: string;
  slug: string;
  name: string;
  description: string;
  durationMinutes: number;
  locationType: BookingPageLocation;
  locationDetail: string;
  videoProvider: string;
  schedulingType: SchedulingType;
  capacity: number;
  questions: BookingPageQuestion[];
  branding: {
    coverImage?: string;
    logo?: string;
    accent?: string;
    welcomeMessage?: string;
  };
  hosts: BookingPageHost[];
  priceCents: number;
  currency: string;
  color: string;
  status: "draft" | "live";
  bookings: number;
  views: number;
  updatedAt: string | null;
};

export type RoutingRule = {
  id: string;
  field: string;
  operator: "equals" | "not_equals" | "contains";
  value: string;
  bookingPageId: string;
};

export type RoutingForm = {
  id: string;
  slug: string;
  name: string;
  description: string;
  questions: BookingPageQuestion[];
  routingRules: RoutingRule[];
  fallbackBookingPageId: string | null;
  status: "draft" | "live";
  updatedAt: string | null;
};

export type Appointment = {
  id: string;
  bookingPageId: string | null;
  bookingPageName: string;
  routingFormId: string | null;
  inviteeName: string;
  inviteeEmail: string;
  inviteeTimezone: string;
  hostName: string;
  hostEmail: string;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  locationType: BookingPageLocation;
  meetingUrl: string;
  answers: Record<string, unknown>;
  paymentStatus: string;
  amountCents: number;
  currency: string;
  externalSource: string;
  color: string;
  createdAt: string | null;
};

export type AvailabilityWindow = { start: string; end: string };

export type DayReason = { type: string; note?: string };

export type Availability = {
  timezone: string;
  weeklyHours: Record<string, AvailabilityWindow[]>;
  /** Why a weekday is closed — keyed by the same weekday key as weeklyHours. */
  dayReasons: Record<string, DayReason>;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minimumNoticeMinutes: number;
  maximumAdvanceDays: number;
  dailyBookingCap: number;
  slotIntervalMinutes: number;
};

export type BlackoutDate = {
  id: string;
  startsOn: string;
  endsOn: string;
  reason: string;
  reasonType: string;
};

export type SchedulingToolProvider =
  | "google_calendar"
  | "outlook"
  | "zoom"
  | "google_meet"
  | "teams"
  | "calendly"
  | "cal_com";

export type SchedulingConnection = {
  id: string;
  provider: SchedulingToolProvider;
  category: "calendar" | "video" | "scheduling";
  accountLabel: string;
  /** connected | needs_reconnect | error */
  status: string;
  healthOk: boolean;
  lastError: string;
  lastSyncedAt: string | null;
  authType: string;
  connectedAt: string | null;
  tokenExpiresAt: string | null;
  scopes: string[];
  /** False for a row left over from before the OAuth handshake existed. */
  hasCredential: boolean;
  hasWebhook: boolean;
};

export type AppointmentsWorkspace = {
  bookingPages: BookingPage[];
  routingForms: RoutingForm[];
  appointments: Appointment[];
  availability: Availability;
  blackoutDates: BlackoutDate[];
  connections: SchedulingConnection[];
  /** Rolled up from the same records the Payments module reports on. */
  payments: { paidCents: number; paidCount: number; pendingCount: number };
};

export type AppointmentsAnalytics = {
  days: number;
  trend: Array<{ date: string; total: number; noShows: number; revenueCents: number }>;
  pages: Array<{
    id: string;
    name: string;
    booked: number;
    noShows: number;
    views: number;
    revenueCents: number;
    conversion: number;
  }>;
  hosts: Array<{ host: string; booked: number; noShows: number }>;
  popularHours: Array<{ hour: number; booked: number }>;
};

export const appointmentsWorkspaceQueryKey = (userId: string) => [
  "appointments",
  "workspace",
  userId,
];
export const appointmentsAnalyticsQueryKey = (userId: string, days: number) => [
  "appointments",
  "analytics",
  userId,
  days,
];

export const getAppointmentsWorkspace = () =>
  request<AppointmentsWorkspace>("workspace");

export const getAppointmentsAnalytics = (days = 30) =>
  request<AppointmentsAnalytics>("analytics", {}, { days: String(days) });

export const saveBookingPage = (input: Partial<BookingPage>) =>
  request<{ bookingPage: BookingPage }>("save-booking-page", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const deleteBookingPage = (id: string) =>
  request<{ deleted: boolean }>("delete-booking-page", {
    method: "POST",
    body: JSON.stringify({ id }),
  });

export const saveRoutingForm = (input: Partial<RoutingForm>) =>
  request<{ routingForm: RoutingForm }>("save-routing-form", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const deleteRoutingForm = (id: string) =>
  request<{ deleted: boolean }>("delete-routing-form", {
    method: "POST",
    body: JSON.stringify({ id }),
  });

/** Returns the booking page a set of answers routes to. */
export const routeSubmission = (routingFormId: string, answers: Record<string, unknown>) =>
  request<{ bookingPageId: string | null; matchedRuleId: string }>("route-submission", {
    method: "POST",
    body: JSON.stringify({ routingFormId, answers }),
  });

export const saveAppointment = (input: Partial<Appointment>) =>
  request<{
    appointment: Appointment;
    notification: {
      status: "sent" | "failed" | "not_required";
      emailId?: string;
      provider?: string;
      error?: string;
    };
  }>("save-appointment", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const deleteAppointment = (id: string) =>
  request<{ deleted: boolean }>("delete-appointment", {
    method: "POST",
    body: JSON.stringify({ id }),
  });

export const saveAvailability = (input: Partial<Availability>) =>
  request<{ availability: Availability }>("save-availability", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const addBlackoutDate = (input: Omit<BlackoutDate, "id">) =>
  request<{ blackout: BlackoutDate }>("add-blackout", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const deleteBlackoutDate = (id: string) =>
  request<{ deleted: boolean }>("delete-blackout", {
    method: "POST",
    body: JSON.stringify({ id }),
  });

export const getEmbedSnippet = (bookingPageId: string, embedType = "iframe") =>
  request<{ embedType: string; snippet: string; url: string }>(
    "embed-snippet",
    {},
    { bookingPageId, embedType },
  );

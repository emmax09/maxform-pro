import type { Appointment, BookingPage, SchedulingToolProvider } from "@/lib/appointments";

/** Presentation helpers shared by the appointments panels. */

export const WEEKDAYS = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" },
] as const;

export const locationLabels: Record<string, string> = {
  video: "Video call",
  phone: "Phone call",
  in_person: "In person",
  ask_invitee: "Ask invitee",
};

export const schedulingLabels: Record<string, string> = {
  single: "Single host",
  round_robin: "Round robin",
  collective: "Collective",
  group: "Group",
};

export const statusLabels: Record<string, string> = {
  confirmed: "Confirmed",
  cancelled: "Cancelled",
  rescheduled: "Rescheduled",
  completed: "Completed",
  no_show: "No-show",
};

/**
 * Provider identity.
 *
 * Each card carries the vendor's own mark and brand colour, drawn inline rather
 * than fetched, so the grid renders offline and under the artifact CSP.
 */
export const providerMeta: Record<
  SchedulingToolProvider,
  { name: string; category: "calendar" | "video" | "scheduling"; brand: string; blurb: string }
> = {
  google_calendar: {
    name: "Google Calendar",
    category: "calendar",
    brand: "#4285F4",
    blurb: "Two-way sync so busy time blocks new bookings and every booking lands on your calendar.",
  },
  outlook: {
    name: "Outlook Calendar",
    category: "calendar",
    brand: "#0F6CBD",
    blurb: "Keep Microsoft 365 availability and MaxForm bookings in step.",
  },
  zoom: {
    name: "Zoom",
    category: "video",
    brand: "#2D8CFF",
    blurb: "Mint a unique Zoom link for every video booking and send it with the confirmation.",
  },
  google_meet: {
    name: "Google Meet",
    category: "video",
    brand: "#00832D",
    blurb: "Generate a Meet room per booking. Separate from Google Calendar — its own connection.",
  },
  teams: {
    name: "Microsoft Teams",
    category: "video",
    brand: "#5B5FC7",
    blurb: "Attach a Teams meeting to bookings hosted by your workspace.",
  },
  calendly: {
    name: "Calendly",
    category: "scheduling",
    brand: "#006BFF",
    blurb: "Migration bridge: bookings made on your existing Calendly are pushed here as contacts and appointments.",
  },
  cal_com: {
    name: "Cal.com",
    category: "scheduling",
    brand: "#111827",
    blurb: "Same webhook bridge as Calendly, for workspaces already running Cal.com.",
  },
};

export const providerCategories: Array<{
  key: "calendar" | "video" | "scheduling";
  label: string;
  note: string;
}> = [
  { key: "calendar", label: "Calendar sync", note: "Read busy time, write new bookings." },
  { key: "video", label: "Video conferencing", note: "Each is its own connection — Google Calendar is not Google Meet." },
  {
    key: "scheduling",
    label: "Scheduling tools",
    note: "A bridge, not a takeover: bookings flow in, but the page stays theirs.",
  },
];

/**
 * Why a day is closed.
 *
 * A short list covers almost every case; "other" keeps the free-text escape
 * hatch so nobody has to bend their reason to fit the list.
 */
export const unavailableReasons: Array<{ value: string; label: string }> = [
  { value: "weekend", label: "Weekend" },
  { value: "public_holiday", label: "Public holiday" },
  { value: "time_off", label: "Annual leave / time off" },
  { value: "focus_time", label: "Focus time — no meetings" },
  { value: "internal_meetings", label: "Internal meetings only" },
  { value: "travel", label: "Travelling" },
  { value: "sick_leave", label: "Sick leave" },
  { value: "training", label: "Training or conference" },
  { value: "other", label: "Other (write your own)" },
];

export const reasonLabel = (type: string, note = "") => {
  if (type === "other") return note.trim() || "Unavailable";
  const match = unavailableReasons.find((item) => item.value === type);
  const label = match ? match.label : "Unavailable";
  return note.trim() ? `${label} — ${note.trim()}` : label;
};

export const money = (cents: number, currency = "USD") =>
  new Intl.NumberFormat(undefined, { style: "currency", currency }).format(
    (Number(cents) || 0) / 100,
  );

export const dayKey = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? "" : date.toISOString().slice(0, 10);
};

export const timeLabel = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "--:--"
    : new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
};

export const dateLabel = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? "Unknown date"
    : new Intl.DateTimeFormat(undefined, {
        weekday: "short",
        day: "numeric",
        month: "short",
      }).format(date);
};

export const isUpcoming = (appointment: Appointment) =>
  new Date(appointment.startsAt).valueOf() >= Date.now() &&
  appointment.status !== "cancelled";

/** No-show rate over bookings that have already happened. */
export const noShowRate = (appointments: Appointment[]) => {
  const past = appointments.filter(
    (item) => new Date(item.startsAt).valueOf() < Date.now() && item.status !== "cancelled",
  );
  if (!past.length) return 0;
  return (past.filter((item) => item.status === "no_show").length / past.length) * 100;
};

export const conversionRate = (page: BookingPage) =>
  page.views ? (page.bookings / page.views) * 100 : 0;

export const emptyBookingPage = (): Partial<BookingPage> => ({
  name: "",
  description: "",
  durationMinutes: 30,
  locationType: "video",
  locationDetail: "",
  videoProvider: "",
  schedulingType: "single",
  capacity: 1,
  questions: [
    { id: "name", type: "short_text", label: "Your name", required: true },
    { id: "email", type: "email", label: "Email address", required: true },
  ],
  branding: { accent: "#635BFF", welcomeMessage: "" },
  hosts: [],
  priceCents: 0,
  currency: "USD",
  color: "#635BFF",
  status: "draft",
});

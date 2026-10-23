import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  AlignCenter,
  AlignLeft,
  AlignRight,
  AlertCircle,
  ArrowLeft,
  ArrowLeftRight,
  BadgePercent,
  BarChart3,
  CalendarDays,
  CalendarClock,
  CalendarRange,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Copy,
  CreditCard,
  Download,
  ExternalLink,
  Eye,
  FileText,
  Globe2,
  GripVertical,
  History,
  ImagePlus,
  LayoutTemplate,
  ListChecks,
  Loader2,
  LockKeyhole,
  Mail,
  MapPin,
  MoreHorizontal,
  Palette,
  PencilLine,
  Plus,
  QrCode,
  RefreshCw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Ticket,
  Trash2,
  Upload,
  UserRoundCheck,
  Users,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";

import {
  TableFilterBar,
  TableFilterSelect,
  TableRowSelect,
  TableSearchField,
  TableSelectionBar,
} from "@/components/shared/TableFilters";
import {
  type EventAttendee,
  type EventDiscountRule,
  type EventCheckedInPage,
  type EventEditorTab,
  type EventModulePreferences,
  type EventRecord,
  type EventPricing,
  type EventSectionContent,
  type EventSectionKey,
  type EventTemplate,
  type EventTicketDesign,
  type EventTicketDesignTemplate,
  type EventTicketType,
  type EventsTab,
  type TicketValidationResult,
  type WorkspaceTicketValidatorLink,
  type TicketCanvasElement,
  type TicketElementType,
} from "@/components/events/event-types";
import { EventPublicSections } from "@/components/events/EventPublicSections";
import { EventMailSettings } from "@/components/events/EventMailSettings";
import { EventEmailTemplates } from "@/components/events/EventEmailTemplates";
import { TicketTemplateDesigner } from "@/components/events/TicketTemplateDesigner";
import {
  TICKET_ELEMENT_LABELS,
  clampElement,
  defaultSizeFor,
  defaultWidthFor,
} from "@/components/events/ticket-designer-model";
import { TicketSurface } from "@/components/events/ticket-surface";
import { FormListConnector } from "@/components/contacts/FormListConnector";
import {
  FormBuilder,
  type FormBuilderModeOption,
} from "@/components/forms/FormBuilder";
import { FormRenderer } from "@/components/forms/FormRenderer";
import {
  defaultPayment,
  type FormRecord,
  type FormVersion,
} from "@/components/forms/form-types";
import { PricingInput } from "@/components/shared/PricingInput";
import { ProjectPicker } from "@/components/projects/ProjectPicker";
import { PaginatedCardGrid } from "@/components/shared/CardGrid";
import { PreloaderSettingsEditor } from "@/components/shared/PublicPreloader";
import { ScopedCouponManager } from "@/components/payments/ScopedCouponManager";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { downloadCsvFile } from "@/lib/csv";
import { scrollDashboardToTop } from "@/lib/dashboard-scroll";
import { uploadFileToStorage } from "@/lib/storage";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { useWorkspaceRegion } from "@/contexts/WorkspaceRegionContext";
import { usePersistentQuery } from "@/hooks/use-persistent-query";
import { useTableSelection } from "@/hooks/use-table-selection";
import {
  checkInEventTicket,
  buildEventDateRange,
  createEvent,
  defaultEventModulePreferences,
  defaultEventPricing,
  deleteEvent,
  deleteEventTicketType,
  getEventModulePreferences,
  getWorkspaceTicketValidatorLink,
  getEventDiscountRuleIssue,
  getEventPublishRequirements,
  deleteEventTicketDesign,
  isEventSlugAvailable,
  issueComplimentaryTicket,
  listCheckedInAttendees,
  listEventAttendees,
  listEventTemplates,
  listEventTicketDesignTemplates,
  listEventTicketDesigns,
  listEventMeetingProviders,
  type EventMeetingProvider,
  type EventMeetingProviderOption,
  resolveTicketDesign,
  listEventTicketTypes,
  listEvents,
  normalizeEventSlug,
  normalizeTicketPrefix,
  rotateWorkspaceTicketValidatorLink,
  saveEvent,
  saveEventModulePreferences,
  saveEventTicketDesign,
  saveEventTicketDesignTemplate,
  saveEventTicketType,
  suggestedTicketPrefix,
  transferEventTicket,
  voidEventTicket,
} from "@/lib/events";
import {
  persistentCacheKey,
  setCachedServerState,
} from "@/lib/performance/indexed-cache";
import { queryKeys } from "@/lib/performance/query-client";
import {
  formatCurrency,
  timezoneOptions,
} from "@/lib/regional-options";
import {
  TICKET_MOTIFS,
  sampleTicketNumber,
  sampleTicketResolver,
  ticketRgba,
  type TicketElementResolver,
} from "@/lib/ticket-theme";
import { cn } from "@/lib/utils";
import { hasConnectedPaymentProvider } from "@/lib/payments";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

const isLiveEventStatus = (status: EventRecord["status"]) =>
  ["published", "on_sale", "sold_out", "past"].includes(status);

type EventWorkspaceData = {
  events: EventRecord[];
  preferences: EventModulePreferences;
  templates: EventTemplate[];
  ticketTemplates: EventTicketDesignTemplate[];
};

type EventDetailData = {
  attendees: EventAttendee[];
  designs: EventTicketDesign[];
  tickets: EventTicketType[];
};

type EventDraftBackup = {
  storedAt: number;
  event: EventRecord;
};

const eventDraftKey = (userId: string, eventId: string) =>
  `maxform:event-draft:${userId}:${eventId}`;

const activeEventKey = (userId: string) =>
  `maxform:active-event:${userId}`;

const activeEventTabKey = (userId: string) =>
  `maxform:active-event-tab:${userId}`;

const storeEventDraft = (userId: string, event: EventRecord) => {
  try {
    localStorage.setItem(
      eventDraftKey(userId, event.id),
      JSON.stringify({
        storedAt: Date.now(),
        event: { ...event, accessPassword: "" },
      } satisfies EventDraftBackup),
    );
  } catch {
    // Database autosave remains active when local storage is unavailable.
  }
};

const clearEventDraft = (userId: string, eventId: string) => {
  try {
    localStorage.removeItem(eventDraftKey(userId, eventId));
  } catch {
    // Nothing else is required when local storage is unavailable.
  }
};

const restoreEventDraft = (userId: string, event: EventRecord) => {
  try {
    const raw = localStorage.getItem(eventDraftKey(userId, event.id));
    if (!raw) return event;
    const backup = JSON.parse(raw) as EventDraftBackup;
    if (
      !backup.event ||
      backup.event.id !== event.id ||
      !Number.isFinite(backup.storedAt)
    ) {
      clearEventDraft(userId, event.id);
      return event;
    }
    return {
      ...event,
      ...backup.event,
      registrationForm:
        backup.event.registrationForm || event.registrationForm,
      accessPassword: "",
    };
  } catch {
    clearEventDraft(userId, event.id);
    return event;
  }
};

const tabs: Array<{
  key: EventsTab;
  label: string;
  shortLabel?: string;
  icon: LucideIcon;
}> = [
  { key: "all", label: "All Events", icon: CalendarRange },
  { key: "templates", label: "Templates", icon: LayoutTemplate },
  { key: "email_templates", label: "Email templates", icon: FileText },
  { key: "tickets", label: "Tickets", icon: Ticket },
  { key: "checkin", label: "Check-in", icon: QrCode },
  { key: "pricing", label: "Pricing", icon: CircleDollarSign },
  { key: "analytics", label: "Analytics", icon: BarChart3 },
  { key: "settings", label: "General Settings", shortLabel: "Settings", icon: Settings2 },
];

const editorTabs: Array<{
  key: EventEditorTab;
  label: string;
  icon: LucideIcon;
  ticketing?: boolean;
}> = [
  { key: "details", label: "Event details", icon: Palette },
  { key: "preloader", label: "Preloader", icon: RefreshCw },
  { key: "registration", label: "Registration", icon: FileText },
  { key: "pricing", label: "Pricing", icon: CircleDollarSign },
  // Ticket types is also the entry point for turning ticketing on and
  // configuring the event-scoped ticket experience.
  { key: "ticket_types", label: "Ticket types", icon: Ticket },
  { key: "attendees", label: "Attendees", icon: Users, ticketing: true },
  { key: "analytics", label: "Analytics", icon: BarChart3 },
  { key: "mail_settings", label: "Mail settings", icon: Mail },
  { key: "settings", label: "Event settings", icon: Settings2 },
];

const registrationBuilderModes: FormBuilderModeOption[] = [
  { value: "build", label: "Build" },
  { value: "logic", label: "Logic" },
  { value: "theme", label: "Theme" },
  { value: "preloader", label: "Preloader" },
  { value: "settings", label: "Settings" },
];

const sectionLabels: Record<EventSectionKey, string> = {
  about: "About",
  agenda: "Agenda",
  speakers: "Speakers",
  sponsors: "Sponsors",
  faq: "FAQ",
  venue: "Venue & map",
};

const eventFontOptions = [
  {
    value: "Inter, ui-sans-serif, system-ui, sans-serif",
    label: "Inter",
    description: "Clean product sans serif",
  },
  {
    value: "Arial, Helvetica, sans-serif",
    label: "Arial",
    description: "Universal sans serif",
  },
  {
    value: "Verdana, Geneva, sans-serif",
    label: "Verdana",
    description: "Highly readable sans serif",
  },
  {
    value: "'Trebuchet MS', Arial, sans-serif",
    label: "Trebuchet",
    description: "Warm modern sans serif",
  },
  {
    value: "Tahoma, Geneva, sans-serif",
    label: "Tahoma",
    description: "Compact interface sans serif",
  },
  {
    value: "Georgia, 'Times New Roman', serif",
    label: "Georgia",
    description: "Editorial serif",
  },
  {
    value: "Garamond, Georgia, serif",
    label: "Garamond",
    description: "Classic display serif",
  },
  {
    value: "'Palatino Linotype', Palatino, serif",
    label: "Palatino",
    description: "Humanist serif",
  },
  {
    value: "'Courier New', Courier, monospace",
    label: "Courier New",
    description: "Monospaced",
  },
];

const defaultTicketDraft = (
  eventId: string,
  currency: string,
  order: number,
): Omit<EventTicketType, "id" | "soldCount"> => ({
  eventId,
  name: "",
  description: "",
  price: 0,
  currency,
  quantityAvailable: 100,
  minPerOrder: 1,
  maxPerOrder: 10,
  groupMultiplier: 1,
  salesStart: "",
  salesEnd: "",
  waitlistEnabled: false,
  color: "#2563EB",
  active: true,
  sortOrder: order,
});

const toDateTimeInput = (value: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

const fromDateTimeInput = (value: string) =>
  value ? new Date(value).toISOString() : "";

const toDateInput = (value: string) => value.slice(0, 10);

const parseDateInput = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const toDateOnlyValue = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

function DatePickerField({
  className,
  id,
  onChange,
  placeholder = "Pick a date",
  value,
}: {
  className?: string;
  id: string;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = parseDateInput(toDateInput(value));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          className={cn(
            "h-10 w-full justify-between bg-background px-3 text-left font-normal",
            !selected && "text-muted-foreground",
            className,
          )}
        >
          <span className="truncate">
            {selected
              ? new Intl.DateTimeFormat(undefined, {
                  dateStyle: "medium",
                }).format(selected)
              : placeholder}
          </span>
          <CalendarDays className="h-4 w-4 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          onSelect={(date) => {
            if (!date) return;
            onChange(toDateOnlyValue(date));
            setOpen(false);
          }}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}

const formatEventTime = (value: string) => {
  if (!value) return "";
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return "";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(2020, 0, 1, hours, minutes));
};

const formatEventCalendarDate = (
  value: string,
  dateStyle: "medium" | "full" = "medium",
) =>
  value
    ? new Intl.DateTimeFormat(undefined, { dateStyle }).format(
        new Date(`${value}T00:00:00`),
      )
    : "";

const formatTimeSpan = (startTime: string, endTime: string) => {
  const start = formatEventTime(startTime);
  const end = formatEventTime(endTime);
  if (!start) return "";
  return end ? `${start} - ${end}` : `Starts ${start}`;
};

const eventDate = (event: EventRecord) => {
  if (event.scheduleType === "single_day") {
    if (!event.eventDate) return "Date not set";
    return [formatEventCalendarDate(event.eventDate), formatTimeSpan(
      event.startTime,
      event.endTime,
    )]
      .filter(Boolean)
      .join(" / ");
  }
  if (!event.rangeStartDate || !event.rangeEndDate) return "Date not set";
  const dates = `${formatEventCalendarDate(event.rangeStartDate)} - ${formatEventCalendarDate(event.rangeEndDate)}`;
  return event.rangeScheduleMode === "daily"
    ? `${dates} / Daily schedule`
    : [dates, formatTimeSpan(event.startTime, event.endTime)]
        .filter(Boolean)
        .join(" / ");
};

/** Calendar date only, in the long form a printed ticket uses. */
const eventDateOnly = (event: EventRecord) => {
  if (event.scheduleType === "single_day") {
    return event.eventDate
      ? formatEventCalendarDate(event.eventDate, "full")
      : "Date not set";
  }
  if (!event.rangeStartDate || !event.rangeEndDate) return "Date not set";
  return `${formatEventCalendarDate(event.rangeStartDate)} - ${formatEventCalendarDate(event.rangeEndDate)}`;
};

/** Clock times only. */
const eventTimeOnly = (event: EventRecord) =>
  event.scheduleType !== "single_day" && event.rangeScheduleMode === "daily"
    ? "Daily schedule"
    : formatTimeSpan(event.startTime, event.endTime) || "Time not set";

const eventVenueName = (event: EventRecord) =>
  event.locationType === "online"
    ? "Online event"
    : event.venueName || "Venue to be announced";

const eventLocation = (event: EventRecord) =>
  event.locationType === "online"
    ? "Online event"
    : [event.venueName, event.address].filter(Boolean).join(", ") ||
      "Venue to be announced";

const eventScheduleEnd = (event: EventRecord) =>
  event.scheduleType === "single_day"
    ? event.eventDate
      ? new Date(`${event.eventDate}T23:59:59`)
      : null
    : event.rangeEndDate
      ? new Date(`${event.rangeEndDate}T23:59:59`)
      : null;

const statusLabel = (status: EventRecord["status"]) =>
  status
    .split("_")
    .map((word) => `${word[0].toUpperCase()}${word.slice(1)}`)
    .join(" ");

const eventPriceLabel = (event: EventRecord, fallbackCurrency: string) => {
  if (event.ticketingEnabled && event.ticketTypeCount > 0) {
    const ticketCurrency = event.ticketCurrency || fallbackCurrency;
    if (event.minimumTicketPrice === event.maximumTicketPrice) {
      return event.minimumTicketPrice > 0
        ? formatCurrency(event.minimumTicketPrice, ticketCurrency)
        : "Free";
    }
    if (event.minimumTicketPrice <= 0) {
      return `Free – ${formatCurrency(event.maximumTicketPrice, ticketCurrency)}`;
    }
    return `${formatCurrency(
      event.minimumTicketPrice,
      ticketCurrency,
    )} – ${formatCurrency(event.maximumTicketPrice, ticketCurrency)}`;
  }
  return event.pricing.enabled && event.pricing.amount > 0
    ? formatCurrency(
        event.pricing.amount,
        event.pricing.currency || fallbackCurrency,
      )
    : "Free";
};

function EmptyEvents({
  onCreate,
  onTemplates,
}: {
  onCreate: () => void;
  onTemplates: () => void;
}) {
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center border-y border-border px-6 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-md bg-primary/10 text-primary">
        <CalendarRange className="h-6 w-6" />
      </span>
      <h2 className="mt-5 text-[20px] font-semibold">Create your first event</h2>
      <p className="mt-2 max-w-[480px] text-[13px] leading-6 text-muted-foreground">
        Build the public page, registration flow, tickets, attendee list, and
        check-in experience in one place.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Button type="button" onClick={onTemplates}>
          <LayoutTemplate className="h-4 w-4" />
          Browse templates
        </Button>
        <Button type="button" variant="outline" onClick={onCreate}>
          <Plus className="h-4 w-4" />
          Start blank
        </Button>
      </div>
    </div>
  );
}

function EventMetrics({
  events,
  currency,
}: {
  events: EventRecord[];
  currency: string;
}) {
  const values = [
    {
      label: "Upcoming",
      value: events.filter(
        (event) => {
          const scheduleEnd = eventScheduleEnd(event);
          return (
            !["past", "cancelled"].includes(event.status) &&
            (!scheduleEnd || scheduleEnd >= new Date())
          );
        },
      ).length.toLocaleString(),
      icon: CalendarClock,
    },
    {
      label: "Tickets issued",
      value: events
        .reduce((sum, event) => sum + event.attendeeCount, 0)
        .toLocaleString(),
      icon: Ticket,
    },
    {
      label: "Checked in",
      value: events
        .reduce((sum, event) => sum + event.checkedInCount, 0)
        .toLocaleString(),
      icon: UserRoundCheck,
    },
    {
      label: "Revenue",
      value: formatCurrency(
        events.reduce((sum, event) => sum + event.revenue, 0),
        currency,
      ),
      icon: CircleDollarSign,
    },
  ];
  return (
    <div className="grid border-y border-border sm:grid-cols-2 xl:grid-cols-4">
      {values.map((item) => {
        const Icon = item.icon;
        return (
          <div
            key={item.label}
            className="border-b border-border px-5 py-5 last:border-b-0 sm:border-r sm:nth-2:border-r-0 xl:border-b-0 xl:nth-2:border-r xl:last:border-r-0"
          >
            <div className="flex items-center gap-2 text-muted-foreground">
              <Icon className="h-4 w-4" />
              <span className="text-[12px]">{item.label}</span>
            </div>
            <p className="mt-3 text-[24px] font-semibold">{item.value}</p>
          </div>
        );
      })}
    </div>
  );
}

function EventListView({
  currency,
  events,
  onCreate,
  onDelete,
  onOpen,
  onOpenLive,
  onPreview,
  onTemplates,
}: {
  currency: string;
  events: EventRecord[];
  onCreate: () => void;
  onDelete: (event: EventRecord) => void;
  onOpen: (event: EventRecord, tab: EventEditorTab) => void;
  onOpenLive: (event: EventRecord) => void;
  onPreview: (event: EventRecord) => void;
  onTemplates: () => void;
}) {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const filtered = events.filter(
    (event) =>
      (status === "all" || event.status === status) &&
      `${event.title} ${event.description} ${event.venueName} ${event.address}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const selection = useTableSelection(filtered.map((event) => event.id));
  const selectedEvents = filtered.filter((event) =>
    selection.selectedVisibleIds.includes(event.id),
  );
  if (events.length === 0) {
    return <EmptyEvents onCreate={onCreate} onTemplates={onTemplates} />;
  }
  return (
    <div className="space-y-7">
      <EventMetrics events={events} currency={currency} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <TableFilterBar className="min-w-0 flex-1">
          <TableSearchField
            value={search}
            onValueChange={setSearch}
            placeholder="Search events"
            aria-label="Search events"
          />
          <TableFilterSelect
            value={status}
            onValueChange={setStatus}
            label="Filter events by status"
            options={[
              { value: "all", label: "All statuses" },
              { value: "draft", label: "Draft" },
              { value: "published", label: "Published" },
              { value: "on_sale", label: "On sale" },
              { value: "sold_out", label: "Sold out" },
              { value: "past", label: "Past" },
              { value: "cancelled", label: "Cancelled" },
            ]}
          />
        </TableFilterBar>
        <Button type="button" onClick={onTemplates}>
          <Plus className="h-4 w-4" />
          New event
        </Button>
      </div>
      <TableSelectionBar
        totalCount={filtered.length}
        selectedCount={selection.selectedVisibleIds.length}
        allSelected={selection.allSelected}
        partiallySelected={selection.partiallySelected}
        onToggleAll={selection.toggleAll}
        onClear={selection.clearSelection}
        itemLabel="events"
      >
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            downloadCsvFile(
              "maxform-events-selected.csv",
              ["Event", "Status", "Date", "Attendees", "Checked in", "Revenue"],
              selectedEvents.map((event) => [
                event.title,
                statusLabel(event.status),
                eventDate(event),
                event.attendeeCount,
                event.checkedInCount,
                event.revenue,
              ]),
            )
          }
        >
          <Download className="h-3.5 w-3.5" />
          Export selected
        </Button>
      </TableSelectionBar>
      {filtered.length ? (
        <div className="divide-y divide-border border-y border-border">
          {filtered.map((event) => (
            <div
              key={event.id}
              className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 py-5 transition-colors hover:bg-muted/20 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:px-3"
            >
              <TableRowSelect
                checked={selection.isSelected(event.id)}
                onCheckedChange={(checked) =>
                  selection.toggle(event.id, checked)
                }
                label={`Select ${event.title}`}
              />
              <button
                type="button"
                onClick={() => onOpen(event, "details")}
                className="flex min-w-0 gap-4 text-left"
              >
                <span
                  className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted"
                  style={{ backgroundColor: event.branding.backgroundColor }}
                >
                  {event.branding.coverImageUrl ? (
                    <img
                      src={event.branding.coverImageUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <Ticket
                      className="h-6 w-6"
                      style={{ color: event.branding.accentColor }}
                    />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-[15px] font-semibold">
                      {event.title}
                    </span>
                    <span className="rounded bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground">
                      {statusLabel(event.status)}
                    </span>
                  </span>
                  <span className="mt-1.5 block text-[12px] text-muted-foreground">
                    {eventDate(event)} · {event.attendeeCount.toLocaleString()} attendees
                  </span>
                  <span className="mt-1 block truncate text-[11px] text-muted-foreground">
                    /event/{user?.short_id}/{event.slug}
                  </span>
                </span>
              </button>
              <div className="col-span-2 flex items-center gap-2 pl-12 sm:col-span-1 sm:justify-end sm:pl-0">
                <div className="mr-3 hidden text-right lg:block">
                  <p className="text-[13px] font-medium">
                    {eventPriceLabel(event, currency)}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {event.attendeeCount > 0
                      ? `${event.checkedInCount.toLocaleString()} of ${event.attendeeCount.toLocaleString()} checked in`
                      : "No attendees yet"}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onPreview(event)}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Preview
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" size="icon" variant="ghost" aria-label="Event actions">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="w-52 rounded-md p-2 shadow-xl"
                  >
                    <DropdownMenuItem
                      className="gap-3 rounded-md px-3 py-2 text-[12px]"
                      onClick={() => onOpen(event, "details")}
                    >
                      <PencilLine className="h-4 w-4 text-muted-foreground" />
                      Edit event
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="gap-3 rounded-md px-3 py-2 text-[12px]"
                      onClick={() => onOpen(event, "settings")}
                    >
                      <ExternalLink className="h-4 w-4 text-muted-foreground" />
                      Edit URL
                    </DropdownMenuItem>
                    {["published", "on_sale", "sold_out", "past"].includes(
                      event.status,
                    ) && (
                      <DropdownMenuItem
                        className="gap-3 rounded-md px-3 py-2 text-[12px]"
                        onClick={() => onOpenLive(event)}
                      >
                        <Globe2 className="h-4 w-4 text-muted-foreground" />
                        Open URL
                      </DropdownMenuItem>
                    )}
                    {event.ticketingEnabled && (
                      <>
                        <DropdownMenuItem
                          className="gap-3 rounded-md px-3 py-2 text-[12px]"
                          onClick={() => onOpen(event, "ticket_types")}
                        >
                          <Ticket className="h-4 w-4 text-muted-foreground" />
                          Ticket types
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="gap-3 rounded-md px-3 py-2 text-[12px]"
                          onClick={() => onOpen(event, "attendees")}
                        >
                          <Users className="h-4 w-4 text-muted-foreground" />
                          Attendees
                        </DropdownMenuItem>
                      </>
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="gap-3 rounded-md px-3 py-2 text-[12px] text-destructive focus:text-destructive"
                      onClick={() => onDelete(event)}
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete event
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="border-y border-border py-16 text-center">
          <Search className="mx-auto h-5 w-5 text-muted-foreground" />
          <p className="mt-3 text-[13px] font-medium">No matching events</p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Try another search or status.
          </p>
        </div>
      )}
    </div>
  );
}

function TemplateGallery({
  creating,
  templates,
  onUse,
}: {
  creating: boolean;
  templates: EventTemplate[];
  onUse: (template: EventTemplate | null) => void;
}) {
  return (
    <div>
      <div className="mb-6 max-w-[640px]">
        <h2 className="text-[22px] font-semibold">Start with the right structure</h2>
        <p className="mt-2 text-[13px] leading-6 text-muted-foreground">
          Each template creates a public page and a matched registration flow.
          Ticket tools are added only when you enable ticketing.
        </p>
      </div>
      <PaginatedCardGrid
        items={templates}
        pageSize={12}
        itemLabel="event templates"
        getKey={(template) => template.id}
        renderItem={(template) => (
          <button
            type="button"
            disabled={creating}
            onClick={() => onUse(template)}
            className="group overflow-hidden rounded-md border border-border bg-card text-left transition hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lg disabled:pointer-events-none disabled:opacity-60"
          >
            <div className="aspect-16/8 overflow-hidden bg-muted">
              <img
                src={template.imagePath}
                alt=""
                className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
              />
            </div>
            <div className="p-4">
              <p className="text-[10px] font-semibold uppercase text-primary">
                {template.category}
              </p>
              <h3 className="mt-2 text-[15px] font-semibold">{template.name}</h3>
              <p className="mt-2 min-h-10 text-[12px] leading-5 text-muted-foreground">
                {template.description}
              </p>
            </div>
          </button>
        )}
      />
    </div>
  );
}

function EventPreview({ event }: { event: EventRecord }) {
  const accent = event.branding.accentColor;
  const previewWidth = {
    narrow: 780,
    standard: 980,
    wide: 1160,
  }[event.branding.contentWidth];
  const previewHeroHeight = {
    compact: 270,
    standard: 330,
    immersive: 410,
  }[event.branding.heroHeight];
  const centeredHero = event.branding.heroAlignment === "center";
  return (
    <div
      className="min-h-[620px] overflow-hidden"
      style={{
        backgroundColor: event.branding.backgroundColor,
        color: event.branding.textColor,
        fontFamily: event.branding.fontFamily,
      }}
    >
      <div
        className="relative overflow-hidden"
        style={{
          backgroundColor: event.branding.heroBackgroundColor,
          color: event.branding.heroTextColor,
          minHeight: previewHeroHeight,
        }}
      >
        {event.branding.coverImageUrl ? (
          <>
            <img
              src={event.branding.coverImageUrl}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
            />
            <div
              className="absolute inset-0"
              style={{
                backgroundColor: event.branding.heroBackgroundColor,
                opacity: event.branding.heroOverlayOpacity / 100,
              }}
            />
          </>
        ) : (
          <div
            className="absolute inset-x-0 bottom-0 h-2"
            style={{ backgroundColor: accent }}
          />
        )}
        <div
          className={cn(
            "relative mx-auto flex flex-col justify-end px-6 py-8 sm:px-10",
            centeredHero && "items-center text-center",
          )}
          style={{ maxWidth: previewWidth, minHeight: previewHeroHeight }}
        >
          {event.branding.logoUrl && (
            <img
              src={event.branding.logoUrl}
              alt=""
              className="mb-auto h-10 max-w-[150px] object-contain object-left"
            />
          )}
          <p className="text-[12px] font-medium uppercase">
            {eventDate(event)}
          </p>
          <h1
            className="mt-3 max-w-[760px] wrap-break-word text-[34px] leading-tight sm:text-[48px]"
            style={{
              fontFamily: event.branding.headingFontFamily,
              fontWeight: event.branding.headingWeight,
            }}
          >
            {event.title || "Untitled event"}
          </h1>
          <p className="mt-4 flex items-center gap-2 text-[13px] opacity-80">
            <MapPin className="h-4 w-4" />
            {eventLocation(event)}
          </p>
        </div>
      </div>
      <div
        className="mx-auto grid gap-10 px-6 py-10 sm:px-8 md:grid-cols-[minmax(0,1fr)_280px]"
        style={{ maxWidth: previewWidth }}
      >
        <div className="min-w-0">
          <EventPublicSections event={event} compact />
        </div>
        <div
          className="self-start border p-5"
          style={{
            backgroundColor: event.branding.surfaceColor,
            borderColor: event.branding.borderColor,
            borderRadius: event.branding.cornerRadius,
          }}
        >
          <p
            className="text-[12px]"
            style={{ color: event.branding.mutedTextColor }}
          >
            {event.ticketingEnabled ? "Ticketing" : "Registration"}
          </p>
          <p className="mt-2 text-[16px] font-semibold">
            {event.status === "sold_out" ? "Sold out" : "Reserve your place"}
          </p>
          {!event.ticketingEnabled && event.pricing.enabled && (
            <p
              className="mt-3 text-[22px]"
              style={{
                fontFamily: event.branding.headingFontFamily,
                fontWeight: event.branding.headingWeight,
              }}
            >
              {formatCurrency(event.pricing.amount, event.pricing.currency)}
            </p>
          )}
          <Button
            type="button"
            className="mt-5 w-full"
            style={{
              backgroundColor: accent,
              borderRadius: event.branding.cornerRadius,
              color: event.branding.buttonTextColor,
            }}
            disabled={event.status === "sold_out" || event.status === "cancelled"}
          >
            {event.status === "sold_out"
              ? "Join waitlist"
              : event.ticketingEnabled
                ? "Get tickets"
                : "Register"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function EventEditorTransitionOverlay({
  phase,
}: {
  phase: "opening" | "closing";
}) {
  return (
    <div
      className="fixed inset-0 z-80 flex items-center justify-center bg-background/75 px-6 backdrop-blur-xs"
      role="status"
      aria-live="polite"
    >
      <div className="flex min-w-[220px] flex-col items-center rounded-2xl border border-border bg-card/95 px-8 py-7 text-center shadow-2xl">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Loader2 className="h-5 w-5 animate-spin" />
        </span>
        <p className="mt-4 text-[13px] font-semibold">
          {phase === "opening" ? "Opening event editor" : "Leaving event editor"}
        </p>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {phase === "opening"
            ? "Preparing your event workspace..."
            : "Returning to your events..."}
        </p>
      </div>
    </div>
  );
}

function TicketDesignerTransitionOverlay({
  phase,
}: {
  phase: "opening" | "closing";
}) {
  return (
    <div
      className="fixed inset-0 z-90 flex items-center justify-center bg-background/70 px-6 backdrop-blur-xs"
      role="status"
      aria-live="polite"
    >
      <div className="flex min-w-[220px] flex-col items-center rounded-2xl border border-border bg-card/95 px-8 py-7 text-center shadow-2xl">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Loader2 className="h-5 w-5 animate-spin" />
        </span>
        <p className="mt-4 text-[13px] font-semibold">
          {phase === "opening" ? "Opening ticket designer" : "Closing ticket designer"}
        </p>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {phase === "opening"
            ? "Loading the exact event ticket canvas..."
            : "Saving your place in ticket settings..."}
        </p>
      </div>
    </div>
  );
}

function UploadField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const select = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) {
      toast.error("Choose an image smaller than 5 MB.");
      return;
    }
    try {
      const stored = await uploadFileToStorage(file, {
        purpose: "event_asset",
        visibility: "public",
      });
      if (!stored.url) throw new Error("The public image URL is unavailable.");
      onChange(stored.url);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "The image could not upload.",
      );
    }
    event.target.value = "";
  };
  return (
    <div>
      <Label>{label}</Label>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => void select(event)}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="mt-2 flex h-28 w-full items-center justify-center overflow-hidden rounded-md border border-dashed border-border bg-muted/20 text-muted-foreground hover:border-primary/50 hover:text-primary"
      >
        {value ? (
          <img src={value} alt="" className="h-full w-full object-cover" />
        ) : (
          <span className="flex flex-col items-center gap-2 text-[12px]">
            <ImagePlus className="h-5 w-5" />
            Upload image
          </span>
        )}
      </button>
      {value && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-1 px-0 text-muted-foreground"
          onClick={() => onChange("")}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Remove
        </Button>
      )}
    </div>
  );
}

function ColorField({
  id,
  label,
  onChange,
  value,
}: {
  id: string;
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  const pickerValue = /^#[0-9A-F]{6}$/i.test(value) ? value : "#2563EB";
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="mt-2 flex gap-2">
        <Input
          id={id}
          type="color"
          value={pickerValue}
          onChange={(input) => onChange(input.target.value.toUpperCase())}
          className="h-10 w-12 shrink-0 cursor-pointer p-1"
          aria-label={`${label} color picker`}
        />
        <Input
          value={value}
          onChange={(input) => onChange(input.target.value.toUpperCase())}
          className="font-mono uppercase"
          maxLength={7}
          aria-label={`${label} hex value`}
        />
      </div>
    </div>
  );
}

const contentId = (prefix: string) =>
  `${prefix}-${
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Date.now()
  }`;

function SectionContentEditor({
  event,
  onChange,
}: {
  event: EventRecord;
  onChange: (event: EventRecord) => void;
}) {
  const [selected, setSelected] = useState<EventSectionKey>("about");
  const updateContent = (sectionContent: EventSectionContent) =>
    onChange({ ...event, sectionContent });
  const toggleSection = (section: EventSectionKey) =>
    onChange({
      ...event,
      publicSections: event.publicSections.includes(section)
        ? event.publicSections.filter((item) => item !== section)
        : [...event.publicSections, section],
    });
  const content = event.sectionContent;

  return (
    <section>
      <div className="border-b border-border pb-3">
        <h2 className="text-[16px] font-semibold">Public page content</h2>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Enable a section, select it, then add the content visitors will see.
        </p>
      </div>
      <div className="mt-5 grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <div className="divide-y divide-border border-y border-border">
          {(Object.keys(sectionLabels) as EventSectionKey[]).map((section) => {
            const enabled = event.publicSections.includes(section);
            return (
              <div
                key={section}
                className={cn(
                  "flex items-center gap-2 py-2.5",
                  selected === section && "text-foreground",
                )}
              >
                <button
                  type="button"
                  onClick={() => setSelected(section)}
                  className={cn(
                    "min-w-0 flex-1 text-left text-[13px]",
                    selected === section
                      ? "font-medium"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {sectionLabels[section]}
                </button>
                <Switch
                  checked={enabled}
                  onCheckedChange={() => toggleSection(section)}
                  aria-label={`${enabled ? "Disable" : "Enable"} ${sectionLabels[section]}`}
                />
              </div>
            );
          })}
        </div>
        <div className="min-w-0">
          <div className="mb-5 flex items-center justify-between border-b border-border pb-3">
            <div>
              <p className="text-[14px] font-semibold">
                {sectionLabels[selected]}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {event.publicSections.includes(selected)
                  ? "Visible on the public event page"
                  : "This section is currently hidden"}
              </p>
            </div>
            <span
              className={cn(
                "rounded px-2 py-1 text-[10px]",
                event.publicSections.includes(selected)
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {event.publicSections.includes(selected) ? "Visible" : "Hidden"}
            </span>
          </div>

          {selected === "about" && (
            <div className="space-y-5">
              <div>
                <Label htmlFor="event-about-heading">Section heading</Label>
                <Input
                  id="event-about-heading"
                  value={content.about.heading}
                  onChange={(input) =>
                    updateContent({
                      ...content,
                      about: {
                        ...content.about,
                        heading: input.target.value,
                      },
                    })
                  }
                  className="mt-2"
                />
              </div>
              <div>
                <Label htmlFor="event-about-body">About content</Label>
                <Textarea
                  id="event-about-body"
                  value={content.about.body}
                  onChange={(input) =>
                    updateContent({
                      ...content,
                      about: {
                        ...content.about,
                        body: input.target.value,
                      },
                    })
                  }
                  className="mt-2 min-h-[180px]"
                  placeholder="Give visitors the full story, key outcomes, and who this event is for."
                />
              </div>
            </div>
          )}

          {selected === "agenda" && (
            <div>
              <div className="space-y-4">
                {content.agenda.map((item, index) => (
                  <div key={item.id} className="border-y border-border py-4">
                    <div className="grid gap-3 sm:grid-cols-[130px_minmax(0,1fr)_40px]">
                      <Input
                        type="time"
                        value={item.time}
                        onChange={(input) =>
                          updateContent({
                            ...content,
                            agenda: content.agenda.map((entry, itemIndex) =>
                              itemIndex === index
                                ? { ...entry, time: input.target.value }
                                : entry,
                            ),
                          })
                        }
                      />
                      <Input
                        value={item.title}
                        onChange={(input) =>
                          updateContent({
                            ...content,
                            agenda: content.agenda.map((entry, itemIndex) =>
                              itemIndex === index
                                ? { ...entry, title: input.target.value }
                                : entry,
                            ),
                          })
                        }
                        placeholder="Session title"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Remove agenda item"
                        onClick={() =>
                          updateContent({
                            ...content,
                            agenda: content.agenda.filter(
                              (_, itemIndex) => itemIndex !== index,
                            ),
                          })
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <Textarea
                      value={item.description}
                      onChange={(input) =>
                        updateContent({
                          ...content,
                          agenda: content.agenda.map((entry, itemIndex) =>
                            itemIndex === index
                              ? { ...entry, description: input.target.value }
                              : entry,
                          ),
                        })
                      }
                      className="mt-3 min-h-[76px]"
                      placeholder="What happens in this session?"
                    />
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant="outline"
                className="mt-4"
                onClick={() =>
                  updateContent({
                    ...content,
                    agenda: [
                      ...content.agenda,
                      {
                        id: contentId("agenda"),
                        time: "",
                        title: "",
                        description: "",
                      },
                    ],
                  })
                }
              >
                <Plus className="h-4 w-4" />
                Add agenda item
              </Button>
            </div>
          )}

          {selected === "speakers" && (
            <div>
              <div className="space-y-5">
                {content.speakers.map((speaker, index) => (
                  <div
                    key={speaker.id}
                    className="grid gap-4 border-y border-border py-5 md:grid-cols-[150px_minmax(0,1fr)]"
                  >
                    <UploadField
                      label="Photo"
                      value={speaker.imageUrl}
                      onChange={(imageUrl) =>
                        updateContent({
                          ...content,
                          speakers: content.speakers.map(
                            (entry, speakerIndex) =>
                              speakerIndex === index
                                ? { ...entry, imageUrl }
                                : entry,
                          ),
                        })
                      }
                    />
                    <div className="space-y-3">
                      <div className="flex gap-2">
                        <Input
                          value={speaker.name}
                          onChange={(input) =>
                            updateContent({
                              ...content,
                              speakers: content.speakers.map(
                                (entry, speakerIndex) =>
                                  speakerIndex === index
                                    ? { ...entry, name: input.target.value }
                                    : entry,
                              ),
                            })
                          }
                          placeholder="Speaker name"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Remove speaker"
                          onClick={() =>
                            updateContent({
                              ...content,
                              speakers: content.speakers.filter(
                                (_, speakerIndex) => speakerIndex !== index,
                              ),
                            })
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <Input
                        value={speaker.role}
                        onChange={(input) =>
                          updateContent({
                            ...content,
                            speakers: content.speakers.map(
                              (entry, speakerIndex) =>
                                speakerIndex === index
                                  ? { ...entry, role: input.target.value }
                                  : entry,
                            ),
                          })
                        }
                        placeholder="Role or company"
                      />
                      <Textarea
                        value={speaker.bio}
                        onChange={(input) =>
                          updateContent({
                            ...content,
                            speakers: content.speakers.map(
                              (entry, speakerIndex) =>
                                speakerIndex === index
                                  ? { ...entry, bio: input.target.value }
                                  : entry,
                            ),
                          })
                        }
                        placeholder="Short speaker bio"
                      />
                    </div>
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant="outline"
                className="mt-4"
                onClick={() =>
                  updateContent({
                    ...content,
                    speakers: [
                      ...content.speakers,
                      {
                        id: contentId("speaker"),
                        name: "",
                        role: "",
                        bio: "",
                        imageUrl: "",
                      },
                    ],
                  })
                }
              >
                <Plus className="h-4 w-4" />
                Add speaker
              </Button>
            </div>
          )}

          {selected === "sponsors" && (
            <div>
              <div className="space-y-5">
                {content.sponsors.map((sponsor, index) => (
                  <div
                    key={sponsor.id}
                    className="grid gap-4 border-y border-border py-5 md:grid-cols-[150px_minmax(0,1fr)]"
                  >
                    <UploadField
                      label="Sponsor logo"
                      value={sponsor.logoUrl}
                      onChange={(logoUrl) =>
                        updateContent({
                          ...content,
                          sponsors: content.sponsors.map(
                            (entry, sponsorIndex) =>
                              sponsorIndex === index
                                ? { ...entry, logoUrl }
                                : entry,
                          ),
                        })
                      }
                    />
                    <div className="space-y-3">
                      <div className="flex gap-2">
                        <Input
                          value={sponsor.name}
                          onChange={(input) =>
                            updateContent({
                              ...content,
                              sponsors: content.sponsors.map(
                                (entry, sponsorIndex) =>
                                  sponsorIndex === index
                                    ? { ...entry, name: input.target.value }
                                    : entry,
                              ),
                            })
                          }
                          placeholder="Sponsor name"
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Remove sponsor"
                          onClick={() =>
                            updateContent({
                              ...content,
                              sponsors: content.sponsors.filter(
                                (_, sponsorIndex) => sponsorIndex !== index,
                              ),
                            })
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <Input
                        type="url"
                        value={sponsor.website}
                        onChange={(input) =>
                          updateContent({
                            ...content,
                            sponsors: content.sponsors.map(
                              (entry, sponsorIndex) =>
                                sponsorIndex === index
                                  ? { ...entry, website: input.target.value }
                                  : entry,
                            ),
                          })
                        }
                        placeholder="https://sponsor.example"
                      />
                      <Textarea
                        value={sponsor.description || ""}
                        onChange={(input) =>
                          updateContent({
                            ...content,
                            sponsors: content.sponsors.map(
                              (entry, sponsorIndex) =>
                                sponsorIndex === index
                                  ? {
                                      ...entry,
                                      description: input.target.value,
                                    }
                                  : entry,
                            ),
                          })
                        }
                        className="min-h-[90px]"
                        placeholder="Sponsor info, benefits, booth details, or partner note"
                      />
                    </div>
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant="outline"
                className="mt-4"
                onClick={() =>
                  updateContent({
                    ...content,
                    sponsors: [
                      ...content.sponsors,
                      {
                        id: contentId("sponsor"),
                        name: "",
                        description: "",
                        website: "",
                        logoUrl: "",
                      },
                    ],
                  })
                }
              >
                <Plus className="h-4 w-4" />
                Add sponsor
              </Button>
            </div>
          )}

          {selected === "faq" && (
            <div>
              <div className="space-y-4">
                {content.faq.map((item, index) => (
                  <div key={item.id} className="border-y border-border py-4">
                    <div className="flex gap-2">
                      <Input
                        value={item.question}
                        onChange={(input) =>
                          updateContent({
                            ...content,
                            faq: content.faq.map((entry, faqIndex) =>
                              faqIndex === index
                                ? { ...entry, question: input.target.value }
                                : entry,
                            ),
                          })
                        }
                        placeholder="Question"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Remove question"
                        onClick={() =>
                          updateContent({
                            ...content,
                            faq: content.faq.filter(
                              (_, faqIndex) => faqIndex !== index,
                            ),
                          })
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <Textarea
                      value={item.answer}
                      onChange={(input) =>
                        updateContent({
                          ...content,
                          faq: content.faq.map((entry, faqIndex) =>
                            faqIndex === index
                              ? { ...entry, answer: input.target.value }
                              : entry,
                          ),
                        })
                      }
                      className="mt-3"
                      placeholder="Answer"
                    />
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant="outline"
                className="mt-4"
                onClick={() =>
                  updateContent({
                    ...content,
                    faq: [
                      ...content.faq,
                      {
                        id: contentId("faq"),
                        question: "",
                        answer: "",
                      },
                    ],
                  })
                }
              >
                <Plus className="h-4 w-4" />
                Add question
              </Button>
            </div>
          )}

          {selected === "venue" && (
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <Label htmlFor="venue-name">Venue name</Label>
                <Input
                  id="venue-name"
                  value={content.venue.name}
                  onChange={(input) =>
                    updateContent({
                      ...content,
                      venue: { ...content.venue, name: input.target.value },
                    })
                  }
                  className="mt-2"
                />
              </div>
              <div>
                <Label htmlFor="venue-address">Full address</Label>
                <Input
                  id="venue-address"
                  value={content.venue.address}
                  onChange={(input) =>
                    updateContent({
                      ...content,
                      venue: {
                        ...content.venue,
                        address: input.target.value,
                      },
                    })
                  }
                  className="mt-2"
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="venue-directions">Arrival instructions</Label>
                <Textarea
                  id="venue-directions"
                  value={content.venue.directions}
                  onChange={(input) =>
                    updateContent({
                      ...content,
                      venue: {
                        ...content.venue,
                        directions: input.target.value,
                      },
                    })
                  }
                  className="mt-2"
                  placeholder="Parking, entrance, accessibility, or transport details."
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="venue-map">Map link</Label>
                <Input
                  id="venue-map"
                  type="url"
                  value={content.venue.mapUrl}
                  onChange={(input) =>
                    updateContent({
                      ...content,
                      venue: { ...content.venue, mapUrl: input.target.value },
                    })
                  }
                  className="mt-2"
                  placeholder="https://maps.google.com/..."
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

const meetingProviderLogo: Record<EventMeetingProvider, string> = {
  google_meet: "/images/integrations/google-workspace.svg",
  teams: "/images/integrations/microsoft-365.svg",
  zoom: "/images/integrations/zoom.svg",
};

function EventMeetingSettings({
  event,
  onChange,
}: {
  event: EventRecord;
  onChange: (event: EventRecord) => void;
}) {
  const [providers, setProviders] = useState<EventMeetingProviderOption[]>([]);
  const [loading, setLoading] = useState(false);
  const integration = event.settings.meetingIntegration && typeof event.settings.meetingIntegration === "object"
    ? event.settings.meetingIntegration as Record<string, unknown>
    : {};
  const selectedProvider = (String(integration.provider || "manual") as EventMeetingProvider | "manual");
  const selectedOption = providers.find((provider) => provider.key === selectedProvider);
  const hasGeneratedLink = Boolean(event.onlineUrl && selectedProvider !== "manual");

  useEffect(() => {
    let active = true;
    setLoading(true);
    void listEventMeetingProviders()
      .then((result) => { if (active) setProviders(result); })
      .catch(() => { if (active) setProviders([]); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const selectProvider = (value: string) => {
    const provider = value as EventMeetingProvider | "manual";
    if (provider !== "manual" && !providers.some((item) => item.key === provider && item.connected)) {
      toast.error("Connect this meeting provider in Integrations before selecting it.");
      return;
    }
    const keepLink = provider !== "manual" && provider === selectedProvider;
    onChange({
      ...event,
      onlineUrl: keepLink ? event.onlineUrl : provider === "manual" ? event.onlineUrl : "",
      settings: {
        ...event.settings,
        meetingIntegration: provider === "manual"
          ? { provider: "manual" }
          : { provider, providerLabel: providers.find((item) => item.key === provider)?.label || provider },
      },
    });
  };

  return <div className="mt-5 rounded-md border border-border bg-muted/20 p-4 sm:col-span-2">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-[13px] font-medium">Meeting provider</p>
        <p className="mt-1 max-w-xl text-[11px] leading-5 text-muted-foreground">Choose a connected provider to create the meeting link from the event date, time, and timezone. Google Meet also adds the event to Google Calendar.</p>
      </div>
      {loading && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
    </div>
    <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(220px,0.8fr)] sm:items-end">
      <div>
        <Label htmlFor="event-meeting-provider">Provider</Label>
        <Select value={selectedProvider} onValueChange={selectProvider}>
          <SelectTrigger id="event-meeting-provider" className="mt-2"><SelectValue placeholder="Choose a provider" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="manual">Use my own meeting link</SelectItem>
            {providers.map((provider) => <SelectItem key={provider.key} value={provider.key}>{provider.label}{provider.connected ? ` · ${provider.accountLabel}` : " · Connect in Integrations"}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-3 rounded-md border border-border bg-background px-3 py-2">
        {selectedOption && <img src={meetingProviderLogo[selectedOption.key]} alt="" className={cn("h-6 w-auto max-w-[92px] object-contain", selectedOption.key === "zoom" && "w-6")} />}
        <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-foreground">{selectedOption?.label || "Custom link"}</p><p className="truncate text-[11px] text-muted-foreground">{selectedOption?.connected ? selectedOption.accountLabel : selectedOption ? "Not connected" : "Paste a link below"}</p></div>
        {selectedOption && !selectedOption.connected && <Button asChild size="sm" variant="outline"><a href="/dashboard?tab=integrations&section=directory">Connect</a></Button>}
      </div>
    </div>
    {selectedOption?.connected && <p className="mt-3 text-[11px] text-emerald-700 dark:text-emerald-300">{selectedOption.calendarDescription}</p>}
    {selectedProvider === "manual" && <div className="mt-4"><Label htmlFor="event-meeting-link">Meeting link</Label><Input id="event-meeting-link" type="url" value={event.onlineUrl} onChange={(input) => onChange({ ...event, onlineUrl: input.target.value })} className="mt-2" placeholder="https://meet.example.com/..." /><p className="mt-1 text-[11px] text-muted-foreground">Use an HTTPS link. It is only revealed to confirmed attendees.</p></div>}
    {hasGeneratedLink && <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-800 dark:text-emerald-200"><CheckCircle2 className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1 truncate">Meeting link created: {event.onlineUrl}</span><Button type="button" size="sm" variant="outline" onClick={() => { void navigator.clipboard?.writeText(event.onlineUrl).then(() => toast.success("Meeting link copied")); }}>Copy link</Button></div>}
    {selectedProvider !== "manual" && !hasGeneratedLink && <p className="mt-3 text-[11px] text-muted-foreground">The meeting will be created from this event&apos;s schedule when you publish it. Changing providers before publishing will not create duplicate meetings.</p>}
  </div>;
}

function BuilderPanel({
  event,
  onChange,
  onSave,
}: {
  event: EventRecord;
  onChange: (event: EventRecord) => void;
  onSave: () => Promise<boolean>;
}) {
  const update = <Key extends keyof EventRecord>(
    key: Key,
    value: EventRecord[Key],
  ) => onChange({ ...event, [key]: value });
  const updateBranding = (branding: Partial<EventRecord["branding"]>) =>
    update("branding", { ...event.branding, ...branding });
  const rangeDates = buildEventDateRange(
    event.rangeStartDate,
    event.rangeEndDate,
  );
  const dailyScheduleForDates = (
    startDate: string,
    endDate: string,
    startTime = event.startTime,
    endTime = event.endTime,
  ) =>
    buildEventDateRange(startDate, endDate).map((date) => {
      const existing = event.dailySchedule.find((item) => item.date === date);
      return existing || { date, startTime, endTime };
    });
  const updateRangeDate = (
    key: "rangeStartDate" | "rangeEndDate",
    value: string,
  ) => {
    const nextStart = key === "rangeStartDate" ? value : event.rangeStartDate;
    const nextEnd = key === "rangeEndDate" ? value : event.rangeEndDate;
    onChange({
      ...event,
      [key]: value,
      dailySchedule:
        event.rangeScheduleMode === "daily"
          ? dailyScheduleForDates(nextStart, nextEnd)
          : event.dailySchedule,
    });
  };
  const updateDailyTime = (
    date: string,
    key: "startTime" | "endTime",
    value: string,
  ) =>
    update(
      "dailySchedule",
      dailyScheduleForDates(event.rangeStartDate, event.rangeEndDate).map(
        (item) => (item.date === date ? { ...item, [key]: value } : item),
      ),
    );
  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-9">
        <section>
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div>
              <h2 className="text-[16px] font-semibold">Event details</h2>
              <p className="mt-1 text-[12px] text-muted-foreground">
                The essentials shown across your event page and tickets.
              </p>
            </div>
          </div>
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="event-title">Event name</Label>
              <Input
                id="event-title"
                value={event.title}
                onChange={(input) => update("title", input.target.value)}
                className="mt-2"
              />
            </div>
            <div className="sm:col-span-2">
              <Label>Schedule</Label>
              <div className="mt-2 grid max-w-[460px] grid-cols-2 border border-input p-1">
                <button
                  type="button"
                  onClick={() =>
                    onChange({
                      ...event,
                      scheduleType: "single_day",
                      eventDate: event.eventDate || event.rangeStartDate,
                      startsAt: "",
                      endsAt: "",
                    })
                  }
                  className={cn(
                    "flex min-h-9 items-center justify-center gap-2 px-3 text-[12px] font-medium transition-colors",
                    event.scheduleType === "single_day"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <CalendarDays className="h-4 w-4" />
                  Single day
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onChange({
                      ...event,
                      scheduleType: "date_range",
                      rangeStartDate:
                        event.rangeStartDate || event.eventDate,
                      dailySchedule: dailyScheduleForDates(
                        event.rangeStartDate || event.eventDate,
                        event.rangeEndDate,
                      ),
                    })
                  }
                  className={cn(
                    "flex min-h-9 items-center justify-center gap-2 px-3 text-[12px] font-medium transition-colors",
                    event.scheduleType === "date_range"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <CalendarRange className="h-4 w-4" />
                  Date range
                </button>
              </div>
            </div>
            {event.scheduleType === "single_day" ? (
              <>
                <div className="sm:col-span-2">
                  <Label htmlFor="event-date">Event date</Label>
                  <DatePickerField
                    id="event-date"
                    value={toDateInput(event.eventDate)}
                    onChange={(value) => update("eventDate", value)}
                    className="mt-2 max-w-[460px]"
                  />
                </div>
                <div>
                  <Label htmlFor="event-start-time">Start time</Label>
                  <Input
                    id="event-start-time"
                    type="time"
                    value={event.startTime}
                    onChange={(input) => update("startTime", input.target.value)}
                    className="mt-2"
                  />
                </div>
                <div>
                  <Label htmlFor="event-end-time">End time (optional)</Label>
                  <Input
                    id="event-end-time"
                    type="time"
                    value={event.endTime}
                    onChange={(input) => update("endTime", input.target.value)}
                    className="mt-2"
                  />
                </div>
              </>
            ) : (
              <>
                <div>
                  <Label htmlFor="event-range-start">From date</Label>
                  <DatePickerField
                    id="event-range-start"
                    value={toDateInput(event.rangeStartDate)}
                    onChange={(value) => updateRangeDate("rangeStartDate", value)}
                    className="mt-2"
                    placeholder="From date"
                  />
                </div>
                <div>
                  <Label htmlFor="event-range-end">To date</Label>
                  <DatePickerField
                    id="event-range-end"
                    value={toDateInput(event.rangeEndDate)}
                    onChange={(value) => updateRangeDate("rangeEndDate", value)}
                    className="mt-2"
                    placeholder="To date"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label>How does this event run?</Label>
                  <div className="mt-2 grid max-w-[560px] grid-cols-2 border border-input p-1">
                    <button
                      type="button"
                      onClick={() => update("rangeScheduleMode", "continuous")}
                      className={cn(
                        "min-h-9 px-3 text-[12px] font-medium transition-colors",
                        event.rangeScheduleMode === "continuous"
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      Continuous event
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onChange({
                          ...event,
                          rangeScheduleMode: "daily",
                          dailySchedule: dailyScheduleForDates(
                            event.rangeStartDate,
                            event.rangeEndDate,
                          ),
                        })
                      }
                      className={cn(
                        "min-h-9 px-3 text-[12px] font-medium transition-colors",
                        event.rangeScheduleMode === "daily"
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      Set times by day
                    </button>
                  </div>
                  <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                    Use continuous for an event that runs across the whole date
                    range. Use daily times when each day starts and ends separately.
                  </p>
                </div>
                {event.rangeScheduleMode === "continuous" ? (
                  <>
                    <div>
                      <Label htmlFor="event-range-start-time">
                        Start time on first day
                      </Label>
                      <Input
                        id="event-range-start-time"
                        type="time"
                        value={event.startTime}
                        onChange={(input) =>
                          update("startTime", input.target.value)
                        }
                        className="mt-2"
                      />
                    </div>
                    <div>
                      <Label htmlFor="event-range-end-time">
                        End time on last day
                      </Label>
                      <Input
                        id="event-range-end-time"
                        type="time"
                        value={event.endTime}
                        onChange={(input) =>
                          update("endTime", input.target.value)
                        }
                        className="mt-2"
                      />
                    </div>
                  </>
                ) : (
                  <div className="sm:col-span-2">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-[13px] font-medium">Daily schedule</p>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Each calendar day can use different hours.
                        </p>
                      </div>
                      {rangeDates.length > 1 && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const first = event.dailySchedule.find(
                              (item) => item.date === rangeDates[0],
                            );
                            if (!first) return;
                            update(
                              "dailySchedule",
                              rangeDates.map((date) => ({
                                date,
                                startTime: first.startTime,
                                endTime: first.endTime,
                              })),
                            );
                          }}
                        >
                          <Copy className="h-3.5 w-3.5" />
                          Apply first day to all
                        </Button>
                      )}
                    </div>
                    {rangeDates.length ? (
                      <div className="divide-y divide-border border-y border-border">
                        {rangeDates.map((date) => {
                          const schedule = event.dailySchedule.find(
                            (item) => item.date === date,
                          ) || { date, startTime: "", endTime: "" };
                          return (
                            <div
                              key={date}
                              className="grid gap-3 py-3 sm:grid-cols-[minmax(150px,1fr)_150px_150px] sm:items-end"
                            >
                              <div>
                                <p className="text-[12px] font-medium">
                                  {formatEventCalendarDate(date, "full")}
                                </p>
                              </div>
                              <div>
                                <Label
                                  htmlFor={`daily-start-${date}`}
                                  className="text-[10px]"
                                >
                                  Starts
                                </Label>
                                <Input
                                  id={`daily-start-${date}`}
                                  type="time"
                                  value={schedule.startTime}
                                  onChange={(input) =>
                                    updateDailyTime(
                                      date,
                                      "startTime",
                                      input.target.value,
                                    )
                                  }
                                  className="mt-1"
                                />
                              </div>
                              <div>
                                <Label
                                  htmlFor={`daily-end-${date}`}
                                  className="text-[10px]"
                                >
                                  Ends (optional)
                                </Label>
                                <Input
                                  id={`daily-end-${date}`}
                                  type="time"
                                  value={schedule.endTime}
                                  onChange={(input) =>
                                    updateDailyTime(
                                      date,
                                      "endTime",
                                      input.target.value,
                                    )
                                  }
                                  className="mt-1"
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="border-y border-border py-6 text-[12px] text-muted-foreground">
                        Select a valid from and to date to build the daily schedule.
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
            <div className="sm:col-span-2">
              <Label htmlFor="event-timezone">Timezone</Label>
              <SearchableSelect
                id="event-timezone"
                value={event.timezone}
                onChange={(value) => update("timezone", value)}
                options={timezoneOptions.map((zone) => ({
                  value: zone.value,
                  label: zone.label,
                  description: zone.offset,
                  keywords: `${zone.value} ${zone.countries.join(" ")}`,
                }))}
                searchPlaceholder="Search city, country, or timezone..."
                className="mt-2"
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="event-description">Description</Label>
              <Textarea
                id="event-description"
                value={event.description}
                onChange={(input) => update("description", input.target.value)}
                className="mt-2 min-h-[130px]"
                placeholder="Tell attendees what makes this event worth showing up for."
              />
            </div>
          </div>
        </section>

        <section>
          <div className="border-b border-border pb-3">
            <h2 className="text-[16px] font-semibold">Location</h2>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Online links remain private until registration is complete.
            </p>
          </div>
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <div>
              <Label>Event type</Label>
              <Select
                value={event.locationType}
                onValueChange={(value: EventRecord["locationType"]) =>
                  update("locationType", value)
                }
              >
                <SelectTrigger className="mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="physical">Physical</SelectItem>
                  <SelectItem value="online">Online</SelectItem>
                  <SelectItem value="hybrid">Hybrid</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {event.locationType !== "online" && (
              <>
                <div>
                  <Label htmlFor="event-venue-name">Venue name</Label>
                  <Input
                    id="event-venue-name"
                    value={event.venueName}
                    onChange={(input) =>
                      update("venueName", input.target.value)
                    }
                    className="mt-2"
                    placeholder="e.g. Eko Convention Centre"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="event-address">Full address</Label>
                  <Input
                    id="event-address"
                    value={event.address}
                    onChange={(input) => update("address", input.target.value)}
                    className="mt-2"
                    placeholder="Street, city, state, and country"
                  />
                </div>
              </>
            )}
            {event.locationType !== "physical" && (
              <>
              <EventMeetingSettings event={event} onChange={onChange} />
              </>
            )}
          </div>
        </section>

        <SectionContentEditor event={event} onChange={onChange} />
      </div>

      <aside className="space-y-6 xl:sticky xl:top-0 xl:self-start">
        <section className="rounded-md border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[14px] font-semibold">Page design</h2>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Controls the preview and published page.
              </p>
            </div>
            <Palette className="h-4 w-4 text-primary" />
          </div>
          <div className="mt-5 space-y-7">
            <div className="space-y-5">
              <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                Media
              </p>
              <UploadField
                label="Cover image"
                value={event.branding.coverImageUrl}
                onChange={(coverImageUrl) =>
                  updateBranding({ coverImageUrl })
                }
              />
              <UploadField
                label="Event logo"
                value={event.branding.logoUrl}
                onChange={(logoUrl) => updateBranding({ logoUrl })}
              />
            </div>

            <div className="space-y-5 border-t border-border pt-6">
              <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                Colors
              </p>
              <ColorField
                id="event-accent-color"
                label="Accent"
                value={event.branding.accentColor}
                onChange={(accentColor) =>
                  updateBranding({ accentColor, accentColorMode: "custom" })
                }
              />
              <ColorField
                id="event-page-background"
                label="Page background"
                value={event.branding.backgroundColor}
                onChange={(backgroundColor) =>
                  updateBranding({ backgroundColor })
                }
              />
              <ColorField
                id="event-surface-color"
                label="Event container background"
                value={event.branding.surfaceColor}
                onChange={(surfaceColor) => updateBranding({ surfaceColor })}
              />
              <ColorField
                id="event-text-color"
                label="Text"
                value={event.branding.textColor}
                onChange={(textColor) => updateBranding({ textColor })}
              />
              <ColorField
                id="event-muted-color"
                label="Muted text"
                value={event.branding.mutedTextColor}
                onChange={(mutedTextColor) =>
                  updateBranding({ mutedTextColor })
                }
              />
              <ColorField
                id="event-border-color"
                label="Borders"
                value={event.branding.borderColor}
                onChange={(borderColor) => updateBranding({ borderColor })}
              />
              <ColorField
                id="event-hero-background"
                label="Hero background"
                value={event.branding.heroBackgroundColor}
                onChange={(heroBackgroundColor) =>
                  updateBranding({ heroBackgroundColor })
                }
              />
              <ColorField
                id="event-hero-text"
                label="Hero text"
                value={event.branding.heroTextColor}
                onChange={(heroTextColor) =>
                  updateBranding({ heroTextColor })
                }
              />
              <ColorField
                id="event-button-text"
                label="Button text"
                value={event.branding.buttonTextColor}
                onChange={(buttonTextColor) =>
                  updateBranding({ buttonTextColor })
                }
              />
            </div>

            <div className="space-y-5 border-t border-border pt-6">
              <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                Typography
              </p>
              <div>
                <Label htmlFor="event-body-font">Body font</Label>
                <SearchableSelect
                  id="event-body-font"
                  value={event.branding.fontFamily}
                  onChange={(fontFamily) => updateBranding({ fontFamily })}
                  options={eventFontOptions}
                  searchPlaceholder="Search fonts..."
                  className="mt-2"
                />
              </div>
              <div>
                <Label htmlFor="event-heading-font">Heading font</Label>
                <SearchableSelect
                  id="event-heading-font"
                  value={event.branding.headingFontFamily}
                  onChange={(headingFontFamily) =>
                    updateBranding({ headingFontFamily })
                  }
                  options={eventFontOptions}
                  searchPlaceholder="Search fonts..."
                  className="mt-2"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                <div>
                  <Label>Heading weight</Label>
                  <Select
                    value={String(event.branding.headingWeight)}
                    onValueChange={(value) =>
                      updateBranding({
                        headingWeight: Number(value) as 500 | 600 | 700,
                      })
                    }
                  >
                    <SelectTrigger className="mt-2">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="500">Medium</SelectItem>
                      <SelectItem value="600">Semibold</SelectItem>
                      <SelectItem value="700">Bold</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Body size</Label>
                  <Select
                    value={event.branding.bodyFontSize}
                    onValueChange={(
                      bodyFontSize: EventRecord["branding"]["bodyFontSize"],
                    ) => updateBranding({ bodyFontSize })}
                  >
                    <SelectTrigger className="mt-2">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="small">Small</SelectItem>
                      <SelectItem value="medium">Regular</SelectItem>
                      <SelectItem value="large">Large</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="space-y-5 border-t border-border pt-6">
              <p className="text-[10px] font-semibold uppercase text-muted-foreground">
                Layout
              </p>
              <div>
                <Label>Content width</Label>
                <Select
                  value={event.branding.contentWidth}
                  onValueChange={(
                    contentWidth: EventRecord["branding"]["contentWidth"],
                  ) => updateBranding({ contentWidth })}
                >
                  <SelectTrigger className="mt-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="narrow">Narrow</SelectItem>
                    <SelectItem value="standard">Standard</SelectItem>
                    <SelectItem value="wide">Wide</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                <div>
                  <Label>Hero height</Label>
                  <Select
                    value={event.branding.heroHeight}
                    onValueChange={(
                      heroHeight: EventRecord["branding"]["heroHeight"],
                    ) => updateBranding({ heroHeight })}
                  >
                    <SelectTrigger className="mt-2">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="compact">Compact</SelectItem>
                      <SelectItem value="standard">Standard</SelectItem>
                      <SelectItem value="immersive">Immersive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Hero alignment</Label>
                  <Select
                    value={event.branding.heroAlignment}
                    onValueChange={(
                      heroAlignment: EventRecord["branding"]["heroAlignment"],
                    ) => updateBranding({ heroAlignment })}
                  >
                    <SelectTrigger className="mt-2">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="left">Left</SelectItem>
                      <SelectItem value="center">Centered</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="event-hero-overlay">Image overlay</Label>
                  <span className="text-[11px] text-muted-foreground">
                    {event.branding.heroOverlayOpacity}%
                  </span>
                </div>
                <input
                  id="event-hero-overlay"
                  type="range"
                  min={0}
                  max={85}
                  step={5}
                  value={event.branding.heroOverlayOpacity}
                  onChange={(input) =>
                    updateBranding({
                      heroOverlayOpacity: Number(input.target.value),
                    })
                  }
                  className="mt-3 h-2 w-full cursor-pointer accent-primary"
                />
              </div>
              <div>
                <Label htmlFor="event-corner-radius">
                  Corner radius ({event.branding.cornerRadius}px)
                </Label>
                <input
                  id="event-corner-radius"
                  type="range"
                  min={0}
                  max={8}
                  step={1}
                  value={event.branding.cornerRadius}
                  onChange={(input) =>
                    updateBranding({
                      cornerRadius: Number(input.target.value),
                    })
                  }
                  className="mt-3 h-2 w-full cursor-pointer accent-primary"
                />
              </div>
            </div>
          </div>
        </section>
      </aside>
    </div>
  );
}

function EventPreloaderPanel({
  event,
  onChange,
}: {
  event: EventRecord;
  onChange: (event: EventRecord) => void;
}) {
  return (
    <PreloaderSettingsEditor
      storagePurpose="event_asset"
      settings={event.branding.preloader}
      onChange={(preloader) =>
        onChange({
          ...event,
          branding: { ...event.branding, preloader },
        })
      }
      idPrefix={`event-preloader-${event.id}`}
      title="Event preloader"
      description="Show a responsive, centered loading screen before this public event appears."
    />
  );
}

function RegistrationPanel({
  event,
  historyOpen,
  onHistoryOpenChange,
  userId,
  onEventChange,
  previewOpen,
  onPreviewOpenChange,
  saveState,
}: {
  event: EventRecord;
  historyOpen: boolean;
  onHistoryOpenChange: (open: boolean) => void;
  userId: string;
  onEventChange: (event: EventRecord) => void;
  previewOpen: boolean;
  onPreviewOpenChange: (open: boolean) => void;
  saveState: SaveState;
}) {
  const draft = event.registrationForm;
  if (!draft) {
    return (
      <div className="border-y border-border py-16 text-center">
        <AlertCircle className="mx-auto h-5 w-5 text-muted-foreground" />
        <p className="mt-3 text-[13px] font-medium">Registration form unavailable</p>
        <p className="mt-1 text-[12px] text-muted-foreground">
          This event does not have a linked form yet.
        </p>
      </div>
    );
  }
  const updateDraft = (form: FormRecord) => {
    onEventChange({
      ...event,
      registrationForm: {
        ...form,
        settings: {
          ...form.settings,
          payment: {
            ...defaultPayment(),
            ...form.settings.payment,
            currency:
              form.settings.payment.currency ||
              event.pricing.currency ||
              "USD",
          },
          hasUnpublishedChanges: true,
        },
      },
    });
  };
  const restore = (version: FormVersion) => {
    updateDraft({
      ...draft,
      title: version.title,
      description: version.description,
      fields: structuredClone(version.fields),
    });
  };
  return (
    <>
      <div className="mb-5 border-y border-border py-4">
        <div>
          <p className="text-[13px] font-semibold">Registration experience</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {draft.fields.length} fields connected exclusively to this event.
          </p>
        </div>
      </div>
      <FormBuilder
        form={draft}
        onChange={updateDraft}
        onPreview={() => onPreviewOpenChange(true)}
        onRestoreVersion={restore}
        onSaveDraft={() => undefined}
        saveState={saveState}
        modeOptions={registrationBuilderModes}
        settingsPanel={
          <div className="mx-auto max-w-[820px] py-7">
            <div className="mb-6">
              <h2 className="text-[16px] font-semibold">
                Registration settings
              </h2>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                Route completed registrations into Contacts. This internal
                registration form stays separate from the Forms workspace.
              </p>
            </div>
            <FormListConnector
              form={draft}
              userId={userId}
              variant="event-leads"
            />
          </div>
        }
        showToolbarActions={false}
        historyOpen={historyOpen}
        onHistoryOpenChange={onHistoryOpenChange}
      />
      <Dialog open={previewOpen} onOpenChange={onPreviewOpenChange}>
        <DialogContent className="dashboard-scroll max-h-[92vh] max-w-[900px] overflow-y-auto p-0">
          <DialogHeader className="border-b border-border px-6 py-5">
            <DialogTitle>Registration preview</DialogTitle>
            <DialogDescription>
              This uses the same renderer attendees see.
            </DialogDescription>
          </DialogHeader>
          <div className="bg-muted/30 p-4 sm:p-7">
            <FormRenderer form={draft} preview />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

const defaultDiscountRule = (
  eventId: string,
  sortOrder: number,
): EventDiscountRule => ({
  id: crypto.randomUUID(),
  eventId,
  name: "",
  mode: "first_n",
  valueType: "percentage",
  value: 10,
  firstN: 10,
  minQuantity: 2,
  code: "",
  startsAt: "",
  endsAt: "",
  redemptionLimit: null,
  active: false,
  sortOrder,
});

function DiscountRuleDialog({
  currency,
  eventId,
  onOpenChange,
  onSave,
  open,
  order,
  rule,
}: {
  currency: string;
  eventId: string;
  onOpenChange: (open: boolean) => void;
  onSave: (rule: EventDiscountRule) => void;
  open: boolean;
  order: number;
  rule: EventDiscountRule | null;
}) {
  const [draft, setDraft] = useState<EventDiscountRule>(
    defaultDiscountRule(eventId, order),
  );
  useEffect(() => {
    setDraft(
      rule
        ? structuredClone(rule)
        : defaultDiscountRule(eventId, order),
    );
  }, [eventId, open, order, rule]);
  const update = <Key extends keyof EventDiscountRule>(
    key: Key,
    value: EventDiscountRule[Key],
  ) => setDraft((current) => ({ ...current, [key]: value }));
  const submit = () => {
    const issue = getEventDiscountRuleIssue(draft);
    if (issue) {
      toast.error(issue);
      return;
    }
    onSave({
      ...draft,
      name: draft.name.trim(),
      code: draft.code.trim().toUpperCase(),
    });
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dashboard-scroll max-h-[92vh] max-w-[680px] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{rule ? "Edit discount" : "New discount"}</DialogTitle>
          <DialogDescription>
            Configure one event-scoped registration offer.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 py-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="discount-name">Discount name</Label>
            <Input
              id="discount-name"
              value={draft.name}
              onChange={(input) => update("name", input.target.value)}
              className="mt-2"
              placeholder="Early access"
            />
          </div>
          <div>
            <Label>Eligibility</Label>
            <Select
              value={draft.mode}
              onValueChange={(mode: EventDiscountRule["mode"]) =>
                update("mode", mode)
              }
            >
              <SelectTrigger className="mt-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="first_n">First registrations</SelectItem>
                <SelectItem value="date_window">Limited time</SelectItem>
                <SelectItem value="promo_code">Promo code</SelectItem>
                <SelectItem value="group_size">Group size</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Discount type</Label>
            <Select
              value={draft.valueType}
              onValueChange={(valueType: EventDiscountRule["valueType"]) =>
                update("valueType", valueType)
              }
            >
              <SelectTrigger className="mt-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="percentage">Percentage</SelectItem>
                <SelectItem value="fixed">Fixed amount</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <PricingInput
            id="discount-value"
            label="Value"
            currency={currency}
            kind={
              draft.valueType === "percentage" ? "percentage" : "currency"
            }
            min={0.01}
            max={draft.valueType === "percentage" ? 100 : undefined}
            value={draft.value}
            onValueChange={(value) => update("value", value)}
            className="sm:col-span-2"
          />

          {draft.mode === "first_n" && (
            <div className="sm:col-span-2">
              <Label htmlFor="discount-first-n">
                Number of discounted registrations
              </Label>
              <Input
                id="discount-first-n"
                type="number"
                min={1}
                value={draft.firstN}
                onChange={(input) =>
                  update("firstN", Math.max(1, Number(input.target.value)))
                }
                className="mt-2"
              />
            </div>
          )}
          {draft.mode === "date_window" && (
            <>
              <div>
                <Label htmlFor="discount-start">Starts</Label>
                <Input
                  id="discount-start"
                  type="datetime-local"
                  value={toDateTimeInput(draft.startsAt)}
                  onChange={(input) =>
                    update("startsAt", fromDateTimeInput(input.target.value))
                  }
                  className="mt-2"
                />
              </div>
              <div>
                <Label htmlFor="discount-end">Ends</Label>
                <Input
                  id="discount-end"
                  type="datetime-local"
                  value={toDateTimeInput(draft.endsAt)}
                  onChange={(input) =>
                    update("endsAt", fromDateTimeInput(input.target.value))
                  }
                  className="mt-2"
                />
              </div>
            </>
          )}
          {draft.mode === "promo_code" && (
            <div className="sm:col-span-2">
              <Label htmlFor="discount-code">Promo code</Label>
              <Input
                id="discount-code"
                value={draft.code}
                onChange={(input) =>
                  update(
                    "code",
                    input.target.value
                      .toUpperCase()
                      .replace(/[^A-Z0-9_-]/g, "")
                      .slice(0, 24),
                  )
                }
                className="mt-2 font-mono uppercase"
                placeholder="EARLY10"
              />
            </div>
          )}
          {draft.mode === "group_size" && (
            <div className="sm:col-span-2">
              <Label htmlFor="discount-group-size">
                Minimum registrations in the group
              </Label>
              <Input
                id="discount-group-size"
                type="number"
                min={2}
                value={draft.minQuantity}
                onChange={(input) =>
                  update(
                    "minQuantity",
                    Math.max(2, Number(input.target.value)),
                  )
                }
                className="mt-2"
              />
            </div>
          )}
          <div>
            <Label htmlFor="discount-redemptions">Redemption limit</Label>
            <Input
              id="discount-redemptions"
              type="number"
              min={1}
              value={draft.redemptionLimit || ""}
              onChange={(input) =>
                update(
                  "redemptionLimit",
                  input.target.value
                    ? Math.max(1, Number(input.target.value))
                    : null,
                )
              }
              className="mt-2"
              placeholder="Unlimited"
            />
          </div>
          <div className="flex items-center justify-between border-y border-border px-1 py-3">
            <div>
              <p className="text-[13px] font-medium">Active</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Available when discounts are enabled.
              </p>
            </div>
            <Switch
              checked={draft.active}
              onCheckedChange={(active) => update("active", active)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" onClick={submit}>
            <Save className="h-4 w-4" />
            Save discount
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EventPricingPanel({
  currency,
  event,
  onChange,
  onOpenTicketTypes,
  tickets,
  userId,
}: {
  currency: string;
  event: EventRecord;
  onChange: (event: EventRecord) => void;
  onOpenTicketTypes: () => void;
  tickets: EventTicketType[];
  userId: string;
}) {
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] =
    useState<EventDiscountRule | null>(null);
  const [providerReady, setProviderReady] = useState(false);
  useEffect(() => {
    let active = true;
    void hasConnectedPaymentProvider(userId)
      .then((connected) => {
        if (active) setProviderReady(connected);
      })
      .catch(() => {
        if (active) setProviderReady(false);
      });
    return () => {
      active = false;
    };
  }, [userId]);
  const pricing: EventPricing = {
    ...defaultEventPricing(currency),
    ...event.pricing,
    currency,
  };
  const updatePricing = (next: Partial<EventPricing>) =>
    onChange({
      ...event,
      pricing: { ...pricing, ...next, currency },
    });
  const upsertRule = (savedRule: EventDiscountRule) => {
    const exists = event.discountRules.some(
      (rule) => rule.id === savedRule.id,
    );
    onChange({
      ...event,
      pricing,
      discountRules: exists
        ? event.discountRules.map((rule) =>
            rule.id === savedRule.id ? savedRule : rule,
          )
        : [...event.discountRules, savedRule],
    });
  };

  if (event.ticketingEnabled) {
    return (
      <div className="max-w-[840px] space-y-8">
        <section className="border-y border-border py-8">
          <span className="flex h-11 w-11 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Ticket className="h-5 w-5" />
          </span>
          <h2 className="mt-5 text-[18px] font-semibold">
            Ticket pricing is active
          </h2>
          <p className="mt-2 max-w-[600px] text-[12px] leading-6 text-muted-foreground">
            This event issues tickets, so prices, inventory, sale windows, and
            per-order limits belong to its ticket types.
          </p>
          <Button type="button" className="mt-5" onClick={onOpenTicketTypes}>
            <SlidersHorizontal className="h-4 w-4" />
            Manage ticket pricing
          </Button>
        </section>
        <ScopedCouponManager
          enabled={pricing.couponsEnabled}
          onEnabledChange={(couponsEnabled) => updatePricing({ couponsEnabled })}
          target={{
            currency,
            id: event.id,
            name: event.title || "Untitled event",
            type: "event",
          }}
          userId={userId}
          canCreate={tickets.some((ticket) => ticket.active && ticket.price > 0)}
        />
      </div>
    );
  }

  return (
    <div className="max-w-[900px] space-y-9">
      <section>
        <div className="border-b border-border pb-3">
          <h2 className="text-[17px] font-semibold">Registration pricing</h2>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Set a paid registration price without creating or issuing tickets.
          </p>
        </div>
        <div className="mt-5 flex items-center justify-between gap-6 border-y border-border py-4">
          <div>
            <p className="text-[13px] font-medium">
              Enable paid registration
            </p>
            <p className="mt-1 max-w-[590px] text-[11px] leading-5 text-muted-foreground">
              The amount uses the workspace currency, {currency}.
            </p>
          </div>
          <Switch
            checked={pricing.enabled}
            onCheckedChange={(enabled) => {
              if (enabled && !providerReady) {
                navigate("/dashboard?tab=payments&section=providers");
                return;
              }
              updatePricing({ enabled });
            }}
            disabled={!providerReady && !pricing.enabled}
          />
        </div>
        {!providerReady && !pricing.enabled && (
          <div className="mt-5 flex flex-col justify-between gap-4 border-y border-border py-4 sm:flex-row sm:items-center">
            <div>
              <p className="text-[12px] font-medium">
                Connect a provider for paid registration
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Free event registration remains available without payment
                setup.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                navigate("/dashboard?tab=payments&section=providers")
              }
            >
              <CreditCard className="h-4 w-4" />
              Open providers
            </Button>
          </div>
        )}
        {pricing.enabled && (
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            <PricingInput
              id="event-registration-price"
              label="Registration price"
              currency={currency}
              value={pricing.amount}
              onValueChange={(amount) => updatePricing({ amount })}
              disabled={!providerReady}
            />
            <div>
              <Label htmlFor="event-price-label">Price label</Label>
              <Input
                id="event-price-label"
                value={pricing.label}
                onChange={(input) =>
                  updatePricing({ label: input.target.value })
                }
                className="mt-2"
                placeholder="Registration fee"
              />
            </div>
            <div>
              <Label htmlFor="event-pricing-start">Sales start</Label>
              <Input
                id="event-pricing-start"
                type="datetime-local"
                value={toDateTimeInput(pricing.salesStart)}
                onChange={(input) =>
                  updatePricing({
                    salesStart: fromDateTimeInput(input.target.value),
                  })
                }
                className="mt-2"
              />
            </div>
            <div>
              <Label htmlFor="event-pricing-end">Sales end</Label>
              <Input
                id="event-pricing-end"
                type="datetime-local"
                value={toDateTimeInput(pricing.salesEnd)}
                onChange={(input) =>
                  updatePricing({
                    salesEnd: fromDateTimeInput(input.target.value),
                  })
                }
                className="mt-2"
              />
            </div>
            <div className="flex items-center justify-between border-y border-border px-1 py-3 sm:col-span-2">
              <div>
                <p className="text-[13px] font-medium">Price includes tax</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Mark the displayed amount as tax inclusive.
                </p>
              </div>
              <Switch
                checked={pricing.taxIncluded}
                onCheckedChange={(taxIncluded) =>
                  updatePricing({ taxIncluded })
                }
              />
            </div>
          </div>
        )}
      </section>

      <ScopedCouponManager
        enabled={pricing.couponsEnabled}
        onEnabledChange={(couponsEnabled) => updatePricing({ couponsEnabled })}
        target={{
          currency,
          id: event.id,
          name: event.title || "Untitled event",
          type: "event",
        }}
        userId={userId}
        canCreate={pricing.enabled && pricing.amount > 0}
      />

      {pricing.enabled && (
        <section>
          <div className="flex flex-col gap-4 border-b border-border pb-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-[17px] font-semibold">Discounts</h2>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Early registration, timed, promo-code, and group offers.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!pricing.discountsEnabled}
              onClick={() => {
                setEditingRule(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              New discount
            </Button>
          </div>
          <div className="mt-5 flex items-center justify-between gap-6 border-y border-border py-4">
            <div>
              <p className="text-[13px] font-medium">Enable discounts</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Inactive rules remain saved but cannot be applied.
              </p>
            </div>
            <Switch
              checked={pricing.discountsEnabled}
              onCheckedChange={(discountsEnabled) =>
                updatePricing({ discountsEnabled })
              }
            />
          </div>
          {event.discountRules.length ? (
            <div className="mt-5 divide-y divide-border border-y border-border">
              {event.discountRules.map((rule) => (
                <div
                  key={rule.id}
                  className="flex flex-col gap-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                      <BadgePercent className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-[13px] font-semibold">
                          {rule.name}
                        </p>
                        <span
                          className={cn(
                            "rounded px-2 py-0.5 text-[9px] font-medium",
                            pricing.discountsEnabled && rule.active
                              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          {pricing.discountsEnabled && rule.active
                            ? "Active"
                            : "Inactive"}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {rule.valueType === "percentage"
                          ? `${rule.value}% off`
                          : `${formatCurrency(rule.value, currency)} off`}
                        {" / "}
                        {rule.mode === "first_n"
                          ? `first ${rule.firstN} registrations`
                          : rule.mode === "date_window"
                            ? "limited time"
                            : rule.mode === "promo_code"
                              ? `code ${rule.code}`
                              : `${rule.minQuantity}+ registrations`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      title="Edit discount"
                      aria-label={`Edit ${rule.name}`}
                      onClick={() => {
                        setEditingRule(rule);
                        setDialogOpen(true);
                      }}
                    >
                      <PencilLine className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      title="Delete discount"
                      aria-label={`Delete ${rule.name}`}
                      onClick={() =>
                        onChange({
                          ...event,
                          pricing,
                          discountRules: event.discountRules.filter(
                            (item) => item.id !== rule.id,
                          ),
                        })
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-5 border-y border-border py-12 text-center">
              <BadgePercent className="mx-auto h-5 w-5 text-muted-foreground" />
              <p className="mt-3 text-[13px] font-medium">
                No discount rules
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Discounts are optional and disabled by default.
              </p>
            </div>
          )}
        </section>
      )}

      <DiscountRuleDialog
        currency={currency}
        eventId={event.id}
        onOpenChange={setDialogOpen}
        onSave={upsertRule}
        open={dialogOpen}
        order={event.discountRules.length}
        rule={editingRule}
      />
    </div>
  );
}

function TicketPreview({
  attendeeEmail = "attendee@example.com",
  attendeeName = "Sarah Johnson",
  codeValue = "MAXFORM-DESIGN-PREVIEW",
  design,
  event,
  orderCode = "",
  organizerName = "",
  side,
  template,
  ticketNumber = "TKT-PREVIEW-0001",
  ticketPrice = 0,
  ticketTypeName = "General admission",
}: {
  attendeeEmail?: string;
  attendeeName?: string;
  codeValue?: string;
  design: EventTicketDesign;
  event: EventRecord;
  orderCode?: string;
  organizerName?: string;
  side: "front" | "back";
  template: EventTicketDesignTemplate | null;
  ticketNumber?: string;
  ticketPrice?: number;
  ticketTypeName?: string;
}) {
  const theme = design.theme || template?.theme || {
    background: "#FFFFFF",
    accent: "#65758B",
    text: "#18181B",
    muted: "#71717A",
    edge: "solid" as const,
    motif: "none",
    backgroundImage: "",
  };
  const resolve: TicketElementResolver = (element) => {
    const captioned = (text: string) => ({ caption: element.label, text });
    switch (element.type) {
      case "event_name":
        return { text: event.title };
      case "event_tagline":
        return { text: event.seo.description || event.description || "" };
      case "event_details":
        return captioned(`${eventDate(event)} · ${eventLocation(event)}`);
      case "event_date":
        return captioned(eventDateOnly(event));
      case "event_time":
        return captioned(eventTimeOnly(event));
      case "venue":
        return captioned(eventVenueName(event));
      case "address":
        return captioned(
          event.locationType === "online"
            ? event.onlineUrl || "Link sent by email"
            : event.address || "Address to be announced",
        );
      case "organizer":
        return captioned(organizerName || "");
      case "attendee_name":
        return captioned(attendeeName);
      case "attendee_email":
        return captioned(attendeeEmail);
      case "ticket_type":
        return captioned(ticketTypeName);
      case "ticket_price":
        return captioned(
          ticketPrice > 0
            ? formatCurrency(ticketPrice, event.pricing.currency)
            : "Free",
        );
      case "ticket_number":
        return captioned(ticketNumber);
      case "order_code":
        return captioned(orderCode || ticketNumber);
      case "event_code":
        return captioned(event.eventCode);
      case "terms":
        return {
          text:
            event.refundPolicy ||
            "Present this ticket at entry. Tickets are subject to the event refund policy.",
        };
      default:
        return { text: element.label };
    }
  };
  return (
    <TicketSurface
      elements={side === "front" ? design.frontLayout : design.backLayout}
      qrValue={codeValue}
      resolve={resolve}
      side={side}
      theme={theme}
      ticketNumber={ticketNumber}
    />
  );
}

function TicketTypeDialog({
  currency,
  eventId,
  open,
  order,
  ticket,
  onOpenChange,
  onSaved,
  userId,
}: {
  currency: string;
  eventId: string;
  open: boolean;
  order: number;
  ticket: EventTicketType | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (ticket: EventTicketType) => void;
  userId: string;
}) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState(defaultTicketDraft(eventId, currency, order));
  const [saving, setSaving] = useState(false);
  const [providerReady, setProviderReady] = useState(false);
  const [checkingProvider, setCheckingProvider] = useState(false);
  useEffect(() => {
    setDraft(
      ticket
        ? {
            ...ticket,
          }
        : defaultTicketDraft(eventId, currency, order),
    );
  }, [currency, eventId, open, order, ticket]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setCheckingProvider(true);
    void hasConnectedPaymentProvider(userId)
      .then((connected) => {
        if (active) setProviderReady(connected);
      })
      .catch(() => {
        if (active) setProviderReady(false);
      })
      .finally(() => {
        if (active) setCheckingProvider(false);
      });
    return () => {
      active = false;
    };
  }, [open, userId]);
  const update = <Key extends keyof typeof draft>(
    key: Key,
    value: (typeof draft)[Key],
  ) => setDraft((current) => ({ ...current, [key]: value }));
  const integerAtLeast = (value: number, minimum: number) =>
    Number.isFinite(value) ? Math.max(minimum, Math.floor(value)) : minimum;
  const submit = async () => {
    if (!draft.name.trim()) {
      toast.error("Add a ticket name.");
      return;
    }
    if (draft.price > 0 && !providerReady) {
      toast.error("Connect a payment provider before adding a paid ticket.");
      return;
    }
    const minPerOrder = integerAtLeast(draft.minPerOrder, 1);
    const maxPerOrder = Math.max(
      minPerOrder,
      integerAtLeast(draft.maxPerOrder, minPerOrder),
    );
    const quantityAvailable = integerAtLeast(draft.quantityAvailable, 1);
    setSaving(true);
    try {
      const saved = await saveEventTicketType(userId, {
        ...draft,
        id: ticket?.id,
        name: draft.name.trim(),
        quantityAvailable,
        minPerOrder,
        maxPerOrder,
        groupMultiplier: integerAtLeast(draft.groupMultiplier, 1),
      });
      onSaved(saved);
      onOpenChange(false);
      toast.success("Ticket type saved");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "The ticket type could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dashboard-scroll max-h-[90vh] max-w-[680px] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{ticket ? "Edit ticket type" : "New ticket type"}</DialogTitle>
          <DialogDescription>
            Pricing and inventory are shared with the registration form.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 py-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="ticket-name">Name</Label>
            <Input
              id="ticket-name"
              value={draft.name}
              onChange={(event) => update("name", event.target.value)}
              className="mt-2"
              placeholder="VIP, General admission..."
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="ticket-description">Description</Label>
            <Textarea
              id="ticket-description"
              value={draft.description}
              onChange={(event) => update("description", event.target.value)}
              className="mt-2"
            />
          </div>
          <PricingInput
            id="ticket-price"
            label="Price"
            currency={currency}
            value={draft.price}
            onValueChange={(price) => update("price", price)}
            disabled={!providerReady}
          />
          {!checkingProvider && !providerReady && (
            <div className="flex flex-col justify-between gap-3 border-y border-border py-4 sm:col-span-2 sm:flex-row sm:items-center">
              <div>
                <p className="text-[12px] font-medium">
                  Free tickets are available
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Connect a merchant provider to set a ticket price above zero.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  navigate("/dashboard?tab=payments&section=providers")
                }
              >
                <CreditCard className="h-4 w-4" />
                Open providers
              </Button>
              {draft.price > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => update("price", 0)}
                >
                  Make ticket free
                </Button>
              )}
            </div>
          )}
          <div>
            <Label htmlFor="ticket-quantity">Quantity available</Label>
            <Input
              id="ticket-quantity"
              type="number"
              min={1}
              value={draft.quantityAvailable}
              onChange={(event) =>
                update(
                  "quantityAvailable",
                  integerAtLeast(Number(event.target.value), 1),
                )
              }
              className="mt-2"
            />
          </div>
          <div>
            <Label htmlFor="ticket-min">Minimum per order</Label>
            <Input
              id="ticket-min"
              type="number"
              min={1}
              value={draft.minPerOrder}
              onChange={(event) =>
                setDraft((current) => {
                  const minPerOrder = integerAtLeast(
                    Number(event.target.value),
                    1,
                  );
                  return {
                    ...current,
                    minPerOrder,
                    maxPerOrder: Math.max(current.maxPerOrder, minPerOrder),
                  };
                })
              }
              className="mt-2"
            />
          </div>
          <div>
            <Label htmlFor="ticket-max">Maximum per order</Label>
            <Input
              id="ticket-max"
              type="number"
              min={draft.minPerOrder}
              value={draft.maxPerOrder}
              onChange={(event) =>
                update(
                  "maxPerOrder",
                  Math.max(
                    draft.minPerOrder,
                    integerAtLeast(Number(event.target.value), draft.minPerOrder),
                  ),
                )
              }
              className="mt-2"
            />
          </div>
          <div>
            <Label htmlFor="ticket-sales-start">Sales start</Label>
            <Input
              id="ticket-sales-start"
              type="datetime-local"
              value={toDateTimeInput(draft.salesStart)}
              onChange={(event) =>
                update("salesStart", fromDateTimeInput(event.target.value))
              }
              className="mt-2"
            />
          </div>
          <div>
            <Label htmlFor="ticket-sales-end">Sales end</Label>
            <Input
              id="ticket-sales-end"
              type="datetime-local"
              value={toDateTimeInput(draft.salesEnd)}
              onChange={(event) =>
                update("salesEnd", fromDateTimeInput(event.target.value))
              }
              className="mt-2"
            />
          </div>
          <div className="flex items-center justify-between border-y border-border py-4 sm:col-span-2">
            <div>
              <p className="text-[13px] font-medium">Open a waitlist when sold out</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Collect interested attendees after inventory reaches zero.
              </p>
            </div>
            <Switch
              checked={draft.waitlistEnabled}
              onCheckedChange={(value) => update("waitlistEnabled", value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save ticket
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TicketSettingsPanel({
  event,
  onChange,
  onSave,
  saveState,
}: {
  event: EventRecord;
  onChange: (event: EventRecord) => void;
  onSave: () => void;
  saveState: SaveState;
}) {
  const update = <Key extends keyof EventRecord>(
    key: Key,
    value: EventRecord[Key],
  ) => onChange({ ...event, [key]: value });

  return (
    <section className="mb-8 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
            Event-scoped configuration
          </p>
          <h2 className="mt-1.5 text-[20px] font-semibold">Ticket settings</h2>
          <p className="mt-1.5 max-w-[620px] text-[12px] leading-5 text-muted-foreground">
            Ticketing, numbering, capacity, and the ticket look for this event
            live here. Changes are isolated to <span className="font-medium text-foreground">{event.title}</span>.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onSave}
          disabled={saveState === "saving"}
        >
          {saveState === "saving" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          Save ticket settings
        </Button>
      </div>

      <div className="flex items-center justify-between gap-5 border-b border-border py-5">
        <div>
          <p className="text-[13px] font-medium">Enable ticketing</p>
          <p className="mt-1 max-w-[620px] text-[11px] leading-5 text-muted-foreground">
            Adds ticket selection and payment blocks to Registration, then
            unlocks ticket types, attendees, and secure check-in.
          </p>
        </div>
        <Switch
          checked={event.ticketingEnabled}
          onCheckedChange={(value) =>
            onChange({
              ...event,
              ticketingEnabled: value,
              ticketPrefix:
                event.ticketPrefix || suggestedTicketPrefix(event.title),
              status:
                !value &&
                (event.status === "on_sale" || event.status === "sold_out")
                  ? "published"
                  : event.status,
            })
          }
        />
      </div>

      {event.ticketingEnabled ? (
        <>
          <div className="grid gap-5 border-b border-border py-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div>
              <Label htmlFor="event-ticket-prefix">Ticket prefix</Label>
              <div className="mt-2 flex max-w-[360px]">
                <Input
                  id="event-ticket-prefix"
                  value={event.ticketPrefix.replace(/-$/, "")}
                  onChange={(input) =>
                    onChange({
                      ...event,
                      ticketPrefix: normalizeTicketPrefix(input.target.value),
                      ticketPrefixConfigured: false,
                    })
                  }
                  className="rounded-r-none font-mono uppercase"
                  placeholder="VIP"
                  maxLength={12}
                  disabled={event.attendeeCount > 0}
                />
                <span className="flex h-10 items-center rounded-r-md border border-l-0 border-input bg-muted px-4 font-mono text-[14px] font-semibold">
                  -
                </span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <p className="text-[11px] text-muted-foreground">
                  New tickets look like <span className="font-mono font-medium text-foreground">{event.ticketPrefix || "PREFIX-"}A1B2C3D4E5F6</span>
                </p>
                <span className={cn(
                  "rounded px-2 py-1 text-[9px] font-medium",
                  event.ticketPrefixConfigured
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    : "bg-amber-500/10 text-amber-700 dark:text-amber-400",
                )}>
                  {event.ticketPrefixConfigured
                    ? event.attendeeCount > 0
                      ? "Locked after first ticket"
                      : "Prefix configured"
                    : "Required before publishing"}
                </span>
              </div>
              {!event.ticketPrefixConfigured &&
                event.ticketPrefix.replace(/-$/, "").length >= 2 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => onChange({ ...event, ticketPrefixConfigured: true })}
                  >
                    <Check className="h-3.5 w-3.5" />
                    Use this prefix
                  </Button>
                )}
            </div>
            <div>
              <Label htmlFor="event-capacity">Overall capacity</Label>
              <Input
                id="event-capacity"
                type="number"
                min={1}
                value={event.capacityTotal || ""}
                onChange={(input) =>
                  update(
                    "capacityTotal",
                    input.target.value
                      ? Math.max(1, Number(input.target.value))
                      : null,
                  )
                }
                className="mt-2 max-w-[360px]"
                placeholder="No overall limit"
              />
              <div className="mt-4 flex items-center justify-between gap-4 border-t border-border pt-4">
                <div>
                  <p className="text-[12px] font-medium">Event waitlist</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Accept waitlist entries after capacity is reached.
                  </p>
                </div>
                <Switch
                  checked={event.waitlistEnabled}
                  onCheckedChange={(value) => update("waitlistEnabled", value)}
                />
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-2 pt-4 text-[11px] text-muted-foreground sm:flex-row sm:items-center">
            <span className="flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> Ticket settings are scoped to this event.</span>
            <span className="hidden sm:inline">·</span>
            <span>{saveState === "dirty" ? "Unsaved changes" : "Changes are synced"}</span>
          </div>
        </>
      ) : (
        <div className="flex items-start gap-3 pt-5 text-[12px] text-muted-foreground">
          <Ticket className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p>Turn on ticketing to configure ticket types, choose an event ticket template, and customize its front and back without changing the reusable workspace template.</p>
        </div>
      )}
    </section>
  );
}

function TicketingSetupPanel({
  event,
  onChange,
  onSave,
  saveState,
}: {
  event: EventRecord;
  onChange: (event: EventRecord) => void;
  onSave: () => void;
  saveState: SaveState;
}) {
  return (
    <div className="max-w-[820px]">
      <TicketSettingsPanel
        event={event}
        onChange={onChange}
        onSave={onSave}
        saveState={saveState}
      />
      <div className="border-y border-border py-12 text-center">
        <Ticket className="mx-auto h-7 w-7 text-muted-foreground" />
        <h3 className="mt-4 text-[15px] font-semibold">Ticketing is off for this event</h3>
        <p className="mx-auto mt-2 max-w-[440px] text-[12px] leading-5 text-muted-foreground">
          Enable ticketing above to open ticket types and event-specific ticket settings.
        </p>
      </div>
    </div>
  );
}

function TicketStudio({
  currency,
  designs,
  event,
  onEventChange,
  onSave,
  saveState,
  onDesignRemoved,
  onDesignSaved,
  onRefresh,
  onTicketsChanged,
  ticketTemplates,
  tickets,
  userId,
}: {
  currency: string;
  designs: EventTicketDesign[];
  event: EventRecord;
  onEventChange: (event: EventRecord) => void;
  onSave: () => void;
  saveState: SaveState;
  onDesignRemoved: (ticketTypeId: string | null) => void;
  onDesignSaved: (design: EventTicketDesign) => void;
  onRefresh: () => void;
  onTicketsChanged: (tickets: EventTicketType[]) => void;
  ticketTemplates: EventTicketDesignTemplate[];
  tickets: EventTicketType[];
  userId: string;
}) {
  const [mode, setMode] = useState<"inventory" | "settings">("inventory");
  const [side, setSide] = useState<"front" | "back">("front");
  const [ticketDialogOpen, setTicketDialogOpen] = useState(false);
  const [editingTicket, setEditingTicket] = useState<EventTicketType | null>(null);
  const [savingDesign, setSavingDesign] = useState(false);
  // null = the shared design every ticket type falls back to.
  const [editingTicketTypeId, setEditingTicketTypeId] = useState<string | null>(
    null,
  );
  const sharedDesign =
    designs.find((item) => item.ticketTypeId === null) || null;
  const perTypeDesigns = designs.filter((item) => item.ticketTypeId !== null);
  const perTypeEnabled = perTypeDesigns.length > 0;
  const activeDesign =
    designs.find((item) => item.ticketTypeId === editingTicketTypeId) || null;
  const [designDraft, setDesignDraft] = useState<EventTicketDesign | null>(
    sharedDesign,
  );
  const selectedTemplate =
    ticketTemplates.find(
      (template) => template.id === designDraft?.templateId,
    ) ||
    ticketTemplates[0] ||
    null;
  useEffect(() => {
    const saved = designs.find(
      (item) => item.ticketTypeId === editingTicketTypeId,
    );
    if (saved) {
      setDesignDraft(saved);
      return;
    }
    // Nothing saved yet for this target: a ticket type starts from the shared
    // design, and an event with no design at all starts from the first
    // template so the canvas is usable straight away.
    const starting = sharedDesign || null;
    if (starting) {
      setDesignDraft({
        ...structuredClone(starting),
        id: "",
        ticketTypeId: editingTicketTypeId,
      });
      return;
    }
    const template = ticketTemplates[0];
    setDesignDraft(
      template
        ? {
            id: "",
            eventId: event.id,
            ticketTypeId: editingTicketTypeId,
            templateId: template.id,
            frontLayout: structuredClone(template.frontLayout),
            backLayout: structuredClone(template.backLayout),
            barcodeFormat: "qr",
            outputFormats: ["digital", "pdf"],
          }
        : null,
    );
    // sharedDesign is derived from designs, so designs covers it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designs, editingTicketTypeId, event.id, ticketTemplates]);
  const splitPerTicketType = () => {
    if (!tickets.length) {
      toast.error("Add a ticket type before designing per ticket type.");
      return;
    }
    setEditingTicketTypeId(tickets[0].id);
    toast.info(
      "Pick a ticket type, adjust its design, and save it. Types without their own design keep using the shared one.",
    );
  };
  const resetActiveToShared = async () => {
    if (!editingTicketTypeId) return;
    if (activeDesign) {
      try {
        await deleteEventTicketDesign(userId, event.id, editingTicketTypeId);
        onDesignRemoved(editingTicketTypeId);
        toast.success("This ticket type now uses the shared design");
      } catch {
        toast.error("The design could not be reset.");
        return;
      }
    }
    setEditingTicketTypeId(null);
  };
  const removeTicket = async (ticket: EventTicketType) => {
    if (ticket.soldCount > 0) {
      toast.error("A ticket type with issued tickets cannot be deleted.");
      return;
    }
    await deleteEventTicketType(userId, event.id, ticket.id);
    onTicketsChanged(tickets.filter((item) => item.id !== ticket.id));
    toast.success("Ticket type deleted");
  };
  const saveDesign = async () => {
    if (!designDraft) return;
    setSavingDesign(true);
    try {
      const saved = await saveEventTicketDesign(userId, {
        ...designDraft,
        ticketTypeId: editingTicketTypeId,
      });
      setDesignDraft(saved);
      onDesignSaved(saved);
      toast.success(
        editingTicketTypeId
          ? "Design saved for this ticket type"
          : "Shared ticket design saved",
      );
    } catch {
      toast.error("The ticket design could not be saved.");
    } finally {
      setSavingDesign(false);
    }
  };
  const addElement = (type: TicketElementType) => {
    if (!designDraft) return;
    const element: TicketCanvasElement = clampElement({
      id: `${type}-${crypto.randomUUID()}`,
      type,
      label: TICKET_ELEMENT_LABELS[type],
      x: 6,
      y: 50,
      width: defaultWidthFor(type),
      size: defaultSizeFor(type),
    });
    setDesignDraft({
      ...designDraft,
      [side === "front" ? "frontLayout" : "backLayout"]: [
        ...(side === "front" ? designDraft.frontLayout : designDraft.backLayout),
        element,
      ],
    });
  };

  const [designerTemplate, setDesignerTemplate] =
    useState<EventTicketDesignTemplate | null>(null);
  const [templateActionId, setTemplateActionId] = useState("");
  const [designerTransition, setDesignerTransition] = useState<
    "opening" | "closing" | null
  >(null);
  const designerTransitionTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const activeBaseTemplate = useMemo(() => {
    const directMatch = ticketTemplates.find(
      (template) => template.id === sharedDesign?.templateId,
    );
    if (directMatch || !sharedDesign) return directMatch || null;

    // Recover designs saved by the previous event-copy flow, which could
    // persist a temporary `event-copy-*` id that is not in the library.
    const savedElements = [
      ...sharedDesign.frontLayout,
      ...sharedDesign.backLayout,
    ];
    const scoreTemplate = (template: EventTicketDesignTemplate) => {
      const templateElements = [
        ...template.frontLayout,
        ...template.backLayout,
      ];
      let score = templateElements.reduce((total, element) => {
        const exact = savedElements.some(
          (saved) => saved.id === element.id && saved.type === element.type,
        );
        if (exact) return total + 5;
        return savedElements.some((saved) => saved.type === element.type)
          ? total + 1
          : total;
      }, 0);
      if (sharedDesign.theme) {
        (Object.keys(template.theme) as Array<keyof typeof template.theme>).forEach(
          (key) => {
            if (template.theme[key] === sharedDesign.theme?.[key]) score += 1;
          },
        );
      }
      return score;
    };
    const ranked = ticketTemplates
      .map((template) => ({ template, score: scoreTemplate(template) }))
      .sort((left, right) => right.score - left.score);
    return ranked[0]?.score ? ranked[0].template : null;
  }, [sharedDesign, ticketTemplates]);
  const activeTemplateId = activeBaseTemplate?.id || "";
  const eventCopyTemplate =
    sharedDesign && activeBaseTemplate
      ? {
          ...structuredClone(activeBaseTemplate),
          // Keep the real library id. Event-only changes live in the design
          // row, so a temporary copy id must never become the active id.
          id: activeBaseTemplate.id,
          createdBy: userId,
          sourceTemplateId: activeBaseTemplate.id,
          isSystem: false,
          name: `${activeBaseTemplate.name} · ${event.title}`,
          description: "Event-specific ticket design",
          theme: sharedDesign.theme
            ? structuredClone(sharedDesign.theme)
            : structuredClone(activeBaseTemplate.theme),
          frontLayout: structuredClone(sharedDesign.frontLayout),
          backLayout: structuredClone(sharedDesign.backLayout),
        }
      : null;
  useEffect(
    () => () => {
      if (designerTransitionTimer.current) {
        clearTimeout(designerTransitionTimer.current);
      }
    },
    [],
  );
  const closeEventDesigner = () => {
    if (designerTransitionTimer.current) {
      clearTimeout(designerTransitionTimer.current);
    }
    setDesignerTemplate(null);
    setDesignerTransition("closing");
    designerTransitionTimer.current = setTimeout(() => {
      setDesignerTransition(null);
      designerTransitionTimer.current = null;
    }, 280);
  };
  const openEventDesigner = (template: EventTicketDesignTemplate) => {
    const sourceTemplateId = template.sourceTemplateId || template.id;
    const saved =
      sharedDesign && activeBaseTemplate?.id === sourceTemplateId
        ? sharedDesign
        : null;
    const nextTemplate = {
      ...structuredClone(template),
      theme: saved?.theme
        ? structuredClone(saved.theme)
        : structuredClone(template.theme),
      frontLayout: structuredClone(saved?.frontLayout || template.frontLayout),
      backLayout: structuredClone(saved?.backLayout || template.backLayout),
    };
    if (designerTransitionTimer.current) {
      clearTimeout(designerTransitionTimer.current);
    }
    setDesignerTransition("opening");
    designerTransitionTimer.current = setTimeout(() => {
      setDesignerTemplate(nextTemplate);
      setDesignerTransition(null);
      designerTransitionTimer.current = null;
    }, 260);
  };
  const setActiveTemplate = async (template: EventTicketDesignTemplate) => {
    setTemplateActionId(template.id);
    try {
      const saved = await saveEventTicketDesign(userId, {
        id: sharedDesign?.id,
        eventId: event.id,
        ticketTypeId: null,
        templateId: template.id,
        theme: structuredClone(template.theme),
        frontLayout: structuredClone(template.frontLayout),
        backLayout: structuredClone(template.backLayout),
        barcodeFormat: "qr",
        outputFormats: ["digital", "pdf"],
      });
      onDesignSaved(saved);
      toast.success(`${template.name} is active for this event`);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "The ticket template could not be activated.",
      );
    } finally {
      setTemplateActionId("");
    }
  };
  const deactivateActiveTemplate = async () => {
    setTemplateActionId("deactivate");
    try {
      await deleteEventTicketDesign(userId, event.id, null);
      onDesignRemoved(null);
      toast.success("The event ticket template is inactive now");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "The ticket template could not be deactivated.",
      );
    } finally {
      setTemplateActionId("");
    }
  };
  const saveEventTemplate = async (template: EventTicketDesignTemplate) => {
    const requestedTemplateId = template.sourceTemplateId || template.id;
    const templateId = ticketTemplates.some(
      (candidate) => candidate.id === requestedTemplateId,
    )
      ? requestedTemplateId
      : activeBaseTemplate?.id || requestedTemplateId;
    const saved = await saveEventTicketDesign(userId, {
      id: sharedDesign?.id,
      eventId: event.id,
      ticketTypeId: null,
      templateId,
      theme: structuredClone(template.theme),
      frontLayout: structuredClone(template.frontLayout),
      backLayout: structuredClone(template.backLayout),
      barcodeFormat: "qr",
      outputFormats: ["digital", "pdf"],
    });
    onDesignSaved(saved);
    return { ...template, id: templateId };
  };

  // Ticket settings is intentionally a gallery. The block-level editor lives
  // in a contained modal so reusable templates remain unchanged.
  return (
    <>
      <div className="mb-10 flex items-center gap-1 border-b border-border">
        {[
          ["inventory", "Ticket types"],
          ["settings", "Ticket settings"],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value as typeof mode)}
            className={cn(
              "relative h-11 px-4 text-[13px]",
              mode === value ? "font-medium" : "text-muted-foreground",
            )}
          >
            {label}
            {mode === value && (
              <span className="absolute inset-x-4 bottom-0 h-0.5 bg-primary" />
            )}
          </button>
        ))}
      </div>
      {!event.ticketingEnabled ? (
        <TicketingSetupPanel
          event={event}
          onChange={onEventChange}
          onSave={onSave}
          saveState={saveState}
        />
      ) : mode === "inventory" ? (
        <>
          <TicketSettingsPanel
            event={event}
            onChange={onEventChange}
            onSave={onSave}
            saveState={saveState}
          />
          <TicketTypesPanel
            currency={currency}
            event={event}
            onRefresh={onRefresh}
            onTicketsChanged={onTicketsChanged}
            tickets={tickets}
            userId={userId}
          />
        </>
      ) : (
        <EventTicketTemplateGallery
          activeEventTemplate={eventCopyTemplate}
          activeTemplateId={activeTemplateId}
          busyId={templateActionId}
          templates={ticketTemplates}
          onDesign={openEventDesigner}
          onDeactivate={() => void deactivateActiveTemplate()}
          onSetActive={(template) => void setActiveTemplate(template)}
        />
      )}
      <Dialog
        open={Boolean(designerTemplate)}
        // The event designer is intentionally closed only by its back arrow.
        // Saving or a generic Radix dialog event must not dismiss the builder.
        onOpenChange={() => undefined}
      >
        <DialogContent
          className="h-[88vh] max-w-[1180px] overflow-hidden bg-background p-3 sm:p-5 [&>button]:hidden"
          onEscapeKeyDown={(dialogEvent) => dialogEvent.preventDefault()}
          onPointerDownOutside={(dialogEvent) => dialogEvent.preventDefault()}
        >
          {designerTemplate && (
            <div className="dashboard-scroll h-full overflow-y-auto rounded-lg bg-muted/25 p-1">
              <TicketTemplateDesigner
                template={designerTemplate}
                ticketTypeNames={tickets.map((ticket) => ticket.name)}
                userId={userId}
                onBack={closeEventDesigner}
                onSaved={(saved) => setDesignerTemplate(saved)}
                onSaveTemplate={saveEventTemplate}
                saveLabel="Save event ticket"
                saveSuccessMessage="Event ticket saved"
                leaveDescription="Your event ticket design has unsaved changes."
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
      {designerTransition && (
        <TicketDesignerTransitionOverlay phase={designerTransition} />
      )}
    </>
  );

  return (
    <>
      <div className="mb-10 flex items-center gap-1 border-b border-border">
        {[
          ["inventory", "Ticket types"],
          ["settings", "Ticket settings"],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value as typeof mode)}
            className={cn(
              "relative h-11 px-4 text-[13px]",
              mode === value ? "font-medium" : "text-muted-foreground",
            )}
          >
            {label}
            {mode === value && (
              <span className="absolute inset-x-4 bottom-0 h-0.5 bg-primary" />
            )}
          </button>
        ))}
      </div>
      {!event.ticketingEnabled ? (
        <TicketingSetupPanel
          event={event}
          onChange={onEventChange}
          onSave={onSave}
          saveState={saveState}
        />
      ) : mode === "inventory" ? (
        <TicketTypesPanel
          currency={currency}
          event={event}
          onRefresh={onRefresh}
          onTicketsChanged={onTicketsChanged}
          tickets={tickets}
          userId={userId}
        />
      ) : designDraft ? (
        <>
        <TicketSettingsPanel
          event={event}
          onChange={onEventChange}
          onSave={onSave}
          saveState={saveState}
        />
        <div className="mb-7 rounded-xl border border-border p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[13px] font-medium">
                {perTypeEnabled || editingTicketTypeId
                  ? "Designing per ticket type"
                  : "One design for every ticket type"}
              </p>
              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                {perTypeEnabled || editingTicketTypeId
                  ? "Give a tier its own look, or send it back to the shared design at any time."
                  : "Every ticket type for this event uses the same design. Split it only if you want a tier to look different."}
              </p>
            </div>
            {editingTicketTypeId || perTypeEnabled ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setEditingTicketTypeId(null)}
              >
                <Ticket className="h-3.5 w-3.5" />
                Edit shared design
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={splitPerTicketType}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                Design per ticket type
              </Button>
            )}
          </div>

          {(perTypeEnabled || editingTicketTypeId) && (
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
              <button
                type="button"
                onClick={() => setEditingTicketTypeId(null)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-[11px] transition",
                  editingTicketTypeId === null
                    ? "border-primary bg-primary/10 font-medium text-primary"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                Shared design
              </button>
              {tickets.map((ticket) => {
                const own = perTypeDesigns.some(
                  (item) => item.ticketTypeId === ticket.id,
                );
                return (
                  <button
                    key={ticket.id}
                    type="button"
                    onClick={() => setEditingTicketTypeId(ticket.id)}
                    className={cn(
                      "flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] transition",
                      editingTicketTypeId === ticket.id
                        ? "border-primary bg-primary/10 font-medium text-primary"
                        : "border-border text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: ticket.color }}
                    />
                    {ticket.name}
                    <span
                      className={cn(
                        "text-[9px] uppercase",
                        own ? "text-primary" : "text-muted-foreground",
                      )}
                    >
                      {own ? "Own design" : "Shared"}
                    </span>
                  </button>
                );
              })}
              {editingTicketTypeId && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-auto"
                  onClick={() => void resetActiveToShared()}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Use the shared design here
                </Button>
              )}
            </div>
          )}
        </div>
        <div className="grid gap-7 xl:grid-cols-[230px_minmax(0,1fr)_230px]">
          <aside>
            <h3 className="text-[12px] font-semibold uppercase text-muted-foreground">
              Ticket template
            </h3>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
              Choose the starting point for this event. Your edits are saved as
              an event copy and never change the reusable main template.
            </p>
            <div className="dashboard-scroll mt-4 grid max-h-[520px] grid-cols-2 gap-3 overflow-y-auto pr-1 xl:grid-cols-1">
              {ticketTemplates.map((template) => (
                <div
                  key={template.id}
                  className={cn(
                    "relative w-full overflow-hidden rounded-md border text-left transition",
                    designDraft.templateId === template.id
                      ? "border-primary ring-1 ring-primary"
                      : "border-border hover:border-primary/40",
                  )}
                >
                  <span className="block border-b border-border">
                    <TicketTemplateCanvas
                      density="thumbnail"
                      side="front"
                      template={template}
                    />
                  </span>
                  <span className="flex items-center justify-between gap-2 px-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate text-[12px] font-medium">
                        {template.name}
                      </span>
                      <span className="mt-0.5 block truncate text-[9px] uppercase text-muted-foreground">
                        {template.category}
                      </span>
                    </span>
                    {designDraft.templateId === template.id && (
                      <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setDesignDraft({
                        ...designDraft,
                        templateId: template.id,
                        frontLayout: structuredClone(template.frontLayout),
                        backLayout: structuredClone(template.backLayout),
                      })
                    }
                    className="absolute inset-0 rounded-md focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    <span className="sr-only">
                      Apply the {template.name} template
                    </span>
                  </button>
                </div>
              ))}
            </div>
          </aside>
          <div>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex rounded-md border border-border p-1">
                {(["front", "back"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setSide(value)}
                    className={cn(
                      "rounded px-4 py-1.5 text-[12px] capitalize",
                      side === value
                        ? "bg-foreground text-background"
                        : "text-muted-foreground",
                    )}
                  >
                    {value}
                  </button>
                ))}
              </div>
              <Button
                type="button"
                onClick={() => void saveDesign()}
                disabled={savingDesign}
              >
                {savingDesign ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {editingTicketTypeId
                  ? "Save for this type"
                  : "Save event ticket"}
              </Button>
            </div>
            <div className="flex min-h-[360px] items-center bg-muted/30 p-5 sm:p-10">
              <TicketPreview
                design={designDraft}
                event={event}
                side={side}
                template={selectedTemplate}
                ticketPrice={tickets[0]?.price ?? 0}
                ticketTypeName={tickets[0]?.name || "General admission"}
              />
            </div>
            <p className="mt-3 text-center text-[11px] text-muted-foreground">
              Sample attendee data is used in the preview. Issued tickets use live data.
            </p>
          </div>
          <aside>
            <h3 className="text-[12px] font-semibold uppercase text-muted-foreground">
              Add element
            </h3>
            <div className="mt-3 space-y-1">
              {(
                [
                  "event_name",
                  "event_tagline",
                  "event_date",
                  "event_time",
                  "venue",
                  "address",
                  "attendee_name",
                  "ticket_type",
                  "ticket_price",
                  "ticket_number",
                  "order_code",
                  "qr",
                  "barcode",
                  "logo",
                  "image",
                  "custom_text",
                  "terms",
                  "panel",
                  "divider",
                ] as TicketElementType[]
              ).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => addElement(type)}
                  className="flex w-full items-center gap-3 rounded px-2 py-2 text-left text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {TICKET_ELEMENT_LABELS[type]}
                </button>
              ))}
            </div>
            <div className="mt-6 border-y border-border py-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                <p className="text-[12px] font-medium">Secure QR ticket</p>
              </div>
              <p className="mt-2 text-[10px] leading-5 text-muted-foreground">
                Every issued ticket contains a unique server-signed QR code
                verified before check-in.
              </p>
            </div>
          </aside>
        </div>
        </>
      ) : (
        <div className="py-16 text-center">
          <Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" />
        </div>
      )}
      <TicketTypeDialog
        currency={currency}
        eventId={event.id}
        open={ticketDialogOpen}
        order={tickets.length}
        ticket={editingTicket}
        userId={userId}
        onOpenChange={setTicketDialogOpen}
        onSaved={(saved) =>
          onTicketsChanged(
            tickets.some((item) => item.id === saved.id)
              ? tickets.map((item) => (item.id === saved.id ? saved : item))
              : [...tickets, saved],
          )
        }
      />
    </>
  );
}

function EventTicketTemplateGallery({
  activeEventTemplate,
  activeTemplateId,
  busyId,
  onDeactivate,
  onDesign,
  onSetActive,
  templates,
}: {
  activeEventTemplate: EventTicketDesignTemplate | null;
  activeTemplateId: string;
  busyId: string;
  onDeactivate: () => void;
  onDesign: (template: EventTicketDesignTemplate) => void;
  onSetActive: (template: EventTicketDesignTemplate) => void;
  templates: EventTicketDesignTemplate[];
}) {
  const [previewTemplate, setPreviewTemplate] =
    useState<EventTicketDesignTemplate | null>(null);
  const activeBaseTemplate =
    templates.find((template) => template.id === activeTemplateId) ||
    (activeEventTemplate?.sourceTemplateId
      ? templates.find(
          (template) => template.id === activeEventTemplate.sourceTemplateId,
        ) || null
      : null);
  const hasActiveTemplate = Boolean(activeTemplateId);

  const renderCard = (template: EventTicketDesignTemplate) => {
    const isActive = activeTemplateId === template.id;
    const isLocked = hasActiveTemplate && !isActive;
    const isBusy = busyId === template.id;
    return (
      <article
        key={template.id}
        className={cn(
          "group relative overflow-hidden rounded-xl border bg-card transition",
          isActive
            ? "border-primary ring-1 ring-primary/40"
            : isLocked
              ? "border-border opacity-45 grayscale"
              : "border-border hover:-translate-y-0.5 hover:border-primary/45 hover:shadow-lg",
        )}
      >
        <div className="relative border-b border-border bg-muted/20">
          <TicketTemplateThumb template={template} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="absolute right-3 top-3 h-8 w-8 rounded-full bg-background/90 shadow-xs"
                aria-label={`${template.name} actions`}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onClick={() => setPreviewTemplate(template)}>
                <Eye className="h-4 w-4" />
                Preview both sides
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={isBusy || isLocked || isActive}
                onClick={() => onSetActive(template)}
              >
                <CheckCircle2 className="h-4 w-4" />
                {isActive ? "Active for this event" : "Set active for event"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={isLocked}
                onClick={() => onDesign(template)}
              >
                <PencilLine className="h-4 w-4" />
                Design for this event
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {isActive && (
            <span className="absolute bottom-3 left-3 rounded-full bg-primary px-2.5 py-1 text-[10px] font-medium text-primary-foreground">
              Active for this event
            </span>
          )}
        </div>
        <div className="space-y-3 p-4">
          <div className="min-w-0">
            <h3 className="truncate text-[13px] font-semibold">{template.name}</h3>
            <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-muted-foreground">
              {template.description || "A polished ticket layout for your attendees."}
            </p>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="rounded-full bg-muted px-2.5 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              {template.category}
            </span>
            <Button
              type="button"
              size="sm"
              variant={isActive ? "secondary" : "default"}
              disabled={isBusy || isLocked || isActive}
              onClick={() => onSetActive(template)}
            >
              {isBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {isActive ? "Active" : "Set active"}
            </Button>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full"
            disabled={isLocked}
            onClick={() => onDesign(template)}
          >
            <Palette className="h-3.5 w-3.5" />
            Design template
          </Button>
        </div>
      </article>
    );
  };

  return (
    <section className="space-y-7">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
            Ticket appearance
          </p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight">
            Ticket settings
          </h2>
          <p className="mt-2 max-w-2xl text-[12px] leading-6 text-muted-foreground">
            Select one template for this event, then edit its private copy. The reusable template remains unchanged.
          </p>
        </div>
        <div className="rounded-lg border border-border bg-muted/25 px-3 py-2 text-[11px] text-muted-foreground">
          {hasActiveTemplate
            ? "One active design is used across ticket types"
            : "No template is active yet"}
        </div>
      </div>

      {activeEventTemplate && activeBaseTemplate && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
            <p className="text-[12px] font-semibold">Selected template</p>
            <span className="text-[11px] text-muted-foreground">
              {activeBaseTemplate.name} · front and back
            </span>
          </div>
          <div className="grid max-w-[860px] gap-4 sm:grid-cols-2">
            {(["front", "back"] as const).map((side) => (
              <article
                key={side}
                className="min-w-0 border border-border/80 bg-card p-3 shadow-xs"
              >
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[11px] font-semibold capitalize">{side}</p>
                  <span className="text-[10px] text-muted-foreground">Event copy</span>
                </div>
                <TicketTemplateCanvas
                  density="thumbnail"
                  side={side}
                  template={activeEventTemplate}
                />
              </article>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => onDesign(activeBaseTemplate)}>
              <Palette className="h-3.5 w-3.5" />
              Design template
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busyId === "deactivate"}
              onClick={onDeactivate}
            >
              {busyId === "deactivate" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Make inactive
            </Button>
          </div>
        </div>
      )}

      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-[12px] font-semibold">Template library</p>
          <p className="text-[11px] text-muted-foreground">
            {templates.length} {templates.length === 1 ? "template" : "templates"}
          </p>
        </div>
        {templates.length ? (
          <PaginatedCardGrid
            items={templates}
            pageSize={12}
            itemLabel="ticket templates"
            getKey={(template) => template.id}
            renderItem={renderCard}
          />
        ) : (
          <div className="rounded-xl border border-dashed border-border py-16 text-center text-[12px] text-muted-foreground">
            No ticket templates are available yet.
          </div>
        )}
      </div>

      <Dialog
        open={Boolean(previewTemplate)}
        onOpenChange={(open) => !open && setPreviewTemplate(null)}
      >
        <DialogContent className="max-w-[860px]">
          <DialogHeader>
            <DialogTitle>{previewTemplate?.name}</DialogTitle>
            <DialogDescription>
              Preview both sides of this ticket template.
            </DialogDescription>
          </DialogHeader>
          {previewTemplate && (
            <div className="grid gap-5 bg-muted/25 p-5 md:grid-cols-2">
              {(["front", "back"] as const).map((side) => (
                <div key={side} className="space-y-2">
                  <p className="text-[11px] font-medium capitalize text-muted-foreground">
                    {side}
                  </p>
                  <TicketTemplateCanvas
                    density="thumbnail"
                    side={side}
                    template={previewTemplate}
                  />
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function TicketTypesPanel({
  currency,
  event,
  onRefresh,
  onTicketsChanged,
  tickets,
  userId,
}: {
  currency: string;
  event: EventRecord;
  onRefresh: () => void;
  onTicketsChanged: (tickets: EventTicketType[]) => void;
  tickets: EventTicketType[];
  userId: string;
}) {
  const [ticketDialogOpen, setTicketDialogOpen] = useState(false);
  const [editingTicket, setEditingTicket] = useState<EventTicketType | null>(
    null,
  );
  const removeTicket = async (ticket: EventTicketType) => {
    if (ticket.soldCount > 0) {
      toast.error("A ticket type with issued tickets cannot be deleted.");
      return;
    }
    try {
      await deleteEventTicketType(userId, event.id, ticket.id);
      onTicketsChanged(tickets.filter((item) => item.id !== ticket.id));
      onRefresh();
      toast.success("Ticket type deleted");
    } catch {
      toast.error("This ticket type could not be deleted.");
    }
  };
  return (
    <>
      <div className="flex flex-col gap-5 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-[640px]">
          <h2 className="text-[20px] font-semibold">Ticket types</h2>
          <p className="mt-2 text-[12px] leading-6 text-muted-foreground">
            Create this event's admission tiers, pricing, inventory, sales
            window, and per-order limits. Prices use {currency}.
          </p>
        </div>
        <Button
          type="button"
          onClick={() => {
            setEditingTicket(null);
            setTicketDialogOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          New ticket type
        </Button>
      </div>
      <div className="mt-6 flex flex-col gap-3 border-y border-border py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] uppercase text-muted-foreground">
            This event's ticket prefix
          </p>
          <p className="mt-1 font-mono text-[14px] font-semibold">
            {event.ticketPrefix}
          </p>
        </div>
        <p className="max-w-[460px] text-[11px] leading-5 text-muted-foreground sm:text-right">
          Ticket types and issued numbers on this screen belong only to{" "}
          <span className="font-medium text-foreground">{event.title}</span>.
          The prefix can be changed in Event settings before tickets are issued.
        </p>
      </div>
      <div className="mt-10">
        {tickets.length ? (
          <div className="divide-y divide-border border-y border-border">
            {tickets.map((ticket) => {
              const remaining = Math.max(
                0,
                ticket.quantityAvailable - ticket.soldCount,
              );
              const soldPercent = ticket.quantityAvailable
                ? Math.min(
                    100,
                    Math.round(
                      (ticket.soldCount / ticket.quantityAvailable) * 100,
                    ),
                  )
                : 0;
              return (
                <div
                  key={ticket.id}
                  className="grid gap-5 py-6 md:grid-cols-[minmax(0,1fr)_220px_auto] md:items-center"
                >
                  <div className="flex min-w-0 gap-4">
                    <span
                      className="mt-1 h-12 w-1 shrink-0 rounded"
                      style={{ backgroundColor: ticket.color }}
                    />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-[14px] font-semibold">
                          {ticket.name}
                        </h3>
                        <span
                          className={cn(
                            "rounded px-2 py-1 text-[9px] font-medium",
                            ticket.active
                              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                              : "bg-muted text-muted-foreground",
                          )}
                        >
                          {ticket.active ? "On sale" : "Inactive"}
                        </span>
                      </div>
                      <p className="mt-1.5 text-[12px] text-muted-foreground">
                        {ticket.price
                          ? formatCurrency(ticket.price, ticket.currency)
                          : "Free"}
                        {" · "}
                        {ticket.minPerOrder}-{ticket.maxPerOrder} per order
                      </p>
                      {ticket.description && (
                        <p className="mt-2 line-clamp-2 text-[11px] leading-5 text-muted-foreground">
                          {ticket.description}
                        </p>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>{ticket.soldCount.toLocaleString()} issued</span>
                      <span>{remaining.toLocaleString()} remaining</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full"
                        style={{
                          backgroundColor: ticket.color,
                          width: `${soldPercent}%`,
                        }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEditingTicket(ticket);
                        setTicketDialogOpen(true);
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Delete ${ticket.name}`}
                      onClick={() => void removeTicket(ticket)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="border-y border-border py-16 text-center">
            <Ticket className="mx-auto h-6 w-6 text-muted-foreground" />
            <p className="mt-4 text-[14px] font-semibold">
              Create the first ticket type
            </p>
            <p className="mx-auto mt-2 max-w-[430px] text-[12px] leading-6 text-muted-foreground">
              Ticket types belong to this event, so another event can have
              completely different prices and inventory.
            </p>
            <Button
              type="button"
              className="mt-6"
              onClick={() => setTicketDialogOpen(true)}
            >
              <Plus className="h-4 w-4" />
              New ticket type
            </Button>
          </div>
        )}
      </div>
      <TicketTypeDialog
        currency={currency}
        eventId={event.id}
        open={ticketDialogOpen}
        order={tickets.length}
        ticket={editingTicket}
        userId={userId}
        onOpenChange={setTicketDialogOpen}
        onSaved={(saved) => {
          onTicketsChanged(
            tickets.some((item) => item.id === saved.id)
              ? tickets.map((item) => (item.id === saved.id ? saved : item))
              : [...tickets, saved],
          );
          onRefresh();
        }}
      />
    </>
  );
}

function TicketTemplateThumb({
  template,
}: {
  template: EventTicketDesignTemplate;
}) {
  return (
    <div className="relative aspect-[1.8/1] w-full overflow-hidden bg-muted/40">
      <div className="absolute inset-0 transition-opacity duration-300 group-hover:opacity-0 group-focus-within:opacity-0">
        <TicketTemplateCanvas density="thumbnail" side="front" template={template} />
      </div>
      <div className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-within:opacity-100">
        <TicketTemplateCanvas density="thumbnail" side="back" template={template} />
      </div>
      <span
        className="pointer-events-none absolute bottom-2 left-2 rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider backdrop-blur-xs"
        style={{
          backgroundColor: ticketRgba(template.theme.background, 0.8),
          color: template.theme.muted,
        }}
      >
        <span className="group-hover:hidden group-focus-within:hidden">
          Front
        </span>
        <span className="hidden group-hover:inline group-focus-within:inline">
          Back
        </span>
      </span>
    </div>
  );
}

function TicketTemplateLibrary({
  onSelect,
  selectedId,
  templates,
}: {
  onSelect: (template: EventTicketDesignTemplate) => void;
  selectedId?: string;
  templates: EventTicketDesignTemplate[];
}) {
  return (
    <PaginatedCardGrid
      items={templates}
      pageSize={12}
      itemLabel="ticket templates"
      getKey={(template) => template.id}
      renderItem={(template) => {
        const selected = selectedId === template.id;
        return (
          <article
            className={cn(
              "group relative overflow-hidden rounded-lg border bg-card text-left transition hover:-translate-y-0.5 hover:shadow-lg",
              selected
                ? "border-primary ring-1 ring-primary"
                : "border-border hover:border-primary/50",
            )}
          >
            <div className="border-b border-border">
              <TicketTemplateThumb template={template} />
            </div>
            {selected && (
              <span className="absolute right-3 top-3 z-10 grid h-6 w-6 place-items-center rounded-full bg-primary text-primary-foreground">
                <Check className="h-3.5 w-3.5" />
              </span>
            )}
            <div className="p-4">
              <p className="text-[10px] font-semibold uppercase text-primary">
                {template.category}
              </p>
              <p className="mt-1.5 text-[14px] font-semibold">
                {template.name}
              </p>
              <p className="mt-2 min-h-10 text-[11px] leading-5 text-muted-foreground">
                {template.description}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onSelect(template)}
              className="absolute inset-0 z-10 rounded-lg focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <span className="sr-only">Use the {template.name} template</span>
            </button>
          </article>
        );
      }}
    />
  );
}

function TicketTemplateCanvas({
  density = "full",
  side,
  template,
}: {
  density?: "full" | "thumbnail";
  side: "front" | "back";
  template: EventTicketDesignTemplate;
}) {
  return (
    <TicketSurface
      elements={side === "front" ? template.frontLayout : template.backLayout}
      flat={density === "thumbnail"}
      qrValue={`MAXFORM:TEMPLATE:${template.id || "NEW"}:SECURE`}
      resolve={sampleTicketResolver}
      side={side}
      theme={template.theme}
      ticketNumber={sampleTicketNumber}
    />
  );
}

function ModuleTicketWorkspace({
  onTemplatesChanged,
  ticketTemplates,
  userId,
}: {
  onTemplatesChanged: (templates: EventTicketDesignTemplate[]) => void;
  ticketTemplates: EventTicketDesignTemplate[];
  userId: string;
}) {
  const [previewTemplate, setPreviewTemplate] =
    useState<EventTicketDesignTemplate | null>(null);
  const [editingTemplate, setEditingTemplate] =
    useState<EventTicketDesignTemplate | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [opening, setOpening] = useState(false);
  const openingTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(
    () => () => {
      if (openingTimer.current) clearTimeout(openingTimer.current);
    },
    [],
  );
  const openEditor = (template: EventTicketDesignTemplate) => {
    setOpening(true);
    if (openingTimer.current) clearTimeout(openingTimer.current);
    openingTimer.current = setTimeout(() => {
      setEditingTemplate(structuredClone(template));
      setOpening(false);
      scrollDashboardToTop("auto");
    }, 650);
  };
  const categories = useMemo(
    () =>
      Array.from(
        new Set(
          ticketTemplates
            .map((template) => template.category.trim())
            .filter(Boolean),
        ),
      ).sort((first, second) => first.localeCompare(second)),
    [ticketTemplates],
  );
  const visibleTemplates = useMemo(() => {
    const term = search.trim().toLowerCase();
    return ticketTemplates.filter((template) => {
      if (category !== "all" && template.category.trim() !== category) {
        return false;
      }
      if (!term) return true;
      return `${template.name} ${template.category} ${template.description}`
        .toLowerCase()
        .includes(term);
    });
  }, [category, search, ticketTemplates]);
  const duplicateTemplate = (template: EventTicketDesignTemplate) =>
    openEditor({
      ...structuredClone(template),
      id: "",
      createdBy: userId,
      sourceTemplateId: null,
      isSystem: false,
      name: `${template.name} copy`,
    });
  const createTemplate = () => {
    const source =
      ticketTemplates.find((template) => template.id === "studio-blank") ||
      ticketTemplates[0];
    if (!source) return;
    openEditor({
      ...structuredClone(source),
      id: "",
      createdBy: userId,
      sourceTemplateId: null,
      isSystem: false,
      name: "Untitled ticket",
      category: "Custom",
      description: "A custom reusable ticket template.",
    });
  };
  const acceptSaved = (saved: EventTicketDesignTemplate) => {
    onTemplatesChanged([
      saved,
      ...ticketTemplates.filter(
        (template) =>
          template.id !== saved.id &&
          template.id !== saved.sourceTemplateId,
      ),
    ]);
    setEditingTemplate(saved);
  };

  if (opening) {
    return (
      <div
        className="flex min-h-[520px] items-center justify-center"
        role="status"
        aria-live="polite"
      >
        <div className="w-full max-w-[320px] border-y border-border py-8 text-center">
          <span className="mx-auto grid h-11 w-11 place-items-center rounded-md bg-primary/10 text-primary">
            <Loader2 className="h-5 w-5 animate-spin" />
          </span>
          <p className="mt-4 text-[14px] font-semibold">
            Preparing ticket designer
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Loading layout, theme, and secure QR controls
          </p>
          <div className="mx-auto mt-5 h-1 w-36 overflow-hidden rounded-full bg-muted">
            <div className="h-full w-2/3 animate-pulse rounded-full bg-primary" />
          </div>
        </div>
      </div>
    );
  }

  if (editingTemplate) {
    return (
      <TicketTemplateDesigner
        template={editingTemplate}
        userId={userId}
        onBack={() => setEditingTemplate(null)}
        onSaved={acceptSaved}
      />
    );
  }

  return (
    <>
      <div className="flex flex-col gap-5 border-b border-border pb-7 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-[650px]">
          <h2 className="text-[22px] font-semibold">Ticket templates</h2>
          <p className="mt-2 text-[13px] leading-6 text-muted-foreground">
            Reusable front-and-back ticket designs. Pricing and ticket types
            are configured inside each event.
          </p>
        </div>
        <Button type="button" onClick={createTemplate}>
          <Plus className="h-4 w-4" />
          New template
        </Button>
      </div>
      <div className="mt-7 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full lg:max-w-[320px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search ticket templates..."
            className="pl-9"
            aria-label="Search ticket templates"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {["all", ...categories].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setCategory(value)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-[11px] transition",
                category === value
                  ? "border-primary bg-primary/10 font-medium text-primary"
                  : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
              )}
            >
              {value === "all" ? "All templates" : value}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-4 text-[11px] text-muted-foreground">
        {visibleTemplates.length} of {ticketTemplates.length} designs · hover a
        template to flip it to the back
      </p>

      <PaginatedCardGrid
        items={visibleTemplates}
        pageSize={12}
        itemLabel="ticket templates"
        getKey={(template) => template.id}
        resetKey={`${category}:${search}`}
        className="mt-5"
        renderItem={(template) => (
          <article
            className="group relative overflow-hidden rounded-lg border border-border bg-card transition hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-lg"
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  className="absolute right-3 top-3 z-20 h-8 w-8 shadow-xs"
                  aria-label={`${template.name} actions`}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  className="gap-3 px-3 py-2 text-[12px]"
                  onClick={() => setPreviewTemplate(template)}
                >
                  <Eye className="h-4 w-4" />
                  Preview both sides
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => openEditor(template)}>
                  <PencilLine className="h-4 w-4" />
                  Edit template
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => duplicateTemplate(template)}>
                  <Copy className="h-4 w-4" />
                  Duplicate
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="border-b border-border">
              <TicketTemplateThumb template={template} />
            </div>
            <div className="p-5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10px] font-semibold uppercase text-primary">
                  {template.category}
                </span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] uppercase text-muted-foreground">
                  {template.isSystem ? "System" : "Workspace"}
                </span>
              </div>
              <p className="mt-2 text-[15px] font-semibold">{template.name}</p>
              <p className="mt-2 min-h-10 text-[11px] leading-5 text-muted-foreground">
                {template.description}
              </p>
              <div className="mt-4 flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => setPreviewTemplate(template)}
                >
                  <Eye className="h-3.5 w-3.5" />
                  Preview
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="flex-1"
                  onClick={() => openEditor(template)}
                >
                  <Palette className="h-3.5 w-3.5" />
                  Customize
                </Button>
              </div>
            </div>
          </article>
        )}
      />

      {!visibleTemplates.length && (
        <div className="mt-6 border-y border-border py-16 text-center">
          <LayoutTemplate className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-4 text-[14px] font-semibold">
            No template matches that search
          </p>
          <p className="mx-auto mt-2 max-w-[420px] text-[12px] leading-6 text-muted-foreground">
            Clear the filters to browse every ticket design, or start a new
            template from a blank canvas.
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-6"
            onClick={() => {
              setSearch("");
              setCategory("all");
            }}
          >
            <RefreshCw className="h-4 w-4" />
            Clear filters
          </Button>
        </div>
      )}

      <Dialog
        open={Boolean(previewTemplate)}
        onOpenChange={(open) => !open && setPreviewTemplate(null)}
      >
        <DialogContent className="dashboard-scroll max-h-[92vh] max-w-[1080px] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{previewTemplate?.name}</DialogTitle>
            <DialogDescription>
              {previewTemplate?.description ||
                "Database template preview with a valid QR payload."}
            </DialogDescription>
          </DialogHeader>
          {previewTemplate && (
            <div className="py-2">
              <div className="grid gap-6 rounded-lg bg-muted/30 p-5 sm:p-8 lg:grid-cols-2">
                {(["front", "back"] as const).map((value) => (
                  <div key={value}>
                    <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {value}
                    </p>
                    <TicketTemplateCanvas
                      side={value}
                      template={previewTemplate}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                  Every issued ticket carries its own server-signed QR code.
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const template = previewTemplate;
                      setPreviewTemplate(null);
                      duplicateTemplate(template);
                    }}
                  >
                    <Copy className="h-4 w-4" />
                    Duplicate
                  </Button>
                  <Button
                    type="button"
                    onClick={() => {
                      const template = previewTemplate;
                      setPreviewTemplate(null);
                      openEditor(template);
                    }}
                  >
                    <Palette className="h-4 w-4" />
                    Customize template
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function AttendeeDialog({
  attendee,
  currency,
  eventId,
  mode,
  onComplete,
  onOpenChange,
  open,
  tickets,
  userId,
}: {
  attendee: EventAttendee | null;
  currency: string;
  eventId: string;
  mode: "issue" | "transfer";
  onComplete: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  tickets: EventTicketType[];
  userId: string;
}) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [ticketTypeId, setTicketTypeId] = useState(tickets[0]?.id || "");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setFullName(mode === "transfer" ? attendee?.fullName || "" : "");
    setEmail(mode === "transfer" ? attendee?.email || "" : "");
    setPhone(mode === "transfer" ? attendee?.phone || "" : "");
    setTicketTypeId(attendee?.ticketTypeId || tickets[0]?.id || "");
  }, [attendee, mode, open, tickets]);
  const submit = async () => {
    if (!fullName.trim() || !email.trim() || !ticketTypeId) {
      toast.error("Add the attendee name, email, and ticket type.");
      return;
    }
    setSaving(true);
    try {
      if (mode === "transfer" && attendee) {
        await transferEventTicket(userId, attendee, {
          fullName: fullName.trim(),
          email: email.trim(),
          phone: phone.trim(),
        });
        toast.success("Ticket transferred and reissued");
      } else {
        await issueComplimentaryTicket(userId, {
          eventId,
          ticketTypeId,
          fullName: fullName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          currency,
        });
        toast.success("Complimentary ticket issued");
      }
      onComplete();
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "The ticket could not be issued.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>
            {mode === "transfer" ? "Transfer ticket" : "Issue complimentary ticket"}
          </DialogTitle>
          <DialogDescription>
            {mode === "transfer"
              ? "The old code will be invalidated and a new signed ticket will be issued."
              : "Use this for speakers, press, staff, and guests who do not need to pay."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="attendee-name">Full name</Label>
            <Input
              id="attendee-name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              className="mt-2"
            />
          </div>
          <div>
            <Label htmlFor="attendee-email">Email</Label>
            <Input
              id="attendee-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-2"
            />
          </div>
          <div>
            <Label htmlFor="attendee-phone">Phone</Label>
            <Input
              id="attendee-phone"
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              className="mt-2"
            />
          </div>
          {mode === "issue" && (
            <div className="sm:col-span-2">
              <Label>Ticket type</Label>
              <Select value={ticketTypeId} onValueChange={setTicketTypeId}>
                <SelectTrigger className="mt-2">
                  <SelectValue placeholder="Choose ticket type" />
                </SelectTrigger>
                <SelectContent>
                  {tickets.map((ticket) => (
                    <SelectItem key={ticket.id} value={ticket.id}>
                      {ticket.name} ·{" "}
                      {ticket.price ? formatCurrency(ticket.price, ticket.currency) : "Free"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ticket className="h-4 w-4" />}
            {mode === "transfer" ? "Transfer & reissue" : "Issue ticket"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AttendeesPanel({
  attendees,
  currency,
  designs,
  event,
  onRefresh,
  ticketTemplates,
  tickets,
  userId,
}: {
  attendees: EventAttendee[];
  currency: string;
  designs: EventTicketDesign[];
  event: EventRecord;
  onRefresh: () => void;
  ticketTemplates: EventTicketDesignTemplate[];
  tickets: EventTicketType[];
  userId: string;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<"issue" | "transfer">("issue");
  const [selected, setSelected] = useState<EventAttendee | null>(null);
  const [ticketPreview, setTicketPreview] = useState<EventAttendee | null>(null);
  // An attendee's ticket type may carry its own design; otherwise the event's
  // shared design is used.
  const previewDesign = resolveTicketDesign(
    designs,
    ticketPreview?.ticketTypeId || null,
  );
  const designTemplate =
    ticketTemplates.find(
      (template) => template.id === previewDesign?.templateId,
    ) ||
    ticketTemplates[0] ||
    null;
  const filtered = attendees.filter(
    (attendee) =>
      (status === "all" ||
        (status === "checked_in"
          ? Boolean(attendee.checkedInAt)
          : status === "not_checked_in"
            ? !attendee.checkedInAt
            : attendee.ticketStatus === status)) &&
      `${attendee.fullName} ${attendee.email} ${attendee.ticketTypeName} ${attendee.ticketNumber}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const openIssue = () => {
    setSelected(null);
    setDialogMode("issue");
    setDialogOpen(true);
  };
  const openTransfer = (attendee: EventAttendee) => {
    setSelected(attendee);
    setDialogMode("transfer");
    setDialogOpen(true);
  };
  const voidTicket = async (attendee: EventAttendee) => {
    await voidEventTicket(userId, attendee.id, "Voided by event organizer");
    toast.success("Ticket voided");
    onRefresh();
  };
  return (
    <>
      <div className="mb-6 grid border-y border-border sm:grid-cols-3">
        {[
          ["Attendees", attendees.length],
          ["Checked in", attendees.filter((item) => item.checkedInAt).length],
          ["Valid tickets", attendees.filter((item) => item.ticketStatus === "valid").length],
        ].map(([label, value]) => (
          <div key={label} className="border-b border-border px-5 py-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
            <p className="text-[11px] text-muted-foreground">{label}</p>
            <p className="mt-2 text-[22px] font-semibold">{Number(value).toLocaleString()}</p>
          </div>
        ))}
      </div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, email, or ticket"
            className="pl-9"
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-full sm:w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All attendees</SelectItem>
            <SelectItem value="checked_in">Checked in</SelectItem>
            <SelectItem value="not_checked_in">Not checked in</SelectItem>
            <SelectItem value="valid">Valid</SelectItem>
            <SelectItem value="void">Voided</SelectItem>
            <SelectItem value="refunded">Refunded</SelectItem>
          </SelectContent>
        </Select>
        <Button type="button" onClick={openIssue} disabled={!tickets.length}>
          <Plus className="h-4 w-4" />
          Comp ticket
        </Button>
      </div>
      <div className="border-y border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Attendee</TableHead>
              <TableHead>Ticket</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Check-in</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length ? (
              filtered.map((attendee) => (
                <TableRow key={attendee.id}>
                  <TableCell>
                    <p className="font-medium">{attendee.fullName}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">{attendee.email}</p>
                  </TableCell>
                  <TableCell>
                    <p>{attendee.ticketTypeName}</p>
                    <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                      {attendee.ticketNumber}
                    </p>
                  </TableCell>
                  <TableCell>
                    <span className={cn(
                      "rounded px-2 py-1 text-[10px] font-medium",
                      attendee.ticketStatus === "valid"
                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                        : "bg-destructive/10 text-destructive",
                    )}>
                      {attendee.ticketStatus}
                    </span>
                  </TableCell>
                  <TableCell className="text-[12px] text-muted-foreground">
                    {attendee.checkedInAt
                      ? new Date(attendee.checkedInAt).toLocaleString()
                      : "Not checked in"}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" variant="ghost" size="icon" aria-label="Attendee actions">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          disabled={
                            (!attendee.ticketCode && !attendee.ticketNumber) ||
                            !designs.length
                          }
                          onClick={() => setTicketPreview(attendee)}
                        >
                          <QrCode className="h-4 w-4" />
                          View secure ticket
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={attendee.ticketStatus !== "valid"}
                          onClick={() => openTransfer(attendee)}
                        >
                          <ArrowLeftRight className="h-4 w-4" />
                          Transfer ticket
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={attendee.ticketStatus !== "valid"}
                          className="text-destructive focus:text-destructive"
                          onClick={() => void voidTicket(attendee)}
                        >
                          <XCircle className="h-4 w-4" />
                          Void ticket
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                  {attendees.length
                    ? "No attendees match these filters."
                    : "No tickets have been issued yet."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <AttendeeDialog
        attendee={selected}
        currency={currency}
        eventId={event.id}
        mode={dialogMode}
        onComplete={onRefresh}
        onOpenChange={setDialogOpen}
        open={dialogOpen}
        tickets={tickets}
        userId={userId}
      />
      <Dialog
        open={Boolean(ticketPreview)}
        onOpenChange={(open) => !open && setTicketPreview(null)}
      >
        <DialogContent className="max-w-[860px]">
          <DialogHeader>
            <DialogTitle>Issued ticket</DialogTitle>
            <DialogDescription>
              This QR contains the attendee's server-signed ticket code and is
              ready for the event scanner.
            </DialogDescription>
          </DialogHeader>
          {ticketPreview && previewDesign && (
            <div className="bg-muted/30 p-5 sm:p-10">
              <TicketPreview
                attendeeEmail={ticketPreview.email}
                attendeeName={ticketPreview.fullName}
                codeValue={
                  ticketPreview.ticketCode || ticketPreview.ticketNumber
                }
                design={previewDesign}
                event={event}
                orderCode={ticketPreview.orderId || ""}
                ticketPrice={
                  tickets.find(
                    (ticket) => ticket.id === ticketPreview.ticketTypeId,
                  )?.price ?? 0
                }
                side="front"
                template={designTemplate}
                ticketNumber={ticketPreview.ticketNumber}
                ticketTypeName={ticketPreview.ticketTypeName}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

type ScanResult = {
  result: string;
  message: string;
  attendeeName?: string;
  ticketTypeName?: string;
  ticketNumber?: string;
  checkedInAt?: string;
};

function CheckinPanel({
  attendees,
  event,
  onRefresh,
  scans,
}: {
  attendees: EventAttendee[];
  event: EventRecord;
  onRefresh: () => void;
  scans: Array<{
    id: string;
    attendeeName: string;
    result: string;
    scannedAt: string;
    station: string;
  }>;
}) {
  const [code, setCode] = useState("");
  const [station, setStation] = useState("Main entrance");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [manualSearch, setManualSearch] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const scan = useCallback(
    async (input: { ticketCode?: string; attendeeId?: string; overrideReason?: string }) => {
      setScanning(true);
      try {
        const response = (await checkInEventTicket({
          eventId: event.id,
          station,
          ...input,
        })) as ScanResult;
        setResult(response);
        if (response.result === "valid" || response.result === "manual_override") {
          toast.success(response.message);
        }
        setCode("");
        onRefresh();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "The ticket could not be checked in.",
        );
      } finally {
        setScanning(false);
      }
    },
    [event.id, onRefresh, station],
  );

  const stopCamera = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOn(false);
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  const startCamera = async () => {
    const BarcodeDetectorConstructor = (
      window as unknown as {
        BarcodeDetector?: new (input: { formats: string[] }) => {
          detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue: string }>>;
        };
      }
    ).BarcodeDetector;
    if (!BarcodeDetectorConstructor) {
      toast.error("Camera scanning is not supported in this browser. Use manual code entry.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      const detector = new BarcodeDetectorConstructor({
        formats: ["qr_code", "code_128"],
      });
      setCameraOn(true);
      timerRef.current = setInterval(() => {
        const video = videoRef.current;
        if (!video || video.readyState < 2) return;
        void detector.detect(video).then((codes) => {
          const value = codes[0]?.rawValue;
          if (!value) return;
          stopCamera();
          void scan({ ticketCode: value });
        });
      }, 500);
    } catch {
      toast.error("Camera access was not available. Check browser permissions.");
      stopCamera();
    }
  };

  const matchingAttendees = manualSearch.trim()
    ? attendees
        .filter((attendee) =>
          `${attendee.fullName} ${attendee.email}`
            .toLowerCase()
            .includes(manualSearch.toLowerCase()),
        )
        .slice(0, 6)
    : [];
  const arrived = attendees.filter((attendee) => attendee.checkedInAt).length;
  const rate = attendees.length ? Math.round((arrived / attendees.length) * 100) : 0;
  return (
    <div className="grid gap-7 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div>
        <div className="grid border-y border-border sm:grid-cols-3">
          {[
            ["Arrived", arrived],
            ["Expected", attendees.filter((item) => item.ticketStatus === "valid").length],
            ["Check-in rate", `${rate}%`],
          ].map(([label, value]) => (
            <div key={label} className="border-b border-border px-5 py-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
              <p className="text-[11px] text-muted-foreground">{label}</p>
              <p className="mt-2 text-[22px] font-semibold">{String(value)}</p>
            </div>
          ))}
        </div>
        <div className="mt-7 grid gap-5 sm:grid-cols-2">
          <section className="rounded-md border border-border p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-[15px] font-semibold">Camera scanner</h2>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  QR and Code 128
                </p>
              </div>
              <Camera className="h-5 w-5 text-primary" />
            </div>
            <div className="relative mt-5 aspect-video overflow-hidden rounded-md bg-zinc-950">
              <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
              {!cameraOn && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-400">
                  <QrCode className="h-9 w-9" />
                  <p className="mt-3 text-[11px]">Camera is off</p>
                </div>
              )}
              {cameraOn && (
                <div className="pointer-events-none absolute inset-[18%] border-2 border-white/70" />
              )}
            </div>
            <Button
              type="button"
              className="mt-4 w-full"
              variant={cameraOn ? "outline" : "default"}
              onClick={() => (cameraOn ? stopCamera() : void startCamera())}
            >
              <Camera className="h-4 w-4" />
              {cameraOn ? "Stop camera" : "Start camera"}
            </Button>
          </section>
          <section className="rounded-md border border-border p-5">
            <h2 className="text-[15px] font-semibold">Code entry</h2>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Enter a ticket number or scan the QR with a handheld scanner.
            </p>
          <div className="mt-5">
              <Label htmlFor="scan-station">Station</Label>
              <Input
                id="scan-station"
                value={station}
                onChange={(event) => setStation(event.target.value)}
                className="mt-2"
              />
            </div>
            <div className="mt-4">
              <Label htmlFor="scan-code">Ticket number or QR code</Label>
              <Textarea
                id="scan-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                className="mt-2 min-h-[84px] font-mono text-[11px]"
                placeholder="TKT-... or mfe1..."
              />
            </div>
            <Button
              type="button"
              className="mt-4 w-full"
              disabled={!code.trim() || scanning}
              onClick={() => void scan({ ticketCode: code.trim() })}
            >
              {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Validate & check in
            </Button>
          </section>
        </div>
        {result && (
          <div
            className={cn(
              "mt-5 flex items-start gap-4 border p-5",
              result.result === "valid" || result.result === "manual_override"
                ? "border-emerald-500/30 bg-emerald-500/5"
                : "border-destructive/30 bg-destructive/5",
            )}
          >
            {result.result === "valid" || result.result === "manual_override" ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" />
            ) : (
              <XCircle className="mt-0.5 h-5 w-5 text-destructive" />
            )}
            <div>
              <p className="text-[14px] font-semibold">{result.message}</p>
              {result.ticketTypeName && (
                <p className="mt-1 text-[12px] text-muted-foreground">
                  {result.ticketTypeName}
                </p>
              )}
              {result.ticketNumber && (
                <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                  {result.ticketNumber}
                </p>
              )}
            </div>
          </div>
        )}
        <section className="mt-8">
          <h2 className="text-[15px] font-semibold">Manual attendee search</h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Uses the same duplicate and ticket-status validation.
          </p>
          <div className="relative mt-4">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={manualSearch}
              onChange={(event) => setManualSearch(event.target.value)}
              placeholder="Search name or email"
              className="pl-9"
            />
          </div>
          {matchingAttendees.length > 0 && (
            <div className="mt-2 divide-y divide-border border-y border-border">
              {matchingAttendees.map((attendee) => (
                <div key={attendee.id} className="flex items-center justify-between gap-4 py-3">
                  <div>
                    <p className="text-[13px] font-medium">{attendee.fullName}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {attendee.email} · {attendee.ticketTypeName}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void scan({ attendeeId: attendee.id })}
                    disabled={scanning}
                  >
                    Check in
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      <aside>
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div>
            <h2 className="text-[15px] font-semibold">Live scan log</h2>
            <p className="mt-1 text-[11px] text-muted-foreground">Latest 250 scans</p>
          </div>
          <Activity className="h-4 w-4 text-primary" />
        </div>
        <div className="divide-y divide-border">
          {scans.length ? (
            scans.slice(0, 20).map((scan) => (
              <div key={scan.id} className="py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate text-[12px] font-medium">
                    {scan.attendeeName || "Unknown ticket"}
                  </p>
                  <span className={cn(
                    "rounded px-1.5 py-0.5 text-[9px]",
                    scan.result === "valid" || scan.result === "manual_override"
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      : "bg-destructive/10 text-destructive",
                  )}>
                    {scan.result.replace("_", " ")}
                  </span>
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {new Date(scan.scannedAt).toLocaleTimeString()} · {scan.station}
                </p>
              </div>
            ))
          ) : (
            <p className="py-10 text-center text-[12px] text-muted-foreground">
              Scans will appear here in real time.
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}

function WorkspaceCheckinPanel({
  events,
  onRefresh,
  userId,
}: {
  events: EventRecord[];
  onRefresh: () => void;
  userId: string;
}) {
  const ticketedEvents = useMemo(
    () => events.filter((event) => event.ticketingEnabled || event.attendeeCount > 0),
    [events],
  );
  const [link, setLink] = useState<WorkspaceTicketValidatorLink | null>(null);
  const [linkLoading, setLinkLoading] = useState(true);
  const [rotating, setRotating] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [code, setCode] = useState("");
  const [station, setStation] = useState("Main entrance");
  const [result, setResult] = useState<TicketValidationResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [checkedInPage, setCheckedInPage] = useState<EventCheckedInPage>({
    items: [],
    page: 1,
    pageSize: 10,
    total: 0,
  });
  const [page, setPage] = useState(1);
  const [attendeesLoading, setAttendeesLoading] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let active = true;
    setLinkLoading(true);
    void getWorkspaceTicketValidatorLink()
      .then((value) => {
        if (active) setLink(value);
      })
      .catch((error) => {
        if (active) {
          toast.error(
            error instanceof Error
              ? error.message
              : "The validator link could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (active) setLinkLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (selectedEventId && ticketedEvents.some((event) => event.id === selectedEventId)) {
      return;
    }
    setSelectedEventId(ticketedEvents[0]?.id || "");
    setPage(1);
  }, [selectedEventId, ticketedEvents]);

  useEffect(() => {
    if (!selectedEventId) {
      setCheckedInPage({ items: [], page: 1, pageSize: 10, total: 0 });
      return;
    }
    let active = true;
    setAttendeesLoading(true);
    void listCheckedInAttendees(userId, selectedEventId, page, 10)
      .then((value) => {
        if (active) setCheckedInPage(value);
      })
      .catch(() => {
        if (active) toast.error("Checked-in attendees could not be loaded.");
      })
      .finally(() => {
        if (active) setAttendeesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [page, refreshVersion, selectedEventId, userId]);

  const stopCamera = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOn(false);
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  const scan = useCallback(
    async (ticketCode: string) => {
      const normalized = ticketCode.trim();
      if (!normalized || scanning) return;
      setScanning(true);
      setResult(null);
      try {
        const response = await checkInEventTicket({
          station: station.trim() || "Main entrance",
          ticketCode: normalized,
        });
        setResult(response);
        setCode("");
        if (response.result === "valid" || response.result === "manual_override") {
          toast.success(response.message);
          if (response.eventId) {
            setSelectedEventId(response.eventId);
            setPage(1);
          }
          setRefreshVersion((value) => value + 1);
          onRefresh();
        } else {
          toast.error(response.message);
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "The ticket could not be checked in.";
        setResult({ result: "invalid_signature", message });
        toast.error(message);
      } finally {
        setScanning(false);
      }
    },
    [onRefresh, scanning, station],
  );

  const startCamera = async () => {
    const BarcodeDetectorConstructor = (
      window as unknown as {
        BarcodeDetector?: new (input: { formats: string[] }) => {
          detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue: string }>>;
        };
      }
    ).BarcodeDetector;
    if (!BarcodeDetectorConstructor) {
      toast.error("Camera scanning is not supported in this browser. Use manual code entry.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      const detector = new BarcodeDetectorConstructor({
        formats: ["qr_code", "code_128"],
      });
      setCameraOn(true);
      timerRef.current = setInterval(() => {
        const video = videoRef.current;
        if (!video || video.readyState < 2) return;
        void detector.detect(video).then((codes) => {
          const value = codes[0]?.rawValue;
          if (!value) return;
          stopCamera();
          void scan(value);
        });
      }, 500);
    } catch {
      toast.error("Camera access was not available. Check browser permissions.");
      stopCamera();
    }
  };

  const validatorUrl =
    link && typeof window !== "undefined"
      ? `${window.location.origin}${link.path}`
      : "";
  const selectedEvent = ticketedEvents.find((event) => event.id === selectedEventId);
  const totalExpected = ticketedEvents.reduce((sum, event) => sum + event.attendeeCount, 0);
  const totalArrived = ticketedEvents.reduce((sum, event) => sum + event.checkedInCount, 0);
  const accepted = result?.result === "valid" || result?.result === "manual_override";
  const totalPages = Math.max(1, Math.ceil(checkedInPage.total / checkedInPage.pageSize));

  const rotateLink = async () => {
    setRotating(true);
    try {
      const next = await rotateWorkspaceTicketValidatorLink();
      setLink(next);
      setRotateOpen(false);
      toast.success("A new validator link is active. The previous link has been revoked.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "The validator link could not be rotated.",
      );
    } finally {
      setRotating(false);
    }
  };

  return (
    <div className="space-y-9">
      <section className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-5 sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-[12px] font-semibold text-amber-700 dark:text-amber-400">
              <LockKeyhole className="h-4 w-4" />
              Private validator link
            </div>
            <h2 className="mt-3 text-[18px] font-semibold">Check in without a dashboard login</h2>
            <p className="mt-2 text-[12px] leading-6 text-muted-foreground">
              Open this URL on authorized check-in devices. Anyone with the link can validate tickets for this workspace, so do not share it with attendees or third parties.
            </p>
          </div>
          <Button type="button" variant="outline" onClick={() => setRotateOpen(true)} disabled={!link || rotating}>
            <RefreshCw className="h-4 w-4" />
            Rotate link
          </Button>
        </div>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <Input
            readOnly
            value={linkLoading ? "Creating secure validator link..." : validatorUrl}
            className="min-w-0 font-mono text-[11px]"
            aria-label="Workspace ticket validator URL"
          />
          <Button
            type="button"
            variant="outline"
            disabled={!validatorUrl}
            onClick={() => {
              void navigator.clipboard.writeText(validatorUrl);
              toast.success("Validator URL copied");
            }}
          >
            <Copy className="h-4 w-4" />
            Copy
          </Button>
          <Button type="button" variant="outline" disabled={!validatorUrl} asChild={Boolean(validatorUrl)}>
            {validatorUrl ? (
              <a href={validatorUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" />
                Open
              </a>
            ) : (
              <span><ExternalLink className="h-4 w-4" />Open</span>
            )}
          </Button>
        </div>
      </section>

      <section>
        <div className="grid border-y border-border sm:grid-cols-3">
          {[
            ["Checked in", totalArrived],
            ["Valid attendees", totalExpected],
            ["Workspace events", ticketedEvents.length],
          ].map(([label, value]) => (
            <div key={label} className="border-b border-border px-5 py-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0">
              <p className="text-[11px] text-muted-foreground">{label}</p>
              <p className="mt-2 text-[22px] font-semibold">{value}</p>
            </div>
          ))}
        </div>
        <div className="mt-7 grid gap-5 lg:grid-cols-2">
          <div className="rounded-lg border border-border p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-[15px] font-semibold">Camera scanner</h2>
                <p className="mt-1 text-[11px] text-muted-foreground">QR and Code 128</p>
              </div>
              <Camera className="h-5 w-5 text-primary" />
            </div>
            <div className="relative mt-5 aspect-video overflow-hidden rounded-md bg-zinc-950">
              <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
              {!cameraOn && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-400">
                  <QrCode className="h-9 w-9" />
                  <p className="mt-3 text-[11px]">Camera is off</p>
                </div>
              )}
              {cameraOn && <div className="pointer-events-none absolute inset-[18%] rounded-md border-2 border-white/70" />}
            </div>
            <Button type="button" className="mt-4 w-full" variant={cameraOn ? "outline" : "default"} onClick={() => (cameraOn ? stopCamera() : void startCamera())}>
              <Camera className="h-4 w-4" />
              {cameraOn ? "Stop camera" : "Start camera"}
            </Button>
          </div>
          <form
            className="rounded-lg border border-border p-5"
            onSubmit={(event) => {
              event.preventDefault();
              void scan(code);
            }}
          >
            <h2 className="text-[15px] font-semibold">Validate ticket</h2>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
              Unknown or invalid ticket numbers are rejected and never written to check-in history.
            </p>
            <div className="mt-5">
              <Label htmlFor="workspace-scan-station">Station</Label>
              <Input id="workspace-scan-station" value={station} onChange={(event) => setStation(event.target.value)} className="mt-2" maxLength={80} />
            </div>
            <div className="mt-4">
              <Label htmlFor="workspace-scan-code">Ticket number or QR code</Label>
              <Textarea id="workspace-scan-code" value={code} onChange={(event) => setCode(event.target.value)} className="mt-2 min-h-[88px] font-mono text-[11px]" placeholder="TKT-... or mfe1..." />
            </div>
            <Button type="submit" className="mt-4 w-full" disabled={!code.trim() || scanning}>
              {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              {scanning ? "Validating" : "Validate and check in"}
            </Button>
          </form>
        </div>
        {result && (
          <div className={cn("mt-5 flex items-start gap-4 rounded-md border p-5", accepted ? "border-emerald-500/30 bg-emerald-500/5" : "border-destructive/30 bg-destructive/5")} aria-live="polite">
            {accepted ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" /> : <XCircle className="mt-0.5 h-5 w-5 text-destructive" />}
            <div className="min-w-0">
              <p className="text-[14px] font-semibold">{result.message}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {[result.attendeeName, result.eventTitle, result.ticketTypeName, result.ticketNumber].filter(Boolean).join(" · ")}
              </p>
            </div>
          </div>
        )}
      </section>

      <section>
        <div>
          <p className="text-[11px] font-semibold uppercase text-primary">Arrival records</p>
          <h2 className="mt-2 text-[22px] font-semibold">Check-ins by event</h2>
          <p className="mt-2 text-[12px] text-muted-foreground">Choose an event to review its checked-in attendees.</p>
        </div>
        {ticketedEvents.length ? (
          <PaginatedCardGrid
            items={ticketedEvents}
            pageSize={12}
            itemLabel="ticketed events"
            getKey={(event) => event.id}
            renderItem={(event) => {
              const active = event.id === selectedEventId;
              const rate = event.attendeeCount ? Math.round((event.checkedInCount / event.attendeeCount) * 100) : 0;
              return (
                <button
                  type="button"
                  onClick={() => { setSelectedEventId(event.id); setPage(1); }}
                  className={cn("rounded-lg border p-4 text-left transition", active ? "border-primary bg-primary/5" : "border-border hover:border-foreground/25")}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-semibold">{event.title}</p>
                      <p className="mt-1 text-[10px] text-muted-foreground">{event.eventDate ? new Date(`${event.eventDate}T00:00:00`).toLocaleDateString() : "Date not set"}</p>
                    </div>
                    <span className="rounded bg-muted px-2 py-1 text-[10px] font-medium">{rate}%</span>
                  </div>
                  <p className="mt-5 text-[24px] font-semibold">{event.checkedInCount}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground">of {event.attendeeCount} valid attendees checked in</p>
                </button>
              );
            }}
          />
        ) : (
          <div className="mt-5 rounded-lg border border-dashed border-border px-5 py-12 text-center text-[12px] text-muted-foreground">
            Ticketed events will appear here after tickets are issued.
          </div>
        )}

        {selectedEvent && (
          <div className="mt-7 overflow-hidden rounded-lg border border-border">
            <div className="flex flex-col gap-2 border-b border-border px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-[14px] font-semibold">{selectedEvent.title}</h3>
                <p className="mt-1 text-[10px] text-muted-foreground">{checkedInPage.total} checked-in attendee{checkedInPage.total === 1 ? "" : "s"}</p>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={() => setRefreshVersion((value) => value + 1)} disabled={attendeesLoading}>
                <RefreshCw className={cn("h-3.5 w-3.5", attendeesLoading && "animate-spin")} />
                Refresh
              </Button>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Attendee</TableHead>
                    <TableHead>Ticket</TableHead>
                    <TableHead>Ticket number</TableHead>
                    <TableHead>Checked in</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {attendeesLoading ? (
                    <TableRow><TableCell colSpan={4} className="h-28 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-primary" /></TableCell></TableRow>
                  ) : checkedInPage.items.length ? (
                    checkedInPage.items.map((attendee) => (
                      <TableRow key={attendee.id}>
                        <TableCell><p className="text-[12px] font-medium">{attendee.fullName}</p><p className="mt-1 text-[10px] text-muted-foreground">{attendee.email}</p></TableCell>
                        <TableCell className="text-[11px]">{attendee.ticketTypeName}</TableCell>
                        <TableCell className="font-mono text-[10px]">{attendee.ticketNumber}</TableCell>
                        <TableCell className="text-[11px]">{attendee.checkedInAt ? new Date(attendee.checkedInAt).toLocaleString() : "Not checked in"}</TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow><TableCell colSpan={4} className="h-28 text-center text-[12px] text-muted-foreground">No attendees have checked in yet.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            <div className="flex items-center justify-between border-t border-border px-5 py-3">
              <p className="text-[10px] text-muted-foreground">Page {checkedInPage.page} of {totalPages} · 10 per page</p>
              <div className="flex gap-2">
                <Button type="button" size="icon" variant="outline" disabled={page <= 1 || attendeesLoading} onClick={() => setPage((value) => Math.max(1, value - 1))} aria-label="Previous attendees page"><ChevronLeft className="h-4 w-4" /></Button>
                <Button type="button" size="icon" variant="outline" disabled={page >= totalPages || attendeesLoading} onClick={() => setPage((value) => Math.min(totalPages, value + 1))} aria-label="Next attendees page"><ChevronRight className="h-4 w-4" /></Button>
              </div>
            </div>
          </div>
        )}
      </section>

      <Dialog open={rotateOpen} onOpenChange={(open) => !rotating && setRotateOpen(open)}>
        <DialogContent className="max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Rotate validator link?</DialogTitle>
            <DialogDescription>
              The current public URL will stop working immediately. Authorized check-in devices must use the new link.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRotateOpen(false)} disabled={rotating}>Cancel</Button>
            <Button type="button" onClick={() => void rotateLink()} disabled={rotating}>
              {rotating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Rotate and revoke old link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AnalyticsPanel({
  attendees,
  currency,
  event,
  tickets,
}: {
  attendees: EventAttendee[];
  currency: string;
  event: EventRecord;
  tickets: EventTicketType[];
}) {
  const ticketData = tickets.map((ticket) => ({
    name: ticket.name,
    issued: ticket.soldCount,
    remaining: Math.max(0, ticket.quantityAvailable - ticket.soldCount),
    revenue: ticket.soldCount * ticket.price,
    color: ticket.color,
  }));
  const dailyMap = new Map<string, number>();
  attendees.forEach((attendee) => {
    const day = new Date(attendee.createdAt).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    dailyMap.set(day, (dailyMap.get(day) || 0) + 1);
  });
  const salesData = Array.from(dailyMap, ([date, ticketsIssued]) => ({
    date,
    ticketsIssued,
  }));
  const checkedIn = attendees.filter((attendee) => attendee.checkedInAt).length;
  const attendanceData = [
    { name: "Checked in", value: checkedIn, color: "#10B981" },
    { name: "Not arrived", value: Math.max(0, attendees.length - checkedIn), color: "#E5E7EB" },
  ];
  return (
    <div className="space-y-8">
      <div className="grid border-y border-border sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Tickets issued", event.attendeeCount.toLocaleString()],
          ["Revenue", formatCurrency(event.revenue, currency)],
          ["Check-in rate", `${event.attendeeCount ? Math.round((event.checkedInCount / event.attendeeCount) * 100) : 0}%`],
          ["Capacity used", `${event.capacityTotal ? Math.round((event.attendeeCount / event.capacityTotal) * 100) : 0}%`],
        ].map(([label, value]) => (
          <div key={label} className="border-b border-border px-5 py-5 last:border-b-0 sm:border-r sm:nth-2:border-r-0 xl:border-b-0 xl:nth-2:border-r xl:last:border-r-0">
            <p className="text-[11px] text-muted-foreground">{label}</p>
            <p className="mt-3 text-[22px] font-semibold">{value}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,1fr)]">
        <section>
          <h2 className="text-[15px] font-semibold">Ticket activity</h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Tickets issued from live database records.
          </p>
          <div className="mt-4 h-[280px] border-y border-border py-5">
            {salesData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={salesData}>
                  <defs>
                    <linearGradient id="eventArea" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.28} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={11} />
                  <YAxis tickLine={false} axisLine={false} allowDecimals={false} fontSize={11} />
                  <ChartTooltip />
                  <Area type="monotone" dataKey="ticketsIssued" stroke="hsl(var(--primary))" fill="url(#eventArea)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
                Ticket activity appears after the first registration.
              </div>
            )}
          </div>
        </section>
        <section>
          <h2 className="text-[15px] font-semibold">Attendance</h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Live arrival status.
          </p>
          <div className="mt-4 h-[280px] border-y border-border py-5">
            {attendees.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={attendanceData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={62}
                    outerRadius={90}
                    paddingAngle={2}
                  >
                    {attendanceData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <ChartTooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
                No attendees yet.
              </div>
            )}
          </div>
        </section>
      </div>
      <section>
        <h2 className="text-[15px] font-semibold">Sales by ticket type</h2>
        <div className="mt-4 h-[280px] border-y border-border py-5">
          {ticketData.some((item) => item.issued) ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ticketData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={11} />
                <YAxis tickLine={false} axisLine={false} allowDecimals={false} fontSize={11} />
                <ChartTooltip
                  formatter={(value: number, name: string) =>
                    name === "revenue"
                      ? [formatCurrency(Number(value), currency), "Revenue"]
                      : [Number(value).toLocaleString(), "Registrations"]
                  }
                />
                <Bar dataKey="issued" radius={[4, 4, 0, 0]}>
                  {ticketData.map((entry) => (
                    <Cell key={entry.name} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
              Ticket type performance appears after sales begin.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function EventModuleAnalytics({
  currency,
  events,
}: {
  currency: string;
  events: EventRecord[];
}) {
  const sortedEvents = [...events].sort(
    (left, right) =>
      new Date(
        left.scheduleType === "single_day"
          ? left.eventDate || left.createdAt
          : left.rangeStartDate || left.createdAt,
      ).getTime() -
      new Date(
        right.scheduleType === "single_day"
          ? right.eventDate || right.createdAt
          : right.rangeStartDate || right.createdAt,
      ).getTime(),
  );
  const activityData = sortedEvents.slice(-10).map((event) => ({
    name:
      event.title.length > 18
        ? `${event.title.slice(0, 18)}...`
        : event.title,
    registrations: event.attendeeCount,
    checkins: event.checkedInCount,
  }));
  const performanceData = sortedEvents.slice(-12).map((event) => ({
    name:
      event.title.length > 14
        ? `${event.title.slice(0, 14)}...`
        : event.title,
    registrations: event.attendeeCount,
    revenue: event.revenue,
  }));
  const statusColors: Record<EventRecord["status"], string> = {
    draft: "#94A3B8",
    published: "#2563EB",
    on_sale: "#10B981",
    sold_out: "#F59E0B",
    past: "#64748B",
    cancelled: "#EF4444",
  };
  const statusData = (
    [
      "draft",
      "published",
      "on_sale",
      "sold_out",
      "past",
      "cancelled",
    ] as EventRecord["status"][]
  )
    .map((status) => ({
      name: statusLabel(status),
      value: events.filter((event) => event.status === status).length,
      color: statusColors[status],
    }))
    .filter((item) => item.value > 0);
  const totalRegistrations = events.reduce(
    (sum, event) => sum + event.attendeeCount,
    0,
  );
  const totalCheckins = events.reduce(
    (sum, event) => sum + event.checkedInCount,
    0,
  );
  const totalRevenue = events.reduce(
    (sum, event) => sum + event.revenue,
    0,
  );
  const checkinRate = totalRegistrations
    ? Math.round((totalCheckins / totalRegistrations) * 100)
    : 0;
  return (
    <div className="space-y-10">
      <EventMetrics events={events} currency={currency} />
      <div className="grid gap-10 xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,0.8fr)]">
        <section>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-[17px] font-semibold">
                Registration & arrival
              </h2>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Event-level registrations compared with successful check-ins.
              </p>
            </div>
            <span className="text-[11px] text-muted-foreground">
              {checkinRate}% overall arrival rate
            </span>
          </div>
          <div className="mt-5 h-[330px] border-y border-border py-6">
            {activityData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={activityData} barGap={4}>
                  <CartesianGrid
                    stroke="hsl(var(--border))"
                    strokeDasharray="3 3"
                    vertical={false}
                  />
                  <XAxis
                    axisLine={false}
                    dataKey="name"
                    fontSize={10}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    axisLine={false}
                    fontSize={10}
                    tickLine={false}
                  />
                  <ChartTooltip />
                  <Bar
                    dataKey="registrations"
                    fill="hsl(var(--primary))"
                    isAnimationActive={false}
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="checkins"
                    fill="#10B981"
                    isAnimationActive={false}
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-center">
                <div>
                  <BarChart3 className="mx-auto h-5 w-5 text-muted-foreground" />
                  <p className="mt-3 text-[13px] font-medium">
                    Event analytics will appear here
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    This screen remains available before your first event.
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>

        <section>
          <h2 className="text-[17px] font-semibold">Event portfolio</h2>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Current lifecycle status across the workspace.
          </p>
          <div className="mt-5 min-h-[330px] border-y border-border py-6">
            {statusData.length ? (
              <>
                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={statusData}
                        dataKey="value"
                        isAnimationActive={false}
                        nameKey="name"
                        innerRadius={60}
                        outerRadius={88}
                        paddingAngle={3}
                      >
                        {statusData.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Pie>
                      <ChartTooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  {statusData.map((item) => (
                    <div
                      key={item.name}
                      className="flex items-center justify-between gap-3 text-[11px]"
                    >
                      <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: item.color }}
                        />
                        <span className="truncate">{item.name}</span>
                      </span>
                      <span className="font-medium">{item.value}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex min-h-[270px] items-center justify-center text-[12px] text-muted-foreground">
                No events to summarize yet.
              </div>
            )}
          </div>
        </section>
      </div>

      <section>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[17px] font-semibold">
              Revenue & registration performance
            </h2>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Workspace currency revenue alongside event demand.
            </p>
          </div>
          <p className="text-[13px] font-semibold">
            {formatCurrency(totalRevenue, currency)}
          </p>
        </div>
        <div className="mt-5 h-[330px] border-y border-border py-6">
          {performanceData.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={performanceData}>
                <defs>
                  <linearGradient
                    id="workspaceEventRevenue"
                    x1="0"
                    x2="0"
                    y1="0"
                    y2="1"
                  >
                    <stop
                      offset="5%"
                      stopColor="hsl(var(--primary))"
                      stopOpacity={0.28}
                    />
                    <stop
                      offset="95%"
                      stopColor="hsl(var(--primary))"
                      stopOpacity={0}
                    />
                  </linearGradient>
                  <linearGradient
                    id="workspaceEventDemand"
                    x1="0"
                    x2="0"
                    y1="0"
                    y2="1"
                  >
                    <stop offset="5%" stopColor="#10B981" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  stroke="hsl(var(--border))"
                  strokeDasharray="3 3"
                  vertical={false}
                />
                <XAxis
                  axisLine={false}
                  dataKey="name"
                  fontSize={10}
                  tickLine={false}
                />
                <YAxis
                  axisLine={false}
                  fontSize={10}
                  tickFormatter={(value) =>
                    Intl.NumberFormat(undefined, {
                      notation: "compact",
                    }).format(Number(value))
                  }
                  tickLine={false}
                />
                <ChartTooltip />
                <Area
                  dataKey="revenue"
                  fill="url(#workspaceEventRevenue)"
                  isAnimationActive={false}
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  type="monotone"
                />
                <Area
                  dataKey="registrations"
                  fill="url(#workspaceEventDemand)"
                  isAnimationActive={false}
                  stroke="#10B981"
                  strokeWidth={2}
                  type="monotone"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground">
              Revenue and registration trends appear after events are created.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function EventPricingOverview({
  currency,
  events,
  onOpenEvent,
}: {
  currency: string;
  events: EventRecord[];
  onOpenEvent: (event: EventRecord) => void;
}) {
  const pricedEvents = events.filter(
    (event) => event.ticketingEnabled || event.pricing.enabled,
  );
  const configuredEvents = pricedEvents.filter(
    (event) =>
      (event.ticketingEnabled && event.ticketTypeCount > 0) ||
      (!event.ticketingEnabled &&
        event.pricing.enabled &&
        event.pricing.amount > 0),
  );
  const paidEvents = pricedEvents.filter((event) => event.revenue > 0);
  const metrics = [
    {
      label: "Priced events",
      value: pricedEvents.length.toLocaleString(),
      icon: Ticket,
    },
    {
      label: "Pricing configured",
      value: configuredEvents.length.toLocaleString(),
      icon: SlidersHorizontal,
    },
    {
      label: "Ticket revenue",
      value: formatCurrency(
        paidEvents.reduce((sum, event) => sum + event.revenue, 0),
        currency,
      ),
      icon: CircleDollarSign,
    },
  ];

  return (
    <div className="space-y-9">
      <header>
        <h2 className="text-[20px] font-semibold">Event pricing</h2>
        <p className="mt-2 max-w-[620px] text-[13px] leading-6 text-muted-foreground">
          Manage ticket types and prices inside each event. Payment setup will
          be added here when the payment module is ready.
        </p>
      </header>

      <div className="grid border-y border-border sm:grid-cols-3">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <div
              key={metric.label}
              className="border-b border-border px-5 py-5 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0"
            >
              <div className="flex items-center gap-2 text-muted-foreground">
                <Icon className="h-4 w-4" />
                <span className="text-[12px]">{metric.label}</span>
              </div>
              <p className="mt-3 text-[24px] font-semibold">{metric.value}</p>
            </div>
          );
        })}
      </div>

      <section>
        <div className="flex items-end justify-between gap-4 border-b border-border pb-3">
          <div>
            <h3 className="text-[15px] font-semibold">Pricing by event</h3>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Ticket types remain private to the event where they were created.
            </p>
          </div>
          <span className="text-[11px] text-muted-foreground">
            {pricedEvents.length} priced{" "}
            {pricedEvents.length === 1 ? "event" : "events"}
          </span>
        </div>

        {pricedEvents.length ? (
          <div className="divide-y divide-border">
            {pricedEvents.map((event) => (
              <div
                key={event.id}
                className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Ticket className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-semibold">
                      {event.title}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {event.ticketingEnabled
                        ? event.ticketTypeCount
                          ? `${event.ticketTypeCount} ticket ${
                              event.ticketTypeCount === 1 ? "type" : "types"
                            } / Prefix ${event.ticketPrefix}`
                          : "Ticket pricing not configured"
                        : `${event.pricing.label} / ${formatCurrency(
                            event.pricing.amount,
                            event.pricing.currency || currency,
                          )}`}
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onOpenEvent(event)}
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  {(event.ticketingEnabled && event.ticketTypeCount) ||
                  (!event.ticketingEnabled && event.pricing.amount > 0)
                    ? "Manage pricing"
                    : "Set pricing"}
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex min-h-[260px] flex-col items-center justify-center border-b border-border px-6 text-center">
            <CircleDollarSign className="h-6 w-6 text-muted-foreground" />
            <p className="mt-4 text-[14px] font-semibold">
            No event pricing yet
            </p>
            <p className="mt-1 max-w-[430px] text-[12px] leading-5 text-muted-foreground">
              Add ticket prices or enable paid registration inside an event.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function EventModuleSettings({
  onChange,
  onSave,
  preferences,
  saveState,
}: {
  onChange: (preferences: EventModulePreferences) => void;
  onSave: () => void;
  preferences: EventModulePreferences;
  saveState: SaveState;
}) {
  const update = <Key extends keyof EventModulePreferences>(
    key: Key,
    value: EventModulePreferences[Key],
  ) => onChange({ ...preferences, [key]: value });
  return (
    <div className="max-w-[860px] space-y-10">
      <section>
        <div className="border-b border-border pb-3">
          <h2 className="text-[17px] font-semibold">Organizer identity</h2>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Used as the default sender and support identity for every event.
          </p>
        </div>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <div>
            <Label htmlFor="event-organizer-name">Organizer name</Label>
            <Input
              id="event-organizer-name"
              value={preferences.organizerName}
              onChange={(input) =>
                update("organizerName", input.target.value)
              }
              className="mt-2"
              placeholder="MaxForm Events"
            />
          </div>
          <div>
            <Label htmlFor="event-reply-email">Reply-to email</Label>
            <Input
              id="event-reply-email"
              type="email"
              value={preferences.replyToEmail}
              onChange={(input) =>
                update("replyToEmail", input.target.value)
              }
              className="mt-2"
              placeholder="events@example.com"
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="event-support-email">Attendee support email</Label>
            <Input
              id="event-support-email"
              type="email"
              value={preferences.supportEmail}
              onChange={(input) =>
                update("supportEmail", input.target.value)
              }
              className="mt-2"
              placeholder="support@example.com"
            />
          </div>
        </div>
      </section>

      <section>
        <div className="border-b border-border pb-3">
          <h2 className="text-[17px] font-semibold">New event defaults</h2>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Applied when an event is created and still editable per event.
          </p>
        </div>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="event-default-timezone">Default timezone</Label>
            <SearchableSelect
              id="event-default-timezone"
              value={preferences.defaultTimezone}
              onChange={(value) => update("defaultTimezone", value)}
              options={timezoneOptions.map((zone) => ({
                value: zone.value,
                label: zone.label,
                description: zone.offset,
                keywords: `${zone.value} ${zone.countries.join(" ")}`,
              }))}
              searchPlaceholder="Search city, country, or timezone..."
              className="mt-2"
            />
          </div>
          <div>
            <Label>Default access</Label>
            <Select
              value={preferences.defaultAccessControl}
              onValueChange={(
                value: EventModulePreferences["defaultAccessControl"],
              ) => update("defaultAccessControl", value)}
            >
              <SelectTrigger className="mt-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="public">Public</SelectItem>
                <SelectItem value="invite_only">Invite only</SelectItem>
                <SelectItem value="password">Password protected</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between border-y border-border px-1 py-3">
            <div>
              <p className="text-[13px] font-medium">Ticketing by default</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Can be changed while creating each event.
              </p>
            </div>
            <Switch
              checked={preferences.defaultTicketingEnabled}
              onCheckedChange={(value) =>
                update("defaultTicketingEnabled", value)
              }
            />
          </div>
          <div className="flex items-center justify-between border-y border-border px-1 py-3 sm:col-span-2">
            <div>
              <p className="text-[13px] font-medium">Waitlist by default</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Collect interest when registration capacity is reached.
              </p>
            </div>
            <Switch
              checked={preferences.defaultWaitlistEnabled}
              onCheckedChange={(value) =>
                update("defaultWaitlistEnabled", value)
              }
            />
          </div>
        </div>
      </section>

      <section>
        <div className="border-b border-border pb-3">
          <h2 className="text-[17px] font-semibold">Registration defaults</h2>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Reused as the starting copy for each event.
          </p>
        </div>
        <div className="mt-5 space-y-5">
          <div>
            <Label htmlFor="event-confirmation">
              Confirmation message
            </Label>
            <Textarea
              id="event-confirmation"
              value={preferences.registrationConfirmation}
              onChange={(input) =>
                update("registrationConfirmation", input.target.value)
              }
              className="mt-2"
            />
          </div>
          <div>
            <Label htmlFor="event-default-refund">Default refund policy</Label>
            <Textarea
              id="event-default-refund"
              value={preferences.defaultRefundPolicy}
              onChange={(input) =>
                update("defaultRefundPolicy", input.target.value)
              }
              className="mt-2"
              placeholder="Leave blank for events without paid tickets."
            />
          </div>
        </div>
      </section>

      <div className="flex items-center justify-end gap-3 border-t border-border pt-5">
        <span className="mr-auto text-[11px] text-muted-foreground">
          {saveState === "dirty"
            ? "Unsaved general settings"
            : "General event settings are synced"}
        </span>
        <Button
          type="button"
          onClick={onSave}
          disabled={saveState === "saving"}
        >
          {saveState === "saving" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Save general settings
        </Button>
      </div>
    </div>
  );
}

function SettingsPanel({
  event,
  onChange,
  onSave,
  saveState,
}: {
  event: EventRecord;
  onChange: (event: EventRecord) => void;
  onSave: () => void;
  saveState: SaveState;
}) {
  const { user } = useAuth();
  const update = <Key extends keyof EventRecord>(
    key: Key,
    value: EventRecord[Key],
  ) => onChange({ ...event, [key]: value });
  const createInviteToken = () =>
    crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  const inviteUrl =
    typeof window === "undefined" || !event.inviteToken
      ? ""
      : `${window.location.origin}/event/${user?.short_id}/${event.slug}?invite=${event.inviteToken}`;
  const publishingRequirements = getEventPublishRequirements(event);
  return (
    <div className="max-w-[820px] space-y-9">
      <section>
        <div className="border-b border-border pb-3">
          <h2 className="text-[16px] font-semibold">Project</h2>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Optional. Filing this event under a project groups it with the
            forms and workflows for the same client, and scopes who can see it.
          </p>
        </div>
        <div className="mt-5">
          <ProjectPicker
            kind="event"
            itemId={event.id}
            projectId={event.projectId}
            userId={user?.id}
            className="h-9"
          />
        </div>
      </section>

      <section>
        <div className="border-b border-border pb-3">
          <h2 className="text-[16px] font-semibold">Publishing</h2>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Control this event's lifecycle without changing workspace defaults.
          </p>
        </div>
        <div className="mt-5">
          <div className="flex flex-col gap-3 border-y border-border py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[11px] text-muted-foreground">
                Current status
              </p>
              <p className="mt-1 text-[14px] font-semibold">
                {statusLabel(event.status)}
              </p>
            </div>
            <span className="text-[11px] text-muted-foreground">
              Use Publish in the editor header when the checklist is complete.
            </span>
          </div>
          {isLiveEventStatus(event.status) && (
            <div className="mt-5 flex flex-col gap-3 border border-destructive/30 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[12px] font-medium text-destructive">Cancel this event</p>
                <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                  Registration will stop. Connected meeting providers are cancelled when available.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="border-destructive/40 text-destructive hover:bg-destructive/10"
                onClick={() => {
                  if (!window.confirm("Cancel this event? Registration will stop and attendees will be notified when event email settings allow it.")) return;
                  onChange({ ...event, status: "cancelled" });
                }}
              >
                Cancel event
              </Button>
            </div>
          )}
          <div className="mt-5 grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {publishingRequirements.map((requirement) => (
              <div
                key={requirement.id}
                className="flex items-center gap-2 text-[12px]"
              >
                {requirement.complete ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                ) : (
                  <XCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span
                  className={
                    requirement.complete
                      ? "text-foreground"
                      : "text-muted-foreground"
                  }
                >
                  {requirement.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section>
        <div className="border-b border-border pb-3">
          <h2 className="text-[16px] font-semibold">Access control</h2>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Decide who can open the event registration page.
          </p>
        </div>
        <div className="mt-5">
          <Label>Event access</Label>
          <Select
            value={event.accessControl}
            onValueChange={(value: EventRecord["accessControl"]) =>
              onChange({
                ...event,
                accessControl: value,
                inviteToken:
                  value === "invite_only" && !event.inviteToken
                    ? createInviteToken()
                    : event.inviteToken,
              })
            }
          >
            <SelectTrigger className="mt-2 max-w-[360px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="public">Public</SelectItem>
              <SelectItem value="invite_only">Invite only</SelectItem>
              <SelectItem value="password">Password protected</SelectItem>
            </SelectContent>
          </Select>
          {event.accessControl === "password" && (
            <div className="mt-5 max-w-[520px] border-y border-border py-5">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center bg-primary/10 text-primary">
                  <LockKeyhole className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <Label htmlFor="event-access-password">Event password</Label>
                  <Input
                    id="event-access-password"
                    type="password"
                    autoComplete="new-password"
                    value={event.accessPassword}
                    onChange={(input) =>
                      update("accessPassword", input.target.value)
                    }
                    className="mt-2"
                    placeholder={
                      event.accessPasswordSet
                        ? "Password is set - enter a new one to replace it"
                        : "At least 6 characters"
                    }
                  />
                  <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                    {event.accessPasswordSet && !event.accessPassword
                      ? "The existing password remains active until you replace it."
                      : "Visitors must enter this password before event details and registration are shown."}
                  </p>
                </div>
              </div>
            </div>
          )}
          {event.accessControl === "invite_only" && (
            <div className="mt-5 max-w-[620px] space-y-5 border-y border-border py-5">
              <div>
                <Label htmlFor="event-invite-link">Private invitation link</Label>
                <div className="mt-2 flex gap-2">
                  <Input
                    id="event-invite-link"
                    value={inviteUrl}
                    readOnly
                    className="min-w-0 font-mono text-[11px]"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    title="Copy invitation link"
                    aria-label="Copy invitation link"
                    onClick={() => {
                      void navigator.clipboard
                        .writeText(inviteUrl)
                        .then(() => toast.success("Invitation link copied."))
                        .catch(() =>
                          toast.error("The invitation link could not be copied."),
                        );
                    }}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    title="Generate a new invitation link"
                    aria-label="Generate a new invitation link"
                    onClick={() => {
                      update("inviteToken", createInviteToken());
                      toast.success(
                        "A new invitation link was generated. Save to activate it.",
                      );
                    }}
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
                <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                  Only visitors with the complete private link can open this event.
                  Generating a new link invalidates the old one after saving.
                </p>
              </div>
              <div>
                <Label htmlFor="event-invite-message">
                  Invitation-only message
                </Label>
                <Textarea
                  id="event-invite-message"
                  value={event.inviteMessage}
                  onChange={(input) =>
                    update("inviteMessage", input.target.value)
                  }
                  className="mt-2 min-h-[88px]"
                  placeholder="This event is available to invited guests only."
                />
              </div>
            </div>
          )}
        </div>
      </section>
      <section>
        <div className="border-b border-border pb-3">
          <h2 className="text-[16px] font-semibold">Refund policy</h2>
          <p className="mt-1 text-[12px] text-muted-foreground">
            This appears on the public page and the back of the ticket.
          </p>
        </div>
        <div className="mt-5 grid gap-5 sm:grid-cols-[1fr_180px]">
          <div>
            <Label htmlFor="refund-policy">Policy text</Label>
            <Textarea
              id="refund-policy"
              value={event.refundPolicy}
              onChange={(input) => update("refundPolicy", input.target.value)}
              className="mt-2 min-h-[120px]"
              placeholder="Tickets can be refunded up to..."
            />
          </div>
          <div>
            <Label htmlFor="refund-window">Window in hours</Label>
            <Input
              id="refund-window"
              type="number"
              min={0}
              value={event.refundWindowHours}
              onChange={(input) =>
                update("refundWindowHours", Math.max(0, Number(input.target.value)))
              }
              className="mt-2"
            />
          </div>
        </div>
      </section>
      <section>
        <div className="border-b border-border pb-3">
          <h2 className="text-[16px] font-semibold">Public URL & SEO</h2>
          <p className="mt-1 text-[12px] text-muted-foreground">
            The slug is checked against every published and draft event.
          </p>
        </div>
        <div className="mt-5 space-y-5">
          <div>
            <Label htmlFor="event-slug">Event URL</Label>
            <div className="mt-2 flex">
              <span className="flex h-10 items-center rounded-l-md border border-r-0 border-input bg-muted px-3 text-[12px] text-muted-foreground">
                /event/{user?.short_id}/
              </span>
              <Input
                id="event-slug"
                value={event.slug}
                onChange={(input) => update("slug", normalizeEventSlug(input.target.value))}
                className="rounded-l-none"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="seo-title">Social title</Label>
            <Input
              id="seo-title"
              value={event.seo.title}
              onChange={(input) =>
                update("seo", { ...event.seo, title: input.target.value })
              }
              className="mt-2"
              placeholder={event.title}
            />
          </div>
          <div>
            <Label htmlFor="seo-description">Social description</Label>
            <Textarea
              id="seo-description"
              value={event.seo.description}
              onChange={(input) =>
                update("seo", { ...event.seo, description: input.target.value })
              }
              className="mt-2"
            />
          </div>
        </div>
      </section>
      <div className="flex items-center justify-end gap-3 border-t border-border pt-5">
        <span className="mr-auto text-[11px] text-muted-foreground">
          {saveState === "dirty" ? "Unsaved changes" : "Settings are synced"}
        </span>
        <Button type="button" onClick={onSave} disabled={saveState === "saving"}>
          {saveState === "saving" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save event settings
        </Button>
      </div>
    </div>
  );
}

export function EventsModule({
  userId,
  initialTab = "all",
  onTabChange,
  projectId = null,
  embedded = false,
}: {
  userId?: string;
  initialTab?: EventsTab;
  onTabChange?: (tab: EventsTab) => void;
  /**
   * Renders this module inside a project: the list is filtered to that
   * project and anything created here is filed there. Same module, same
   * editor -- only the lens changes.
   */
  projectId?: string | null;
  embedded?: boolean;
}) {
  const { user } = useAuth();
  const { currency, timezone } = useWorkspaceRegion();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<EventsTab>(initialTab);
  const [editorTab, setEditorTab] = useState<EventEditorTab>("details");
  const [events, setEvents] = useState<EventRecord[]>([]);
  // What the user browses. `events` stays the full workspace list so the
  // editor, slug checks, and cross-event lookups keep working.
  const visibleEvents = useMemo(
    () =>
      projectId ? events.filter((event) => event.projectId === projectId) : events,
    [events, projectId],
  );
  const [templates, setTemplates] = useState<EventTemplate[]>([]);
  const [ticketTemplates, setTicketTemplates] = useState<
    EventTicketDesignTemplate[]
  >([]);
  const [preferences, setPreferences] = useState<EventModulePreferences>(
    defaultEventModulePreferences(timezone),
  );
  const [selectedEventId, setSelectedEventId] = useState("");
  const [tickets, setTickets] = useState<EventTicketType[]>([]);
  const [attendees, setAttendees] = useState<EventAttendee[]>([]);
  const [designs, setDesigns] = useState<EventTicketDesign[]>([]);
  const upsertDesign = useCallback(
    (saved: EventTicketDesign) =>
      setDesigns((current) => [
        ...current.filter(
          (item) => item.ticketTypeId !== saved.ticketTypeId,
        ),
        saved,
      ]),
    [],
  );
  const dropDesign = useCallback(
    (ticketTypeId: string | null) =>
      setDesigns((current) =>
        current.filter((item) => item.ticketTypeId !== ticketTypeId),
      ),
    [],
  );
  const [loading, setLoading] = useState(true);
  const [loadingEventData, setLoadingEventData] = useState(false);
  const [editorTransition, setEditorTransition] = useState<
    "opening" | "closing" | null
  >(null);
  const eventDataRequestRef = useRef(0);
  const editVersionRef = useRef(0);
  const eventSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const moduleTabRefs = useRef<
    Partial<Record<EventsTab, HTMLButtonElement | null>>
  >({});
  const moduleTabsRef = useRef<HTMLElement | null>(null);
  const [creating, setCreating] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [manualDraftSaving, setManualDraftSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [moduleSaveState, setModuleSaveState] =
    useState<SaveState>("idle");
  const [previewEvent, setPreviewEvent] = useState<EventRecord | null>(null);
  const [registrationPreviewOpen, setRegistrationPreviewOpen] =
    useState(false);
  const [registrationHistoryOpen, setRegistrationHistoryOpen] =
    useState(false);
  const [deleteTarget, setDeleteTarget] = useState<EventRecord | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createTemplate, setCreateTemplate] = useState<EventTemplate | null>(
    null,
  );
  const [createTitle, setCreateTitle] = useState("");
  const [createTicketing, setCreateTicketing] = useState(false);
  const [createTicketPrefix, setCreateTicketPrefix] = useState("");
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [publishIssues, setPublishIssues] = useState<
    ReturnType<typeof getEventPublishRequirements>
  >([]);
  const selectedEvent =
    events.find((event) => event.id === selectedEventId) || null;
  const ticketDataEventId = selectedEvent?.id || "";
  const enqueueEventSave = useCallback(
    <T,>(operation: () => Promise<T>) => {
      const pending = eventSaveQueue.current
        .catch(() => undefined)
        .then(operation);
      eventSaveQueue.current = pending.then(
        () => undefined,
        () => undefined,
      );
      return pending;
    },
    [],
  );
  const eventsWorkspaceQuery = usePersistentQuery<EventWorkspaceData>({
    cacheKey: persistentCacheKey(
      "events",
      "workspace",
      "ticket-pricing-v2",
      userId,
      timezone,
    ),
    cacheScope: "events",
    enabled: Boolean(userId),
    queryFn: async () => {
      const [
        workspaceEvents,
        eventTemplates,
        designTemplates,
        modulePreferences,
      ] = await Promise.all([
        listEvents(userId!),
        listEventTemplates(),
        listEventTicketDesignTemplates(userId!),
        getEventModulePreferences(userId!, timezone),
      ]);
      return {
        events: workspaceEvents,
        preferences: modulePreferences,
        templates: eventTemplates,
        ticketTemplates: designTemplates,
      };
    },
    queryKey: queryKeys.events.workspace(userId, timezone),
    tags: ["events", userId || ""],
  });
  const eventDetailQuery = usePersistentQuery<EventDetailData>({
    cacheKey: persistentCacheKey("events", "detail", userId, ticketDataEventId),
    cacheScope: "events",
    enabled: Boolean(userId && ticketDataEventId),
    queryFn: async () => {
      const [nextTickets, nextAttendees, nextDesigns] =
        await Promise.all([
          listEventTicketTypes(userId!, ticketDataEventId),
          listEventAttendees(userId!, ticketDataEventId),
          listEventTicketDesigns(userId!, ticketDataEventId),
        ]);
      return {
        attendees: nextAttendees,
        designs: nextDesigns,
        tickets: nextTickets,
      };
    },
    queryKey: queryKeys.events.detail(userId, ticketDataEventId),
    tags: ["events", userId || "", ticketDataEventId],
  });
  const selectModuleTab = (tab: EventsTab) => {
    setActiveTab(tab);
    onTabChange?.(tab);
  };

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const applyWorkspaceData = useCallback(
    (workspace: EventWorkspaceData) => {
      if (!userId) return;
      const restoredEvents = workspace.events.map((event) =>
        restoreEventDraft(userId, event),
      );
      setEvents(restoredEvents);
      setTemplates(workspace.templates);
      setTicketTemplates(workspace.ticketTemplates);
      setPreferences(workspace.preferences);
      try {
        const activeEventId = sessionStorage.getItem(activeEventKey(userId));
        const activeEvent = restoredEvents.find(
          (event) => event.id === activeEventId,
        );
        if (activeEvent) {
          const databaseEvent = workspace.events.find(
            (event) => event.id === activeEvent.id,
          );
          setSelectedEventId(activeEvent.id);
          const storedTab = sessionStorage.getItem(
            activeEventTabKey(userId),
          ) as EventEditorTab | null;
          if (
            storedTab &&
            editorTabs.some(
              (tab) =>
                tab.key === storedTab &&
                (!tab.ticketing || activeEvent.ticketingEnabled),
            )
          ) {
            setEditorTab(storedTab);
          }
          setSaveState(activeEvent === databaseEvent ? "idle" : "dirty");
        }
      } catch {
        // The event list still loads when session storage is unavailable.
      }
    },
    [userId],
  );

  const applyEventDetailData = useCallback((detail: EventDetailData) => {
    setTickets(detail.tickets);
    setAttendees(detail.attendees);
    setDesigns(detail.designs);
  }, []);

  const load = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const result = await eventsWorkspaceQuery.refetch();
    if (result.data) {
      applyWorkspaceData(result.data);
    } else {
      toast.error("The Events workspace could not be loaded.");
    }
    setLoading(false);
  }, [applyWorkspaceData, eventsWorkspaceQuery, userId]);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    if (eventsWorkspaceQuery.data) {
      applyWorkspaceData(eventsWorkspaceQuery.data);
      setLoading(false);
      return;
    }
    if (eventsWorkspaceQuery.isError) {
      toast.error("The Events workspace could not be loaded.");
      setLoading(false);
      return;
    }
    setLoading(eventsWorkspaceQuery.isInitialLoading);
  }, [
    applyWorkspaceData,
    eventsWorkspaceQuery.data,
    eventsWorkspaceQuery.isError,
    eventsWorkspaceQuery.isInitialLoading,
    userId,
  ]);

  useEffect(() => {
    if (!userId || loading || eventsWorkspaceQuery.isError) return;
    const workspaceData = {
      events,
      preferences,
      templates,
      ticketTemplates,
    } satisfies EventWorkspaceData;
    queryClient.setQueryData(
      queryKeys.events.workspace(userId, timezone),
      workspaceData,
    );
    void setCachedServerState(
      persistentCacheKey(
        "events",
        "workspace",
        "ticket-pricing-v2",
        userId,
        timezone,
      ),
      workspaceData,
      "events",
      ["events", userId],
    );
  }, [
    events,
    eventsWorkspaceQuery.isError,
    loading,
    preferences,
    queryClient,
    templates,
    ticketTemplates,
    timezone,
    userId,
  ]);

  useEffect(() => {
    if (!selectedEvent || !["dirty", "saving"].includes(saveState)) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [saveState, selectedEvent]);

  useEffect(() => {
    if (selectedEvent) return;
    const navigation = moduleTabsRef.current;
    const activeButton = moduleTabRefs.current[activeTab];
    if (!navigation || !activeButton) return;
    navigation.scrollTo({
      left:
        activeButton.offsetLeft -
        (navigation.clientWidth - activeButton.offsetWidth) / 2,
    });
  }, [activeTab, selectedEvent]);

  useEffect(() => {
    if (!editorTransition) return;
    const timeout = window.setTimeout(
      () => setEditorTransition(null),
      editorTransition === "opening" ? 520 : 360,
    );
    return () => window.clearTimeout(timeout);
  }, [editorTransition]);

  const loadEventData = useCallback(async () => {
    const requestId = ++eventDataRequestRef.current;
    if (!userId || !ticketDataEventId) {
      setTickets([]);
      setAttendees([]);
      setDesigns([]);
      return;
    }
    setLoadingEventData(true);
    setTickets([]);
    setAttendees([]);
    setDesigns([]);
    const result = await eventDetailQuery.refetch();
    if (eventDataRequestRef.current !== requestId) return;
    if (result.data) {
      applyEventDetailData(result.data);
    } else {
      if (eventDataRequestRef.current !== requestId) return;
      toast.error("Some event data could not be refreshed.");
    }
    if (eventDataRequestRef.current === requestId) {
      setLoadingEventData(false);
    }
  }, [applyEventDetailData, eventDetailQuery, ticketDataEventId, userId]);

  useEffect(() => {
    if (!userId || !ticketDataEventId) {
      setTickets([]);
      setAttendees([]);
      setDesigns([]);
      setLoadingEventData(false);
      return;
    }
    if (eventDetailQuery.data) {
      applyEventDetailData(eventDetailQuery.data);
      setLoadingEventData(false);
      return;
    }
    if (eventDetailQuery.isError) {
      toast.error("Some event data could not be refreshed.");
      setLoadingEventData(false);
      return;
    }
    setLoadingEventData(eventDetailQuery.isInitialLoading);
  }, [
    applyEventDetailData,
    eventDetailQuery.data,
    eventDetailQuery.isError,
    eventDetailQuery.isInitialLoading,
    ticketDataEventId,
    userId,
  ]);

  useEffect(() => {
    if (
      !userId ||
      !ticketDataEventId ||
      loadingEventData ||
      eventDetailQuery.isError
    ) {
      return;
    }
    const detailData = {
      attendees,
      designs,
      tickets,
    } satisfies EventDetailData;
    queryClient.setQueryData(
      queryKeys.events.detail(userId, ticketDataEventId),
      detailData,
    );
    void setCachedServerState(
      persistentCacheKey("events", "detail", userId, ticketDataEventId),
      detailData,
      "events",
      ["events", userId, ticketDataEventId],
    );
  }, [
    attendees,
    designs,
    eventDetailQuery.isError,
    loadingEventData,
    queryClient,
    ticketDataEventId,
    tickets,
    userId,
  ]);

  const openEvent = (
    event: EventRecord,
    tab: EventEditorTab = "details",
  ) => {
    setEditorTransition("opening");
    const restoredEvent = userId ? restoreEventDraft(userId, event) : event;
    const nextTab =
      !restoredEvent.ticketingEnabled &&
      tab === "attendees"
        ? "details"
        : tab;
    editVersionRef.current += 1;
    eventDataRequestRef.current += 1;
    setTickets([]);
    setAttendees([]);
    setDesigns([]);
    setEvents((current) =>
      current.map((item) =>
        item.id === restoredEvent.id ? restoredEvent : item,
      ),
    );
    setSelectedEventId(restoredEvent.id);
    setEditorTab(nextTab);
    setSaveState(restoredEvent === event ? "idle" : "dirty");
    setRegistrationPreviewOpen(false);
    setRegistrationHistoryOpen(false);
    scrollDashboardToTop("auto");
    if (userId) {
      try {
        sessionStorage.setItem(activeEventKey(userId), restoredEvent.id);
        sessionStorage.setItem(activeEventTabKey(userId), nextTab);
      } catch {
        // The editor remains usable when session storage is unavailable.
      }
    }
  };

  const closeEditor = () => {
    setEditorTransition("closing");
    editVersionRef.current += 1;
    eventDataRequestRef.current += 1;
    setSelectedEventId("");
    setEditorTab("details");
    setSaveState("idle");
    setRegistrationPreviewOpen(false);
    setRegistrationHistoryOpen(false);
    selectModuleTab("all");
    scrollDashboardToTop("auto");
    if (userId) {
      try {
        sessionStorage.removeItem(activeEventKey(userId));
        sessionStorage.removeItem(activeEventTabKey(userId));
      } catch {
        // Nothing else is required when session storage is unavailable.
      }
    }
  };

  const requestCloseEditor = () => {
    if (saveState === "dirty") {
      setLeaveOpen(true);
      return;
    }
    closeEditor();
  };

  const updateSelectedEvent = (event: EventRecord) => {
    editVersionRef.current += 1;
    setEvents((current) =>
      current.map((item) => (item.id === event.id ? event : item)),
    );
    if (userId) storeEventDraft(userId, event);
    setSaveState("dirty");
  };

  const saveSelectedEvent = async (
    mode: "preserve" | "draft" | "publish" = "preserve",
  ) => {
    if (!userId || !selectedEvent) return false;
    const saveVersion = editVersionRef.current;
    const eventToSave: EventRecord = {
      ...selectedEvent,
      status:
        mode === "draft" && selectedEvent.status === "draft"
          ? "draft"
          : mode === "publish"
            ? selectedEvent.status === "draft"
              ? "published"
              : selectedEvent.status
            : selectedEvent.status,
      pricing: {
        ...defaultEventPricing(currency),
        ...selectedEvent.pricing,
        currency,
      },
    };
    if (!eventToSave.title.trim()) {
      toast.error("Add an event name before saving.");
      return false;
    }
    const isInitialPublication =
      mode === "publish" && !isLiveEventStatus(selectedEvent.status);
    const shouldValidateSlug =
      editorTab === "settings" || isInitialPublication;
    if (
      shouldValidateSlug &&
      (!eventToSave.slug ||
        !(await isEventSlugAvailable(eventToSave.slug, eventToSave.id)))
    ) {
      toast.error("That event URL is already in use. Choose another slug.");
      return false;
    }
    if (
      mode === "publish" &&
      eventToSave.ticketingEnabled &&
      eventToSave.ticketPrefix.replace(/-$/, "").length < 2
    ) {
      toast.error("Set a ticket prefix for this event before publishing.");
      setEditorTab("ticket_types");
      return false;
    }
    if (mode === "draft") setManualDraftSaving(true);
    setSaveState("saving");
    try {
      const saved = await enqueueEventSave(() =>
        saveEvent(userId, eventToSave, {
          publishing: mode === "publish",
          syncPricing:
            isInitialPublication ||
            ["pricing", "settings"].includes(editorTab),
          syncRegistration: ["registration", "pricing", "settings"].includes(
            editorTab,
          ),
          validatePublishing: isInitialPublication,
          validateTicketing:
            isInitialPublication || ["settings", "ticket_types"].includes(editorTab),
        }),
      );
      const editsChangedDuringSave = editVersionRef.current !== saveVersion;
      setEvents((current) =>
        current.map((event) => {
          if (event.id !== saved.id) return event;
          if (!editsChangedDuringSave) return saved;
          return {
            ...saved,
            ...event,
            status: saved.status,
            accessPasswordSet:
              saved.accessPasswordSet || event.accessPasswordSet,
            updatedAt: saved.updatedAt,
          };
        }),
      );
      if (editsChangedDuringSave) {
        setSaveState("dirty");
      } else {
        clearEventDraft(userId, saved.id);
        setSaveState("saved");
      }
      if (
        !saved.ticketingEnabled &&
        editorTab === "attendees"
      ) {
        setEditorTab("ticket_types");
      }
      toast.success(
        mode === "draft"
          ? "Draft saved"
          : mode === "publish"
            ? isLiveEventStatus(selectedEvent.status)
              ? "Event updated"
              : "Event published"
            : "Event saved",
        mode === "publish"
          ? {
              description: `${window.location.origin}/event/${user?.short_id}/${saved.slug}`,
            }
          : undefined,
      );
      return true;
    } catch (error) {
      setSaveState("error");
      toast.error(
        error instanceof Error
          ? error.message
          : "The event could not be saved.",
      );
      return false;
    } finally {
      if (mode === "draft") setManualDraftSaving(false);
    }
  };

  useEffect(() => {
    if (
      saveState !== "dirty" ||
      !userId ||
      !selectedEvent ||
      !selectedEvent.title.trim()
    ) {
      return;
    }
    const snapshot: EventRecord = {
      ...selectedEvent,
      pricing: {
        ...defaultEventPricing(currency),
        ...selectedEvent.pricing,
        currency,
      },
    };
    const snapshotVersion = editVersionRef.current;
    const timeout = window.setTimeout(() => {
      void enqueueEventSave(() =>
        saveEvent(userId, snapshot, {
          publishing: false,
          syncPricing: ["pricing", "settings"].includes(editorTab),
          syncRegistration: ["registration", "pricing", "settings"].includes(
            editorTab,
          ),
          validateTicketing: ["settings", "ticket_types"].includes(editorTab),
        }),
      )
        .then((saved) => {
          if (editVersionRef.current !== snapshotVersion) return;
          setEvents((current) =>
            current.map((event) => (event.id === saved.id ? saved : event)),
          );
          clearEventDraft(userId, saved.id);
          setSaveState("saved");
        })
        .catch(() => {
          if (editVersionRef.current === snapshotVersion) {
            setSaveState("error");
          }
        });
    }, 1_200);
    return () => window.clearTimeout(timeout);
  }, [
    currency,
    editorTab,
    enqueueEventSave,
    saveState,
    selectedEvent,
    userId,
  ]);

  const publishSelectedEvent = async () => {
    if (!userId || !selectedEvent) return;
    setPublishing(true);
    try {
      const ticketTypeCount = selectedEvent.ticketingEnabled
        ? loadingEventData
          ? selectedEvent.ticketTypeCount
          : tickets.filter((ticket) => ticket.active).length
        : selectedEvent.ticketTypeCount;
      const candidate: EventRecord = {
        ...selectedEvent,
        status:
          selectedEvent.status === "draft"
            ? "published"
            : selectedEvent.status,
        pricing: {
          ...defaultEventPricing(currency),
          ...selectedEvent.pricing,
          currency,
        },
      };
      const missing = getEventPublishRequirements(
        candidate,
        ticketTypeCount,
      ).filter((requirement) => !requirement.complete);
      if (missing.length) {
        setPublishIssues(missing);
        return;
      }
      await saveSelectedEvent("publish");
    } catch {
      toast.error("Publishing checks could not be completed. Try again.");
    } finally {
      setPublishing(false);
    }
  };

  const saveGeneralSettings = async () => {
    if (!userId) return;
    setModuleSaveState("saving");
    try {
      const saved = await saveEventModulePreferences(userId, preferences);
      setPreferences(saved);
      setModuleSaveState("saved");
      toast.success("General event settings saved");
    } catch {
      setModuleSaveState("error");
      toast.error("General event settings could not be saved.");
    }
  };

  const selectEditorTab = async (tab: EventEditorTab) => {
    if (
      saveState === "dirty" &&
      ["ticket_types", "attendees"].includes(tab)
    ) {
      const saved = await saveSelectedEvent("preserve");
      if (!saved) return;
    }
    setEditorTab(tab);
    if (userId) {
      try {
        sessionStorage.setItem(activeEventTabKey(userId), tab);
      } catch {
        // The editor remains usable when session storage is unavailable.
      }
    }
  };

  const beginCreate = (template: EventTemplate | null) => {
    const templateTicketing = template?.eventDefaults.ticketingEnabled;
    const initialTitle =
      template && template.id !== "blank-event"
        ? `${template.name} event`
        : "";
    const initialTicketing =
      typeof templateTicketing === "boolean"
        ? templateTicketing
        : preferences.defaultTicketingEnabled;
    setCreateTemplate(template);
    setCreateTitle(initialTitle);
    setCreateTicketing(initialTicketing);
    setCreateTicketPrefix(
      initialTicketing ? suggestedTicketPrefix(initialTitle || "TKT") : "",
    );
    setCreateOpen(true);
  };

  const confirmCreate = async () => {
    if (!userId || !createTitle.trim()) {
      toast.error("Add an event name.");
      return;
    }
    if (
      createTicketing &&
      createTicketPrefix.replace(/-$/, "").length < 2
    ) {
      toast.error("Set a ticket prefix for this event.");
      return;
    }
    setCreating(true);
    try {
      const created = await createEvent(userId, {
        title: createTitle.trim(),
        template: createTemplate,
        projectId,
        currency,
        timezone: preferences.defaultTimezone || timezone,
        ticketingEnabled: createTicketing,
        ticketPrefix: createTicketPrefix,
        preferences,
      });
      setEvents((current) => [created, ...current]);
      setCreateOpen(false);
      openEvent(created, "details");
      toast.success("Event created");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "The event could not be created.",
      );
    } finally {
      setCreating(false);
    }
  };

  const confirmDelete = async () => {
    if (!userId || !deleteTarget) return;
    try {
      await deleteEvent(userId, deleteTarget);
      clearEventDraft(userId, deleteTarget.id);
      setEvents((current) =>
        current.filter((event) => event.id !== deleteTarget.id),
      );
      if (selectedEventId === deleteTarget.id) closeEditor();
      setDeleteTarget(null);
      toast.success("Event deleted");
    } catch {
      toast.error("The event could not be deleted.");
    }
  };

  const copyPublicLink = async () => {
    if (!selectedEvent) return;
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/event/${user?.short_id}/${selectedEvent.slug}`,
      );
      toast.success("Public event link copied");
    } catch {
      toast.error("The public event link could not be copied.");
    }
  };

  const openPublicEvent = (event: EventRecord) => {
    window.open(
      `/event/${user?.short_id}/${event.slug}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  const refreshEventList = () => {
    if (!userId) return;
    void listEvents(userId)
      .then(setEvents)
      .catch(() => toast.error("The event list could not be refreshed."));
  };

  const refreshEventData = () => {
    void loadEventData();
    refreshEventList();
  };

  const visibleEditorTabs = selectedEvent
    ? editorTabs.filter(
        (tab) => !tab.ticketing || selectedEvent.ticketingEnabled,
      )
    : [];

  return (
    <div className="pb-12">
      {selectedEvent ? (
        <>
          <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <button
                type="button"
                onClick={requestCloseEditor}
                className="flex items-center gap-2 text-[12px] text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to events
              </button>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <h1 className="max-w-[720px] truncate text-[28px] font-semibold leading-tight sm:text-[34px]">
                  {selectedEvent.title}
                </h1>
                <span className="rounded bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground">
                  {statusLabel(selectedEvent.status)}
                </span>
              </div>
              <p className="mt-2 text-[12px] text-muted-foreground">
                {saveState === "saving"
                  ? "Saving changes..."
                  : saveState === "dirty"
                    ? "Changes queued for autosave"
                    : saveState === "error"
                      ? "Changes are backed up locally - use Save Draft to retry"
                      : "All changes saved"}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => void copyPublicLink()}
              >
                <Copy className="h-4 w-4" />
                Copy link
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (editorTab === "registration") {
                    setRegistrationPreviewOpen(true);
                  } else {
                    setPreviewEvent(selectedEvent);
                  }
                }}
              >
                <ExternalLink className="h-4 w-4" />
                Preview
              </Button>
              {editorTab === "registration" && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setRegistrationHistoryOpen(true)}
                >
                  <History className="h-4 w-4" />
                  History
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                onClick={() => void saveSelectedEvent("draft")}
                disabled={
                  (saveState !== "dirty" && saveState !== "error") ||
                  manualDraftSaving ||
                  publishing
                }
              >
                {manualDraftSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save Draft
              </Button>
              <Button
                type="button"
                onClick={() => void publishSelectedEvent()}
                disabled={
                  saveState === "saving" ||
                  manualDraftSaving ||
                  publishing ||
                  (isLiveEventStatus(selectedEvent.status) &&
                    saveState !== "dirty" &&
                    saveState !== "error")
                }
              >
                {publishing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Globe2 className="h-4 w-4" />
                )}
                {publishing
                  ? isLiveEventStatus(selectedEvent.status)
                    ? "Updating..."
                    : "Publishing..."
                  : isLiveEventStatus(selectedEvent.status)
                    ? "Update"
                    : "Publish"}
              </Button>
            </div>
          </header>
          <nav
            className="dashboard-scroll dashboard-scroll-x mt-7 flex overflow-x-auto border-b border-border"
            aria-label={`${selectedEvent.title} editor`}
          >
            {visibleEditorTabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => void selectEditorTab(tab.key)}
                  className={cn(
                    "relative flex h-12 shrink-0 items-center gap-2 px-4 text-[12px]",
                    editorTab === tab.key
                      ? "font-medium text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {tab.label}
                  {editorTab === tab.key && (
                    <span className="absolute inset-x-4 bottom-0 h-0.5 bg-primary" />
                  )}
                </button>
              );
            })}
          </nav>
        </>
      ) : (
        <>
          <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            {/* Inside a project the page already carries a title and tabs. */}
            <div>
              {embedded ? null : (
                <>
                  <p className="text-[11px] font-semibold uppercase text-primary">
                    Events
                  </p>
                  <h1 className="mt-2 text-[30px] font-semibold leading-tight sm:text-[36px]">
                    Events, registrations, and arrivals
                  </h1>
                  <p className="mt-2 max-w-[650px] text-[13px] leading-6 text-muted-foreground">
                    Create public event pages and choose ticketing only where the
                    event needs it.
                  </p>
                </>
              )}
            </div>
            {activeTab !== "tickets" && activeTab !== "checkin" && (
              <Button type="button" onClick={() => beginCreate(null)}>
                <Plus className="h-4 w-4" />
                New event
              </Button>
            )}
          </header>
          <nav
            ref={moduleTabsRef}
            className={cn(
              "dashboard-scroll dashboard-scroll-x mt-7 flex overflow-x-auto border-b border-border",
              embedded && "hidden",
            )}
            aria-label="Events module"
          >
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.key}
                  ref={(element) => {
                    moduleTabRefs.current[tab.key] = element;
                  }}
                  type="button"
                  onClick={() => selectModuleTab(tab.key)}
                  className={cn(
                    "relative flex h-12 shrink-0 items-center gap-2 px-4 text-[12px]",
                    activeTab === tab.key
                      ? "font-medium text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {tab.shortLabel || tab.label}
                  {activeTab === tab.key && (
                    <span className="absolute inset-x-4 bottom-0 h-0.5 bg-primary" />
                  )}
                </button>
              );
            })}
          </nav>
        </>
      )}

      <div className="mt-12">
        {loading ? (
          <div className="flex min-h-[420px] items-center justify-center">
            <div className="text-center">
              <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />
              <p className="mt-3 text-[12px] text-muted-foreground">
                Opening Events
              </p>
            </div>
          </div>
        ) : selectedEvent ? (
          loadingEventData &&
          ["ticket_types", "attendees", "analytics"].includes(
            editorTab,
          ) ? (
            <div className="flex min-h-[360px] items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : editorTab === "details" ? (
            <BuilderPanel
              event={selectedEvent}
              onChange={updateSelectedEvent}
              onSave={() => saveSelectedEvent("preserve")}
            />
          ) : editorTab === "preloader" ? (
            <EventPreloaderPanel
              event={selectedEvent}
              onChange={updateSelectedEvent}
            />
          ) : editorTab === "registration" && userId ? (
            <RegistrationPanel
              event={selectedEvent}
              historyOpen={registrationHistoryOpen}
              onHistoryOpenChange={setRegistrationHistoryOpen}
              userId={userId}
              onEventChange={updateSelectedEvent}
              previewOpen={registrationPreviewOpen}
              onPreviewOpenChange={setRegistrationPreviewOpen}
              saveState={saveState}
            />
          ) : editorTab === "pricing" && userId ? (
            <EventPricingPanel
              currency={currency}
              event={selectedEvent}
              onChange={updateSelectedEvent}
              onOpenTicketTypes={() =>
                void selectEditorTab("ticket_types")
              }
              tickets={tickets}
              userId={userId}
            />
          ) : editorTab === "ticket_types" && userId ? (
            <TicketStudio
              currency={currency}
              designs={designs}
              event={selectedEvent}
              onEventChange={updateSelectedEvent}
              onSave={() => void saveSelectedEvent("preserve")}
              saveState={saveState}
              onDesignRemoved={dropDesign}
              onDesignSaved={upsertDesign}
              onRefresh={refreshEventData}
              onTicketsChanged={setTickets}
              ticketTemplates={ticketTemplates}
              tickets={tickets}
              userId={userId}
            />
          ) : editorTab === "attendees" && userId ? (
            <AttendeesPanel
              attendees={attendees}
              currency={currency}
              designs={designs}
              event={selectedEvent}
              onRefresh={refreshEventData}
              ticketTemplates={ticketTemplates}
              tickets={tickets}
              userId={userId}
            />
          ) : editorTab === "analytics" ? (
            <AnalyticsPanel
              attendees={attendees}
              currency={currency}
              event={selectedEvent}
              tickets={tickets}
            />
          ) : editorTab === "mail_settings" && userId ? (
            <EventMailSettings event={selectedEvent} />
          ) : editorTab === "settings" ? (
            <SettingsPanel
              event={selectedEvent}
              onChange={updateSelectedEvent}
              onSave={() => void saveSelectedEvent("preserve")}
              saveState={saveState}
            />
          ) : null
        ) : activeTab === "all" ? (
          <EventListView
            currency={currency}
            events={visibleEvents}
            onCreate={() => beginCreate(null)}
            onDelete={setDeleteTarget}
            onOpen={openEvent}
            onOpenLive={openPublicEvent}
            onPreview={setPreviewEvent}
            onTemplates={() => selectModuleTab("templates")}
          />
        ) : activeTab === "templates" ? (
          <TemplateGallery
            creating={creating}
            templates={templates}
            onUse={beginCreate}
          />
        ) : activeTab === "email_templates" ? (
          <EventEmailTemplates />
        ) : activeTab === "tickets" && userId ? (
          <ModuleTicketWorkspace
            onTemplatesChanged={setTicketTemplates}
            ticketTemplates={ticketTemplates}
            userId={userId}
          />
        ) : activeTab === "checkin" && userId ? (
          <WorkspaceCheckinPanel
            events={visibleEvents}
            onRefresh={refreshEventList}
            userId={userId}
          />
        ) : activeTab === "pricing" ? (
          <EventPricingOverview
            currency={currency}
            events={visibleEvents}
            onOpenEvent={(event) =>
              openEvent(
                event,
                event.ticketingEnabled ? "ticket_types" : "pricing",
              )
            }
          />
        ) : activeTab === "analytics" ? (
          <EventModuleAnalytics currency={currency} events={visibleEvents} />
        ) : (
          <EventModuleSettings
            onChange={(nextPreferences) => {
              setPreferences(nextPreferences);
              setModuleSaveState("dirty");
            }}
            onSave={() => void saveGeneralSettings()}
            preferences={preferences}
            saveState={moduleSaveState}
          />
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Create event</DialogTitle>
            <DialogDescription>
              {createTemplate
                ? `Start with ${createTemplate.name}, then edit every detail.`
                : "Start with a clean event workspace."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5 py-3">
            <div>
              <Label htmlFor="new-event-title">Event name</Label>
              <Input
                id="new-event-title"
                value={createTitle}
                onChange={(input) => setCreateTitle(input.target.value)}
                className="mt-2"
                placeholder="Enter event name"
                autoFocus
              />
            </div>
            <div className="flex items-center justify-between gap-6 border-y border-border py-4">
              <div>
                <p className="text-[13px] font-medium">Enable ticketing</p>
                <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                  Adds prices, inventory, designed tickets, and secure check-in.
                  Leave off for simple registrations or RSVPs.
                </p>
              </div>
              <Switch
                checked={createTicketing}
                onCheckedChange={(value) => {
                  setCreateTicketing(value);
                  if (value && !createTicketPrefix) {
                    setCreateTicketPrefix(
                      suggestedTicketPrefix(createTitle || "TKT"),
                    );
                  }
                }}
              />
            </div>
            {createTicketing && (
              <div>
                <Label htmlFor="new-event-ticket-prefix">
                  Ticket prefix
                </Label>
                <div className="mt-2 flex">
                  <Input
                    id="new-event-ticket-prefix"
                    value={createTicketPrefix.replace(/-$/, "")}
                    onChange={(input) =>
                      setCreateTicketPrefix(
                        normalizeTicketPrefix(input.target.value),
                      )
                    }
                    className="rounded-r-none font-mono uppercase"
                    placeholder="VIP"
                    maxLength={12}
                  />
                  <span className="flex h-10 items-center rounded-r-md border border-l-0 border-input bg-muted px-4 font-mono text-[14px] font-semibold">
                    -
                  </span>
                </div>
                <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                  This prefix belongs only to this event. Tickets will be
                  generated as{" "}
                  <span className="font-mono text-foreground">
                    {createTicketPrefix || "PREFIX-"}A1B2C3D4E5F6
                  </span>
                  .
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCreateOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void confirmCreate()}
              disabled={creating}
            >
              {creating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Create event
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(previewEvent)}
        onOpenChange={(open) => !open && setPreviewEvent(null)}
      >
        <DialogContent className="dashboard-scroll max-h-[94vh] max-w-[1080px] overflow-y-auto p-0">
          <DialogHeader className="border-b border-border px-6 py-4">
            <DialogTitle>Public event preview</DialogTitle>
            <DialogDescription>
              The page uses this event's branding and configured content.
            </DialogDescription>
          </DialogHeader>
          {previewEvent && <EventPreview event={previewEvent} />}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent className="max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Delete this event?</DialogTitle>
            <DialogDescription>
              This removes the event, linked registration form, ticket data,
              attendees, and scan history. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteTarget(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void confirmDelete()}
            >
              <Trash2 className="h-4 w-4" />
              Delete event
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={publishIssues.length > 0}
        onOpenChange={(open) => !open && setPublishIssues([])}
      >
        <DialogContent className="max-w-[560px]">
          <DialogHeader>
            <DialogTitle>Event is not ready to publish</DialogTitle>
            <DialogDescription>
              Complete the required event information below. The current draft
              remains private.
            </DialogDescription>
          </DialogHeader>
          <div className="divide-y divide-border border-y border-border">
            {publishIssues.map((requirement) => (
              <div
                key={requirement.id}
                className="flex items-center gap-3 py-3"
              >
                <XCircle className="h-4 w-4 shrink-0 text-destructive" />
                <span className="text-[13px] font-medium">
                  {requirement.label}
                </span>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setPublishIssues([])}
            >
              Keep editing
            </Button>
            <Button
              type="button"
              onClick={() => {
                const firstIssue = publishIssues[0];
                if (firstIssue) setEditorTab(firstIssue.tab);
                setPublishIssues([]);
              }}
            >
              Review required fields
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={leaveOpen} onOpenChange={setLeaveOpen}>
        <DialogContent className="w-[calc(100%-24px)] max-w-[620px] gap-0 overflow-hidden p-0">
          <DialogHeader className="items-center px-6 pb-6 pt-7 text-center sm:px-8 sm:text-center">
            <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <AlertCircle className="h-5 w-5" />
            </span>
            <DialogTitle>Save changes before leaving?</DialogTitle>
            <DialogDescription className="max-w-[520px] leading-6">
              This event has changes that have not reached the database.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="grid w-full grid-cols-1 gap-2 border-t border-border p-4 sm:grid-cols-2 sm:flex-none sm:space-x-0 sm:p-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setLeaveOpen(false);
                if (userId && selectedEvent) {
                  clearEventDraft(userId, selectedEvent.id);
                  refreshEventList();
                }
                closeEditor();
              }}
              className="w-full min-w-0 justify-center whitespace-normal text-center text-[12px] sm:text-[13px]"
            >
              Discard changes
            </Button>
            <Button
              type="button"
              onClick={() =>
                void saveSelectedEvent("preserve").then((saved) => {
                  if (!saved) return;
                  setLeaveOpen(false);
                  closeEditor();
                })
              }
              className="w-full min-w-0 justify-center whitespace-normal text-center text-[12px] sm:text-[13px]"
            >
              <Save className="h-4 w-4" />
              Save and exit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {editorTransition && (
        <EventEditorTransitionOverlay phase={editorTransition} />
      )}
    </div>
  );
}

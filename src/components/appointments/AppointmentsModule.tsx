import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  BarChart3,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  ChevronRight,
  Clock3,
  Copy,
  ExternalLink,
  Filter,
  GitBranch,
  Loader2,
  Mail,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Table2,
  Trash2,
  TriangleAlert,
  Unplug,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { Reveal } from "@/components/shared/transitions";
import {
  addBlackoutDate,
  appointmentsAnalyticsQueryKey,
  appointmentsWorkspaceQueryKey,
  deleteBlackoutDate,
  deleteBookingPage,
  deleteRoutingForm,
  getAppointmentsAnalytics,
  getAppointmentsWorkspace,
  getEmbedSnippet,
  saveAvailability,
  saveBookingPage,
  saveRoutingForm,
  type AppointmentsAnalytics,
  type AppointmentsWorkspace,
  type Availability,
  type DayReason,
  type BookingPage,
  type RoutingForm,
  type SchedulingToolProvider,
} from "@/lib/appointments";
import { BookingPageBuilder } from "./BookingPageBuilder";
import { SharedEmailTemplates } from "@/components/email/SharedEmailTemplates";
import { PaginatedCardGrid } from "@/components/shared/CardGrid";
import { ModuleIntegrationNotice } from "@/components/integrations/ModuleIntegrationNotice";
import { SectionHeading } from "./SectionHeading";
import { RoutingFormEditor } from "./RoutingFormEditor";
import {
  WEEKDAYS,
  conversionRate,
  dateLabel,
  dayKey,
  isUpcoming,
  locationLabels,
  money,
  noShowRate,
  reasonLabel,
  unavailableReasons,
  schedulingLabels,
  statusLabels,
  timeLabel,
} from "./appointment-format";

export type AppointmentsTab =
  | "overview"
  | "booking-pages"
  | "routing-forms"
  | "calendar"
  | "appointments"
  | "availability"
  | "integrations"
  | "email_templates"
  | "analytics"
  | "settings";

type AppointmentsModuleProps = {
  userId?: string;
  initialTab?: AppointmentsTab;
  onTabChange?: (tab: AppointmentsTab) => void;
};

const tabs: Array<{ key: AppointmentsTab; label: string; icon: LucideIcon }> = [
  { key: "analytics", label: "Analytics", icon: BarChart3 },
  { key: "overview", label: "Overview", icon: CalendarClock },
  { key: "booking-pages", label: "Booking pages", icon: CalendarRange },
  { key: "routing-forms", label: "Routing forms", icon: GitBranch },
  { key: "calendar", label: "Calendar", icon: CalendarDays },
  { key: "appointments", label: "Appointments", icon: Table2 },
  { key: "availability", label: "Availability", icon: Clock3 },
  { key: "integrations", label: "Integrations", icon: Unplug },
  { key: "email_templates", label: "Email templates", icon: Mail },
  { key: "settings", label: "Settings", icon: Settings2 },
];

const emptyWorkspace: AppointmentsWorkspace = {
  bookingPages: [],
  routingForms: [],
  appointments: [],
  availability: {
    timezone: "UTC",
    weeklyHours: {},
    dayReasons: {},
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    minimumNoticeMinutes: 240,
    maximumAdvanceDays: 60,
    dailyBookingCap: 0,
    slotIntervalMinutes: 30,
  },
  blackoutDates: [],
  connections: [],
  payments: { paidCents: 0, paidCount: 0, pendingCount: 0 },
};

export function AppointmentsModule({
  initialTab = "analytics",
  onTabChange,
  userId,
}: AppointmentsModuleProps) {
  const queryClient = useQueryClient();
  // The tab is owned locally and re-synced when the host changes it, rather
  // than read straight from `initialTab` — otherwise a click never wins against
  // the prop and the tabs are inert wherever `onTabChange` is not wired up.
  const [localTab, setLocalTab] = useState<AppointmentsTab>(initialTab);
  useEffect(() => setLocalTab(initialTab), [initialTab]);
  const activeTab = localTab;
  const [working, setWorking] = useState(false);
  // `undefined` means the builder is closed; `null` means it is open on a new
  // record. Keeping both apart is what lets "create" and "closed" differ.
  const [builderPage, setBuilderPage] = useState<BookingPage | null | undefined>();
  const [routingDraft, setRoutingDraft] = useState<RoutingForm | null | undefined>();
  const [analyticsDays, setAnalyticsDays] = useState(30);

  const workspaceQuery = useQuery({
    enabled: Boolean(userId),
    queryKey: appointmentsWorkspaceQueryKey(userId || "anonymous"),
    queryFn: getAppointmentsWorkspace,
    retry: false,
  });
  const analyticsQuery = useQuery({
    enabled: Boolean(userId) && activeTab === "analytics",
    queryKey: appointmentsAnalyticsQueryKey(userId || "anonymous", analyticsDays),
    queryFn: () => getAppointmentsAnalytics(analyticsDays),
    retry: false,
  });

  const data = workspaceQuery.data || emptyWorkspace;

  const selectTab = (tab: AppointmentsTab) => {
    setLocalTab(tab);
    onTabChange?.(tab);
  };

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["appointments"] });

  const mutate = async (work: () => Promise<unknown>, success: string) => {
    setWorking(true);
    try {
      await work();
      await refresh();
      toast.success(success);
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That change could not be saved.");
      return false;
    } finally {
      setWorking(false);
    }
  };

  if (builderPage !== undefined) {
    return (
      <BookingPageBuilder
        connections={data.connections}
        page={builderPage}
        saving={working}
        onClose={() => setBuilderPage(undefined)}
        onSave={(input) => {
          void mutate(() => saveBookingPage(input), "Booking page saved.").then((ok) => {
            if (ok) setBuilderPage(undefined);
          });
        }}
      />
    );
  }

  if (routingDraft !== undefined) {
    return (
      <RoutingFormEditor
        bookingPages={data.bookingPages}
        form={routingDraft}
        saving={working}
        onClose={() => setRoutingDraft(undefined)}
        onSave={(input) => {
          void mutate(() => saveRoutingForm(input), "Routing form saved.").then((ok) => {
            if (ok) setRoutingDraft(undefined);
          });
        }}
      />
    );
  }

  return (
    <div className="space-y-6 pb-5">
      <header className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-primary">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10">
              <CalendarClock className="h-3.5 w-3.5" />
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em]">Scheduling</span>
          </div>
          <h1 className="mt-3 text-[30px] font-semibold tracking-tight sm:text-[34px]">
            Appointments
          </h1>
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            Booking pages, routing, availability, and the tools you already use — in one place.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={workspaceQuery.isFetching}
          onClick={() => void refresh()}
        >
          {workspaceQuery.isFetching ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Refresh
        </Button>
      </header>

      <nav
        className="dashboard-scroll dashboard-scroll-x flex gap-1 overflow-x-auto border-b border-border"
        aria-label="Appointments sections"
      >
        {tabs.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => selectTab(item.key)}
              className={
                active
                  ? "relative flex h-10 shrink-0 items-center gap-1.5 border-b-2 border-primary px-3 text-[12px] font-semibold"
                  : "relative flex h-10 shrink-0 items-center gap-1.5 border-b-2 border-transparent px-3 text-[12px] text-muted-foreground hover:text-foreground"
              }
            >
              <Icon className="h-3.5 w-3.5" />
              {item.label}
            </button>
          );
        })}
      </nav>

      {!userId ? (
        <EmptyState
          icon={CalendarClock}
          title="Sign in to manage appointments"
          description="Booking pages and availability belong to your workspace."
        />
      ) : workspaceQuery.isLoading ? (
        <div className="flex min-h-[300px] items-center justify-center gap-3" role="status">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <p className="text-[12px] text-muted-foreground">Loading your scheduling workspace…</p>
        </div>
      ) : workspaceQuery.isError ? (
        <section className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
          <TriangleAlert className="mx-auto h-5 w-5 text-destructive" />
          <h2 className="mt-3 text-[15px] font-semibold">Appointments could not be loaded</h2>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {workspaceQuery.error instanceof Error
              ? workspaceQuery.error.message
              : "Please try again shortly."}
          </p>
          <Button type="button" size="sm" className="mt-4" onClick={() => void refresh()}>
            Try again
          </Button>
        </section>
      ) : (
        // Keyed on the tab so each one plays its entrance instead of snapping
        // into place. The content is in the DOM from the first frame.
        <Reveal motionKey={activeTab}>
          {activeTab === "overview" && <Overview data={data} onSelect={selectTab} />}
          {activeTab === "booking-pages" && (
            <BookingPages
              pages={data.bookingPages}
              working={working}
              onCreate={() => setBuilderPage(null)}
              onEdit={setBuilderPage}
              onDelete={(page) => void mutate(() => deleteBookingPage(page.id), "Booking page deleted.")}
            />
          )}
          {activeTab === "routing-forms" && (
            <RoutingForms
              forms={data.routingForms}
              pages={data.bookingPages}
              working={working}
              onCreate={() => setRoutingDraft(null)}
              onEdit={setRoutingDraft}
              onDelete={(form) => void mutate(() => deleteRoutingForm(form.id), "Routing form deleted.")}
            />
          )}
          {activeTab === "calendar" && <InternalCalendar data={data} />}
          {activeTab === "appointments" && <AppointmentsTable data={data} />}
          {activeTab === "availability" && (
            <AvailabilityPanel
              data={data}
              working={working}
              onSave={(input) => void mutate(() => saveAvailability(input), "Availability saved.")}
              onAddBlackout={(input) => void mutate(() => addBlackoutDate(input), "Blackout dates added.")}
              onRemoveBlackout={(id) => void mutate(() => deleteBlackoutDate(id), "Blackout dates removed.")}
            />
          )}
          {activeTab === "integrations" && (
            <ModuleIntegrationNotice moduleName="Appointments" />
          )}
          {activeTab === "email_templates" && (
            <SharedEmailTemplates module="appointments" />
          )}
          {activeTab === "analytics" && (
            <AnalyticsPanel
              analytics={analyticsQuery.data}
              days={analyticsDays}
              loading={analyticsQuery.isLoading}
              onDaysChange={setAnalyticsDays}
            />
          )}
          {activeTab === "settings" && <SettingsPanel data={data} />}
        </Reveal>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ shared */

function EmptyState({
  action,
  description,
  icon: Icon,
  title,
}: {
  action?: React.ReactNode;
  description: string;
  icon: LucideIcon;
  title: string;
}) {
  return (
    <div className="flex min-h-[260px] flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-12 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <Icon className="h-5 w-5" />
      </span>
      <h3 className="mt-4 text-[15px] font-semibold">{title}</h3>
      <p className="mt-1.5 max-w-md text-[12px] leading-5 text-muted-foreground">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  note,
  value,
}: {
  icon: LucideIcon;
  label: string;
  note: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-[.08em] text-muted-foreground">{label}</p>
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <p className="mt-2 text-[24px] font-semibold tabular-nums">{value}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{note}</p>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "confirmed" || status === "completed"
      ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : status === "no_show" || status === "cancelled"
        ? "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300"
        : "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 rounded-md border px-1.5 py-0.5 text-[9px] font-medium",
        tone,
      )}
    >
      {statusLabels[status] || status}
    </span>
  );
}

/* ---------------------------------------------------------------- overview */

function Overview({
  data,
  onSelect,
}: {
  data: AppointmentsWorkspace;
  onSelect: (tab: AppointmentsTab) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const todays = data.appointments.filter((item) => dayKey(item.startsAt) === today);
  const upcoming = data.appointments.filter(isUpcoming);
  const rate = noShowRate(data.appointments);
  const live = data.bookingPages.filter((page) => page.status === "live");

  if (!data.bookingPages.length && !data.appointments.length) {
    return (
      <EmptyState
        icon={CalendarRange}
        title="Create your first booking page"
        description="A booking page is one bookable offering — an intro call, a demo, a consultation. Once it is live you can share the link, embed it on your site, or route people to it with a routing form."
        action={
          <Button type="button" onClick={() => onSelect("booking-pages")}>
            <Plus className="h-4 w-4" /> Create a booking page
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Today"
          value={String(todays.length)}
          note={todays.length ? `Next at ${timeLabel(todays[0].startsAt)}` : "Nothing booked today"}
          icon={CalendarDays}
        />
        <StatCard
          label="Upcoming"
          value={String(upcoming.length)}
          note="Confirmed and ahead of now"
          icon={Clock3}
        />
        <StatCard
          label="No-show rate"
          value={`${rate.toFixed(1)}%`}
          note="Across bookings that have passed"
          icon={TriangleAlert}
        />
        <StatCard
          label="Live pages"
          value={`${live.length}/${data.bookingPages.length}`}
          note="Published and bookable"
          icon={CalendarRange}
        />
      </div>

      {data.payments.paidCount || data.payments.pendingCount ? (
        <a
          href="/dashboard?tab=payments"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
        >
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Wallet className="h-4 w-4" />
            </span>
            <div>
              <p className="text-[13px] font-medium">
                {money(data.payments.paidCents)} collected from bookings
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {data.payments.paidCount} paid
                {data.payments.pendingCount
                  ? ` · ${data.payments.pendingCount} awaiting payment`
                  : ""}
                {" · reconciled in Payments"}
              </p>
            </div>
          </div>
          <span className="flex items-center gap-1 text-[11px] font-medium text-primary">
            Open Payments <ExternalLink className="h-3.5 w-3.5" />
          </span>
        </a>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(300px,0.75fr)]">
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <h2 className="text-[15px] font-semibold">Upcoming appointments</h2>
            <Button type="button" variant="ghost" size="sm" onClick={() => onSelect("appointments")}>
              View all <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
          {upcoming.length ? (
            <div className="divide-y divide-border">
              {upcoming.slice(0, 8).map((item) => (
                <div key={item.id} className="flex items-center gap-3 py-3">
                  <span
                    className="h-8 w-1 shrink-0 rounded-full"
                    style={{ backgroundColor: item.color }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-medium">
                      {item.inviteeName || item.inviteeEmail || "Unnamed invitee"}
                    </p>
                    <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                      {item.bookingPageName || "Booking"} · {dateLabel(item.startsAt)} at{" "}
                      {timeLabel(item.startsAt)}
                    </p>
                  </div>
                  <StatusPill status={item.status} />
                </div>
              ))}
            </div>
          ) : (
            <p className="py-8 text-center text-[12px] text-muted-foreground">
              Nothing booked yet. Share a booking page link to start taking appointments.
            </p>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-[15px] font-semibold">Booking page performance</h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            How many people who opened a page actually booked.
          </p>
          <div className="mt-4 space-y-3">
            {data.bookingPages.length ? (
              data.bookingPages.slice(0, 6).map((page) => (
                <div key={page.id}>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="min-w-0 truncate font-medium">{page.name}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {page.bookings}/{page.views || 0}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(100, conversionRate(page))}%`,
                        backgroundColor: page.color,
                      }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <p className="text-[12px] text-muted-foreground">No booking pages yet.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- booking pages */

function BookingPages({
  onCreate,
  onDelete,
  onEdit,
  pages,
  working,
}: {
  onCreate: () => void;
  onDelete: (page: BookingPage) => void;
  onEdit: (page: BookingPage) => void;
  pages: BookingPage[];
  working: boolean;
}) {
  return (
    <div>
      <SectionHeading
        title="Booking pages"
        description="Each page is one bookable offering, with its own duration, location, hosts and booking form."
        action={
          <Button type="button" onClick={onCreate}>
            <Plus className="h-4 w-4" /> New booking page
          </Button>
        }
      />
      {pages.length ? (
        <PaginatedCardGrid
          items={pages}
          pageSize={12}
          itemLabel="booking pages"
          getKey={(page) => page.id}
          renderItem={(page) => (
            <div
              className="flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg"
            >
              <div className="h-1.5" style={{ backgroundColor: page.color }} />
              <div className="flex min-h-0 flex-1 flex-col p-4">
                <div className="flex items-start justify-between gap-2">
                  <button type="button" onClick={() => onEdit(page)} className="min-w-0 flex-1 text-left">
                    <p className="truncate text-[14px] font-semibold">{page.name}</p>
                  </button>
                  <Badge
                    variant="outline"
                    className={cn(
                      "shrink-0 text-[9px]",
                      page.status === "live"
                        ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        : "border-border text-muted-foreground",
                    )}
                  >
                    {page.status === "live" ? "Live" : "Draft"}
                  </Badge>
                </div>
                <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                  {page.description || "No description yet."}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Badge variant="outline" className="text-[9px]">{page.durationMinutes} min</Badge>
                  <Badge variant="outline" className="text-[9px]">
                    {locationLabels[page.locationType]}
                  </Badge>
                  <Badge variant="outline" className="text-[9px]">
                    {schedulingLabels[page.schedulingType]}
                  </Badge>
                  {page.priceCents ? (
                    <Badge variant="outline" className="text-[9px]">
                      {money(page.priceCents, page.currency)}
                    </Badge>
                  ) : null}
                </div>
                <div className="mt-auto flex items-center justify-between pt-4 text-[10px] text-muted-foreground">
                  <span>
                    {page.bookings} booked
                    {page.views ? ` · ${conversionRate(page).toFixed(0)}% conversion` : ""}
                  </span>
                  <span className="flex items-center gap-1">
                    <button type="button" className="font-medium text-primary" onClick={() => onEdit(page)}>
                      Edit
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-destructive"
                      disabled={working}
                      aria-label={`Delete ${page.name}`}
                      onClick={() => onDelete(page)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </span>
                </div>
              </div>
            </div>
          )}
        />
      ) : (
        <div className="mt-5">
          <EmptyState
            icon={CalendarRange}
            title="No booking pages yet"
            description="Create one to start taking appointments. You can share its link, embed it on your site, or route people to it from a routing form."
            action={
              <Button type="button" onClick={onCreate}>
                <Plus className="h-4 w-4" /> New booking page
              </Button>
            }
          />
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------- routing forms */

function RoutingForms({
  forms,
  onCreate,
  onDelete,
  onEdit,
  pages,
  working,
}: {
  forms: RoutingForm[];
  onCreate: () => void;
  onDelete: (form: RoutingForm) => void;
  onEdit: (form: RoutingForm) => void;
  pages: BookingPage[];
  working: boolean;
}) {
  return (
    <div>
      <SectionHeading
        title="Routing forms"
        description="Ask a few questions before any time slot is shown, then send each visitor to the right booking page and host."
        action={
          <Button type="button" onClick={onCreate} disabled={!pages.length}>
            <Plus className="h-4 w-4" /> New routing form
          </Button>
        }
      />
      {!pages.length ? (
        <div className="mt-5">
          <EmptyState
            icon={GitBranch}
            title="Create a booking page first"
            description="A routing form sends people to a booking page, so there has to be at least one to route to."
          />
        </div>
      ) : forms.length ? (
        <PaginatedCardGrid
          items={forms}
          pageSize={12}
          itemLabel="routing forms"
          getKey={(form) => form.id}
          renderItem={(form) => (
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold">{form.name}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {form.questions.length} question{form.questions.length === 1 ? "" : "s"} ·{" "}
                    {form.routingRules.length} rule{form.routingRules.length === 1 ? "" : "s"}
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className={cn(
                    "shrink-0 text-[9px]",
                    form.status === "live"
                      ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                      : "border-border text-muted-foreground",
                  )}
                >
                  {form.status === "live" ? "Live" : "Draft"}
                </Badge>
              </div>
              <div className="mt-3 space-y-1">
                {form.routingRules.slice(0, 3).map((rule, index) => {
                  const target = pages.find((page) => page.id === rule.bookingPageId);
                  return (
                    <p key={rule.id} className="truncate text-[10px] text-muted-foreground">
                      {index + 1}. {rule.operator.replace("_", " ")} “{rule.value}” →{" "}
                      <span className="text-foreground">{target?.name || "unassigned"}</span>
                    </p>
                  );
                })}
                {form.routingRules.length > 3 ? (
                  <p className="text-[10px] text-muted-foreground">
                    +{form.routingRules.length - 3} more
                  </p>
                ) : null}
              </div>
              <div className="mt-4 flex items-center justify-end gap-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-[11px]"
                  onClick={() => onEdit(form)}
                >
                  Edit
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-destructive"
                  disabled={working}
                  aria-label={`Delete ${form.name}`}
                  onClick={() => onDelete(form)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        />
      ) : (
        <div className="mt-5">
          <EmptyState
            icon={GitBranch}
            title="No routing forms yet"
            description="Route a sales question to the sales round-robin, a support question to the support page, and an enterprise enquiry straight to a senior rep."
            action={
              <Button type="button" onClick={onCreate}>
                <Plus className="h-4 w-4" /> New routing form
              </Button>
            }
          />
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- calendar */

function InternalCalendar({ data }: { data: AppointmentsWorkspace }) {
  const [pageFilter, setPageFilter] = useState("all");
  const [weekOffset, setWeekOffset] = useState(0);

  const days = useMemo(() => {
    const now = new Date();
    const weekday = (now.getDay() + 6) % 7;
    const monday = new Date(now);
    monday.setHours(0, 0, 0, 0);
    monday.setDate(now.getDate() - weekday + weekOffset * 7);
    return Array.from({ length: 7 }, (_unused, index) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + index);
      return date;
    });
  }, [weekOffset]);

  const visible = data.appointments.filter(
    (item) => pageFilter === "all" || item.bookingPageId === pageFilter,
  );

  return (
    <div>
      <SectionHeading
        title="Calendar"
        description="Everything booked, week by week. Use the Appointments tab when you need to search rather than browse."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Select value={pageFilter} onValueChange={setPageFilter}>
              <SelectTrigger className="h-9 w-[180px] text-[12px]" aria-label="Filter by booking page">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All booking pages</SelectItem>
                {data.bookingPages.map((page) => (
                  <SelectItem key={page.id} value={page.id}>{page.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" size="sm" onClick={() => setWeekOffset((value) => value - 1)}>
              Previous
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setWeekOffset(0)}>
              Today
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setWeekOffset((value) => value + 1)}>
              Next
            </Button>
          </div>
        }
      />
      <div className="dashboard-scroll mt-5 overflow-x-auto">
        <div className="grid min-w-[880px] grid-cols-7 gap-2">
          {days.map((date) => {
            const key = date.toISOString().slice(0, 10);
            const dayItems = visible
              .filter((item) => dayKey(item.startsAt) === key)
              .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
            const isToday = key === new Date().toISOString().slice(0, 10);
            return (
              <div
                key={key}
                className={cn(
                  "min-h-[340px] rounded-lg border p-2",
                  isToday ? "border-primary/40 bg-primary/4" : "border-border",
                )}
              >
                <p className="text-[10px] uppercase tracking-[.06em] text-muted-foreground">
                  {new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(date)}
                </p>
                <p className={cn("text-[16px] font-semibold", isToday && "text-primary")}>
                  {date.getDate()}
                </p>
                <div className="mt-2 space-y-1.5">
                  {dayItems.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-md border-l-[3px] bg-muted/50 p-1.5"
                      style={{ borderLeftColor: item.color }}
                    >
                      <p className="text-[10px] font-semibold tabular-nums">{timeLabel(item.startsAt)}</p>
                      <p className="truncate text-[10px]">{item.inviteeName || item.inviteeEmail}</p>
                      <p className="truncate text-[9px] text-muted-foreground">{item.bookingPageName}</p>
                    </div>
                  ))}
                  {!dayItems.length ? (
                    <p className="pt-2 text-center text-[9px] text-muted-foreground">—</p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------- appointments table */

function AppointmentsTable({ data }: { data: AppointmentsWorkspace }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState("all");

  const query = search.trim().toLowerCase();
  const filtered = status !== "all" || page !== "all" || query;
  const rows = data.appointments.filter((item) => {
    if (status !== "all" && item.status !== status) return false;
    if (page !== "all" && item.bookingPageId !== page) return false;
    if (!query) return true;
    return [item.inviteeName, item.inviteeEmail, item.bookingPageName, item.hostName]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });

  const exportCsv = () => {
    const lines = [
      ["Name", "Email", "Booking page", "Host", "Starts", "Status", "Payment", "Amount"],
      ...rows.map((item) => [
        item.inviteeName,
        item.inviteeEmail,
        item.bookingPageName,
        item.hostName,
        item.startsAt,
        item.status,
        item.paymentStatus,
        String(item.amountCents / 100),
      ]),
    ]
      .map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([lines], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "appointments.csv";
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success(`${rows.length} appointment${rows.length === 1 ? "" : "s"} exported.`);
  };

  return (
    <div>
      <SectionHeading
        title="Appointments"
        description="Every booking in one searchable table — for finding a specific person or exporting a period, rather than browsing a week."
        action={
          <Button type="button" variant="outline" size="sm" disabled={!rows.length} onClick={exportCsv}>
            Export CSV
          </Button>
        }
      />
      <div className="mt-4 flex flex-wrap gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, email, host or page"
            aria-label="Search appointments"
            className="h-9 pl-9 text-[12px]"
          />
        </div>
        <Select value={page} onValueChange={setPage}>
          <SelectTrigger className="h-9 w-[180px] text-[12px]" aria-label="Filter by booking page">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All booking pages</SelectItem>
            {data.bookingPages.map((item) => (
              <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-9 w-[150px] text-[12px]" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {Object.entries(statusLabels).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {rows.length ? (
        <div className="dashboard-scroll mt-4 overflow-x-auto">
          <table className="w-full min-w-[900px] text-left">
            <thead className="border-b border-border text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
              <tr>
                <th className="py-3 font-medium">Invitee</th>
                <th className="py-3 font-medium">Booking page</th>
                <th className="py-3 font-medium">Host</th>
                <th className="py-3 font-medium">When</th>
                <th className="py-3 font-medium">Status</th>
                <th className="py-3 font-medium">Payment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((item) => (
                <tr key={item.id} className="text-[12px]">
                  <td className="max-w-[220px] py-3 pr-4">
                    <p className="truncate font-medium">{item.inviteeName || "No name given"}</p>
                    <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                      {item.inviteeEmail}
                    </p>
                  </td>
                  <td className="py-3 pr-4 text-muted-foreground">
                    {item.bookingPageName || "Booked directly"}
                    {item.externalSource ? (
                      <Badge variant="outline" className="ml-1.5 text-[8px] capitalize">
                        {item.externalSource}
                      </Badge>
                    ) : null}
                  </td>
                  <td className="py-3 pr-4 text-muted-foreground">{item.hostName || "Unassigned"}</td>
                  <td className="whitespace-nowrap py-3 pr-4 text-muted-foreground">
                    {dateLabel(item.startsAt)} · {timeLabel(item.startsAt)}
                  </td>
                  <td className="py-3 pr-4"><StatusPill status={item.status} /></td>
                  <td className="py-3 text-muted-foreground">
                    {item.paymentStatus === "not_required"
                      ? "Free"
                      : `${item.paymentStatus} · ${money(item.amountCents, item.currency)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-5">
          <EmptyState
            icon={Filter}
            title={filtered ? "No matching appointments" : "No appointments yet"}
            description={
              filtered
                ? "Try a different search or clear the filters."
                : "Bookings will appear here as soon as someone books one of your pages."
            }
          />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ availability */

function AvailabilityPanel({
  data,
  onAddBlackout,
  onRemoveBlackout,
  onSave,
  working,
}: {
  data: AppointmentsWorkspace;
  onAddBlackout: (input: { startsOn: string; endsOn: string; reason: string; reasonType: string }) => void;
  onRemoveBlackout: (id: string) => void;
  onSave: (input: Partial<Availability>) => void;
  working: boolean;
}) {
  const [draft, setDraft] = useState<Availability>(data.availability);
  const [blackout, setBlackout] = useState({
    startsOn: "",
    endsOn: "",
    reason: "",
    reasonType: "public_holiday",
  });

  const edit = (patch: Partial<Availability>) => setDraft((current) => ({ ...current, ...patch }));
  const setDay = (day: string, windows: Array<{ start: string; end: string }>) =>
    edit({ weeklyHours: { ...draft.weeklyHours, [day]: windows } });
  const setReason = (day: string, reason: DayReason) =>
    edit({ dayReasons: { ...(draft.dayReasons || {}), [day]: reason } });

  return (
    <div>
      <SectionHeading
        title="Availability"
        description="Working hours, buffers and limits. Every booking page offers slots inside these rules."
        action={
          <Button type="button" disabled={working} onClick={() => onSave(draft)}>
            {working && <Loader2 className="h-4 w-4 animate-spin" />} Save availability
          </Button>
        }
      />
      <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(300px,0.9fr)]">
        <section className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-[14px] font-semibold">Working hours</h3>
          <div className="mt-3 space-y-2">
            {WEEKDAYS.map((day) => {
              const windows = draft.weeklyHours[day.key] || [];
              const enabled = windows.length > 0;
              const reason = draft.dayReasons?.[day.key] || { type: "weekend", note: "" };
              return (
                <div
                  key={day.key}
                  className="flex flex-wrap items-center gap-2 border-b border-border/60 py-2 last:border-0"
                >
                  <label className="flex min-w-[132px] items-center gap-2 text-[12px]">
                    <Switch
                      checked={enabled}
                      onCheckedChange={(checked) =>
                        setDay(day.key, checked ? [{ start: "09:00", end: "17:00" }] : [])
                      }
                    />
                    {day.label}
                  </label>
                  {enabled ? (
                    <div className="flex items-center gap-1.5">
                      <Input
                        type="time"
                        value={windows[0].start}
                        onChange={(event) => setDay(day.key, [{ ...windows[0], start: event.target.value }])}
                        className="h-8 w-[112px] text-[11px]"
                        aria-label={`${day.label} start`}
                      />
                      <span className="text-[11px] text-muted-foreground">to</span>
                      <Input
                        type="time"
                        value={windows[0].end}
                        onChange={(event) => setDay(day.key, [{ ...windows[0], end: event.target.value }])}
                        className="h-8 w-[112px] text-[11px]"
                        aria-label={`${day.label} end`}
                      />
                    </div>
                  ) : (
                    <div className="flex flex-1 flex-wrap items-center gap-1.5">
                      <Select
                        value={reason.type}
                        onValueChange={(value) => setReason(day.key, { ...reason, type: value })}
                      >
                        <SelectTrigger
                          className="h-8 w-[210px] text-[11px]"
                          aria-label={`Why ${day.label} is unavailable`}
                        >
                          <SelectValue placeholder="Why?" />
                        </SelectTrigger>
                        <SelectContent>
                          {unavailableReasons.map((item) => (
                            <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {reason.type === "other" ? (
                        <Input
                          value={reason.note || ""}
                          onChange={(event) => setReason(day.key, { ...reason, note: event.target.value })}
                          placeholder="Say why in your own words"
                          aria-label={`${day.label} custom reason`}
                          className="h-8 min-w-[180px] flex-1 text-[11px]"
                        />
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <div className="space-y-4">
          <section className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-[14px] font-semibold">Scheduling rules</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <NumberField label="Buffer before (min)" value={draft.bufferBeforeMinutes} onChange={(value) => edit({ bufferBeforeMinutes: value })} />
              <NumberField label="Buffer after (min)" value={draft.bufferAfterMinutes} onChange={(value) => edit({ bufferAfterMinutes: value })} />
              <NumberField label="Minimum notice (min)" value={draft.minimumNoticeMinutes} onChange={(value) => edit({ minimumNoticeMinutes: value })} />
              <NumberField label="Book up to (days)" value={draft.maximumAdvanceDays} onChange={(value) => edit({ maximumAdvanceDays: value })} />
              <NumberField label="Daily cap (0 = none)" value={draft.dailyBookingCap} onChange={(value) => edit({ dailyBookingCap: value })} />
              <NumberField label="Slot interval (min)" value={draft.slotIntervalMinutes} onChange={(value) => edit({ slotIntervalMinutes: value })} />
            </div>
            <div className="mt-3 space-y-1.5">
              <Label className="text-[11px]">Timezone</Label>
              <Input
                value={draft.timezone}
                onChange={(event) => edit({ timezone: event.target.value })}
                placeholder="Africa/Lagos"
                className="h-8 text-[11px]"
              />
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-[14px] font-semibold">Blackout dates</h3>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Holidays and time off. Nothing can be booked inside these ranges.
            </p>
            <div className="mt-3 space-y-2">
              {data.blackoutDates.map((item) => (
                <div key={item.id} className="flex items-center gap-2 rounded-md border border-border p-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-medium">
                      {item.startsOn}
                      {item.endsOn !== item.startsOn ? ` → ${item.endsOn}` : ""}
                    </p>
                    <p className="truncate text-[10px] text-muted-foreground">
                      {reasonLabel(item.reasonType, item.reason)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive"
                    aria-label={`Remove blackout starting ${item.startsOn}`}
                    onClick={() => onRemoveBlackout(item.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              {!data.blackoutDates.length ? (
                <p className="text-[11px] text-muted-foreground">None set.</p>
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Input
                type="date"
                value={blackout.startsOn}
                aria-label="Blackout start"
                onChange={(event) => setBlackout({ ...blackout, startsOn: event.target.value })}
                className="h-8 flex-1 text-[11px]"
              />
              <Input
                type="date"
                value={blackout.endsOn}
                aria-label="Blackout end"
                onChange={(event) => setBlackout({ ...blackout, endsOn: event.target.value })}
                className="h-8 flex-1 text-[11px]"
              />
              <Select
                value={blackout.reasonType}
                onValueChange={(value) => setBlackout({ ...blackout, reasonType: value })}
              >
                <SelectTrigger className="h-8 w-full text-[11px]" aria-label="Blackout reason">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {unavailableReasons.map((item) => (
                    <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {blackout.reasonType === "other" ? (
                <Input
                  value={blackout.reason}
                  onChange={(event) => setBlackout({ ...blackout, reason: event.target.value })}
                  placeholder="Say why in your own words"
                  aria-label="Custom blackout reason"
                  className="h-8 w-full text-[11px]"
                />
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 w-full"
                disabled={!blackout.startsOn || working}
                onClick={() => {
                  onAddBlackout({
                    startsOn: blackout.startsOn,
                    endsOn: blackout.endsOn || blackout.startsOn,
                    reason: blackout.reason,
                    reasonType: blackout.reasonType,
                  });
                  setBlackout({ startsOn: "", endsOn: "", reason: "", reasonType: "public_holiday" });
                }}
              >
                <Plus className="h-3.5 w-3.5" /> Add
              </Button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function NumberField({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px]">{label}</Label>
      <Input
        type="number"
        min={0}
        value={value}
        onChange={(event) => onChange(Number(event.target.value) || 0)}
        className="h-8 text-[11px]"
      />
    </div>
  );
}

/* --------------------------------------------------------------- analytics */

function AnalyticsPanel({
  analytics,
  days,
  loading,
  onDaysChange,
}: {
  analytics: AppointmentsAnalytics | undefined;
  days: number;
  loading: boolean;
  onDaysChange: (days: number) => void;
}) {
  const peak = analytics?.popularHours.length
    ? analytics.popularHours.reduce((best, entry) => (entry.booked > best.booked ? entry : best))
    : undefined;

  return (
    <div>
      <SectionHeading
        title="Analytics"
        description="Booking volume, view-to-booked conversion, no-shows and revenue across your pages and hosts."
        action={
          <Select value={String(days)} onValueChange={(value) => onDaysChange(Number(value))}>
            <SelectTrigger className="h-9 w-[150px] text-[12px]" aria-label="Reporting period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[7, 30, 90, 180, 365].map((option) => (
                <SelectItem key={option} value={String(option)}>Last {option} days</SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
      {loading ? (
        <div className="flex min-h-[240px] items-center justify-center" role="status">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : !analytics ? (
        <div className="mt-5">
          <EmptyState
            icon={BarChart3}
            title="No analytics yet"
            description="Once bookings come in, conversion and no-show trends appear here."
          />
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Booked"
              value={String(analytics.trend.reduce((total, day) => total + day.total, 0))}
              note={`Last ${analytics.days} days`}
              icon={CalendarDays}
            />
            <StatCard
              label="No-shows"
              value={String(analytics.trend.reduce((total, day) => total + day.noShows, 0))}
              note="Marked as no-show"
              icon={TriangleAlert}
            />
            <StatCard
              label="Revenue"
              value={money(analytics.trend.reduce((total, day) => total + day.revenueCents, 0))}
              note="From paid bookings"
              icon={BarChart3}
            />
            <StatCard
              label="Busiest hour"
              value={peak ? `${String(peak.hour).padStart(2, "0")}:00` : "No bookings yet"}
              note={peak ? `${peak.booked} booked` : "No pattern yet"}
              icon={Clock3}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <section className="rounded-xl border border-border bg-card p-5">
              <h3 className="text-[14px] font-semibold">Bookings over time</h3>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Confirmed bookings per day, with no-shows underneath.
              </p>
              {analytics.trend.length ? (
                <div className="mt-4 h-[220px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={analytics.trend} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                      <defs>
                        <linearGradient id="apptBooked" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10 }}
                        stroke="hsl(var(--muted-foreground))"
                        tickFormatter={(value: string) => value.slice(5)}
                      />
                      <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                      <ChartTooltip
                        contentStyle={{
                          background: "hsl(var(--popover))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: 8,
                          fontSize: 11,
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="total"
                        name="Booked"
                        stroke="hsl(var(--primary))"
                        strokeWidth={2}
                        fill="url(#apptBooked)"
                      />
                      <Area
                        type="monotone"
                        dataKey="noShows"
                        name="No-shows"
                        stroke="#E11D48"
                        strokeWidth={1.5}
                        fill="transparent"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="py-12 text-center text-[12px] text-muted-foreground">
                  No bookings in this period yet.
                </p>
              )}
            </section>

            <section className="rounded-xl border border-border bg-card p-5">
              <h3 className="text-[14px] font-semibold">Popular times</h3>
              <p className="mt-1 text-[11px] text-muted-foreground">
                When people actually book — useful for shaping your availability.
              </p>
              {analytics.popularHours.length ? (
                <div className="mt-4 h-[220px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={analytics.popularHours} margin={{ top: 4, right: 8, bottom: 0, left: -22 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis
                        dataKey="hour"
                        tick={{ fontSize: 10 }}
                        stroke="hsl(var(--muted-foreground))"
                        tickFormatter={(value: number) => `${String(value).padStart(2, "0")}h`}
                      />
                      <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" allowDecimals={false} />
                      <ChartTooltip
                        cursor={{ fill: "hsl(var(--muted))" }}
                        contentStyle={{
                          background: "hsl(var(--popover))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: 8,
                          fontSize: 11,
                        }}
                      />
                      <Bar dataKey="booked" name="Booked" radius={[4, 4, 0, 0]}>
                        {analytics.popularHours.map((entry) => (
                          <Cell
                            key={entry.hour}
                            fill={
                              peak && entry.hour === peak.hour
                                ? "hsl(var(--primary))"
                                : "hsl(var(--primary) / 0.35)"
                            }
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="py-12 text-center text-[12px] text-muted-foreground">
                  No pattern yet — this fills in as bookings arrive.
                </p>
              )}
            </section>
          </div>

          <section className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-[14px] font-semibold">By booking page</h3>
            {analytics.pages.length ? (
              <div className="dashboard-scroll mt-3 overflow-x-auto">
                <table className="w-full min-w-[640px] text-left">
                  <thead className="border-b border-border text-[10px] uppercase tracking-[.08em] text-muted-foreground">
                    <tr>
                      <th className="py-2 font-medium">Page</th>
                      <th className="py-2 font-medium">Views</th>
                      <th className="py-2 font-medium">Booked</th>
                      <th className="py-2 font-medium">Conversion</th>
                      <th className="py-2 font-medium">No-shows</th>
                      <th className="py-2 font-medium">Revenue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {analytics.pages.map((row) => (
                      <tr key={row.id} className="text-[12px]">
                        <td className="py-2.5 pr-4 font-medium">{row.name}</td>
                        <td className="py-2.5 pr-4 tabular-nums text-muted-foreground">{row.views}</td>
                        <td className="py-2.5 pr-4 tabular-nums">{row.booked}</td>
                        <td className="py-2.5 pr-4 tabular-nums">{row.conversion.toFixed(1)}%</td>
                        <td className="py-2.5 pr-4 tabular-nums text-muted-foreground">{row.noShows}</td>
                        <td className="py-2.5 tabular-nums">{money(row.revenueCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-2 text-[12px] text-muted-foreground">No booking pages yet.</p>
            )}
          </section>

          <section className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-[14px] font-semibold">By host</h3>
            <div className="mt-3 space-y-2">
              {analytics.hosts.length ? (
                analytics.hosts.map((row) => (
                  <div key={row.host} className="flex items-center justify-between text-[12px]">
                    <span className="min-w-0 truncate">{row.host}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {row.booked} booked · {row.noShows} no-show
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-[12px] text-muted-foreground">No host data yet.</p>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- settings */

function SettingsPanel({ data }: { data: AppointmentsWorkspace }) {
  const [pageId, setPageId] = useState(data.bookingPages[0]?.id || "");
  const [embedType, setEmbedType] = useState("iframe");
  const [snippet, setSnippet] = useState("");
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    if (!pageId) return;
    setLoading(true);
    try {
      const result = await getEmbedSnippet(pageId, embedType);
      setSnippet(result.snippet);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The snippet could not be generated.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <SectionHeading
        title="Settings"
        description="Reminders, policy, and the embed snippet for putting a booking page on your own site."
      />
      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-[14px] font-semibold">Embed a booking page</h3>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Put booking on your own marketing site instead of only a MaxForm link.
          </p>
          {data.bookingPages.length ? (
            <>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Select value={pageId} onValueChange={setPageId}>
                  <SelectTrigger className="h-9 min-w-[160px] flex-1 text-[12px]" aria-label="Booking page to embed">
                    <SelectValue placeholder="Choose a booking page" />
                  </SelectTrigger>
                  <SelectContent>
                    {data.bookingPages.map((page) => (
                      <SelectItem key={page.id} value={page.id}>{page.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={embedType} onValueChange={setEmbedType}>
                  <SelectTrigger className="h-9 w-[142px] text-[12px]" aria-label="Embed type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="iframe">Inline iframe</SelectItem>
                    <SelectItem value="js_widget">JS widget</SelectItem>
                    <SelectItem value="link">Direct link</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  size="sm"
                  className="h-9"
                  disabled={!pageId || loading}
                  onClick={() => void generate()}
                >
                  {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Generate
                </Button>
              </div>
              {snippet ? (
                <div className="mt-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-[11px]">Snippet</Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 text-[11px]"
                      onClick={() => {
                        void navigator.clipboard.writeText(snippet);
                        toast.success("Snippet copied.");
                      }}
                    >
                      <Copy className="h-3.5 w-3.5" /> Copy
                    </Button>
                  </div>
                  <pre className="dashboard-scroll mt-1 max-h-40 overflow-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-[10px] leading-4">
                    {snippet}
                  </pre>
                  <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
                    On a connected WordPress site, paste this into a Custom HTML block.
                  </p>
                </div>
              ) : null}
            </>
          ) : (
            <p className="mt-3 text-[12px] text-muted-foreground">
              Create a booking page first — there has to be something to embed.
            </p>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-[14px] font-semibold">Reminders and policy</h3>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Reminder emails are sent by the Email module using your appointment templates.
          </p>
          <div className="mt-3 space-y-2.5">
            <a
              href="/dashboard?tab=emails&section=templates"
              className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-[12px] transition-colors hover:border-primary/40"
            >
              <span className="min-w-0">
                <span className="font-medium">Appointment email templates</span>
                <span className="mt-0.5 block text-[10px] text-muted-foreground">
                  Confirmation, reminder, rescheduled and cancelled.
                </span>
              </span>
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </a>
            <a
              href="/dashboard?tab=workflows"
              className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-[12px] transition-colors hover:border-primary/40"
            >
              <span className="min-w-0">
                <span className="font-medium">Appointment workflow triggers</span>
                <span className="mt-0.5 block text-[10px] text-muted-foreground">
                  booked · cancelled · rescheduled · no_show
                </span>
              </span>
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </a>
            <div className="flex items-center gap-3 rounded-md border border-border p-3">
              <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium">Bookings recorded in CRM</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  Every invitee becomes a Contact, including bookings bridged from Calendly.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

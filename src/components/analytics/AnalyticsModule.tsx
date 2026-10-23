import { useState } from "react";
import { useSearchParams } from "react-router-dom";
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
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  Download,
  FileText,
  Globe2,
  Landmark,
  Loader2,
  MapPin,
  RefreshCw,
  TicketCheck,
  TrendingUp,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { usePersistentQuery } from "@/hooks/use-persistent-query";
import {
  getWorkspaceAnalytics,
  type AnalyticsCount,
  type AnalyticsData,
} from "@/lib/analytics";
import { analyticsWorkspaceQueryKey } from "@/lib/performance/analytics-module-preload";
import { SERVER_STATE_STALE_TIME } from "@/lib/performance/query-client";
import { formatCurrency } from "@/lib/regional-options";

type AnalyticsModuleProps = {
  userId?: string;
};

type AnalyticsView = "overview" | "performance" | "audience" | "commerce";

type MetricCardProps = {
  icon: typeof FileText;
  label: string;
  value: string;
  detail: string;
  current: number;
  previous: number;
};

const periods = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "365", label: "Last 12 months" },
] as const;

const analyticsTabs: Array<{ value: AnalyticsView; label: string }> = [
  { value: "overview", label: "Overview" },
  { value: "performance", label: "Performance" },
  { value: "audience", label: "Audience" },
  { value: "commerce", label: "Commerce" },
];

const colors = [
  "hsl(var(--primary))",
  "#0f766e",
  "#2563eb",
  "#7c3aed",
  "#d97706",
  "#db2777",
];

const number = (value: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);

const compact = (value: number) =>
  new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);

const dayLabel = (value: string, includeYear = false) => {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    ...(includeYear ? { year: "numeric" } : {}),
  }).format(date);
};

const dateTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "just now";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(date);
};

const periodLabel = (range: number) =>
  periods.find((period) => Number(period.value) === range)?.label || "Last 30 days";

const csvCell = (value: string | number) => {
  const string = String(value);
  return /[",\n]/.test(string) ? `"${string.replace(/"/g, '""')}"` : string;
};

const downloadAnalyticsCsv = (data: AnalyticsData, range: number) => {
  const { summary } = data;
  const rows: Array<Array<string | number>> = [
    ["Workspace analytics", periodLabel(range)],
    ["Generated", data.generatedAt],
    [],
    ["Metric", "Current period", "Previous period"],
    ["Recorded responses", summary.responses, summary.previous_responses],
    ["New contacts", summary.contacts, summary.previous_contacts],
    ["Event registrations", summary.event_registrations, summary.previous_event_registrations],
    ["Confirmed paid orders", summary.paid_orders, summary.previous_paid_orders],
    [`Confirmed revenue (${summary.currency})`, summary.paid_revenue, summary.previous_paid_revenue],
    ["Event check-ins", summary.checked_ins, ""],
    [],
    ["Daily activity"],
    ["Date", "Responses", "Contacts", "Event registrations", "Paid orders", `Revenue (${summary.currency})`],
    ...data.daily.map((item) => [
      item.date,
      item.responses,
      item.contacts,
      item.registrations,
      item.paid_orders,
      item.revenue,
    ]),
    [],
    ["Top response sources"],
    ["Name", "Responses", "Type"],
    ...data.topForms.map((item) => [
      item.title,
      item.responses,
      item.is_event_registration ? "Event registration" : "Form",
    ]),
    [],
    ["Countries"],
    ["Country", "Final responses"],
    ...data.countries.map((item) => [item.label, item.value]),
    [],
    ["Confirmed revenue by source"],
    ["Source", "Paid orders", `Revenue (${summary.currency})`],
    ...data.revenueSources.map((item) => [item.label, item.orders, item.revenue]),
  ];
  const content = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `workspace-analytics-${range}-days.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};

const printAnalyticsReport = (range: number) => {
  const originalTitle = document.title;
  document.title = `Workspace analytics - ${periodLabel(range)}`;
  window.print();
  window.setTimeout(() => {
    document.title = originalTitle;
  }, 0);
};

const change = (current: number, previous: number) => {
  if (!previous) {
    return current ? { value: "New", direction: "up" as const } : null;
  }
  const percentage = ((current - previous) / previous) * 100;
  if (Math.abs(percentage) < 0.5) {
    return { value: "No change", direction: "flat" as const };
  }
  return {
    value: `${Math.abs(percentage).toFixed(percentage >= 10 ? 0 : 1)}%`,
    direction: percentage > 0 ? ("up" as const) : ("down" as const),
  };
};

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  current,
  previous,
}: MetricCardProps) {
  const comparison = change(current, previous);
  const ComparisonIcon =
    comparison?.direction === "down"
      ? ArrowDownRight
      : comparison?.direction === "up"
        ? ArrowUpRight
        : Activity;

  return (
    <section className="min-w-0 border border-border bg-card p-5 shadow-[0_10px_28px_rgba(30,41,59,0.04)] dark:shadow-none">
      <div className="flex items-start justify-between gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Icon className="h-4.5 w-4.5" />
        </span>
        {comparison && (
          <span
            className={
              comparison.direction === "down"
                ? "flex items-center gap-1 text-[11px] font-medium text-rose-600 dark:text-rose-400"
                : "flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400"
            }
          >
            <ComparisonIcon className="h-3.5 w-3.5" />
            {comparison.value}
          </span>
        )}
      </div>
      <p className="mt-5 text-[12px] font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-[28px] font-semibold leading-none tracking-tight text-foreground">
        {value}
      </p>
      <p className="mt-3 min-h-4 text-[11px] text-muted-foreground">{detail}</p>
    </section>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex h-full min-h-[190px] items-center justify-center border border-dashed border-border bg-muted/20 px-6 text-center text-[12px] leading-5 text-muted-foreground">
      {message}
    </div>
  );
}

function HorizontalBreakdown({
  data,
  emptyMessage,
  valueFormatter = number,
}: {
  data: AnalyticsCount[];
  emptyMessage: string;
  valueFormatter?: (value: number) => string;
}) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  if (!data.length || !total) return <EmptyChart message={emptyMessage} />;

  return (
    <div className="space-y-3.5">
      {data.map((item, index) => {
        const share = (item.value / total) * 100;
        return (
          <div key={item.label}>
            <div className="flex items-center justify-between gap-3 text-[12px]">
              <span className="min-w-0 truncate font-medium text-foreground">{item.label}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {valueFormatter(item.value)}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{
                  backgroundColor: colors[index % colors.length],
                  width: `${Math.max(3, share)}%`,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CompositionCard({
  title,
  description,
  data,
  emptyMessage,
}: {
  title: string;
  description: string;
  data: AnalyticsCount[];
  emptyMessage: string;
}) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  return (
    <section className="min-w-0 border border-border bg-card p-5">
      <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
      <p className="mt-1 text-[11px] text-muted-foreground">{description}</p>
      {total ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-[126px_minmax(0,1fr)] sm:items-center">
          <div className="h-[132px]">
            <ResponsiveContainer height="100%" width="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  innerRadius={39}
                  outerRadius={58}
                  paddingAngle={3}
                  stroke="none"
                >
                  {data.map((item, index) => (
                    <Cell key={item.label} fill={colors[index % colors.length]} />
                  ))}
                </Pie>
                <RechartsTooltip
                  formatter={(value: number) => numberValue(value)}
                  contentStyle={tooltipStyle}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <HorizontalBreakdown data={data} emptyMessage={emptyMessage} />
        </div>
      ) : (
        <div className="mt-4">
          <EmptyChart message={emptyMessage} />
        </div>
      )}
    </section>
  );
}

const numberValue = (value: number | string) => number(Number(value));

const tooltipStyle = {
  background: "hsl(var(--popover))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 6,
  color: "hsl(var(--popover-foreground))",
  fontSize: 12,
};

function AnalyticsLoading() {
  return (
    <div className="space-y-7" aria-label="Loading workspace analytics" role="status">
      <div className="flex items-start justify-between gap-5">
        <div className="space-y-2">
          <Skeleton className="h-9 w-60" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-10 w-36" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <Skeleton key={item} className="h-40 rounded-none" />
        ))}
      </div>
      <Skeleton className="h-[360px] rounded-none" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Skeleton className="h-[280px] rounded-none" />
        <Skeleton className="h-[280px] rounded-none" />
      </div>
    </div>
  );
}

function AnalyticsContent({
  data,
  range,
  view,
}: {
  data: AnalyticsData;
  range: number;
  view: AnalyticsView;
}) {
  const { summary } = data;
  const hasActivity = data.daily.some(
    (item) => item.responses || item.contacts || item.registrations || item.paid_orders,
  );
  const stages = [
    { label: "Recorded responses", value: summary.responses, icon: FileText },
    { label: "Event registrations", value: summary.event_registrations, icon: TicketCheck },
    { label: "Confirmed payments", value: summary.paid_orders, icon: CheckCircle2 },
    { label: "Event check-ins", value: summary.checked_ins, icon: Users },
  ];
  const stageMaximum = Math.max(...stages.map((stage) => stage.value), 1);
  const paymentCompletion = summary.payment_attempts
    ? Math.round((summary.paid_orders / summary.payment_attempts) * 100)
    : null;
  const revenueData = data.revenueSources.map((item) => ({
    ...item,
    displayLabel: item.label,
  }));
  const showPerformance = view === "overview" || view === "performance";
  const showAudience = view === "overview" || view === "audience";
  const showCommerce = view === "overview" || view === "commerce";

  return (
    <>
      {view === "overview" && (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          current={summary.responses}
          detail={`${number(summary.published_forms)} published ${summary.published_forms === 1 ? "form" : "forms"}`}
          icon={FileText}
          label="Recorded responses"
          previous={summary.previous_responses}
          value={number(summary.responses)}
        />
        <MetricCard
          current={summary.contacts}
          detail="New people added to your CRM"
          icon={Users}
          label="New contacts"
          previous={summary.previous_contacts}
          value={number(summary.contacts)}
        />
        <MetricCard
          current={summary.event_registrations}
          detail={`${number(summary.upcoming_events)} upcoming live ${summary.upcoming_events === 1 ? "event" : "events"}`}
          icon={TicketCheck}
          label="Event registrations"
          previous={summary.previous_event_registrations}
          value={number(summary.event_registrations)}
        />
        <MetricCard
          current={summary.paid_revenue}
          detail={`${number(summary.paid_orders)} server-confirmed paid ${summary.paid_orders === 1 ? "order" : "orders"}`}
          icon={CircleDollarSign}
          label="Paid revenue"
          previous={summary.previous_paid_revenue}
          value={formatCurrency(summary.paid_revenue, summary.currency)}
        />
      </div>
      )}

      {showPerformance && (
      <section className="border border-border bg-card p-5 sm:p-6">
        <div className="flex flex-col gap-2 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-[16px] font-semibold text-foreground">Workspace activity</h2>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Final responses, new contacts, registrations, and confirmed payments over time.
            </p>
          </div>
          <span className="text-[11px] text-muted-foreground">Last {range} days</span>
        </div>
        <div className="mt-5 h-[300px]">
          {hasActivity ? (
            <ResponsiveContainer height="100%" width="100%">
              <AreaChart data={data.daily} margin={{ left: -16, right: 5, top: 8 }}>
                <defs>
                  <linearGradient id="analyticsResponses" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.24} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 4" vertical={false} />
                <XAxis
                  axisLine={false}
                  dataKey="date"
                  fontSize={10}
                  interval={range > 90 ? "preserveStartEnd" : undefined}
                  minTickGap={range > 30 ? 42 : 22}
                  tickFormatter={(value) => dayLabel(String(value))}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  axisLine={false}
                  fontSize={10}
                  tickFormatter={(value) => compact(Number(value))}
                  tickLine={false}
                />
                <RechartsTooltip
                  contentStyle={tooltipStyle}
                  formatter={(value: number, name: string) => [numberValue(value), seriesLabels[name] || name]}
                  labelFormatter={(value) => dayLabel(String(value), true)}
                />
                <Area
                  dataKey="responses"
                  fill="url(#analyticsResponses)"
                  name="responses"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2.25}
                  type="monotone"
                />
                <Area
                  dataKey="contacts"
                  fill="none"
                  name="contacts"
                  stroke="#0f766e"
                  strokeWidth={1.8}
                  type="monotone"
                />
                <Area
                  dataKey="registrations"
                  fill="none"
                  name="registrations"
                  stroke="#7c3aed"
                  strokeWidth={1.8}
                  type="monotone"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <EmptyChart message="Your activity trend will appear once a response, contact, registration, or paid order is recorded." />
          )}
        </div>
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-muted-foreground">
          {[
            ["Responses", "hsl(var(--primary))"],
            ["Contacts", "#0f766e"],
            ["Event registrations", "#7c3aed"],
          ].map(([label, color]) => (
            <span key={label} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
              {label}
            </span>
          ))}
        </div>
      </section>
      )}

      {showPerformance && (
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.34fr)_minmax(320px,0.66fr)]">
        <section className="min-w-0 border border-border bg-card p-5 sm:p-6">
          <div className="flex items-end justify-between gap-4 border-b border-border pb-4">
            <div>
              <h2 className="text-[16px] font-semibold text-foreground">Top response sources</h2>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Forms and event registration forms with the most final responses.
              </p>
            </div>
            <TrendingUp className="mb-0.5 h-4 w-4 shrink-0 text-primary" />
          </div>
          <div className="mt-5 h-[255px]">
            {data.topForms.length ? (
              <ResponsiveContainer height="100%" width="100%">
                <BarChart
                  data={data.topForms}
                  layout="vertical"
                  margin={{ bottom: 0, left: 4, right: 18, top: 0 }}
                >
                  <CartesianGrid horizontal={false} stroke="hsl(var(--border))" strokeDasharray="3 4" />
                  <XAxis
                    allowDecimals={false}
                    axisLine={false}
                    fontSize={10}
                    tickFormatter={(value) => compact(Number(value))}
                    tickLine={false}
                    type="number"
                  />
                  <YAxis
                    axisLine={false}
                    dataKey="title"
                    fontSize={11}
                    tick={{ fill: "hsl(var(--foreground))" }}
                    tickFormatter={(value) =>
                      String(value).length > 24 ? `${String(value).slice(0, 24)}…` : String(value)
                    }
                    tickLine={false}
                    type="category"
                    width={142}
                  />
                  <RechartsTooltip
                    contentStyle={tooltipStyle}
                    formatter={(value: number) => [numberValue(value), "Responses"]}
                  />
                  <Bar dataKey="responses" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart message="Your highest-performing forms will appear after the first final response." />
            )}
          </div>
        </section>

        <section className="border border-border bg-card p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
            <div>
              <h2 className="text-[16px] font-semibold text-foreground">Recorded outcomes</h2>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Completion milestones captured by your workspace.
              </p>
            </div>
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="mt-5 space-y-5">
            {stages.map((stage, index) => {
              const Icon = stage.icon;
              const width = (stage.value / stageMaximum) * 100;
              return (
                <div key={stage.label}>
                  <div className="flex items-center justify-between gap-4 text-[12px]">
                    <span className="flex min-w-0 items-center gap-2 font-medium text-foreground">
                      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{stage.label}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{number(stage.value)}</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full"
                      style={{
                        backgroundColor: colors[index],
                        width: `${stage.value ? Math.max(4, width) : 0}%`,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-6 border-t border-border pt-4 text-[11px] text-muted-foreground">
            {paymentCompletion == null
              ? "Payment completion will appear when checkout attempts are recorded."
              : `${paymentCompletion}% of checkout attempts in this period became confirmed payments.`}
          </div>
        </section>
      </div>
      )}

      {showAudience && (
      <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
        <CompositionCard
          data={data.lifecycle}
          description="Contacts created in the selected period."
          emptyMessage="Contact lifecycle distribution appears when new contacts are added."
          title="Contact lifecycle"
        />
        <CompositionCard
          data={data.responseSources}
          description="Final responses by collection type."
          emptyMessage="Response source mix appears after the first response."
          title="Response mix"
        />
        <section className="min-w-0 border border-border bg-card p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-semibold text-foreground">Submission countries</h2>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Resolved from the submitter request IP.
              </p>
            </div>
            <Globe2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          </div>
          <div className="mt-5">
            <HorizontalBreakdown
              data={data.countries}
              emptyMessage="Country data will appear for new submissions after location resolution."
            />
          </div>
        </section>
      </div>
      )}

      {showCommerce && (
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.12fr)_minmax(300px,0.88fr)]">
        <section className="min-w-0 border border-border bg-card p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
            <div>
              <h2 className="text-[16px] font-semibold text-foreground">Confirmed revenue by source</h2>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Paid orders in {summary.currency}; refunds and pending orders are not counted here.
              </p>
            </div>
            <Landmark className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          </div>
          <div className="mt-5 h-[244px]">
            {revenueData.length ? (
              <ResponsiveContainer height="100%" width="100%">
                <BarChart data={revenueData} margin={{ bottom: 0, left: -14, right: 10, top: 5 }}>
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 4" vertical={false} />
                  <XAxis axisLine={false} dataKey="displayLabel" fontSize={10} tickLine={false} />
                  <YAxis
                    axisLine={false}
                    fontSize={10}
                    tickFormatter={(value) =>
                      formatCurrency(Number(value), summary.currency, {
                        currencyDisplay: "narrowSymbol",
                        notation: "compact",
                      })
                    }
                    tickLine={false}
                  />
                  <RechartsTooltip
                    contentStyle={tooltipStyle}
                    formatter={(value: number) => [formatCurrency(Number(value), summary.currency), "Paid revenue"]}
                  />
                  <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart message="Confirmed revenue appears after the first successful payment." />
            )}
          </div>
          {summary.other_currency_paid_orders > 0 && (
            <p className="mt-4 border-t border-border pt-4 text-[11px] leading-5 text-muted-foreground">
              {number(summary.other_currency_paid_orders)} paid {summary.other_currency_paid_orders === 1 ? "order uses" : "orders use"} a
              different currency and {summary.other_currency_paid_orders === 1 ? "is" : "are"} not combined with this total.
            </p>
          )}
        </section>

        <section className="border border-border bg-card p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
            <div>
              <h2 className="text-[16px] font-semibold text-foreground">Payment methods</h2>
              <p className="mt-1 text-[12px] text-muted-foreground">Confirmed orders by checkout method.</p>
            </div>
            <CircleDollarSign className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          </div>
          <div className="mt-5">
            <HorizontalBreakdown
              data={data.providers}
              emptyMessage="Payment method activity appears after a confirmed order."
            />
          </div>
        </section>
      </div>
      )}

      {showCommerce && (
      <section className="border border-border bg-card p-5 sm:p-6">
        <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-[16px] font-semibold text-foreground">Upcoming event readiness</h2>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Live events with valid registrations and completed check-ins.
            </p>
          </div>
          <CalendarDays className="mb-0.5 h-4 w-4 shrink-0 text-primary" />
        </div>
        {data.upcomingEvents.length ? (
          <div className="dashboard-scroll mt-1 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left">
              <thead className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                <tr>
                  <th className="px-0 py-4 font-medium">Event</th>
                  <th className="px-4 py-4 font-medium">Starts</th>
                  <th className="px-4 py-4 text-right font-medium">Registered</th>
                  <th className="px-4 py-4 text-right font-medium">Checked in</th>
                  <th className="px-0 py-4 text-right font-medium">Capacity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.upcomingEvents.map((event) => {
                  const capacity = event.capacity_total;
                  const fill = capacity ? Math.min(100, (event.registrations / capacity) * 100) : null;
                  return (
                    <tr key={event.id} className="text-[12px]">
                      <td className="max-w-[280px] py-4 pr-5 font-medium text-foreground">
                        <span className="block truncate">{event.title}</span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 text-muted-foreground">
                        {dateTime(event.starts_at)}
                      </td>
                      <td className="px-4 py-4 text-right tabular-nums text-foreground">{number(event.registrations)}</td>
                      <td className="px-4 py-4 text-right tabular-nums text-foreground">{number(event.checked_ins)}</td>
                      <td className="py-4 text-right">
                        {capacity ? (
                          <span className="inline-flex min-w-[100px] flex-col items-end gap-1.5">
                            <span className="tabular-nums text-foreground">{number(event.registrations)} / {number(capacity)}</span>
                            <span className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                              <span className="block h-full rounded-full bg-primary" style={{ width: `${fill}%` }} />
                            </span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Unlimited</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-5">
            <EmptyChart message="Published upcoming events will appear here when they have a future start time." />
          </div>
        )}
      </section>
      )}

      <section className="flex flex-col gap-3 border border-border bg-muted/25 px-5 py-4 text-[11px] leading-5 text-muted-foreground sm:flex-row sm:items-start sm:justify-between">
        <p className="max-w-3xl">
          Analytics reports finalized records only. Pending payment submissions, cancelled orders, and voided event tickets are excluded. Visitor and form-start tracking are not collected yet, so this page does not infer drop-off rates.
        </p>
        <span className="shrink-0 whitespace-nowrap text-foreground">Refreshed {dateTime(data.generatedAt)}</span>
      </section>
    </>
  );
}

const seriesLabels: Record<string, string> = {
  contacts: "New contacts",
  registrations: "Event registrations",
  responses: "Recorded responses",
};

export function AnalyticsModule({ userId }: AnalyticsModuleProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [printingFullReport, setPrintingFullReport] = useState(false);
  const rangeParameter = Number(searchParams.get("range"));
  const range = periods.some((period) => Number(period.value) === rangeParameter)
    ? rangeParameter
    : 30;
  const requestedView = searchParams.get("view");
  const activeView: AnalyticsView = analyticsTabs.some(
    (tab) => tab.value === requestedView,
  )
    ? (requestedView as AnalyticsView)
    : "overview";
  const queryUserId = userId || "anonymous";
  const analyticsQuery = usePersistentQuery({
    cacheKey: `analytics:workspace:${queryUserId}:${range}`,
    cacheScope: queryUserId,
    enabled: Boolean(userId),
    persist: false,
    queryFn: () => getWorkspaceAnalytics(range),
    queryKey: analyticsWorkspaceQueryKey(queryUserId, range),
    refetchOnMount: false,
    staleTime: SERVER_STATE_STALE_TIME,
    tags: ["analytics", "workspace"],
  });

  const updateRange = (value: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("range", value);
    setSearchParams(next, { replace: true });
  };

  const updateView = (view: AnalyticsView) => {
    const next = new URLSearchParams(searchParams);
    next.set("view", view);
    setSearchParams(next, { replace: true });
  };

  const exportFullReport = () => {
    if (!analyticsQuery.data) return;
    setPrintingFullReport(true);
    window.setTimeout(() => {
      printAnalyticsReport(range);
      setPrintingFullReport(false);
    }, 80);
  };

  if (analyticsQuery.isInitialLoading || !userId) return <AnalyticsLoading />;

  return (
    <div className="space-y-7 pb-5" data-analytics-report>
      <header className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-primary">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10">
              <TrendingUp className="h-3.5 w-3.5" />
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em]">Live workspace data</span>
          </div>
          <h1 className="mt-3 text-[30px] font-semibold tracking-tight text-foreground sm:text-[34px]">
            Workspace analytics
          </h1>
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            Performance across forms, contacts, events, and confirmed payments.
          </p>
          <p className="mt-2 text-[11px] font-medium text-foreground" data-analytics-period>
            Reporting period: {periodLabel(range)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2" data-analytics-controls>
          <Select value={String(range)} onValueChange={updateRange}>
            <SelectTrigger aria-label="Analytics date range" className="h-9 w-[145px] text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {periods.map((period) => (
                <SelectItem key={period.value} value={period.value}>{period.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            className="h-9 text-[12px]"
            disabled={analyticsQuery.isFetching}
            onClick={() => void analyticsQuery.refetch()}
            size="sm"
            type="button"
            variant="outline"
          >
            {analyticsQuery.isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="h-9 text-[12px]" size="sm" type="button" variant="outline">
                <Download className="h-3.5 w-3.5" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem disabled={!analyticsQuery.data} onClick={exportFullReport}>
                Export full PDF report
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!analyticsQuery.data}
                onClick={() => {
                  if (analyticsQuery.data) downloadAnalyticsCsv(analyticsQuery.data, range);
                }}
              >
                Download CSV data
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <nav
        aria-label="Analytics views"
        className="dashboard-scroll dashboard-scroll-x flex gap-1 overflow-x-auto border-b border-border"
        data-analytics-controls
        role="tablist"
      >
        {analyticsTabs.map((tab) => {
          const active = activeView === tab.value;
          return (
            <button
              aria-controls="analytics-report-content"
              aria-selected={active}
              className={
                active
                  ? "relative h-10 shrink-0 border-b-2 border-primary px-3 text-[12px] font-semibold text-foreground"
                  : "relative h-10 shrink-0 border-b-2 border-transparent px-3 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
              }
              key={tab.value}
              onClick={() => updateView(tab.value)}
              role="tab"
              type="button"
            >
              {tab.label}
            </button>
          );
        })}
      </nav>

      {analyticsQuery.isError ? (
        <section className="border border-destructive/30 bg-destructive/5 p-6 text-center">
          <MapPin className="mx-auto h-5 w-5 text-destructive" />
          <h2 className="mt-3 text-[15px] font-semibold text-foreground">Analytics could not be loaded</h2>
          <p className="mx-auto mt-1 max-w-md text-[12px] leading-5 text-muted-foreground">
            {analyticsQuery.error.message || "Please try again in a moment."}
          </p>
          <Button className="mt-4" onClick={() => void analyticsQuery.refetch()} size="sm" type="button">
            Try again
          </Button>
        </section>
      ) : analyticsQuery.data ? (
        <div id="analytics-report-content" role="tabpanel">
          <AnalyticsContent
            data={analyticsQuery.data}
            range={range}
            view={printingFullReport ? "overview" : activeView}
          />
        </div>
      ) : null}
    </div>
  );
}

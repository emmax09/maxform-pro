/**
 * What the workspace's automation is actually doing.
 *
 * Every number here is counted from execution rows the engine already writes,
 * so an empty workspace shows an empty state rather than a chart of zeroes
 * pretending to be data. The layout follows the platform's analytics idiom —
 * a metric strip, one time series, and ranked lists — rather than inventing a
 * second visual language for this module.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  CircleAlert,
  CircleCheck,
  Clock,
  RefreshCw,
  Workflow as WorkflowIcon,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { TableFilterSelect } from "@/components/shared/TableFilters";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getWorkflowAnalytics,
  workflowNodeCatalogEntry,
  type WorkflowAnalytics,
  type WorkflowLeaderboardRow,
} from "@/lib/workflows";
import { cn } from "@/lib/utils";

const RANGE_OPTIONS = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

/**
 * The chart palette as roles, declared once so light and dark swap together
 * and the series are written against meaning rather than raw hex.
 */
const vizRoot = [
  "[--viz-series:#2a78d6] dark:[--viz-series:#3987e5]",
  "[--viz-critical:#d03b3b] dark:[--viz-critical:#e05555]",
  "[--viz-grid:#e6e5e1] dark:[--viz-grid:#2e2e2c]",
].join(" ");

const dayLabel = (value: string) => {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

const relative = (value: string) => {
  if (!value) return "—";
  const when = new Date(value).getTime();
  if (Number.isNaN(when)) return "—";
  const minutes = Math.round((Date.now() - when) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

const duration = (ms: number) => {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  return seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds / 60)}m`;
};

const triggerLabel = (type: string) =>
  workflowNodeCatalogEntry(type)?.label ||
  type.replace(/^trigger\./, "").replace(/_/g, " ") ||
  "Manual";

const runTone = (status: string) =>
  status === "success"
    ? "text-emerald-700 dark:text-emerald-400"
    : status === "error"
      ? "text-destructive"
      : "text-muted-foreground";

/** A compact figure. The number is the chart — no one-bar bar charts. */
function Metric({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="min-w-0 px-4 py-3.5">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        <p className="truncate text-[11px] font-medium uppercase tracking-[0.08em]">
          {label}
        </p>
      </div>
      <p className="mt-1.5 truncate text-[24px] font-semibold leading-none tracking-tight tabular-nums">
        {value}
      </p>
      <p className="mt-1.5 truncate text-[11.5px] text-muted-foreground">{detail}</p>
    </div>
  );
}

/** Ranked magnitude across named workflows. One hue — length carries the value. */
function Leaderboard({
  rows,
  emptyLabel,
  metric,
  onOpen,
}: {
  rows: WorkflowLeaderboardRow[];
  emptyLabel: string;
  metric: (row: WorkflowLeaderboardRow) => { value: number; display: string };
  onOpen: (workflowId: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="py-7 text-center text-[12.5px] text-muted-foreground">
        {emptyLabel}
      </p>
    );
  }
  const largest = Math.max(...rows.map((row) => metric(row).value), 1);
  return (
    <ul className="space-y-2.5">
      {rows.map((row) => {
        const measure = metric(row);
        return (
          <li key={row.id} className="space-y-1">
            <div className="flex items-baseline justify-between gap-3">
              <button
                type="button"
                onClick={() => onOpen(row.id)}
                className="min-w-0 truncate rounded text-left text-[12.5px] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              >
                {row.name}
              </button>
              <span className="shrink-0 text-[12.5px] font-medium tabular-nums">
                {measure.display}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(2, (measure.value / largest) * 100)}%`,
                  backgroundColor: "var(--viz-series)",
                }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function AnalyticsSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <div className="grid divide-y divide-border overflow-hidden rounded-lg border border-border sm:grid-cols-2 sm:divide-x xl:grid-cols-4 xl:divide-y-0">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="space-y-2 px-4 py-3.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-6 w-16" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Skeleton className="h-[260px] rounded-lg" />
        <Skeleton className="h-[260px] rounded-lg" />
      </div>
    </div>
  );
}

export function WorkflowsAnalytics({
  onOpen,
}: {
  onOpen: (workflowId: string) => void;
}) {
  const [range, setRange] = useState("30");

  const analytics = useQuery<WorkflowAnalytics>({
    queryKey: ["workflow-analytics", range],
    queryFn: () => getWorkflowAnalytics(Number(range)),
  });

  const data = analytics.data;
  const trend = useMemo(() => data?.trend || [], [data]);
  const hasRuns = (data?.runs.total || 0) > 0;

  if (analytics.isLoading) return <AnalyticsSkeleton />;

  if (analytics.isError) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border py-14 text-center">
        <CircleAlert className="h-5 w-5 text-destructive" />
        <div>
          <p className="text-[14px] font-medium">Analytics could not be loaded</p>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            {analytics.error instanceof Error
              ? analytics.error.message
              : "Something went wrong reading your automation history."}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void analytics.refetch()}>
          <RefreshCw className="h-3.5 w-3.5" />
          Try again
        </Button>
      </div>
    );
  }

  return (
    <section className={cn("space-y-4", vizRoot)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-semibold">Automation overview</h2>
          <p className="text-[12.5px] text-muted-foreground">
            {data?.workflows.total || 0} workflow
            {data?.workflows.total === 1 ? "" : "s"} · {data?.runs.total || 0} run
            {data?.runs.total === 1 ? "" : "s"} in the last {data?.days || 30} days
          </p>
        </div>
        <div className="flex items-center gap-2">
          <TableFilterSelect
            value={range}
            onValueChange={setRange}
            options={RANGE_OPTIONS}
            label="Date range"
            className="w-[150px]"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={analytics.isFetching}
            onClick={() => void analytics.refetch()}
            aria-label="Refresh analytics"
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", analytics.isFetching && "animate-spin")}
            />
            Refresh
          </Button>
        </div>
      </div>

      {/* The headline numbers in one bordered strip rather than four floating
          cards — fewer edges to read past. */}
      <div className="grid divide-y divide-border overflow-hidden rounded-lg border border-border sm:grid-cols-2 sm:divide-x xl:grid-cols-4 xl:divide-y-0">
        <Metric
          icon={WorkflowIcon}
          label="Workflows"
          value={String(data?.workflows.total || 0)}
          detail={`${data?.workflows.active || 0} active · ${data?.workflows.draft || 0} draft · ${data?.workflows.paused || 0} paused`}
        />
        <Metric
          icon={Activity}
          label="Runs"
          value={String(data?.runs.total || 0)}
          detail={
            data?.runs.pending
              ? `${data.runs.pending} still in flight`
              : `Last ${data?.days || 30} days`
          }
        />
        <Metric
          icon={CircleCheck}
          label="Success rate"
          // Of finished runs — a queued run is not yet a failure.
          value={hasRuns ? `${data?.runs.successRate ?? 0}%` : "—"}
          detail={hasRuns ? `${data?.runs.success || 0} succeeded` : "No runs yet"}
        />
        <Metric
          icon={CircleAlert}
          label="Failure rate"
          value={hasRuns ? `${data?.runs.failureRate ?? 0}%` : "—"}
          detail={hasRuns ? `${data?.runs.failed || 0} failed` : "No runs yet"}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="flex flex-col rounded-lg border border-border p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-[13px] font-semibold">Runs over time</h3>
            <p className="text-[11.5px] text-muted-foreground">
              Average run {duration(data?.runs.averageMs || 0)}
            </p>
          </div>
          {/* Two series, so they need naming at rest — a tooltip only helps
              once you already know to hover the red line. */}
          {trend.length > 0 && (
            <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
              {[
                { key: "success", label: "Succeeded", color: "var(--viz-series)" },
                { key: "error", label: "Failed", color: "var(--viz-critical)" },
              ].map((series) => (
                <li
                  key={series.key}
                  className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground"
                >
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: series.color }}
                  />
                  {series.label}
                </li>
              ))}
            </ul>
          )}
          {trend.length === 0 ? (
            <p className="flex flex-1 items-center justify-center py-12 text-center text-[12.5px] text-muted-foreground">
              No runs in this period.
            </p>
          ) : (
            <div className="mt-3 min-h-[210px] flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend} margin={{ top: 6, right: 8, bottom: 0, left: 4 }}>
                  <defs>
                    <linearGradient id="workflow-runs-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--viz-series)" stopOpacity={0.22} />
                      <stop offset="100%" stopColor="var(--viz-series)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--viz-grid)" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="day"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    minTickGap={40}
                    tickFormatter={dayLabel}
                    tick={{ fontSize: 11, fill: "currentColor" }}
                    className="text-muted-foreground"
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tickMargin={6}
                    width={34}
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: "currentColor" }}
                    className="text-muted-foreground"
                  />
                  <Tooltip
                    cursor={{ stroke: "var(--viz-grid)", strokeWidth: 1 }}
                    content={({ active, label, payload }) =>
                      active ? (
                        <div className="rounded-md border border-border bg-popover px-2.5 py-2 shadow-md">
                          <p className="text-[11px] font-medium text-muted-foreground">
                            {dayLabel(String(label ?? ""))}
                          </p>
                          {payload?.map((entry) => (
                            <p
                              key={String(entry.dataKey)}
                              className="text-[12.5px] font-medium tabular-nums"
                            >
                              {Number(entry.value ?? 0)}
                              <span className="ml-1.5 font-normal text-muted-foreground">
                                {entry.dataKey === "error" ? "failed" : "succeeded"}
                              </span>
                            </p>
                          ))}
                        </div>
                      ) : null
                    }
                  />
                  <Area
                    type="monotone"
                    dataKey="success"
                    stroke="var(--viz-series)"
                    strokeWidth={2}
                    fill="url(#workflow-runs-fill)"
                    activeDot={{ r: 4, strokeWidth: 2 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="error"
                    stroke="var(--viz-critical)"
                    strokeWidth={2}
                    fill="none"
                    activeDot={{ r: 4, strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-border p-4">
            <h3 className="text-[13px] font-semibold">Most active</h3>
            <div className="mt-3">
              <Leaderboard
                rows={data?.mostActive || []}
                emptyLabel="No workflow has run in this period."
                metric={(row) => ({ value: row.runs, display: `${row.runs} runs` })}
                onOpen={onOpen}
              />
            </div>
          </div>

          <div className="rounded-lg border border-border p-4">
            <h3 className="text-[13px] font-semibold">Highest failure rate</h3>
            <p className="mt-0.5 text-[11.5px] text-muted-foreground">
              Workflows with at least three runs
            </p>
            <div className="mt-3">
              <Leaderboard
                rows={data?.highestFailureRate || []}
                emptyLabel="Nothing is failing repeatedly."
                metric={(row) => ({
                  value: row.failureRate,
                  display: `${row.failureRate}%`,
                })}
                onOpen={onOpen}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border p-4">
        <h3 className="text-[13px] font-semibold">Recent activity</h3>
        {(data?.recentActivity.length || 0) === 0 ? (
          <p className="py-7 text-center text-[12.5px] text-muted-foreground">
            Nothing has run yet. Publish a workflow and its runs appear here.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {data?.recentActivity.map((run) => (
              <li
                key={run.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <button
                  type="button"
                  onClick={() => onOpen(run.workflowId)}
                  className="min-w-0 rounded text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                >
                  <span className="block truncate text-[12.5px] font-medium">
                    {run.workflowName}
                  </span>
                  <span className="block truncate text-[11.5px] text-muted-foreground">
                    {triggerLabel(run.triggerType)}
                  </span>
                </button>
                <span className="flex shrink-0 items-center gap-3 text-[11.5px]">
                  <span className={cn("font-medium capitalize", runTone(run.status))}>
                    {run.status}
                  </span>
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Clock className="h-3 w-3" aria-hidden="true" />
                    {relative(run.createdAt)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export default WorkflowsAnalytics;

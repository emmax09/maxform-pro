/**
 * Run history for one workflow.
 *
 * Rebuilt against the platform's shared table furniture rather than the
 * module's own card idiom: the same filter bar, skeletons, empty states and
 * pagination the rest of the dashboard uses. A workflow that has run for a
 * month has hundreds of executions, so the list is filterable and paged rather
 * than an unbounded scroll of every run ever.
 */
import { useEffect, useMemo, useState } from "react";
import {
  ChevronRight,
  CircleAlert,
  History,
  MessageSquareText,
  RefreshCw,
  RotateCcw,
} from "lucide-react";

import {
  TableFilterBar,
  TableFilterSelect,
  TablePagination,
} from "@/components/shared/TableFilters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { WorkflowExecution } from "@/lib/workflows";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 10;

const ANY = "all";

const STATUS_OPTIONS = [
  { value: ANY, label: "Any status" },
  { value: "success", label: "Succeeded" },
  { value: "error", label: "Failed" },
  { value: "running", label: "Running" },
  { value: "queued", label: "Queued" },
  { value: "waiting", label: "Waiting" },
  { value: "canceled", label: "Canceled" },
];

const statusTone = (status: string) => {
  if (status === "success") return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
  if (status === "error") return "bg-destructive/10 text-destructive";
  if (status === "canceled") return "bg-muted text-muted-foreground";
  return "bg-amber-500/10 text-amber-700 dark:text-amber-400";
};

const dotTone = (status: string) => {
  if (status === "success") return "bg-emerald-500";
  if (status === "error") return "bg-destructive";
  if (status === "canceled") return "bg-muted-foreground/40";
  return "bg-amber-500";
};

const formatWhen = (value: string) =>
  value ? new Date(value).toLocaleString() : "—";

const formatDuration = (ms: number | null) => {
  if (ms === null || Number.isNaN(ms)) return "—";
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  return seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.round(seconds / 60)}m`;
};

const triggerName = (type: string) =>
  type.replace(/^trigger\./, "").replace(/_/g, " ") || "manual";

/** The failure reason, when the run recorded one. */
const errorText = (execution: WorkflowExecution) =>
  typeof execution.error?.message === "string" ? execution.error.message : "";

function RunsSkeleton() {
  return (
    <div className="space-y-2 p-3" aria-hidden="true">
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="flex items-center gap-3 px-2 py-2">
          <Skeleton className="h-2 w-2 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-2.5 w-28" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/** A labelled figure inside the detail panel. */
function DetailFigure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-border px-2.5 py-2">
      <p className="text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 truncate text-[12px] font-medium">{value}</p>
    </div>
  );
}

function RunDetail({
  execution,
  onRetry,
}: {
  execution: WorkflowExecution | null;
  onRetry: (execution: WorkflowExecution) => void;
}) {
  if (!execution) {
    return (
      <aside className="flex min-h-[280px] items-center justify-center rounded-lg border border-dashed border-border p-6 text-center">
        <div>
          <MessageSquareText className="mx-auto h-5 w-5 text-muted-foreground" />
          <p className="mt-2 text-[13px] font-medium">Select a run</p>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            Inputs, outputs and errors appear here.
          </p>
        </div>
      </aside>
    );
  }

  const errorMessage = errorText(execution);

  return (
    <aside className="overflow-hidden rounded-lg border border-border">
      <div className="flex items-start justify-between gap-3 border-b border-border px-3.5 py-3">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold">Run details</p>
          <code className="mt-0.5 block select-all truncate font-mono text-[10.5px] text-muted-foreground">
            {execution.id}
          </code>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
            statusTone(execution.status),
          )}
        >
          {execution.status}
        </span>
      </div>

      <div className="space-y-3 p-3.5">
        <div className="grid grid-cols-2 gap-2">
          <DetailFigure label="Trigger" value={triggerName(execution.triggerType)} />
          <DetailFigure label="Duration" value={formatDuration(execution.durationMs)} />
          <DetailFigure label="Started" value={formatWhen(execution.startedAt || "")} />
          <DetailFigure label="Finished" value={formatWhen(execution.finishedAt || "")} />
        </div>

        {errorMessage && (
          <p className="flex items-start gap-2 rounded-md bg-destructive/10 p-2.5 text-[12px] text-destructive">
            <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {errorMessage}
          </p>
        )}

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Node trace
          </p>
          {(execution.nodeRuns?.length || 0) === 0 ? (
            <p className="mt-1.5 text-[12px] text-muted-foreground">
              No per-node detail was recorded for this run.
            </p>
          ) : (
            <ul className="mt-1.5 space-y-1">
              {execution.nodeRuns?.map((node) => (
                <li
                  key={node.id}
                  className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5"
                >
                  <span
                    className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotTone(node.status))}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-medium">
                      {node.nodeId}
                    </span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {node.nodeType}
                      {node.attempt > 1 ? ` · attempt ${node.attempt}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11px] capitalize text-muted-foreground">
                    {node.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <details className="rounded-md border border-border">
          <summary className="cursor-pointer px-2.5 py-1.5 text-[12px] font-medium">
            Trigger payload
          </summary>
          <pre className="max-h-52 overflow-auto border-t border-border p-2.5 text-[11px] leading-4">
            {JSON.stringify(execution.triggerPayload ?? {}, null, 2)}
          </pre>
        </details>

        <details className="rounded-md border border-border">
          <summary className="cursor-pointer px-2.5 py-1.5 text-[12px] font-medium">
            Output payload
          </summary>
          <pre className="max-h-52 overflow-auto border-t border-border p-2.5 text-[11px] leading-4">
            {JSON.stringify(execution.outputPayload ?? {}, null, 2)}
          </pre>
        </details>

        {execution.status === "error" && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="w-full"
            onClick={() => onRetry(execution)}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Retry this run
          </Button>
        )}
      </div>
    </aside>
  );
}

export function WorkflowRunsView({
  executions,
  loading,
  error,
  selected,
  onSelect,
  onRetry,
  onRefresh,
}: {
  executions: WorkflowExecution[];
  loading: boolean;
  error?: string;
  selected: WorkflowExecution | null;
  onSelect: (execution: WorkflowExecution) => void;
  onRetry: (execution: WorkflowExecution) => void;
  onRefresh: () => void;
}) {
  const [status, setStatus] = useState(ANY);
  const [page, setPage] = useState(1);

  // Filtering here rather than server-side: the caller already holds the run
  // list for this one workflow, so a round trip per filter change would be
  // slower and no more correct.
  const filtered = useMemo(
    () =>
      status === ANY
        ? executions
        : executions.filter((execution) => execution.status === status),
    [executions, status],
  );

  useEffect(() => {
    setPage(1);
  }, [status, executions.length]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-[14px] font-semibold">Execution history</h3>
            <p className="text-[12px] text-muted-foreground">
              {executions.length} run{executions.length === 1 ? "" : "s"} recorded
              for this workflow
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={loading}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {executions.length > 0 && (
          <TableFilterBar label="Run filters">
            <TableFilterSelect
              value={status}
              onValueChange={setStatus}
              options={STATUS_OPTIONS}
              label="Status"
              className="sm:w-[170px]"
            />
          </TableFilterBar>
        )}

        <div className="overflow-hidden rounded-lg border border-border">
          {error ? (
            <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
              <CircleAlert className="h-5 w-5 text-destructive" />
              <p className="text-[13px] font-medium">Runs could not be loaded</p>
              <p className="text-[12px] text-muted-foreground">{error}</p>
              <Button type="button" size="sm" variant="outline" onClick={onRefresh}>
                Try again
              </Button>
            </div>
          ) : loading ? (
            <RunsSkeleton />
          ) : executions.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <History className="mx-auto h-5 w-5 text-muted-foreground" />
              <p className="mt-2 text-[13px] font-medium">No runs yet</p>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                Use Run in the editor toolbar to try this workflow.
              </p>
            </div>
          ) : visible.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <p className="text-[13px] font-medium">No runs match this filter</p>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                Clear the status filter to see the rest.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {visible.map((execution) => (
                <li key={execution.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(execution)}
                    aria-current={selected?.id === execution.id ? "true" : undefined}
                    className={cn(
                      "flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30",
                      selected?.id === execution.id && "bg-primary/[0.05]",
                    )}
                  >
                    <span
                      className={cn("h-2 w-2 shrink-0 rounded-full", dotTone(execution.status))}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium capitalize">
                        {execution.status}
                        <span className="ml-1.5 font-normal text-muted-foreground">
                          via {triggerName(execution.triggerType)}
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                        {formatWhen(execution.createdAt)} ·{" "}
                        {formatDuration(execution.durationMs)}
                      </span>
                    </span>
                    {/* The dot and the leading word already carry the status;
                        a badge repeating it a third time is noise. What the
                        right edge is for is the thing the row does not say. */}
                    {execution.status === "error" && errorText(execution) && (
                      <span className="hidden max-w-[220px] shrink-0 truncate text-[11px] text-muted-foreground lg:block">
                        {errorText(execution)}
                      </span>
                    )}
                    <ChevronRight
                      className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <TablePagination
          page={page}
          pageCount={pageCount}
          pageSize={PAGE_SIZE}
          totalCount={filtered.length}
          onPageChange={setPage}
          itemLabel="runs"
        />
      </section>

      <RunDetail execution={selected} onRetry={onRetry} />
    </div>
  );
}

export default WorkflowRunsView;

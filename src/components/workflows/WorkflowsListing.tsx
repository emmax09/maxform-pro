/**
 * Every automation in the workspace, in one table.
 *
 * The editor answers "what does this workflow do"; this screen answers the
 * questions you have before you open one — what exists, what is live, what ran
 * last night, and what has been quietly failing. It is deliberately a table
 * rather than the overview's cards: an operator scanning thirty automations
 * for the one with a falling success rate needs rows they can compare down a
 * column, not tiles they have to read one at a time.
 *
 * Filtering and paging happen in the database. The rows here carry only what
 * the table draws, so opening this screen never pulls a workspace's worth of
 * node graphs across the wire.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CircleAlert,
  Copy,
  Inbox,
  Loader2,
  MoreHorizontal,
  PenLine,
  Play,
  Plus,
  PowerOff,
  RefreshCw,
  Trash2,
  Workflow as WorkflowIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  TableBulkActions,
  TableFilterBar,
  TableFilterSelect,
  TablePagination,
  TableRowSelect,
  TableSearchField,
  TableSelectionBar,
  type TableBulkAction,
} from "@/components/shared/TableFilters";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  bulkWorkflowAction,
  listWorkflowConnections,
  listWorkflowsPage,
  listWorkflowTriggerFacets,
  workflowNodeCatalogEntry,
  type WorkflowBulkResult,
  type WorkflowRecord,
} from "@/lib/workflows";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 10;

/**
 * Radix refuses an empty-string SelectItem value — it reserves "" for "no
 * selection", so an option carrying it renders as a blank trigger. The
 * unfiltered choice therefore needs a real value, translated back to "no
 * filter" on the way to the server.
 */
const ANY = "all";

const unfiltered = (value: string) => (value === ANY ? "" : value);

const STATUS_OPTIONS = [
  { value: ANY, label: "Any status" },
  { value: "published", label: "Published" },
  { value: "paused", label: "Paused" },
  { value: "draft", label: "Draft" },
  { value: "archived", label: "Archived" },
];

const CREATED_OPTIONS = [
  { value: ANY, label: "Any date" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

/** Live, resting, or needs attention — the three states an operator acts on. */
const statusTone = (status: string, enabled: boolean) => {
  if (status === "published" && enabled) {
    return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
  }
  if (status === "paused") return "bg-amber-500/10 text-amber-700 dark:text-amber-400";
  if (status === "archived") return "bg-destructive/10 text-destructive";
  return "bg-muted text-muted-foreground";
};

const statusLabel = (status: string, enabled: boolean) => {
  if (status === "published") return enabled ? "Live" : "Published, off";
  if (status === "paused") return "Paused";
  if (status === "archived") return "Archived";
  return "Draft";
};

const runTone = (status: string | null) => {
  if (status === "success") return "text-emerald-700 dark:text-emerald-400";
  if (status === "error") return "text-destructive";
  return "text-muted-foreground";
};

const triggerLabel = (triggerType: string) =>
  workflowNodeCatalogEntry(triggerType)?.label ||
  triggerType.replace(/^trigger\./, "").replace(/_/g, " ") ||
  "Not set";

const shortDate = (value: string | null) =>
  value ? new Date(value).toLocaleDateString() : "—";

const relativeDate = (value: string | null) => {
  if (!value) return "Never run";
  const when = new Date(value).getTime();
  if (Number.isNaN(when)) return "Never run";
  const minutes = Math.round((Date.now() - when) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days}d ago` : new Date(value).toLocaleDateString();
};

/**
 * Success rate reads as a share of runs, so a workflow with three runs and one
 * failure is not presented with the same authority as one with three thousand.
 * The denominator travels with the number for exactly that reason.
 */
function SuccessRate({ stats }: { stats: WorkflowRecord["stats"] }) {
  if (stats.executions === 0) {
    return <span className="text-[12.5px] text-muted-foreground">—</span>;
  }
  const rate = Math.round((stats.successes / stats.executions) * 100);
  const tone =
    rate >= 95
      ? "text-emerald-700 dark:text-emerald-400"
      : rate >= 80
        ? "text-amber-700 dark:text-amber-400"
        : "text-destructive";
  return (
    <span className="tabular-nums">
      <span className={cn("text-[13px] font-medium", tone)}>{rate}%</span>
      <span className="ml-1.5 text-[11.5px] text-muted-foreground">
        of {stats.executions}
      </span>
    </span>
  );
}

type RowAction = "activate" | "disable" | "duplicate" | "delete";

/**
 * Per-row actions, behind one control.
 *
 * The row itself opens the workflow, so the menu carries the things that
 * change it. Which lifecycle action is offered depends on where the workflow
 * actually is: offering "Turn off" on a draft that was never on, or "Activate"
 * on one already live, is a control that does nothing.
 */
function RowActions({
  workflow,
  busy,
  onOpen,
  onAction,
}: {
  workflow: WorkflowRecord;
  busy: boolean;
  onOpen: () => void;
  onAction: (action: RowAction) => void;
}) {
  const live = workflow.status === "published" && workflow.enabled;
  const archived = workflow.status === "archived";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          disabled={busy}
          aria-label={`Actions for ${workflow.name}`}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[180px]">
        <DropdownMenuItem className="gap-2" onSelect={onOpen}>
          <PenLine className="h-3.5 w-3.5" strokeWidth={1.75} />
          Open in editor
        </DropdownMenuItem>
        {!archived &&
          (live ? (
            <DropdownMenuItem className="gap-2" onSelect={() => onAction("disable")}>
              <PowerOff className="h-3.5 w-3.5" strokeWidth={1.75} />
              Turn off
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem className="gap-2" onSelect={() => onAction("activate")}>
              <Play className="h-3.5 w-3.5" strokeWidth={1.75} />
              Activate
            </DropdownMenuItem>
          ))}
        <DropdownMenuItem className="gap-2" onSelect={() => onAction("duplicate")}>
          <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => onAction("delete")}
          className="gap-2 text-destructive focus:bg-destructive/10 focus:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type PendingAction = {
  action: "activate" | "delete";
  ids: string[];
};

export function WorkflowsListing({
  onOpen,
  onCreate,
  creating = false,
}: {
  onOpen: (workflowId: string) => void;
  onCreate: () => void;
  creating?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [status, setStatus] = useState(ANY);
  const [triggerType, setTriggerType] = useState(ANY);
  const [provider, setProvider] = useState(ANY);
  const [createdWithin, setCreatedWithin] = useState(ANY);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);

  // Each keystroke is a database round trip, so the filter settles first.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setAppliedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const from = useMemo(() => {
    const days = Number(unfiltered(createdWithin));
    if (!days) return "";
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  }, [createdWithin]);

  const listing = useQuery({
    queryKey: [
      "workflows-listing",
      appliedSearch,
      status,
      triggerType,
      provider,
      from,
      page,
    ],
    queryFn: () =>
      listWorkflowsPage({
        search: appliedSearch,
        status: unfiltered(status),
        triggerType: unfiltered(triggerType),
        provider: unfiltered(provider),
        from,
        page,
        pageSize: PAGE_SIZE,
      }),
  });

  const facets = useQuery({
    queryKey: ["workflow-trigger-facets"],
    queryFn: listWorkflowTriggerFacets,
  });

  // The provider filter offers what the workspace has actually connected, so
  // it can never present a provider that could not appear in a result.
  const connections = useQuery({
    queryKey: ["workflow-connections"],
    queryFn: listWorkflowConnections,
  });

  const rows = useMemo(() => listing.data?.workflows || [], [listing.data]);

  // A selection only means anything against the rows it was made on.
  useEffect(() => {
    setSelected(new Set());
  }, [appliedSearch, status, triggerType, provider, from, page]);

  const triggerOptions = useMemo(
    () => [
      { value: ANY, label: "Any trigger" },
      ...(facets.data || []).map((facet) => ({
        value: facet.triggerType,
        label: `${triggerLabel(facet.triggerType)} (${facet.workflows})`,
      })),
    ],
    [facets.data],
  );

  const providerOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const connection of connections.data || []) {
      if (!seen.has(connection.provider)) {
        seen.set(connection.provider, connection.providerName);
      }
    }
    return [
      { value: ANY, label: "Any provider" },
      ...[...seen].map(([value, label]) => ({ value, label })),
    ];
  }, [connections.data]);

  const toggleOne = useCallback((id: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(
    (checked: boolean) => {
      setSelected(checked ? new Set(rows.map((row) => row.id)) : new Set());
    },
    [rows],
  );

  const describe = useCallback((result: WorkflowBulkResult) => {
    const verb =
      result.action === "activate"
        ? "activated"
        : result.action === "disable"
          ? "turned off"
          : result.action === "duplicate"
            ? "duplicated"
            : "deleted";
    if (result.failed === 0) {
      toast.success(`${result.succeeded} workflow${result.succeeded === 1 ? "" : "s"} ${verb}.`);
      return;
    }
    // Naming the workflow and its reason is the difference between "some
    // failed" and something the operator can act on.
    const first = result.failures[0];
    toast.warning(
      `${result.succeeded} ${verb}, ${result.failed} could not be: ${first.name} — ${first.error}`,
      { duration: 8_000 },
    );
  }, []);

  const runBulk = useCallback(
    async (
      action: "activate" | "disable" | "duplicate" | "delete",
      ids: string[],
    ) => {
      if (ids.length === 0) return;
      setBusy(true);
      try {
        const result = await bulkWorkflowAction(ids, action);
        describe(result);
        setSelected(new Set());
        await Promise.all([listing.refetch(), facets.refetch()]);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "That action did not complete.",
        );
      } finally {
        setBusy(false);
      }
    },
    [describe, listing, facets],
  );

  const bulkActions: TableBulkAction[] = [
    {
      key: "activate",
      label: "Activate",
      icon: <Play className="h-3.5 w-3.5" strokeWidth={1.75} />,
      disabled: busy,
      // Publishing puts automations live against real workspace data, so it
      // asks first even though it is reversible.
      onSelect: () => setPending({ action: "activate", ids: [...selected] }),
    },
    {
      key: "disable",
      label: "Turn off",
      icon: <PowerOff className="h-3.5 w-3.5" strokeWidth={1.75} />,
      disabled: busy,
      onSelect: () => void runBulk("disable", [...selected]),
    },
    {
      key: "duplicate",
      label: "Duplicate",
      icon: <Copy className="h-3.5 w-3.5" strokeWidth={1.75} />,
      disabled: busy,
      onSelect: () => void runBulk("duplicate", [...selected]),
    },
    {
      key: "delete",
      label: "Delete",
      icon: <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />,
      destructive: true,
      separatorBefore: true,
      disabled: busy,
      onSelect: () => setPending({ action: "delete", ids: [...selected] }),
    },
  ];

  const filtersActive = Boolean(
    appliedSearch ||
      unfiltered(status) ||
      unfiltered(triggerType) ||
      unfiltered(provider) ||
      unfiltered(createdWithin),
  );

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-semibold">Workflows</h2>
          <p className="text-[12.5px] text-muted-foreground">
            {listing.data
              ? `${listing.data.total} automation${listing.data.total === 1 ? "" : "s"} in this workspace`
              : "Loading automations"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={listing.isFetching}
            onClick={() => void listing.refetch()}
          >
            {listing.isFetching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Refresh
          </Button>
          <Button type="button" size="sm" disabled={creating} onClick={onCreate}>
            {creating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            New workflow
          </Button>
        </div>
      </div>

      <TableFilterBar label="Workflow filters">
        <TableSearchField
          value={search}
          onValueChange={setSearch}
          placeholder="Search by name or description"
          aria-label="Search workflows"
        />
        <TableFilterSelect
          value={status}
          onValueChange={(value) => {
            setStatus(value);
            setPage(1);
          }}
          options={STATUS_OPTIONS}
          label="Status"
          className="sm:w-[150px]"
        />
        <TableFilterSelect
          value={triggerType}
          onValueChange={(value) => {
            setTriggerType(value);
            setPage(1);
          }}
          options={triggerOptions}
          label="Trigger"
          className="sm:w-[190px]"
        />
        <TableFilterSelect
          value={provider}
          onValueChange={(value) => {
            setProvider(value);
            setPage(1);
          }}
          options={providerOptions}
          label="Provider"
          className="sm:w-[160px]"
        />
        <TableFilterSelect
          value={createdWithin}
          onValueChange={(value) => {
            setCreatedWithin(value);
            setPage(1);
          }}
          options={CREATED_OPTIONS}
          label="Created"
          className="sm:w-[150px]"
        />
      </TableFilterBar>

      {rows.length > 0 && (
        <TableSelectionBar
          totalCount={rows.length}
          selectedCount={selected.size}
          allSelected={selected.size > 0 && selected.size === rows.length}
          partiallySelected={selected.size > 0 && selected.size < rows.length}
          onToggleAll={toggleAll}
          onClear={() => setSelected(new Set())}
          itemLabel="workflows"
        >
          {selected.size > 0 && (
            <TableBulkActions actions={bulkActions} label="Bulk actions" />
          )}
        </TableSelectionBar>
      )}

      {listing.isError ? (
        <div className="flex items-center gap-2 py-10 text-[14px] text-destructive">
          <CircleAlert className="h-4 w-4" />
          {listing.error instanceof Error
            ? listing.error.message
            : "Workflows could not be loaded."}
        </div>
      ) : listing.isLoading ? (
        <div className="flex items-center gap-2 py-10 text-[14px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          Loading workflows
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border py-14 text-center">
          <Inbox className="h-5 w-5 text-muted-foreground" />
          <p className="text-[14px] font-medium">
            {filtersActive ? "No workflows match these filters" : "No workflows yet"}
          </p>
          <p className="max-w-[380px] text-[12.5px] text-muted-foreground">
            {filtersActive
              ? "Clear a filter to see the rest of the workspace's automations."
              : "Build an automation to connect a trigger in one module to actions in another."}
          </p>
          {!filtersActive && (
            <Button
              type="button"
              size="sm"
              className="mt-1"
              disabled={creating}
              onClick={onCreate}
            >
              <Plus className="h-3.5 w-3.5" />
              New workflow
            </Button>
          )}
        </div>
      ) : (
        // Scrolls inside its own container so a narrow window never drags the page.
        <div className="overflow-x-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[44px]">
                  <span className="sr-only">Select</span>
                </TableHead>
                <TableHead className="min-w-[200px]">Workflow</TableHead>
                <TableHead className="min-w-[120px]">Status</TableHead>
                <TableHead className="min-w-[110px]">Created</TableHead>
                <TableHead className="min-w-[110px]">Updated</TableHead>
                <TableHead className="min-w-[130px]">Last run</TableHead>
                <TableHead className="min-w-[120px]">Success rate</TableHead>
                <TableHead className="w-[52px]">
                  <span className="sr-only">Row actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((workflow) => (
                <TableRow
                  key={workflow.id}
                  data-state={selected.has(workflow.id) ? "selected" : undefined}
                  className="cursor-pointer"
                  onClick={() => onOpen(workflow.id)}
                >
                  <TableCell
                    className="w-[44px]"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <TableRowSelect
                      checked={selected.has(workflow.id)}
                      onCheckedChange={(checked) => toggleOne(workflow.id, checked)}
                      label={`Select ${workflow.name}`}
                    />
                  </TableCell>
                  <TableCell>
                    <p className="flex items-center gap-2 text-[13.5px] font-medium">
                      <WorkflowIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{workflow.name}</span>
                    </p>
                    {workflow.description && (
                      <p className="truncate pl-[22px] text-[12px] text-muted-foreground">
                        {workflow.description}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "inline-flex rounded-full px-2 py-0.5 text-[11.5px] font-medium",
                        statusTone(workflow.status, workflow.enabled),
                      )}
                    >
                      {statusLabel(workflow.status, workflow.enabled)}
                    </span>
                  </TableCell>
                  <TableCell className="text-[12.5px] text-muted-foreground">
                    {shortDate(workflow.createdAt)}
                  </TableCell>
                  <TableCell className="text-[12.5px] text-muted-foreground">
                    {shortDate(workflow.updatedAt)}
                  </TableCell>
                  <TableCell className="text-[12.5px]">
                    <span className={runTone(workflow.stats.lastRunStatus)}>
                      {relativeDate(workflow.stats.lastRunAt)}
                    </span>
                    {workflow.stats.failures > 0 && (
                      <span className="block text-[11px] text-muted-foreground">
                        {workflow.stats.failures} failed
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <SuccessRate stats={workflow.stats} />
                  </TableCell>
                  <TableCell
                    className="w-[52px]"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <RowActions
                      workflow={workflow}
                      busy={busy}
                      onOpen={() => onOpen(workflow.id)}
                      onAction={(action) => {
                        if (action === "delete") {
                          setPending({ action: "delete", ids: [workflow.id] });
                          return;
                        }
                        if (action === "activate") {
                          setPending({ action: "activate", ids: [workflow.id] });
                          return;
                        }
                        void runBulk(action, [workflow.id]);
                      }}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <TablePagination
        page={listing.data?.page || 1}
        pageCount={listing.data?.pageCount || 1}
        pageSize={listing.data?.pageSize || PAGE_SIZE}
        totalCount={listing.data?.total || 0}
        onPageChange={setPage}
        itemLabel="workflows"
      />

      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>
              {pending?.action === "delete"
                ? `Delete ${pending.ids.length} workflow${pending.ids.length === 1 ? "" : "s"}?`
                : `Activate ${pending?.ids.length || 0} workflow${pending?.ids.length === 1 ? "" : "s"}?`}
            </DialogTitle>
            <DialogDescription>
              {pending?.action === "delete"
                ? "This removes the workflows and their execution history for good. To stop one from running without losing its history, turn it off instead."
                : "Activated workflows publish and begin running against live workspace data as soon as their trigger fires. Any that fail validation stay off and are named."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPending(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              variant={pending?.action === "delete" ? "destructive" : "default"}
              disabled={busy}
              onClick={() => {
                const request = pending;
                setPending(null);
                if (request) void runBulk(request.action, request.ids);
              }}
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {pending?.action === "delete" ? "Delete" : "Activate"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export default WorkflowsListing;

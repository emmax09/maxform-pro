import {
  Activity,
  Archive,
  AlertCircle,
  ArrowDownRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  ClipboardCheck,
  Clock3,
  Copy,
  Download,
  ExternalLink,
  FileJson,
  GitBranch,
  History,
  LayoutGrid,
  ArrowLeft,
  LayoutDashboard,
  ListChecks,
  Link2,
  Loader2,
  Mail,
  Maximize2,
  MessageSquareText,
  Minus,
  MoreHorizontal,
  Play,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Search,
  Send,
  Settings2,
  TerminalSquare,
  Trash2,
  Undo2,
  UsersRound,
  Webhook,
  Workflow as WorkflowIcon,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  WORKFLOW_NODE_CATALOG,
  defaultWorkflowDefinition,
  mapWorkflowRecord,
  workflowNodeCatalogEntry,
  type WorkflowDefinition,
  type WorkflowEdge,
  type WorkflowExecution,
  type WorkflowEvaluationCase,
  type WorkflowNode,
  type WorkflowNodeCatalogEntry,
  type WorkflowConnection,
  type WorkflowVersion,
  type WorkflowValidationResult,
  type WorkflowTemplate,
  type WorkflowRecord,
  type WorkflowNodeRun,
  createWorkflow,
  createWorkflowFromTemplate,
  duplicateWorkflow,
  archiveWorkflow,
  deleteWorkflow,
  executeWorkflow,
  getWorkflowExecution,
  listWorkflowEvaluations,
  listWorkflowConnections,
  listWorkflowVersions,
  listWorkflowTemplates,
  listWorkflowExecutions,
  getWorkflow,
  listWorkflows,
  publishWorkflow,
  retryWorkflowExecution,
  restoreWorkflowVersion,
  runWorkflowEvaluation,
  saveWorkflowEvaluation,
  setWorkflowEnabled,
  updateWorkflow,
  validateWorkflow,
} from "@/lib/workflows";
import { officialIntegrationLogo } from "@/lib/integration-provider-assets";
import { cn } from "@/lib/utils";
import { WorkflowsListing } from "@/components/workflows/WorkflowsListing";
import { WorkflowsAnalytics } from "@/components/workflows/WorkflowsAnalytics";
import { WorkflowRunsView } from "@/components/workflows/WorkflowRunsView";
import { WorkflowChecksView } from "@/components/workflows/WorkflowChecksView";
import { WorkflowGraphCanvas } from "@/components/workflows/WorkflowGraphCanvas";
import { WorkflowConnectionState } from "@/components/workflows/WorkflowConnectionState";
import {
  connectionBlocks,
  connectionStanding,
} from "@/components/workflows/workflow-connection-state";
import {
  WorkflowEditorShell,
  WorkflowExitDialog,
  WorkflowFocusToggle,
  WorkflowOpeningState,
  WorkflowSaveState,
} from "@/components/workflows/WorkflowEditorShell";

type WorkflowTab =
  | "overview"
  | "workflows"
  | "editor"
  | "executions"
  | "evaluations";

/**
 * The tab strip. The editor is deliberately absent: it edits one workflow, so
 * it is somewhere you go by opening a row in Workflows, not a peer destination
 * you can land on with nothing selected. `"editor"` stays in the union because
 * it is still a view the module switches into.
 */
const workflowTabs: Array<{ key: WorkflowTab; label: string; icon: LucideIcon }> = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "workflows", label: "Workflows", icon: ListChecks },
  { key: "executions", label: "Executions", icon: Activity },
  // Key stays "evaluations" so existing ?section= deep links keep working; the
  // label matches what the panel actually calls them.
  { key: "evaluations", label: "Checks", icon: ClipboardCheck },
];

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const ArchiveIcon = () => <Archive className="h-3.5 w-3.5" strokeWidth={1.75} />;

const iconForNode = (type: string): LucideIcon => {
  if (type.includes("webhook")) return Webhook;
  if (type.includes("form")) return FileJson;
  if (type.includes("event")) return Zap;
  if (type.includes("document") || type.includes("folder")) return FileJson;
  if (type.includes("appointment")) return Clock3;
  if (type.includes("contact")) return UsersRound;
  if (type.includes("email")) return Mail;
  if (type.includes("http")) return ExternalLink;
  if (type.includes("if")) return GitBranch;
  if (type.includes("log")) return TerminalSquare;
  if (type.includes("manual")) return Play;
  return WorkflowIcon;
};

const connectedProviderOperations = (provider: string) => {
  if (provider === "google_workspace" || provider === "google_sheets") return ["gmail.send", "append_row", "update_row"];
  if (provider === "slack") return ["message.send"];
  if (provider === "airtable") return ["create_record", "update_record"];
  if (provider === "hubspot") return ["create_contact", "update_contact"];
  if (provider === "mailchimp") return ["add_subscriber", "add_tags"];
  if (provider === "notion") return ["create_page", "append_content"];
  if (provider === "dropbox") return ["create_folder", "upload_file"];
  return [];
};

const connectedOperationLabel = (operation: string) => {
  const labels: Record<string, string> = {
    "gmail.send": "Send Gmail message",
    append_row: "Append Google Sheet row",
    update_row: "Update Google Sheet row",
    "message.send": "Send Slack message",
    create_record: "Create Airtable record",
    update_record: "Update Airtable record",
    create_contact: "Create CRM contact",
    update_contact: "Update CRM contact",
    add_subscriber: "Add Mailchimp subscriber",
    add_tags: "Add Mailchimp tags",
    create_page: "Create Notion page",
    append_content: "Append Notion page content",
    upload_file: "Upload Dropbox file",
    create_folder: "Create Dropbox folder",
  };
  return labels[operation] || operation;
};

const connectedProviderDefaults = (provider: string) => {
  const operation = connectedProviderOperations(provider)[0] || "";
  if (operation === "gmail.send") return { connectionId: "", operation, to: "{{$json.email}}", subject: "Workspace update", html: "<p>{{$json.message}}</p>" };
  if (operation === "append_row") return { connectionId: "", operation, spreadsheetId: "", sheetName: "Responses" };
  if (operation === "message.send") return { connectionId: "", operation, message: "New workspace activity: {{$json.name}}" };
  if (operation === "create_record") return { connectionId: "", operation, baseId: "", tableId: "" };
  if (operation === "create_contact") return { connectionId: "", operation, email: "{{$json.email}}", fullName: "{{$json.fullName}}" };
  if (operation === "add_subscriber") return { connectionId: "", operation, email: "{{$json.email}}", fullName: "{{$json.fullName}}", audienceId: "" };
  if (operation === "create_page") return { connectionId: "", operation, databaseId: "", pageTitle: "{{$json.title}}" };
  if (operation === "create_folder") return { connectionId: "", operation, name: "{{$json.folderName}}", parentId: "" };
  return { connectionId: "", operation };
};

function WorkflowProviderLogo({ provider, operation, className = "h-5 w-5" }: { provider: string; operation?: string; className?: string }) {
  const logoKey = provider === "google_workspace"
    ? operation === "gmail.send" ? "gmail" : operation === "append_row" || operation === "update_row" ? "google_sheets" : provider
    : provider;
  const source = officialIntegrationLogo(logoKey);
  if (!source) return <Link2 className={cn(className, "text-primary")} aria-label="Connected provider" />;
  return <img src={source} alt="" aria-hidden="true" className={cn(className, "object-contain")} loading="eager" />;
}

const statusLabel = (status: string) => {
  if (status === "success") return "Succeeded";
  if (status === "error") return "Failed";
  if (status === "running") return "Running";
  if (status === "waiting") return "Waiting";
  if (status === "queued") return "Queued";
  if (status === "canceled") return "Canceled";
  if (status === "published") return "Live";
  if (status === "paused") return "Paused";
  if (status === "archived") return "Archived";
  return "Draft";
};

const statusClass = (status: string) => {
  if (status === "success") return "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300";
  if (status === "error") return "border-destructive/25 bg-destructive/10 text-destructive";
  if (status === "running") return "border-sky-500/25 bg-sky-500/10 text-sky-600 dark:text-sky-300";
  if (status === "published") return "border-primary/25 bg-primary/10 text-primary";
  if (status === "paused") return "border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-300";
  if (status === "archived") return "border-border bg-muted text-muted-foreground";
  return "border-border bg-muted/60 text-muted-foreground";
};

const formatDate = (value: string | null | undefined) => {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
};

const formatDuration = (value: number | null | undefined) => {
  if (value == null) return "—";
  if (value < 1_000) return `${value} ms`;
  return `${(value / 1_000).toFixed(1)} s`;
};

const updateRecord = (
  records: WorkflowRecord[],
  next: WorkflowRecord,
) => records.map((record) => (record.id === next.id ? next : record));

const nextNodeId = (definition: WorkflowDefinition) => {
  const used = new Set(definition.nodes.map((node) => node.id));
  let index = definition.nodes.length + 1;
  while (used.has(`node-${index}`)) index += 1;
  return `node-${index}`;
};

const defaultParameters = (type: string): Record<string, unknown> => {
  if (type === "trigger.schedule") return { intervalMinutes: 60 };
  if (type === "logic.delay") return { seconds: 3_600 };
  if (type === "logic.if") {
    return { field: "email", operator: "exists", value: "" };
  }
  if (type === "action.http_request") {
    return { method: "POST", url: "", headers: {}, body: "{{$json}}" };
  }
  if (type === "action.create_contact") {
    return { email: "{{$json.email}}", fullName: "{{$json.fullName}}", tags: [] };
  }
  if (type === "action.update_contact") {
    return { contactId: "{{$json.contactId}}" };
  }
  if (type === "action.create_form") return { title: "{{$json.title}}" };
  if (type === "action.create_event") return { title: "{{$json.title}}" };
  if (type === "action.create_document") return { templateId: "", title: "{{$json.title}}", signers: [] };
  if (type === "action.create_folder") return { name: "{{$json.folderName}}", parentId: "" };
  if (type === "action.create_appointment") {
    return {
      inviteeName: "{{$json.name}}",
      to: "{{$json.email}}",
      startsAt: "{{$json.startsAt}}",
      endsAt: "{{$json.endsAt}}",
    };
  }
  if (type === "action.send_workspace_email") {
    return {
      to: "{{$json.email}}",
      subject: "A workspace update",
      html: "<p>Thanks for staying connected.</p>",
    };
  }
  if (type === "action.log") return { message: "{{$json}}" };
  if (type === "action.connected_app") return { connectionId: "", operation: "", message: "{{$json}}" };
  return {};
};

const nodePosition = (node: WorkflowNode) => ({
  left: `${Math.max(12, node.position.x)}px`,
  top: `${Math.max(12, node.position.y)}px`,
});

const nodeCenter = (node: WorkflowNode) => ({
  x: Math.max(12, node.position.x) + 112,
  y: Math.max(12, node.position.y) + 44,
});

function NodeStatusDot({ status }: { status?: string }) {
  if (status === "success") {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white">
        <Check className="h-3 w-3" strokeWidth={2.5} />
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground">
        <X className="h-3 w-3" strokeWidth={2.5} />
      </span>
    );
  }
  if (status === "running") {
    return <Loader2 className="h-4 w-4 animate-spin text-sky-500" />;
  }
  return <span className="h-2.5 w-2.5 rounded-full border-2 border-muted-foreground/40" />;
}

function WorkflowTabs({
  activeTab,
  executionCount,
  onChange,
}: {
  activeTab: WorkflowTab;
  executionCount: number;
  onChange: (tab: WorkflowTab) => void;
}) {
  return (
    <nav
      className="dashboard-scroll dashboard-scroll-x flex gap-1 overflow-x-auto border-b border-border"
      aria-label="Workflow sections"
      role="tablist"
    >
      {workflowTabs.map((item, index) => {
        const Icon = item.icon;
        const active = activeTab === item.key;
        const label = item.key === "executions" && executionCount
          ? `${item.label} (${executionCount})`
          : item.label;
        return (
          <button
            key={item.key}
            id={`workflow-tab-${item.key}`}
            type="button"
            role="tab"
            tabIndex={active ? 0 : -1}
            aria-selected={active}
            aria-controls={`workflow-panel-${item.key}`}
            onClick={() => onChange(item.key)}
            onKeyDown={(event) => {
              if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const nextIndex = event.key === "Home"
                ? 0
                : event.key === "End"
                  ? workflowTabs.length - 1
                  : (index + (event.key === "ArrowRight" ? 1 : -1) + workflowTabs.length) % workflowTabs.length;
              onChange(workflowTabs[nextIndex].key);
              requestAnimationFrame(() => document.getElementById(`workflow-tab-${workflowTabs[nextIndex].key}`)?.focus());
            }}
            className={cn(
              "relative flex h-10 shrink-0 items-center gap-1.5 border-b-2 px-3 text-[12px] transition-colors",
              active
                ? "border-primary font-semibold text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        );
      })}
    </nav>
  );
}

function OverviewStat({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-xs">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-3.5 w-3.5" />
        </span>
      </div>
      <p className="mt-4 text-[24px] font-semibold tracking-[-0.03em]">{value}</p>
      <p className="mt-1 text-[10px] text-muted-foreground">{detail}</p>
    </section>
  );
}

function triggerLabel(value: string) {
  return value
    .replace(/^trigger\./, "")
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function WorkflowOverview({
  records,
  error,
  busy,
  templates,
  templatesLoading,
  onCreate,
  onTemplate,
  onOpen,
  onRefresh,
}: {
  records: WorkflowRecord[];
  error: string;
  busy: boolean;
  templates: WorkflowTemplate[];
  templatesLoading: boolean;
  onCreate: () => void;
  onTemplate: (templateId: string) => void;
  onOpen: (workflowId: string) => void;
  onRefresh: () => void;
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sort, setSort] = useState("updated");
  const [page, setPage] = useState(1);
  const pageSize = 8;
  const totals = records.reduce(
    (result, record) => ({
      executions: result.executions + record.stats.executions,
      successes: result.successes + record.stats.successes,
      failures: result.failures + record.stats.failures,
    }),
    { executions: 0, successes: 0, failures: 0 },
  );
  const published = records.filter((record) => record.status === "published").length;
  const successRate = totals.executions
    ? `${Math.round((totals.successes / totals.executions) * 100)}%`
    : "—";
  const triggerCounts = records.reduce<Record<string, number>>((result, record) => {
    result[record.triggerType] = (result[record.triggerType] || 0) + 1;
    return result;
  }, {});
  const triggers = Object.entries(triggerCounts).sort(([, left], [, right]) => right - left);
  const filteredWorkflows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return [...records]
      .filter((record) => statusFilter === "all" || record.status === statusFilter)
      .filter((record) => !needle || `${record.name} ${record.description} ${triggerLabel(record.triggerType)}`.toLowerCase().includes(needle))
      .sort((left, right) => {
        if (sort === "name") return left.name.localeCompare(right.name);
        if (sort === "executions") return right.stats.executions - left.stats.executions;
        return right.updatedAt.localeCompare(left.updatedAt);
      });
  }, [records, search, sort, statusFilter]);
  const pageCount = Math.max(1, Math.ceil(filteredWorkflows.length / pageSize));
  const visibleWorkflows = filteredWorkflows.slice((Math.min(page, pageCount) - 1) * pageSize, Math.min(page, pageCount) * pageSize);
  useEffect(() => setPage(1), [search, statusFilter, sort]);

  return (
    <div className="space-y-5">
      {error && (
        <section className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/25 bg-destructive/5 p-4">
          <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold">Workflows could not be loaded</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{error}</p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onRefresh}>
            <RotateCcw className="mr-2 h-3.5 w-3.5" /> Try again
          </Button>
        </section>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <OverviewStat icon={WorkflowIcon} label="Total workflows" value={String(records.length)} detail={`${published} published`} />
        <OverviewStat icon={Activity} label="Total executions" value={String(totals.executions)} detail={`${totals.failures} failed runs`} />
        <OverviewStat icon={Check} label="Success rate" value={successRate} detail={`${totals.successes} completed runs`} />
        <OverviewStat icon={Zap} label="Active triggers" value={String(triggers.length)} detail="Connected trigger types" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,.65fr)]">
        <section className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
            <div>
              <h2 className="text-[14px] font-semibold">Your workflows</h2>
              <p className="mt-1 text-[11px] text-muted-foreground">Create, publish, and monitor cross-module automations.</p>
            </div>
            <Button type="button" size="sm" onClick={onCreate} disabled={busy}>
              <Plus className="mr-2 h-3.5 w-3.5" /> New workflow
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
            <div className="relative min-w-[190px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search workflows" aria-label="Search workflows" className="h-8 pl-8 text-[11px]" />
            </div>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter workflows by status" className="h-8 rounded-md border border-input bg-background px-2.5 text-[11px] text-foreground">
              <option value="all">All statuses</option>
              <option value="published">Live</option>
              <option value="paused">Paused</option>
              <option value="draft">Draft</option>
              <option value="archived">Archived</option>
            </select>
            <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Sort workflows" className="h-8 rounded-md border border-input bg-background px-2.5 text-[11px] text-foreground">
              <option value="updated">Recently updated</option>
              <option value="name">Name</option>
              <option value="executions">Most runs</option>
            </select>
          </div>
          {visibleWorkflows.length ? (
            <div className="divide-y divide-border">
              {visibleWorkflows.map((record) => (
                <button
                  key={record.id}
                  type="button"
                  onClick={() => onOpen(record.id)}
                  className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-muted/40"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <WorkflowIcon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-medium">{record.name}</span>
                    <span className="mt-1 block text-[10px] text-muted-foreground">
                      {triggerLabel(record.triggerType)} · updated {formatDate(record.updatedAt)}
                    </span>
                  </span>
                  <Badge variant="outline" className={cn("rounded-full text-[10px]", statusClass(record.status))}>
                    {statusLabel(record.status)}
                  </Badge>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              ))}
            </div>
          ) : (
            <div className="px-5 py-12 text-center">
              <WorkflowIcon className="mx-auto h-7 w-7 text-muted-foreground/50" />
              <p className="mt-3 text-[13px] font-medium">{records.length ? "No workflows match these filters" : "No workflows yet"}</p>
              <p className="mx-auto mt-1 max-w-[330px] text-[11px] leading-5 text-muted-foreground">{records.length ? "Clear the search or status filter to see more workflows." : "Start with a trigger, then connect actions across Forms, Events, CRM, Payments, Email, and more."}</p>
              {!records.length && <Button type="button" className="mt-5" onClick={onCreate} disabled={busy}>
                <Plus className="mr-2 h-3.5 w-3.5" /> Create workflow
              </Button>}
            </div>
          )}
          {filteredWorkflows.length > pageSize && <div className="flex items-center justify-between border-t border-border px-5 py-3 text-[10px] text-muted-foreground"><span>Page {Math.min(page, pageCount)} of {pageCount}</span><div className="flex items-center gap-1"><Button type="button" variant="ghost" size="sm" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1}>Previous</Button><Button type="button" variant="ghost" size="sm" onClick={() => setPage((current) => Math.min(pageCount, current + 1))} disabled={page >= pageCount}>Next <ChevronRight className="ml-1 h-3.5 w-3.5" /></Button></div></div>}
        </section>

        <section className="rounded-xl border border-border bg-card p-5 shadow-xs">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10 text-violet-500">
              <Zap className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-[14px] font-semibold">Trigger coverage</h2>
              <p className="mt-1 text-[11px] text-muted-foreground">Where your automations start.</p>
            </div>
          </div>
          {triggers.length ? (
            <div className="mt-5 space-y-3">
              {triggers.map(([type, count]) => (
                <div key={type} className="flex items-center gap-3">
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(14, (count / records.length) * 100)}%` }} />
                  </span>
                  <span className="w-[116px] truncate text-right text-[11px] text-muted-foreground">{triggerLabel(type)}</span>
                  <span className="w-5 text-right text-[11px] font-semibold">{count}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-8 text-center text-[11px] text-muted-foreground">Your trigger coverage will appear here.</p>
          )}
        </section>
      </div>
      <section className="rounded-xl border border-border bg-card p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-[14px] font-semibold">Start from a template</h2><p className="mt-1 text-[11px] text-muted-foreground">Use a tested cross-module pattern, then customize it in the Editor.</p></div>
          <Badge variant="outline" className="rounded-full text-[10px]">{templates.length} available</Badge>
        </div>
        {templatesLoading ? <div className="mt-4 grid gap-3 sm:grid-cols-3">{[1, 2, 3].map((item) => <div key={item} className="h-24 animate-pulse rounded-xl bg-muted/60" />)}</div> : templates.length ? <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{templates.slice(0, 6).map((template) => <button key={template.id} type="button" onClick={() => onTemplate(template.id)} disabled={busy} className="rounded-xl border border-border bg-background p-3 text-left transition hover:border-primary/40 hover:bg-muted/30 disabled:opacity-60"><div className="flex items-start justify-between gap-2"><span className="text-[12px] font-semibold">{template.name}</span><Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /></div><p className="mt-1.5 line-clamp-2 text-[10px] leading-4 text-muted-foreground">{template.description}</p><span className="mt-3 inline-flex rounded-full bg-primary/10 px-2 py-1 text-[9px] font-medium text-primary">{template.category}</span></button>)}</div> : <p className="mt-4 text-[11px] text-muted-foreground">Templates will appear here as they become available.</p>}
      </section>
    </div>
  );
}

function WorkflowEmptyTab({
  icon: Icon,
  title,
  description,
  onCreate,
  busy,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  onCreate: () => void;
  busy: boolean;
}) {
  return (
    <section className="flex min-h-[300px] items-center justify-center rounded-xl border border-dashed border-border bg-card/50 p-8 text-center">
      <div className="max-w-[360px]">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </span>
        <h2 className="mt-4 text-[15px] font-semibold">{title}</h2>
        <p className="mt-1.5 text-[12px] leading-5 text-muted-foreground">{description}</p>
        <Button type="button" className="mt-5" onClick={onCreate} disabled={busy}>
          <Plus className="mr-2 h-3.5 w-3.5" /> Create your first workflow
        </Button>
      </div>
    </section>
  );
}

function EmptyWorkflows({ onCreate, busy }: { onCreate: () => void; busy: boolean }) {
  return (
    <div className="flex min-h-[min(680px,calc(100vh-210px))] items-center justify-center px-4 py-12">
      <div className="relative w-full max-w-[620px] overflow-hidden rounded-[28px] border border-border bg-card p-8 text-center shadow-xs sm:p-12">
        <div className="pointer-events-none absolute -right-24 -top-28 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-28 -left-24 h-64 w-64 rounded-full bg-violet-500/10 blur-3xl" />
        <span className="relative mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/20 bg-primary/8 text-primary shadow-xs">
          <WorkflowIcon className="h-7 w-7" strokeWidth={1.7} />
        </span>
        <p className="relative mt-6 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
          Workspace workflows
        </p>
        <h1 className="relative mt-3 text-[29px] font-semibold tracking-[-0.035em] text-foreground sm:text-[38px]">
          Connect every part of your workspace.
        </h1>
        <p className="relative mx-auto mt-4 max-w-[500px] text-[14px] leading-6 text-muted-foreground">
          Build an automation once, then let Forms, Events, Appointments, CRM,
          Payments, Email, Files, and more move together when something changes.
        </p>
        <div className="relative mt-8 flex flex-wrap justify-center gap-2 text-[11px] text-muted-foreground">
          {["Editor", "Executions", "Evaluations", "Module triggers"].map((item) => (
            <span key={item} className="rounded-full border border-border bg-background px-3 py-1.5">
              {item}
            </span>
          ))}
        </div>
        <Button className="relative mt-9 rounded-xl px-5" onClick={onCreate} disabled={busy}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
          Create your first workflow
        </Button>
        <p className="relative mt-4 text-[11px] text-muted-foreground">
          Form automations remain safely inside Forms.
        </p>
      </div>
    </div>
  );
}

function NodePalette({
  search,
  onSearchChange,
  onAdd,
  connections,
  connectionsLoading,
  connectionsError,
  onAddConnection,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  onAdd: (entry: WorkflowNodeCatalogEntry) => void;
  connections: WorkflowConnection[];
  connectionsLoading: boolean;
  connectionsError: string;
  onAddConnection: (connection: WorkflowConnection) => void;
}) {
  const filtered = WORKFLOW_NODE_CATALOG.filter((entry) =>
    `${entry.label} ${entry.description} ${entry.module}`.toLowerCase().includes(search.toLowerCase()),
  );
  const groups = [
    { key: "triggers", label: "Triggers" },
    { key: "actions", label: "Actions" },
    { key: "logic", label: "Logic" },
  ] as const;
  return (
    // Below lg the three columns stack and share the height, which squeezed
    // the palette to nothing — a node library you cannot pick a node from.
    // It keeps a usable slice on small screens and scrolls within it.
    <aside className="flex max-h-[260px] min-h-[200px] flex-col border-b border-border bg-card/70 lg:max-h-none lg:min-h-0 lg:border-b-0 lg:border-r">
      <div className="border-b border-border p-4">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Plus className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[13px] font-semibold">Node library</p>
            <p className="text-[11px] text-muted-foreground">Build the next step</p>
          </div>
        </div>
        <div className="relative mt-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search nodes"
            className="h-9 rounded-lg pl-9 text-[12px]"
            aria-label="Search workflow nodes"
          />
        </div>
      </div>
      <div className="dashboard-scroll min-h-0 flex-1 overflow-y-auto p-3">
        {groups.map((group) => {
          const entries = filtered.filter((entry) => entry.category === group.key);
          if (entries.length === 0) return null;
          return (
            <div key={group.key} className="mb-5 last:mb-0">
              <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {group.label}
              </p>
              <div className="space-y-1">
                {entries.map((entry) => {
                  const Icon = iconForNode(entry.type);
                  return (
                    <button
                      key={entry.type}
                      type="button"
                      onClick={() => onAdd(entry)}
                      className="group flex w-full items-start gap-2.5 rounded-lg border border-transparent px-2.5 py-2 text-left transition hover:border-border hover:bg-background"
                    >
                      <span
                        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white shadow-xs"
                        style={{ backgroundColor: entry.color }}
                      >
                        <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-[12px] font-medium text-foreground">{entry.label}</span>
                          <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
                        </span>
                        <span className="mt-0.5 block line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                          {entry.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && <p className="px-2 py-8 text-center text-[12px] text-muted-foreground">No nodes found.</p>}
        {(connectionsLoading || connectionsError || connections.length > 0) && (
          <div className="mb-2 mt-6">
            <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Connected providers</p>
            {connectionsLoading && <div className="space-y-2 px-2"><div className="h-9 animate-pulse rounded-lg bg-muted/60" /><div className="h-9 animate-pulse rounded-lg bg-muted/60" /></div>}
            {connectionsError && <p className="mx-2 rounded-lg border border-destructive/20 bg-destructive/5 p-2 text-[11px] leading-4 text-destructive">{connectionsError}</p>}
            {!connectionsLoading && !connectionsError && <div className="space-y-1">
              {connections.map((connection) => (
                <button
                  key={connection.id}
                  type="button"
                  onClick={() => onAddConnection(connection)}
                  className="group flex w-full items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-2 text-left transition hover:border-border hover:bg-background"
                  aria-label={`Add ${connection.providerName} action`}
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border bg-white p-1 dark:bg-white">
                    <WorkflowProviderLogo provider={connection.provider} className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-medium text-foreground">{connection.providerName}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{connection.label}</span>
                  </span>
                  <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
                </button>
              ))}
            </div>}
          </div>
        )}
      </div>
    </aside>
  );
}

function NodeConfigPanel({
  node,
  connections,
  onChange,
  onDelete,
}: {
  node: WorkflowNode | null;
  connections: WorkflowConnection[];
  onChange: (patch: Partial<WorkflowNode>) => void;
  onDelete: () => void;
}) {
  const entry = node ? workflowNodeCatalogEntry(node.type) : undefined;
  const updateParameter = (key: string, value: unknown) =>
    node && onChange({ parameters: { ...node.parameters, [key]: value } });
  if (!node) {
    return (
      <aside className="min-h-0 overflow-y-auto border-t border-border bg-card/70 p-4 lg:border-l lg:border-t-0">
        <div className="flex h-full min-h-[250px] flex-col items-center justify-center text-center">
          <Settings2 className="h-6 w-6 text-muted-foreground/60" />
          <p className="mt-3 text-[13px] font-semibold">Select a node</p>
          <p className="mt-1 max-w-[210px] text-[11px] leading-5 text-muted-foreground">
            Choose a step on the canvas to configure its mappings, error policy, and connections.
          </p>
        </div>
      </aside>
    );
  }
  const Icon = iconForNode(node.type);
  const parameter = (key: string) => String(node.parameters[key] ?? "");
  const selectedConnection = connections.find((connection) => connection.id === parameter("connectionId")) || null;
  const providerOperations = connectedProviderOperations(selectedConnection?.provider || "");
  const selectedOperation = parameter("operation");
  // One resolver for every provider rather than a per-provider special case,
  // so a step whose connection is missing, unchosen or unauthorised is treated
  // the same way regardless of which app it runs through.
  const standing = connectionStanding(connections, selectedConnection, selectedOperation);
  const connectionBlocked = connectionBlocks(standing);
  return (
    <aside className="dashboard-scroll min-h-0 max-h-[500px] overflow-y-auto border-t border-border bg-card/70 p-4 lg:max-h-none lg:border-l lg:border-t-0">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white" style={{ backgroundColor: selectedConnection ? "#ffffff" : (entry?.color || "#64748b") }}>
            {selectedConnection ? <WorkflowProviderLogo provider={selectedConnection.provider} operation={selectedOperation} className="h-6 w-6" /> : <Icon className="h-4 w-4" />}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold">{entry?.label || node.type}</p>
            <p className="truncate text-[11px] text-muted-foreground">{entry?.module || "Workspace"} node</p>
          </div>
        </div>
        <button type="button" onClick={onDelete} className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label="Delete selected node">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-6 space-y-4">
        <div className="space-y-2">
          <Label className="text-[11px]">Node name</Label>
          <Input value={node.name} onChange={(event) => onChange({ name: event.target.value })} className="h-9 text-[12px]" />
        </div>
        <div className="space-y-2">
          <Label className="text-[11px]">Node type</Label>
          <div className="flex h-9 items-center rounded-md border border-border bg-muted/40 px-3 text-[11px] text-muted-foreground">{node.type}</div>
        </div>

        {node.type === "trigger.schedule" && (
          <div className="space-y-2">
            <Label className="text-[11px]">Run every (minutes)</Label>
            <Input type="number" min={1} max={10080} value={parameter("intervalMinutes") || "60"} onChange={(event) => updateParameter("intervalMinutes", Number(event.target.value) || 1)} className="h-9 text-[12px]" />
            <p className="text-[11px] leading-4 text-muted-foreground">The workspace scheduler checks published workflows every minute.</p>
          </div>
        )}

        {node.type === "logic.if" && (
          <>
            <div className="space-y-2">
              <Label className="text-[11px]">Payload field</Label>
              <Input value={parameter("field")} onChange={(event) => updateParameter("field", event.target.value)} placeholder="$json.email" className="h-9 text-[12px]" />
            </div>
            <div className="space-y-2">
              <Label className="text-[11px]">Condition</Label>
              <select value={parameter("operator") || "exists"} onChange={(event) => updateParameter("operator", event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-[12px] text-foreground">
                <option value="exists">exists</option>
                <option value="equals">equals</option>
                <option value="contains">contains</option>
                <option value="not_equals">does not equal</option>
                <option value="greater_than">is greater than</option>
                <option value="less_than">is less than</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label className="text-[11px]">Expected value</Label>
              <Input value={parameter("value")} onChange={(event) => updateParameter("value", event.target.value)} className="h-9 text-[12px]" />
            </div>
          </>
        )}

        {node.type === "logic.delay" && (
          <div className="space-y-2">
            <Label className="text-[11px]">Wait (seconds)</Label>
            <Input type="number" min={1} max={86400} value={parameter("seconds") || "3600"} onChange={(event) => updateParameter("seconds", Number(event.target.value) || 1)} className="h-9 text-[12px]" />
            <p className="text-[11px] leading-4 text-muted-foreground">This run is persisted as Waiting and resumed by the workflow worker or scheduler.</p>
          </div>
        )}

        {node.type === "action.http_request" && (
          <>
            <div className="space-y-2">
              <Label className="text-[11px]">HTTPS endpoint</Label>
              <Input value={parameter("url")} onChange={(event) => updateParameter("url", event.target.value)} placeholder="https://api.example.com/hook" className="h-9 text-[12px]" />
            </div>
            <div className="space-y-2">
              <Label className="text-[11px]">Method</Label>
              <select value={parameter("method") || "POST"} onChange={(event) => updateParameter("method", event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-[12px] text-foreground">
                {['POST', 'GET', 'PUT', 'PATCH', 'DELETE'].map((method) => <option key={method}>{method}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label className="text-[11px]">JSON body</Label>
              <Textarea value={parameter("body")} onChange={(event) => updateParameter("body", event.target.value)} className="min-h-[90px] resize-y font-mono text-[11px]" />
            </div>
          </>
        )}

        {node.type === "action.connected_app" && (
          <div className="space-y-3 rounded-lg border border-border bg-background/70 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Connected provider</p>
            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground">Connection</Label>
              <select value={parameter("connectionId")} onChange={(event) => { const connection = connections.find((item) => item.id === event.target.value); const defaults = connectedProviderDefaults(connection?.provider || ""); onChange({ credentialId: event.target.value || null, parameters: { ...node.parameters, ...defaults, connectionId: event.target.value } }); }} className="h-9 w-full rounded-md border border-input bg-background px-3 text-[11px] text-foreground">
                <option value="">Choose an active connection</option>
                {connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.providerName} · {connection.label}</option>)}
              </select>
              {selectedConnection && <div className="mt-2 flex items-center gap-2 rounded-lg border border-border bg-card p-2"><span className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-white p-1 dark:bg-white"><WorkflowProviderLogo provider={selectedConnection.provider} operation={selectedOperation} className="h-5 w-5" /></span><div className="min-w-0"><p className="truncate text-[11px] font-medium">{selectedConnection.providerName}</p><p className="truncate text-[10.5px] text-muted-foreground">{selectedConnection.label}</p></div></div>}
              <div className="mt-2"><WorkflowConnectionState standing={standing} connection={selectedConnection} operation={selectedOperation} /></div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] text-muted-foreground">Action</Label>
              {providerOperations.length ? <select value={selectedOperation || providerOperations[0]} onChange={(event) => updateParameter("operation", event.target.value)} className="h-9 w-full rounded-md border border-input bg-background px-3 text-[11px] text-foreground">{providerOperations.map((operation) => <option key={operation} value={operation}>{connectedOperationLabel(operation)}</option>)}</select> : <Input value={selectedOperation} onChange={(event) => updateParameter("operation", event.target.value)} placeholder="Choose a provider first" className="h-9 text-[11px]" />}
            </div>
            {/* A step cannot be meaningfully mapped against a connection that is
                missing or unauthorised, so the fields are disabled rather than
                offered and then failing at run time. */}
            <fieldset disabled={connectionBlocked} className="space-y-3 disabled:opacity-55">
            {selectedOperation === "gmail.send" && <><MappingField label="To" value={parameter("to")} onChange={(value) => updateParameter("to", value)} placeholder="{{$json.email}}" /><MappingField label="Cc (optional)" value={parameter("cc")} onChange={(value) => updateParameter("cc", value)} placeholder="team@example.com" /><MappingField label="Bcc (optional)" value={parameter("bcc")} onChange={(value) => updateParameter("bcc", value)} placeholder="audit@example.com" /><MappingField label="Subject" value={parameter("subject")} onChange={(value) => updateParameter("subject", value)} placeholder="Workspace update" /><MappingField label="HTML message" value={parameter("html")} onChange={(value) => updateParameter("html", value)} placeholder="<p>Hello {{$json.name}}</p>" multiline /></>}
            {(selectedOperation === "append_row" || selectedOperation === "update_row") && <><MappingField label="Spreadsheet id" value={parameter("spreadsheetId")} onChange={(value) => updateParameter("spreadsheetId", value)} placeholder="Google spreadsheet id" /><MappingField label="Sheet name" value={parameter("sheetName")} onChange={(value) => updateParameter("sheetName", value)} placeholder="Responses" />{selectedOperation === "update_row" && <MappingField label="Row range" value={parameter("range")} onChange={(value) => updateParameter("range", value)} placeholder="Responses!A2:Z2" />}</>}
            {selectedConnection?.provider === "slack" && <MappingField label="Message" value={parameter("message")} onChange={(value) => updateParameter("message", value)} placeholder="New workspace activity: {{$json.name}}" multiline />}
            {selectedConnection?.provider === "airtable" && <><MappingField label="Base id" value={parameter("baseId")} onChange={(value) => updateParameter("baseId", value)} placeholder="app..." /><MappingField label="Table id or name" value={parameter("tableId")} onChange={(value) => updateParameter("tableId", value)} placeholder="tbl..." />{selectedOperation === "update_record" && <MappingField label="Record id" value={parameter("recordId")} onChange={(value) => updateParameter("recordId", value)} placeholder="rec..." />}</>}
            {(selectedConnection?.provider === "hubspot" || selectedConnection?.provider === "mailchimp") && <><MappingField label="Email" value={parameter("email")} onChange={(value) => updateParameter("email", value)} placeholder="{{$json.email}}" /><MappingField label="Full name" value={parameter("fullName")} onChange={(value) => updateParameter("fullName", value)} placeholder="{{$json.fullName}}" /></>}
            {selectedConnection?.provider === "mailchimp" && <><MappingField label="Audience id" value={parameter("audienceId")} onChange={(value) => updateParameter("audienceId", value)} placeholder="Audience id" />{selectedOperation === "add_tags" && <MappingField label="Tags (comma separated)" value={parameter("tags")} onChange={(value) => updateParameter("tags", value)} placeholder="lead, event" />}</>}
            {selectedConnection?.provider === "notion" && <>{selectedOperation === "append_content" ? <MappingField label="Page id" value={parameter("pageId")} onChange={(value) => updateParameter("pageId", value)} placeholder="Notion page id" /> : <MappingField label="Data source id" value={parameter("databaseId")} onChange={(value) => updateParameter("databaseId", value)} placeholder="Notion data source id" />}<MappingField label="Page title" value={parameter("pageTitle")} onChange={(value) => updateParameter("pageTitle", value)} placeholder="{{$json.title}}" /></>}
            {selectedConnection?.provider === "dropbox" && <>{selectedOperation === "create_folder" ? <MappingField label="Folder path" value={parameter("path")} onChange={(value) => updateParameter("path", value)} placeholder="/Workspace/{{$json.name}}" /> : <><MappingField label="File path" value={parameter("path")} onChange={(value) => updateParameter("path", value)} placeholder="/Workspace/output.txt" /><MappingField label="File content" value={parameter("content")} onChange={(value) => updateParameter("content", value)} placeholder="{{$json.message}}" multiline /></>}</>}
            </fieldset>
          </div>
        )}

        {["action.create_contact", "action.update_contact", "action.create_appointment", "action.send_workspace_email", "action.create_form", "action.create_event", "action.create_document", "action.create_folder", "action.log"].includes(node.type) && (
          <div className="space-y-3 rounded-lg border border-border bg-background/70 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Data mapping</p>
            {node.type === "action.send_workspace_email" && <MappingField label="Recipient" value={parameter("to")} onChange={(value) => updateParameter("to", value)} placeholder="{{$json.email}}" />}
            {node.type === "action.send_workspace_email" && <MappingField label="Subject" value={parameter("subject")} onChange={(value) => updateParameter("subject", value)} placeholder="Your subject" />}
            {node.type === "action.send_workspace_email" && <MappingField label="Message HTML" value={parameter("html")} onChange={(value) => updateParameter("html", value)} placeholder="<p>Hello {{$json.name}}</p>" multiline />}
            {node.type === "action.create_contact" && <MappingField label="Email" value={parameter("email")} onChange={(value) => updateParameter("email", value)} placeholder="{{$json.email}}" />}
            {node.type === "action.create_contact" && <MappingField label="Full name" value={parameter("fullName")} onChange={(value) => updateParameter("fullName", value)} placeholder="{{$json.fullName}}" />}
            {node.type === "action.update_contact" && <MappingField label="Contact id" value={parameter("contactId")} onChange={(value) => updateParameter("contactId", value)} placeholder="{{$json.contactId}}" />}
            {node.type === "action.create_form" && <MappingField label="Form title" value={parameter("title")} onChange={(value) => updateParameter("title", value)} placeholder="{{$json.title}}" />}
            {node.type === "action.create_event" && <MappingField label="Event title" value={parameter("title")} onChange={(value) => updateParameter("title", value)} placeholder="{{$json.title}}" />}
            {node.type === "action.create_document" && <MappingField label="Template id" value={parameter("templateId")} onChange={(value) => updateParameter("templateId", value)} placeholder="Document template id" />}
            {node.type === "action.create_document" && <MappingField label="Document title" value={parameter("title")} onChange={(value) => updateParameter("title", value)} placeholder="{{$json.title}}" />}
            {node.type === "action.create_document" && <MappingField label="Signers JSON" value={JSON.stringify(node.parameters.signers || [], null, 2)} onChange={(value) => { try { updateParameter("signers", JSON.parse(value)); } catch { updateParameter("signers", []); } }} placeholder='[{"name":"Ada","email":"ada@example.com"}]' multiline />}
            {node.type === "action.create_folder" && <MappingField label="Folder name" value={parameter("name")} onChange={(value) => updateParameter("name", value)} placeholder="{{$json.folderName}}" />}
            {node.type === "action.create_folder" && <MappingField label="Parent folder id (optional)" value={parameter("parentId")} onChange={(value) => updateParameter("parentId", value)} placeholder="Folder id" />}
            {node.type === "action.create_appointment" && <MappingField label="Start time" value={parameter("startsAt")} onChange={(value) => updateParameter("startsAt", value)} placeholder="{{$json.startsAt}}" />}
            {node.type === "action.create_appointment" && <MappingField label="End time" value={parameter("endsAt")} onChange={(value) => updateParameter("endsAt", value)} placeholder="{{$json.endsAt}}" />}
            {node.type === "action.log" && <MappingField label="Log message" value={parameter("message")} onChange={(value) => updateParameter("message", value)} placeholder="{{$json}}" multiline />}
          </div>
        )}

        <div className="space-y-2">
          <Label className="text-[11px]">When this node fails</Label>
          <select value={node.onError} onChange={(event) => onChange({ onError: event.target.value as WorkflowNode["onError"] })} className="h-9 w-full rounded-md border border-input bg-background px-3 text-[12px] text-foreground">
            <option value="stop">Stop workflow</option>
            <option value="continue">Continue with an error</option>
            <option value="retry">Retry up to 3 times</option>
          </select>
        </div>
        <div className="rounded-lg border border-primary/15 bg-primary/6 p-3 text-[11px] leading-5 text-muted-foreground">
          <div className="flex items-center gap-2 text-primary"><Settings2 className="h-3.5 w-3.5" /><span className="font-medium">Workspace-safe execution</span></div>
          <p className="mt-1.5">Use mapped payload values or a connected workspace integration. Secrets are never returned to this panel.</p>
        </div>
      </div>
    </aside>
  );
}

function MappingField({ label, value, onChange, placeholder, multiline = false }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; multiline?: boolean }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[10px] text-muted-foreground">{label}</Label>
      {multiline ? <Textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="min-h-[72px] resize-y text-[11px]" /> : <Input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="h-8 text-[11px]" />}
    </div>
  );
}

function EditorView({
  workflow,
  connections,
  connectionsLoading,
  connectionsError,
  onWorkflowChange,
  onRun,
  onTest,
  onUndo,
  onRedo,
  saving,
  lastExecution,
  validation,
}: {
  workflow: WorkflowRecord;
  connections: WorkflowConnection[];
  connectionsLoading: boolean;
  connectionsError: string;
  onWorkflowChange: (next: WorkflowDefinition, previous: WorkflowDefinition, persist?: boolean) => void;
  onRun: () => void;
  onTest: () => void;
  onUndo: () => void;
  onRedo: () => void;
  saving: boolean;
  lastExecution: WorkflowExecution | null;
  validation: WorkflowValidationResult | null;
}) {
  const [search, setSearch] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(workflow.definition.nodes[0]?.id || null);

  /** Nodes the last validation flagged as errors, marked on the canvas. */
  const invalidNodeIds = useMemo(
    () =>
      new Set(
        (validation?.issues || [])
          .filter((issue) => issue.severity === "error" && issue.nodeId)
          .map((issue) => String(issue.nodeId)),
      ),
    [validation],
  );

  /**
   * The badge on a node card. A step that runs through a connected app shows
   * that provider's mark, so a canvas of Gmail and Slack steps is readable
   * without opening each one.
   */
  const renderNodeLogo = useCallback(
    (node: WorkflowNode) => {
      const connectionId = String(
        (node.parameters?.connectionId as string) || node.credentialId || "",
      );
      const connection = connections.find((item) => item.id === connectionId);
      if (connection) {
        return (
          <WorkflowProviderLogo
            provider={connection.provider}
            operation={String(node.parameters?.operation || "")}
            className="h-4 w-4"
          />
        );
      }
      const entry = workflowNodeCatalogEntry(node.type);
      return (
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: entry?.color || "hsl(var(--muted-foreground))" }}
          aria-hidden="true"
        />
      );
    },
    [connections],
  );

  useEffect(() => {
    if (!workflow.definition.nodes.some((node) => node.id === selectedNodeId)) setSelectedNodeId(workflow.definition.nodes[0]?.id || null);
  }, [selectedNodeId, workflow.definition.nodes]);

  const lastNodeRuns = useMemo(() => {
    const map = new Map<string, WorkflowNodeRun>();
    for (const nodeRun of lastExecution?.nodeRuns || []) map.set(nodeRun.nodeId, nodeRun);
    return map;
  }, [lastExecution]);

  const selectedNode = workflow.definition.nodes.find((node) => node.id === selectedNodeId) || null;

  const addNode = (entry: WorkflowNodeCatalogEntry) => {
    const current = workflow.definition;
    const id = nextNodeId(current);
    const node: WorkflowNode = {
      id,
      type: entry.type,
      name: entry.label,
      position: { x: 100 + (current.nodes.length % 3) * 280, y: 100 + Math.floor(current.nodes.length / 3) * 150 },
      parameters: defaultParameters(entry.type),
      credentialId: null,
      onError: "stop",
    };
    const edge: WorkflowEdge | null = selectedNodeId && current.nodes.some((candidate) => candidate.id === selectedNodeId) && !entry.type.startsWith("trigger.")
      ? { id: `edge-${randomId()}`, source: selectedNodeId, target: id }
      : null;
    const next = clone(current);
    next.nodes.push(node);
    if (edge && !next.edges.some((candidate) => candidate.source === edge.source && candidate.target === edge.target)) next.edges.push(edge);
    setSelectedNodeId(id);
    onWorkflowChange(next, current);
  };

  const addConnectedProvider = (connection: WorkflowConnection) => {
    const current = workflow.definition;
    const id = nextNodeId(current);
    const defaults = connectedProviderDefaults(connection.provider);
    const node: WorkflowNode = {
      id,
      type: "action.connected_app",
      name: `${connection.providerName} action`,
      position: { x: 100 + (current.nodes.length % 3) * 280, y: 100 + Math.floor(current.nodes.length / 3) * 150 },
      parameters: { ...defaults, connectionId: connection.id },
      credentialId: connection.id,
      onError: "retry",
    };
    const selectedExists = Boolean(selectedNodeId && current.nodes.some((candidate) => candidate.id === selectedNodeId));
    const edge: WorkflowEdge | null = selectedExists
      ? { id: `edge-${randomId()}`, source: selectedNodeId as string, target: id }
      : null;
    const next = clone(current);
    next.nodes.push(node);
    if (edge && !next.edges.some((candidate) => candidate.source === edge.source && candidate.target === edge.target)) next.edges.push(edge);
    setSelectedNodeId(id);
    onWorkflowChange(next, current);
  };

  const changeNode = (patch: Partial<WorkflowNode>) => {
    if (!selectedNode) return;
    const current = workflow.definition;
    const next = clone(current);
    const target = next.nodes.find((node) => node.id === selectedNode.id);
    if (!target) return;
    Object.assign(target, patch);
    onWorkflowChange(next, current);
  };

  const deleteNode = useCallback(() => {
    if (!selectedNode) return;
    const current = workflow.definition;
    const next = clone(current);
    next.nodes = next.nodes.filter((node) => node.id !== selectedNode.id);
    next.edges = next.edges.filter((edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id);
    setSelectedNodeId(next.nodes[0]?.id || null);
    onWorkflowChange(next, current);
  }, [onWorkflowChange, selectedNode, workflow.definition]);

  const duplicateSelectedNode = useCallback(() => {
    if (!selectedNode) return;
    const current = workflow.definition;
    const id = nextNodeId(current);
    const node: WorkflowNode = {
      ...clone(selectedNode),
      id,
      name: `${selectedNode.name} copy`,
      position: { x: selectedNode.position.x + 40, y: selectedNode.position.y + 40 },
    };
    const next = clone(current);
    next.nodes.push(node);
    if (!node.type.startsWith("trigger.") && selectedNode.id !== node.id) next.edges.push({ id: `edge-${randomId()}`, source: selectedNode.id, target: id });
    setSelectedNodeId(id);
    onWorkflowChange(next, current);
  }, [onWorkflowChange, selectedNode, workflow.definition]);

  const clipboardNode = useRef<WorkflowNode | null>(null);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) onRedo(); else onUndo();
        return;
      }
      if (modifier && event.key.toLowerCase() === "y") {
        event.preventDefault();
        onRedo();
        return;
      }
      if (modifier && event.key.toLowerCase() === "c" && selectedNode) {
        event.preventDefault();
        clipboardNode.current = clone(selectedNode);
        return;
      }
      if (modifier && event.key.toLowerCase() === "v" && clipboardNode.current) {
        event.preventDefault();
        const current = workflow.definition;
        const id = nextNodeId(current);
        const pasted: WorkflowNode = { ...clone(clipboardNode.current), id, name: `${clipboardNode.current.name} copy`, position: { x: clipboardNode.current.position.x + 48, y: clipboardNode.current.position.y + 48 } };
        const next = clone(current);
        next.nodes.push(pasted);
        if (!pasted.type.startsWith("trigger.") && selectedNode) next.edges.push({ id: `edge-${randomId()}`, source: selectedNode.id, target: id });
        setSelectedNodeId(id);
        onWorkflowChange(next, current);
        return;
      }
      if (modifier && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicateSelectedNode();
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selectedNode) {
        event.preventDefault();
        deleteNode();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [deleteNode, duplicateSelectedNode, onRedo, onUndo, onWorkflowChange, selectedNode, workflow.definition]);

  return (
    // Bounded, and each column scrolls in its own right. Without a height the
    // canvas column stretched to match the node palette's natural length, so
    // React Flow sized its pane to ~4500px and fitView centred the graph far
    // below the fold — a canvas that looked empty while holding every node.
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden border-y border-border bg-card">
      <div className="grid min-h-0 flex-1 lg:grid-cols-[228px_minmax(0,1fr)_300px]">
        <NodePalette search={search} onSearchChange={setSearch} onAdd={addNode} connections={connections} connectionsLoading={connectionsLoading} connectionsError={connectionsError} onAddConnection={addConnectedProvider} />
        <div className="flex min-w-0 flex-col border-b border-border bg-background lg:border-b-0">
          {/* React Flow owns zoom, pan and fit, so the hand-rolled zoom bar
              that used to sit here is gone rather than duplicated. */}
          <div className="min-h-[360px] flex-1 lg:min-h-[420px]">
            <WorkflowGraphCanvas
              definition={workflow.definition}
              selectedNodeId={selectedNodeId}
              nodeRuns={lastNodeRuns}
              invalidNodeIds={invalidNodeIds}
              renderLogo={renderNodeLogo}
              onSelect={setSelectedNodeId}
              onDefinitionChange={(next, persist) =>
                onWorkflowChange(next, workflow.definition, persist)
              }
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-1.5 text-[10.5px] text-muted-foreground">
            <span>
              {workflow.definition.nodes.length} node
              {workflow.definition.nodes.length === 1 ? "" : "s"} ·{" "}
              {workflow.definition.edges.length} connection
              {workflow.definition.edges.length === 1 ? "" : "s"}
            </span>
            <span>Drag a handle between steps to connect them</span>
          </div>
        </div>
        <NodeConfigPanel node={selectedNode} connections={connections} onChange={changeNode} onDelete={deleteNode} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card px-4 py-3">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground"><Activity className="h-3.5 w-3.5 text-primary" /> {lastExecution ? `Last run ${statusLabel(lastExecution.status).toLowerCase()} ${formatDate(lastExecution.createdAt)}` : "Run a test to see live node status here."}</div>
        <div className="flex items-center gap-2"><Button onClick={onTest} variant="outline" className="rounded-lg" disabled={saving}><TerminalSquare className="mr-2 h-3.5 w-3.5" /> Test safely</Button><Button onClick={onRun} className="rounded-lg" disabled={saving}><Play className="mr-2 h-3.5 w-3.5" /> Execute workflow</Button></div>
      </div>
    </div>
  );
}

const randomId = () => Math.random().toString(36).slice(2, 9);


function VersionHistoryPanel({
  versions,
  loading,
  working,
  onClose,
  onRestore,
}: {
  versions: WorkflowVersion[];
  loading: boolean;
  working: number | null;
  onClose: () => void;
  onRestore: (version: number) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="workflow-version-history-title">
      <div className="max-h-[min(680px,90vh)] w-full max-w-[620px] overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div><h2 id="workflow-version-history-title" className="text-[15px] font-semibold">Version history</h2><p className="mt-1 text-[11px] text-muted-foreground">Published versions stay frozen while you continue editing the draft.</p></div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close version history"><X className="h-4 w-4" /></button>
        </div>
        <div className="dashboard-scroll max-h-[520px] overflow-y-auto p-4">
          {loading ? <div className="space-y-2">{[1, 2, 3].map((item) => <div key={item} className="h-16 animate-pulse rounded-xl bg-muted/60" />)}</div> : versions.length === 0 ? <p className="py-10 text-center text-[12px] text-muted-foreground">No saved versions yet.</p> : <div className="space-y-2">{versions.map((version) => <div key={version.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border px-3 py-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-[11px] font-semibold text-primary">v{version.version}</span><div className="min-w-0 flex-1"><p className="truncate text-[12px] font-medium">{version.changeSummary || "Saved draft"}</p><p className="mt-1 text-[10px] text-muted-foreground">{formatDate(version.createdAt)}{version.isPublished ? " · Published" : " · Draft"}</p></div>{version.isPublished && <Badge variant="outline" className={cn("rounded-full text-[10px]", statusClass("published"))}>Live</Badge>}<Button type="button" size="sm" variant="outline" onClick={() => onRestore(version.version)} disabled={working === version.version || version.isPublished}>{working === version.version ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="mr-2 h-3.5 w-3.5" />} Restore as draft</Button></div>)}</div>}
        </div>
      </div>
    </div>
  );
}

export function WorkflowsModule() {
  const [records, setRecords] = useState<WorkflowRecord[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tab, setTab] = useState<WorkflowTab>("overview");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [undoStack, setUndoStack] = useState<WorkflowDefinition[]>([]);
  const [redoStack, setRedoStack] = useState<WorkflowDefinition[]>([]);
  const [executions, setExecutions] = useState<WorkflowExecution[]>([]);
  const [executionsLoading, setExecutionsLoading] = useState(false);
  // A toast is gone before the user looks; the panel needs to say it failed
  // rather than showing an empty history that reads as "never run".
  const [executionsError, setExecutionsError] = useState("");
  const [selectedExecution, setSelectedExecution] = useState<WorkflowExecution | null>(null);
  const [datasets, setDatasets] = useState<Array<{ id: string; workflowId: string; name: string; cases: WorkflowEvaluationCase[]; lastRun?: { score: number } | null }>>([]);
  const [datasetsLoading, setDatasetsLoading] = useState(false);
  const [datasetsError, setDatasetsError] = useState("");
  const [connections, setConnections] = useState<WorkflowConnection[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(false);
  const [connectionsError, setConnectionsError] = useState("");
  const [dirty, setDirty] = useState(false);
  // The name while it is being typed. `null` means "not edited since the last
  // save". It is tracked here rather than left to the input's own value so a
  // rename counts as unsaved work like any graph edit: committing only on blur
  // meant typing a name and pressing Escape discarded it with no prompt.
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  // The last autosave failure, kept as state rather than only a toast: a toast
  // is gone in four seconds and the work is still unsaved after it.
  const [saveError, setSaveError] = useState("");
  // Building is a task you sit inside, so the editor opens full-screen and the
  // user can step back out to see the dashboard again.
  const [focusMode, setFocusMode] = useState(true);
  // Which workflow is being opened, and why it could not be.
  const [opening, setOpening] = useState<{ id: string; name: string } | null>(null);
  const [openError, setOpenError] = useState("");
  const [exitPrompt, setExitPrompt] = useState(false);
  const [exitSaving, setExitSaving] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [versions, setVersions] = useState<WorkflowVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versionWorking, setVersionWorking] = useState<number | null>(null);
  const [validation, setValidation] = useState<WorkflowValidationResult | null>(null);
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestDefinitionRef = useRef("");

  // Mirrors nameDraft so the save path can read the pending rename without
  // taking a dependency on render order.
  const nameDraftRef = useRef<string | null>(null);
  nameDraftRef.current = nameDraft;

  const workflow = records.find((record) => record.id === activeId) || null;
  // Read by the save-and-exit path, which must write whatever is on screen at
  // the moment it runs rather than whatever was current when it was defined.
  const latestWorkflowRef = useRef<WorkflowRecord | null>(null);
  latestWorkflowRef.current = workflow;

  const refreshWorkflows = async () => {
    setLoading(true);
    try {
      const result = await listWorkflows();
      const normalized = (Array.isArray(result) ? result : [])
        .map((item) => mapWorkflowRecord(item) || item)
        .filter((item): item is WorkflowRecord => Boolean(item));
      setRecords(normalized);
      setActiveId((current) => current && normalized.some((item) => item.id === current) ? current : normalized[0]?.id || null);
      setError("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Workflows could not be loaded.");
    } finally { setLoading(false); }
  };

  useEffect(() => { void refreshWorkflows(); }, []);
  useEffect(() => {
    setConnectionsLoading(true);
    setConnectionsError("");
    void listWorkflowConnections()
      .then((items) => setConnections(Array.isArray(items) ? items : []))
      .catch((requestError) => {
        setConnections([]);
        setConnectionsError(requestError instanceof Error ? requestError.message : "Connected providers could not be loaded. Refresh and try again.");
      })
      .finally(() => setConnectionsLoading(false));
    setTemplatesLoading(true);
    void listWorkflowTemplates().then(setTemplates).catch(() => setTemplates([])).finally(() => setTemplatesLoading(false));
  }, []);
  useEffect(() => { setUndoStack([]); setRedoStack([]); setSelectedExecution(null); setDirty(false); setNameDraft(null); setMoreOpen(false); setValidation(null); }, [activeId]);

  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const refreshExecutions = useCallback(async () => {
    if (!workflow) return;
    setExecutionsLoading(true);
    setExecutionsError("");
    try { setExecutions(await listWorkflowExecutions(workflow.id)); } catch (requestError) { const message = requestError instanceof Error ? requestError.message : "Executions could not be loaded."; setExecutionsError(message); toast.error(message); } finally { setExecutionsLoading(false); }
  }, [workflow]);
  const refreshDatasets = useCallback(async () => {
    if (!workflow) return;
    setDatasetsLoading(true);
    setDatasetsError("");
    try { setDatasets(await listWorkflowEvaluations(workflow.id)); } catch (requestError) { const message = requestError instanceof Error ? requestError.message : "Checks could not be loaded."; setDatasetsError(message); toast.error(message); } finally { setDatasetsLoading(false); }
  }, [workflow]);
  useEffect(() => { if (tab === "executions") void refreshExecutions(); if (tab === "evaluations") void refreshDatasets(); }, [tab, activeId, refreshDatasets, refreshExecutions]);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  /**
   * Opening a workflow.
   *
   * The full record — definition, connections, run history — is fetched before
   * the editor mounts, so nobody watches a canvas assemble itself. There is no
   * artificial delay: an already-loaded workflow clears the state on the same
   * tick and goes straight in.
   */
  const openWorkflow = useCallback(
    async (workflowId: string) => {
      const known = records.find((record) => record.id === workflowId);
      setOpenError("");
      setOpening({ id: workflowId, name: known?.name || "" });
      setFocusMode(true);
      setTab("editor");
      try {
        const fresh = await getWorkflow(workflowId);
        const normalized = fresh ? mapWorkflowRecord(fresh) : null;
        if (!normalized) throw new Error("This workflow no longer exists.");
        setRecords((current) => updateRecord(current, normalized));
        setActiveId(normalized.id);
        setDirty(false);
        setSaveError("");
        latestDefinitionRef.current = JSON.stringify(normalized.definition);
        setOpening(null);
      } catch (requestError) {
        setOpenError(
          requestError instanceof Error
            ? requestError.message
            : "This workflow could not be opened.",
        );
      }
    },
    [records],
  );

  /** Leaves the editor for the list, dropping the editor-only state with it. */
  const leaveEditor = useCallback(() => {
    setExitPrompt(false);
    setOpening(null);
    setOpenError("");
    setSaveError("");
    setDirty(false);
    setTab("workflows");
  }, []);

  /**
   * Saves the current definition immediately and reports whether it landed.
   *
   * Used by Save & exit and by the retry on a failed autosave. It cancels the
   * pending debounce first so the two cannot race and leave a later write
   * overwriting the one the user just confirmed.
   */
  const saveNow = useCallback(async () => {
    const current = latestWorkflowRef.current;
    if (!current) return true;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    setSaving(true);
    try {
      // A rename still in the input goes in the same request as the graph, so
      // Save & exit cannot leave with the new name unsaved.
      const pendingName = nameDraftRef.current?.trim();
      const saved = await updateWorkflow(current.id, {
        definition: current.definition,
        revision: current.revision,
        ...(pendingName && pendingName !== current.name ? { name: pendingName } : {}),
      });
      const normalized = mapWorkflowRecord(saved) || saved;
      setRecords((existing) => updateRecord(existing, normalized));
      latestDefinitionRef.current = JSON.stringify(current.definition);
      setNameDraft(null);
      setDirty(false);
      setSaveError("");
      return true;
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : "Workflow could not be saved.";
      setSaveError(message);
      setDirty(true);
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  /** True while the editor owns the whole screen and the module chrome hides. */
  const editorFocused = tab === "editor" && focusMode;

  /** Back, Escape and the close control all come through here. */
  const requestExit = useCallback(() => {
    if (dirty || saveError) {
      setExitPrompt(true);
      return;
    }
    leaveEditor();
  }, [dirty, saveError, leaveEditor]);

  const persistDefinition = (next: WorkflowDefinition) => {
    if (!workflow) return;
    latestDefinitionRef.current = JSON.stringify(next);
    const workflowId = workflow.id;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaving(true);
    saveTimer.current = setTimeout(() => {
      void (async () => {
        try {
          const saved = await updateWorkflow(workflowId, { definition: next, revision: workflow?.revision });
          const normalized = mapWorkflowRecord(saved) || saved;
          setRecords((current) => updateRecord(current, normalized));
          setSaveError("");
          if (latestDefinitionRef.current === JSON.stringify(next)) setDirty(false);
        } catch (requestError) {
          setDirty(true);
          // Held in the toolbar as well as toasted: the toast disappears while
          // the work is still only in the browser.
          setSaveError(requestError instanceof Error ? requestError.message : "Workflow could not be saved.");
          toast.error(requestError instanceof Error ? requestError.message : "Workflow could not be saved.");
        } finally {
          setSaving(false);
          saveTimer.current = null;
        }
      })();
    }, 350);
  };

  const changeDefinition = (next: WorkflowDefinition, previous: WorkflowDefinition, persist = true) => {
    if (persist) {
      setUndoStack((current) => [...current.slice(-29), clone(previous)]);
      setRedoStack([]);
    }
    setRecords((current) => workflow ? updateRecord(current, { ...workflow, definition: next, updatedAt: new Date().toISOString() }) : current);
    if (persist) setValidation(null);
    if (persist) {
      latestDefinitionRef.current = JSON.stringify(next);
      setDirty(true);
    }
    if (persist) void persistDefinition(next);
  };

  const undo = () => {
    if (!workflow || undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((current) => current.slice(0, -1));
    setRedoStack((current) => [...current, clone(workflow.definition)]);
    setRecords((current) => updateRecord(current, { ...workflow, definition: previous }));
    void persistDefinition(previous);
  };
  const redo = () => {
    if (!workflow || redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((current) => current.slice(0, -1));
    setUndoStack((current) => [...current, clone(workflow.definition)]);
    setRecords((current) => updateRecord(current, { ...workflow, definition: next }));
    void persistDefinition(next);
  };

  const createNew = async () => {
    setBusy(true);
    try { const created = await createWorkflow({ name: `New workflow ${records.length + 1}`, definition: defaultWorkflowDefinition() }); const normalized = mapWorkflowRecord(created) || created; setRecords((current) => [normalized, ...current]); setActiveId(normalized.id); setTab("editor"); toast.success("Workflow created."); } catch (requestError) { toast.error(requestError instanceof Error ? requestError.message : "Workflow could not be created."); } finally { setBusy(false); }
  };

  const createFromTemplate = async (templateId: string) => {
    setBusy(true);
    try {
      const created = mapWorkflowRecord(await createWorkflowFromTemplate(templateId));
      if (!created) throw new Error("The workflow template could not be loaded.");
      setRecords((current) => [created, ...current]);
      setActiveId(created.id);
      setTab("editor");
      toast.success("Workflow created from template.");
    } catch (requestError) { toast.error(requestError instanceof Error ? requestError.message : "Workflow template could not be used."); } finally { setBusy(false); }
  };

  const saveMetadata = async (patch: { name?: string; description?: string }) => {
    if (!workflow) return false;
    setSaving(true);
    try {
      const saved = await updateWorkflow(workflow.id, { ...patch, revision: workflow.revision });
      const normalized = mapWorkflowRecord(saved) || saved;
      setRecords((current) => updateRecord(current, normalized));
      return true;
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "Workflow details could not be saved.";
      // Recorded as well as toasted. A failed rename that only toasts leaves the
      // editor looking saved while the new name exists nowhere but the input.
      setSaveError(message);
      toast.error(message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  /**
   * Writes a pending rename. Called on blur; the save path handles the case
   * where the user leaves without the input ever blurring.
   */
  const commitName = async () => {
    if (!workflow || nameDraft === null) return true;
    const name = nameDraft.trim() || "Untitled workflow";
    if (name === workflow.name) {
      setNameDraft(null);
      return true;
    }
    setRecords((current) => updateRecord(current, { ...workflow, name }));
    const saved = await saveMetadata({ name });
    if (saved) {
      setNameDraft(null);
      // Only the rename was outstanding; a graph edit keeps its own dirty flag.
      if (latestDefinitionRef.current === JSON.stringify(workflow.definition)) setDirty(false);
    }
    return saved;
  };

  const togglePublish = async () => {
    if (!workflow) return;
    setBusy(true);
    try {
      const saved = workflow.status === "paused"
        ? await setWorkflowEnabled(workflow.id, true)
        : await publishWorkflow(workflow.id, workflow.status !== "published");
      const normalized = mapWorkflowRecord(saved) || saved;
      setRecords((current) => updateRecord(current, normalized));
      toast.success(normalized.status === "published" ? "Workflow is live." : "Workflow moved back to draft.");
    } catch (requestError) { toast.error(requestError instanceof Error ? requestError.message : "Workflow status could not be changed."); } finally { setBusy(false); }
  };

  const toggleEnabled = async () => {
    if (!workflow || (workflow.status !== "published" && workflow.status !== "paused")) return;
    setBusy(true);
    try {
      const saved = mapWorkflowRecord(await setWorkflowEnabled(workflow.id, workflow.status === "paused"));
      if (!saved) throw new Error("Workflow could not be reloaded.");
      setRecords((current) => updateRecord(current, saved));
      toast.success(saved.status === "published" ? "Workflow resumed." : "Workflow paused.");
    } catch (requestError) { toast.error(requestError instanceof Error ? requestError.message : "Workflow could not be paused."); } finally { setBusy(false); setMoreOpen(false); }
  };

  const validateCurrent = async () => {
    if (!workflow) return;
    setBusy(true);
    try {
      const result = await validateWorkflow(workflow.id);
      setValidation(result);
      if (result.valid) toast.success("Workflow is ready to publish.");
      else toast.error(`${result.issues.filter((issue) => issue.severity === "error").length} issue(s) need attention before publishing.`);
    } catch (requestError) { toast.error(requestError instanceof Error ? requestError.message : "Workflow validation could not be completed."); } finally { setBusy(false); }
  };

  const duplicateCurrent = async () => {
    if (!workflow) return;
    setBusy(true);
    try {
      const copied = mapWorkflowRecord(await duplicateWorkflow(workflow.id));
      if (!copied) throw new Error("The duplicated workflow could not be loaded.");
      setRecords((current) => [copied, ...current]);
      setActiveId(copied.id);
      setTab("editor");
      toast.success("Workflow duplicated as a draft.");
    } catch (requestError) { toast.error(requestError instanceof Error ? requestError.message : "Workflow could not be duplicated."); } finally { setBusy(false); setMoreOpen(false); }
  };

  const archiveCurrent = async () => {
    if (!workflow) return;
    setBusy(true);
    try {
      const saved = mapWorkflowRecord(await archiveWorkflow(workflow.id, workflow.status !== "archived"));
      if (!saved) throw new Error("Workflow could not be reloaded.");
      setRecords((current) => updateRecord(current, saved));
      toast.success(saved.status === "archived" ? "Workflow archived." : "Workflow restored as a draft.");
    } catch (requestError) { toast.error(requestError instanceof Error ? requestError.message : "Workflow lifecycle action failed."); } finally { setBusy(false); setMoreOpen(false); }
  };

  const removeCurrent = async () => {
    if (!workflow || !window.confirm(`Delete “${workflow.name}”? This removes its run history too.`)) return;
    setBusy(true);
    try {
      await deleteWorkflow(workflow.id);
      const remaining = records.filter((record) => record.id !== workflow.id);
      setRecords(remaining);
      setActiveId(remaining[0]?.id || null);
      setTab("overview");
      toast.success("Workflow deleted.");
    } catch (requestError) { toast.error(requestError instanceof Error ? requestError.message : "Workflow could not be deleted."); } finally { setBusy(false); setMoreOpen(false); }
  };

  const openVersions = async () => {
    if (!workflow) return;
    setMoreOpen(false);
    setVersionsOpen(true);
    setVersionsLoading(true);
    try { setVersions(await listWorkflowVersions(workflow.id)); } catch (requestError) { toast.error(requestError instanceof Error ? requestError.message : "Version history could not be loaded."); } finally { setVersionsLoading(false); }
  };

  const restoreVersion = async (version: number) => {
    if (!workflow) return;
    setVersionWorking(version);
    try {
      const saved = mapWorkflowRecord(await restoreWorkflowVersion(workflow.id, version));
      if (!saved) throw new Error("Workflow could not be reloaded.");
      setRecords((current) => updateRecord(current, saved));
      setDirty(false);
      toast.success(`Version ${version} restored as a draft.`);
      setVersionsOpen(false);
    } catch (requestError) { toast.error(requestError instanceof Error ? requestError.message : "That version could not be restored."); } finally { setVersionWorking(null); }
  };

  const run = async () => {
    if (!workflow) return;
    setBusy(true);
    try {
      const result = await executeWorkflow(workflow.id, { payload: { source: "editor", requestedAt: new Date().toISOString() } });
      const detail = await getWorkflowExecution(result.id).catch(() => null);
      const visible = detail || result;
      setSelectedExecution(visible);
      setExecutions((current) => [visible, ...current.filter((item) => item.id !== visible.id)]);
      toast.success(result.status === "success" ? "Workflow completed." : "Workflow finished with an error.");
    } catch (requestError) { toast.error(requestError instanceof Error ? requestError.message : "Workflow could not be executed."); } finally { setBusy(false); }
  };

  const test = async () => {
    if (!workflow) return;
    setBusy(true);
    try {
      const result = await executeWorkflow(workflow.id, { payload: { source: "safe-test", requestedAt: new Date().toISOString() }, dryRun: true });
      setSelectedExecution(result);
      toast.success("Safe workflow test completed. No workspace data was changed.");
    } catch (requestError) { toast.error(requestError instanceof Error ? requestError.message : "Workflow test could not be completed."); } finally { setBusy(false); }
  };

  const selectExecution = async (execution: WorkflowExecution) => {
    setSelectedExecution(execution);
    try { const detail = await getWorkflowExecution(execution.id); if (detail) setSelectedExecution(detail); } catch { /* The list row remains useful if the detail request is unavailable. */ }
  };

  const retry = async (execution: WorkflowExecution) => {
    setBusy(true);
    try { const result = await retryWorkflowExecution(execution.id); setSelectedExecution(result); setExecutions((current) => [result, ...current]); toast.success("Workflow retry completed."); } catch (requestError) { toast.error(requestError instanceof Error ? requestError.message : "Workflow could not be retried."); } finally { setBusy(false); }
  };

  const exportWorkflow = () => {
    if (!workflow) return;
    const blob = new Blob([JSON.stringify({
      name: workflow.name,
      description: workflow.description,
      triggerType: workflow.triggerType,
      definition: workflow.definition,
    }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${workflow.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "workflow"}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success("Workflow definition exported.");
  };

  const copyWebhook = async () => {
    if (!workflow || !workflow.webhookKey) return;
    const endpoint = `${window.location.origin}/api/workflows/webhook?key=${workflow.webhookKey}`;
    try {
      await navigator.clipboard.writeText(endpoint);
      toast.success("Webhook URL copied.");
    } catch {
      toast.error("The webhook URL could not be copied.");
    }
  };

  if (loading) return <section aria-label="Workflows" className="space-y-6"><div className="h-10 w-64 animate-pulse rounded-lg bg-muted" /><div className="h-5 w-96 max-w-full animate-pulse rounded bg-muted/70" /><div className="h-[520px] animate-pulse rounded-2xl border border-border bg-card" /></section>;
  if (!workflow) {
    return (
      <section aria-label="Workflows" className="space-y-6 pb-5">
      {!editorFocused && <header className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-primary">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10">
                <WorkflowIcon className="h-3.5 w-3.5" />
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-[0.12em]">Workspace automation</span>
            </div>
            <h1 className="mt-3 text-[30px] font-semibold tracking-tight sm:text-[34px]">Workflows</h1>
            <p className="mt-1.5 text-[13px] text-muted-foreground">Build and monitor automations that connect every module in your workspace. Form automations remain safely inside Forms.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void refreshWorkflows()}>
              <RotateCcw className="mr-2 h-3.5 w-3.5" /> Refresh
            </Button>
            <Button type="button" size="sm" onClick={() => void createNew()} disabled={busy}>
              <Plus className="mr-2 h-3.5 w-3.5" /> New workflow
            </Button>
          </div>
      </header>}

        <WorkflowTabs activeTab={tab} executionCount={0} onChange={setTab} />

        {tab === "overview" && <div id="workflow-panel-overview" role="tabpanel" aria-labelledby="workflow-tab-overview"><WorkflowOverview records={records} error={error} busy={busy} templates={templates} templatesLoading={templatesLoading} onCreate={() => void createNew()} onTemplate={(templateId) => void createFromTemplate(templateId)} onOpen={(workflowId) => void openWorkflow(workflowId)} onRefresh={() => void refreshWorkflows()} /></div>}
        {tab === "workflows" && <div id="workflow-panel-workflows" role="tabpanel" aria-labelledby="workflow-tab-workflows"><WorkflowsListing creating={busy} onCreate={() => void createNew()} onOpen={(workflowId) => void openWorkflow(workflowId)} /></div>}
        {tab === "editor" && <div id="workflow-panel-editor" role="tabpanel" aria-labelledby="workflow-tab-editor"><EmptyWorkflows onCreate={() => void createNew()} busy={busy} /></div>}
        {tab === "executions" && <div id="workflow-panel-executions" role="tabpanel" aria-labelledby="workflow-tab-executions"><WorkflowEmptyTab icon={History} title="No execution history yet" description="Create a workflow and run it to see every step, output, and error here." onCreate={() => void createNew()} busy={busy} /></div>}
        {tab === "evaluations" && <div id="workflow-panel-evaluations" role="tabpanel" aria-labelledby="workflow-tab-evaluations"><WorkflowEmptyTab icon={ClipboardCheck} title="No evaluations yet" description="Create a workflow first, then add safe regression datasets before publishing changes." onCreate={() => void createNew()} busy={busy} /></div>}
      </section>
    );
  }

  return (
    <section aria-label="Workflows" className="space-y-5">
      <header className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-primary">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10">
              <WorkflowIcon className="h-3.5 w-3.5" />
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em]">Workspace automation</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <h1 className="text-[30px] font-semibold tracking-tight sm:text-[34px]">Workflows</h1>
            {/* One workflow's status, so it belongs to the editor. On a list
                it labelled the page with whichever workflow was last active. */}
            {tab === "editor" && <Badge variant="outline" className={cn("rounded-full text-[10px]", statusClass(workflow.status))}>{statusLabel(workflow.status)}</Badge>}
          </div>
          <p className="mt-1.5 max-w-[680px] text-[13px] text-muted-foreground">Connect triggers, logic, and actions across your workspace. Form automations remain safely owned by Forms.</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Everything that acts on one workflow — pause, validate, run —
              belongs to the editor toolbar, not to the module. Up here they
              applied to whichever workflow happened to be active, which is not
              something the page makes visible while you are on a list. */}
          <Button type="button" variant="outline" size="sm" onClick={() => void createNew()} disabled={busy}>
            <Plus className="mr-2 h-3.5 w-3.5" /> New workflow
          </Button>
        </div>
      </header>


      {!editorFocused && <div className="flex flex-wrap items-end justify-between gap-3">
        <WorkflowTabs activeTab={tab} executionCount={executions.length} onChange={setTab} />
        <div className="pb-2 text-[10px] text-muted-foreground">{saving ? "Saving changes…" : dirty ? "Unsaved changes — saving automatically" : `Updated ${formatDate(workflow.updatedAt)}`}</div>
      </div>}

      {validation && <section aria-label="Workflow validation" className={cn("rounded-xl border p-4", validation.valid ? "border-emerald-500/25 bg-emerald-500/6" : "border-destructive/25 bg-destructive/5")}>
        <div className="flex flex-wrap items-start gap-3"><span className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", validation.valid ? "bg-emerald-500/10 text-emerald-600" : "bg-destructive/10 text-destructive")}>{validation.valid ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}</span><div className="min-w-0 flex-1"><p className="text-[12px] font-semibold">{validation.valid ? "Workflow is ready to publish" : "Workflow needs attention"}</p>{validation.issues.length > 0 && <ul className="mt-2 space-y-1 text-[11px] text-muted-foreground">{validation.issues.slice(0, 6).map((issue) => <li key={`${issue.code}-${issue.nodeId || "workflow"}`} className="flex gap-2"><span aria-hidden="true">•</span><span>{issue.message}</span></li>)}</ul>}</div><button type="button" className="rounded-md p-1 text-muted-foreground hover:bg-background" onClick={() => setValidation(null)} aria-label="Dismiss workflow validation"><X className="h-3.5 w-3.5" /></button></div>
      </section>}

      {/* Overview is the workspace's automation analytics. The card list that
          used to live here restated the Workflows table less densely, so the
          table owns that job and this answers "how is automation doing". */}
      {tab === "overview" && <div id="workflow-panel-overview" role="tabpanel" aria-labelledby="workflow-tab-overview"><WorkflowsAnalytics onOpen={(workflowId) => void openWorkflow(workflowId)} /></div>}
      {tab === "workflows" && <div id="workflow-panel-workflows" role="tabpanel" aria-labelledby="workflow-tab-workflows"><WorkflowsListing creating={busy} onCreate={() => void createNew()} onOpen={(workflowId) => void openWorkflow(workflowId)} /></div>}
      {/* Toolbar and canvas live inside one shell so switching between focus
          and restored is a class change on the container, not a remount that
          would throw away the canvas, the selection and any pending edit. */}
      {tab === "editor" && (
        <WorkflowEditorShell focused={focusMode} onRequestExit={requestExit}>
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={requestExit}
              aria-label="Back to workflows"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>

            <div className="min-w-0 flex-1">
              <label className="sr-only" htmlFor="workflow-editor-name">
                Workflow name
              </label>
              <input
                id="workflow-editor-name"
                key={workflow.id}
                value={nameDraft ?? workflow.name}
                placeholder="Untitled workflow"
                onChange={(event) => {
                  setNameDraft(event.target.value);
                  // Marked unsaved from the first keystroke, so leaving mid-rename
                  // is caught by the same guard as an unsaved graph change.
                  if (event.target.value.trim() !== workflow.name) setDirty(true);
                }}
                onBlur={() => { void commitName(); }}
                className="w-full max-w-[360px] rounded-md border border-transparent bg-transparent px-2 py-1 text-[14px] font-semibold outline-hidden transition-colors hover:border-border focus:border-primary focus:bg-background"
              />
              <div className="flex flex-wrap items-center gap-2 px-2">
                <WorkflowSaveState
                  state={saveError ? "error" : saving ? "saving" : dirty ? "unsaved" : "saved"}
                  updatedAt={formatDate(workflow.updatedAt)}
                  error={saveError}
                  onRetry={() => void saveNow()}
                />
                <span className="text-[10px] text-muted-foreground">
                  v{workflow.currentVersion} · {workflow.stats.executions} run
                  {workflow.stats.executions === 1 ? "" : "s"}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1">
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={undo} disabled={undoStack.length === 0} aria-label="Undo change">
                <Undo2 className="h-3.5 w-3.5" />
              </Button>
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={redo} disabled={redoStack.length === 0} aria-label="Redo change">
                <Redo2 className="h-3.5 w-3.5" />
              </Button>
              <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
              {workflow.triggerType.includes("webhook") && (
                <Button type="button" variant="ghost" size="sm" className="h-8" onClick={() => void copyWebhook()}>
                  <Link2 className="h-3.5 w-3.5" /> Webhook
                </Button>
              )}
              {(workflow.status === "published" || workflow.status === "paused") && (
                <Button type="button" variant="ghost" size="sm" className="h-8" onClick={() => void toggleEnabled()} disabled={busy || saving}>
                  <CircleDashed className="h-3.5 w-3.5" />
                  {workflow.status === "paused" ? "Resume" : "Pause"}
                </Button>
              )}
              <Button type="button" variant="ghost" size="sm" className="h-8" onClick={() => void validateCurrent()} disabled={busy || saving}>
                <Check className="h-3.5 w-3.5" /> Validate
              </Button>
              <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => void run()} disabled={busy || saving}>
                <Play className="h-3.5 w-3.5" /> Run
              </Button>
              <Button type="button" size="sm" className="h-8" onClick={() => void togglePublish()} disabled={busy || saving || workflow.status === "archived"}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                {workflow.status === "published" ? "Unpublish" : "Publish"}
              </Button>
              <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
              <WorkflowFocusToggle
                focused={focusMode}
                onToggle={() => setFocusMode((current) => !current)}
              />
              <div className="relative">
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => setMoreOpen((current) => !current)} aria-label="More workflow actions" aria-expanded={moreOpen}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
                {moreOpen && (
                  <div className="absolute right-0 top-9 z-30 min-w-[190px] rounded-lg border border-border bg-popover p-1 shadow-lg">
                    <button type="button" onClick={() => void openVersions()} className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] hover:bg-muted">
                      <History className="h-3.5 w-3.5" strokeWidth={1.75} /> Version history
                    </button>
                    <button type="button" onClick={() => void duplicateCurrent()} className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] hover:bg-muted">
                      <Copy className="h-3.5 w-3.5" strokeWidth={1.75} /> Duplicate draft
                    </button>
                    <button type="button" onClick={exportWorkflow} className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] hover:bg-muted">
                      <Download className="h-3.5 w-3.5" strokeWidth={1.75} /> Export
                    </button>
                    <button type="button" onClick={() => void archiveCurrent()} className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] hover:bg-muted">
                      <ArchiveIcon /> {workflow.status === "archived" ? "Restore draft" : "Archive"}
                    </button>
                    <button type="button" onClick={() => void removeCurrent()} className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] text-destructive hover:bg-destructive/10">
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} /> Delete workflow
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div
            id="workflow-panel-editor"
            role="tabpanel"
            aria-labelledby="workflow-tab-editor"
            className="flex min-h-0 flex-1 flex-col"
          >
            {opening || openError ? (
              <WorkflowOpeningState
                name={opening?.name}
                error={openError}
                onRetry={() => opening && void openWorkflow(opening.id)}
                onCancel={leaveEditor}
              />
            ) : (
              <EditorView workflow={workflow} connections={connections} connectionsLoading={connectionsLoading} connectionsError={connectionsError} onWorkflowChange={changeDefinition} onRun={() => void run()} onTest={() => void test()} onUndo={undo} onRedo={redo} saving={saving || busy} lastExecution={selectedExecution} validation={validation} />
            )}
          </div>
        </WorkflowEditorShell>
      )}

      <WorkflowExitDialog
        open={exitPrompt}
        saving={exitSaving}
        error={saveError}
        onContinue={() => setExitPrompt(false)}
        onDiscard={leaveEditor}
        onSaveAndExit={() => {
          void (async () => {
            setExitSaving(true);
            const ok = await saveNow();
            setExitSaving(false);
            // A failed save keeps the editor open with the reason on screen,
            // rather than closing and losing the work it claimed to save.
            if (ok) leaveEditor();
          })();
        }}
      />
      {tab === "executions" && <div id="workflow-panel-executions" role="tabpanel" aria-labelledby="workflow-tab-executions"><WorkflowRunsView executions={executions} loading={executionsLoading} error={executionsError} selected={selectedExecution} onSelect={(execution) => void selectExecution(execution)} onRetry={(execution) => void retry(execution)} onRefresh={() => void refreshExecutions()} /></div>}
      {tab === "evaluations" && <div id="workflow-panel-evaluations" role="tabpanel" aria-labelledby="workflow-tab-evaluations"><WorkflowChecksView workflowName={workflow.name} datasets={datasets} loading={datasetsLoading} error={datasetsError} onRefresh={() => void refreshDatasets()} onSave={async (input) => { const saved = await saveWorkflowEvaluation(workflow.id, input); setDatasets((current) => [saved, ...current.filter((dataset) => dataset.id !== saved.id)]); }} onRun={async (datasetId) => { const result = await runWorkflowEvaluation(datasetId); setDatasets((current) => current.map((dataset) => dataset.id === datasetId ? { ...dataset, lastRun: { score: result.score } } : dataset)); toast.success(`Check scored ${result.score}%.`); }} /></div>}
      {versionsOpen && <VersionHistoryPanel versions={versions} loading={versionsLoading} working={versionWorking} onClose={() => setVersionsOpen(false)} onRestore={(version) => void restoreVersion(version)} />}
    </section>
  );
}

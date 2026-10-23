export type WorkflowStatus = "draft" | "published" | "paused" | "archived";

export type WorkflowExecutionStatus =
  | "queued"
  | "running"
  | "waiting"
  | "success"
  | "error"
  | "canceled";

export type WorkflowNodeRunStatus =
  | "queued"
  | "running"
  | "waiting"
  | "success"
  | "error"
  | "skipped";

export type WorkflowNodePosition = { x: number; y: number };

export type WorkflowNode = {
  id: string;
  type: string;
  name: string;
  position: WorkflowNodePosition;
  parameters: Record<string, unknown>;
  credentialId?: string | null;
  onError: "stop" | "continue" | "retry";
};

export type WorkflowEdge = {
  id: string;
  source: string;
  sourceOutput?: string;
  target: string;
  targetInput?: string;
};

export type WorkflowViewport = { x: number; y: number; zoom: number };

export type WorkflowDefinition = {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  viewport: WorkflowViewport;
};

export type WorkflowRecord = {
  id: string;
  name: string;
  description: string;
  status: WorkflowStatus;
  enabled: boolean;
  triggerType: string;
  currentVersion: number;
  publishedVersion: number | null;
  revision: number;
  definition: WorkflowDefinition;
  webhookKey: string;
  createdAt: string;
  updatedAt: string;
  stats: {
    executions: number;
    successes: number;
    failures: number;
    lastRunAt: string | null;
    lastRunStatus: WorkflowExecutionStatus | null;
  };
};

export type WorkflowExecution = {
  id: string;
  workflowId: string;
  workflowVersionId: string | null;
  workflowName?: string;
  triggerType: string;
  status: WorkflowExecutionStatus;
  triggerPayload: Record<string, unknown>;
  outputPayload: Record<string, unknown>;
  error: Record<string, unknown>;
  idempotencyKey: string;
  requestedBy: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  durationMs: number | null;
  resumeAt?: string | null;
  nodeRuns?: WorkflowNodeRun[];
};

export type WorkflowNodeRun = {
  id: string;
  executionId: string;
  nodeId: string;
  nodeType: string;
  status: WorkflowNodeRunStatus;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error: Record<string, unknown>;
  attempt: number;
  startedAt: string | null;
  finishedAt: string | null;
};

export type WorkflowEvaluationDataset = {
  id: string;
  workflowId: string;
  name: string;
  cases: WorkflowEvaluationCase[];
  createdAt: string;
  updatedAt: string;
  lastRun?: WorkflowEvaluationRun | null;
};

export type WorkflowEvaluationCase = {
  id: string;
  name: string;
  input: Record<string, unknown>;
  assertions: WorkflowAssertion[];
};

export type WorkflowAssertion = {
  path: string;
  operator: "equals" | "contains" | "exists";
  value?: unknown;
};

export type WorkflowEvaluationRun = {
  id: string;
  datasetId: string;
  workflowVersionId: string | null;
  results: Array<{
    caseId: string;
    passed: boolean;
    output: Record<string, unknown>;
    failures: string[];
    durationMs: number;
  }>;
  score: number;
  createdAt: string;
};

export type WorkflowNodeCatalogEntry = {
  type: string;
  label: string;
  description: string;
  category: "triggers" | "actions" | "logic";
  module: string;
  color: string;
  outputs?: string[];
};

export type WorkflowValidationIssue = {
  code: string;
  message: string;
  nodeId?: string;
  path?: string;
  severity: "error" | "warning";
};

export type WorkflowValidationResult = {
  valid: boolean;
  issues: WorkflowValidationIssue[];
};

export type WorkflowVersion = {
  id: string;
  workflowId: string;
  version: number;
  definition: WorkflowDefinition;
  isPublished: boolean;
  publishedAt: string | null;
  publishedBy: string | null;
  changeSummary: string;
  createdAt: string;
};

export type WorkflowConnection = {
  id: string;
  provider: string;
  providerName: string;
  label: string;
  status: string;
  capabilities: string[];
  grantedScopes: string[];
};

export type WorkflowTemplate = {
  id: string;
  name: string;
  description: string;
  category: string;
  definition: WorkflowDefinition;
  workspaceId?: string | null;
};

export const WORKFLOW_TRIGGER_TYPES = [
  "trigger.manual",
  "trigger.webhook",
  "trigger.schedule",
  "trigger.form_submission",
  "trigger.event_created",
  "trigger.event_published",
  "trigger.event_updated",
  "trigger.appointment_created",
  "trigger.contact_created",
  "trigger.contact_updated",
  "trigger.order_paid",
  "trigger.payment_completed",
  "trigger.campaign_sent",
  "trigger.document_signed",
  "trigger.file_created",
  "trigger.appointment_rescheduled",
  "trigger.appointment_cancelled",
  "trigger.event_registration",
  "trigger.event_registration_cancelled",
  "trigger.attendee_checked_in",
  "trigger.payment_failed",
  "trigger.refund_issued",
  "trigger.order_refunded",
  "trigger.product_purchased",
  "trigger.product_stock_low",
  "trigger.store_product_created",
  "trigger.store_product_updated",
  "trigger.store_product_deleted",
  "trigger.store_order_created",
  "trigger.store_order_updated",
  "trigger.store_order_refunded",
  "trigger.store_webhook_received",
  "trigger.store_sync_completed",
  "trigger.store_sync_failed",
  "trigger.email_sent",
  "trigger.email_delivered",
  "trigger.email_opened",
  "trigger.email_clicked",
  "trigger.email_bounced",
  "trigger.subscriber_joined",
  "trigger.subscriber_unsubscribed",
  "trigger.document_created",
] as const;

export const WORKFLOW_NODE_CATALOG: WorkflowNodeCatalogEntry[] = [
  {
    type: "trigger.manual",
    label: "Manual trigger",
    description: "Run this workflow from the editor or MaxAI.",
    category: "triggers",
    module: "Workspace",
    color: "#6366f1",
  },
  {
    type: "trigger.webhook",
    label: "Webhook received",
    description: "Start when an HTTPS request reaches this workflow.",
    category: "triggers",
    module: "Workspace",
    color: "#6366f1",
  },
  {
    type: "trigger.schedule",
    label: "Schedule",
    description: "Start on a recurring interval using the workspace scheduler.",
    category: "triggers",
    module: "Workspace",
    color: "#6366f1",
  },
  {
    type: "trigger.form_submission",
    label: "Form submission",
    description: "Start when a response is submitted in Forms.",
    category: "triggers",
    module: "Forms",
    color: "#10b981",
  },
  {
    type: "trigger.event_created",
    label: "Event created",
    description: "Start when a new event is created in Events.",
    category: "triggers",
    module: "Events",
    color: "#10b981",
  },
  {
    type: "trigger.event_published",
    label: "Event published",
    description: "Start when an event goes live.",
    category: "triggers",
    module: "Events",
    color: "#10b981",
  },
  {
    type: "trigger.event_updated",
    label: "Event updated",
    description: "Start when a draft or unpublished event is saved with changes.",
    category: "triggers",
    module: "Events",
    color: "#10b981",
  },
  {
    type: "trigger.appointment_created",
    label: "Appointment booked",
    description: "Start when an appointment is saved.",
    category: "triggers",
    module: "Appointments",
    color: "#10b981",
  },
  {
    type: "trigger.appointment_rescheduled",
    label: "Appointment rescheduled",
    description: "Start when a booking is moved to a new time.",
    category: "triggers",
    module: "Appointments",
    color: "#10b981",
  },
  {
    type: "trigger.appointment_cancelled",
    label: "Appointment cancelled",
    description: "Start when a booking is cancelled.",
    category: "triggers",
    module: "Appointments",
    color: "#10b981",
  },
  {
    type: "trigger.event_registration",
    label: "Event registration",
    description: "Start when someone registers for an event.",
    category: "triggers",
    module: "Events",
    color: "#10b981",
  },
  {
    type: "trigger.event_registration_cancelled",
    label: "Registration cancelled",
    description: "Start when an event registration is cancelled.",
    category: "triggers",
    module: "Events",
    color: "#10b981",
  },
  {
    type: "trigger.attendee_checked_in",
    label: "Attendee checked in",
    description: "Start when an attendee is checked in.",
    category: "triggers",
    module: "Events",
    color: "#10b981",
  },
  {
    type: "trigger.contact_created",
    label: "Contact created",
    description: "Start when CRM receives a new contact.",
    category: "triggers",
    module: "CRM",
    color: "#10b981",
  },
  {
    type: "trigger.contact_updated",
    label: "Contact updated",
    description: "Start when a CRM contact changes.",
    category: "triggers",
    module: "CRM",
    color: "#10b981",
  },
  {
    type: "trigger.order_paid",
    label: "Order paid",
    description: "Start when a workspace order is paid.",
    category: "triggers",
    module: "Orders",
    color: "#10b981",
  },
  {
    type: "trigger.payment_completed",
    label: "Payment completed",
    description: "Start after a payment is confirmed.",
    category: "triggers",
    module: "Payments",
    color: "#10b981",
  },
  {
    type: "trigger.payment_failed",
    label: "Payment failed",
    description: "Start when a payment attempt fails.",
    category: "triggers",
    module: "Payments",
    color: "#10b981",
  },
  {
    type: "trigger.refund_issued",
    label: "Refund issued",
    description: "Start when a payment is refunded.",
    category: "triggers",
    module: "Payments",
    color: "#10b981",
  },
  {
    type: "trigger.order_refunded",
    label: "Order refunded",
    description: "Start when an order is refunded in full or in part.",
    category: "triggers",
    module: "Orders",
    color: "#10b981",
  },
  {
    type: "trigger.product_purchased",
    label: "Product purchased",
    description: "Start when a workspace product is purchased.",
    category: "triggers",
    module: "Products",
    color: "#10b981",
  },
  {
    type: "trigger.product_stock_low",
    label: "Stock below threshold",
    description: "Start when product stock drops below a threshold.",
    category: "triggers",
    module: "Products",
    color: "#10b981",
  },
  {
    type: "trigger.store_product_created",
    label: "Store product created",
    description: "Start when a product is created on a connected Shopify or WooCommerce site.",
    category: "triggers",
    module: "Connected stores",
    color: "#10b981",
  },
  {
    type: "trigger.store_product_updated",
    label: "Store product updated",
    description: "Start when a connected store product changes.",
    category: "triggers",
    module: "Connected stores",
    color: "#10b981",
  },
  {
    type: "trigger.store_product_deleted",
    label: "Store product deleted",
    description: "Start when a product is deleted from a connected store.",
    category: "triggers",
    module: "Connected stores",
    color: "#10b981",
  },
  {
    type: "trigger.store_order_created",
    label: "Store order created",
    description: "Start when a new order arrives from a connected store.",
    category: "triggers",
    module: "Connected stores",
    color: "#10b981",
  },
  {
    type: "trigger.store_order_updated",
    label: "Store order updated",
    description: "Start when a connected store order changes.",
    category: "triggers",
    module: "Connected stores",
    color: "#10b981",
  },
  {
    type: "trigger.store_order_refunded",
    label: "Store order refunded",
    description: "Start when a connected store order is refunded.",
    category: "triggers",
    module: "Connected stores",
    color: "#10b981",
  },
  {
    type: "trigger.store_webhook_received",
    label: "Store webhook received",
    description: "Start when Shopify or WooCommerce sends a connected-store webhook.",
    category: "triggers",
    module: "Connected stores",
    color: "#10b981",
  },
  {
    type: "trigger.store_sync_completed",
    label: "Store sync completed",
    description: "Start after a connected store has been reconciled successfully.",
    category: "triggers",
    module: "Connected stores",
    color: "#10b981",
  },
  {
    type: "trigger.store_sync_failed",
    label: "Store sync failed",
    description: "Start when a connected store needs attention after a sync failure.",
    category: "triggers",
    module: "Connected stores",
    color: "#10b981",
  },
  {
    type: "trigger.email_sent",
    label: "Email sent",
    description: "Start when a workspace email is accepted for delivery.",
    category: "triggers",
    module: "Email",
    color: "#10b981",
  },
  {
    type: "trigger.email_delivered",
    label: "Email delivered",
    description: "Start from a confirmed provider delivery event.",
    category: "triggers",
    module: "Email",
    color: "#10b981",
  },
  {
    type: "trigger.email_opened",
    label: "Email opened",
    description: "Start when a tracked email is opened.",
    category: "triggers",
    module: "Email",
    color: "#10b981",
  },
  {
    type: "trigger.email_clicked",
    label: "Email link clicked",
    description: "Start when a tracked email link is clicked.",
    category: "triggers",
    module: "Email",
    color: "#10b981",
  },
  {
    type: "trigger.email_bounced",
    label: "Email bounced",
    description: "Start when an email cannot be delivered.",
    category: "triggers",
    module: "Email",
    color: "#10b981",
  },
  {
    type: "trigger.subscriber_joined",
    label: "Subscriber joined audience",
    description: "Start when a subscriber joins a campaign audience.",
    category: "triggers",
    module: "Campaigns",
    color: "#10b981",
  },
  {
    type: "trigger.subscriber_unsubscribed",
    label: "Subscriber unsubscribed",
    description: "Start when a subscriber leaves an audience.",
    category: "triggers",
    module: "Campaigns",
    color: "#10b981",
  },
  {
    type: "trigger.campaign_sent",
    label: "Campaign sent",
    description: "Start when a campaign send completes.",
    category: "triggers",
    module: "Campaigns",
    color: "#10b981",
  },
  {
    type: "trigger.document_signed",
    label: "Document signed",
    description: "Start when a document is fully signed.",
    category: "triggers",
    module: "Documents",
    color: "#10b981",
  },
  {
    type: "trigger.file_created",
    label: "File created",
    description: "Start when a file is added to the workspace.",
    category: "triggers",
    module: "Files",
    color: "#10b981",
  },
  {
    type: "trigger.document_created",
    label: "Document created",
    description: "Start when a document is generated in the workspace.",
    category: "triggers",
    module: "Documents",
    color: "#10b981",
  },
  {
    type: "action.http_request",
    label: "HTTP request",
    description: "Call an HTTPS endpoint with mapped workspace data.",
    category: "actions",
    module: "HTTP",
    color: "#f59e0b",
  },
  {
    type: "action.create_contact",
    label: "Create contact",
    description: "Create a CRM contact from the current payload.",
    category: "actions",
    module: "CRM",
    color: "#f59e0b",
  },
  {
    type: "action.update_contact",
    label: "Update contact",
    description: "Update a CRM contact using a mapped contact id.",
    category: "actions",
    module: "CRM",
    color: "#f59e0b",
  },
  {
    type: "action.create_form",
    label: "Create form",
    description: "Create a draft form in this workspace.",
    category: "actions",
    module: "Forms",
    color: "#f59e0b",
  },
  {
    type: "action.create_event",
    label: "Create event",
    description: "Create a draft event in this workspace.",
    category: "actions",
    module: "Events",
    color: "#f59e0b",
  },
  {
    type: "action.create_document",
    label: "Create document",
    description: "Create a document from a workspace template and mapped signers.",
    category: "actions",
    module: "Documents",
    color: "#f59e0b",
  },
  {
    type: "action.create_folder",
    label: "Create folder",
    description: "Create a workspace file folder for the current process.",
    category: "actions",
    module: "Files",
    color: "#f59e0b",
  },
  {
    type: "action.create_appointment",
    label: "Create appointment",
    description: "Create an appointment in this workspace.",
    category: "actions",
    module: "Appointments",
    color: "#f59e0b",
  },
  {
    type: "action.send_workspace_email",
    label: "Send workspace email",
    description: "Send through the workspace email provider.",
    category: "actions",
    module: "Email",
    color: "#f59e0b",
  },
  {
    type: "action.connected_app",
    label: "Connected app action",
    description: "Run a supported action through an existing workspace connection.",
    category: "actions",
    module: "Integrations",
    color: "#f59e0b",
  },
  {
    type: "action.log",
    label: "Write to run log",
    description: "Record a readable message in the execution output.",
    category: "actions",
    module: "Workspace",
    color: "#f59e0b",
  },
  {
    type: "logic.if",
    label: "If / else",
    description: "Route the payload through true and false branches.",
    category: "logic",
    module: "Logic",
    color: "#8b5cf6",
    outputs: ["true", "false"],
  },
  {
    type: "logic.noop",
    label: "No operation",
    description: "Keep a branch explicit without changing its payload.",
    category: "logic",
    module: "Logic",
    color: "#64748b",
  },
  {
    type: "logic.delay",
    label: "Delay",
    description: "Wait durably before continuing the workflow.",
    category: "logic",
    module: "Logic",
    color: "#8b5cf6",
  },
];

export const workflowNodeCatalogEntry = (type: string) =>
  WORKFLOW_NODE_CATALOG.find((entry) => entry.type === type);

export const defaultWorkflowDefinition = (): WorkflowDefinition => ({
  nodes: [
    {
      id: "trigger-1",
      type: "trigger.manual",
      name: "When you run this workflow",
      position: { x: 90, y: 150 },
      parameters: {},
      credentialId: null,
      onError: "stop",
    },
  ],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
});

const text = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : value == null ? fallback : String(value);

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const normalizeDefinition = (value: unknown): WorkflowDefinition => {
  const input = record(value);
  const nodes = Array.isArray(input.nodes)
    ? input.nodes.map((node, index) => {
        const item = record(node);
        const position = record(item.position);
        return {
          id: text(item.id, `node-${index + 1}`).slice(0, 80),
          type: text(item.type, "logic.noop").slice(0, 120),
          name: text(item.name, "Workflow step").slice(0, 160),
          position: {
            x: Number.isFinite(Number(position.x)) ? Number(position.x) : 90,
            y: Number.isFinite(Number(position.y)) ? Number(position.y) : 90,
          },
          parameters: record(item.parameters),
          credentialId: text(item.credentialId) || null,
          onError:
            item.onError === "continue" || item.onError === "retry"
              ? item.onError
              : "stop",
        } satisfies WorkflowNode;
      })
    : [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = Array.isArray(input.edges)
    ? input.edges
        .map((edge, index) => {
          const item = record(edge);
          return {
            id: text(item.id, `edge-${index + 1}`).slice(0, 100),
            source: text(item.source).slice(0, 80),
            sourceOutput: text(item.sourceOutput) || undefined,
            target: text(item.target).slice(0, 80),
            targetInput: text(item.targetInput) || undefined,
          } satisfies WorkflowEdge;
        })
        .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    : [];
  const viewport = record(input.viewport);
  return {
    nodes,
    edges,
    viewport: {
      x: Number.isFinite(Number(viewport.x)) ? Number(viewport.x) : 0,
      y: Number.isFinite(Number(viewport.y)) ? Number(viewport.y) : 0,
      zoom: Math.min(2, Math.max(0.5, Number(viewport.zoom) || 1)),
    },
  };
};

const asRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
};

const token = () =>
  typeof localStorage === "undefined"
    ? ""
    : localStorage.getItem("access_token") || "";

const workflowRequest = async <T>(
  operation: string,
  args: Record<string, unknown> = {},
): Promise<T> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch("/api/workflows/data", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token() ? { Authorization: `Bearer ${token()}` } : {}),
      },
      body: JSON.stringify({ operation, args }),
      signal: controller.signal,
    });
    const result = (await response.json().catch(() => ({}))) as {
      value?: T;
      error?: string;
      details?: unknown;
    };
    if (!response.ok) {
      const failure = new Error(result.error || "Workflows could not be loaded.") as Error & { details?: unknown };
      failure.details = result.details;
      throw failure;
    }
    return result.value as T;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("Workflows are taking longer than expected. Try again.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

export const listWorkflows = () => workflowRequest<WorkflowRecord[]>("listWorkflows");

export type WorkflowListFilters = {
  search?: string;
  status?: string;
  triggerType?: string;
  provider?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
};

export type WorkflowListPage = {
  workflows: WorkflowRecord[];
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
};

export type WorkflowBulkResult = {
  action: string;
  succeeded: number;
  failed: number;
  failures: Array<{ workflowId: string; name: string; error: string }>;
};

/**
 * The listing screen's query. Filtered and paged server-side so the table
 * never has to hold every workflow definition in the workspace in memory.
 */
export const listWorkflowsPage = (filters: WorkflowListFilters = {}) =>
  workflowRequest<{
    workflows: unknown[];
    page: number;
    pageSize: number;
    total: number;
    pageCount: number;
  }>("listWorkflowsPage", { filters }).then((result) => ({
    ...result,
    workflows: (result.workflows || [])
      .map(mapWorkflowRecord)
      .filter((workflow): workflow is WorkflowRecord => workflow !== null),
  }));

export type WorkflowAnalytics = {
  days: number;
  workflows: {
    total: number;
    active: number;
    draft: number;
    paused: number;
    archived: number;
  };
  runs: {
    total: number;
    success: number;
    failed: number;
    pending: number;
    canceled: number;
    successRate: number;
    failureRate: number;
    averageMs: number;
  };
  trend: Array<{ day: string; runs: number; success: number; error: number }>;
  mostActive: WorkflowLeaderboardRow[];
  highestFailureRate: WorkflowLeaderboardRow[];
  recentActivity: Array<{
    id: string;
    workflowId: string;
    workflowName: string;
    status: string;
    triggerType: string;
    createdAt: string;
    finishedAt: string;
  }>;
};

export type WorkflowLeaderboardRow = {
  id: string;
  name: string;
  status: string;
  runs: number;
  failures: number;
  failureRate: number;
};

const countOf = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const leaderboardRows = (value: unknown): WorkflowLeaderboardRow[] =>
  (Array.isArray(value) ? value : []).map((entry) => {
    const row = asRecord(entry);
    return {
      id: text(row.id),
      name: text(row.name, "Untitled workflow"),
      status: text(row.status, "draft"),
      runs: countOf(row.runs),
      failures: countOf(row.failures),
      failureRate: countOf(row.failureRate),
    };
  });

/**
 * Gives the view the shape it renders regardless of what came back.
 *
 * The analytics screen reads nested counts straight into the DOM, so a partial
 * or unexpected payload would otherwise take the whole module down with a
 * TypeError rather than showing an empty state.
 */
export const mapWorkflowAnalytics = (value: unknown): WorkflowAnalytics => {
  const source = asRecord(value);
  const workflows = asRecord(source.workflows);
  const runs = asRecord(source.runs);
  return {
    days: countOf(source.days) || 30,
    workflows: {
      total: countOf(workflows.total),
      active: countOf(workflows.active),
      draft: countOf(workflows.draft),
      paused: countOf(workflows.paused),
      archived: countOf(workflows.archived),
    },
    runs: {
      total: countOf(runs.total),
      success: countOf(runs.success),
      failed: countOf(runs.failed),
      pending: countOf(runs.pending),
      canceled: countOf(runs.canceled),
      successRate: countOf(runs.successRate),
      failureRate: countOf(runs.failureRate),
      averageMs: countOf(runs.averageMs),
    },
    trend: (Array.isArray(source.trend) ? source.trend : []).map((entry) => {
      const row = asRecord(entry);
      return {
        day: text(row.day),
        runs: countOf(row.runs),
        success: countOf(row.success),
        error: countOf(row.error),
      };
    }),
    mostActive: leaderboardRows(source.mostActive),
    highestFailureRate: leaderboardRows(source.highestFailureRate),
    recentActivity: (Array.isArray(source.recentActivity)
      ? source.recentActivity
      : []
    ).map((entry) => {
      const row = asRecord(entry);
      return {
        id: text(row.id),
        workflowId: text(row.workflowId),
        workflowName: text(row.workflowName, "Untitled workflow"),
        status: text(row.status, "queued"),
        triggerType: text(row.triggerType),
        createdAt: text(row.createdAt),
        finishedAt: text(row.finishedAt),
      };
    }),
  };
};

/** Workspace-wide automation metrics, counted from real execution rows. */
export const getWorkflowAnalytics = (days = 30) =>
  workflowRequest<unknown>("getWorkflowAnalytics", { days }).then(
    mapWorkflowAnalytics,
  );

/** The triggers this workspace actually uses, for the filter menu. */
export const listWorkflowTriggerFacets = () =>
  workflowRequest<Array<{ triggerType: string; workflows: number }>>(
    "listWorkflowTriggerFacets",
  );

export const bulkWorkflowAction = (
  workflowIds: string[],
  action: "activate" | "disable" | "duplicate" | "delete",
) =>
  workflowRequest<WorkflowBulkResult>("bulkWorkflowAction", {
    workflowIds,
    action,
  });

export const getWorkflow = (workflowId: string) =>
  workflowRequest<WorkflowRecord | null>("getWorkflow", { workflowId });

export const createWorkflow = (input: {
  name: string;
  description?: string;
  triggerType?: string;
  definition?: WorkflowDefinition;
}) =>
  workflowRequest<WorkflowRecord>("createWorkflow", {
    input: {
      ...input,
      definition: normalizeDefinition(input.definition || defaultWorkflowDefinition()),
    },
  });

export const updateWorkflow = (
  workflowId: string,
  input: {
    name?: string;
    description?: string;
    triggerType?: string;
    definition?: WorkflowDefinition;
    enabled?: boolean;
    revision?: number;
    changeSummary?: string;
  },
) =>
  workflowRequest<WorkflowRecord>("updateWorkflow", {
    workflowId,
    input: {
      ...input,
      ...(input.definition
        ? { definition: normalizeDefinition(input.definition) }
        : {}),
    },
  });

export const publishWorkflow = (workflowId: string, published = true) =>
  workflowRequest<WorkflowRecord>("publishWorkflow", { workflowId, published });

export const setWorkflowEnabled = (workflowId: string, enabled: boolean) =>
  workflowRequest<WorkflowRecord>("setWorkflowEnabled", { workflowId, enabled });

export const validateWorkflow = (workflowId: string) =>
  workflowRequest<WorkflowValidationResult>("validateWorkflow", { workflowId });

export const duplicateWorkflow = (workflowId: string) =>
  workflowRequest<WorkflowRecord>("duplicateWorkflow", { workflowId });

export const archiveWorkflow = (workflowId: string, archived = true) =>
  workflowRequest<WorkflowRecord>("archiveWorkflow", { workflowId, archived });

export const deleteWorkflow = (workflowId: string) =>
  workflowRequest<{ deleted: boolean }>("deleteWorkflow", { workflowId });

export const listWorkflowVersions = (workflowId: string) =>
  workflowRequest<WorkflowVersion[]>("listWorkflowVersions", { workflowId });

export const restoreWorkflowVersion = (workflowId: string, version: number) =>
  workflowRequest<WorkflowRecord>("restoreWorkflowVersion", { workflowId, version });

export const listWorkflowConnections = () =>
  workflowRequest<WorkflowConnection[]>("listWorkflowConnections");

export const listWorkflowTemplates = () =>
  workflowRequest<WorkflowTemplate[]>("listWorkflowTemplates");

export const createWorkflowFromTemplate = (templateId: string) =>
  workflowRequest<WorkflowRecord>("createWorkflowFromTemplate", { templateId });

export const executeWorkflow = (
  workflowId: string,
  input: { payload?: Record<string, unknown>; idempotencyKey?: string; dryRun?: boolean } = {},
) => workflowRequest<WorkflowExecution>("executeWorkflow", { workflowId, input });

export const listWorkflowExecutions = (workflowId: string) =>
  workflowRequest<WorkflowExecution[]>("listWorkflowExecutions", { workflowId });

export const getWorkflowExecution = (executionId: string) =>
  workflowRequest<WorkflowExecution | null>("getWorkflowExecution", {
    executionId,
  });

export const retryWorkflowExecution = (executionId: string) =>
  workflowRequest<WorkflowExecution>("retryWorkflowExecution", { executionId });

export const listWorkflowEvaluations = (workflowId: string) =>
  workflowRequest<WorkflowEvaluationDataset[]>("listWorkflowEvaluations", {
    workflowId,
  });

export const saveWorkflowEvaluation = (
  workflowId: string,
  input: { id?: string; name: string; cases: WorkflowEvaluationCase[] },
) => workflowRequest<WorkflowEvaluationDataset>("saveWorkflowEvaluation", {
  workflowId,
  input,
});

export const runWorkflowEvaluation = (datasetId: string) =>
  workflowRequest<WorkflowEvaluationRun>("runWorkflowEvaluation", { datasetId });

export const listWorkflowNodes = () =>
  workflowRequest<WorkflowNodeCatalogEntry[]>("listWorkflowNodes");

export const mapWorkflowRecord = (value: unknown): WorkflowRecord | null => {
  const item = asRecord(value);
  if (!text(item.id)) return null;
  return {
    id: text(item.id),
    name: text(item.name, "Untitled workflow"),
    description: text(item.description),
    status:
      item.status === "published" || item.status === "paused" || item.status === "archived"
        ? item.status
        : "draft",
    enabled: item.enabled === true,
    triggerType: text(item.triggerType, "manual"),
    currentVersion: Number(item.currentVersion) || 1,
    publishedVersion: Number(item.publishedVersion) || null,
    revision: Number(item.revision) || 1,
    definition: normalizeDefinition(item.definition),
    webhookKey: text(item.webhookKey),
    createdAt: text(item.createdAt),
    updatedAt: text(item.updatedAt),
    stats: {
      executions: Number(asRecord(item.stats).executions) || 0,
      successes: Number(asRecord(item.stats).successes) || 0,
      failures: Number(asRecord(item.stats).failures) || 0,
      lastRunAt: text(asRecord(item.stats).lastRunAt) || null,
      lastRunStatus: (text(asRecord(item.stats).lastRunStatus) || null) as
        | WorkflowExecutionStatus
        | null,
    },
  };
};

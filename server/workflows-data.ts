import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { IncomingMessage, ServerResponse } from "node:http";

import { neon } from "@neondatabase/serverless";
import { jwtVerify } from "jose";

import {
  WORKFLOW_NODE_CATALOG,
  type WorkflowDefinition,
  type WorkflowEdge,
  type WorkflowEvaluationCase,
  type WorkflowNode,
  type WorkflowNodeRunStatus,
} from "../src/lib/workflows";
import { createWorkspaceForm } from "../src/lib/forms";
import { createEvent } from "../src/lib/events";
import { saveAppointmentForAssistant } from "./appointments-data";
import { createContact, updateContact } from "./contacts-data";
import { sendEmailNow } from "./email-service";
import { consumeRateLimit } from "./rate-limit";
import { canOpenModule, workspaceScopeFor } from "./workspace-access";
import { executeAutomationProviderAction } from "./integration-oauth";
import { syncLegacyConnections } from "./integrations-data";
import { enqueueWorkflowEvent, enqueueWorkflowExecution, workflowQueueConfigured } from "./workflow-queue";

type RecordValue = Record<string, unknown>;

type WorkflowRow = RecordValue;
type NodeRunRow = RecordValue;

class WorkflowDataError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "workflows_error",
    readonly details: RecordValue = {},
  ) {
    super(message);
  }
}

const database = () => {
  const url = process.env.DATABASE_URL || "";
  if (!url) {
    throw new WorkflowDataError(
      "Workflows are temporarily unavailable. Please try again.",
      503,
      "workflows_unavailable",
    );
  }
  return neon(url);
};

const query = async <Row extends RecordValue = RecordValue>(
  text: string,
  params: unknown[] = [],
) => (await database().query(text, params)) as Row[];

const auditWorkflow = async (input: {
  workspaceId: string;
  eventType: string;
  workflowId?: string | null;
  executionId?: string | null;
  actorUserId?: string | null;
  details?: RecordValue;
}) => {
  try {
    await query(
      `INSERT INTO workspace_workflow_audit_events (
         workspace_id, workflow_id, execution_id, actor_user_id, event_type, details
       ) VALUES ($1, NULLIF($2, '')::uuid, NULLIF($3, '')::uuid, NULLIF($4, '')::uuid, $5, $6::jsonb)`,
      [
        input.workspaceId,
        input.workflowId || "",
        input.executionId || "",
        input.actorUserId || "",
        text(input.eventType, "workflow_event", 80),
        jsonText(input.details || {}, {}),
      ],
    );
  } catch (error) {
    // Audit persistence must never make a user-facing workflow operation fail.
    console.error("[workflow-audit] unable to persist event", {
      eventType: input.eventType,
      type: error instanceof Error ? error.name : typeof error,
    });
  }
};

const text = (value: unknown, fallback = "", maximum = 4000) =>
  String(value ?? fallback).trim().slice(0, maximum);

const number = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const boolean = (value: unknown, fallback = false) =>
  value === true || value === "true" || value === 1
    ? true
    : value === false || value === "false" || value === 0
      ? false
      : fallback;

const object = (value: unknown): RecordValue =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};

const array = <T = unknown>(value: unknown): T[] =>
  Array.isArray(value) ? (value as T[]) : [];

const jsonText = (value: unknown, fallback: unknown) => {
  try {
    return JSON.stringify(value ?? fallback);
  } catch {
    return JSON.stringify(fallback);
  }
};

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

/**
 * A date the database will accept, or no filter. An unparseable value would
 * raise on the ::timestamptz cast and turn a mistyped range into a 500.
 */
const timestamp = (value: unknown) => {
  const raw = text(value, "", 40);
  if (!raw) return "";
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
};

/** A search term as a LIKE pattern, with the wildcards taken literally. */
const likePattern = (value: string) =>
  `%${value.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;

/**
 * Turns a scheduler pass into a result rather than a rejection, so sibling
 * passes still run and the response says which one failed and why.
 */
const settled = async (pass: Promise<unknown>) => {
  try {
    return (await pass) as RecordValue;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "This pass failed.",
    } as RecordValue;
  }
};

const safeJson = <T>(value: unknown, fallback: T): T => {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
};

const safePayload = (value: unknown) => {
  const candidate = object(value);
  const serialized = jsonText(candidate, {});
  if (serialized.length <= 500_000) return candidate;
  return {
    _truncated: true,
    preview: serialized.slice(0, 498_000),
  };
};

const normalizeDefinition = (value: unknown): WorkflowDefinition => {
  const input = object(value);
  const nodes: WorkflowNode[] = array(input.nodes)
    .slice(0, 120)
    .map((entry, index) => {
      const item = object(entry);
      const position = object(item.position);
      const onError =
        item.onError === "continue" || item.onError === "retry"
          ? item.onError
          : "stop";
      return {
        id: text(item.id, `node-${index + 1}`, 80),
        type: text(item.type, "logic.noop", 120),
        name: text(item.name, "Workflow step", 160),
        position: {
          x: Math.max(-5_000, Math.min(5_000, number(position.x, 90))),
          y: Math.max(-5_000, Math.min(5_000, number(position.y, 90))),
        },
        parameters: object(item.parameters),
        credentialId: text(item.credentialId, "", 80) || null,
        onError,
      };
    });
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges: WorkflowEdge[] = array(input.edges)
    .slice(0, 250)
    .map((entry, index) => {
      const item = object(entry);
      return {
        id: text(item.id, `edge-${index + 1}`, 100),
        source: text(item.source, "", 80),
        sourceOutput: text(item.sourceOutput, "", 40) || undefined,
        target: text(item.target, "", 80),
        targetInput: text(item.targetInput, "", 40) || undefined,
      };
    })
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
  const viewport = object(input.viewport);
  return {
    nodes,
    edges,
    viewport: {
      x: number(viewport.x),
      y: number(viewport.y),
      zoom: Math.max(0.5, Math.min(2, number(viewport.zoom, 1))),
    },
  };
};

const triggerTypeFromDefinition = (definition: WorkflowDefinition) => {
  const trigger = definition.nodes.find((node) => node.type.startsWith("trigger."));
  return trigger?.type || "trigger.manual";
};

const moduleFromTrigger = (triggerType: string) => {
  const value = triggerType.replace(/^trigger\./, "");
  if (value.startsWith("form")) return "forms";
  if (value.startsWith("event")) return "events";
  if (value.startsWith("appointment")) return "appointments";
  if (value.startsWith("contact")) return "crm";
  if (value.startsWith("order")) return "orders";
  if (value.startsWith("payment")) return "payments";
  if (value.startsWith("product")) return "products";
  if (value.startsWith("store_") || value.startsWith("cms_")) return "stores";
  if (value.startsWith("email")) return "emails";
  if (value.startsWith("campaign")) return "campaigns";
  if (value.startsWith("document")) return "documents";
  if (value.startsWith("file")) return "files";
  return "workspace";
};

const mapExecution = (row: WorkflowRow) => {
  const started = row.started_at ? new Date(String(row.started_at)).getTime() : 0;
  const finished = row.finished_at ? new Date(String(row.finished_at)).getTime() : 0;
  return {
    id: text(row.id, "", 80),
    workflowId: text(row.workflow_id, "", 80),
    workflowVersionId: text(row.workflow_version_id, "", 80) || null,
    workflowName: text(row.workflow_name, "", 160) || undefined,
    triggerType: text(row.trigger_type, "trigger.manual", 120),
    status: text(row.status, "queued", 20),
    triggerPayload: safeJson<RecordValue>(row.trigger_payload, {}),
    outputPayload: safeJson<RecordValue>(row.output_payload, {}),
    error: safeJson<RecordValue>(row.error_json, {}),
    idempotencyKey: text(row.idempotency_key, "", 180),
    requestedBy: text(row.requested_by, "", 80) || null,
    startedAt: row.started_at ? String(row.started_at) : null,
    finishedAt: row.finished_at ? String(row.finished_at) : null,
    createdAt: row.created_at ? String(row.created_at) : new Date().toISOString(),
    durationMs: started && finished ? Math.max(0, finished - started) : null,
    resumeAt: row.resume_at ? String(row.resume_at) : null,
  };
};

const mapNodeRun = (row: NodeRunRow) => ({
  id: text(row.id, "", 80),
  executionId: text(row.execution_id, "", 80),
  nodeId: text(row.node_id, "", 80),
  nodeType: text(row.node_type, "logic.noop", 120),
  status: text(row.status, "queued", 20) as WorkflowNodeRunStatus,
  input: safeJson<RecordValue>(row.input_json, {}),
  output: safeJson<RecordValue>(row.output_json, {}),
  error: safeJson<RecordValue>(row.error_json, {}),
  attempt: Math.max(1, number(row.attempt, 1)),
  startedAt: row.started_at ? String(row.started_at) : null,
  finishedAt: row.finished_at ? String(row.finished_at) : null,
});

const mapWorkflow = (row: WorkflowRow) => {
  const definition = normalizeDefinition(row.definition_json);
  const lastStatus = text(row.last_run_status, "", 20);
  return {
    id: text(row.id, "", 80),
    name: text(row.name, "Untitled workflow", 160),
    description: text(row.description, "", 2_000),
    status: text(row.status, "draft", 20),
    enabled: boolean(row.enabled),
    triggerType: text(row.trigger_type, triggerTypeFromDefinition(definition), 120),
    currentVersion: Math.max(1, number(row.current_version, 1)),
    publishedVersion: number(row.published_version) || null,
    revision: Math.max(1, number(row.revision, 1)),
    definition,
    webhookKey: text(row.webhook_key, "", 120),
    createdAt: row.created_at ? String(row.created_at) : new Date().toISOString(),
    updatedAt: row.updated_at ? String(row.updated_at) : new Date().toISOString(),
    stats: {
      executions: number(row.execution_count),
      successes: number(row.success_count),
      failures: number(row.failure_count),
      lastRunAt: text(row.last_run_at, "", 80) || null,
      lastRunStatus: lastStatus || null,
    },
  };
};

const workflowSelect = `
  SELECT workflow.*,
    (SELECT COUNT(*)::int FROM workspace_workflow_executions execution
      WHERE execution.workflow_id = workflow.id) AS execution_count,
    (SELECT COUNT(*)::int FROM workspace_workflow_executions execution
      WHERE execution.workflow_id = workflow.id AND execution.status = 'success') AS success_count,
    (SELECT COUNT(*)::int FROM workspace_workflow_executions execution
      WHERE execution.workflow_id = workflow.id AND execution.status = 'error') AS failure_count,
    (SELECT execution.created_at FROM workspace_workflow_executions execution
      WHERE execution.workflow_id = workflow.id ORDER BY execution.created_at DESC LIMIT 1) AS last_run_at,
    (SELECT execution.status FROM workspace_workflow_executions execution
      WHERE execution.workflow_id = workflow.id ORDER BY execution.created_at DESC LIMIT 1) AS last_run_status
  FROM workspace_workflows workflow`;

const workflowForWorkspace = async (workspaceId: string, workflowId: string) => {
  if (!isUuid(workflowId)) return null;
  const rows = await query(
    `${workflowSelect}
     WHERE workflow.id = $1 AND workflow.workspace_id = $2
     LIMIT 1`,
    [workflowId, workspaceId],
  );
  return rows[0] ? mapWorkflow(rows[0]) : null;
};

const workflowRowForWorkspace = async (workspaceId: string, workflowId: string) => {
  if (!isUuid(workflowId)) return null;
  const rows = await query(
    `SELECT * FROM workspace_workflows WHERE id = $1 AND workspace_id = $2 LIMIT 1`,
    [workflowId, workspaceId],
  );
  return rows[0] || null;
};

const readPath = (value: unknown, path: string) => {
  const normalized = path
    .replace(/^\$json\.?/, "")
    .replace(/^\$payload\.?/, "")
    .replace(/^json\.?/, "")
    .replace(/^payload\.?/, "")
    .replace(/^\./, "");
  if (!normalized) return value;
  return normalized.split(/[.[\]]/).filter(Boolean).reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as RecordValue)[key];
  }, value);
};

const renderTemplate = (value: unknown, payload: RecordValue): unknown => {
  if (typeof value === "string") {
    const full = value.match(/^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/);
    if (full) return readPath(payload, full[1]);
    return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, path: string) => {
      const resolved = readPath(payload, path);
      if (resolved == null) return "";
      return typeof resolved === "object" ? JSON.stringify(resolved) : String(resolved);
    });
  }
  if (Array.isArray(value)) return value.map((entry) => renderTemplate(entry, payload));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, renderTemplate(entry, payload)]),
    );
  }
  return value;
};

const compare = (actual: unknown, operator: string, expected: unknown) => {
  const left = actual == null ? "" : Array.isArray(actual) ? actual.join(", ") : String(actual);
  const right = expected == null ? "" : String(expected);
  switch (operator) {
    case "exists":
      return actual !== undefined && actual !== null && left !== "";
    case "contains":
      return left.toLowerCase().includes(right.toLowerCase());
    case "not_equals":
      return left !== right;
    case "greater_than":
      return Number(left) > Number(right);
    case "less_than":
      return Number(left) < Number(right);
    case "equals":
    default:
      return left === right;
  }
};

const privateIpv4 = (value: string) => {
  const octets = value.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  const [first, second] = octets;
  return first === 10 || first === 127 || first === 0 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 198 && (second === 18 || second === 19));
};

const privateAddress = (value: string) => {
  const address = value.trim().toLowerCase().replace(/^::ffff:/, "");
  if (isIP(address) === 4) return privateIpv4(address);
  if (isIP(address) !== 6) return false;
  return address === "::1" || address === "::" || address.startsWith("fc") ||
    address.startsWith("fd") || address.startsWith("fe8") ||
    address.startsWith("fe9") || address.startsWith("fea") ||
    address.startsWith("feb") || address.startsWith("2001:db8");
};

const ensureHttps = async (value: string) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new WorkflowDataError("Enter a valid HTTPS endpoint.");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new WorkflowDataError("Workflow endpoints must use HTTPS.");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (["localhost", "metadata.google.internal", "169.254.169.254", "instance-data.ec2.internal"].includes(hostname)) {
    throw new WorkflowDataError("This endpoint points to a private service and cannot be used.");
  }
  if (isIP(hostname) !== 0 && privateAddress(hostname)) {
    throw new WorkflowDataError("Private and internal endpoints are not allowed.");
  }
  if (isIP(hostname) === 0) {
    let addresses: Array<{ address: string }>;
    try {
      addresses = await lookup(hostname, { all: true, verbatim: true });
    } catch {
      throw new WorkflowDataError("The workflow endpoint hostname could not be resolved.");
    }
    if (!addresses.length || addresses.some((entry) => privateAddress(entry.address))) {
      throw new WorkflowDataError("This endpoint resolves to a private or internal address.");
    }
  }
  return url.toString();
};

const emailFrom = (parameters: RecordValue, payload: RecordValue) =>
  text(
    renderTemplate(
      parameters.to || parameters.recipient || parameters.email || "{{$json.email}}",
      payload,
    ),
    "",
    320,
  ).toLowerCase();

const workspaceWorkflowEvent = async (
  workspaceId: string,
  eventType: string,
  payload: RecordValue,
  idempotencyKey = `${eventType}:${text(payload.id, randomUUID(), 120)}`,
) => {
  const normalizedEvent = text(eventType, "custom", 120).replace(/^trigger\./, "");
  const inserted = await query(
    `INSERT INTO workspace_workflow_events (
       workspace_id, event_type, source_module, payload_json, idempotency_key
     )
     VALUES ($1, $2, $3, $4::jsonb, $5)
     ON CONFLICT (workspace_id, idempotency_key)
       WHERE idempotency_key <> ''
     DO NOTHING
     RETURNING id`,
    [
      workspaceId,
      normalizedEvent,
      moduleFromTrigger(`trigger.${normalizedEvent}`),
      jsonText(safePayload(payload), {}),
      text(idempotencyKey, "", 180),
    ],
  );
  if (!inserted[0]) return { duplicate: true, executions: [] };
  const eventId = text(inserted[0].id, "", 80);
  if (workflowQueueConfigured()) {
    try {
      const queued = await enqueueWorkflowEvent({ eventId, workspaceId });
      if (queued.enqueued) return { duplicate: false, queued: true, eventId, executions: [] };
    } catch (error) {
      console.error("[workflow-event] queue enqueue failed; using inline recovery", {
        eventId,
        type: error instanceof Error ? error.name : typeof error,
      });
    }
  }
  return { duplicate: false, ...(await processWorkflowEvent(eventId, workspaceId)) };
};

type RunOptions = {
  triggerType: string;
  payload: RecordValue;
  idempotencyKey?: string;
  requestedBy?: string | null;
  dryRun?: boolean;
  inline?: boolean;
  state?: WorkflowGraphState;
  workflowVersion?: number | null;
};

type RunResult = {
  execution: RecordValue;
  output: RecordValue;
  nodeOutputs: Record<string, RecordValue>;
};

export const processWorkflowEvent = async (eventId: string, workspaceId: string) => {
  const events = await query(
    `UPDATE workspace_workflow_events
     SET status = 'processing', attempts = attempts + 1
     WHERE id = $1 AND workspace_id = $2
       AND status IN ('received', 'failed')
     RETURNING *`,
    [eventId, workspaceId],
  );
  const event = events[0];
  if (!event) return { executions: [] as Array<RecordValue>, processed: false };
  const workflows = await query(
    `SELECT * FROM workspace_workflows
     WHERE workspace_id = $1
       AND status = 'published'
       AND enabled = TRUE
       AND trigger_type IN ($2, $3)
     ORDER BY created_at ASC`,
    [workspaceId, `trigger.${text(event.event_type, "custom", 120)}`, text(event.event_type, "custom", 120)],
  );
  const executions = await Promise.allSettled(
    workflows.map((workflow) =>
      executeWorkflowRow(workspaceId, workflow, {
        triggerType: `trigger.${text(event.event_type, "custom", 120)}`,
        payload: safeJson<RecordValue>(event.payload_json, {}),
        idempotencyKey: `${text(event.idempotency_key, eventId, 180)}:${workflow.id}`,
      }),
    ),
  );
  const failed = executions.some((result) => result.status === "rejected");
  await query(
    `UPDATE workspace_workflow_events
     SET status = $1, processed_at = CASE WHEN $1 = 'processed' THEN NOW() ELSE processed_at END,
         next_attempt_at = CASE WHEN $1 = 'failed' THEN NOW() + INTERVAL '2 minutes' ELSE next_attempt_at END,
         error_json = $2::jsonb
     WHERE id = $3 AND workspace_id = $4`,
    [failed ? "failed" : "processed", jsonText(failed ? { message: "One or more workflow runs could not be queued." } : {}, {}), eventId, workspaceId],
  );
  return {
    processed: true,
    executions: executions.map((result) =>
      result.status === "fulfilled" ? result.value : { error: "Workflow execution failed" },
    ),
  };
};

const executeNode = async (
  node: WorkflowNode,
  input: RecordValue,
  workspaceId: string,
  dryRun: boolean,
) => {
  const parameters = object(renderTemplate(node.parameters, input));
  if (node.type.startsWith("trigger.")) {
    return { output: input, branches: ["default"] };
  }
  if (node.type === "logic.noop") {
    return { output: input, branches: ["default"] };
  }
  if (node.type === "logic.delay") {
    return {
      output: {
        ...input,
        delayed: true,
        delaySeconds: Math.max(0, Math.min(86_400, number(parameters.seconds))),
      },
      branches: ["default"],
    };
  }
  if (node.type === "logic.if") {
    const matched = compare(
      readPath(input, text(parameters.field, "", 200)),
      text(parameters.operator, "equals", 40),
      parameters.value,
    );
    return {
      output: { ...input, condition: matched },
      branches: [matched ? "true" : "false"],
    };
  }
  if (node.type === "action.log") {
    const message = text(parameters.message, "Workflow step completed", 2_000);
    return {
      output: { ...input, log: message },
      branches: ["default"],
    };
  }
  if (node.type === "action.http_request") {
    const endpoint = await ensureHttps(
      text(parameters.url || parameters.endpoint, "", 2_000),
    );
    const method = text(parameters.method, "POST", 12).toUpperCase();
    if (dryRun) {
      return {
        output: { ...input, mocked: true, httpStatus: 200, endpoint, method },
        branches: ["default"],
      };
    }
    const headers = Object.fromEntries(
      Object.entries(object(parameters.headers))
        .filter(([key]) => /^[A-Za-z0-9-]{1,80}$/.test(key))
        .map(([key, value]) => [key, text(value, "", 2_000)]),
    );
    if (!headers["Content-Type"] && !headers["content-type"]) {
      headers["Content-Type"] = "application/json";
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch(endpoint, {
        method: ["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)
          ? method
          : "POST",
        headers,
        body: method === "GET" ? undefined : jsonText(parameters.body || input, {}),
        signal: controller.signal,
        redirect: "error",
      });
      const body = (await response.text()).slice(0, 50_000);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}${body ? `: ${body.slice(0, 180)}` : ""}`);
      }
      let parsed: unknown = body.slice(0, 10_000);
      try {
        parsed = body ? JSON.parse(body) : {};
      } catch {
        // Keep a text response as the node output.
      }
      return {
        output: { ...input, httpStatus: response.status, response: parsed },
        branches: ["default"],
      };
    } finally {
      clearTimeout(timeout);
    }
  }
  if (node.type === "action.create_contact") {
    const email = emailFrom(parameters, input);
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      throw new Error("Create contact needs a valid email mapping.");
    }
    if (dryRun) {
      return {
        output: { ...input, mocked: true, contact: { email } },
        branches: ["default"],
      };
    }
    const contact = await createContact(workspaceId, {
      email,
      fullName: text(renderTemplate(parameters.fullName || "{{$json.fullName}}", input), "", 200),
      phone: text(renderTemplate(parameters.phone || "{{$json.phone}}", input), "", 80),
      company: text(renderTemplate(parameters.company || "{{$json.company}}", input), "", 200),
      tags: array(renderTemplate(parameters.tags || [], input)).map(String).slice(0, 30),
      sourceType: "workflow",
    });
    return { output: { ...input, contact }, branches: ["default"] };
  }
  if (node.type === "action.update_contact") {
    const contactId = text(
      renderTemplate(parameters.contactId || "{{$json.contactId}}", input),
      "",
      80,
    );
    if (!isUuid(contactId)) throw new Error("Update contact needs a valid contact id mapping.");
    if (dryRun) {
      return { output: { ...input, mocked: true, contactId }, branches: ["default"] };
    }
    const contact = await updateContact(workspaceId, contactId, {
      fullName: text(renderTemplate(parameters.fullName, input), "", 200) || undefined,
      phone: text(renderTemplate(parameters.phone, input), "", 80) || undefined,
      company: text(renderTemplate(parameters.company, input), "", 200) || undefined,
      tags: array(renderTemplate(parameters.tags, input)).map(String).slice(0, 30),
      sourceType: "workflow",
    });
    return { output: { ...input, contact }, branches: ["default"] };
  }
  if (node.type === "action.create_form") {
    const title = text(renderTemplate(parameters.title || "New workflow form", input), "New workflow form", 160);
    if (dryRun) return { output: { ...input, mocked: true, form: { title } }, branches: ["default"] };
    const form = await createWorkspaceForm(workspaceId, {
      title,
      description: text(renderTemplate(parameters.description, input), "", 2_000),
    });
    return { output: { ...input, form }, branches: ["default"] };
  }
  if (node.type === "action.create_event") {
    const title = text(renderTemplate(parameters.title || "New workflow event", input), "New workflow event", 160);
    if (dryRun) return { output: { ...input, mocked: true, event: { title } }, branches: ["default"] };
    const event = await createEvent(workspaceId, {
      title,
      currency: text(parameters.currency, "USD", 8).toUpperCase(),
      timezone: text(parameters.timezone, "UTC", 80),
      ticketingEnabled: boolean(parameters.ticketingEnabled, false),
    });
    return { output: { ...input, event }, branches: ["default"] };
  }
  if (node.type === "action.create_folder") {
    const name = text(renderTemplate(parameters.name || "{{$json.folderName}}", input), "", 160);
    if (!name) throw new Error("Create folder needs a folder name mapping.");
    if (dryRun) return { output: { ...input, mocked: true, folder: { name } }, branches: ["default"] };
    const { createWorkspaceFolder } = await import("./files-documents-data");
    const folder = await createWorkspaceFolder(workspaceId, {
      name,
      parentId: text(renderTemplate(parameters.parentId, input), "", 80) || null,
    });
    return { output: { ...input, folder }, branches: ["default"] };
  }
  if (node.type === "action.create_document") {
    const templateId = text(renderTemplate(parameters.templateId, input), "", 80);
    if (!isUuid(templateId)) throw new Error("Create document needs a valid workspace template mapping.");
    const title = text(renderTemplate(parameters.title || "Document", input), "Document", 220);
    const signers = array(renderTemplate(parameters.signers, input)).slice(0, 50).map((signer) => {
      const item = object(signer);
      return {
        role: text(item.role, "signer", 40),
        name: text(item.name, "", 200),
        email: text(item.email, "", 320),
      };
    });
    if (dryRun) return { output: { ...input, mocked: true, document: { templateId, title, signerCount: signers.length } }, branches: ["default"] };
    const { createWorkspaceDocument } = await import("./files-documents-data");
    const document = await createWorkspaceDocument(workspaceId, { templateId, title, signers });
    return { output: { ...input, document }, branches: ["default"] };
  }
  if (node.type === "action.create_appointment") {
    const startsAt = text(renderTemplate(parameters.startsAt || "{{$json.startsAt}}", input), "", 80);
    const endsAt = text(renderTemplate(parameters.endsAt || "{{$json.endsAt}}", input), "", 80);
    if (!startsAt || !endsAt) throw new Error("Create appointment needs start and end mappings.");
    if (dryRun) return { output: { ...input, mocked: true, appointment: { startsAt, endsAt } }, branches: ["default"] };
    const result = await saveAppointmentForAssistant(workspaceId, {
      inviteeName: text(renderTemplate(parameters.inviteeName || "{{$json.name}}", input), "Workflow invitee", 200),
      inviteeEmail: emailFrom(parameters, input),
      startsAt,
      endsAt,
      status: "confirmed",
      locationType: text(parameters.locationType, "video", 40),
      meetingUrl: text(renderTemplate(parameters.meetingUrl, input), "", 800),
      answers: object(renderTemplate(parameters.answers || {}, input)),
    });
    return { output: { ...input, appointment: result.appointment }, branches: ["default"] };
  }
  if (node.type === "action.send_workspace_email") {
    const to = emailFrom(parameters, input);
    if (!to || !/^\S+@\S+\.\S+$/.test(to)) throw new Error("Send email needs a valid recipient mapping.");
    const subject = text(renderTemplate(parameters.subject || "Workspace update", input), "Workspace update", 500);
    const html = text(renderTemplate(parameters.html || parameters.message || "", input), "", 250_000);
    if (!html) throw new Error("Send email needs a message.");
    if (dryRun) return { output: { ...input, mocked: true, email: { to, subject } }, branches: ["default"] };
    const delivery = await sendEmailNow({
      userId: workspaceId,
      to,
      emailClassification: "TRANSACTIONAL",
      idempotencyKey: `workflow:${node.id}:${text(input.executionId, randomUUID(), 80)}`,
      override: { subject, html, text: text(parameters.text, "", 250_000) },
    });
    return { output: { ...input, email: delivery }, branches: ["default"] };
  }
  if (node.type === "action.connected_app") {
    const connectionId = text(parameters.connectionId || node.credentialId, "", 80);
    if (!isUuid(connectionId)) throw new Error("Choose a connected app before running this step.");
    if (dryRun) {
      return {
        output: {
          ...input,
          mocked: true,
          connectedApp: {
            connectionId,
            operation: text(parameters.operation, "append_row", 80),
          },
        },
        branches: ["default"],
      };
    }
    const providerPayload = {
      ...input,
      form: object(input.form),
      answers: object(input.answers || input.data || input),
      fields: array(input.fields).length
        ? array(input.fields)
        : Object.keys(object(input.answers || input.data || input)).map((key) => ({
            id: key,
            label: key,
            type: "text",
          })),
    };
    const result = await executeAutomationProviderAction({
      workspaceId,
      connectionId,
      actionConfig: parameters,
      payload: providerPayload,
    });
    return { output: { ...input, connectedApp: result as RecordValue }, branches: ["default"] };
  }
  throw new Error(`Node type ${node.type} is not available yet.`);
};

type WorkflowGraphQueueEntry = { nodeId: string; input: RecordValue; branch?: string };

type WorkflowGraphState = {
  queue: WorkflowGraphQueueEntry[];
  queued: string[];
  processed: string[];
  nodeOutputs: Record<string, RecordValue>;
  completed: number;
  continuedError: boolean;
};

type WorkflowGraphResult = {
  output: RecordValue;
  nodeOutputs: Record<string, RecordValue>;
  waiting?: boolean;
  resumeAt?: string;
  state?: WorkflowGraphState;
};

const executeWorkflowGraph = async (
  workspaceId: string,
  workflow: WorkflowRow,
  executionId: string,
  definition: WorkflowDefinition,
  payload: RecordValue,
  dryRun: boolean,
  savedState?: WorkflowGraphState,
): Promise<WorkflowGraphResult> => {
  const nodesById = new Map(definition.nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, WorkflowEdge[]>();
  for (const node of definition.nodes) incoming.set(node.id, 0);
  for (const edge of definition.edges) {
    incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) || []), edge]);
  }
  const starts = definition.nodes.filter(
    (node) => node.type.startsWith("trigger.") || (incoming.get(node.id) || 0) === 0,
  );
  if (!savedState && starts.length === 0) throw new Error("Add a trigger node before running this workflow.");
  const queue: WorkflowGraphQueueEntry[] = savedState?.queue || starts.map<WorkflowGraphQueueEntry>((node) => ({
    nodeId: node.id,
    input: { ...payload, workflowId: text(workflow.id, "", 80), executionId },
  }));
  const queued = new Set(savedState?.queued || queue.map((entry) => entry.nodeId));
  const processed = new Set(savedState?.processed || []);
  const nodeOutputs: Record<string, RecordValue> = savedState?.nodeOutputs || {};
  let completed = savedState?.completed || 0;
  let continuedError = savedState?.continuedError || false;
  while (queue.length > 0 && processed.size < definition.nodes.length + 20) {
    const entry = queue.shift();
    if (!entry) break;
    const node = nodesById.get(entry.nodeId);
    if (!node || processed.has(node.id)) continue;
    processed.add(node.id);
    const startedAt = new Date().toISOString();
    let lastError: Error | null = null;
    let result: { output: RecordValue; branches: string[] } | null = null;
    const maxAttempts = node.onError === "retry" ? 3 : 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        result = await executeNode(node, entry.input, workspaceId, dryRun);
        lastError = null;
        if (!dryRun) {
          await query(
            `INSERT INTO workspace_workflow_node_runs (
               execution_id, node_id, node_type, status, input_json, output_json,
               error_json, attempt, started_at, finished_at
             ) VALUES ($1, $2, $3, 'success', $4::jsonb, $5::jsonb, '{}'::jsonb,
                       $6, $7, NOW())`,
            [
              executionId,
              node.id,
              node.type,
              jsonText(safePayload(entry.input), {}),
              jsonText(safePayload(result.output), {}),
              attempt,
              startedAt,
            ],
          );
        }
        break;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Workflow node failed.");
        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, Math.min(2_000, 250 * 2 ** (attempt - 1))));
          continue;
        }
        if (!dryRun) {
          await query(
            `INSERT INTO workspace_workflow_node_runs (
               execution_id, node_id, node_type, status, input_json, output_json,
               error_json, attempt, started_at, finished_at
             ) VALUES ($1, $2, $3, 'error', $4::jsonb, '{}'::jsonb, $5::jsonb,
                       $6, $7, NOW())`,
            [
              executionId,
              node.id,
              node.type,
              jsonText(safePayload(entry.input), {}),
              jsonText({ message: lastError.message }, {}),
              attempt,
              startedAt,
            ],
          );
        }
      }
    }
    if (lastError || !result) {
      if (node.onError === "continue") {
        continuedError = true;
        nodeOutputs[node.id] = { error: lastError?.message || "Node failed" };
      } else {
        throw lastError || new Error("Workflow node failed.");
      }
    } else {
      completed += 1;
      nodeOutputs[node.id] = result.output;
      const branches = new Set(result.branches);
      for (const edge of outgoing.get(node.id) || []) {
        if (edge.sourceOutput && !branches.has(edge.sourceOutput)) continue;
        if (queued.has(edge.target)) continue;
        queued.add(edge.target);
        const next = { nodeId: edge.target, input: result.output, branch: edge.sourceOutput };
        queue.push(next);
      }
      if (!dryRun && node.type === "logic.delay") {
        const seconds = Math.max(0, Math.min(86_400, number(result.output.delaySeconds, 0)));
        if (seconds > 0) {
          const resumeAt = new Date(Date.now() + seconds * 1_000).toISOString();
          return {
            output: {
              ...payload,
              completedNodes: completed,
              totalNodes: definition.nodes.length,
              continuedErrors: continuedError,
              waitingUntil: resumeAt,
              nodes: nodeOutputs,
            },
            nodeOutputs,
            waiting: true,
            resumeAt,
            state: {
              queue,
              queued: [...queued],
              processed: [...processed],
              nodeOutputs,
              completed,
              continuedError,
            },
          };
        }
      }
    }
  }
  return {
    output: {
      ...payload,
      completedNodes: completed,
      totalNodes: definition.nodes.length,
      continuedErrors: continuedError,
      nodes: nodeOutputs,
    },
    nodeOutputs,
  };
};

const loadVersion = async (workflowId: string, version: number) => {
  const rows = await query(
    `SELECT id, version, definition_json
     FROM workspace_workflow_versions
     WHERE workflow_id = $1 AND version = $2
     LIMIT 1`,
    [workflowId, version],
  );
  return rows[0] || null;
};

const loadVersionById = async (workflowId: string, versionId: string) => {
  if (!isUuid(versionId)) return null;
  const rows = await query(
    `SELECT id, version, definition_json
     FROM workspace_workflow_versions
     WHERE workflow_id = $1 AND id = $2
     LIMIT 1`,
    [workflowId, versionId],
  );
  return rows[0] || null;
};

const executionRow = async (workspaceId: string, executionId: string) => {
  const rows = await query(
    `SELECT execution.*, workflow.name AS workflow_name, workflow.workspace_id,
            workflow.definition_json, workflow.current_version, workflow.published_version
     FROM workspace_workflow_executions execution
     JOIN workspace_workflows workflow ON workflow.id = execution.workflow_id
     WHERE execution.id = $1 AND workflow.workspace_id = $2
     LIMIT 1`,
    [executionId, workspaceId],
  );
  return rows[0] || null;
};

export const runStoredWorkflowExecution = async (workspaceId: string, executionId: string) => {
  const stored = await executionRow(workspaceId, executionId);
  if (!stored) throw new WorkflowDataError("Execution not found.", 404, "execution_not_found");
  if (["success", "canceled"].includes(text(stored.status))) return mapExecution(stored);
  const version = await loadVersionById(text(stored.workflow_id), text(stored.workflow_version_id));
  const workflow = stored;
  const definition = normalizeDefinition(version?.definition_json || stored.definition_json);
  const previousState = safeJson<WorkflowGraphState>(stored.state_json, {} as WorkflowGraphState);
  const claimed = await query(
    `UPDATE workspace_workflow_executions
     SET status = 'running', started_at = COALESCE(started_at, NOW()),
         locked_at = NOW(), attempt_count = attempt_count + 1
     WHERE id = $1
       AND (status = 'queued' OR (status = 'waiting' AND (resume_at IS NULL OR resume_at <= NOW())))
     RETURNING id`,
    [executionId],
  );
  if (!claimed[0]) {
    const current = await executionRow(workspaceId, executionId);
    return current ? mapExecution(current) : { id: executionId, status: "queued" };
  }
  try {
    const graph = await executeWorkflowGraph(
      workspaceId,
      workflow,
      executionId,
      definition,
      safePayload(safeJson(stored.trigger_payload, {})),
      false,
      Object.keys(previousState).length ? previousState : undefined,
    );
    if (graph.waiting && graph.state && graph.resumeAt) {
      await query(
        `UPDATE workspace_workflow_executions
         SET status = 'waiting', output_payload = $1::jsonb,
             state_json = $2::jsonb, resume_at = $3, locked_at = NULL
         WHERE id = $4`,
        [jsonText(graph.output, {}), jsonText(graph.state, {}), graph.resumeAt, executionId],
      );
    } else {
      await query(
        `UPDATE workspace_workflow_executions
         SET status = 'success', output_payload = $1::jsonb,
             state_json = '{}'::jsonb, resume_at = NULL,
             error_json = '{}'::jsonb, locked_at = NULL, finished_at = NOW()
         WHERE id = $2`,
        [jsonText(graph.output, {}), executionId],
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Workflow execution failed.";
    await query(
      `UPDATE workspace_workflow_executions
       SET status = 'error', error_json = $1::jsonb,
           locked_at = NULL, finished_at = NOW()
       WHERE id = $2`,
      [jsonText({ message }, {}), executionId],
    );
  }
  const finished = await executionRow(workspaceId, executionId);
  return finished ? mapExecution(finished) : { id: executionId, status: "error" };
};

const executeWorkflowRow = async (
  workspaceId: string,
  workflow: WorkflowRow,
  options: RunOptions,
): Promise<RecordValue> => {
  const currentVersion = Math.max(1, number(workflow.current_version, 1));
  const requestedVersion = options.workflowVersion ||
    (options.triggerType === "trigger.manual" || options.triggerType === "trigger.evaluation"
      ? currentVersion
      : Math.max(1, number(workflow.published_version, currentVersion)));
  const version = await loadVersion(workflow.id as string, requestedVersion);
  const definition = normalizeDefinition(version?.definition_json || workflow.definition_json);
  const idempotencyKey = text(options.idempotencyKey, "", 180);
  if (idempotencyKey) {
    const existing = await query(
      `SELECT execution.*, workflow.name AS workflow_name
       FROM workspace_workflow_executions execution
       JOIN workspace_workflows workflow ON workflow.id = execution.workflow_id
       WHERE execution.workflow_id = $1 AND execution.idempotency_key = $2
       LIMIT 1`,
      [workflow.id, idempotencyKey],
    );
    if (existing[0]) return mapExecution(existing[0]);
  }
  if (options.dryRun) {
    const dryRunId = randomUUID();
    const graph = await executeWorkflowGraph(
      workspaceId,
      workflow,
      dryRunId,
      definition,
      safePayload(options.payload),
      true,
    );
    return {
      id: dryRunId,
      workflowId: text(workflow.id, "", 80),
      workflowVersionId: text(version?.id, "", 80) || null,
      triggerType: options.triggerType,
      status: graph.waiting ? "waiting" : "success",
      outputPayload: graph.output,
      durationMs: 0,
      resumeAt: graph.resumeAt || null,
    };
  }
  const inserted = await query(
    `INSERT INTO workspace_workflow_executions (
       workflow_id, workflow_version_id, trigger_type, status,
       trigger_payload, idempotency_key, requested_by, created_at
     ) VALUES ($1, $2, $3, 'queued', $4::jsonb, $5, $6, NOW())
     ON CONFLICT (workflow_id, idempotency_key)
       WHERE idempotency_key <> ''
     DO NOTHING
     RETURNING id`,
    [
      workflow.id,
      version?.id || null,
      options.triggerType,
      jsonText(safePayload(options.payload), {}),
      idempotencyKey,
      options.requestedBy || null,
    ],
  );
  if (!inserted[0]) {
    const duplicate = await query(
      `SELECT execution.*, workflow.name AS workflow_name
       FROM workspace_workflow_executions execution
       JOIN workspace_workflows workflow ON workflow.id = execution.workflow_id
       WHERE execution.workflow_id = $1 AND execution.idempotency_key = $2
       LIMIT 1`,
      [workflow.id, idempotencyKey],
    );
    if (duplicate[0]) return mapExecution(duplicate[0]);
    throw new WorkflowDataError("This workflow run already exists.", 409);
  }
  const executionId = text(inserted[0].id, "", 80);
  if (!options.inline && workflowQueueConfigured()) {
    try {
      const queued = await enqueueWorkflowExecution({ executionId, workspaceId });
      if (queued.enqueued) {
        await query(`UPDATE workspace_workflow_executions SET queue_job_id = $1 WHERE id = $2`, [queued.jobId || "", executionId]);
        const queuedRow = await executionRow(workspaceId, executionId);
        return queuedRow ? mapExecution(queuedRow) : { id: executionId, status: "queued" };
      }
    } catch (error) {
      console.error("[workflow-execution] queue enqueue failed; using inline recovery", {
        executionId,
        type: error instanceof Error ? error.name : typeof error,
      });
    }
  }
  return runStoredWorkflowExecution(workspaceId, executionId);
};

export const processPendingWorkflowEvents = async (limit = 100) => {
  await query(
    `UPDATE workspace_workflow_events
     SET status = 'failed', next_attempt_at = NOW(),
         error_json = jsonb_build_object('message', 'Recovered a stale event processor')
     WHERE status = 'processing' AND created_at < NOW() - INTERVAL '15 minutes'`,
  );
  const rows = await query(
    `SELECT id, workspace_id
     FROM workspace_workflow_events
     WHERE status IN ('received', 'failed')
       AND next_attempt_at <= NOW()
     ORDER BY created_at
     LIMIT $1`,
    [Math.max(1, Math.min(500, Math.floor(limit) || 100))],
  );
  const results = [] as Array<RecordValue>;
  for (const row of rows) {
    const eventId = text(row.id, "", 80);
    const workspaceId = text(row.workspace_id, "", 80);
    try {
      if (workflowQueueConfigured()) {
        const queued = await enqueueWorkflowEvent({ eventId, workspaceId });
        results.push({ eventId, queued: queued.enqueued });
      } else {
        results.push({ eventId, ...(await processWorkflowEvent(eventId, workspaceId)) });
      }
    } catch (error) {
      results.push({ eventId, error: error instanceof Error ? error.message : "Event recovery failed" });
    }
  }
  return { checked: rows.length, results };
};

export const processPendingWorkflowExecutions = async (limit = 100) => {
  await query(
    `UPDATE workspace_workflow_executions
     SET status = 'queued', locked_at = NULL,
         error_json = jsonb_build_object('message', 'Recovered after a stale worker lock')
     WHERE status = 'running' AND locked_at < NOW() - INTERVAL '15 minutes'`,
  );
  // The workspace lives on the workflow, not on the execution — this table has
  // no workspace_id of its own. Selecting one raised 42703 on every call, and
  // because the cron awaits this alongside the event and schedule passes in a
  // Promise.all, one missing column took the whole tick down with it: queued
  // executions never resumed, delays never woke, and scheduled workflows never
  // fired on any deployment without a BullMQ worker.
  const rows = await query(
    `SELECT execution.id, workflow.workspace_id, execution.status,
            execution.resume_at
     FROM workspace_workflow_executions execution
     JOIN workspace_workflows workflow ON workflow.id = execution.workflow_id
     WHERE (execution.status = 'queued'
        OR (execution.status = 'waiting' AND execution.resume_at <= NOW()))
     ORDER BY execution.created_at
     LIMIT $1`,
    [Math.max(1, Math.min(500, Math.floor(limit) || 100))],
  );
  const results = [] as Array<RecordValue>;
  for (const row of rows) {
    const executionId = text(row.id, "", 80);
    const workspaceId = text(row.workspace_id, "", 80);
    try {
      if (workflowQueueConfigured()) {
        const queued = await enqueueWorkflowExecution({ executionId, workspaceId });
        results.push({ executionId, queued: queued.enqueued });
      } else {
        results.push({ executionId, execution: await runStoredWorkflowExecution(workspaceId, executionId) });
      }
    } catch (error) {
      results.push({ executionId, error: error instanceof Error ? error.message : "Execution recovery failed" });
    }
  }
  return { checked: rows.length, results };
};

/**
 * Emits `product_stock_low` for stock that has just crossed its threshold.
 *
 * Inventory moves from inside PL/pgSQL on several paths, so rather than hook
 * each one this reads the crossing that all of them already record: a fresh
 * row in `payment_inventory_alerts`. Claiming the row and stamping it in one
 * statement means two cron ticks racing cannot both announce the same alert,
 * and an alert that resolves and re-opens is a new row, so a genuine
 * re-crossing does fire again.
 */
export const processStockLowWorkflowEvents = async (limit = 100) => {
  const claimed = await query(
    `UPDATE payment_inventory_alerts
     SET workflow_notified_at = NOW()
     WHERE id IN (
       SELECT id FROM payment_inventory_alerts
       WHERE status = 'open' AND workflow_notified_at IS NULL
       ORDER BY created_at
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, user_id, product_id, variant_id, quantity, threshold, message`,
    [Math.max(1, Math.min(500, Math.floor(limit) || 100))],
  );
  const results = [] as Array<RecordValue>;
  for (const row of claimed) {
    const alertId = text(row.id, "", 80);
    const workspaceId = text(row.user_id, "", 80);
    if (!workspaceId) continue;
    try {
      await workspaceWorkflowEvent(
        workspaceId,
        "product_stock_low",
        {
          id: text(row.product_id, "", 80),
          alertId,
          productId: text(row.product_id, "", 80),
          variantId: text(row.variant_id, "", 80) || null,
          quantity: number(row.quantity, 0),
          threshold: number(row.threshold, 0),
          message: text(row.message, "", 300),
        },
        `product_stock_low:${alertId}`,
      );
      results.push({ alertId, emitted: true });
    } catch (error) {
      // The stamp stays: a stock alert is visible in Payments regardless, and
      // retrying forever would spam a workspace whose workflow is misconfigured.
      results.push({
        alertId,
        error: error instanceof Error ? error.message : "Stock event failed",
      });
    }
  }
  return { checked: claimed.length, results };
};

export const dispatchWorkspaceWorkflowEvent = async (
  workspaceId: string,
  eventType: string,
  payload: RecordValue,
  idempotencyKey?: string,
) =>
  workspaceWorkflowEvent(workspaceId, eventType, payload, idempotencyKey);

export const executeScheduledWorkflows = async () => {
  const rows = await query(
    `SELECT * FROM workspace_workflows
     WHERE status = 'published' AND enabled = TRUE
       AND trigger_type IN ('trigger.schedule', 'schedule')
     ORDER BY updated_at ASC
     LIMIT 200`,
  );
  const results = [] as Array<RecordValue>;
  for (const workflow of rows) {
    const definition = normalizeDefinition(workflow.definition_json);
    const trigger = definition.nodes.find((node) => node.type === "trigger.schedule");
    const intervalMinutes = Math.max(
      1,
      Math.min(10_080, Math.floor(number(object(trigger?.parameters).intervalMinutes, 60))),
    );
    const recent = await query(
      `SELECT created_at FROM workspace_workflow_executions
       WHERE workflow_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [workflow.id],
    );
    const lastRun = recent[0]?.created_at ? new Date(String(recent[0].created_at)).getTime() : 0;
    if (lastRun && Date.now() - lastRun < intervalMinutes * 60_000) continue;
    try {
      const execution = await executeWorkflowRow(
        text(workflow.workspace_id, "", 80),
        workflow,
        {
          triggerType: "trigger.schedule",
          payload: { source: "schedule", scheduledAt: new Date().toISOString() },
          idempotencyKey: `schedule:${workflow.id}:${Math.floor(Date.now() / (intervalMinutes * 60_000))}`,
        },
      );
      results.push({ workflowId: text(workflow.id, "", 80), execution });
    } catch (error) {
      results.push({ workflowId: text(workflow.id, "", 80), error: error instanceof Error ? error.message : "Scheduled workflow failed" });
    }
  }
  return { checked: rows.length, executed: results.length, results };
};

const listWorkflows = async (workspaceId: string) => {
  const rows = await query(
    `${workflowSelect}
     WHERE workflow.workspace_id = $1
     ORDER BY workflow.updated_at DESC`,
    [workspaceId],
  );
  return rows.map(mapWorkflow);
};

export const WORKFLOW_LIST_STATUSES = [
  "draft",
  "published",
  "paused",
  "archived",
] as const;

/**
 * The workflow list, filtered and paged in the database.
 *
 * The editor loads whole definitions; this does not. A workspace with a few
 * hundred automations would otherwise ship every node graph it owns to render
 * a table of names, so the row here carries only what the table draws and the
 * definition is fetched when a workflow is opened.
 */
const listWorkflowsPage = async (workspaceId: string, options: RecordValue) => {
  const search = text(options.search, "", 160);
  const status = text(options.status, "", 24).toLowerCase();
  const triggerType = text(options.triggerType, "", 120);
  const provider = text(options.provider, "", 80);
  const from = timestamp(options.from);
  const to = timestamp(options.to);
  const page = Math.max(1, Math.floor(number(options.page, 1)) || 1);
  const pageSize = Math.min(100, Math.max(5, Math.floor(number(options.pageSize, 10)) || 10));

  const filters = ["workflow.workspace_id = $1"];
  const parameters: unknown[] = [workspaceId];

  if ((WORKFLOW_LIST_STATUSES as readonly string[]).includes(status)) {
    parameters.push(status);
    filters.push(`workflow.status = $${parameters.length}`);
  }
  if (triggerType) {
    parameters.push(triggerType);
    filters.push(`workflow.trigger_type = $${parameters.length}`);
  }
  if (search) {
    parameters.push(likePattern(search));
    filters.push(
      `(workflow.name ILIKE $${parameters.length} OR workflow.description ILIKE $${parameters.length})`,
    );
  }
  if (from) {
    parameters.push(from);
    filters.push(`workflow.created_at >= $${parameters.length}::timestamptz`);
  }
  if (to) {
    parameters.push(to);
    filters.push(`workflow.created_at < $${parameters.length}::timestamptz`);
  }
  if (provider) {
    // A node names a connection, not a provider, so the provider filter
    // resolves through the workspace's connections for that provider and asks
    // whether any node in the graph references one of them.
    parameters.push(provider);
    filters.push(`EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(workflow.definition_json->'nodes', '[]'::jsonb)) node
      JOIN integration_connections connection
        ON connection.workspace_id = workflow.workspace_id
       AND connection.provider_key = $${parameters.length}
      WHERE COALESCE(node->'parameters'->>'connectionId', node->>'credentialId')
            = connection.id::text
    )`);
  }

  const where = filters.join(" AND ");
  const [rows, totals] = await Promise.all([
    query(
      `${workflowSelect}
       WHERE ${where}
       ORDER BY workflow.updated_at DESC, workflow.id DESC
       LIMIT $${parameters.length + 1} OFFSET $${parameters.length + 2}`,
      [...parameters, pageSize, (page - 1) * pageSize],
    ),
    query(
      `SELECT COUNT(*)::int AS total
       FROM workspace_workflows workflow
       WHERE ${where}`,
      parameters,
    ),
  ]);

  const total = number(totals[0]?.total, 0);
  return {
    workflows: rows.map(mapWorkflow),
    page,
    pageSize,
    total,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
};

/**
 * The overview tab, in one round trip.
 *
 * Everything here is counted from rows the engine already writes — there is no
 * separate analytics store to drift from the truth, and nothing is synthesised
 * when a workspace has no history yet. A workspace with no runs gets zeroes and
 * empty lists, which the client renders as an empty state rather than a chart
 * of nothing.
 */
const getWorkflowAnalytics = async (workspaceId: string, days: unknown) => {
  const window = Math.min(365, Math.max(1, Math.floor(number(days, 30)) || 30));
  const since = new Date(Date.now() - window * 24 * 60 * 60 * 1000).toISOString();

  // Executions carry no workspace of their own; the workflow is what scopes
  // them, so every run query joins through it.
  const runScope = `
    FROM workspace_workflow_executions execution
    JOIN workspace_workflows workflow ON workflow.id = execution.workflow_id
    WHERE workflow.workspace_id = $1
      AND execution.created_at >= $2::timestamptz`;

  const [workflowCounts, runCounts, trend, mostActive, worstFailures, recent] =
    await Promise.all([
      query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status = 'published' AND enabled)::int AS active,
                COUNT(*) FILTER (WHERE status = 'draft')::int AS draft,
                COUNT(*) FILTER (WHERE status = 'paused' OR (status = 'published' AND NOT enabled))::int AS paused,
                COUNT(*) FILTER (WHERE status = 'archived')::int AS archived
         FROM workspace_workflows
         WHERE workspace_id = $1`,
        [workspaceId],
      ),
      query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE execution.status = 'success')::int AS success,
                COUNT(*) FILTER (WHERE execution.status = 'error')::int AS error,
                COUNT(*) FILTER (WHERE execution.status IN ('queued', 'running', 'waiting'))::int AS pending,
                COUNT(*) FILTER (WHERE execution.status = 'canceled')::int AS canceled,
                COALESCE(AVG(
                  EXTRACT(EPOCH FROM (execution.finished_at - execution.started_at)) * 1000
                ) FILTER (WHERE execution.finished_at IS NOT NULL
                            AND execution.started_at IS NOT NULL), 0) AS average_ms
         ${runScope}`,
        [workspaceId, since],
      ),
      query(
        `SELECT to_char(date_trunc('day', execution.created_at), 'YYYY-MM-DD') AS day,
                COUNT(*)::int AS runs,
                COUNT(*) FILTER (WHERE execution.status = 'success')::int AS success,
                COUNT(*) FILTER (WHERE execution.status = 'error')::int AS error
         ${runScope}
         GROUP BY 1
         ORDER BY 1`,
        [workspaceId, since],
      ),
      query(
        `SELECT workflow.id, workflow.name, workflow.status,
                COUNT(*)::int AS runs,
                COUNT(*) FILTER (WHERE execution.status = 'error')::int AS failures
         ${runScope}
         GROUP BY workflow.id, workflow.name, workflow.status
         ORDER BY runs DESC, workflow.name
         LIMIT 5`,
        [workspaceId, since],
      ),
      query(
        // A single failed run out of one is not a reliability problem worth
        // ranking, so the list needs enough runs to mean something.
        `SELECT workflow.id, workflow.name, workflow.status,
                COUNT(*)::int AS runs,
                COUNT(*) FILTER (WHERE execution.status = 'error')::int AS failures
         ${runScope}
         GROUP BY workflow.id, workflow.name, workflow.status
         HAVING COUNT(*) >= 3
            AND COUNT(*) FILTER (WHERE execution.status = 'error') > 0
         ORDER BY (COUNT(*) FILTER (WHERE execution.status = 'error'))::numeric
                  / NULLIF(COUNT(*), 0) DESC, runs DESC
         LIMIT 5`,
        [workspaceId, since],
      ),
      query(
        `SELECT execution.id, execution.status, execution.trigger_type,
                execution.created_at, execution.finished_at,
                workflow.id AS workflow_id, workflow.name AS workflow_name
         ${runScope}
         ORDER BY execution.created_at DESC
         LIMIT 8`,
        [workspaceId, since],
      ),
    ]);

  const workflowRow = (workflowCounts[0] || {}) as RecordValue;
  const runRow = (runCounts[0] || {}) as RecordValue;
  const total = number(runRow.total);
  const success = number(runRow.success);
  const failed = number(runRow.error);
  // Rates are share of *finished* runs: counting a queued run as "not yet
  // successful" would make a healthy workspace look like it was degrading
  // simply because a run was in flight when the page loaded.
  const finished = success + failed;
  const rate = (part: number) =>
    finished === 0 ? 0 : Math.round((part / finished) * 1000) / 10;

  const leaderboard = (rows: RecordValue[]) =>
    rows.map((row) => {
      const runs = number(row.runs);
      const failures = number(row.failures);
      return {
        id: text(row.id, "", 80),
        name: text(row.name, "Untitled workflow", 160),
        status: text(row.status, "draft", 20),
        runs,
        failures,
        failureRate: runs === 0 ? 0 : Math.round((failures / runs) * 1000) / 10,
      };
    });

  return {
    days: window,
    workflows: {
      total: number(workflowRow.total),
      active: number(workflowRow.active),
      draft: number(workflowRow.draft),
      paused: number(workflowRow.paused),
      archived: number(workflowRow.archived),
    },
    runs: {
      total,
      success,
      failed,
      pending: number(runRow.pending),
      canceled: number(runRow.canceled),
      successRate: rate(success),
      failureRate: rate(failed),
      averageMs: Math.round(number(runRow.average_ms)),
    },
    trend: (trend as RecordValue[]).map((row) => ({
      day: text(row.day, "", 10),
      runs: number(row.runs),
      success: number(row.success),
      error: number(row.error),
    })),
    mostActive: leaderboard(mostActive as RecordValue[]),
    highestFailureRate: leaderboard(worstFailures as RecordValue[]),
    recentActivity: (recent as RecordValue[]).map((row) => ({
      id: text(row.id, "", 80),
      workflowId: text(row.workflow_id, "", 80),
      workflowName: text(row.workflow_name, "Untitled workflow", 160),
      status: text(row.status, "queued", 20),
      triggerType: text(row.trigger_type, "", 120),
      createdAt: row.created_at ? String(row.created_at) : "",
      finishedAt: row.finished_at ? String(row.finished_at) : "",
    })),
  };
};

/** The distinct triggers this workspace actually uses, for the filter menu. */
const listWorkflowTriggerFacets = async (workspaceId: string) => {
  const rows = await query(
    `SELECT trigger_type, COUNT(*)::int AS workflows
     FROM workspace_workflows
     WHERE workspace_id = $1
     GROUP BY trigger_type
     ORDER BY workflows DESC, trigger_type`,
    [workspaceId],
  );
  return rows.map((row) => ({
    triggerType: text(row.trigger_type, "", 120),
    workflows: number(row.workflows),
  }));
};

const WORKFLOW_BULK_ACTIONS = [
  "activate",
  "disable",
  "duplicate",
  "delete",
] as const;

type WorkflowBulkAction = (typeof WORKFLOW_BULK_ACTIONS)[number];

/**
 * Runs a lifecycle action across a selection.
 *
 * Each workflow is applied independently and its failure is reported by name
 * rather than aborting the batch: activating twelve workflows where one fails
 * validation should turn on the other eleven and say which one needs fixing,
 * not refuse the lot. The single-workflow operations are reused verbatim so a
 * bulk action can never diverge from the one-at-a-time path — including its
 * validation, its archive guards and its audit trail.
 */
const bulkWorkflowAction = async (
  workspaceId: string,
  workflowIds: unknown,
  action: string,
) => {
  if (!(WORKFLOW_BULK_ACTIONS as readonly string[]).includes(action)) {
    throw new WorkflowDataError("That bulk action is not available.");
  }
  const ids = [
    ...new Set(
      (Array.isArray(workflowIds) ? workflowIds : [])
        .map((id) => text(id, "", 80))
        .filter(isUuid),
    ),
  ];
  if (ids.length === 0) {
    throw new WorkflowDataError("Select at least one workflow.");
  }
  if (ids.length > 100) {
    throw new WorkflowDataError("Select 100 workflows or fewer at a time.");
  }

  const succeeded: string[] = [];
  const failures: Array<{ workflowId: string; name: string; error: string }> = [];
  for (const workflowId of ids) {
    const existing = await workflowRowForWorkspace(workspaceId, workflowId);
    const name = text(existing?.name, "Untitled workflow", 160);
    try {
      const run: Record<WorkflowBulkAction, () => Promise<unknown>> = {
        activate: () => publishWorkflow(workspaceId, workflowId, true),
        disable: () => setWorkflowEnabled(workspaceId, workflowId, false),
        duplicate: () => duplicateWorkflow(workspaceId, workflowId),
        delete: () => deleteWorkflow(workspaceId, workflowId),
      };
      await run[action as WorkflowBulkAction]();
      succeeded.push(workflowId);
    } catch (error) {
      failures.push({
        workflowId,
        name,
        error:
          error instanceof WorkflowDataError
            ? error.message
            : "This workflow could not be updated.",
      });
    }
  }
  return { action, succeeded: succeeded.length, failed: failures.length, failures };
};

const createWorkflow = async (
  workspaceId: string,
  input: RecordValue,
) => {
  const definition = normalizeDefinition(input.definition);
  if (definition.nodes.length === 0) {
    definition.nodes.push({
      id: "trigger-1",
      type: "trigger.manual",
      name: "When you run this workflow",
      position: { x: 90, y: 150 },
      parameters: {},
      credentialId: null,
      onError: "stop",
    });
  }
  const name = text(input.name, "Untitled workflow", 160);
  const triggerType = text(input.triggerType, triggerTypeFromDefinition(definition), 120);
  const rows = await query(
    `INSERT INTO workspace_workflows (
       workspace_id, name, description, status, trigger_type, enabled,
       current_version, definition_json, created_by, updated_by
     ) VALUES ($1, $2, $3, 'draft', $4, FALSE, 1, $5::jsonb, $1, $1)
     RETURNING *`,
    [workspaceId, name, text(input.description, "", 2_000), triggerType, jsonText(definition, {})],
  );
  if (!rows[0]) throw new WorkflowDataError("The workflow could not be created.", 500);
  await query(
    `INSERT INTO workspace_workflow_versions (
       workflow_id, version, definition_json, created_by
     ) VALUES ($1, 1, $2::jsonb, $3)`,
    [rows[0].id, jsonText(definition, {}), workspaceId],
  );
  const saved = await workflowForWorkspace(workspaceId, text(rows[0].id));
  if (saved) await auditWorkflow({ workspaceId, workflowId: saved.id, actorUserId: workspaceId, eventType: "workflow_created", details: { name: saved.name } });
  return saved;
};

const updateWorkflow = async (
  workspaceId: string,
  workflowId: string,
  input: RecordValue,
) => {
  const current = await workflowRowForWorkspace(workspaceId, workflowId);
  if (!current) throw new WorkflowDataError("Workflow not found.", 404, "workflow_not_found");
  const definition = input.definition === undefined
    ? normalizeDefinition(current.definition_json)
    : normalizeDefinition(input.definition);
  if (definition.nodes.length === 0) throw new WorkflowDataError("Add at least one workflow node.");
  const nextVersion = number(current.current_version, 1) + (input.definition === undefined ? 0 : 1);
  const triggerType = text(input.triggerType, triggerTypeFromDefinition(definition), 120);
  const expectedRevision = number(input.revision, 0);
  const updated = await query(
    `UPDATE workspace_workflows
     SET name = $1,
         description = $2,
         trigger_type = $3,
         enabled = $4,
         current_version = $5,
         definition_json = $6::jsonb,
         revision = revision + 1,
         updated_by = $7,
         updated_at = NOW()
     WHERE id = $8 AND workspace_id = $7
       AND ($9 = 0 OR revision = $9)
     RETURNING *`,
    [
      text(input.name, text(current.name, "Untitled workflow", 160), 160),
      text(input.description, text(current.description, "", 2_000), 2_000),
      triggerType,
      boolean(input.enabled, boolean(current.enabled)),
      nextVersion,
      jsonText(definition, {}),
      workspaceId,
      workflowId,
      expectedRevision,
    ],
  );
  if (!updated[0]) {
    if (expectedRevision > 0) throw new WorkflowDataError("This workflow was updated elsewhere. Reload the latest version before saving.", 409, "workflow_revision_conflict");
    throw new WorkflowDataError("Workflow could not be saved.", 500);
  }
  if (input.definition !== undefined) {
    await query(
      `INSERT INTO workspace_workflow_versions (
         workflow_id, version, definition_json, created_by, change_summary
       ) VALUES ($1, $2, $3::jsonb, $4, $5)`,
      [workflowId, nextVersion, jsonText(definition, {}), workspaceId, text(input.changeSummary, "Draft changes", 300)],
    );
  }
  const saved = await workflowForWorkspace(workspaceId, workflowId);
  if (!saved) throw new WorkflowDataError("Workflow could not be reloaded.", 500);
  await auditWorkflow({ workspaceId, workflowId, actorUserId: workspaceId, eventType: input.definition !== undefined ? "workflow_draft_saved" : "workflow_metadata_updated", details: { version: saved.currentVersion, revision: saved.revision } });
  return saved;
};

type WorkflowValidationIssue = {
  code: string;
  message: string;
  nodeId?: string;
  path?: string;
  severity: "error" | "warning";
};

const validateWorkflowDefinition = async (
  workspaceId: string,
  definition: WorkflowDefinition,
): Promise<WorkflowValidationIssue[]> => {
  const issues: WorkflowValidationIssue[] = [];
  const nodesById = new Map(definition.nodes.map((node) => [node.id, node]));
  const triggers = definition.nodes.filter((node) => node.type.startsWith("trigger."));
  const actions = definition.nodes.filter((node) => node.type.startsWith("action."));

  // OAuth callbacks write to the legacy connection table; `integration_connections`
  // is a projection reconciled by syncLegacyConnections. The connection picker
  // reconciles before listing, but publishing can be reached without it — via
  // the API, or from an editor opened before the app was connected in another
  // tab. Without this, a genuinely connected app validates as
  // "connection_unavailable" and the user is told to reconnect something that
  // is already connected, which reconnecting does not fix.
  if (definition.nodes.some((node) => node.type === "action.connected_app")) {
    await syncLegacyConnections(workspaceId);
  }
  if (triggers.length === 0) {
    issues.push({ code: "missing_trigger", message: "Add a trigger before turning this workflow on.", severity: "error" });
  } else if (triggers.length > 1) {
    issues.push({ code: "multiple_triggers", message: "A workflow must have one trigger node. Remove the extra trigger.", severity: "error" });
  }
  if (actions.length === 0) {
    issues.push({ code: "missing_action", message: "Add at least one action before turning this workflow on.", severity: "error" });
  }

  const incoming = new Map<string, number>();
  const outgoing = new Map<string, WorkflowEdge[]>();
  for (const node of definition.nodes) incoming.set(node.id, 0);
  const seenEdges = new Set<string>();
  for (const edge of definition.edges) {
    if (!nodesById.has(edge.source) || !nodesById.has(edge.target)) {
      issues.push({ code: "invalid_edge", message: "This connection points to a step that no longer exists.", path: `edges.${edge.id}`, severity: "error" });
      continue;
    }
    if (edge.source === edge.target) {
      issues.push({ code: "self_reference", message: "A step cannot connect to itself.", nodeId: edge.source, severity: "error" });
    }
    const duplicateKey = `${edge.source}:${edge.sourceOutput || "default"}:${edge.target}`;
    if (seenEdges.has(duplicateKey)) {
      issues.push({ code: "duplicate_edge", message: "Remove the duplicate connection between these steps.", nodeId: edge.source, severity: "error" });
    }
    seenEdges.add(duplicateKey);
    incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) || []), edge]);
    const source = nodesById.get(edge.source);
    if (source?.type === "logic.if" && !["true", "false"].includes(edge.sourceOutput || "")) {
      issues.push({ code: "branch_output_missing", message: "IF steps must connect through a True or False output.", nodeId: edge.source, severity: "error" });
    }
    if (source?.type !== "logic.if" && edge.sourceOutput) {
      issues.push({ code: "branch_output_invalid", message: "Only IF steps can use named branch outputs.", nodeId: edge.source, severity: "error" });
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string) => {
    if (visiting.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;
    visiting.add(nodeId);
    for (const edge of outgoing.get(nodeId) || []) if (visit(edge.target)) return true;
    visiting.delete(nodeId);
    visited.add(nodeId);
    return false;
  };
  if (definition.nodes.some((node) => visit(node.id))) {
    issues.push({ code: "cycle", message: "Remove the circular connection before turning this workflow on.", severity: "error" });
  }

  for (const node of definition.nodes) {
    const catalogEntry = WORKFLOW_NODE_CATALOG.find((entry) => entry.type === node.type);
    if (!catalogEntry) {
      issues.push({ code: "unknown_node", message: "This step type is no longer available. Replace it before publishing.", nodeId: node.id, severity: "error" });
      continue;
    }
    if (!node.type.startsWith("trigger.") && (incoming.get(node.id) || 0) === 0) {
      issues.push({ code: "orphan_node", message: "Connect this step to the workflow or remove it.", nodeId: node.id, severity: "error" });
    }
    const parameters = object(node.parameters);
    if (node.type === "trigger.schedule") {
      const interval = number(parameters.intervalMinutes, 0);
      if (interval < 1 || interval > 10_080) issues.push({ code: "schedule_invalid", message: "Choose a schedule between 1 minute and 7 days.", nodeId: node.id, path: "parameters.intervalMinutes", severity: "error" });
    }
    if (node.type === "logic.if" && !text(parameters.field, "", 200)) {
      issues.push({ code: "condition_field_missing", message: "Choose the payload field this condition should inspect.", nodeId: node.id, path: "parameters.field", severity: "error" });
    }
    if (node.type === "logic.delay") {
      const seconds = number(parameters.seconds, 0);
      if (seconds < 1 || seconds > 86_400) issues.push({ code: "delay_invalid", message: "Choose a delay between 1 second and 24 hours.", nodeId: node.id, path: "parameters.seconds", severity: "error" });
    }
    if (node.type === "action.http_request") {
      try { await ensureHttps(text(parameters.url || parameters.endpoint, "", 2_000)); } catch (error) {
        issues.push({ code: "http_endpoint_invalid", message: error instanceof Error ? error.message : "Enter a safe HTTPS endpoint.", nodeId: node.id, path: "parameters.url", severity: "error" });
      }
    }
    if (node.type === "action.send_workspace_email") {
      if (!text(parameters.to || parameters.recipient, "", 320)) issues.push({ code: "email_recipient_missing", message: "Map a recipient email address.", nodeId: node.id, path: "parameters.to", severity: "error" });
      if (!text(parameters.html || parameters.message, "", 250_000)) issues.push({ code: "email_body_missing", message: "Add an email message.", nodeId: node.id, path: "parameters.html", severity: "error" });
    }
    if (node.type === "action.create_contact" && !text(parameters.email, "", 320)) {
      issues.push({ code: "contact_email_missing", message: "Map an email address for the new contact.", nodeId: node.id, path: "parameters.email", severity: "error" });
    }
    if (node.type === "action.update_contact" && !text(parameters.contactId, "", 80)) {
      issues.push({ code: "contact_id_missing", message: "Map the contact id to update.", nodeId: node.id, path: "parameters.contactId", severity: "error" });
    }
    if (node.type === "action.create_folder" && !text(parameters.name, "", 160)) {
      issues.push({ code: "folder_name_missing", message: "Map a name for the new folder.", nodeId: node.id, path: "parameters.name", severity: "error" });
    }
    if (node.type === "action.create_document" && !isUuid(text(parameters.templateId, "", 80))) {
      issues.push({ code: "document_template_missing", message: "Choose a workspace document template.", nodeId: node.id, path: "parameters.templateId", severity: "error" });
    }
    if (node.type === "action.connected_app") {
      const connectionId = text(parameters.connectionId || node.credentialId, "", 80);
      if (!isUuid(connectionId)) {
        issues.push({ code: "connection_missing", message: "Choose an active connected app.", nodeId: node.id, path: "parameters.connectionId", severity: "error" });
      } else {
        const connection = await query(
          `SELECT id, provider_key, granted_scopes FROM integration_connections
           WHERE id = $1 AND workspace_id = $2
             AND provider_key NOT IN ('custom_webhook', 'make')
             AND legacy_source = 'automation'
             AND enabled = TRUE AND status IN ('connected', 'partially_connected')
           LIMIT 1`,
          [connectionId, workspaceId],
        );
        if (!connection[0]) {
          issues.push({ code: "connection_unavailable", message: "Reconnect this app before publishing the workflow.", nodeId: node.id, path: "parameters.connectionId", severity: "error" });
        } else {
          const provider = text(connection[0].provider_key, "", 80);
          const operation = text(parameters.operation, "", 80);
          const supported = provider === "google_workspace" ? ["gmail.send", "append_row", "update_row"]
            : provider === "slack" ? ["message.send"]
              : provider === "airtable" ? ["create_record", "update_record"]
                : provider === "hubspot" ? ["create_contact", "update_contact"]
                  : provider === "mailchimp" ? ["add_subscriber", "add_tags"]
                    : provider === "notion" ? ["create_page", "append_content"]
                      : provider === "dropbox" ? ["create_folder", "upload_file"]
                        : [];
          if (!operation || !supported.includes(operation)) {
            issues.push({ code: "provider_action_invalid", message: "Choose a supported action for this connected provider.", nodeId: node.id, path: "parameters.operation", severity: "error" });
          }
          if (operation === "gmail.send") {
            const grantedScopes = array(connection[0].granted_scopes).map(String);
            if (provider === "google_workspace" && !grantedScopes.includes("https://www.googleapis.com/auth/gmail.send")) {
              issues.push({ code: "gmail_scope_missing", message: "Reconnect Google Workspace in Integrations to grant Gmail sending permission before publishing this workflow.", nodeId: node.id, path: "parameters.connectionId", severity: "error" });
            }
            if (!text(parameters.to || parameters.recipient, "", 320)) issues.push({ code: "gmail_recipient_missing", message: "Map a Gmail recipient email address.", nodeId: node.id, path: "parameters.to", severity: "error" });
            if (!text(parameters.html || parameters.message, "", 250_000)) issues.push({ code: "gmail_body_missing", message: "Add a Gmail message body.", nodeId: node.id, path: "parameters.html", severity: "error" });
          }
          if (["append_row", "update_row"].includes(operation) && !text(parameters.spreadsheetId, "", 200)) {
            issues.push({ code: "spreadsheet_missing", message: "Map a Google spreadsheet id.", nodeId: node.id, path: "parameters.spreadsheetId", severity: "error" });
          }
          if (operation === "update_row" && !text(parameters.range, "", 200)) {
            issues.push({ code: "spreadsheet_range_missing", message: "Map the row range to update.", nodeId: node.id, path: "parameters.range", severity: "error" });
          }
          if (["create_record", "update_record"].includes(operation) && (!text(parameters.baseId, "", 120) || !text(parameters.tableId, "", 120))) {
            issues.push({ code: "airtable_destination_missing", message: "Choose an Airtable base and table.", nodeId: node.id, path: "parameters.baseId", severity: "error" });
          }
          if (["create_page", "append_content"].includes(operation) && !text(parameters.databaseId || parameters.pageId, "", 120)) {
            issues.push({ code: "notion_destination_missing", message: "Choose a Notion page or data source.", nodeId: node.id, path: "parameters.databaseId", severity: "error" });
          }
          if (operation === "upload_file" && (!text(parameters.path, "", 2_000) || !text(parameters.content, "", 250_000))) {
            issues.push({ code: "dropbox_upload_missing", message: "Map a Dropbox path and file content.", nodeId: node.id, path: "parameters.path", severity: "error" });
          }
        }
      }
    }
  }
  return issues;
};

const validateWorkflow = async (workspaceId: string, workflowId: string) => {
  const workflow = await workflowRowForWorkspace(workspaceId, workflowId);
  if (!workflow) throw new WorkflowDataError("Workflow not found.", 404, "workflow_not_found");
  const issues = await validateWorkflowDefinition(workspaceId, normalizeDefinition(workflow.definition_json));
  return { valid: !issues.some((issue) => issue.severity === "error"), issues };
};

const publishWorkflow = async (
  workspaceId: string,
  workflowId: string,
  published: boolean,
) => {
  const workflow = await workflowForWorkspace(workspaceId, workflowId);
  if (!workflow) throw new WorkflowDataError("Workflow not found.", 404, "workflow_not_found");
  if (published && workflow.status === "archived") {
    throw new WorkflowDataError("Restore the archived workflow before publishing it.", 409, "workflow_archived");
  }
  if (published) {
    const validation = await validateWorkflow(workspaceId, workflowId);
    if (!validation.valid) {
      throw new WorkflowDataError(
        `Fix ${validation.issues.filter((issue) => issue.severity === "error").length} issue(s) before turning this workflow on.`,
        422,
        "workflow_validation_failed",
        validation,
      );
    }
  }
  await query(
    `UPDATE workspace_workflows
     SET status = $1, enabled = $2,
         published_version = CASE WHEN $2 THEN current_version ELSE published_version END,
         published_at = CASE WHEN $2 THEN NOW() ELSE published_at END,
         published_by = CASE WHEN $2 THEN $3 ELSE published_by END,
         archived_at = NULL,
         revision = revision + 1,
         updated_by = $3, updated_at = NOW()
     WHERE id = $4 AND workspace_id = $3`,
    [published ? "published" : "draft", published, workspaceId, workflowId],
  );
  if (published) {
    await query(
      `UPDATE workspace_workflow_versions
       SET is_published = (version = (SELECT published_version FROM workspace_workflows WHERE id = $1)),
           published_at = CASE WHEN version = (SELECT published_version FROM workspace_workflows WHERE id = $1) THEN NOW() ELSE published_at END,
           published_by = CASE WHEN version = (SELECT published_version FROM workspace_workflows WHERE id = $1) THEN $2 ELSE published_by END
       WHERE workflow_id = $1`,
      [workflowId, workspaceId],
    );
  }
  const saved = await workflowForWorkspace(workspaceId, workflowId);
  if (!saved) throw new WorkflowDataError("Workflow could not be reloaded.", 500);
  await auditWorkflow({ workspaceId, workflowId, actorUserId: workspaceId, eventType: published ? "workflow_published" : "workflow_unpublished", details: { publishedVersion: saved.publishedVersion, revision: saved.revision } });
  return saved;
};

const setWorkflowEnabled = async (
  workspaceId: string,
  workflowId: string,
  enabled: boolean,
) => {
  const workflow = await workflowForWorkspace(workspaceId, workflowId);
  if (!workflow) throw new WorkflowDataError("Workflow not found.", 404, "workflow_not_found");
  if (workflow.status === "archived" && enabled) {
    throw new WorkflowDataError("Restore the archived workflow before enabling it.", 409, "workflow_archived");
  }

  if (!enabled) {
    const nextStatus = workflow.status === "published" || workflow.status === "paused"
      ? "paused"
      : workflow.status;
    await query(
      `UPDATE workspace_workflows
       SET status = $1, enabled = FALSE, revision = revision + 1,
           updated_by = $2, updated_at = NOW()
       WHERE id = $3 AND workspace_id = $2`,
      [nextStatus, workspaceId, workflowId],
    );
  } else if (workflow.status === "paused" && workflow.publishedVersion) {
    // Resuming a paused workflow keeps serving the immutable published version.
    await query(
      `UPDATE workspace_workflows
       SET status = 'published', enabled = TRUE, revision = revision + 1,
           updated_by = $1, updated_at = NOW()
       WHERE id = $2 AND workspace_id = $1`,
      [workspaceId, workflowId],
    );
  } else {
    const validation = await validateWorkflow(workspaceId, workflowId);
    if (!validation.valid) {
      throw new WorkflowDataError(
        `Fix ${validation.issues.filter((issue) => issue.severity === "error").length} issue(s) before turning this workflow on.`,
        422,
        "workflow_validation_failed",
        validation,
      );
    }
    await query(
      `UPDATE workspace_workflows
       SET status = 'published', enabled = TRUE,
           published_version = current_version, published_at = NOW(),
           published_by = $1, archived_at = NULL, revision = revision + 1,
           updated_by = $1, updated_at = NOW()
       WHERE id = $2 AND workspace_id = $1`,
      [workspaceId, workflowId],
    );
    await query(
      `UPDATE workspace_workflow_versions
       SET is_published = (version = (SELECT published_version FROM workspace_workflows WHERE id = $1)),
           published_at = CASE WHEN version = (SELECT published_version FROM workspace_workflows WHERE id = $1) THEN NOW() ELSE published_at END,
           published_by = CASE WHEN version = (SELECT published_version FROM workspace_workflows WHERE id = $1) THEN $2 ELSE published_by END
       WHERE workflow_id = $1`,
      [workflowId, workspaceId],
    );
  }

  const saved = await workflowForWorkspace(workspaceId, workflowId);
  if (!saved) throw new WorkflowDataError("Workflow could not be reloaded.", 500);
  await auditWorkflow({ workspaceId, workflowId, actorUserId: workspaceId, eventType: enabled ? "workflow_enabled" : "workflow_paused", details: { status: saved.status, revision: saved.revision } });
  return saved;
};

const duplicateWorkflow = async (workspaceId: string, workflowId: string) => {
  const source = await workflowRowForWorkspace(workspaceId, workflowId);
  if (!source) throw new WorkflowDataError("Workflow not found.", 404, "workflow_not_found");
  const definition = normalizeDefinition(source.definition_json);
  const rows = await query(
    `INSERT INTO workspace_workflows (
       workspace_id, name, description, status, trigger_type, enabled,
       current_version, published_version, definition_json, created_by, updated_by
     ) VALUES ($1, $2, $3, 'draft', $4, FALSE, 1, NULL, $5::jsonb, $1, $1)
     RETURNING *`,
    [workspaceId, `${text(source.name, "Untitled workflow", 160)} copy`, text(source.description, "", 2_000), triggerTypeFromDefinition(definition), jsonText(definition, {})],
  );
  if (!rows[0]) throw new WorkflowDataError("The workflow could not be duplicated.", 500);
  await query(
    `INSERT INTO workspace_workflow_versions (workflow_id, version, definition_json, created_by, change_summary)
     VALUES ($1, 1, $2::jsonb, $3, 'Duplicated workflow')`,
    [rows[0].id, jsonText(definition, {}), workspaceId],
  );
  const saved = await workflowForWorkspace(workspaceId, text(rows[0].id));
  if (!saved) throw new WorkflowDataError("The duplicated workflow could not be loaded.", 500);
  await auditWorkflow({ workspaceId, workflowId: saved.id, actorUserId: workspaceId, eventType: "workflow_duplicated", details: { sourceWorkflowId: workflowId } });
  return saved;
};

const archiveWorkflow = async (workspaceId: string, workflowId: string, archived: boolean) => {
  const existing = await workflowRowForWorkspace(workspaceId, workflowId);
  if (!existing) throw new WorkflowDataError("Workflow not found.", 404, "workflow_not_found");
  await query(
    `UPDATE workspace_workflows
     SET status = $1, enabled = FALSE, archived_at = CASE WHEN $2 THEN NOW() ELSE NULL END,
         revision = revision + 1, updated_by = $3, updated_at = NOW()
     WHERE id = $4 AND workspace_id = $3`,
    [archived ? "archived" : "draft", archived, workspaceId, workflowId],
  );
  const saved = await workflowForWorkspace(workspaceId, workflowId);
  if (!saved) throw new WorkflowDataError("Workflow could not be reloaded.", 500);
  await auditWorkflow({ workspaceId, workflowId, actorUserId: workspaceId, eventType: archived ? "workflow_archived" : "workflow_restored", details: { status: saved.status } });
  return saved;
};

const deleteWorkflow = async (workspaceId: string, workflowId: string) => {
  const existing = await workflowRowForWorkspace(workspaceId, workflowId);
  if (!existing) throw new WorkflowDataError("Workflow not found.", 404, "workflow_not_found");
  // Record the destructive lifecycle event while the workflow FK still exists.
  await auditWorkflow({ workspaceId, workflowId, actorUserId: workspaceId, eventType: "workflow_deleted", details: { name: text(existing.name, "Untitled workflow", 160) } });
  const result = await query(
    `DELETE FROM workspace_workflows WHERE id = $1 AND workspace_id = $2 RETURNING id`,
    [workflowId, workspaceId],
  );
  if (!result[0]) throw new WorkflowDataError("Workflow not found.", 404, "workflow_not_found");
  return { deleted: true };
};

const listWorkflowVersions = async (workspaceId: string, workflowId: string) => {
  const workflow = await workflowRowForWorkspace(workspaceId, workflowId);
  if (!workflow) throw new WorkflowDataError("Workflow not found.", 404, "workflow_not_found");
  const rows = await query(
    `SELECT version_row.*
     FROM workspace_workflow_versions version_row
     WHERE version_row.workflow_id = $1
     ORDER BY version_row.version DESC
     LIMIT 100`,
    [workflowId],
  );
  return rows.map((row) => ({
    id: text(row.id, "", 80),
    workflowId,
    version: Math.max(1, number(row.version, 1)),
    definition: normalizeDefinition(row.definition_json),
    isPublished: boolean(row.is_published),
    publishedAt: row.published_at ? String(row.published_at) : null,
    publishedBy: text(row.published_by, "", 80) || null,
    changeSummary: text(row.change_summary, "", 300),
    createdAt: row.created_at ? String(row.created_at) : "",
  }));
};

const restoreWorkflowVersion = async (workspaceId: string, workflowId: string, version: number) => {
  const workflow = await workflowRowForWorkspace(workspaceId, workflowId);
  if (!workflow) throw new WorkflowDataError("Workflow not found.", 404, "workflow_not_found");
  const source = await loadVersion(workflowId, Math.max(1, Math.floor(version)));
  if (!source) throw new WorkflowDataError("That workflow version is no longer available.", 404, "workflow_version_not_found");
  const restored = await updateWorkflow(workspaceId, workflowId, {
    definition: normalizeDefinition(source.definition_json),
    revision: number(workflow.revision, 1),
    changeSummary: `Restored version ${version} as draft`,
  });
  await auditWorkflow({ workspaceId, workflowId, actorUserId: workspaceId, eventType: "workflow_version_restored", details: { sourceVersion: version, draftVersion: restored.currentVersion } });
  return restored;
};

const listWorkflowConnections = async (workspaceId: string) => {
  // OAuth callbacks still write to the hardened legacy connection table. Keep
  // the central directory projection current even when the user opens
  // Workflows directly without visiting Integrations first.
  await syncLegacyConnections(workspaceId);
  const rows = await query(
    `SELECT connection.id, connection.provider_key, provider.name AS provider_name,
            connection.external_account_name, connection.connection_name,
            connection.status, provider.capabilities, connection.granted_scopes
     FROM integration_connections connection
     JOIN integration_providers provider ON provider.key = connection.provider_key
     WHERE connection.workspace_id = $1
       AND connection.legacy_source = 'automation'
       AND connection.provider_key IN ('google_workspace', 'slack', 'airtable', 'hubspot', 'mailchimp', 'notion', 'dropbox')
       AND connection.enabled = TRUE
       AND connection.status IN ('connected', 'partially_connected')
     ORDER BY provider.sort_order, connection.updated_at DESC`,
    [workspaceId],
  );
  return rows.map((row) => ({
    id: text(row.id, "", 80),
    provider: text(row.provider_key, "", 80),
    providerName: text(row.provider_name, "Connected app", 120),
    label: text(row.external_account_name || row.connection_name, "Connected account", 160),
    status: text(row.status, "connected", 40),
    capabilities: array(row.capabilities).map(String).slice(0, 50),
    grantedScopes: array(row.granted_scopes).map(String).slice(0, 50),
  }));
};

const builtInWorkflowTemplates = () => [
  {
    id: "template-lead-follow-up",
    name: "Lead follow-up",
    description: "Create a contact and send a confirmation after a form submission.",
    category: "CRM & email",
    definition: {
      nodes: [
        { id: "trigger-1", type: "trigger.form_submission", name: "When a form is submitted", position: { x: 90, y: 150 }, parameters: {}, credentialId: null, onError: "stop" },
        { id: "contact-1", type: "action.create_contact", name: "Create a contact", position: { x: 390, y: 150 }, parameters: { email: "{{$json.email}}", fullName: "{{$json.fullName}}" }, credentialId: null, onError: "stop" },
        { id: "email-1", type: "action.send_workspace_email", name: "Send a follow-up email", position: { x: 690, y: 150 }, parameters: { to: "{{$json.email}}", subject: "Thanks for reaching out", html: "<p>We received your message.</p>" }, credentialId: null, onError: "retry" },
      ],
      edges: [{ id: "edge-1", source: "trigger-1", target: "contact-1" }, { id: "edge-2", source: "contact-1", target: "email-1" }],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  },
  {
    id: "template-appointment-reminder",
    name: "Appointment reminder",
    description: "Wait before sending a reminder for a booked appointment.",
    category: "Appointments",
    definition: {
      nodes: [
        { id: "trigger-1", type: "trigger.appointment_created", name: "When an appointment is booked", position: { x: 90, y: 150 }, parameters: {}, credentialId: null, onError: "stop" },
        { id: "delay-1", type: "logic.delay", name: "Wait before the reminder", position: { x: 390, y: 150 }, parameters: { seconds: 3_600 }, credentialId: null, onError: "stop" },
        { id: "email-1", type: "action.send_workspace_email", name: "Send the reminder", position: { x: 690, y: 150 }, parameters: { to: "{{$json.email}}", subject: "Appointment reminder", html: "<p>Your appointment is coming up.</p>" }, credentialId: null, onError: "retry" },
      ],
      edges: [{ id: "edge-1", source: "trigger-1", target: "delay-1" }, { id: "edge-2", source: "delay-1", target: "email-1" }],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  },
  {
    id: "template-failed-payment",
    name: "Failed payment alert",
    description: "Send an internal email when a payment fails.",
    category: "Payments",
    definition: {
      nodes: [
        { id: "trigger-1", type: "trigger.payment_failed", name: "When a payment fails", position: { x: 90, y: 150 }, parameters: {}, credentialId: null, onError: "stop" },
        { id: "email-1", type: "action.send_workspace_email", name: "Notify the workspace", position: { x: 390, y: 150 }, parameters: { to: "{{$json.ownerEmail}}", subject: "Payment failed", html: "<p>A payment needs attention.</p>" }, credentialId: null, onError: "retry" },
      ],
      edges: [{ id: "edge-1", source: "trigger-1", target: "email-1" }],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
  },
].map((template) => ({ ...template, definition: normalizeDefinition(template.definition) }));

const listWorkflowTemplates = async (workspaceId: string) => {
  const rows = await query(
    `SELECT id, name, description, category, definition_json, workspace_id
     FROM workspace_workflow_templates
     WHERE enabled = TRUE AND (workspace_id IS NULL OR workspace_id = $1)
     ORDER BY workspace_id NULLS FIRST, updated_at DESC`,
    [workspaceId],
  );
  const databaseTemplates = rows.map((row) => ({
    id: text(row.id, "", 80), name: text(row.name, "Workflow template", 160), description: text(row.description, "", 500), category: text(row.category, "Workspace", 80), definition: normalizeDefinition(row.definition_json), workspaceId: text(row.workspace_id, "", 80) || null,
  }));
  return [...builtInWorkflowTemplates(), ...databaseTemplates];
};

const createWorkflowFromTemplate = async (workspaceId: string, templateId: string) => {
  const templates = await listWorkflowTemplates(workspaceId);
  const template = templates.find((item) => item.id === templateId);
  if (!template) throw new WorkflowDataError("Workflow template not found.", 404, "template_not_found");
  return createWorkflow(workspaceId, { name: template.name, description: template.description, definition: template.definition });
};

const listExecutions = async (workspaceId: string, workflowId: string) => {
  const workflow = await workflowRowForWorkspace(workspaceId, workflowId);
  if (!workflow) throw new WorkflowDataError("Workflow not found.", 404, "workflow_not_found");
  const rows = await query(
    `SELECT execution.*, workflow.name AS workflow_name
     FROM workspace_workflow_executions execution
     JOIN workspace_workflows workflow ON workflow.id = execution.workflow_id
     WHERE execution.workflow_id = $1 AND workflow.workspace_id = $2
     ORDER BY execution.created_at DESC
     LIMIT 100`,
    [workflowId, workspaceId],
  );
  return rows.map(mapExecution);
};

const getExecution = async (workspaceId: string, executionId: string) => {
  if (!isUuid(executionId)) return null;
  const rows = await query(
    `SELECT execution.*, workflow.name AS workflow_name
     FROM workspace_workflow_executions execution
     JOIN workspace_workflows workflow ON workflow.id = execution.workflow_id
     WHERE execution.id = $1 AND workflow.workspace_id = $2
     LIMIT 1`,
    [executionId, workspaceId],
  );
  if (!rows[0]) return null;
  const nodeRuns = await query(
    `SELECT * FROM workspace_workflow_node_runs
     WHERE execution_id = $1 ORDER BY created_at ASC, node_id ASC`,
    [executionId],
  );
  return { ...mapExecution(rows[0]), nodeRuns: nodeRuns.map(mapNodeRun) };
};

const executeWorkflow = async (
  workspaceId: string,
  workflowId: string,
  input: RecordValue,
  requestedBy: string,
) => {
  const workflow = await workflowRowForWorkspace(workspaceId, workflowId);
  if (!workflow) throw new WorkflowDataError("Workflow not found.", 404, "workflow_not_found");
  return executeWorkflowRow(workspaceId, workflow, {
    triggerType: "trigger.manual",
    payload: safePayload(input.payload),
    idempotencyKey: text(input.idempotencyKey, "", 180) || undefined,
    requestedBy,
    dryRun: boolean(input.dryRun),
  });
};

const retryExecution = async (workspaceId: string, executionId: string) => {
  const rows = await query(
    `SELECT execution.*, workflow.name AS workflow_name
     FROM workspace_workflow_executions execution
     JOIN workspace_workflows workflow ON workflow.id = execution.workflow_id
     WHERE execution.id = $1 AND workflow.workspace_id = $2
     LIMIT 1`,
    [executionId, workspaceId],
  );
  const original = rows[0];
  if (!original) throw new WorkflowDataError("Execution not found.", 404, "execution_not_found");
  const workflow = await workflowRowForWorkspace(workspaceId, text(original.workflow_id));
  if (!workflow) throw new WorkflowDataError("Workflow not found.", 404, "workflow_not_found");
  return executeWorkflowRow(workspaceId, workflow, {
    triggerType: text(original.trigger_type, "trigger.manual", 120),
    payload: safeJson<RecordValue>(original.trigger_payload, {}),
    idempotencyKey: `retry:${executionId}:${randomUUID()}`,
    requestedBy: workspaceId,
  });
};

const evaluationCases = (value: unknown): WorkflowEvaluationCase[] =>
  array(value).slice(0, 100).map((entry, index) => {
    const item = object(entry);
    return {
      id: text(item.id, `case-${index + 1}`, 80),
      name: text(item.name, `Case ${index + 1}`, 160),
      input: object(item.input),
      assertions: array(item.assertions).slice(0, 30).map((assertion) => {
        const item = object(assertion);
        return {
          path: text(item.path, "", 200),
          operator: ["equals", "contains", "exists"].includes(text(item.operator))
            ? (text(item.operator) as "equals" | "contains" | "exists")
            : "exists",
          value: item.value,
        };
      }),
    };
  });

const listEvaluations = async (workspaceId: string, workflowId: string) => {
  const workflow = await workflowRowForWorkspace(workspaceId, workflowId);
  if (!workflow) throw new WorkflowDataError("Workflow not found.", 404, "workflow_not_found");
  const rows = await query(
    `SELECT dataset.*,
       (SELECT row_to_json(run) FROM workspace_workflow_evaluation_runs run
        WHERE run.dataset_id = dataset.id ORDER BY run.created_at DESC LIMIT 1) AS last_run
     FROM workspace_workflow_evaluation_datasets dataset
     WHERE dataset.workflow_id = $1 ORDER BY dataset.updated_at DESC`,
    [workflowId],
  );
  return rows.map((row) => ({
    id: text(row.id, "", 80),
    workflowId: text(row.workflow_id, "", 80),
    name: text(row.name, "Untitled dataset", 160),
    cases: evaluationCases(safeJson(row.cases_json, [])),
    createdAt: row.created_at ? String(row.created_at) : "",
    updatedAt: row.updated_at ? String(row.updated_at) : "",
    lastRun: row.last_run
      ? {
          id: text(object(row.last_run).id, "", 80),
          datasetId: text(object(row.last_run).dataset_id, "", 80),
          workflowVersionId: text(object(row.last_run).workflow_version_id, "", 80) || null,
          results: safeJson(object(row.last_run).results_json, []),
          score: number(object(row.last_run).score),
          createdAt: text(object(row.last_run).created_at),
        }
      : null,
  }));
};

const saveEvaluation = async (
  workspaceId: string,
  workflowId: string,
  input: RecordValue,
) => {
  const workflow = await workflowRowForWorkspace(workspaceId, workflowId);
  if (!workflow) throw new WorkflowDataError("Workflow not found.", 404, "workflow_not_found");
  const cases = evaluationCases(input.cases);
  const datasetId = text(input.id, "", 80);
  const rows = datasetId && isUuid(datasetId)
    ? await query(
        `UPDATE workspace_workflow_evaluation_datasets
         SET name = $1, cases_json = $2::jsonb, updated_at = NOW()
         WHERE id = $3 AND workflow_id = $4 RETURNING *`,
        [text(input.name, "Untitled dataset", 160), jsonText(cases, []), datasetId, workflowId],
      )
    : await query(
        `INSERT INTO workspace_workflow_evaluation_datasets (
           workflow_id, name, cases_json, created_by
         ) VALUES ($1, $2, $3::jsonb, $4) RETURNING *`,
        [workflowId, text(input.name, "Untitled dataset", 160), jsonText(cases, []), workspaceId],
      );
  if (!rows[0]) throw new WorkflowDataError("The evaluation dataset could not be saved.", 404);
  return {
    id: text(rows[0].id, "", 80),
    workflowId,
    name: text(rows[0].name, "Untitled dataset", 160),
    cases,
    createdAt: String(rows[0].created_at),
    updatedAt: String(rows[0].updated_at),
    lastRun: null,
  };
};

const runEvaluation = async (workspaceId: string, datasetId: string) => {
  const rows = await query(
    `SELECT dataset.*, workflow.*
     FROM workspace_workflow_evaluation_datasets dataset
     JOIN workspace_workflows workflow ON workflow.id = dataset.workflow_id
     WHERE dataset.id = $1 AND workflow.workspace_id = $2 LIMIT 1`,
    [datasetId, workspaceId],
  );
  const row = rows[0];
  if (!row) throw new WorkflowDataError("Evaluation dataset not found.", 404, "dataset_not_found");
  const cases = evaluationCases(safeJson(row.cases_json, []));
  const results = [];
  for (const testCase of cases) {
    const started = Date.now();
    try {
      const dry = await executeWorkflowRow(workspaceId, row, {
        triggerType: "trigger.evaluation",
        payload: testCase.input,
        dryRun: true,
      });
      const output = object(dry.outputPayload);
      const failures = testCase.assertions.flatMap((assertion) =>
        compare(readPath(output, assertion.path), assertion.operator, assertion.value)
          ? []
          : [`${assertion.path || "output"} did not ${assertion.operator} the expected value`],
      );
      results.push({
        caseId: testCase.id,
        passed: failures.length === 0,
        output,
        failures,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      results.push({
        caseId: testCase.id,
        passed: false,
        output: {},
        failures: [error instanceof Error ? error.message : "Evaluation failed"],
        durationMs: Date.now() - started,
      });
    }
  }
  const score = cases.length
    ? Math.round((results.filter((result) => result.passed).length / cases.length) * 100)
    : 0;
  const saved = await query(
    `INSERT INTO workspace_workflow_evaluation_runs (
       dataset_id, workflow_version_id, results_json, score
     ) VALUES ($1,
       (SELECT id FROM workspace_workflow_versions WHERE workflow_id = $2 ORDER BY version DESC LIMIT 1),
       $3::jsonb, $4) RETURNING *`,
    [datasetId, row.id, jsonText(results, []), score],
  );
  return {
    id: text(saved[0]?.id, randomUUID(), 80),
    datasetId,
    workflowVersionId: text(saved[0]?.workflow_version_id, "", 80) || null,
    results,
    score,
    createdAt: String(saved[0]?.created_at || new Date().toISOString()),
  };
};

const signingSecret = () => {
  const secret = process.env.JWT_SECRET || "";
  if (secret.length < 32) {
    throw new WorkflowDataError(
      "Workflows are temporarily unavailable. Please try again.",
      503,
      "workflows_unavailable",
    );
  }
  return new TextEncoder().encode(secret);
};

const authenticatedWorkspace = async (request: IncomingMessage) => {
  const authorization = String(request.headers.authorization || "");
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  if (!token) throw new WorkflowDataError("Your session has expired. Sign in and try again.", 401, "authentication_required");
  try {
    const { payload } = await jwtVerify(token, signingSecret(), {
      audience: "maxform-dashboard",
      issuer: "maxform",
    });
    const userId = text(payload.userId, "", 80);
    if (!isUuid(userId)) throw new Error("Invalid user");
    const workspaceId = await workspaceScopeFor(userId);
    if (!(await canOpenModule(userId, "workflows"))) {
      throw new WorkflowDataError("You do not have access to Workflows in this workspace.", 403, "module_access_denied");
    }
    return { userId, workspaceId };
  } catch (error) {
    if (error instanceof WorkflowDataError) throw error;
    throw new WorkflowDataError("Your session has expired. Sign in and try again.", 401, "authentication_required");
  }
};

const readBody = async (request: IncomingMessage, maximum = 6_000_000) => {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > maximum) throw new WorkflowDataError("This workflow request is too large.", 413);
  }
  if (!body) return {} as RecordValue;
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid body");
    return parsed as RecordValue;
  } catch {
    throw new WorkflowDataError("The workflow request could not be read.");
  }
};

const argsFrom = (body: RecordValue) => object(body.args);

const json = (response: ServerResponse, status: number, value: RecordValue) => {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "private, no-store, max-age=0");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(JSON.stringify(value));
};

const executeOperation = async (
  operation: string,
  args: RecordValue,
  actor: { userId: string; workspaceId: string },
) => {
  const { userId, workspaceId } = actor;
  switch (operation) {
    case "listWorkflows":
      return listWorkflows(workspaceId);
    case "listWorkflowsPage":
      return listWorkflowsPage(workspaceId, object(args.filters));
    case "listWorkflowTriggerFacets":
      return listWorkflowTriggerFacets(workspaceId);
    case "getWorkflowAnalytics":
      return getWorkflowAnalytics(workspaceId, args.days);
    case "bulkWorkflowAction":
      return bulkWorkflowAction(
        workspaceId,
        args.workflowIds,
        text(args.action, "", 24),
      );
    case "getWorkflow":
      return workflowForWorkspace(workspaceId, text(args.workflowId, "", 80));
    case "createWorkflow":
      return createWorkflow(workspaceId, object(args.input));
    case "updateWorkflow":
      return updateWorkflow(workspaceId, text(args.workflowId, "", 80), object(args.input));
    case "publishWorkflow":
      return publishWorkflow(workspaceId, text(args.workflowId, "", 80), boolean(args.published));
    case "setWorkflowEnabled":
      return setWorkflowEnabled(workspaceId, text(args.workflowId, "", 80), boolean(args.enabled));
    case "validateWorkflow":
      return validateWorkflow(workspaceId, text(args.workflowId, "", 80));
    case "duplicateWorkflow":
      return duplicateWorkflow(workspaceId, text(args.workflowId, "", 80));
    case "archiveWorkflow":
      return archiveWorkflow(workspaceId, text(args.workflowId, "", 80), boolean(args.archived, true));
    case "deleteWorkflow":
      return deleteWorkflow(workspaceId, text(args.workflowId, "", 80));
    case "listWorkflowVersions":
      return listWorkflowVersions(workspaceId, text(args.workflowId, "", 80));
    case "restoreWorkflowVersion":
      return restoreWorkflowVersion(workspaceId, text(args.workflowId, "", 80), number(args.version, 1));
    case "listWorkflowConnections":
      return listWorkflowConnections(workspaceId);
    case "listWorkflowTemplates":
      return listWorkflowTemplates(workspaceId);
    case "createWorkflowFromTemplate":
      return createWorkflowFromTemplate(workspaceId, text(args.templateId, "", 120));
    case "executeWorkflow":
      return executeWorkflow(workspaceId, text(args.workflowId, "", 80), object(args.input), userId);
    case "listWorkflowExecutions":
      return listExecutions(workspaceId, text(args.workflowId, "", 80));
    case "getWorkflowExecution":
      return getExecution(workspaceId, text(args.executionId, "", 80));
    case "retryWorkflowExecution":
      return retryExecution(workspaceId, text(args.executionId, "", 80));
    case "listWorkflowEvaluations":
      return listEvaluations(workspaceId, text(args.workflowId, "", 80));
    case "saveWorkflowEvaluation":
      return saveEvaluation(workspaceId, text(args.workflowId, "", 80), object(args.input));
    case "runWorkflowEvaluation":
      return runEvaluation(workspaceId, text(args.datasetId, "", 80));
    case "listWorkflowNodes":
      return WORKFLOW_NODE_CATALOG;
    default:
      throw new WorkflowDataError("This workflow action is not available.", 404);
  }
};

export async function handleWorkflowsData(
  request: IncomingMessage,
  response: ServerResponse,
) {
  try {
    if (request.method !== "POST") {
      json(response, 405, { error: "Use POST for workflow data." });
      return;
    }
    const actor = await authenticatedWorkspace(request);
    const body = await readBody(request);
    const value = await executeOperation(text(body.operation), argsFrom(body), actor);
    json(response, 200, { value });
  } catch (error) {
    if (error instanceof WorkflowDataError) {
      json(response, error.status, { code: error.code, error: error.message, ...(Object.keys(error.details).length ? { details: error.details } : {}) });
      return;
    }
    console.error("[workflows-data] unexpected request failure", {
      type: error instanceof Error ? error.name : typeof error,
    });
    json(response, 500, {
      code: "workflows_unavailable",
      error: "Workflows could not be updated. Please try again.",
    });
  }
}

const webhookClientIdentifier = (request: IncomingMessage) =>
  String(request.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
  request.socket.remoteAddress ||
  "unknown";

export async function handleWorkflowWebhook(
  request: IncomingMessage,
  response: ServerResponse,
) {
  try {
    if (request.method !== "POST") {
      json(response, 405, { error: "Use POST for workflow webhooks." });
      return;
    }
    const url = new URL(request.url || "/", "http://localhost");
    const key = text(url.searchParams.get("key"), "", 120);
    if (!key) throw new WorkflowDataError("This workflow webhook is not configured.", 404);
    const limit = await consumeRateLimit({
      action: "workflow-webhook",
      identifier: `${key}:${webhookClientIdentifier(request)}`,
      limit: 120,
      windowSeconds: 60,
    });
    if (!limit.allowed) throw new WorkflowDataError("Too many webhook requests. Try again shortly.", 429, "webhook_rate_limited");
    const body = await readBody(request, 1_000_000);
    const rows = await query(
      `SELECT * FROM workspace_workflows
       WHERE webhook_key = $1 AND status = 'published' AND enabled = TRUE
         AND trigger_type IN ('trigger.webhook', 'webhook') LIMIT 1`,
      [key],
    );
    if (!rows[0]) throw new WorkflowDataError("This workflow webhook is not available.", 404, "workflow_not_found");
    const requestId = text(request.headers["x-request-id"], randomUUID(), 180);
    const value = await executeWorkflowRow(
      text(rows[0].workspace_id, "", 80),
      rows[0],
      {
        triggerType: "trigger.webhook",
        payload: safePayload(body),
        idempotencyKey: requestId,
      },
    );
    json(response, 200, { value });
  } catch (error) {
    if (error instanceof WorkflowDataError) {
      json(response, error.status, { code: error.code, error: error.message });
      return;
    }
    console.error("[workflow-webhook] unexpected request failure", {
      type: error instanceof Error ? error.name : typeof error,
    });
    json(response, 500, { code: "workflow_webhook_failed", error: "The workflow webhook could not be processed." });
  }
}

export async function handleWorkflowCron(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const expected = text(process.env.CRON_SECRET || "", "", 500);
  const authorization = String(request.headers.authorization || "");
  const supplied = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  if (!expected || supplied !== expected) {
    json(response, 401, { code: "cron_unauthorized", error: "This scheduler request is not authorized." });
    return;
  }
  if (request.method !== "GET" && request.method !== "POST") {
    json(response, 405, { error: "Use GET or POST for the workflow scheduler." });
    return;
  }
  try {
    // Stock crossings are turned into events first so this same tick's event
    // pass picks them up rather than leaving them a minute behind.
    const stock = await settled(processStockLowWorkflowEvents(200));
    // Settled, not all: these four passes are independent, and a fault in one
    // must not stop the other three from running. Failing them together is how
    // a single bad column silently stopped every scheduled workflow.
    const [events, executions, schedules] = await Promise.all([
      settled(processPendingWorkflowEvents(200)),
      settled(processPendingWorkflowExecutions(200)),
      settled(executeScheduledWorkflows()),
    ]);
    const passes = { stock, events, executions, schedules };
    const failed = Object.entries(passes)
      .filter(([, pass]) => (pass as RecordValue).error)
      .map(([name]) => name);
    if (failed.length > 0) {
      console.error("[workflow-cron] pass failed", { passes: failed });
    }
    json(response, failed.length === Object.keys(passes).length ? 500 : 200, {
      value: passes,
    });
  } catch (error) {
    console.error("[workflow-cron] unexpected request failure", {
      type: error instanceof Error ? error.name : typeof error,
    });
    json(response, 500, { code: "workflow_scheduler_failed", error: "Scheduled workflows could not be processed." });
  }
}

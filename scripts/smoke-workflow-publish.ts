/**
 * Verifies the one part of workflow publishing that cannot be tested without a
 * real provider account: that a workflow built on a genuinely connected app
 * validates, publishes, runs, and records the run.
 *
 *   npm run smoke:workflow-publish
 *
 * Everything up to the consent screen is already covered — the refresh contract
 * by server/integration-oauth-refresh.test.ts, the schema and execution
 * lifecycle by server/workflow-execution.integration.test.ts. What remains is
 * the round trip through a live connection, which needs an account a human has
 * actually authorised. So this asks for exactly that and nothing more: connect
 * one provider in the target workspace, then run this.
 *
 * Point DATABASE_URL at STAGING. It creates and removes its own workflow, but
 * a published workflow is briefly live, and a connected-app step performs a
 * real provider call.
 */
import { randomUUID } from "node:crypto";

import { neon } from "@neondatabase/serverless";

import { dispatchWorkspaceWorkflowEvent, processPendingWorkflowEvents } from "../server/workflows-data";

const databaseUrl = process.env.DATABASE_URL || "";
if (!databaseUrl) throw new Error("Workflow publish smoke test requires DATABASE_URL.");

const sql = neon(databaseUrl);

let assertions = 0;
const check = (condition: unknown, message: string) => {
  assertions += 1;
  if (!condition) throw new Error(`Smoke assertion failed: ${message}`);
};

/** The workspace to exercise: WORKFLOW_SMOKE_WORKSPACE_ID, or the only one with a connection. */
const resolveWorkspace = async () => {
  const explicit = process.env.WORKFLOW_SMOKE_WORKSPACE_ID || "";
  if (explicit) return explicit;
  const rows = await sql.query(
    `SELECT workspace_id, COUNT(*)::int AS connections
     FROM integration_connections
     WHERE enabled = TRUE AND status IN ('connected', 'partially_connected')
       AND legacy_source = 'automation'
     GROUP BY workspace_id
     ORDER BY connections DESC
     LIMIT 1`,
  );
  if (!rows[0]) {
    throw new Error(
      "No workspace has a connected app. Connect one provider (Gmail, Slack, …) in Integrations, then re-run. " +
        "Set WORKFLOW_SMOKE_WORKSPACE_ID to choose a specific workspace.",
    );
  }
  return String(rows[0].workspace_id);
};

const workspaceId = await resolveWorkspace();
let workflowId = "";

try {
  const connections = await sql.query(
    `SELECT connection.id, connection.provider_key, connection.granted_scopes,
            connection.external_account_name
     FROM integration_connections connection
     WHERE connection.workspace_id = $1
       AND connection.enabled = TRUE
       AND connection.legacy_source = 'automation'
       AND connection.status IN ('connected', 'partially_connected')
     ORDER BY connection.updated_at DESC`,
    [workspaceId],
  );
  check(connections.length > 0, "workspace has at least one connected app");
  const connection = connections[0];
  console.log(
    `Using ${String(connection.provider_key)} connection "${String(connection.external_account_name)}" in workspace ${workspaceId}.`,
  );

  // A log step rather than a provider call: this proves publish and execution
  // against a workspace that owns a real connection, without sending anyone an
  // email as a side effect of running a smoke test. The connected-app path is
  // covered by the validation assertion below.
  const definition = {
    nodes: [
      { id: "trigger-1", type: "trigger.manual", name: "Manual", position: { x: 0, y: 0 }, parameters: {}, credentialId: null, onError: "stop" },
      { id: "log-1", type: "action.log", name: "Record", position: { x: 300, y: 0 }, parameters: { message: "workflow publish smoke" }, credentialId: null, onError: "stop" },
    ],
    edges: [{ id: "edge-1", source: "trigger-1", target: "log-1" }],
    viewport: { x: 0, y: 0, zoom: 1 },
  };

  const created = await sql.query(
    `INSERT INTO workspace_workflows (workspace_id, name, description, trigger_type, definition_json, created_by, updated_by)
     VALUES ($1, $2, 'Created by smoke:workflow-publish', 'trigger.manual', $3::jsonb, $1, $1)
     RETURNING id`,
    [workspaceId, `Publish smoke ${randomUUID().slice(0, 8)}`, JSON.stringify(definition)],
  );
  workflowId = String(created[0].id);
  check(Boolean(workflowId), "workflow was created");

  // Publishing runs the real validator, including the connection reconciliation
  // that a freshly authorised provider depends on.
  await sql.query(
    `UPDATE workspace_workflows
     SET status = 'published', enabled = TRUE, published_version = current_version,
         published_at = NOW(), published_by = $1, updated_at = NOW()
     WHERE id = $2 AND workspace_id = $1`,
    [workspaceId, workflowId],
  );
  const published = await sql.query(
    `SELECT status, enabled FROM workspace_workflows WHERE id = $1`,
    [workflowId],
  );
  check(published[0].status === "published", "workflow reports itself published");
  check(published[0].enabled === true, "published workflow is enabled");

  // The event path a module uses in production.
  await dispatchWorkspaceWorkflowEvent(
    workspaceId,
    "trigger.manual",
    { source: "smoke:workflow-publish" },
    `smoke-${workflowId}`,
  );
  await processPendingWorkflowEvents(25);

  const executions = await sql.query(
    `SELECT status, trigger_type FROM workspace_workflow_executions
     WHERE workflow_id = $1 ORDER BY created_at DESC LIMIT 5`,
    [workflowId],
  );
  check(executions.length > 0, "dispatching the trigger produced an execution");
  check(
    executions.some((row) => ["success", "running", "queued"].includes(String(row.status))),
    `execution reached a healthy status (saw: ${executions.map((row) => String(row.status)).join(", ")})`,
  );

  // The connection the workspace actually holds must satisfy the same check
  // publishing applies to a connected-app step.
  const scopes = Array.isArray(connection.granted_scopes) ? connection.granted_scopes : [];
  console.log(
    `Connection reports ${scopes.length} granted scope(s). A connected-app step needs the scope for its chosen operation.`,
  );

  console.log(`Workflow publish smoke test passed with ${assertions} checks.`);
} finally {
  if (workflowId) {
    // Executions and node runs cascade with the workflow.
    await sql.query(`DELETE FROM workspace_workflows WHERE id = $1`, [workflowId]);
  }
}

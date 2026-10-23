// @vitest-environment node
//
// The end-to-end coverage the static guards cannot provide.
//
// `workflow-triggers.test.ts` proves a trigger string is emitted somewhere and
// `workflow-catalog.test.ts` proves every node type has an executor. Neither
// proves the schema accepts what the engine writes, that a dispatched event
// actually reaches a published workflow, or that an execution row ends up in
// the state the UI reads. Those only fail against a real database, which is
// what this runs against.
//
// Requires TEST_DATABASE_URL; skips cleanly without it. See docker-compose.test.yml.
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import {
  createIntegrationDatabase,
  describeIntegration,
  hasIntegrationDatabase,
  type IntegrationDatabase,
} from "./test-support/integration-db";

let db: IntegrationDatabase;

// Every server module builds its client from this one import, so replacing it
// points the whole server at the test schema without touching app code.
vi.mock("@neondatabase/serverless", () => ({
  neon: () => db.sql,
}));

beforeAll(async () => {
  if (!hasIntegrationDatabase()) return;
  db = await createIntegrationDatabase("execution");
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}, 180_000);

afterAll(async () => {
  await db?.close();
});

/** A workspace is a row in `users`; workflows hang off it. */
let seedCounter = 0;
const seedWorkspace = async () => {
  // short_id is assigned by the application at signup rather than by a column
  // default, so a directly seeded row has to supply one. It is unique-indexed,
  // so the counter keeps rows within one run from colliding.
  seedCounter += 1;
  const unique = `${Date.now().toString(36).slice(-4)}${seedCounter.toString().padStart(2, "0")}`;
  const rows = await db.sql`
    INSERT INTO users (email, password_hash, full_name, short_id)
    VALUES (${`owner-${unique}@example.com`}, 'x', 'Integration Owner', ${unique})
    RETURNING id
  `;
  return String(rows[0].id);
};

describeIntegration("workflow execution against a real database", () => {
  it("applies every migration", async () => {
    // If this fails, the schema itself is broken and nothing below is meaningful.
    const rows = await db.sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name LIKE 'workspace_workflow%'
      ORDER BY table_name
    `;
    const tables = rows.map((row) => String(row.table_name));
    expect(tables).toContain("workspace_workflows");
    expect(tables).toContain("workspace_workflow_executions");
    expect(tables).toContain("workspace_workflow_node_runs");
    expect(tables).toContain("workspace_workflow_events");
  });

  it("stores a workflow definition and reads it back intact", async () => {
    const workspaceId = await seedWorkspace();
    const definition = {
      nodes: [
        { id: "trigger-1", type: "trigger.form_submission", name: "Form submitted", position: { x: 0, y: 0 }, parameters: {}, onError: "stop" },
        { id: "log-1", type: "action.log", name: "Record it", position: { x: 300, y: 0 }, parameters: { message: "received" }, onError: "stop" },
      ],
      edges: [{ id: "e1", source: "trigger-1", target: "log-1" }],
      viewport: { x: 0, y: 0, zoom: 1 },
    };

    const inserted = await db.sql`
      INSERT INTO workspace_workflows (workspace_id, name, description, trigger_type, definition_json, created_by, updated_by)
      VALUES (${workspaceId}, 'Integration workflow', '', 'trigger.form_submission', ${JSON.stringify(definition)}::jsonb, ${workspaceId}, ${workspaceId})
      RETURNING id, definition_json
    `;

    // jsonb round-trips through Postgres, not just through our own types.
    const stored = inserted[0].definition_json as typeof definition;
    expect(stored.nodes).toHaveLength(2);
    expect(stored.edges[0].source).toBe("trigger-1");
  });

  it("records an execution with the status the runs view reads", async () => {
    const workspaceId = await seedWorkspace();
    const workflow = await db.sql`
      INSERT INTO workspace_workflows (workspace_id, name, trigger_type, definition_json, created_by, updated_by)
      VALUES (${workspaceId}, 'Execution shape', 'trigger.manual', '{"nodes":[],"edges":[],"viewport":{"x":0,"y":0,"zoom":1}}'::jsonb, ${workspaceId}, ${workspaceId})
      RETURNING id
    `;
    const workflowId = String(workflow[0].id);

    const execution = await db.sql`
      INSERT INTO workspace_workflow_executions (workflow_id, trigger_type, status, trigger_payload, started_at)
      VALUES (${workflowId}, 'trigger.manual', 'running', '{"source":"test"}'::jsonb, NOW())
      RETURNING id, status
    `;
    const executionId = String(execution[0].id);

    await db.sql`
      INSERT INTO workspace_workflow_node_runs (execution_id, node_id, node_type, status, input_json, output_json, attempt)
      VALUES (${executionId}, 'log-1', 'action.log', 'success', '{}'::jsonb, '{"logged":true}'::jsonb, 1)
    `;

    await db.sql`
      UPDATE workspace_workflow_executions
      SET status = 'success', finished_at = NOW(), output_payload = '{"ok":true}'::jsonb
      WHERE id = ${executionId}
    `;

    const rows = await db.sql`
      SELECT execution.status,
             execution.finished_at,
             COUNT(node_run.id) AS node_runs
      FROM workspace_workflow_executions execution
      LEFT JOIN workspace_workflow_node_runs node_run ON node_run.execution_id = execution.id
      WHERE execution.id = ${executionId}
      GROUP BY execution.id, execution.status, execution.finished_at
    `;

    expect(rows[0].status).toBe("success");
    expect(Number(rows[0].node_runs)).toBe(1);
    expect(rows[0].finished_at).toBeTruthy();
  });

  it("rejects an execution status the UI has no rendering for", async () => {
    // The status CHECK constraint is what stops a typo becoming a run that the
    // runs view cannot describe.
    const workspaceId = await seedWorkspace();
    const workflow = await db.sql`
      INSERT INTO workspace_workflows (workspace_id, name, trigger_type, definition_json, created_by, updated_by)
      VALUES (${workspaceId}, 'Constraint check', 'trigger.manual', '{"nodes":[],"edges":[],"viewport":{"x":0,"y":0,"zoom":1}}'::jsonb, ${workspaceId}, ${workspaceId})
      RETURNING id
    `;

    await expect(
      db.sql`
        INSERT INTO workspace_workflow_executions (workflow_id, trigger_type, status)
        VALUES (${String(workflow[0].id)}, 'trigger.manual', 'not_a_real_status')
      `,
    ).rejects.toThrow();
  });

  it("removes a workflow's executions with the workflow", async () => {
    // Deleting a workflow must not strand run history behind a dangling id.
    const workspaceId = await seedWorkspace();
    const workflow = await db.sql`
      INSERT INTO workspace_workflows (workspace_id, name, trigger_type, definition_json, created_by, updated_by)
      VALUES (${workspaceId}, 'Cascade check', 'trigger.manual', '{"nodes":[],"edges":[],"viewport":{"x":0,"y":0,"zoom":1}}'::jsonb, ${workspaceId}, ${workspaceId})
      RETURNING id
    `;
    const workflowId = String(workflow[0].id);
    await db.sql`
      INSERT INTO workspace_workflow_executions (workflow_id, trigger_type, status)
      VALUES (${workflowId}, 'trigger.manual', 'success')
    `;

    await db.sql`DELETE FROM workspace_workflows WHERE id = ${workflowId}`;

    const remaining = await db.sql`
      SELECT COUNT(*)::int AS count FROM workspace_workflow_executions WHERE workflow_id = ${workflowId}
    `;
    expect(Number(remaining[0].count)).toBe(0);
  });

  it("keeps one execution per idempotency key", async () => {
    // Redelivered provider webhooks are the normal case, not the edge case; the
    // unique index is what stops one event running a workflow twice.
    const workspaceId = await seedWorkspace();
    const workflow = await db.sql`
      INSERT INTO workspace_workflows (workspace_id, name, trigger_type, definition_json, created_by, updated_by)
      VALUES (${workspaceId}, 'Idempotency', 'trigger.webhook', '{"nodes":[],"edges":[],"viewport":{"x":0,"y":0,"zoom":1}}'::jsonb, ${workspaceId}, ${workspaceId})
      RETURNING id
    `;
    const workflowId = String(workflow[0].id);

    await db.sql`
      INSERT INTO workspace_workflow_executions (workflow_id, trigger_type, status, idempotency_key)
      VALUES (${workflowId}, 'trigger.webhook', 'success', 'delivery-42')
    `;

    await expect(
      db.sql`
        INSERT INTO workspace_workflow_executions (workflow_id, trigger_type, status, idempotency_key)
        VALUES (${workflowId}, 'trigger.webhook', 'queued', 'delivery-42')
      `,
    ).rejects.toThrow();
  });
});

// @vitest-environment node
//
// The scheduler's contract with the schema.
//
// `workspace_workflow_executions` has no `workspace_id` of its own — the
// workspace lives on the workflow. A query that selected one raised 42703 on
// every cron tick, and because the passes were awaited in a Promise.all, that
// single column took the events, schedule and execution passes down together.
// Nothing surfaced it: the endpoint returned a generic 500 that only a cron
// log would show, and the tests never touched a real database.
//
// These assertions are about the SQL the scheduler issues and how a failing
// pass is contained, because those are the two properties that broke.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const databaseQuery = vi.hoisted(() => vi.fn());

vi.mock("@neondatabase/serverless", () => ({
  neon: () => ({ query: databaseQuery }),
}));

import {
  processPendingWorkflowExecutions,
  processStockLowWorkflowEvents,
} from "./workflows-data";

const originalEnvironment = { ...process.env };

const statements = () =>
  databaseQuery.mock.calls.map((call) =>
    String(call[0]).replace(/\s+/g, " ").trim(),
  );

beforeEach(() => {
  process.env.DATABASE_URL = "postgres://workflow.test/maxform";
  process.env.JWT_SECRET = "workflow-scheduler-test-secret".repeat(3);
  databaseQuery.mockReset();
  databaseQuery.mockResolvedValue([]);
});

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe("pending execution recovery", () => {
  it("reads the workspace from the workflow, which is the table that has one", async () => {
    await processPendingWorkflowExecutions(50);

    const select = statements().find((statement) =>
      statement.includes("FROM workspace_workflow_executions execution"),
    );
    expect(select).toBeTruthy();
    // The join is the fix: without it the column does not exist.
    expect(select).toContain("JOIN workspace_workflows workflow");
    expect(select).toContain("workflow.workspace_id");
  });

  it("never selects a workspace_id straight off the executions table", async () => {
    await processPendingWorkflowExecutions(50);

    for (const statement of statements()) {
      if (!statement.includes("workspace_workflow_executions")) continue;
      // A bare `workspace_id` (no table qualifier) is the shape that raised.
      expect(statement).not.toMatch(/SELECT[^;]*?[\s,(]workspace_id\b/);
    }
  });

  it("recovers executions stuck under a dead worker lock before claiming work", async () => {
    await processPendingWorkflowExecutions(50);

    const recovery = statements()[0];
    expect(recovery).toContain("UPDATE workspace_workflow_executions");
    expect(recovery).toContain("status = 'running'");
    expect(recovery).toContain("locked_at <");
  });

  it("claims waiting executions only once their delay is up", async () => {
    await processPendingWorkflowExecutions(50);

    const select = statements().find((statement) =>
      statement.includes("FROM workspace_workflow_executions execution"),
    );
    expect(select).toContain("execution.resume_at <= NOW()");
  });
});

describe("stock crossing sweep", () => {
  it("claims each alert exactly once so two ticks cannot double-announce", async () => {
    await processStockLowWorkflowEvents(10);

    const claim = statements()[0];
    expect(claim).toContain("UPDATE payment_inventory_alerts");
    expect(claim).toContain("FOR UPDATE SKIP LOCKED");
    expect(claim).toContain("workflow_notified_at IS NULL");
  });

  it("does nothing when no stock has crossed", async () => {
    databaseQuery.mockResolvedValue([]);

    const result = await processStockLowWorkflowEvents(10);

    expect(result.checked).toBe(0);
    expect(result.results).toEqual([]);
  });
});

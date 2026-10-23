import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { WorkflowRunsView } from "@/components/workflows/WorkflowRunsView";
import type { WorkflowExecution } from "@/lib/workflows";

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn();
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});

const run = (over: Partial<WorkflowExecution> = {}): WorkflowExecution => ({
  id: "run-1",
  workflowId: "workflow-1",
  workflowVersionId: null,
  triggerType: "trigger.form_submission",
  status: "success",
  triggerPayload: { email: "a@example.com" },
  outputPayload: { completedNodes: 2 },
  error: {},
  idempotencyKey: "",
  requestedBy: null,
  startedAt: "2026-08-11T10:00:00.000Z",
  finishedAt: "2026-08-11T10:00:02.000Z",
  createdAt: "2026-08-11T10:00:00.000Z",
  durationMs: 2000,
  ...over,
});

const renderRuns = (
  over: Partial<Parameters<typeof WorkflowRunsView>[0]> = {},
) =>
  render(
    <WorkflowRunsView
      executions={[run()]}
      loading={false}
      selected={null}
      onSelect={vi.fn()}
      onRetry={vi.fn()}
      onRefresh={vi.fn()}
      {...over}
    />,
  );

describe("run history", () => {
  it("separates never-run from a failed load", () => {
    const { unmount } = renderRuns({ executions: [] });
    expect(screen.getByText("No runs yet")).toBeInTheDocument();
    unmount();

    renderRuns({ executions: [], error: "Executions could not be loaded." });
    // An empty list after a failure would read as "this never ran".
    expect(screen.getByText("Runs could not be loaded")).toBeInTheDocument();
    expect(screen.queryByText("No runs yet")).toBeNull();
  });

  it("offers a retry when the history fails to load", () => {
    const onRefresh = vi.fn();
    renderRuns({ executions: [], error: "Executions could not be loaded.", onRefresh });

    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRefresh).toHaveBeenCalled();
  });

  it("filters by status without hiding that a filter is on", () => {
    renderRuns({ executions: [run(), run({ id: "run-2", status: "error" })] });

    fireEvent.click(screen.getByLabelText("Status"));
    fireEvent.click(screen.getByRole("option", { name: "Failed" }));

    expect(screen.getAllByText("error", { exact: false }).length).toBeGreaterThan(0);
    expect(screen.queryByText("No runs yet")).toBeNull();
  });

  it("says the filter is empty rather than claiming nothing ever ran", () => {
    renderRuns({ executions: [run()] });

    fireEvent.click(screen.getByLabelText("Status"));
    fireEvent.click(screen.getByRole("option", { name: "Canceled" }));

    expect(screen.getByText("No runs match this filter")).toBeInTheDocument();
  });

  it("pages long histories instead of scrolling every run ever", () => {
    const many = Array.from({ length: 24 }, (_, index) =>
      run({ id: `run-${index}` }),
    );
    renderRuns({ executions: many });

    expect(screen.getByText("24 runs recorded for this workflow")).toBeInTheDocument();
    // 10 a page, matching the rest of the dashboard.
    expect(screen.getByLabelText("runs pagination")).toBeInTheDocument();
  });

  it("prompts for a selection before showing run detail", () => {
    renderRuns();
    expect(screen.getByText("Select a run")).toBeInTheDocument();
  });

  it("shows the failure reason and a retry for a failed run", () => {
    const onRetry = vi.fn();
    const failed = run({
      status: "error",
      error: { message: "The HTTP step timed out." },
    });
    renderRuns({ executions: [failed], selected: failed, onRetry });

    // Shown twice by design: once on the row so a failure is scannable without
    // opening it, and once in the detail panel.
    expect(screen.getAllByText("The HTTP step timed out.")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /retry this run/i }));
    expect(onRetry).toHaveBeenCalledWith(failed);
  });

  it("does not offer a retry for a run that succeeded", () => {
    const ok = run();
    renderRuns({ executions: [ok], selected: ok });
    expect(screen.queryByRole("button", { name: /retry this run/i })).toBeNull();
  });

  it("names each node in the trace, not just its type", () => {
    const traced = run({
      nodeRuns: [
        {
          id: "node-run-1",
          executionId: "run-1",
          nodeId: "send-email-1",
          nodeType: "action.send_workspace_email",
          status: "success",
          input: {},
          output: {},
          error: {},
          attempt: 2,
          startedAt: null,
          finishedAt: null,
        },
      ],
    });
    renderRuns({ executions: [traced], selected: traced });

    expect(screen.getByText("send-email-1")).toBeInTheDocument();
    // The attempt count is what tells you a step was retried.
    expect(screen.getByText(/attempt 2/)).toBeInTheDocument();
  });
});

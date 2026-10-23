import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { WorkflowsModule } from "@/components/workflows/WorkflowsModule";

/**
 * The app mounts this module inside the dashboard's QueryClientProvider, so
 * the test does too. Retries are off: a failed query should surface its error
 * state immediately rather than being retried past the assertion.
 */
const renderModule = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <WorkflowsModule />
    </QueryClientProvider>,
  );
};

describe("WorkflowsModule", () => {
  it("keeps the cross-module workflow surface separate from form automation", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: true, json: async () => ({ value: [] }) })));
    renderModule();

    expect(screen.getByRole("region", { name: "Workflows" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: /^Workflows$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^create workflow$/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Workflows" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Executions" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Checks" })).toBeInTheDocument();
    // The editor edits one workflow, so it is reached by opening a row rather
    // than being a destination you can land on with nothing selected.
    expect(screen.queryByRole("tab", { name: "Editor" })).toBeNull();
    expect(screen.getByText(/form automations remain safely inside forms/i)).toBeInTheDocument();
    expect(screen.queryByText("Form automations", { exact: true })).toBeNull();
    fireEvent.keyDown(screen.getByRole("tab", { name: "Overview" }), { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Workflows" })).toHaveAttribute("aria-selected", "true");
    vi.unstubAllGlobals();
  });

  it("shows the editor, execution history, and evaluation tabs for a workflow", async () => {
    const workflow = {
      id: "workflow-1",
      name: "Signup routing",
      description: "",
      status: "draft",
      enabled: false,
      triggerType: "trigger.manual",
      currentVersion: 1,
      definition: {
        nodes: [{ id: "trigger-1", type: "trigger.manual", name: "Run manually", position: { x: 90, y: 150 }, parameters: {}, onError: "stop" }],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      },
      webhookKey: "",
      createdAt: "2026-08-11T10:00:00.000Z",
      updatedAt: "2026-08-11T10:00:00.000Z",
      stats: { executions: 0, successes: 0, failures: 0, lastRunAt: null, lastRunStatus: null },
    };
    const googleConnection = {
      id: "11111111-1111-4111-8111-111111111111",
      provider: "google_workspace",
      providerName: "Google Workspace",
      label: "workspace@example.com",
      status: "connected",
      capabilities: ["email.send", "spreadsheet.write"],
      grantedScopes: ["https://www.googleapis.com/auth/gmail.send"],
    };
    vi.stubGlobal("fetch", vi.fn((_input, init?: RequestInit) => {
      const operation = JSON.parse(String(init?.body || "{}")).operation;
      const value = operation === "listWorkflows"
        ? [workflow]
        : operation === "listWorkflowsPage"
          ? { workflows: [workflow], page: 1, pageSize: 10, total: 1, pageCount: 1 }
          // Opening a workflow re-reads the full record before the editor
          // mounts, so the preloader has something real to wait on.
          : operation === "getWorkflow"
            ? workflow
            : operation === "listWorkflowConnections"
              ? [googleConnection]
              : [];
      return Promise.resolve({ ok: true, json: async () => ({ value }) });
    }));

    renderModule();

    expect(await screen.findByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    // Into the editor the way a user gets there: open a workflow from the list.
    // The module is heavy enough that the list lands well past RTL's 1s default.
    fireEvent.click(screen.getByRole("tab", { name: "Workflows" }));
    fireEvent.click(
      await screen.findByText("Signup routing", {}, { timeout: 6000 }),
    );
    expect(await screen.findByText("Node library")).toBeInTheDocument();
    // Validate and Run belong to the workflow being edited, so they appear here.
    expect(screen.getByRole("button", { name: /validate/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^run$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /back to workflows/i })).toBeInTheDocument();
    expect(await screen.findByText("Connected providers")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add Google Workspace action" }));
    expect(await screen.findByDisplayValue("Send Gmail message")).toBeInTheDocument();
    expect(document.querySelector('img[src="/images/integrations/gmail.svg"]')).toBeInTheDocument();

    // The editor opens full-screen, so the module's tab strip is deliberately
    // out of the way until the workspace is restored.
    expect(screen.queryByRole("tab", { name: "Executions" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /exit full screen/i }));
    expect(await screen.findByRole("tab", { name: "Executions" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Checks" })).toBeInTheDocument();
    // Restoring keeps the editor mounted rather than dropping the canvas.
    expect(screen.getByText("Node library")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Executions" }));
    expect(await screen.findByText("Execution history")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Checks" }));
    expect(await screen.findByText("Regression checks")).toBeInTheDocument();

    vi.unstubAllGlobals();
    // This renders the whole module, the listing, and the editor with its full
    // node library, twice over. In jsdom that is slow on its own and slower
    // again when the suite runs 90 files in parallel; the assertions are not
    // what costs the time.
  }, 120_000);
});

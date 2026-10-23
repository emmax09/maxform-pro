import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// The Toaster lives in the app shell, not here, so the notification is
// asserted at the call rather than by rendering a portal this tree lacks.
const toasts = vi.hoisted(() => ({
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: toasts }));

import { WorkflowsListing } from "@/components/workflows/WorkflowsListing";

// Radix Select drives its listbox through pointer capture and scrolls the
// active option into view; jsdom implements neither, so the dropdown throws on
// open without these. Kept per-file, as the other suites do.
beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn();
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});

type Operation = { operation: string; args: Record<string, unknown> };

const workflow = (over: Record<string, unknown> = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  name: "Signup routing",
  description: "Route new signups to the right list",
  status: "published",
  enabled: true,
  triggerType: "trigger.form_submission",
  currentVersion: 2,
  publishedVersion: 2,
  revision: 4,
  definition: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
  webhookKey: "",
  createdAt: "2026-07-01T10:00:00.000Z",
  updatedAt: "2026-08-01T10:00:00.000Z",
  stats: {
    executions: 20,
    successes: 19,
    failures: 1,
    lastRunAt: "2026-08-11T10:00:00.000Z",
    lastRunStatus: "success",
  },
  ...over,
});

/** Captures every operation the screen issues so filters can be asserted. */
const stubApi = (
  handler: (call: Operation) => unknown,
  calls: Operation[] = [],
) => {
  vi.stubGlobal(
    "fetch",
    vi.fn((_input: unknown, init?: RequestInit) => {
      const call = JSON.parse(String(init?.body || "{}")) as Operation;
      calls.push(call);
      return Promise.resolve({
        ok: true,
        json: async () => ({ value: handler(call) }),
      });
    }),
  );
  return calls;
};

const renderListing = (props: Partial<Parameters<typeof WorkflowsListing>[0]> = {}) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <WorkflowsListing onOpen={vi.fn()} onCreate={vi.fn()} {...props} />
    </QueryClientProvider>,
  );
};

const defaultHandler = (call: Operation) => {
  if (call.operation === "listWorkflowsPage") {
    return {
      workflows: [workflow()],
      page: 1,
      pageSize: 10,
      total: 1,
      pageCount: 1,
    };
  }
  if (call.operation === "listWorkflowTriggerFacets") {
    return [{ triggerType: "trigger.form_submission", workflows: 1 }];
  }
  return [];
};

afterEach(() => {
  vi.unstubAllGlobals();
  toasts.success.mockClear();
  toasts.warning.mockClear();
  toasts.error.mockClear();
});

describe("workflow listing", () => {
  it("shows each workflow's state and reliability", async () => {
    stubApi(defaultHandler);
    renderListing();

    expect(await screen.findByText("Signup routing")).toBeInTheDocument();
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.getByText("95%")).toBeInTheDocument();
    // The denominator travels with the rate so a small sample cannot read as
    // authoritative as a large one.
    expect(screen.getByText("of 20")).toBeInTheDocument();
  });

  it("distinguishes a published workflow that is switched off", async () => {
    stubApi((call) =>
      call.operation === "listWorkflowsPage"
        ? {
            workflows: [workflow({ enabled: false })],
            page: 1,
            pageSize: 10,
            total: 1,
            pageCount: 1,
          }
        : defaultHandler(call),
    );
    renderListing();

    // "Published" alone would imply it is running.
    expect(await screen.findByText("Published, off")).toBeInTheDocument();
  });

  it("asks the server for 10 rows a page rather than filtering in the browser", async () => {
    const calls = stubApi(defaultHandler);
    renderListing();

    await screen.findByText("Signup routing");
    const list = calls.find((call) => call.operation === "listWorkflowsPage");
    expect((list?.args.filters as Record<string, unknown>).pageSize).toBe(10);
  });

  it("pushes the status filter to the server", async () => {
    const calls = stubApi(defaultHandler);
    renderListing();
    await screen.findByText("Signup routing");

    fireEvent.click(screen.getByRole("combobox", { name: /status/i }));
    fireEvent.click(await screen.findByRole("option", { name: "Paused" }));

    await waitFor(() => {
      const filtered = calls.filter(
        (call) =>
          call.operation === "listWorkflowsPage" &&
          (call.args.filters as Record<string, unknown>).status === "paused",
      );
      expect(filtered.length).toBeGreaterThan(0);
    });
  });

  it("only offers providers the workspace has actually connected", async () => {
    stubApi((call) =>
      call.operation === "listWorkflowConnections"
        ? [
            {
              id: "22222222-2222-4222-8222-222222222222",
              provider: "slack",
              providerName: "Slack",
              label: "team",
              status: "connected",
              capabilities: [],
              grantedScopes: [],
            },
          ]
        : defaultHandler(call),
    );
    renderListing();
    await screen.findByText("Signup routing");

    fireEvent.click(screen.getByRole("combobox", { name: /provider/i }));
    expect(await screen.findByRole("option", { name: "Slack" })).toBeInTheDocument();
    // Nothing else is connected, so nothing else can be filtered for.
    expect(screen.queryByRole("option", { name: "Google Workspace" })).toBeNull();
  });

  it("confirms before deleting and sends the selection once confirmed", async () => {
    const calls = stubApi((call) =>
      call.operation === "bulkWorkflowAction"
        ? { action: "delete", succeeded: 1, failed: 0, failures: [] }
        : defaultHandler(call),
    );
    renderListing();
    await screen.findByText("Signup routing");

    fireEvent.click(screen.getByRole("checkbox", { name: /select signup routing/i }));
    // Radix opens its menu on keyboard activation in jsdom, not a synthetic click.
    fireEvent.keyDown(screen.getByRole("button", { name: /bulk actions/i }), {
      key: "Enter",
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: /delete/i }));

    // Nothing is sent on the menu click alone.
    expect(calls.some((call) => call.operation === "bulkWorkflowAction")).toBe(false);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/delete 1 workflow\?/i)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      const bulk = calls.find((call) => call.operation === "bulkWorkflowAction");
      expect(bulk?.args.action).toBe("delete");
      expect(bulk?.args.workflowIds).toEqual([
        "11111111-1111-4111-8111-111111111111",
      ]);
    });
  });

  it("cancelling the confirmation sends nothing", async () => {
    const calls = stubApi(defaultHandler);
    renderListing();
    await screen.findByText("Signup routing");

    fireEvent.click(screen.getByRole("checkbox", { name: /select signup routing/i }));
    // Radix opens its menu on keyboard activation in jsdom, not a synthetic click.
    fireEvent.keyDown(screen.getByRole("button", { name: /bulk actions/i }), {
      key: "Enter",
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: /delete/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(calls.some((call) => call.operation === "bulkWorkflowAction")).toBe(false);
  });

  it("names the workflow that could not be activated instead of saying 'some failed'", async () => {
    stubApi((call) =>
      call.operation === "bulkWorkflowAction"
        ? {
            action: "activate",
            succeeded: 1,
            failed: 1,
            failures: [
              {
                workflowId: "33333333-3333-4333-8333-333333333333",
                name: "Broken flow",
                error: "Fix 2 issue(s) before turning this workflow on.",
              },
            ],
          }
        : defaultHandler(call),
    );
    renderListing();
    await screen.findByText("Signup routing");

    fireEvent.click(screen.getByRole("checkbox", { name: /select signup routing/i }));
    // Radix opens its menu on keyboard activation in jsdom, not a synthetic click.
    fireEvent.keyDown(screen.getByRole("button", { name: /bulk actions/i }), {
      key: "Enter",
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: /activate/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Activate" }));

    await waitFor(() => {
      expect(toasts.warning).toHaveBeenCalled();
    });
    const [message] = toasts.warning.mock.calls[0] as [string];
    // "1 could not be activated" is not actionable; the name and reason are.
    expect(message).toContain("Broken flow");
    expect(message).toContain("Fix 2 issue(s)");
  });

  it("offers row actions behind a single overflow menu", async () => {
    stubApi(defaultHandler);
    const onOpen = vi.fn();
    renderListing({ onOpen });
    await screen.findByText("Signup routing");

    fireEvent.keyDown(
      screen.getByRole("button", { name: /actions for signup routing/i }),
      { key: "Enter" },
    );

    expect(
      await screen.findByRole("menuitem", { name: /open in editor/i }),
    ).toBeInTheDocument();
    // This one is live, so turning it off is the action that means something.
    expect(screen.getByRole("menuitem", { name: /turn off/i })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /^activate$/i })).toBeNull();
    expect(screen.getByRole("menuitem", { name: /duplicate/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /delete/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: /open in editor/i }));
    expect(onOpen).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
  });

  it("offers activate on a workflow that is not live", async () => {
    stubApi((call) =>
      call.operation === "listWorkflowsPage"
        ? {
            workflows: [workflow({ status: "draft", enabled: false })],
            page: 1,
            pageSize: 10,
            total: 1,
            pageCount: 1,
          }
        : defaultHandler(call),
    );
    renderListing();
    await screen.findByText("Signup routing");

    fireEvent.keyDown(
      screen.getByRole("button", { name: /actions for signup routing/i }),
      { key: "Enter" },
    );

    expect(
      await screen.findByRole("menuitem", { name: /^activate$/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /turn off/i })).toBeNull();
  });

  it("confirms a single-row delete the same way a bulk delete is confirmed", async () => {
    const calls = stubApi((call) =>
      call.operation === "bulkWorkflowAction"
        ? { action: "delete", succeeded: 1, failed: 0, failures: [] }
        : defaultHandler(call),
    );
    renderListing();
    await screen.findByText("Signup routing");

    fireEvent.keyDown(
      screen.getByRole("button", { name: /actions for signup routing/i }),
      { key: "Enter" },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: /delete/i }));

    expect(calls.some((call) => call.operation === "bulkWorkflowAction")).toBe(false);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      const bulk = calls.find((call) => call.operation === "bulkWorkflowAction");
      expect(bulk?.args.workflowIds).toEqual([
        "11111111-1111-4111-8111-111111111111",
      ]);
    });
  });

  it("separates an empty workspace from an over-filtered one", async () => {
    stubApi((call) =>
      call.operation === "listWorkflowsPage"
        ? { workflows: [], page: 1, pageSize: 10, total: 0, pageCount: 1 }
        : defaultHandler(call),
    );
    renderListing();

    expect(await screen.findByText("No workflows yet")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: /search workflows/i }), {
      target: { value: "nothing matches this" },
    });

    // Telling someone with filters on that they have no workflows sends them
    // to build one they already have.
    expect(
      await screen.findByText("No workflows match these filters"),
    ).toBeInTheDocument();
  });

  it("surfaces a failed load rather than showing an empty table", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          json: async () => ({ error: "Workflows could not be loaded." }),
        }),
      ),
    );
    renderListing();

    expect(
      await screen.findByText("Workflows could not be loaded."),
    ).toBeInTheDocument();
    expect(screen.queryByText("No workflows yet")).toBeNull();
  });
});

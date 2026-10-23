import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { WorkflowsAnalytics } from "@/components/workflows/WorkflowsAnalytics";

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn();
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});

const empty = {
  days: 30,
  workflows: { total: 0, active: 0, draft: 0, paused: 0, archived: 0 },
  runs: {
    total: 0,
    success: 0,
    failed: 0,
    pending: 0,
    canceled: 0,
    successRate: 0,
    failureRate: 0,
    averageMs: 0,
  },
  trend: [],
  mostActive: [],
  highestFailureRate: [],
  recentActivity: [],
};

const populated = {
  ...empty,
  workflows: { total: 4, active: 2, draft: 1, paused: 1, archived: 0 },
  runs: {
    total: 28,
    success: 25,
    failed: 3,
    pending: 1,
    canceled: 0,
    successRate: 89.3,
    failureRate: 10.7,
    averageMs: 1450,
  },
  trend: [{ day: "2026-08-01", runs: 4, success: 3, error: 1 }],
  mostActive: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Signup routing",
      status: "published",
      runs: 20,
      failures: 1,
      failureRate: 5,
    },
  ],
  highestFailureRate: [
    {
      id: "22222222-2222-4222-8222-222222222222",
      name: "Low stock alert",
      status: "published",
      runs: 8,
      failures: 2,
      failureRate: 25,
    },
  ],
  recentActivity: [
    {
      id: "run-1",
      workflowId: "11111111-1111-4111-8111-111111111111",
      workflowName: "Signup routing",
      status: "success",
      triggerType: "trigger.form_submission",
      createdAt: new Date(Date.now() - 3_600_000).toISOString(),
      finishedAt: "",
    },
  ],
};

type Call = { operation: string; args: Record<string, unknown> };

const stub = (value: unknown, calls: Call[] = []) => {
  vi.stubGlobal(
    "fetch",
    vi.fn((_input: unknown, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body || "{}")) as Call);
      return Promise.resolve({ ok: true, json: async () => ({ value }) });
    }),
  );
  return calls;
};

const renderAnalytics = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <WorkflowsAnalytics onOpen={vi.fn()} />
    </QueryClientProvider>,
  );
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("automation analytics", () => {
  it("reports workflow and run counts from the workspace's own data", async () => {
    stub(populated);
    renderAnalytics();

    expect(await screen.findByText("89.3%")).toBeInTheDocument();
    expect(screen.getByText("10.7%")).toBeInTheDocument();
    expect(screen.getByText("25 succeeded")).toBeInTheDocument();
    expect(screen.getByText("2 active · 1 draft · 1 paused")).toBeInTheDocument();
  });

  it("names both chart series rather than leaving the failure line unexplained", async () => {
    stub(populated);
    renderAnalytics();

    await screen.findByText("89.3%");
    expect(screen.getByText("Succeeded")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("shows a dash instead of 0% when nothing has run", async () => {
    stub(empty);
    renderAnalytics();

    // A 0% success rate reads as "everything failed"; nothing ran at all.
    expect(await screen.findAllByText("—")).toHaveLength(2);
    expect(screen.getAllByText("No runs yet").length).toBeGreaterThan(0);
    expect(screen.getByText("No runs in this period.")).toBeInTheDocument();
  });

  it("says nothing is failing rather than showing an empty ranked list", async () => {
    stub(empty);
    renderAnalytics();

    expect(
      await screen.findByText("Nothing is failing repeatedly."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Nothing has run yet. Publish a workflow and its runs appear here."),
    ).toBeInTheDocument();
  });

  it("asks the server for the selected range instead of filtering locally", async () => {
    const calls = stub(populated);
    renderAnalytics();
    await screen.findByText("89.3%");

    fireEvent.click(screen.getByLabelText("Date range"));
    fireEvent.click(await screen.findByRole("option", { name: "Last 7 days" }));

    await vi.waitFor(() => {
      expect(
        calls.some(
          (call) =>
            call.operation === "getWorkflowAnalytics" && call.args.days === 7,
        ),
      ).toBe(true);
    });
  });

  it("offers a retry when analytics cannot be read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          json: async () => ({ error: "Analytics are unavailable." }),
        }),
      ),
    );
    renderAnalytics();

    expect(await screen.findByText("Analytics are unavailable.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });
});

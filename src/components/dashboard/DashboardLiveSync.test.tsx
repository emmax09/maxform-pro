import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DASHBOARD_LIVE_SYNC_INTERVAL_MS,
  DashboardLiveSync,
} from "@/components/dashboard/DashboardLiveSync";

const queryFn = vi.fn(async () => ({ updatedAt: Date.now() }));

function ActiveWorkspaceQuery() {
  useQuery({
    queryKey: ["live-test", "workspace"],
    queryFn,
    staleTime: Number.POSITIVE_INFINITY,
  });
  return null;
}

const renderSync = (userId?: string) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <DashboardLiveSync userId={userId} />
      <ActiveWorkspaceQuery />
    </QueryClientProvider>,
  );
  return queryClient;
};

afterEach(() => {
  queryFn.mockClear();
  vi.useRealTimers();
});

describe("DashboardLiveSync", () => {
  it("refreshes active workspace queries without requiring a remount", async () => {
    vi.useFakeTimers();
    renderSync("user-1");

    await act(async () => {
      await Promise.resolve();
    });
    expect(queryFn).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DASHBOARD_LIVE_SYNC_INTERVAL_MS);
    });

    expect(queryFn).toHaveBeenCalledTimes(2);
  });

  it("does not start a dashboard sync without an authenticated workspace", async () => {
    vi.useFakeTimers();
    renderSync();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DASHBOARD_LIVE_SYNC_INTERVAL_MS * 2);
    });

    expect(queryFn).toHaveBeenCalledTimes(1);
  });
});

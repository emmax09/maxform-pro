import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  MemoryRouter,
  useLocation,
} from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationCenter } from "@/components/dashboard/NotificationCenter";

const response = (value: unknown, ok = true) =>
  ({
    json: async () => value,
    ok,
  }) as Response;

function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location">
      {location.pathname}
      {location.search}
    </div>
  );
}

const renderCenter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  return render(
    <MemoryRouter
      initialEntries={["/dashboard"]}
    >
      <QueryClientProvider client={queryClient}>
        <NotificationCenter userId="11111111-1111-4111-8111-111111111111" />
        <LocationProbe />
      </QueryClientProvider>
    </MemoryRouter>,
  );
};

beforeEach(() => {
  localStorage.setItem("access_token", "test-token");
});

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("NotificationCenter", () => {
  it("shows a real empty state without placeholder notifications", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({
          notifications: [],
          unreadCount: 0,
        }),
      ),
    );

    renderCenter();
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));

    expect(await screen.findByText("No notifications yet")).toBeInTheDocument();
    expect(
      screen.getByText(/Real form responses, payments, event registrations/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/800 responses/i)).not.toBeInTheDocument();
  });

  it("marks an unread notification and navigates to its live destination", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("action=read")) {
          return response({
            notification: {
              id: "22222222-2222-4222-8222-222222222222",
              readAt: "2026-07-29T12:01:00.000Z",
            },
          });
        }
        return response({
          notifications: [
            {
              actionUrl: "/dashboard?tab=payments&section=orders",
              createdAt: "2026-07-29T12:00:00.000Z",
              id: "22222222-2222-4222-8222-222222222222",
              kind: "payment_received",
              message: "Order MF-1042 was confirmed.",
              metadata: {},
              priority: "success",
              readAt: null,
              title: "Payment received",
            },
          ],
          unreadCount: 1,
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderCenter();
    const trigger = await screen.findByRole("button", {
      name: "Notifications, 1 unread",
    });
    fireEvent.click(trigger);
    fireEvent.click(
      await screen.findByRole("button", { name: /Payment received/i }),
    );

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/dashboard?tab=payments&section=orders",
      ),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("action=read"),
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("clears visible notifications from the dropdown", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("action=clear-all")) {
          return response({ cleared: 1 });
        }
        return response({
          notifications: [
            {
              actionUrl: "/dashboard?tab=forms&section=responses",
              createdAt: "2026-07-29T12:00:00.000Z",
              id: "33333333-3333-4333-8333-333333333333",
              kind: "form_submission",
              message: "A new response was submitted.",
              metadata: {},
              priority: "info",
              readAt: "2026-07-29T12:01:00.000Z",
              title: "New form response",
            },
          ],
          unreadCount: 0,
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    renderCenter();
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
    fireEvent.click(await screen.findByRole("button", { name: "Clear all" }));

    expect(await screen.findByText("No notifications yet")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("action=clear-all"),
      expect.objectContaining({ method: "POST" }),
    );
  });
});

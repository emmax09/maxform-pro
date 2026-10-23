// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import type { UsageStats } from "@/lib/settings";

const getUsageStats = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "11111111-1111-4111-8111-111111111111" },
  }),
}));

vi.mock("@/lib/settings", async () => {
  const actual = await vi.importActual<typeof import("@/lib/settings")>(
    "@/lib/settings",
  );
  return { ...actual, getUsageStats: (...args: unknown[]) => getUsageStats(...args) };
});

const { BillingSection } = await import("@/pages/Settings");

const GB = 1024 * 1024 * 1024;

const usage = (overrides: Partial<UsageStats> = {}): UsageStats => ({
  forms: 3,
  responses: 12480,
  workflows: 6,
  contacts: 940,
  subscription: {
    plan: "starter",
    status: "active",
    periodStart: "2026-07-01T00:00:00.000Z",
    periodEnd: "2026-08-01T00:00:00.000Z",
    extraStorageBytes: 0,
    extraEmails: 0,
    cancelAtPeriodEnd: false,
  },
  storage: { usedBytes: 4 * GB },
  emails: { sent: 1200, ownProvider: 1200 },
  credits: {
    balance: 1500,
    spentThisPeriod: 500,
    purchased: 0,
    breakdown: [],
  },
  billingHistory: [],
  ...overrides,
});

const renderBilling = async (stats: UsageStats, planName = "Starter") => {
  getUsageStats.mockResolvedValue(stats);
  render(
    <MemoryRouter>
      <BillingSection />
    </MemoryRouter>,
  );
  await screen.findByText(planName);
};

/** The big number under "credits available". */
const creditsAvailable = () =>
  screen.getByText("credits available").previousElementSibling?.textContent;

describe("billing and usage", () => {
  it("shows the plan and the allowances it includes", async () => {
    await renderBilling(usage());

    expect(screen.getByText("Starter")).toBeInTheDocument();
    expect(screen.getByText("$5.99 per month")).toBeInTheDocument();
    // Starter includes 2,000 AI credits, 10 GB, and 5,000 emails.
    expect(screen.getByText("2,000 included")).toBeInTheDocument();
    expect(screen.getByText("10 GB included")).toBeInTheDocument();
    expect(screen.getByText("5,000 included")).toBeInTheDocument();
  });

  it("derives credits available from the plan grant, packs, and spend", async () => {
    await renderBilling(
      usage({
        credits: {
          balance: 0,
          spentThisPeriod: 500,
          purchased: 1000,
          breakdown: [{ action: "Generate a form", credits: 500, runs: 50 }],
        },
      }),
    );

    // 2,000 included + 1,000 purchased - 500 spent.
    expect(creditsAvailable()).toBe("2,500");
    expect(screen.getByText("Included with plan")).toBeInTheDocument();
    expect(screen.getByText("Purchased packs")).toBeInTheDocument();
    expect(screen.getByText("Used this period")).toBeInTheDocument();
    expect(screen.getByText("Generate a form")).toBeInTheDocument();
  });

  it("never reports negative credits when spend passes the allowance", async () => {
    await renderBilling(
      usage({
        credits: {
          balance: -400,
          spentThisPeriod: 2400,
          purchased: 0,
          breakdown: [],
        },
      }),
    );

    expect(creditsAvailable()).toBe("0");
    expect(screen.getByText("Allowance used in full")).toBeInTheDocument();
  });

  it("adds purchased storage to the plan quota", async () => {
    await renderBilling(
      usage({
        storage: { usedBytes: 12 * GB },
        subscription: {
          ...usage().subscription,
          extraStorageBytes: 50 * GB,
        },
      }),
    );

    // 10 GB plan + 50 GB add-on.
    expect(screen.getByText("60 GB included")).toBeInTheDocument();
    expect(screen.getByText("48 GB left this period")).toBeInTheDocument();
  });

  it("presents responses and contacts as never counted", async () => {
    await renderBilling(usage());

    expect(screen.getByText("12,480")).toBeInTheDocument();
    expect(screen.getByText("940")).toBeInTheDocument();
    expect(
      screen.getByText("Form responses · never metered"),
    ).toBeInTheDocument();
    expect(screen.getByText("Contacts · never metered")).toBeInTheDocument();
  });

  it("explains that the form limit is not a response limit", async () => {
    await renderBilling(usage());

    expect(
      screen.getByText(/never on how many responses they can collect/i),
    ).toBeInTheDocument();
  });

  it("shows an unlimited plan without meters", async () => {
    await renderBilling(
      usage({
        subscription: { ...usage().subscription, plan: "enterprise" },
      }),
      "Enterprise",
    );

    expect(creditsAvailable()).toBe("Unlimited");
    // Nothing is metered, so no allowance bar is drawn.
    expect(screen.queryByText(/left this period/i)).not.toBeInTheDocument();
  });

  it("shows a real empty state instead of invented billing history", async () => {
    await renderBilling(usage());

    expect(screen.getByText("No transactions yet")).toBeInTheDocument();
  });
});

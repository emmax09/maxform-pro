import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  CampaignAnalyticsPanel,
  type CampaignAnalyticsData,
} from "./CampaignAnalyticsPanel";

const analytics: CampaignAnalyticsData = {
  campaign: {
    id: "campaign-1",
    name: "August update",
    listId: "list-1",
    listName: "Subscribers",
    excludeListId: null,
    excludeListName: "",
    subject: "The August update",
    previewText: "A short update",
    htmlBody: "<p>Actual email</p>",
    blocks: [],
    category: "newsletter",
    status: "sent",
    sendStrategy: "immediate",
    recurrenceRule: "",
    recurrenceRequiresReview: true,
    scheduledAt: null,
    sentAt: "2026-08-01T09:00:00.000Z",
    archivedAt: null,
    spamScore: 4,
    revenueAttributed: 0,
    revenueCurrency: "NGN",
    aiGenerated: false,
    identityId: null,
    stats: { sent: 10, opened: 4, clicked: 2 },
    createdAt: "2026-08-01T08:00:00.000Z",
    updatedAt: "2026-08-01T09:00:00.000Z",
  },
  totals: {
    recipients: 10,
    sent: 10,
    delivered: 10,
    uniqueOpens: 4,
    totalOpens: 5,
    uniqueClicks: 2,
    totalClicks: 2,
    bounced: 0,
    complained: 0,
    failed: 0,
    queued: 0,
    unsubscribed: 0,
  },
  devices: [],
  clients: [],
  revenue: { orders: 0, amount: 0, currency: "NGN" },
  variants: [],
};

describe("CampaignAnalyticsPanel", () => {
  it("shows the selected campaign analytics without rendering an email preview", () => {
    render(
      <CampaignAnalyticsPanel
        analytics={analytics}
        clickMap={[]}
        loading={false}
      />,
    );

    expect(screen.getByText("August update")).toBeInTheDocument();
    expect(screen.getByText("Campaign analytics")).toBeInTheDocument();
    expect(screen.queryByText("The message that sent")).not.toBeInTheDocument();
    expect(screen.queryByText("Actual email")).not.toBeInTheDocument();
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ContactCampaign } from "@/lib/contacts";

import { CampaignsTable } from "./CampaignsTable";

const campaign = (id: string, status: ContactCampaign["status"]): ContactCampaign => ({
  id,
  name: `Campaign ${id}`,
  listId: "",
  listName: "Custom emails (1)",
  listIds: [],
  audienceMode: "custom",
  customRecipients: [`${id}@example.test`],
  excludeListId: null,
  excludeListName: "",
  subject: "A campaign subject",
  previewText: "Preview",
  htmlBody: "<p>Hello</p>",
  blocks: [],
  category: "newsletter",
  status,
  sendStrategy: "scheduled",
  recurrenceRule: "",
  recurrenceRequiresReview: true,
  scheduledAt: null,
  sendStartedAt: null,
  sentAt: status === "sent" ? new Date().toISOString() : null,
  archivedAt: null,
  spamScore: null,
  revenueAttributed: 0,
  revenueCurrency: "USD",
  aiGenerated: false,
  identityId: null,
  stats: { recipients: 1, sent: status === "sent" ? 1 : 0, opened: 0, clicked: 0 },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

const renderTable = (
  onBulkDelete: (items: ContactCampaign[]) => void,
  campaigns = [campaign("draft", "draft"), campaign("sent", "sent")],
  onSendNow: (item: ContactCampaign) => void = vi.fn(),
  options: { sendNowCampaignId?: string | null; working?: boolean } = {},
) =>
  render(
    <CampaignsTable
      campaigns={campaigns}
      categoryFilter="all"
      onArchive={vi.fn()}
      onBulkArchive={vi.fn()}
      onBulkDelete={onBulkDelete}
      onBulkPause={vi.fn()}
      onBulkResume={vi.fn()}
      onCategoryFilterChange={vi.fn()}
      onDelete={vi.fn()}
      onDuplicate={vi.fn()}
      onDuplicateAndEdit={vi.fn()}
      onEdit={vi.fn()}
      onOpenAnalytics={vi.fn()}
      onPause={vi.fn()}
      onResume={vi.fn()}
      onSearchChange={vi.fn()}
      onSendNow={onSendNow}
      onSendTest={vi.fn()}
      onStatusFilterChange={vi.fn()}
      search=""
      sendNowCampaignId={options.sendNowCampaignId}
      statusFilter="all"
      working={options.working ?? false}
    />,
  );

describe("CampaignsTable selection", () => {
  it("selects visible campaigns and routes bulk actions to the selected rows", async () => {
    const onBulkDelete = vi.fn();
    renderTable(onBulkDelete);

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select all campaigns" }),
    );
    expect(screen.getByText("2 of 2 selected")).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("button", { name: "Bulk actions" }), {
      key: "Enter",
    });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Delete selected" }),
    );

    expect(onBulkDelete).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: "draft" }),
        expect.objectContaining({ id: "sent" }),
      ]),
    );
  });

  it("shows eight campaigns per page", () => {
    const campaigns = Array.from({ length: 9 }, (_, index) =>
      campaign(`campaign-${index + 1}`, "draft"),
    );
    renderTable(vi.fn(), campaigns);

    expect(screen.getAllByRole("article")).toHaveLength(8);
    expect(screen.getByText(/Showing 1.8 of 9 campaigns/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByText(/Showing 9.9 of 9 campaigns/)).toBeInTheDocument();
  });

  it("offers Send now for scheduled campaigns", async () => {
    const scheduled = {
      ...campaign("scheduled", "scheduled"),
      scheduledAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
    };
    const onSendNow = vi.fn();
    renderTable(vi.fn(), [scheduled], onSendNow);

    const sendNow = screen.getByRole("button", {
      name: "Send Campaign scheduled now",
    });
    expect(sendNow).toBeVisible();

    fireEvent.click(sendNow);
    expect(onSendNow).toHaveBeenCalledWith(scheduled);
  });

  it("shows the active sending state on the scheduled card", () => {
    const scheduled = {
      ...campaign("scheduled", "scheduled"),
      scheduledAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
    };
    renderTable(vi.fn(), [scheduled], vi.fn(), {
      sendNowCampaignId: scheduled.id,
      working: true,
    });

    const sendNow = screen.getByRole("button", {
      name: "Sending Campaign scheduled",
    });
    expect(sendNow).toHaveTextContent("Sending...");
    expect(sendNow).toBeDisabled();
    expect(sendNow.querySelector("svg.animate-spin")).not.toBeNull();
  });
});

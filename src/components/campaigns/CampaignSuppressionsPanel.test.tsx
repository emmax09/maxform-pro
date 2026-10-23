import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const suppressionMocks = vi.hoisted(() => ({
  listCampaignSuppressions: vi.fn(),
  removeCampaignSuppressions: vi.fn(),
  deleteCampaignSuppressionsFromSystem: vi.fn(),
}));

vi.mock("@/lib/contacts", () => suppressionMocks);

import { CampaignSuppressionsPanel } from "./CampaignSuppressionsPanel";

const page = {
  rows: [
    {
      id: "suppression-1",
      recipient: "one@example.com",
      reason: "unsubscribe" as const,
      reasonDetail: "I receive too many emails",
      createdAt: "2026-08-05T09:00:00.000Z",
      contactId: "contact-1",
      contactName: "One Recipient",
      sourceCampaignId: "campaign-1",
      sourceCampaignName: "August update",
    },
  ],
  total: 1,
  page: 1,
  pageSize: 8,
  pageCount: 1,
  counts: { all: 1, unsubscribe: 1, bounce: 0, complaint: 0, manual: 0 },
};

const renderPanel = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CampaignSuppressionsPanel userId="workspace-1" />
    </QueryClientProvider>,
  );
};

describe("CampaignSuppressionsPanel", () => {
  beforeEach(() => {
    suppressionMocks.listCampaignSuppressions.mockReset();
    suppressionMocks.removeCampaignSuppressions.mockReset();
    suppressionMocks.deleteCampaignSuppressionsFromSystem.mockReset();
    suppressionMocks.listCampaignSuppressions.mockResolvedValue(page);
    suppressionMocks.removeCampaignSuppressions.mockResolvedValue({
      removed: 1,
      resubscribed: 1,
    });
    suppressionMocks.deleteCampaignSuppressionsFromSystem.mockResolvedValue({
      removed: 1,
      contactsDeleted: 1,
      messagesDetached: 1,
    });
  });

  it("renders suppression details, filters, and pagination data from the server", async () => {
    renderPanel();

    expect(await screen.findByText("Unsubscribed & suppressed")).toBeInTheDocument();
    expect(await screen.findByText("one@example.com")).toBeInTheDocument();
    expect(await screen.findByText("August update")).toBeInTheDocument();
    expect(await screen.findByText("I receive too many emails")).toBeInTheDocument();
    expect(suppressionMocks.listCampaignSuppressions).toHaveBeenCalledWith(
      "workspace-1",
      expect.objectContaining({ page: 1, pageSize: 8, reason: "all" }),
    );
  });

  it("confirms and removes selected suppression records", async () => {
    renderPanel();

    const checkbox = await screen.findByRole("checkbox", {
      name: "Select one@example.com",
    });
    fireEvent.click(checkbox);
    fireEvent.keyDown(screen.getByRole("button", { name: "Bulk actions" }), {
      key: "Enter",
    });
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: "Remove from suppression list",
      }),
    );

    expect(
      await screen.findByText("Remove from suppression list?"),
    ).toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: /remove from list/i }),
    );

    await waitFor(() =>
      expect(suppressionMocks.removeCampaignSuppressions).toHaveBeenCalledWith(
        "workspace-1",
        ["suppression-1"],
      ),
    );
  });

  it("keeps permanent contact deletion separate from removing suppression", async () => {
    renderPanel();

    fireEvent.keyDown(
      await screen.findByRole("button", {
        name: "Actions for one@example.com",
      }),
      { key: "Enter" },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Delete from system" }),
    );

    expect(await screen.findByText("Delete from system?")).toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Delete from system" }),
    );

    await waitFor(() =>
      expect(
        suppressionMocks.deleteCampaignSuppressionsFromSystem,
      ).toHaveBeenCalledWith("workspace-1", ["suppression-1"]),
    );
  });
});

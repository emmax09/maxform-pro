import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const crmMocks = vi.hoisted(() => ({
  convertCrmLead: vi.fn(),
  createCrmCompany: vi.fn(),
  createCrmDeal: vi.fn(),
  createCrmLead: vi.fn(),
  createCrmPipeline: vi.fn(),
  createCrmPipelineStage: vi.fn(),
  createCrmTask: vi.fn(),
  deleteCrmPipeline: vi.fn(),
  deleteCrmPipelineStage: vi.fn(),
  getCrmWorkspace: vi.fn(),
  reorderCrmPipelineStage: vi.fn(),
  updateCrmDealStage: vi.fn(),
  updateCrmLeadStatus: vi.fn(),
  updateCrmPipeline: vi.fn(),
  updateCrmPipelineStage: vi.fn(),
  updateCrmTaskStatus: vi.fn(),
}));

vi.mock("@/lib/crm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/crm")>()),
  ...crmMocks,
}));

vi.mock("@/components/contacts/ContactsModule", () => ({
  ContactsModule: ({ initialTab }: { initialTab?: string }) => (
    <div>Shared contacts module: {initialTab}</div>
  ),
}));

import { CrmModule, type CrmTab } from "@/components/crm/CrmModule";
import type { CrmWorkspaceData } from "@/lib/crm";

const now = new Date().toISOString();
const workspace: CrmWorkspaceData = {
  currency: "USD",
  activities: [
    {
      activityType: "deal_stage_changed",
      actorName: "Ada Owner",
      companyId: "company-1",
      companyName: "Acme",
      contactId: "contact-1",
      contactName: "Emmanuel Vincent",
      createdAt: now,
      dealId: "deal-1",
      dealName: "Acme expansion",
      detail: "Moved to Qualified",
      id: "activity-1",
      taskId: null,
      title: "Deal stage changed",
    },
  ],
  companies: [
    {
      activeDealValueCents: 250_000,
      address: {},
      contactCount: 1,
      createdAt: now,
      dealCount: 1,
      employeeCount: 24,
      id: "company-1",
      industry: "Technology",
      lastActivityAt: now,
      name: "Acme",
      notes: "",
      ownerId: "user-1",
      revenueCents: 2_000_000,
      updatedAt: now,
      website: "https://acme.example",
    },
  ],
  contacts: [
    {
      company: "Acme",
      companyId: "company-1",
      createdAt: now,
      email: "emmanuel@example.com",
      fullName: "Emmanuel Vincent",
      id: "contact-1",
      lastActivityAt: now,
      lifecycleStage: "customer",
    },
  ],
  deals: [
    {
      companyId: "company-1",
      companyName: "Acme",
      contactId: "contact-1",
      contactName: "Emmanuel Vincent",
      createdAt: now,
      currency: "USD",
      expectedCloseDate: now.slice(0, 10),
      id: "deal-1",
      isLost: false,
      isWon: false,
      lostReason: "",
      name: "Acme expansion",
      notes: "",
      orderId: null,
      ownerId: "user-1",
      ownerName: "Ada Owner",
      pipelineId: "pipeline-1",
      pipelineName: "Sales",
      probability: 30,
      probabilityPinned: false,
      stageEnteredAt: now,
      stageColor: "#2563EB",
      stageId: "stage-qualified",
      stageName: "Qualified",
      updatedAt: now,
      valueCents: 250_000,
    },
  ],
  events: [],
  leads: [
    {
      assignedUserId: "user-1",
      assignedUserName: "Ada Owner",
      budgetCents: 500_000,
      companyId: "company-1",
      companyName: "Acme",
      convertedAt: null,
      convertedContactId: null,
      createdAt: now,
      email: "lead@acme.example",
      id: "lead-1",
      interestNotes: "Requested a proposal",
      name: "Tola Lead",
      phone: "+2348000000000",
      score: 85,
      scoreReasons: ["Verified first-party source", "Strong stated budget"],
      sourceId: "form-1",
      sourceLabel: "Enterprise enquiry",
      sourceType: "form",
      status: "new",
      updatedAt: now,
    },
  ],
  pipelines: [
    {
      color: "#635BFF",
      createdAt: now,
      description: "Default sales pipeline",
      id: "pipeline-1",
      isDefault: true,
      name: "Sales",
      stages: [
        {
          color: "#64748B",
          id: "stage-new",
          isLost: false,
          isWon: false,
          name: "New",
          orderIndex: 0,
          probability: 10,
          requiredFields: [],
          staleAfterDays: null,
        },
        {
          color: "#2563EB",
          id: "stage-qualified",
          isLost: false,
          isWon: false,
          name: "Qualified",
          orderIndex: 1,
          probability: 30,
          requiredFields: ["value"],
          staleAfterDays: 14,
        },
      ],
      updatedAt: now,
    },
  ],
  revenue: [{ orders: 2, period: "2026-07", revenue: 4200 }],
  tasks: [
    {
      assignedUserId: "user-1",
      assignedUserName: "Ada Owner",
      companyId: "company-1",
      companyName: "Acme",
      completedAt: null,
      contactId: "contact-1",
      contactName: "Emmanuel Vincent",
      createdAt: now,
      dealId: "deal-1",
      dealName: "Acme expansion",
      description: "Send pricing",
      dueAt: now,
      id: "task-1",
      priority: "high",
      status: "open",
      title: "Follow up with Acme",
      updatedAt: now,
    },
  ],
};

const renderCrm = (initialTab: CrmTab = "overview") => {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CrmModule initialTab={initialTab} userId="user-1" />
    </QueryClientProvider>,
  );
};

describe("CrmModule", () => {
  beforeEach(() => {
    Object.values(crmMocks).forEach((mock) => mock.mockReset());
    crmMocks.getCrmWorkspace.mockResolvedValue(workspace);
  });

  it("renders live overview metrics and opens the underlying CRM section", async () => {
    renderCrm();

    expect(await screen.findByText("Sales pipeline")).toBeInTheDocument();
    expect(screen.getByText("Total contacts")).toBeInTheDocument();
    expect(screen.getByText("Confirmed payment orders")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Companies$/i }));

    expect(await screen.findByText("Acme")).toBeInTheDocument();
    expect(screen.getByLabelText("Search companies")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New company" })).toBeInTheDocument();
  });

  it("keeps contacts shared and provides lead board and table workflows", async () => {
    renderCrm();
    await screen.findByText("Sales pipeline");

    fireEvent.click(screen.getByRole("button", { name: /^Contacts$/i }));
    expect(
      await screen.findByText("Shared contacts module: contacts"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Leads$/i }));
    expect(await screen.findByText("Tola Lead")).toBeInTheDocument();
    expect(screen.getByText(/Enterprise enquiry/)).toBeInTheDocument();
    expect(screen.getByText("85")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Lead table view"));
    fireEvent.click(screen.getByLabelText("Select Tola Lead"));
    fireEvent.keyDown(
      await screen.findByRole("button", { name: "Bulk actions" }),
      { key: "Enter" },
    );
    expect(
      await screen.findByRole("menuitem", { name: "Mark as contacted" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Mark as qualified" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Archive leads" }),
    ).toBeInTheDocument();
  });

  it("keeps Campaigns out of the CRM tab row", async () => {
    renderCrm();

    expect(await screen.findByText("Sales pipeline")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Campaigns$/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps every CRM section visible and paginates tables by ten", async () => {
    crmMocks.getCrmWorkspace.mockResolvedValue({
      ...workspace,
      companies: Array.from({ length: 12 }, (_, index) => ({
        ...workspace.companies[0],
        id: `company-${index + 1}`,
        name: `Company ${index + 1}`,
      })),
    });
    renderCrm();
    await screen.findByText("Sales pipeline");

    expect(
      screen.getByRole("button", { name: /^Settings$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^CRM intelligence$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Import & export" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^More$/i }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Companies$/i }));
    expect(
      await screen.findByText("Showing 1–10 of 12 companies"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Company 11")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(await screen.findByText("Company 11")).toBeInTheDocument();
  });

  it("creates a clean pipeline and exposes full pipeline management", async () => {
    renderCrm();
    await screen.findByText("Sales pipeline");

    fireEvent.click(screen.getByRole("button", { name: /^Pipelines$/i }));
    expect(await screen.findByText("Multiple pipelines")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "New pipeline" }));
    expect(
      await screen.findByText(/This pipeline starts clean/i),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Pipeline name"), {
      target: { value: "Partnerships" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create pipeline" }));

    await waitFor(() =>
      expect(crmMocks.createCrmPipeline).toHaveBeenCalledWith("user-1", {
        color: "#635BFF",
        description: "",
        name: "Partnerships",
      }),
    );
    expect(crmMocks.createCrmPipelineStage).not.toHaveBeenCalled();

    fireEvent.keyDown(
      screen.getByRole("button", { name: "Manage Sales pipeline" }),
      { key: "Enter" },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Edit pipeline" }),
    );
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "Default pipeline",
    );
  });

  it("requires reassignment before deleting a stage that contains deals", async () => {
    renderCrm();
    await screen.findByText("Sales pipeline");
    fireEvent.click(screen.getByRole("button", { name: /^Pipelines$/i }));
    await screen.findByText("Multiple pipelines");

    fireEvent.keyDown(
      screen.getByRole("button", { name: "Manage Qualified stage" }),
      { key: "Enter" },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Delete stage" }),
    );

    expect(
      await screen.findByText(/Reassign the 1 deal in this stage/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Replacement stage")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reassign and delete" }),
    ).toBeEnabled();
  });
});

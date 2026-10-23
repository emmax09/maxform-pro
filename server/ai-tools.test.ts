import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceContext } from "./workspace-access";

// Every module the registry wraps is stubbed: these tests are about the
// permission gate and the confirmation gate, not about the data layers, which
// have their own coverage.
const canOpenModule = vi.fn(async (_userId: string, _module: string) => true);
const getOrdersSummary = vi.fn(async () => ({ total: 4 }));
const listOrders = vi.fn(async () => ({ orders: [] }));
type SendEmailInput = {
  userId: string;
  to: string;
  override: { subject: string; html: string; text: string };
};
const sendEmailNow = vi.fn(async (_input: SendEmailInput) => ({ id: "log-1" }));
const createContactNote = vi.fn(async () => ({ id: "note-1" }));
const createFormForAssistant = vi.fn(async () => ({
  form: { id: "44444444-4444-4444-8444-444444444444", title: "Signup" },
  workspaceChange: {
    module: "forms",
    action: "created",
    recordId: "44444444-4444-4444-8444-444444444444",
    label: "Signup",
  },
}));
const createEventForAssistant = vi.fn(async () => ({
  event: { id: "55555555-5555-4555-8555-555555555555", title: "Launch" },
}));
const createBookingPageForAssistant = vi.fn(async () => ({
  bookingPage: { id: "66666666-6666-4666-8666-666666666666", name: "Call" },
}));
const createAppointmentForAssistant = vi.fn(async () => ({
  appointment: {
    id: "77777777-7777-4777-8777-777777777777",
    inviteeName: "Sam",
  },
  notification: { status: "not_required" },
  workspaceChange: {
    module: "appointments",
    action: "created",
    recordId: "77777777-7777-4777-8777-777777777777",
    label: "Sam",
  },
}));

vi.mock("./workspace-access", () => ({
  canOpenModule: (userId: string, moduleKey: string) =>
    canOpenModule(userId, moduleKey),
}));
vi.mock("./orders-data", () => ({
  getOrdersSummary: (...args: unknown[]) => getOrdersSummary(...(args as [])),
  listOrders: (...args: unknown[]) => listOrders(...(args as [])),
  getOrderDetail: vi.fn(async () => ({})),
}));
vi.mock("./email-service", () => ({
  sendEmailNow: (input: SendEmailInput) => sendEmailNow(input),
}));
vi.mock("./contacts-data", () => ({
  createContactNote: (...args: unknown[]) => createContactNote(...(args as [])),
  listContacts: vi.fn(async () => []),
  getContact: vi.fn(async () => ({ id: "c" })),
  listContactActivity: vi.fn(async () => []),
  listContactNotes: vi.fn(async () => []),
}));
vi.mock("./analytics-data", () => ({ listAnalytics: vi.fn(async () => ({})) }));
vi.mock("./payment-data", () => ({
  hasConnectedPaymentProviderServer: vi.fn(async () => false),
  listPaymentProductsServer: vi.fn(async () => []),
}));
vi.mock("./notifications-data", () => ({
  listWorkspaceNotifications: vi.fn(async () => ({ notifications: [] })),
}));
vi.mock("./ai-module-actions", () => ({
  createFormForAssistant: (...args: unknown[]) =>
    (createFormForAssistant as unknown as (...values: unknown[]) => unknown)(...args),
  createEventForAssistant: (...args: unknown[]) =>
    (createEventForAssistant as unknown as (...values: unknown[]) => unknown)(...args),
  createBookingPageForAssistant: (...args: unknown[]) =>
    (createBookingPageForAssistant as unknown as (...values: unknown[]) => unknown)(...args),
  createAppointmentForAssistant: (...args: unknown[]) =>
    (createAppointmentForAssistant as unknown as (...values: unknown[]) => unknown)(...args),
  formFieldSchema: { type: "object", properties: {} },
}));

const { AI_TOOLS, findTool, runTool, toolsFor } = await import("./ai-tools");

const owner: WorkspaceContext = {
  userId: "22222222-2222-4222-8222-222222222222",
  workspaceId: "11111111-1111-4111-8111-111111111111",
  role: "owner",
  allowedModules: null,
  isOwner: true,
  mustChangePassword: false,
  suspended: false,
  blocked: false,
};

const contactId = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  vi.clearAllMocks();
  canOpenModule.mockImplementation(async () => true);
});

describe("tool exposure", () => {
  it("offers only the tools whose module this person can open", async () => {
    canOpenModule.mockImplementation(
      async (_userId, moduleKey) => moduleKey === "orders",
    );
    const tools = await toolsFor(owner);
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.every((tool) => tool.module === "orders")).toBe(true);
    expect(tools.map((tool) => tool.name)).not.toContain("send_email");
  });

  it("offers nothing at all to a suspended membership", async () => {
    expect(await toolsFor({ ...owner, suspended: true })).toEqual([]);
    expect(await toolsFor({ ...owner, blocked: true })).toEqual([]);
    expect(canOpenModule).not.toHaveBeenCalled();
  });

  it("declares every tool against a real module and gives the model a when-to-use", () => {
    for (const tool of AI_TOOLS) {
      expect(tool.module).toBeTruthy();
      expect(tool.description.length).toBeGreaterThan(60);
      expect(tool.inputSchema).toMatchObject({ type: "object" });
    }
  });

  it("offers a live workspace snapshot and the core module creation actions", () => {
    expect(findTool("get_workspace_snapshot")?.module).toBe("home");
    expect(findTool("create_form")?.module).toBe("forms");
    expect(findTool("create_event")?.module).toBe("events");
    expect(findTool("create_booking_page")?.module).toBe("appointments");
    expect(findTool("create_appointment")?.module).toBe("appointments");
  });

  it("gives every consequential tool a preview to show before approval", () => {
    for (const tool of AI_TOOLS.filter((entry) => entry.consequential)) {
      expect(typeof tool.preview).toBe("function");
    }
  });
});

describe("execution gate", () => {
  it("re-checks permission at run time, not just when the list was built", async () => {
    canOpenModule.mockImplementation(async () => false);
    const outcome = await runTool("get_revenue_summary", { days: 7 }, owner);
    expect(outcome).toMatchObject({ status: "denied" });
    expect(getOrdersSummary).not.toHaveBeenCalled();
  });

  it("requires approval before creating an appointment", async () => {
    const outcome = await runTool(
      "create_appointment",
      {
        inviteeName: "Sam",
        inviteeEmail: "sam@example.com",
        startsAt: "2026-08-10T10:00:00Z",
        endsAt: "2026-08-10T10:30:00Z",
      },
      owner,
    );
    expect(outcome).toMatchObject({ status: "needs_confirmation" });
    expect(createAppointmentForAssistant).not.toHaveBeenCalled();
  });

  it("denies a tool name the model invented", async () => {
    const outcome = await runTool("delete_everything", {}, owner);
    expect(outcome).toMatchObject({ status: "denied" });
    expect(findTool("delete_everything")).toBeNull();
  });

  it("always scopes the call to the session's workspace, never to an argument", async () => {
    await runTool(
      "get_revenue_summary",
      { days: 7, workspaceId: "99999999-9999-4999-8999-999999999999" },
      owner,
    );
    expect(getOrdersSummary).toHaveBeenCalledWith(owner.workspaceId, 7);
  });

  it("clamps out-of-range arguments instead of passing them through", async () => {
    await runTool("get_revenue_summary", { days: 100_000 }, owner);
    expect(getOrdersSummary).toHaveBeenCalledWith(owner.workspaceId, 365);

    await runTool("get_revenue_summary", { days: "not a number" }, owner);
    expect(getOrdersSummary).toHaveBeenLastCalledWith(owner.workspaceId, 30);
  });

  it("rejects a malformed id rather than handing it to the data layer", async () => {
    const outcome = await runTool(
      "add_contact_note",
      { contactId: "'; DROP TABLE contacts; --", body: "hi" },
      owner,
    );
    expect(outcome).toMatchObject({ status: "denied" });
    expect(createContactNote).not.toHaveBeenCalled();
  });

  it("turns a module error into a denial the model can read, not a crash", async () => {
    listOrders.mockRejectedValueOnce(new Error("Orders are unavailable."));
    const outcome = await runTool("list_orders", {}, owner);
    expect(outcome).toEqual({
      status: "denied",
      message: "Orders are unavailable.",
    });
  });

  it("runs a non-consequential write directly", async () => {
    const outcome = await runTool(
      "add_contact_note",
      { contactId, body: "Called about renewal." },
      owner,
    );
    expect(outcome).toMatchObject({ status: "ran" });
    expect(createContactNote).toHaveBeenCalledWith(
      owner.workspaceId,
      contactId,
      "Called about renewal.",
    );
  });

  it("keeps module creation behind explicit approval", async () => {
    const outcome = await runTool(
      "create_form",
      { title: "Signup", fields: [{ label: "Email", type: "email" }] },
      owner,
    );
    expect(outcome).toMatchObject({ status: "needs_confirmation" });
    expect(createFormForAssistant).not.toHaveBeenCalled();
  });

  it("passes only the authenticated workspace context to module creation", async () => {
    await runTool(
      "create_event",
      { title: "Launch", workspaceId: "99999999-9999-4999-8999-999999999999" },
      owner,
      { approved: true },
    );
    expect(createEventForAssistant).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Launch" }),
      owner,
    );
  });
});

describe("confirmation gate", () => {
  const sendInput = {
    to: "person@example.com",
    subject: "Following up",
    body: "Hello there.",
  };

  it("never sends from a model turn — it proposes", async () => {
    const outcome = await runTool("send_email", sendInput, owner);
    expect(outcome.status).toBe("needs_confirmation");
    expect(sendEmailNow).not.toHaveBeenCalled();
  });

  it("previews the recipient and subject so approval is informed", async () => {
    const outcome = await runTool("send_email", sendInput, owner);
    if (outcome.status !== "needs_confirmation") throw new Error("expected preview");
    expect(outcome.summary).toContain("person@example.com");
    expect(outcome.summary).toContain("Following up");
  });

  it("sends only once explicitly approved", async () => {
    const outcome = await runTool("send_email", sendInput, owner, {
      approved: true,
    });
    expect(outcome.status).toBe("ran");
    expect(sendEmailNow).toHaveBeenCalledTimes(1);
    expect(sendEmailNow).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: owner.workspaceId,
        to: "person@example.com",
        override: expect.objectContaining({ subject: "Following up" }),
      }),
    );
  });

  it("still enforces module permission on an approved action", async () => {
    canOpenModule.mockImplementation(async () => false);
    const outcome = await runTool("send_email", sendInput, owner, {
      approved: true,
    });
    expect(outcome).toMatchObject({ status: "denied" });
    expect(sendEmailNow).not.toHaveBeenCalled();
  });

  it("rejects an invalid recipient before anything is queued", async () => {
    const outcome = await runTool(
      "send_email",
      { ...sendInput, to: "not-an-address" },
      owner,
      { approved: true },
    );
    expect(outcome).toMatchObject({ status: "denied" });
    expect(sendEmailNow).not.toHaveBeenCalled();
  });

  it("escapes the body so a crafted message cannot inject markup", async () => {
    await runTool(
      "send_email",
      { ...sendInput, body: '<script>alert("x")</script>' },
      owner,
      { approved: true },
    );
    const payload = sendEmailNow.mock.calls[0][0];
    expect(payload.override.html).not.toContain("<script>");
    expect(payload.override.html).toContain("&lt;script&gt;");
    expect(payload.override.text).toContain("<script>");
  });
});

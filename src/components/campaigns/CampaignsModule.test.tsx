import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const contactMocks = vi.hoisted(() => ({
  archiveContactCampaign: vi.fn(),
  bulkUpdateContactCampaigns: vi.fn(),
  completeCampaignBuilder: vi.fn(),
  deleteContactCampaign: vi.fn(),
  duplicateContactCampaign: vi.fn(),
  getCampaignAnalytics: vi.fn(),
  getCampaignAudiencePreview: vi.fn(),
  getCampaignClickMap: vi.fn(),
  getCampaignPerformanceOverview: vi.fn(),
  getCampaignSendProgress: vi.fn(),
  getCampaignSettings: vi.fn(),
  getCampaignWizardIdentities: vi.fn(),
  getCampaignWizardReview: vi.fn(),
  listCampaignVariants: vi.fn(),
  listContactCampaigns: vi.fn(),
  listContactLists: vi.fn(),
  pauseContactCampaign: vi.fn(),
  resumeContactCampaign: vi.fn(),
  saveCampaignBuilderState: vi.fn(),
  saveCampaignSettings: vi.fn(),
  saveCampaignWizardIdentity: vi.fn(),
  saveCampaignWizardRecipients: vi.fn(),
  saveContactCampaign: vi.fn(),
  scheduleCampaignFromWizard: vi.fn(),
  sendContactCampaignNow: vi.fn(),
  sendCampaignTest: vi.fn(),
}));

const emailMocks = vi.hoisted(() => ({ getEmailWorkspace: vi.fn() }));
const paymentMocks = vi.hoisted(() => ({ listPaymentProducts: vi.fn() }));

vi.mock("@/lib/contacts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/contacts")>()),
  ...contactMocks,
}));
vi.mock("@/lib/email", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/email")>()),
  ...emailMocks,
}));
vi.mock("@/lib/payments", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/payments")>()),
  ...paymentMocks,
}));

import { CampaignsModule } from "@/components/campaigns/CampaignsModule";

// Reaching the send wizard now crosses the create flow, the full-screen builder
// and back — several heavy mounts, each of which jsdom renders far slower than
// a browser. The default 15s is not enough headroom for that path.
vi.setConfig({ testTimeout: 40_000 });

const now = new Date("2026-07-20T10:00:00.000Z").toISOString();

const listRecord = {
  createdAt: now,
  description: "Everyone who opted in",
  filterDefinition: [],
  id: "list-1",
  listType: "static" as const,
  memberCount: 240,
  name: "Newsletter subscribers",
  updatedAt: now,
};

const vipList = {
  ...listRecord,
  id: "list-2",
  name: "VIP customers",
  memberCount: 30,
};

const sentCampaign = {
  aiGenerated: false,
  archivedAt: null,
  blocks: [],
  category: "newsletter",
  createdAt: now,
  excludeListId: null,
  excludeListName: "",
  htmlBody: "<p>Hello</p>",
  id: "campaign-1",
  identityId: null,
  listId: "list-1",
  listName: "Newsletter subscribers",
  name: "July update",
  previewText: "What is new",
  recurrenceRequiresReview: true,
  recurrenceRule: "",
  revenueAttributed: 1240.5,
  revenueCurrency: "USD",
  scheduledAt: now,
  sendStrategy: "scheduled" as const,
  sentAt: now,
  spamScore: 8,
  stats: { sent: 200, opened: 90, clicked: 24, unsubscribed: 3 },
  status: "sent" as const,
  subject: "A quick July update",
  updatedAt: now,
};

const scheduledCampaign = {
  ...sentCampaign,
  id: "campaign-2",
  name: "August teaser",
  status: "scheduled" as const,
  sentAt: null,
  scheduledAt: new Date("2026-08-01T09:00:00.000Z").toISOString(),
  stats: { sent: 0, opened: 0, clicked: 0 },
  revenueAttributed: 0,
};

const audiencePreview = {
  deliverable: 205,
  excluded: 30,
  excludeListId: null,
  excludeListName: "",
  listId: "list-1",
  listName: "Newsletter subscribers",
  missingEmail: 2,
  suppressed: 1,
  totalInList: 240,
  unsubscribed: 2,
};

const pacing = {
  batchCount: 5,
  batchDelaySeconds: 60,
  batchSize: 50,
  estimatedDurationSeconds: 12 * 60,
  provider: "resend",
  summary: "about 12 minutes",
};

const identity = {
  id: "identity-1",
  senderName: "Acme News",
  senderEmail: "newsletter@acme.test",
  replyTo: "",
  verified: true,
  senderReady: true,
  isDefault: true,
};

const sendingProgress = {
  batchDelaySeconds: 60,
  batchesSent: 2,
  batchesTotal: 5,
  batchSize: 50,
  campaignId: "campaign-2",
  completedAt: null,
  estimatedDurationSummary: "about 12 minutes",
  estimatedSendDurationSeconds: 720,
  failed: 0,
  nextBatchAt: new Date(Date.now() + 60_000).toISOString(),
  pending: 105,
  sent: 100,
  startedAt: now,
  status: "sending",
  totalRecipients: 205,
};

const renderModule = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CampaignsModule userId="user-1" />
    </QueryClientProvider>,
  );
};

const goToTab = async (label: string) => {
  fireEvent.click(await screen.findByRole("button", { name: label }));
};

/**
 * A Radix Select opens on the trigger's click, but an item only commits its
 * value on pointerup, so both events are needed to make a choice under jsdom.
 */
const chooseOption = async (selectLabel: string, optionName: RegExp) => {
  fireEvent.click(screen.getByRole("combobox", { name: selectLabel }));
  const option = await screen.findByRole("option", { name: optionName });
  fireEvent.pointerUp(option, { pointerId: 1, pointerType: "mouse" });
  fireEvent.click(option);
};

/**
 * Clicks a button once it is genuinely clickable.
 *
 * findBy* resolves as soon as the element exists, including while it is still
 * disabled — and a click on a disabled button is silently dropped. Every action
 * in these flows waits behind a query or a save, so each one has to wait for
 * enabled rather than for present.
 */
const clickWhenEnabled = async (name: string | RegExp, timeout = 15_000) => {
  await screen.findByRole("button", { name }, { timeout });
  await waitFor(
    () => {
      const candidate = screen.getByRole("button", { name });
      // Named in the message: "expect(element).toBeEnabled()" on its own does
      // not say which of the several buttons in a flow was stuck.
      if ((candidate as HTMLButtonElement).disabled) {
        throw new Error(`Button ${String(name)} is still disabled`);
      }
    },
    { timeout },
  );
  // Re-queried rather than reused: the header re-renders as the flow advances,
  // and a click dispatched on a node React has already replaced is silently
  // dropped — the step simply never changes.
  const button = screen.getByRole("button", { name });
  fireEvent.click(button);
  return button;
};

/**
 * New campaign → the create flow → the builder.
 *
 * The builder is now reached through step two rather than directly, and each
 * step holds briefly on a loader, so this waits on what the next screen owns
 * rather than assuming an instant swap.
 */
const openBuilder = async () => {
  // New campaign stays disabled until the lists query lands.
  await clickWhenEnabled(/New campaign/);
  // Step one: a subject is what unlocks the rest of the flow.
  fireEvent.change(
    await screen.findByLabelText("Email subject", undefined, { timeout: 15_000 }),
    { target: { value: "48 hours: 20% off" } },
  );
  await clickWhenEnabled("Save and continue");
  await clickWhenEnabled("Start creating");
  const builder = await screen.findByRole("region", {
    name: "Campaign builder",
  });
  await screen.findByRole("complementary", { name: "Blocks" }, { timeout: 3_000 });
  return builder;
};

/**
 * Builder → the long-form send wizard.
 *
 * The wizard is no longer the default continuation: the flow handles send-now
 * and a chosen time itself, and the wizard is what "More sending options" opens
 * for A/B splits, recurrence and per-timezone sends.
 */
const openWizard = async () => {
  await openBuilder();
  fireEvent.change(screen.getByLabelText("Campaign name"), {
    target: { value: "Flash sale" },
  });
  // Subject and preview line sit above the canvas, and both are required
  // before the builder will hand the campaign back to the flow.
  fireEvent.change(await screen.findByLabelText("Subject line"), {
    target: { value: "48 hours: 20% off" },
  });
  fireEvent.change(screen.getByLabelText("Preview line"), {
    target: { value: "Ends Friday at midnight." },
  });
  await clickWhenEnabled(/Save & Continue/);

  // Back in the flow at recipients, then review, then the wizard. The flow
  // reopens while the save is still settling, so both of these wait for the
  // button to become enabled rather than merely present.
  await clickWhenEnabled("Save and continue");
  await clickWhenEnabled(/Open the full send wizard/);
  return screen.findByRole(
    "region",
    { name: "Campaign send wizard" },
    { timeout: 15_000 },
  );
};

/**
 * Advances the wizard until each named step heading is on screen. Continue
 * stays disabled while the review payload is in flight, so each step waits for
 * it to become actionable before clicking.
 */
const advanceTo = async (headings: RegExp[]) => {
  for (const heading of headings) {
    const next = await screen.findByRole("button", { name: /^Continue/ });
    await waitFor(() => expect(next).toBeEnabled());
    fireEvent.click(next);
    await screen.findByRole("heading", { name: heading });
  }
};

describe("CampaignsModule", () => {
  // Radix Select commits a value through the Pointer Capture API, which jsdom
  // does not implement. These stubs stay scoped to this file: defining them
  // globally changes how existing suites' menus respond to a plain click.
  beforeAll(() => {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.scrollIntoView = () => {};
  });

  beforeEach(() => {
    Object.values(contactMocks).forEach((mock) => mock.mockReset());
    emailMocks.getEmailWorkspace.mockReset();
    paymentMocks.listPaymentProducts.mockReset();

    contactMocks.listContactLists.mockResolvedValue([listRecord, vipList]);
    contactMocks.listContactCampaigns.mockResolvedValue([
      sentCampaign,
      scheduledCampaign,
    ]);
    contactMocks.getCampaignSettings.mockResolvedValue({
      batchDelaySeconds: null,
      batchSize: null,
      brandVoice: "friendly",
      footerText: "Sent by Acme",
      identityId: null,
      mailingAddress: "1 Example Street, Lagos",
    });
    contactMocks.getCampaignPerformanceOverview.mockResolvedValue({
      openHours: [{ hour: 14, opens: 60 }],
      subjects: [],
      trend: [{ date: "2026-07-19", sent: 200, opened: 90, clicked: 24 }],
      upcoming: [scheduledCampaign],
    });
    contactMocks.getCampaignAudiencePreview.mockResolvedValue(audiencePreview);
    contactMocks.listCampaignVariants.mockResolvedValue([]);
    contactMocks.saveContactCampaign.mockResolvedValue("campaign-3");
    contactMocks.duplicateContactCampaign.mockResolvedValue("campaign-4");
    contactMocks.pauseContactCampaign.mockResolvedValue(5);
    contactMocks.resumeContactCampaign.mockResolvedValue(3);
    contactMocks.archiveContactCampaign.mockResolvedValue(true);
    contactMocks.completeCampaignBuilder.mockResolvedValue({
      builderState: "ready_to_send",
    });
    contactMocks.saveCampaignBuilderState.mockResolvedValue({ savedAt: now });
    contactMocks.saveCampaignWizardRecipients.mockResolvedValue({
      audience: audiencePreview,
      pacing,
    });
    contactMocks.getCampaignWizardIdentities.mockResolvedValue({
      selectedIdentityId: identity.id,
      identities: [identity],
    });
    contactMocks.saveCampaignWizardIdentity.mockResolvedValue({
      selectedIdentityId: identity.id,
      identities: [identity],
    });
    contactMocks.getCampaignWizardReview.mockResolvedValue({
      audience: audiencePreview,
      blockers: [],
      campaign: { ...sentCampaign, id: "campaign-3", status: "draft" },
      canSend: true,
      identity,
      pacing,
      settings: { mailingAddress: "1 Example Street, Lagos" },
    });
    contactMocks.scheduleCampaignFromWizard.mockResolvedValue({
      queued: 205,
      scheduledAt: null,
      strategy: "immediate",
    });
    contactMocks.sendContactCampaignNow.mockResolvedValue(205);
    contactMocks.getCampaignSendProgress.mockResolvedValue(sendingProgress);
    emailMocks.getEmailWorkspace.mockResolvedValue({
      connections: [],
      identities: [identity],
      logs: [],
      overview: { suppressions: 14 },
      received: [],
      settings: {},
      templates: [],
    });
    paymentMocks.listPaymentProducts.mockResolvedValue([]);
  });

  it("keeps only the places you return to as tabs", async () => {
    renderModule();

    expect(
      await screen.findByRole("heading", { name: "Campaigns" }),
    ).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Campaign sections" });
    for (const label of [
      "Overview",
      "All campaigns",
      "AI creator",
      "Analytics",
      "Settings",
    ]) {
      expect(within(nav).getByRole("button", { name: label })).toBeInTheDocument();
    }
    // Designing and sending are modes, not tabs; audience lives in Contacts;
    // templates are step two of the create flow rather than a destination.
    for (const gone of ["Audience", "Builder", "Scheduling", "Templates"]) {
      expect(
        within(nav).queryByRole("button", { name: gone }),
      ).not.toBeInTheDocument();
    }
  });

  it("shows engagement rates from the overview metrics", async () => {
    renderModule();

    const openCard = (await screen.findByText("Average open rate")).closest(
      "section",
    );
    const clickCard = screen.getByText("Average click rate").closest("section");
    expect(openCard).not.toBeNull();
    expect(clickCard).not.toBeNull();
    expect(within(openCard as HTMLElement).getByText("45.0%")).toBeInTheDocument();
    expect(within(clickCard as HTMLElement).getByText("12.0%")).toBeInTheDocument();
    expect(
      within(openCard as HTMLElement).getByText("90 opens over 7 days"),
    ).toBeInTheDocument();
    expect(
      within(clickCard as HTMLElement).getByText("24 clicks over 7 days"),
    ).toBeInTheDocument();
  });

  it("filters overview stats by the selected time range", async () => {
    renderModule();

    const filter = await screen.findByRole("combobox", {
      name: "Filter overview stats",
    });
    expect(filter).toHaveTextContent("7 days");

    fireEvent.keyDown(filter, { key: "Enter" });
    const yearOption = await screen.findByRole("option", { name: "1 year" });
    fireEvent.click(yearOption);

    await waitFor(() =>
      expect(contactMocks.getCampaignPerformanceOverview).toHaveBeenLastCalledWith(
        "user-1",
        "1y",
      ),
    );
    expect(filter).toHaveTextContent("1 year");
  });

  it("shows the workspace address read-only in campaign settings", async () => {
    contactMocks.getCampaignSettings.mockResolvedValue({
      batchDelaySeconds: null,
      batchSize: null,
      brandVoice: "friendly",
      footerText: "Sent by Acme",
      identityId: null,
      mailingAddress: "651 N Broad Street Middletown\nArivaca Junction, Arizona\n197098\nUnited States",
    });
    renderModule();
    await goToTab("Settings");

    const address = await screen.findByLabelText("Physical mailing address");
    expect(address).toHaveAttribute("readonly");
    expect(address).toHaveValue(
      "651 N Broad Street Middletown\nArivaca Junction, Arizona\n197098\nUnited States",
    );
    expect(
      screen.getByRole("link", { name: /Update address in General settings/ }),
    ).toHaveAttribute("href", "/dashboard?tab=settings&section=workspace");
    expect(screen.queryByText("Frequency capping")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Max campaigns")).not.toBeInTheDocument();
  });

  it("opens the builder full screen, with the dashboard chrome gone", async () => {
    renderModule();
    await openBuilder();

    expect(
      screen.queryByRole("navigation", { name: "Campaign sections" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Exit/ })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Save & Continue/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close builder" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Save & Continue/ })).toBeDisabled();
    expect(screen.getByLabelText("Campaign name")).toBeInTheDocument();
  });

  it("enables both builder save actions only after an email change", async () => {
    renderModule();
    await openBuilder();

    fireEvent.change(screen.getByLabelText("Preview line"), {
      target: { value: "A preview for the saved campaign." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Heading" }));

    expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Save & Continue/ })).toBeEnabled();
  });

  it("keeps the block palette docked and readable on arrival", async () => {
    renderModule();
    await openBuilder();

    expect(screen.getByRole("complementary", { name: "Blocks" })).toBeVisible();
    // Block types are legible without opening anything first.
    expect(screen.getByRole("button", { name: "Heading" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Countdown" })).toBeVisible();
    expect(screen.getByLabelText("Search blocks")).toBeVisible();
  });

  it("filters the palette by name and by what a block is for", async () => {
    renderModule();
    await openBuilder();

    // "discount" is not in the label — it matches the coupon block's keywords.
    fireEvent.change(screen.getByLabelText("Search blocks"), {
      target: { value: "discount" },
    });
    expect(
      await screen.findByRole("button", { name: "Coupon code" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Heading" }),
    ).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search blocks"), {
      target: { value: "zzzz" },
    });
    expect(await screen.findByText(/No block matches/)).toBeInTheDocument();
  });

  it("opens a picked block's settings in the right-hand panel", async () => {
    renderModule();
    await openBuilder();

    const settings = screen.getByRole("complementary", {
      name: "Block settings",
    });
    // With nothing selected the panel edits the campaign container.
    expect(within(settings).getByText("Campaign container")).toBeInTheDocument();
    // Subject and preview line belong above the canvas, not in this panel.
    expect(
      within(settings).queryByLabelText("Subject line"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Heading" }));

    await waitFor(() =>
      expect(
        within(settings).getByRole("tab", { name: "Details" }),
      ).toHaveAttribute("aria-selected", "true"),
    );
    expect(
      within(settings).getByRole("tab", { name: "Design" }),
    ).toBeInTheDocument();
    expect(
      within(settings).getByRole("tab", { name: "Advanced" }),
    ).toBeInTheDocument();
  });

  it("exposes typography, spacing and colour on the Design tab", async () => {
    renderModule();
    await openBuilder();

    fireEvent.click(screen.getByRole("button", { name: "Heading" }));
    const settings = screen.getByRole("complementary", {
      name: "Block settings",
    });
    fireEvent.click(within(settings).getByRole("tab", { name: "Design" }));

    // The Design tab opens on the element — the heading itself — because that
    // is what someone means by "style this block".
    expect(
      within(settings).getByRole("tab", { name: /The heading/ }),
    ).toHaveAttribute("aria-selected", "true");
    expect(await within(settings).findByLabelText("Size")).toBeVisible();
    expect(within(settings).getByLabelText("Text colour")).toBeVisible();
    expect(
      within(settings).getByRole("radiogroup", { name: "Weight" }),
    ).toBeVisible();

    // Switching to the container layer exposes the block's own spacing.
    fireEvent.click(within(settings).getByRole("tab", { name: /The block/ }));
    for (const side of ["Top", "Right", "Bottom", "Left"]) {
      expect(
        await within(settings).findByLabelText(`Padding ${side}`),
      ).toBeInTheDocument();
      expect(
        within(settings).getByLabelText(`Margin ${side}`),
      ).toBeInTheDocument();
    }
  });

  it("separates the element's border from the block's border", async () => {
    renderModule();
    await openBuilder();

    fireEvent.click(screen.getByRole("button", { name: "Button" }));
    const settings = screen.getByRole("complementary", {
      name: "Block settings",
    });
    fireEvent.click(within(settings).getByRole("tab", { name: "Design" }));

    // The element layer names the thing it styles.
    expect(
      await within(settings).findByRole("tab", { name: /The button/ }),
    ).toBeInTheDocument();
    fireEvent.click(within(settings).getByRole("button", { name: /Border/ }));
    const elementWidth = await within(settings).findByLabelText("Width");
    fireEvent.change(elementWidth, { target: { value: "3" } });

    // The container has its own, independent border control.
    fireEvent.click(within(settings).getByRole("tab", { name: /The block/ }));
    fireEvent.click(within(settings).getByRole("button", { name: /Border/ }));
    expect(await within(settings).findByLabelText("Width")).toHaveValue(null);
  });

  it("offers identifiers, visibility and custom CSS on the Advanced tab", async () => {
    renderModule();
    await openBuilder();

    fireEvent.click(screen.getByRole("button", { name: "Heading" }));
    const settings = screen.getByRole("complementary", {
      name: "Block settings",
    });
    fireEvent.click(within(settings).getByRole("tab", { name: "Advanced" }));

    expect(await within(settings).findByLabelText("HTML id")).toBeVisible();
    expect(within(settings).getByLabelText("CSS class")).toBeVisible();
    expect(within(settings).getByLabelText("Hide on mobile")).toBeVisible();
    expect(within(settings).getByLabelText("Custom CSS")).toBeVisible();
  });

  it("switches the canvas between editing and a clean preview", async () => {
    renderModule();
    await openBuilder();

    expect(
      screen.queryByRole("region", { name: "Campaign preview" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Preview/ }));
    expect(
      await screen.findByRole("region", { name: "Campaign preview" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Edit/ }));
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Campaign preview" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("edits a selected block's text in place on the canvas", async () => {
    renderModule();
    await openBuilder();

    // Nothing is writable until a block is picked, so a click selects rather
    // than dropping a caret into whatever was under the cursor.
    expect(
      screen.queryByRole("textbox", { name: /Edit Heading text/ }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getAllByRole("button", { name: /^Select Heading block/ })[0],
    );

    const editor = await screen.findByRole("textbox", {
      name: /Edit Heading text/,
    });
    expect(editor).toHaveAttribute("contenteditable", "true");
  });

  it("keeps structured blocks out of inline editing", async () => {
    renderModule();
    await openBuilder();

    // A compliance footer has no single line to type into; it is edited in the
    // panel, where its several fields have somewhere to live.
    fireEvent.click(
      screen.getAllByRole("button", { name: /^Select Footer block/ })[0],
    );
    await waitFor(() =>
      expect(
        screen.getByRole("complementary", { name: "Block settings" }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("textbox", { name: /Edit Footer text/ }),
    ).not.toBeInTheDocument();
  });

  it("opens the send-test dialog from inside the builder", async () => {
    // The dialog used to render only in the dashboard's own tree, below the
    // builder's early return — so pressing Send test set state but showed
    // nothing until the builder was closed.
    contactMocks.listContactCampaigns.mockResolvedValue([
      { ...scheduledCampaign, status: "draft" as const, scheduledAt: null },
    ]);
    renderModule();
    await goToTab("All campaigns");
    fireEvent.click(
      await screen.findByRole("button", { name: /Edit August teaser/ }),
    );
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByRole(
      "heading",
      { name: "Campaign settings" },
      { timeout: 10_000 },
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Save and continue" }));
    await screen.findByRole("region", { name: "Campaign builder" });
    await screen.findByRole("complementary", { name: "Blocks" }, { timeout: 3_000 });

    fireEvent.click(screen.getByRole("button", { name: /Send test/ }));

    expect(
      await screen.findByRole("heading", { name: "Send a test" }),
    ).toBeInTheDocument();
    // And the builder is still there behind it.
    expect(
      screen.getByRole("region", { name: "Campaign builder" }),
    ).toBeInTheDocument();
  });

  it("reports the send-test outcome in the dialog instead of closing", async () => {
    contactMocks.sendCampaignTest.mockRejectedValue(
      new Error("No sender identity is connected."),
    );
    contactMocks.listContactCampaigns.mockResolvedValue([
      { ...scheduledCampaign, status: "draft" as const, scheduledAt: null },
    ]);
    renderModule();
    await goToTab("All campaigns");
    fireEvent.click(
      await screen.findByRole("button", { name: /Edit August teaser/ }),
    );
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByRole(
      "heading",
      { name: "Campaign settings" },
      { timeout: 10_000 },
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Save and continue" }));
    await screen.findByRole("complementary", { name: "Blocks" }, { timeout: 3_000 });
    fireEvent.click(screen.getByRole("button", { name: /Send test/ }));

    fireEvent.change(await screen.findByLabelText("Send to"), {
      target: { value: "someone@example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Send test$/ }));

    // The failure is named in place, and the dialog stays open to retry.
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No sender identity is connected.",
    );
    expect(
      screen.getByRole("button", { name: /Try again/ }),
    ).toBeInTheDocument();
  });

  it("prompts to save unsaved work before leaving the builder", async () => {
    renderModule();
    await openBuilder();

    fireEvent.change(screen.getByLabelText("Campaign name"), {
      target: { value: "Half-finished draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Close builder" }));

    expect(
      await screen.findByRole("heading", { name: /Save your changes\?/ }),
    ).toBeInTheDocument();

    // Keeping editing leaves the work exactly where it was.
    fireEvent.click(screen.getByRole("button", { name: /Keep editing/ }));
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: /Save your changes\?/ }),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("region", { name: "Campaign builder" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Campaign name")).toHaveValue(
      "Half-finished draft",
    );
  });

  it("shows a saved edit again when the campaign is reopened", async () => {
    // A server that genuinely stores the edit, so the only thing under test is
    // whether the module ever looks at it again. Left to a stale cache, the
    // builder reopens on the pre-edit copy — which was the reported bug.
    let stored = {
      ...scheduledCampaign,
      status: "draft" as const,
      scheduledAt: null,
    };
    contactMocks.listContactCampaigns.mockImplementation(async () => [stored]);
    contactMocks.saveContactCampaign.mockImplementation(
      async (_userId, input) => {
        stored = {
          ...stored,
          name: input.name,
          subject: input.subject,
        };
        return stored.id;
      },
    );
    renderModule();
    await goToTab("All campaigns");
    fireEvent.click(await screen.findByRole("button", { name: /Edit August teaser/ }));
    const dialog = await screen.findByRole("dialog");
    expect(
      await within(dialog).findByRole(
        "heading",
        { name: "Campaign settings" },
        { timeout: 10_000 },
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Campaign name")).toHaveValue(
      "August teaser",
    );
    expect(within(dialog).getByLabelText("Email subject")).toHaveValue(
      "A quick July update",
    );

    fireEvent.change(within(dialog).getByLabelText("Campaign name"), {
      target: { value: "Edited in the builder" },
    });
    fireEvent.change(within(dialog).getByLabelText("Email subject"), {
      target: { value: "An edited subject" },
    });

    fireEvent.click(within(dialog).getByRole("button", { name: "I'll finish later" }));
    const prompt = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(prompt).getByRole("button", { name: "Save draft and close" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog"),
      ).not.toBeInTheDocument(),
    );

    fireEvent.click(
      await screen.findByRole("button", { name: /Edit Edited in the builder/ }),
    );
    const reopened = await screen.findByRole("dialog");
    expect(
      await within(reopened).findByRole(
        "heading",
        { name: "Campaign settings" },
        { timeout: 10_000 },
      ),
    ).toBeInTheDocument();
    expect(within(reopened).getByLabelText("Campaign name")).toHaveValue(
      "Edited in the builder",
    );
    expect(within(reopened).getByLabelText("Email subject")).toHaveValue(
      "An edited subject",
    );

    // Reopening an existing draft resumes its saved authoring surface. It
    // must not send the writer back through the template chooser.
    fireEvent.click(
      within(reopened).getByRole("button", { name: "Save and continue" }),
    );
    expect(
      await screen.findByRole("region", { name: "Campaign builder" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Design your email" }),
    ).not.toBeInTheDocument();
  });

  it("leaves without prompting when nothing has been edited", async () => {
    renderModule();
    await openBuilder();

    fireEvent.click(screen.getByRole("button", { name: "Close builder" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Campaign builder" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("offers device widths and follows the dashboard theme", async () => {
    renderModule();
    await openBuilder();

    expect(screen.getByLabelText("Desktop preview")).toBeInTheDocument();
    expect(screen.getByLabelText("Tablet preview")).toBeInTheDocument();
    expect(screen.getByLabelText("Mobile preview")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(
      await screen.findByRole("region", { name: "Campaign preview" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Tablet preview"));
    expect(screen.getByLabelText("Tablet preview")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Theme is inherited from the dashboard provider; builders do not expose
    // a second, conflicting light/dark switch.
    expect(screen.queryByLabelText("Light builder theme")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Dark builder theme")).not.toBeInTheDocument();
  });

  it("hands a finished design to the wizard rather than a publish tab", async () => {
    renderModule();
    await openWizard();

    await waitFor(() =>
      expect(contactMocks.completeCampaignBuilder).toHaveBeenCalledWith(
        "user-1",
        "campaign-3",
      ),
    );
    expect(
      screen.getByRole("heading", { name: /Who receives this/ }),
    ).toBeInTheDocument();
    expect(contactMocks.scheduleCampaignFromWizard).not.toHaveBeenCalled();
  });

  it("selects multiple CRM lists and shows the deliverable count", async () => {
    renderModule();
    await openWizard();

    // The first list is selected by default; adding a second list exercises the
    // union-and-deduplicate audience path.
    fireEvent.click(
      await screen.findByRole("checkbox", {
        name: "Select VIP customers",
      }),
    );
    await waitFor(() =>
      expect(contactMocks.saveCampaignWizardRecipients).toHaveBeenCalledWith(
        "user-1",
        "campaign-3",
        {
          audienceMode: "lists",
          listIds: ["list-1", "list-2"],
          customRecipients: [],
          excludeListId: null,
        },
      ),
    );
    // The number shown is who will actually receive it, not the list size.
    expect(await screen.findByText("Will receive this")).toBeInTheDocument();
    expect(screen.getByText("205")).toBeInTheDocument();
    expect(screen.getAllByText("240").length).toBeGreaterThan(0);
  });

  it("supports excluding a second list from the audience", async () => {
    renderModule();
    await openWizard();

    await chooseOption("Exclude (optional)", /VIP customers/);

    await waitFor(() =>
      expect(contactMocks.saveCampaignWizardRecipients).toHaveBeenLastCalledWith(
        "user-1",
        "campaign-3",
        {
          audienceMode: "lists",
          listIds: ["list-1"],
          customRecipients: [],
          excludeListId: "list-2",
        },
      ),
    );
  });

  it("accepts unlimited-in-practice custom email chips without a CRM list", async () => {
    renderModule();
    await openWizard();

    fireEvent.click(
      await screen.findByRole("button", { name: /Enter emails manually/ }),
    );
    const input = await screen.findByLabelText("Recipient email addresses");
    fireEvent.change(input, { target: { value: "one@example.com" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "two@example.com" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(contactMocks.saveCampaignWizardRecipients).toHaveBeenLastCalledWith(
        "user-1",
        "campaign-3",
        {
          audienceMode: "custom",
          listIds: [],
          customRecipients: ["one@example.com", "two@example.com"],
          excludeListId: null,
        },
      ),
    );
    expect(screen.getByText("one@example.com")).toBeInTheDocument();
    expect(screen.getByText("two@example.com")).toBeInTheDocument();
    expect(screen.getByText("2 emails")).toBeInTheDocument();
  });

  it("keeps sender setup in Email settings instead of collecting a sender email in campaigns", async () => {
    contactMocks.getCampaignWizardIdentities.mockResolvedValue({
      selectedIdentityId: null,
      identities: [],
    });
    renderModule();
    await openWizard();
    await advanceTo([/Who it comes from/]);

    expect(screen.getByText(/configure it in Email settings/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Sender email")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Save sender/ })).not.toBeInTheDocument();
  });

  it("summarises subject, sender, audience and pace before committing", async () => {
    renderModule();
    await openWizard();
    await advanceTo([/Who it comes from/, /Everything before it goes/]);

    expect(
      screen.getByText(/Acme News <newsletter@acme\.test>/),
    ).toBeInTheDocument();
    expect(screen.getByText(/5 waves of 50/)).toBeInTheDocument();
    expect(screen.getAllByText(/about 12 minutes/).length).toBeGreaterThan(0);
  });

  it("names what is blocking a send instead of failing silently", async () => {
    contactMocks.getCampaignWizardReview.mockResolvedValue({
      audience: audiencePreview,
      blockers: [
        "Add your physical mailing address in Campaigns settings. Marketing email is required to carry one.",
      ],
      campaign: { ...sentCampaign, id: "campaign-3", status: "draft" },
      canSend: false,
      identity,
      pacing,
      settings: { mailingAddress: "" },
    });
    renderModule();
    await openWizard();
    await advanceTo([/Who it comes from/, /Everything before it goes/]);

    expect(screen.getByText(/physical mailing address/i)).toBeInTheDocument();
    // Review cannot be left while a blocker stands.
    expect(screen.getByRole("button", { name: /^Continue/ })).toBeDisabled();
  });

  it("explains the wave pacing in plain terms before the send is confirmed", async () => {
    renderModule();
    await openWizard();
    await advanceTo([
      /Who it comes from/,
      /Everything before it goes/,
      /When it goes/,
    ]);

    expect(
      screen.getByText(/sends in waves to protect deliverability/i),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/about 12 minutes/).length).toBeGreaterThan(0);
  });

  it("only sends on the final confirm, never earlier in the flow", async () => {
    renderModule();
    await openWizard();
    await advanceTo([
      /Who it comes from/,
      /Everything before it goes/,
      /When it goes/,
    ]);

    fireEvent.click(screen.getByRole("button", { name: /Send now/ }));
    await advanceTo([/Send this campaign\?/]);
    expect(contactMocks.scheduleCampaignFromWizard).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Send campaign/ }));
    await waitFor(() =>
      expect(contactMocks.scheduleCampaignFromWizard).toHaveBeenCalledWith(
        "user-1",
        "campaign-3",
        expect.objectContaining({ strategy: "immediate" }),
      ),
    );
  });

  it("reports live batch progress for a campaign that is sending", async () => {
    contactMocks.listContactCampaigns.mockResolvedValue([
      sentCampaign,
      { ...scheduledCampaign, status: "sending" as const },
    ]);
    renderModule();
    await goToTab("All campaigns");

    const progress = await screen.findByRole("region", {
      name: /Send progress for August teaser/,
    });
    expect(within(progress).getByText("100")).toBeInTheDocument();
    expect(within(progress).getByText(/Wave 3 of 5/)).toBeInTheDocument();
    expect(
      within(progress).getByText(/50 per wave, 60s apart/),
    ).toBeInTheDocument();
    expect(
      within(progress).getByRole("progressbar", { name: /49% sent/ }),
    ).toBeInTheDocument();
  });

  it("pauses a send in flight and resumes it without re-sending anyone", async () => {
    contactMocks.listContactCampaigns.mockResolvedValue([
      { ...scheduledCampaign, status: "sending" as const, sendStartedAt: now },
    ]);
    renderModule();
    await goToTab("All campaigns");

    const progress = await screen.findByRole("region", {
      name: /Send progress for August teaser/,
    });

    // The server flips to paused as a result of this click; the refetch that
    // follows the mutation is what the UI is being checked against.
    contactMocks.getCampaignSendProgress.mockResolvedValue({
      ...sendingProgress,
      nextBatchAt: null,
      status: "paused",
    });
    contactMocks.listContactCampaigns.mockResolvedValue([
      { ...scheduledCampaign, status: "paused" as const, sendStartedAt: now },
    ]);

    fireEvent.click(within(progress).getByRole("button", { name: /Pause/ }));
    await waitFor(() =>
      expect(contactMocks.pauseContactCampaign).toHaveBeenCalledWith(
        "user-1",
        "campaign-2",
      ),
    );

    const resumed = await screen.findByRole("region", {
      name: /Send progress for August teaser/,
    });
    const resume = within(resumed).getByRole("button", { name: /Resume/ });
    expect(
      screen.getByText(/Resuming continues from the next wave/),
    ).toBeInTheDocument();
    fireEvent.click(resume);
    await waitFor(() =>
      expect(contactMocks.resumeContactCampaign).toHaveBeenCalledWith(
        "user-1",
        "campaign-2",
      ),
    );
  });

  it("asks for a future time when a paused campaign has not started", async () => {
    const paused = {
      ...scheduledCampaign,
      status: "paused" as const,
      scheduledAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
      sendStartedAt: null,
    };
    contactMocks.listContactCampaigns.mockResolvedValue([paused]);
    contactMocks.getCampaignSendProgress.mockResolvedValue({
      ...sendingProgress,
      campaignId: paused.id,
      startedAt: null,
      status: "paused",
    });

    renderModule();
    await goToTab("All campaigns");
    const progress = await screen.findByRole("region", {
      name: /Send progress for August teaser/,
    });
    fireEvent.click(within(progress).getByRole("button", { name: /Resume/ }));

    const dialog = await screen.findByRole("dialog");
    const scheduledAt = new Date(Date.now() + 2 * 60 * 60 * 1_000)
      .toISOString()
      .slice(0, 16);
    fireEvent.change(within(dialog).getByLabelText("Send date and time"), {
      target: { value: scheduledAt },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Resume campaign" }),
    );

    await waitFor(() =>
      expect(contactMocks.resumeContactCampaign).toHaveBeenCalledWith(
        "user-1",
        "campaign-2",
        expect.any(String),
      ),
    );
  });

  it("starts the create flow from New campaign, on step one", async () => {
    renderModule();
    await clickWhenEnabled(/New campaign/);

    const dialog = await screen.findByRole("dialog");
    // The flow opens on a loader and paints its content after, so this waits
    // rather than reading the panel mid-build.
    expect(
      await within(dialog).findByRole(
        "heading",
        { name: "Campaign settings" },
        { timeout: 10_000 },
      ),
    ).toBeInTheDocument();
    // The campaign list stays mounted behind the modal rather than being
    // replaced, so closing the flow returns to where it was opened from. It is
    // queried with hidden: true because an open modal marks the rest of the
    // page aria-hidden — present, but not in the accessibility tree.
    expect(
      screen.getByRole("navigation", {
        name: "Campaign sections",
        hidden: true,
      }),
    ).toBeInTheDocument();
  });

  it("fills the sender from the email identity instead of asking for it", async () => {
    renderModule();
    await clickWhenEnabled(/New campaign/);

    const dialog = await screen.findByRole("dialog");
    // Twice on purpose: the identity field, and the inbox preview's From line.
    expect(
      await within(dialog).findAllByText("Acme News", undefined, {
        timeout: 10_000,
      }),
    ).toHaveLength(2);
    expect(
      within(dialog).getByText("newsletter@acme.test"),
    ).toBeInTheDocument();
    // A From address a campaign could type in itself would not be verified.
    expect(
      within(dialog).queryByRole("textbox", { name: /From name/ }),
    ).not.toBeInTheDocument();
  });

  it("cannot leave step one without a subject line", async () => {
    renderModule();
    await clickWhenEnabled(/New campaign/);

    const dialog = await screen.findByRole("dialog");
    const advance = await within(dialog).findByRole(
      "button",
      { name: "Save and continue" },
      { timeout: 10_000 },
    );
    expect(advance).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText("Email subject"), {
      target: { value: "48 hours: 20% off" },
    });
    expect(advance).toBeEnabled();
  });

  it("holds the template gallery inside step two of the flow", async () => {
    renderModule();
    await clickWhenEnabled(/New campaign/);

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(
      await within(dialog).findByLabelText("Email subject", undefined, {
        timeout: 15_000,
      }),
      { target: { value: "48 hours: 20% off" } },
    );
    await clickWhenEnabled("Save and continue");

    expect(
      await within(dialog).findByRole(
        "heading",
        { name: "Design your email" },
        { timeout: 10_000 },
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: /Drag and drop builder/ }),
    ).toBeInTheDocument();
    // Picking a template lands in the builder rather than sending immediately.
    await clickWhenEnabled("Start creating");
    expect(
      await screen.findByRole("region", { name: "Campaign builder" }),
    ).toBeInTheDocument();
  });

  it("picks recipients from lists, one send at a time", async () => {
    renderModule();
    await openBuilder();
    // The builder holds Save & Continue until both inbox lines are written.
    fireEvent.change(await screen.findByLabelText("Subject line"), {
      target: { value: "48 hours: 20% off" },
    });
    fireEvent.change(screen.getByLabelText("Preview line"), {
      target: { value: "Ends Friday at midnight." },
    });
    await clickWhenEnabled(/Save & Continue/);

    const dialog = await screen.findByRole("dialog");
    expect(
      await within(dialog).findByText(/Selected recipients/, undefined, {
        timeout: 15_000,
      }),
    ).toBeInTheDocument();
    // List audiences are multi-select checkboxes.
    const rows = within(dialog).getAllByRole("checkbox");
    expect(rows.length).toBeGreaterThan(0);
  });

  it("accepts custom recipients in the primary create flow before review", async () => {
    renderModule();
    await openBuilder();
    fireEvent.change(await screen.findByLabelText("Subject line"), {
      target: { value: "48 hours: 20% off" },
    });
    fireEvent.change(screen.getByLabelText("Preview line"), {
      target: { value: "Ends Friday at midnight." },
    });
    await clickWhenEnabled(/Save & Continue/);

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      await within(dialog).findByRole("button", {
        name: /Enter emails manually/,
      }),
    );
    const input = within(dialog).getByLabelText("Recipient email addresses");
    fireEvent.change(input, { target: { value: "one@example.com" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "two@example.com" } });
    fireEvent.keyDown(input, { key: "Enter" });

    const continueButton = within(dialog).getByRole("button", {
      name: "Save and continue",
    });
    await waitFor(() => expect(continueButton).toBeEnabled());
    fireEvent.click(continueButton);

    await waitFor(() =>
      expect(contactMocks.saveContactCampaign).toHaveBeenLastCalledWith(
        "user-1",
        expect.objectContaining({
          id: "campaign-3",
          audienceMode: "custom",
          listIds: [],
          customRecipients: ["one@example.com", "two@example.com"],
          excludeListId: null,
        }),
      ),
    );
    expect(
      await within(dialog).findByText("Custom email addresses"),
    ).toBeInTheDocument();
  });

  it("keeps row actions behind a single overflow menu", async () => {
    renderModule();
    await goToTab("All campaigns");

    // The card carries one primary action; the rest are one click away.
    // A Radix dropdown opens from the keyboard reliably under jsdom, where its
    // pointer-based path depends on APIs jsdom does not implement.
    fireEvent.keyDown(
      await screen.findByRole("button", {
        name: "More actions for July update",
      }),
      { key: "Enter" },
    );

    const menu = await screen.findByRole("menu");
    expect(
      within(menu).getByRole("menuitem", { name: "Duplicate" }),
    ).toBeVisible();
    // Reusing a finished campaign is one click: copy it and open the copy.
    expect(
      within(menu).getByRole("menuitem", { name: /Duplicate & edit/ }),
    ).toBeVisible();
    expect(
      within(menu).getByRole("menuitem", { name: /Send a test/ }),
    ).toBeVisible();
    // A sent campaign can be archived or explicitly deleted.
    expect(within(menu).getByRole("menuitem", { name: /Archive/ })).toBeVisible();
    expect(
      within(menu).getByRole("menuitem", { name: /Delete/ }),
    ).toBeVisible();

    fireEvent.click(within(menu).getByRole("menuitem", { name: /Archive/ }));
    await waitFor(() =>
      expect(contactMocks.archiveContactCampaign).toHaveBeenCalledWith(
        "user-1",
        "campaign-1",
      ),
    );
  });

  it("confirms before sending a scheduled campaign immediately", async () => {
    renderModule();
    await goToTab("All campaigns");

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Send August teaser now",
      }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", {
        name: "Send this campaign now?",
      }),
    ).toBeInTheDocument();
    expect(contactMocks.sendContactCampaignNow).not.toHaveBeenCalled();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Send campaign now" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(contactMocks.sendContactCampaignNow).toHaveBeenCalledWith(
        "user-1",
        "campaign-2",
      ),
    );
  });

  it.each([
    {
      mode: "builder" as const,
      blocks: [
        { id: "heading-1", type: "heading", content: "Saved heading" },
        { id: "text-1", type: "text", content: "Saved body" },
        { id: "button-1", type: "button", label: "Read more", url: "https://example.test" },
      ],
      field: null,
    },
    {
      mode: "plain_text" as const,
      blocks: [{ id: "text-1", type: "text", content: "Saved plain text" }],
      field: "Plain text body",
    },
    {
      mode: "custom_html" as const,
      blocks: [{ id: "html-1", type: "html", html: "<h1>Saved HTML</h1>" }],
      field: "Custom HTML source",
    },
  ])(
    "Duplicate & edit opens the saved $mode builder after Settings",
    async ({ mode, blocks, field }) => {
      contactMocks.listContactCampaigns.mockResolvedValue([
        {
          ...sentCampaign,
          blocks: [
            {
              type: "campaign_design",
              version: 1,
              authoringMode: mode,
              accent: "#635BFF",
              pageBackground: "#F5F7FB",
              cardBackground: "#FFFFFF",
              footerText: "Sent by Acme",
              blocks,
            },
          ],
        },
      ]);
      renderModule();
      await goToTab("All campaigns");
      fireEvent.keyDown(
        await screen.findByRole("button", {
          name: "More actions for July update",
        }),
        { key: "Enter" },
      );
      const menu = await screen.findByRole("menu");
      fireEvent.click(within(menu).getByRole("menuitem", { name: /Duplicate & edit/ }));

      await waitFor(() =>
        expect(contactMocks.duplicateContactCampaign).toHaveBeenCalledWith(
          "user-1",
          "campaign-1",
        ),
      );
      const settings = await screen.findByRole("dialog");
      expect(
        await within(settings).findByRole(
          "heading",
          { name: "Campaign settings" },
          { timeout: 15_000 },
        ),
      ).toBeInTheDocument();
      fireEvent.change(within(settings).getByLabelText("Campaign name"), {
        target: { value: "Duplicated campaign" },
      });
      fireEvent.click(
        within(settings).getByRole("button", { name: "Save and continue" }),
      );

      expect(
        await screen.findByRole("region", { name: "Campaign builder" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Design your email" })).not.toBeInTheDocument();
      if (field) {
        expect(await screen.findByLabelText(field)).toBeInTheDocument();
      }
    },
  );

  it("guides the user to create an audience before a campaign", async () => {
    contactMocks.listContactLists.mockResolvedValue([]);
    contactMocks.listContactCampaigns.mockResolvedValue([]);
    renderModule();
    await goToTab("All campaigns");

    expect(
      await screen.findByText(/Create a list or segment under CRM/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /New campaign/ })).toBeDisabled();
  });

  describe("text-only and custom HTML", () => {
    /** Flow → design step → the chosen authoring mode's own editor. */
    const openModeEditor = async (mode: RegExp) => {
      renderModule();
      await clickWhenEnabled(/New campaign/);
      fireEvent.change(
        await screen.findByLabelText("Email subject", undefined, { timeout: 15_000 }),
        { target: { value: "48 hours: 20% off" } },
      );
      await clickWhenEnabled("Save and continue");
      await clickWhenEnabled(mode);
      await clickWhenEnabled("Start creating");
      return screen.findByRole(
        "region",
        { name: "Campaign builder" },
        { timeout: 15_000 },
      );
    };

    it("opens plain text in a builder with type settings and no block palette", async () => {
      await openModeEditor(/Plain text email/);

      const panel = await screen.findByRole(
        "complementary",
        { name: "Type settings" },
        { timeout: 15_000 },
      );
      const body = await screen.findByLabelText("Plain text body");
      expect(body).toHaveClass("resize-y");
      expect(body).toHaveClass("overflow-y-auto");
      expect(panel).toHaveClass("border-l");
      expect(panel).not.toHaveClass("border-r");
      // A text-only email has no blocks to drag, so the rail carries the
      // document's own typography instead of a palette.
      expect(
        screen.queryByRole("complementary", { name: "Blocks" }),
      ).not.toBeInTheDocument();
      expect(
        within(panel).getByLabelText("Link colour", { exact: true }),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();
      expect(screen.getByRole("button", { name: /Save & Continue/ })).toBeDisabled();
      for (const field of [
        "Body text font size",
        "Heading 1 font size",
        "Heading 2 font size",
        "Heading 3 font size",
        "Language",
      ]) {
        expect(within(panel).getByLabelText(field)).toBeInTheDocument();
      }

      const bodySize = within(panel).getByLabelText("Body text font size");
      fireEvent.change(bodySize, { target: { value: "21" } });
      expect(bodySize).toHaveValue(21);
      expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled();
      expect(screen.getByRole("button", { name: /Save & Continue/ })).toBeDisabled();

      fireEvent.change(body, { target: { value: "Hello from the campaign." } });
      fireEvent.change(screen.getByLabelText("Preview line"), {
        target: { value: "A preview for the plain-text campaign." },
      });
      expect(screen.getByRole("button", { name: /Save & Continue/ })).toBeEnabled();
    });

    it("returns to the design step as continue editing for the same mode", async () => {
      await openModeEditor(/Plain text email/);
      await screen.findByLabelText("Plain text body");

      fireEvent.click(screen.getByRole("button", { name: /^Exit/ }));
      await waitFor(
        () =>
          expect(
            screen.queryByRole("region", { name: "Campaign builder" }),
          ).not.toBeInTheDocument(),
        { timeout: 15_000 },
      );
      expect(
        await screen.findByRole(
          "button",
          { name: "Continue editing" },
          { timeout: 15_000 },
        ),
      ).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Custom HTML email" }));
      expect(
        await screen.findByRole(
          "button",
          { name: "Start creating" },
          { timeout: 15_000 },
        ),
      ).toBeInTheDocument();
    });

    it("previews plain text at responsive widths without leaving the builder", async () => {
      await openModeEditor(/Plain text email/);
      fireEvent.change(await screen.findByLabelText("Plain text body"), {
        target: { value: "A responsive plain-text message." },
      });

      fireEvent.click(screen.getByRole("button", { name: "Preview" }));
      expect(
        await screen.findByRole("region", { name: "Campaign live preview" }),
      ).toBeInTheDocument();
      expect(screen.getByText("A responsive plain-text message.")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Tablet preview" }));
      expect(screen.getByRole("button", { name: "Tablet preview" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );

      fireEvent.click(screen.getByRole("button", { name: "Edit" }));
      expect(await screen.findByLabelText("Plain text body")).toBeInTheDocument();
    });

    it("writes a variable by name rather than making anyone type the token", async () => {
      await openModeEditor(/Plain text email/);
      const body = await screen.findByLabelText("Plain text body");

      fireEvent.click(screen.getByRole("button", { name: /^Variable/ }));
      const firstName = await screen.findByText("First name");
      // The menu offers labels; the braces never appear on screen.
      expect(screen.queryByText("{{contact.firstName}}")).not.toBeInTheDocument();

      fireEvent.click(firstName);
      await waitFor(() =>
        expect((body as HTMLTextAreaElement).value).toContain("{{contact.firstName}}"),
      );
    });

    it("saves a simple draft in place and confirms before exiting", async () => {
      await openModeEditor(/Plain text email/);
      const body = await screen.findByLabelText("Plain text body");
      fireEvent.change(body, { target: { value: "Saved without leaving." } });

      await clickWhenEnabled("Save draft");
      await waitFor(() =>
        expect(contactMocks.saveContactCampaign).toHaveBeenCalled(),
      );
      expect(screen.getByRole("region", { name: "Campaign builder" })).toBeInTheDocument();

      fireEvent.change(body, { target: { value: "Changed after saving." } });
      fireEvent.click(screen.getByRole("button", { name: /^Exit/ }));
      expect(
        await screen.findByRole("heading", { name: /Save your changes\?/ }),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /Keep editing/ }));
      await waitFor(() =>
        expect(screen.queryByRole("heading", { name: /Save your changes\?/ })).not.toBeInTheDocument(),
      );
      expect(screen.getByLabelText("Plain text body")).toHaveValue(
        "Changed after saving.",
      );
    });

    it("uses the close icon's unsaved-changes guard", async () => {
      await openModeEditor(/Plain text email/);
      fireEvent.change(await screen.findByLabelText("Plain text body"), {
        target: { value: "A change that needs confirmation." },
      });

      fireEvent.click(screen.getByRole("button", { name: "Close builder" }));
      expect(
        await screen.findByRole("heading", { name: /Save your changes\?/ }),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /Keep editing/ }));
      expect(screen.getByRole("region", { name: "Campaign builder" })).toBeInTheDocument();
    });

    it("shows custom HTML beside a sandboxed preview", async () => {
      await openModeEditor(/Custom HTML email/);

      const source = await screen.findByLabelText("Custom HTML source");
      expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();
      expect(screen.getByRole("button", { name: /Save & Continue/ })).toBeDisabled();
      fireEvent.change(source, { target: { value: "<h1>Hand written</h1>" } });
      fireEvent.change(screen.getByLabelText("Preview line"), {
        target: { value: "A preview for the HTML campaign." },
      });

      expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled();
      expect(screen.getByRole("button", { name: /Save & Continue/ })).toBeEnabled();

      const frame = await screen.findByTitle("Custom HTML preview");
      // Pasted markup is somebody else's code: it renders with no scripts and
      // no same-origin access.
      expect(frame).toHaveAttribute("sandbox", "");
      expect(frame).toHaveAttribute("srcdoc", "<h1>Hand written</h1>");

      fireEvent.click(screen.getByRole("button", { name: "Preview" }));
      expect(
        await screen.findByRole("region", { name: "Campaign live preview" }),
      ).toBeInTheDocument();
      expect(await screen.findByTitle("Custom HTML live preview")).toHaveAttribute(
        "srcdoc",
        "<h1>Hand written</h1>",
      );
    });

    it("reopens a saved simple campaign directly in its builder", async () => {
      contactMocks.listContactCampaigns.mockResolvedValue([
        {
          ...scheduledCampaign,
          name: "Plain saved campaign",
          status: "draft" as const,
          blocks: [
            {
              type: "campaign_design",
              version: 1,
              authoringMode: "plain_text",
              accent: "#635BFF",
              pageBackground: "#F5F7FB",
              cardBackground: "#FFFFFF",
              footerText: "Sent by Acme",
              blocks: [
                { id: "text-1", type: "text", content: "Saved message" },
                { id: "footer-1", type: "compliance_footer" },
              ],
            },
          ],
        },
      ]);
      renderModule();
      await goToTab("All campaigns");
      fireEvent.click(
        await screen.findByRole("button", { name: /Edit Plain saved campaign/ }),
      );
      const dialog = await screen.findByRole("dialog");
      expect(
        await within(dialog).findByRole(
          "heading",
          { name: "Campaign settings" },
          { timeout: 10_000 },
        ),
      ).toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole("button", { name: "Save and continue" }));
      expect(
        await screen.findByRole(
          "region",
          { name: "Campaign builder" },
          { timeout: 10_000 },
        ),
      ).toBeInTheDocument();
      expect(await screen.findByLabelText("Plain text body")).toHaveValue(
        "Saved message",
      );
      expect(
        screen.queryByPlaceholderText("Find template by name"),
      ).not.toBeInTheDocument();
    });

    it("confirms before discarding the design, and keeps it when declined", async () => {
      await openModeEditor(/Plain text email/);
      const body = await screen.findByLabelText("Plain text body");
      fireEvent.change(body, { target: { value: "Written by hand." } });

      fireEvent.click(screen.getByRole("button", { name: /Start from scratch/ }));
      const prompt = await screen.findByRole("alertdialog");
      expect(prompt).toHaveTextContent(/discarded/i);

      fireEvent.click(within(prompt).getByRole("button", { name: /Keep what I have/ }));
      await waitFor(() =>
        expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
      );
      expect((body as HTMLTextAreaElement).value).toBe("Written by hand.");
    });

    it("returns to the template gallery once starting again is confirmed", async () => {
      await openModeEditor(/Plain text email/);
      // The editor holds on its opening loader before the header paints, so
      // this waits for the writing surface rather than for the shell.
      await screen.findByLabelText("Plain text body");

      fireEvent.click(screen.getByRole("button", { name: /Start from scratch/ }));
      const prompt = await screen.findByRole("alertdialog");
      fireEvent.click(
        within(prompt).getByRole("button", { name: /Discard and start again/ }),
      );

      // Back on the design step, on the block builder's gallery. Awaited
      // rather than asserted on the resolved node: the step wrapper remounts to
      // replay its entrance, so a node captured a moment ago may already be
      // detached by the time the assertion runs.
      await screen.findByRole(
        "heading",
        { name: "Design your email" },
        { timeout: 15_000 },
      );
      expect(
        await screen.findByPlaceholderText("Find template by name", undefined, {
          timeout: 15_000,
        }),
      ).toBeInTheDocument();
    });
  });
});

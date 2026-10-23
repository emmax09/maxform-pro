import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { OnboardingFlow } from "@/components/onboarding/OnboardingFlow";
import type { OnboardingAnswers, OnboardingState } from "@/lib/onboarding";

const emptyState: OnboardingState = {
  businessName: "",
  businessType: "",
  industry: "",
  brandColor: "#F93D0A",
  logoUrl: "",
  teamSize: "",
  websiteUrl: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  stateRegion: "",
  postalCode: "",
  country: "",
  goals: [],
  modules: [],
  referralSource: "",
  currentStep: 0,
  completed: false,
  skipped: false,
  mailingAddress: "",
};

const handlers = {
  onSaveStep: vi.fn<(answers: OnboardingAnswers) => Promise<unknown>>(),
  onComplete: vi.fn<(answers: OnboardingAnswers) => Promise<unknown>>(),
  onSkip: vi.fn<() => Promise<unknown>>(),
};

const renderFlow = (initial: Partial<OnboardingState> = {}) =>
  render(
    <OnboardingFlow
      initial={{ ...emptyState, ...initial }}
      fullName="Ada Lovelace"
      onSaveStep={handlers.onSaveStep}
      onComplete={handlers.onComplete}
      onSkip={handlers.onSkip}
    />,
  );

/** Fills the required business name and moves to the brand step. */
const startFlow = async () => {
  fireEvent.change(screen.getByLabelText("Business or workspace name"), {
    target: { value: "Acme Events" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
  await screen.findByRole("heading", { name: /Set up your brand/ });
};

/** Business → brand → goals, taking the default brand colour as given. */
const startToGoals = async () => {
  await startFlow();
  fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
  await screen.findByRole("heading", { name: /What do you want to get done/ });
};

describe("OnboardingFlow", () => {
  beforeAll(() => {
    // jsdom implements neither of these, and Radix Select needs both.
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => {};
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.scrollIntoView = () => {};
    window.scrollTo = () => {};
  });

  beforeEach(() => {
    Object.values(handlers).forEach((handler) => handler.mockReset());
    handlers.onSaveStep.mockResolvedValue(undefined);
    handlers.onComplete.mockResolvedValue(undefined);
    handlers.onSkip.mockResolvedValue(undefined);
  });

  it("greets the new user by name and opens on the first step", () => {
    renderFlow();

    expect(
      screen.getByRole("heading", { name: /Welcome, Ada/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Step 1 of 6/)).toBeInTheDocument();
  });

  it("will not advance without the one answer it actually needs", async () => {
    renderFlow();

    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /business or workspace name/i,
    );
    expect(handlers.onSaveStep).not.toHaveBeenCalled();
  });

  it("saves each step on the way out so an interrupted signup can resume", async () => {
    renderFlow();
    await startToGoals();

    expect(handlers.onSaveStep).toHaveBeenCalledWith(
      expect.objectContaining({ businessName: "Acme Events", currentStep: 1 }),
    );
  });

  it("resumes at the step the account stopped on", async () => {
    renderFlow({ currentStep: 4, businessName: "Acme Events" });

    expect(
      screen.getByRole("heading", { name: /Where is your business based/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Step 5 of 6/)).toBeInTheDocument();
  });

  it("collects goals and tools as multi-select", async () => {
    renderFlow();
    await startToGoals();

    const goals = screen.getByRole("group", { name: "Goals" });
    fireEvent.click(
      within(goals).getByRole("checkbox", { name: /Run email campaigns/ }),
    );
    fireEvent.click(
      within(goals).getByRole("checkbox", { name: /Sell event tickets/ }),
    );
    expect(
      within(goals).getByRole("checkbox", { name: /Run email campaigns/ }),
    ).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    await waitFor(() =>
      expect(handlers.onSaveStep).toHaveBeenLastCalledWith(
        expect.objectContaining({
          goals: ["run-campaigns", "sell-tickets"],
          currentStep: 3,
        }),
      ),
    );
  });

  it("explains why the postal address is being asked for", async () => {
    renderFlow({ currentStep: 4, businessName: "Acme Events" });

    expect(
      screen.getByText(/required by law to carry a physical address/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/add it to your campaign footer/i),
    ).toBeInTheDocument();
  });

  it("carries the address through to completion", async () => {
    renderFlow({ currentStep: 4, businessName: "Acme Events" });

    fireEvent.change(screen.getByLabelText("Street address"), {
      target: { value: "1 Example Street" },
    });
    fireEvent.change(screen.getByLabelText("City"), {
      target: { value: "Lagos" },
    });
    fireEvent.change(screen.getByLabelText("Country"), {
      target: { value: "Nigeria" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    await screen.findByRole("heading", { name: /You are all set/ });
    expect(screen.getByText(/1 Example Street, Lagos, Nigeria/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Go to my workspace/ }));
    await waitFor(() =>
      expect(handlers.onComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          addressLine1: "1 Example Street",
          city: "Lagos",
          country: "Nigeria",
        }),
      ),
    );
  });

  it("lets someone get to work now and answer later", async () => {
    renderFlow();

    fireEvent.click(screen.getByRole("button", { name: /Skip for now/ }));
    await waitFor(() => expect(handlers.onSkip).toHaveBeenCalled());
    expect(handlers.onComplete).not.toHaveBeenCalled();
  });

  it("keeps earlier answers when stepping back", async () => {
    renderFlow();
    await startFlow();

    fireEvent.click(screen.getByRole("button", { name: /Back/ }));
    expect(
      await screen.findByLabelText("Business or workspace name"),
    ).toHaveValue("Acme Events");
  });

  it("asks for brand identity as its own required step", async () => {
    renderFlow();
    await startFlow();

    expect(
      screen.getByRole("heading", { name: /Set up your brand/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/every form, ticket, invoice and campaign/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Logo (optional)")).toBeInTheDocument();
  });

  it("will not leave the brand step without a usable colour", async () => {
    renderFlow({ brandColor: "" });
    await startFlow();

    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /colour that represents your brand/i,
    );
    // The step is still on screen; nothing advanced past the missing answer.
    expect(
      screen.getByRole("heading", { name: /Set up your brand/ }),
    ).toBeInTheDocument();
  });

  it("records the chosen brand colour", async () => {
    renderFlow({ brandColor: "" });
    await startFlow();

    fireEvent.click(
      screen.getByRole("radio", { name: "Brand colour #DB2777" }),
    );
    expect(
      screen.getByRole("radio", { name: "Brand colour #DB2777" }),
    ).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    await waitFor(() =>
      expect(handlers.onSaveStep).toHaveBeenLastCalledWith(
        expect.objectContaining({ brandColor: "#DB2777", currentStep: 2 }),
      ),
    );
  });

  it("previews the brand on the surfaces it will actually appear on", async () => {
    renderFlow();
    await startFlow();

    expect(screen.getByText("How it will look")).toBeInTheDocument();
    // With no logo yet, initials stand in rather than leaving a hole.
    expect(screen.getByText("AE")).toBeInTheDocument();
    expect(screen.getAllByText("Acme Events").length).toBeGreaterThan(0);
  });

  it("treats the logo as optional so a brand without artwork can proceed", async () => {
    renderFlow();
    await startFlow();

    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    await screen.findByRole("heading", { name: /What do you want to get done/ });
    expect(handlers.onSaveStep).toHaveBeenLastCalledWith(
      expect.objectContaining({ logoUrl: "" }),
    );
  });

  it("surfaces a save failure instead of advancing past it", async () => {
    handlers.onSaveStep.mockRejectedValue(new Error("Network unavailable."));
    renderFlow();

    fireEvent.change(screen.getByLabelText("Business or workspace name"), {
      target: { value: "Acme Events" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Network unavailable.",
    );
    expect(screen.getByText(/Step 1 of 6/)).toBeInTheDocument();
  });
});

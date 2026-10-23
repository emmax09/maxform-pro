// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EventTicketDesignTemplate } from "@/components/events/event-types";
import { TicketTemplateDesigner } from "@/components/events/TicketTemplateDesigner";

const template: EventTicketDesignTemplate = {
  id: "noir-stage",
  createdBy: null,
  sourceTemplateId: null,
  isSystem: true,
  name: "Noir Stage",
  category: "Concert",
  description: "A concert ticket",
  theme: {
    background: "#0B0B0D",
    accent: "#F43F5E",
    text: "#FFFFFF",
    muted: "#A1A1AA",
    edge: "solid",
    motif: "none",
  },
  frontLayout: [
    {
      id: "event-name",
      type: "event_name",
      label: "Event name",
      x: 6,
      y: 12,
      width: 50,
      size: "large",
    },
    {
      id: "qr",
      type: "qr",
      label: "Secure QR",
      x: 76,
      y: 20,
      width: 16,
    },
  ],
  backLayout: [],
};

describe("TicketTemplateDesigner save flow", () => {
  it("saves in place and only enables save when the draft changed", async () => {
    const onBack = vi.fn();
    const onSaved = vi.fn();
    const onSaveTemplate = vi.fn(async (draft: EventTicketDesignTemplate) => draft);

    render(
      <TicketTemplateDesigner
        template={template}
        userId="workspace-user"
        onBack={onBack}
        onSaved={onSaved}
        onSaveTemplate={onSaveTemplate}
        saveLabel="Save event ticket"
      />,
    );

    const saveButton = screen.getByRole("button", { name: "Save event ticket" });
    expect(saveButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Template name"), {
      target: { value: "Noir Stage Updated" },
    });
    expect(saveButton).toBeEnabled();

    fireEvent.click(saveButton);

    await waitFor(() => expect(onSaveTemplate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(saveButton).toBeDisabled();
    expect(saveButton).not.toHaveAttribute("aria-busy");
    expect(
      saveButton.querySelector("[data-button-loading-indicator]"),
    ).not.toBeInTheDocument();
    expect(onBack).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Template name")).toHaveValue(
      "Noir Stage Updated",
    );
  });

  it("offers a dynamic block previewing the event's purchased ticket types", () => {
    render(
      <TicketTemplateDesigner
        template={template}
        ticketTypeNames={["VIP Access", "General Admission"]}
        userId="workspace-user"
        onBack={vi.fn()}
        onSaved={vi.fn()}
        onSaveTemplate={vi.fn(async (draft) => draft)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add element" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: /Purchased ticket type Automatically shows VIP/i,
      }),
    );

    expect(screen.getByText("Live purchase field")).toBeInTheDocument();
    expect(screen.getAllByText("VIP Access").length).toBeGreaterThan(0);
    expect(screen.getByText(/exact ticket tier selected at checkout/i)).toBeInTheDocument();
    expect(screen.getByText("Automatic preview")).toBeInTheDocument();
    expect(screen.queryByText("Preview with ticket type")).not.toBeInTheDocument();
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const toasts = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: toasts }));

import { WorkflowChecksView } from "@/components/workflows/WorkflowChecksView";

const renderChecks = (
  over: Partial<Parameters<typeof WorkflowChecksView>[0]> = {},
) =>
  render(
    <WorkflowChecksView
      workflowName="Signup routing"
      datasets={[]}
      loading={false}
      onRefresh={vi.fn()}
      onSave={vi.fn().mockResolvedValue(undefined)}
      onRun={vi.fn().mockResolvedValue(undefined)}
      {...over}
    />,
  );

// The toast spies are module-level, so a success recorded by one test would
// otherwise still be on the books when the next asserts it never happened.
afterEach(() => {
  toasts.success.mockClear();
  toasts.error.mockClear();
  toasts.warning.mockClear();
});

describe("regression checks", () => {
  it("separates no checks from a failed load", () => {
    const { unmount } = renderChecks();
    expect(screen.getByText("No checks yet")).toBeInTheDocument();
    unmount();

    renderChecks({ error: "Checks could not be loaded." });
    expect(screen.getByText("Checks could not be loaded")).toBeInTheDocument();
    expect(screen.queryByText("No checks yet")).toBeNull();
  });

  it("refuses invalid JSON on the field rather than only in a toast", async () => {
    const onSave = vi.fn();
    renderChecks({ onSave });

    fireEvent.change(screen.getByLabelText("Sample trigger payload"), {
      target: { value: "{not json" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save check/i }));

    expect(await screen.findByText("This is not valid JSON.")).toBeInTheDocument();
    // The invalid value and the reason stay on screen together.
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Sample trigger payload")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("clears the JSON error once the payload is edited again", async () => {
    renderChecks();
    const field = screen.getByLabelText("Sample trigger payload");

    fireEvent.change(field, { target: { value: "{nope" } });
    fireEvent.click(screen.getByRole("button", { name: /save check/i }));
    expect(await screen.findByText("This is not valid JSON.")).toBeInTheDocument();

    fireEvent.change(field, { target: { value: '{"email":"a@b.com"}' } });
    expect(screen.queryByText("This is not valid JSON.")).toBeNull();
  });

  it("falls back to a name derived from the workflow", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    renderChecks({ onSave });

    fireEvent.click(screen.getByRole("button", { name: /save check/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0].name).toBe("Signup routing checks");
  });

  it("reports a save failure instead of appearing to succeed", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("Checks are read-only."));
    renderChecks({ onSave });

    fireEvent.click(screen.getByRole("button", { name: /save check/i }));

    await waitFor(() => expect(toasts.error).toHaveBeenCalled());
    expect(toasts.success).not.toHaveBeenCalled();
  });

  it("shows the last score against each saved check", () => {
    renderChecks({
      datasets: [
        {
          id: "dataset-1",
          workflowId: "workflow-1",
          name: "Happy path",
          cases: [],
          lastRun: { score: 100 },
        },
        {
          id: "dataset-2",
          workflowId: "workflow-1",
          name: "Never run",
          cases: [],
          lastRun: null,
        },
      ],
    });

    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByText(/not run yet/)).toBeInTheDocument();
  });

  it("runs one check at a time", async () => {
    const onRun = vi.fn().mockResolvedValue(undefined);
    renderChecks({
      datasets: [
        { id: "dataset-1", workflowId: "workflow-1", name: "Happy path", cases: [], lastRun: null },
      ],
      onRun,
    });

    fireEvent.click(screen.getByRole("button", { name: /^run$/i }));
    await waitFor(() => expect(onRun).toHaveBeenCalledWith("dataset-1"));
  });
});

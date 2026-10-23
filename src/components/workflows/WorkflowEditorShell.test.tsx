import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  WorkflowEditorShell,
  WorkflowExitDialog,
  WorkflowOpeningState,
  WorkflowSaveState,
} from "@/components/workflows/WorkflowEditorShell";

describe("save state", () => {
  it("states a normal save quietly", () => {
    render(<WorkflowSaveState state="saved" updatedAt="11:00 AM" />);
    expect(screen.getByText("Saved 11:00 AM")).toBeInTheDocument();
  });

  it("keeps a failed save on screen with a way to retry", () => {
    const onRetry = vi.fn();
    render(
      <WorkflowSaveState
        state="error"
        updatedAt=""
        error="Workflow could not be saved."
        onRetry={onRetry}
      />,
    );

    // A toast disappears while the work is still only in the browser.
    expect(screen.getByText("Workflow could not be saved.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("distinguishes unsaved from saving", () => {
    const { rerender } = render(
      <WorkflowSaveState state="unsaved" updatedAt="" />,
    );
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    rerender(<WorkflowSaveState state="saving" updatedAt="" />);
    expect(screen.getByText("Saving…")).toBeInTheDocument();
  });
});

describe("opening state", () => {
  it("names the workflow being opened", () => {
    render(<WorkflowOpeningState name="Signup routing" />);
    expect(screen.getByText("Opening Signup routing…")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Opening workflow" })).toBeInTheDocument();
  });

  it("offers a way forward when the workflow cannot be opened", () => {
    const onRetry = vi.fn();
    const onCancel = vi.fn();
    render(
      <WorkflowOpeningState
        error="This workflow no longer exists."
        onRetry={onRetry}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("This workflow no longer exists.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: /back to workflows/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});

describe("unsaved changes gate", () => {
  const setup = (over: Partial<Parameters<typeof WorkflowExitDialog>[0]> = {}) => {
    const handlers = {
      onSaveAndExit: vi.fn(),
      onDiscard: vi.fn(),
      onContinue: vi.fn(),
    };
    render(
      <WorkflowExitDialog open saving={false} {...handlers} {...over} />,
    );
    return handlers;
  };

  it("offers all three ways out", () => {
    setup();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: /save & exit/i })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /discard changes/i })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /continue editing/i })).toBeInTheDocument();
  });

  it("continues editing without leaving", () => {
    const handlers = setup();
    fireEvent.click(screen.getByRole("button", { name: /continue editing/i }));
    expect(handlers.onContinue).toHaveBeenCalledOnce();
    expect(handlers.onDiscard).not.toHaveBeenCalled();
  });

  it("discards only when discard is chosen", () => {
    const handlers = setup();
    fireEvent.click(screen.getByRole("button", { name: /discard changes/i }));
    expect(handlers.onDiscard).toHaveBeenCalledOnce();
    expect(handlers.onSaveAndExit).not.toHaveBeenCalled();
  });

  it("shows why a save-and-exit failed instead of closing", () => {
    setup({ error: "Workflow could not be saved." });
    // The dialog stays up carrying the reason; the caller keeps the editor open.
    expect(screen.getByText("Workflow could not be saved.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save & exit/i })).toBeInTheDocument();
  });

  it("blocks repeat submissions while the save is in flight", () => {
    render(
      <WorkflowExitDialog
        open
        saving
        onSaveAndExit={vi.fn()}
        onDiscard={vi.fn()}
        onContinue={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /save & exit/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /discard changes/i })).toBeDisabled();
  });
});

describe("editor shell", () => {
  it("routes Escape through the same guard as the back control", () => {
    const onRequestExit = vi.fn();
    render(
      <WorkflowEditorShell focused onRequestExit={onRequestExit}>
        <p>canvas</p>
      </WorkflowEditorShell>,
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onRequestExit).toHaveBeenCalledOnce();
  });

  it("leaves Escape to whatever dialog is on top of the editor", () => {
    const onRequestExit = vi.fn();
    render(
      <>
        <div role="dialog">confirm</div>
        <WorkflowEditorShell focused onRequestExit={onRequestExit}>
          <p>canvas</p>
        </WorkflowEditorShell>
      </>,
    );

    // Otherwise Escape would dismiss the unsaved-changes prompt and leave.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onRequestExit).not.toHaveBeenCalled();
  });

  it("does not hijack Escape once the workspace is restored", () => {
    const onRequestExit = vi.fn();
    render(
      <WorkflowEditorShell focused={false} onRequestExit={onRequestExit}>
        <p>canvas</p>
      </WorkflowEditorShell>,
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onRequestExit).not.toHaveBeenCalled();
  });

  it("restores the page's scrolling when focus mode ends", () => {
    const { rerender } = render(
      <WorkflowEditorShell focused onRequestExit={vi.fn()}>
        <p>canvas</p>
      </WorkflowEditorShell>,
    );
    expect(document.body.style.overflow).toBe("hidden");

    rerender(
      <WorkflowEditorShell focused={false} onRequestExit={vi.fn()}>
        <p>canvas</p>
      </WorkflowEditorShell>,
    );
    expect(document.body.style.overflow).not.toBe("hidden");
  });
});

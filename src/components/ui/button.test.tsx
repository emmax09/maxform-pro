import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Button } from "@/components/ui/button";

describe("Button action state", () => {
  it("renders the shared rolling indicator for a controlled action", () => {
    render(
      <Button loading loadingLabel="Saving changes">
        Save changes
      </Button>,
    );

    const button = screen.getByRole("button", { name: /save changes/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(
      button.querySelector("[data-button-loading-indicator]"),
    ).toBeInTheDocument();
    expect(screen.getByText("Saving changes")).toHaveClass("sr-only");
  });

  it("holds the action state until an async click finishes", async () => {
    let finish: (() => void) | undefined;
    const onClick = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(<Button onClick={onClick}>Run action</Button>);

    const button = screen.getByRole("button", { name: /run action/i });
    fireEvent.click(button);

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);

    finish?.();
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(button).not.toHaveAttribute("aria-busy");
  });

  it("normalizes legacy inline spinners through the shared indicator", () => {
    render(
      <Button disabled>
        <span className="animate-spin">old spinner</span>
        Import contacts
      </Button>,
    );

    const button = screen.getByRole("button", { name: /import contacts/i });
    expect(button).toHaveAttribute("data-loading", "true");
    expect(
      button.querySelector("[data-button-loading-indicator]"),
    ).toBeInTheDocument();
  });

  it("does not mistake a settled disabled action for a pending action", () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Archive</Button>);

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    rerender(
      <Button disabled onClick={onClick}>
        <span className="animate-spin">Saving</span>
        Archive
      </Button>,
    );
    expect(screen.getByRole("button", { name: /archive/i })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    rerender(
      <Button disabled onClick={onClick}>
        Archive
      </Button>,
    );

    const button = screen.getByRole("button", { name: /archive/i });
    expect(button).toBeDisabled();
    expect(button).not.toHaveAttribute("aria-busy");
    expect(button).not.toHaveAttribute("data-loading");
  });

  it("does not retain inferred loading when controlled loading finishes on a disabled action", () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <Button loading={false} onClick={onClick}>
        Set active
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Set active" });

    fireEvent.click(button);
    rerender(
      <Button loading disabled onClick={onClick}>
        Set active
      </Button>,
    );
    expect(button).toHaveAttribute("aria-busy", "true");

    rerender(
      <Button loading={false} disabled onClick={onClick}>
        Set active
      </Button>,
    );
    expect(button).toBeDisabled();
    expect(button).not.toHaveAttribute("aria-busy");
    expect(button).not.toHaveAttribute("data-loading");
  });
});

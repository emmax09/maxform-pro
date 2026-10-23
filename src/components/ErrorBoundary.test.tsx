import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ErrorBoundary } from "./ErrorBoundary";

function Boom({ explode }: { explode: boolean }) {
  if (explode) throw new Error("events data was not an array");
  return <p>Events workspace</p>;
}

describe("ErrorBoundary", () => {
  beforeEach(() => {
    // React logs caught errors; the noise is expected here.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("keeps the page usable and names what broke instead of blanking", () => {
    render(
      <ErrorBoundary title="Events">
        <Boom explode />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Events could not be displayed")).toBeInTheDocument();
    // The real message is shown, so a crash can be reported rather than guessed.
    expect(screen.getByText("events data was not an array")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("recovers when the cause is gone", () => {
    const { rerender } = render(
      <ErrorBoundary title="Events">
        <Boom explode />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Events could not be displayed")).toBeInTheDocument();

    rerender(
      <ErrorBoundary title="Events">
        <Boom explode={false} />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(screen.getByText("Events workspace")).toBeInTheDocument();
  });

  it("clears itself when the user switches to another tab", () => {
    const { rerender } = render(
      <ErrorBoundary title="Events" resetKey="events">
        <Boom explode />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Events could not be displayed")).toBeInTheDocument();

    rerender(
      <ErrorBoundary title="Forms" resetKey="forms">
        <Boom explode={false} />
      </ErrorBoundary>,
    );

    expect(screen.getByText("Events workspace")).toBeInTheDocument();
  });
});

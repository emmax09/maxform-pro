import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Reveal, StageLoader } from "./transitions";
import { useStagedTransition } from "@/hooks/use-staged-transition";

/** matchMedia is not implemented in jsdom, so each test states its preference. */
const setReducedMotion = (reduced: boolean) => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: reduced && query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
};

beforeEach(() => {
  setReducedMotion(false);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useStagedTransition", () => {
  it("holds on opening, then settles", () => {
    const { result } = renderHook(() => useStagedTransition({ open: true }));

    expect(result.current.phase).toBe("opening");
    // Opening replaces the surface, so the caller stops rendering its content.
    expect(result.current.coversSurface).toBe(true);

    act(() => {
      vi.advanceTimersByTime(480);
    });
    expect(result.current.phase).toBeNull();
    expect(result.current.coversSurface).toBe(false);
  });

  it("does not open a surface that is closed", () => {
    const { result } = renderHook(() => useStagedTransition({ open: false }));
    expect(result.current.phase).toBeNull();
  });

  it("applies the change between leaving and entering, not before", () => {
    const apply = vi.fn();
    const { result } = renderHook(() => useStagedTransition({ open: false }));

    act(() => result.current.transitionTo(apply));
    expect(result.current.phase).toBe("leaving");
    // The old screen is still on show, so the change must not have landed yet.
    expect(apply).not.toHaveBeenCalled();
    // A step change veils the middle; the chrome around it stays put.
    expect(result.current.coversSurface).toBe(false);

    act(() => {
      vi.advanceTimersByTime(220);
    });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe("entering");

    act(() => {
      vi.advanceTimersByTime(260);
    });
    expect(result.current.phase).toBeNull();
  });

  it("holds before handing back on exit", () => {
    const done = vi.fn();
    const { result } = renderHook(() => useStagedTransition({ open: false }));

    act(() => result.current.exitWith(done));
    expect(result.current.phase).toBe("closing");
    expect(result.current.coversSurface).toBe(true);
    expect(done).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(360);
    });
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("takes the timing it is given", () => {
    const apply = vi.fn();
    const { result } = renderHook(() =>
      useStagedTransition({ open: false, timing: { leaveMs: 40, enterMs: 10 } }),
    );

    act(() => result.current.transitionTo(apply));
    act(() => {
      vi.advanceTimersByTime(40);
    });
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("cannot fire a state update after unmounting mid-transition", () => {
    const done = vi.fn();
    const { result, unmount } = renderHook(() =>
      useStagedTransition({ open: false }),
    );

    act(() => result.current.exitWith(done));
    unmount();
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    // The pending timer was cleared, so nothing reaches the gone component.
    expect(done).not.toHaveBeenCalled();
  });

  describe("with reduced motion", () => {
    beforeEach(() => setReducedMotion(true));

    it("skips the opening hold entirely", () => {
      const { result } = renderHook(() => useStagedTransition({ open: true }));
      // Not merely faster — there is no held phase at all.
      expect(result.current.phase).toBeNull();
      expect(result.current.reducedMotion).toBe(true);
    });

    it("applies a change immediately", () => {
      const apply = vi.fn();
      const { result } = renderHook(() => useStagedTransition({ open: false }));

      act(() => result.current.transitionTo(apply));
      expect(apply).toHaveBeenCalledTimes(1);
      expect(result.current.phase).toBeNull();
    });

    it("still exits, without the hold", () => {
      const done = vi.fn();
      const { result } = renderHook(() => useStagedTransition({ open: false }));

      act(() => result.current.exitWith(done));
      expect(done).toHaveBeenCalledTimes(1);
    });
  });
});

describe("StageLoader", () => {
  it("renders nothing once settled", () => {
    const { container } = render(<StageLoader phase={null} label="Loading" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("announces itself while moving", () => {
    render(<StageLoader phase="opening" label="Setting up…" />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Setting up…");
    expect(status).toHaveAttribute("aria-live", "polite");
  });

  it("veils by default and fills the surface when asked", () => {
    const { rerender } = render(<StageLoader phase="leaving" label="Saving…" />);
    // A veil sits over content that is still there.
    expect(screen.getByRole("status").className).toContain("absolute");

    rerender(<StageLoader phase="closing" label="Closing…" variant="surface" />);
    expect(screen.getByRole("status").className).toContain("h-full");
  });
});

describe("Reveal", () => {
  it("keeps its children in the DOM while animating", () => {
    render(
      <Reveal motionKey="overview">
        <p>Tab body</p>
      </Reveal>,
    );
    // The point of Reveal: nothing reading the page has to wait for motion.
    expect(screen.getByText("Tab body")).toBeInTheDocument();
  });

  it("animates by default", () => {
    const { container } = render(
      <Reveal motionKey="a">
        <p>Body</p>
      </Reveal>,
    );
    expect(container.firstElementChild?.className).toContain("animate-in");
  });

  it("drops the animation under reduced motion", () => {
    setReducedMotion(true);
    const { container } = render(
      <Reveal motionKey="a" className="space-y-5">
        <p>Body</p>
      </Reveal>,
    );
    expect(container.firstElementChild?.className).not.toContain("animate-in");
    // The layout class it was given still has to survive.
    expect(container.firstElementChild?.className).toContain("space-y-5");
    expect(screen.getByText("Body")).toBeInTheDocument();
  });
});

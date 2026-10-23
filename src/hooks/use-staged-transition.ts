/**
 * Phases for a surface that opens, moves between states, and closes.
 *
 * Screens that swap instantly read as a flicker — you cannot tell whether
 * something loaded, changed, or was always there. This is the timing for
 * changes that have work behind them: a step that saves on the way out, a panel
 * that fetches on the way in. For changes with no work, use `Reveal` instead,
 * which animates without ever removing content from the DOM.
 *
 * Durations collapse to zero under prefers-reduced-motion rather than merely
 * running faster.
 */
import { useCallback, useEffect, useRef, useState } from "react";

/** null means settled — nothing is moving. */
export type TransitionPhase = "opening" | "leaving" | "entering" | "closing" | null;

export type StagedTransitionTiming = {
  /** Held after the surface opens, while its first paint settles. */
  openMs?: number;
  /** Held on the way out of a step, covering whatever it saves. */
  leaveMs?: number;
  /** Held on the way into a step, covering whatever it loads. */
  enterMs?: number;
  /** Held before the surface actually closes. */
  closeMs?: number;
};

const DEFAULT_TIMING: Required<StagedTransitionTiming> = {
  openMs: 480,
  leaveMs: 220,
  enterMs: 260,
  closeMs: 360,
};

/**
 * True when the viewer asked for less motion.
 *
 * Read live rather than once, because it can be toggled while the app is open.
 */
export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

/**
 * `open` drives the opening phase; the two callbacks drive the rest. Every
 * timer is tracked so unmounting mid-transition cannot fire a state update into
 * a component that is gone.
 */
export function useStagedTransition({
  open = true,
  timing,
}: { open?: boolean; timing?: StagedTransitionTiming } = {}) {
  const reduced = usePrefersReducedMotion();
  const [phase, setPhase] = useState<TransitionPhase>(null);
  const timers = useRef<number[]>([]);

  const ms = useCallback(
    (key: keyof Required<StagedTransitionTiming>) =>
      reduced ? 0 : (timing?.[key] ?? DEFAULT_TIMING[key]),
    [reduced, timing],
  );

  const schedule = useCallback((fn: () => void, delay: number) => {
    if (delay <= 0) {
      fn();
      return;
    }
    timers.current.push(window.setTimeout(fn, delay));
  }, []);

  useEffect(
    () => () => {
      timers.current.forEach((handle) => window.clearTimeout(handle));
      timers.current = [];
    },
    [],
  );

  useEffect(() => {
    if (!open) {
      setPhase(null);
      return;
    }
    const hold = ms("openMs");
    if (hold <= 0) {
      setPhase(null);
      return;
    }
    setPhase("opening");
    const handle = window.setTimeout(() => setPhase(null), hold);
    timers.current.push(handle);
    return () => window.clearTimeout(handle);
  }, [ms, open]);

  /** Plays out, applies the change, plays in. */
  const transitionTo = useCallback(
    (apply: () => void) => {
      setPhase("leaving");
      schedule(() => {
        apply();
        setPhase("entering");
        schedule(() => setPhase(null), ms("enterMs"));
      }, ms("leaveMs"));
    },
    [ms, schedule],
  );

  /** Plays the closing hold, then hands back so the caller can unmount. */
  const exitWith = useCallback(
    (done: () => void) => {
      setPhase("closing");
      schedule(() => {
        setPhase(null);
        done();
      }, ms("closeMs"));
    },
    [ms, schedule],
  );

  return {
    phase,
    /** Opening and closing replace the surface; the rest only veil it. */
    coversSurface: phase === "opening" || phase === "closing",
    isMoving: phase !== null,
    transitionTo,
    exitWith,
    reducedMotion: reduced,
  };
}

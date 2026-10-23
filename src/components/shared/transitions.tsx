/**
 * Shared entrance and exit motion.
 *
 * Everything that opens, closes, or replaces its contents should go through
 * here, so the timing is the same everywhere and there is one place to change
 * it. The phase machine lives in `use-staged-transition`; these are the visuals
 * that go with it.
 *
 *   StageLoader   for changes with work behind them — pairs with
 *                 useStagedTransition, and can either veil content or replace
 *                 the whole surface.
 *   Reveal        for changes with no work — a tab body, a filtered list.
 *                 Content is never removed from the DOM, it just animates in,
 *                 so nothing reading the page has to wait for it.
 *
 * Both honour prefers-reduced-motion.
 */
import type { ReactNode } from "react";

import {
  usePrefersReducedMotion,
  type TransitionPhase,
} from "@/hooks/use-staged-transition";
import { cn } from "@/lib/utils";

/** The one spinner, so a loading state looks the same wherever it appears. */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block shrink-0 animate-spin rounded-full border-2 border-primary/25 border-t-primary",
        className || "h-4 w-4",
      )}
    />
  );
}

/**
 * The visual for a staged transition.
 *
 * `variant="surface"` fills its container — use it where the caller has stopped
 * rendering the real content. `variant="veil"` sits over content that is still
 * there, so surrounding chrome stays put while the middle changes.
 */
export function StageLoader({
  phase,
  label,
  variant = "veil",
  className,
}: {
  phase: TransitionPhase;
  label: string;
  variant?: "surface" | "veil";
  className?: string;
}) {
  if (!phase) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-col items-center justify-center gap-2.5",
        variant === "surface"
          ? "h-full w-full"
          : "absolute inset-0 z-20 bg-background/85 backdrop-blur-[2px]",
        className,
      )}
    >
      <Spinner className={variant === "surface" ? "h-6 w-6" : "h-5 w-5"} />
      <p
        className={cn(
          "text-muted-foreground",
          variant === "surface" ? "text-[12.5px]" : "text-[11.5px]",
        )}
      >
        {label}
      </p>
    </div>
  );
}

/**
 * Animates its children in whenever `motionKey` changes.
 *
 * Remounting on the key is what restarts the animation — a CSS class alone only
 * plays once. The content is present from the first frame, so anything reading
 * the page sees it immediately; only its opacity and offset are animated.
 */
export function Reveal({
  children,
  motionKey,
  className,
  direction = "up",
}: {
  children: ReactNode;
  /** Change this to replay the entrance — a tab key, a filter, a record id. */
  motionKey?: string | number;
  className?: string;
  direction?: "up" | "down" | "none";
}) {
  const reduced = usePrefersReducedMotion();
  if (reduced) return <div className={className}>{children}</div>;
  return (
    <div
      key={motionKey}
      className={cn(
        "animate-in fade-in-0 duration-200 ease-out",
        direction === "up" && "slide-in-from-bottom-2",
        direction === "down" && "slide-in-from-top-2",
        className,
      )}
    >
      {children}
    </div>
  );
}

import { useEffect } from "react";

/**
 * Holds the page still while a full-screen surface is open.
 *
 * A `fixed inset-0` overlay covers the page but does not stop it scrolling
 * underneath: a wheel gesture that the overlay's own panes cannot consume falls
 * through to the document, so the builder appears frozen while the dashboard
 * behind it moves. Locking the body for as long as the overlay is mounted keeps
 * the scroll where the user is looking.
 *
 * The previous inline value is restored rather than blanked, so nested locks and
 * any page-level overflow rule both survive.
 */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof document === "undefined") return;
    const { body } = document;
    const previousOverflow = body.style.overflow;
    const previousPaddingRight = body.style.paddingRight;
    // Removing the scrollbar changes the layout width; padding replaces it so
    // the page behind does not visibly jump as the overlay opens.
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = "hidden";
    if (scrollbar > 0) {
      const current = Number.parseFloat(getComputedStyle(body).paddingRight) || 0;
      body.style.paddingRight = `${current + scrollbar}px`;
    }
    return () => {
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPaddingRight;
    };
  }, [active]);
}

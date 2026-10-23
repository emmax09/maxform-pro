import "@testing-library/jest-dom";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library gives every bare findBy*/waitFor one second, regardless of
// the 15s per-test budget in vitest.config.ts. The module suites here mount
// flows where a single click persists a draft and then waits on a round of
// query invalidations, which is comfortably more than a second on a loaded
// machine -- so a call site that did not pass an explicit timeout would pass or
// fail depending on what else the machine was doing. Five seconds is well clear
// of what those steps actually take while staying under the test timeout, so a
// genuine failure still surfaces as the assertion that failed rather than as an
// opaque test-level timeout.
configure({ asyncUtilTimeout: 5_000 });

// A few of the larger module suites mount long-lived async flows. Explicitly
// tear down the DOM and browser storage between tests so a previous wizard,
// autosave, or persisted draft cannot affect the next test.
afterEach(() => {
  cleanup();
  if (typeof window !== "undefined") {
    window.localStorage.clear();
    window.sessionStorage.clear();
  }
});

// Recharts warns when jsdom reports a zero-sized layout. That is an expected
// test-environment limitation, not an application layout failure; browser
// smoke tests cover the real chart dimensions. Keep the warning out of test
// output without masking any other console error.
const originalConsoleError = console.error;
const isJsdomChartWarning = (args: unknown[]) =>
  args.some(
    (value) =>
      typeof value === "string" &&
      value.includes("The width(0) and height(0) of chart should be greater than 0"),
  );
console.error = (...args: unknown[]) => {
  if (isJsdomChartWarning(args)) return;
  originalConsoleError(...args);
};
const originalConsoleWarn = console.warn;
console.warn = (...args: unknown[]) => {
  if (isJsdomChartWarning(args)) return;
  originalConsoleWarn(...args);
};

// vite.config loads .env into process.env, which would otherwise point the
// cache and rate limiter at the real Upstash database during a test run. Tests
// must exercise the fail-open path or an explicit stub, never live Redis.
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      // DOM tests should not spend several hundred milliseconds per staged
      // transition. The production hook still follows the real browser
      // preference; this only makes jsdom deterministic and fast.
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    }),
  });

  // jsdom has no ResizeObserver. Recharts' ResponsiveContainer and the adaptive
  // tab navigation both construct one on mount, so a no-op stand-in keeps them
  // renderable under test. Layout is not measurable in jsdom either way.
  if (!("ResizeObserver" in window)) {
    class ResizeObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    Object.defineProperty(window, "ResizeObserver", {
      writable: true,
      value: ResizeObserverStub,
    });
    Object.defineProperty(globalThis, "ResizeObserver", {
      writable: true,
      value: ResizeObserverStub,
    });
  }
}

import { useEffect, useMemo, useState } from "react";

type ApiSample = {
  duration: number;
  method: string;
  status: number;
  url: string;
};

type MetricState = {
  api: ApiSample[];
  lcp: number | null;
  navigation: number | null;
};

const MAX_API_SAMPLES = 30;
const SLOW_API_MS = 500;

export function DevPerformanceDashboard() {
  const enabled =
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("perf");
  const [metrics, setMetrics] = useState<MetricState>({
    api: [],
    lcp: null,
    navigation: null,
  });

  useEffect(() => {
    if (!enabled) return;
    const navigation = performance.getEntriesByType(
      "navigation",
    )[0] as PerformanceNavigationTiming | undefined;
    if (navigation) {
      setMetrics((current) => ({
        ...current,
        navigation: navigation.loadEventEnd || navigation.domComplete,
      }));
    }

    const handleApi = (event: Event) => {
      const sample = (event as CustomEvent<ApiSample>).detail;
      setMetrics((current) => ({
        ...current,
        api: [sample, ...current.api].slice(0, MAX_API_SAMPLES),
      }));
    };
    window.addEventListener("maxform-performance-api", handleApi);

    let observer: PerformanceObserver | null = null;
    if ("PerformanceObserver" in window) {
      try {
        observer = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          const last = entries[entries.length - 1];
          if (last) {
            setMetrics((current) => ({
              ...current,
              lcp: last.startTime,
            }));
          }
        });
        observer.observe({ type: "largest-contentful-paint", buffered: true });
      } catch {
        observer = null;
      }
    }

    return () => {
      window.removeEventListener("maxform-performance-api", handleApi);
      observer?.disconnect();
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const instrumented = window as typeof window & {
      __maxformFetchInstrumentation?: true;
      __maxformOriginalFetch?: typeof fetch;
    };
    if (instrumented.__maxformFetchInstrumentation) return;
    const originalFetch = window.fetch.bind(window);
    instrumented.__maxformOriginalFetch = originalFetch;
    instrumented.__maxformFetchInstrumentation = true;
    window.fetch = async (input, init) => {
      const start = performance.now();
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method =
        init?.method ||
        (typeof input === "object" && "method" in input ? input.method : "GET");
      try {
        const response = await originalFetch(input, init);
        window.dispatchEvent(
          new CustomEvent<ApiSample>("maxform-performance-api", {
            detail: {
              duration: performance.now() - start,
              method: method || "GET",
              status: response.status,
              url,
            },
          }),
        );
        return response;
      } catch (error) {
        window.dispatchEvent(
          new CustomEvent<ApiSample>("maxform-performance-api", {
            detail: {
              duration: performance.now() - start,
              method: method || "GET",
              status: 0,
              url,
            },
          }),
        );
        throw error;
      }
    };
  }, [enabled]);

  const summary = useMemo(() => {
    const averageApi =
      metrics.api.length === 0
        ? 0
        : metrics.api.reduce((sum, sample) => sum + sample.duration, 0) /
          metrics.api.length;
    const slowCalls = metrics.api.filter(
      (sample) => sample.duration >= SLOW_API_MS,
    ).length;
    return { averageApi, slowCalls };
  }, [metrics.api]);

  if (!enabled) return null;

  return (
    <aside className="fixed bottom-4 right-4 z-[100] w-[340px] max-w-[calc(100vw-32px)] rounded-md border border-border bg-popover p-4 text-popover-foreground shadow-2xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold">Performance</p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Development instrumentation
          </p>
        </div>
        <span className="rounded bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary">
          ?perf=1
        </span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-[10px]">
        <div className="rounded border border-border p-2">
          <p className="text-muted-foreground">Load</p>
          <p className="mt-1 font-semibold">
            {metrics.navigation ? Math.round(metrics.navigation) : "-"}ms
          </p>
        </div>
        <div className="rounded border border-border p-2">
          <p className="text-muted-foreground">LCP</p>
          <p className="mt-1 font-semibold">
            {metrics.lcp ? Math.round(metrics.lcp) : "-"}ms
          </p>
        </div>
        <div className="rounded border border-border p-2">
          <p className="text-muted-foreground">Avg API</p>
          <p className="mt-1 font-semibold">
            {summary.averageApi ? Math.round(summary.averageApi) : "-"}ms
          </p>
        </div>
      </div>
      <div className="mt-3 max-h-44 overflow-auto text-[10px]">
        {metrics.api.length === 0 ? (
          <p className="text-muted-foreground">No API calls recorded.</p>
        ) : (
          metrics.api.map((sample, index) => (
            <div
              key={`${sample.url}-${sample.duration}-${index}`}
              className="grid grid-cols-[52px_minmax(0,1fr)_58px] gap-2 border-t border-border py-2"
            >
              <span>{Math.round(sample.duration)}ms</span>
              <span className="truncate text-muted-foreground">
                {sample.method} {sample.url}
              </span>
              <span>{sample.status || "ERR"}</span>
            </div>
          ))
        )}
      </div>
      {summary.slowCalls > 0 && (
        <p className="mt-3 text-[10px] text-amber-600 dark:text-amber-300">
          {summary.slowCalls} API call{summary.slowCalls === 1 ? "" : "s"} over{" "}
          {SLOW_API_MS}ms.
        </p>
      )}
    </aside>
  );
}

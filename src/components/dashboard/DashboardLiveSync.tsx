import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import {
  DASHBOARD_LIVE_SYNC_INTERVAL_MS,
  emitDashboardLiveSync,
} from "@/lib/performance/dashboard-live-sync";

/**
 * The dashboard is backed by server state rather than a single realtime
 * socket. Keep every mounted workspace query fresh in the background while
 * retaining its current data during the request, so cards update in place
 * instead of falling back to loading screens.
 */
export {
  DASHBOARD_LIVE_SYNC_EVENT,
  DASHBOARD_LIVE_SYNC_INTERVAL_MS,
} from "@/lib/performance/dashboard-live-sync";

export function DashboardLiveSync({ userId }: { userId?: string }) {
  const queryClient = useQueryClient();
  const lastSyncAt = useRef(0);

  useEffect(() => {
    if (!userId) return;

    let disposed = false;
    const sync = () => {
      if (disposed || document.visibilityState === "hidden") return;
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        return;
      }
      // Do not race a save or another immediate refresh. The next interval or
      // visibility event will catch up after the mutation settles.
      if (queryClient.isMutating() > 0) return;
      const now = Date.now();
      if (now - lastSyncAt.current < 5_000) return;
      lastSyncAt.current = now;

      // refetchQueries keeps the existing data rendered while the request is
      // in flight. That is the important distinction from remounting modules
      // or manually toggling loading state on every refresh.
      void queryClient
        .refetchQueries(
          {
            type: "active",
            predicate: (query) => query.queryKey[0] !== "onboarding",
          },
          { cancelRefetch: false },
        )
        .finally(() => emitDashboardLiveSync(userId));
    };

    const interval = window.setInterval(sync, DASHBOARD_LIVE_SYNC_INTERVAL_MS);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") sync();
    };
    const onOnline = () => sync();

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("online", onOnline);

    return () => {
      disposed = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("online", onOnline);
    };
  }, [queryClient, userId]);

  return null;
}

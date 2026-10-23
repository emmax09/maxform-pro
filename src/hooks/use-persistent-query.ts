import { useEffect, useRef, useState } from "react";
import {
  useQuery,
  useQueryClient,
  type QueryKey,
  type UseQueryResult,
} from "@tanstack/react-query";

import {
  SERVER_STATE_STALE_TIME,
} from "@/lib/performance/query-client";
import {
  getCachedServerState,
  setCachedServerState,
} from "@/lib/performance/indexed-cache";
import {
  DASHBOARD_LIVE_SYNC_EVENT,
  type DashboardLiveSyncDetail,
} from "@/lib/performance/dashboard-live-sync";

type PersistentQueryOptions<T> = {
  cacheKey: string;
  cacheScope: string;
  enabled?: boolean;
  /**
   * Public pages must always read the current published record. Keeping their
   * response in IndexedDB can otherwise show a visitor an old live version.
   */
  persist?: boolean;
  queryFn: () => Promise<T>;
  queryKey: QueryKey;
  refetchOnMount?: boolean | "always";
  staleTime?: number;
  tags?: string[];
};

export type PersistentQueryResult<T> = UseQueryResult<T, Error> & {
  cacheReady: boolean;
  isInitialLoading: boolean;
};

export function usePersistentQuery<T>({
  cacheKey,
  cacheScope,
  enabled = true,
  persist = true,
  queryFn,
  queryKey,
  refetchOnMount,
  staleTime = SERVER_STATE_STALE_TIME,
  tags = [],
}: PersistentQueryOptions<T>): PersistentQueryResult<T> {
  const queryClient = useQueryClient();
  const [cacheReady, setCacheReady] = useState(!enabled || !persist);
  const [freshCacheLoaded, setFreshCacheLoaded] = useState(false);
  const queryKeyHash = JSON.stringify(queryKey);
  const tagKey = tags.join("|");
  const queryKeyRef = useRef(queryKey);

  useEffect(() => {
    queryKeyRef.current = queryKey;
  }, [queryKey, queryKeyHash]);

  useEffect(() => {
    let cancelled = false;
    setFreshCacheLoaded(false);
    setCacheReady(!enabled || !persist);
    if (!enabled || !persist) return;

    void getCachedServerState<T>(cacheKey)
      .then((entry) => {
        if (cancelled || !entry) return;
        queryClient.setQueryData(queryKeyRef.current, entry.data, {
          updatedAt: entry.updatedAt,
        });
        setFreshCacheLoaded(Date.now() - entry.updatedAt < staleTime);
      })
      .finally(() => {
        if (!cancelled) setCacheReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, enabled, persist, queryClient, queryKeyHash, staleTime]);

  useEffect(() => {
    if (!enabled || !persist || typeof window === "undefined") return;
    const onDashboardLiveSync = (event: Event) => {
      const detail = (event as CustomEvent<DashboardLiveSyncDetail>).detail;
      if (detail?.userId && !queryKeyRef.current.includes(detail.userId)) return;
      // Queries already participating in TanStack Query's active refresh have
      // just been refetched by the dashboard pulse. Only wake the observer
      // when IndexedDB had intentionally kept it disabled.
      if (!freshCacheLoaded) return;
      // A fresh IndexedDB entry intentionally disables the query on first
      // mount. A live dashboard pulse is the explicit signal that lets it
      // rejoin the network without forcing a loading screen on the user.
      setFreshCacheLoaded(false);
      void queryClient.invalidateQueries({
        exact: true,
        queryKey: queryKeyRef.current,
        refetchType: "active",
      });
    };
    window.addEventListener(DASHBOARD_LIVE_SYNC_EVENT, onDashboardLiveSync);
    return () =>
      window.removeEventListener(DASHBOARD_LIVE_SYNC_EVENT, onDashboardLiveSync);
  }, [enabled, freshCacheLoaded, persist, queryClient, queryKeyHash]);

  const query = useQuery<T, Error>({
    enabled: enabled && cacheReady && !freshCacheLoaded,
    queryFn,
    queryKey,
    refetchOnMount,
    staleTime,
  });

  useEffect(() => {
    if (!persist || !enabled || query.data === undefined) return;
    void setCachedServerState(
      cacheKey,
      query.data,
      cacheScope,
      tagKey ? tagKey.split("|") : [],
    );
  }, [cacheKey, cacheScope, enabled, persist, query.data, tagKey]);

  return {
    ...query,
    cacheReady,
    isInitialLoading:
      enabled && query.data === undefined && (!cacheReady || query.isLoading),
  };
}

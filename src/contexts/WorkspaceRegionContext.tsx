import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

import { useAuth } from "@/contexts/AuthContext";
import { usePersistentQuery } from "@/hooks/use-persistent-query";
import {
  persistentCacheKey,
  setCachedServerState,
} from "@/lib/performance/indexed-cache";
import { queryKeys } from "@/lib/performance/query-client";
import {
  getWorkspaceRegionalSettings,
  saveWorkspaceRegionalSettings,
  type WorkspaceRegionalSettings,
} from "@/lib/settings";

type WorkspaceRegionContextValue = WorkspaceRegionalSettings & {
  loading: boolean;
  refreshRegion: () => Promise<void>;
  saveRegion: (settings: WorkspaceRegionalSettings) => Promise<void>;
};

const WorkspaceRegionContext =
  createContext<WorkspaceRegionContextValue | null>(null);

const fallbackRegion: WorkspaceRegionalSettings = {
  currency: "USD",
  currencyCountryCode: "US",
  timezone: "UTC",
};

const fallbackContextValue: WorkspaceRegionContextValue = {
  ...fallbackRegion,
  loading: false,
  refreshRegion: async () => undefined,
  saveRegion: async () => undefined,
};

export function WorkspaceRegionProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { loading: authLoading, profile, user } = useAuth();
  const userId = user?.id;
  const [region, setRegion] =
    useState<WorkspaceRegionalSettings>(fallbackRegion);
  const [loading, setLoading] = useState(true);
  const regionalSettings = usePersistentQuery({
    cacheKey: persistentCacheKey(
      "workspace",
      "regional",
      userId,
      profile?.country,
    ),
    cacheScope: "workspace-settings",
    enabled: !authLoading && Boolean(userId),
    queryFn: async () => {
      try {
        return await getWorkspaceRegionalSettings(userId!, profile?.country);
      } catch {
        const { regionalDefaultsForCountry } = await import(
          "@/lib/regional-options"
        );
        const defaults = regionalDefaultsForCountry(profile?.country);
        return {
          currency: defaults.currency,
          currencyCountryCode: defaults.countryCode,
          timezone: defaults.timezone,
        } satisfies WorkspaceRegionalSettings;
      }
    },
    queryKey: queryKeys.workspace.regional(userId, profile?.country),
    tags: ["workspace-settings", userId || ""],
  });

  const refreshRegion = useCallback(async () => {
    if (authLoading) return;
    if (!userId) {
      setRegion(fallbackRegion);
      setLoading(false);
      return;
    }
    setLoading(true);
    const result = await regionalSettings.refetch();
    if (result.data) setRegion(result.data);
    if (result.error) setRegion(fallbackRegion);
    setLoading(false);
  }, [authLoading, regionalSettings, userId]);

  useEffect(() => {
    if (authLoading) {
      setLoading(true);
      return;
    }
    if (!userId) {
      setRegion(fallbackRegion);
      setLoading(false);
      return;
    }
    if (regionalSettings.data) {
      setRegion(regionalSettings.data);
      setLoading(false);
      return;
    }
    setLoading(regionalSettings.isInitialLoading);
  }, [
    authLoading,
    regionalSettings.data,
    regionalSettings.isInitialLoading,
    userId,
  ]);

  useEffect(() => {
    const handleUpdate = (event: Event) => {
      const detail = (event as CustomEvent<WorkspaceRegionalSettings>).detail;
      if (detail?.currency && detail?.timezone) setRegion(detail);
    };
    window.addEventListener("maxform-region-updated", handleUpdate);
    return () =>
      window.removeEventListener("maxform-region-updated", handleUpdate);
  }, []);

  const saveRegion = useCallback(
    async (settings: WorkspaceRegionalSettings) => {
      if (!userId) return;
      const normalized = {
        currency: settings.currency.toUpperCase(),
        currencyCountryCode: settings.currencyCountryCode,
        timezone: settings.timezone,
      };
      const saved = await saveWorkspaceRegionalSettings(userId, normalized);
      setRegion(saved);
      void setCachedServerState(
        persistentCacheKey("workspace", "regional", userId, profile?.country),
        saved,
        "workspace-settings",
        ["workspace-settings", userId],
      );
      window.dispatchEvent(
        new CustomEvent("maxform-region-updated", {
          detail: saved,
        }),
      );
    },
    [profile?.country, userId],
  );

  return (
    <WorkspaceRegionContext.Provider
      value={{
        ...region,
        loading,
        refreshRegion,
        saveRegion,
      }}
    >
      {children}
    </WorkspaceRegionContext.Provider>
  );
}

// This hook intentionally shares the provider module.
// eslint-disable-next-line react-refresh/only-export-components
export function useWorkspaceRegion() {
  const context = useContext(WorkspaceRegionContext);
  if (!context) {
    throw new Error(
      "useWorkspaceRegion must be used within WorkspaceRegionProvider",
    );
  }
  return context;
}

/**
 * Lightweight modules such as the campaign scheduler can render in isolation
 * in previews/tests. The dashboard always provides the real workspace region;
 * this fallback keeps those surfaces safe before the provider is mounted.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useOptionalWorkspaceRegion() {
  return useContext(WorkspaceRegionContext) || fallbackContextValue;
}

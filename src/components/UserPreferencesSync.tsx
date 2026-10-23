import { useEffect, useState } from "react";
import { useTheme } from "next-themes";

import { useAuth } from "@/contexts/AuthContext";
import {
  brandColorToHsl,
  normalizeBrandColor,
  DEFAULT_BRAND_COLOR,
} from "@/lib/brand-color";
import { getWorkspaceSettings } from "@/lib/settings";
import { usePersistentQuery } from "@/hooks/use-persistent-query";
import { persistentCacheKey } from "@/lib/performance/indexed-cache";
import { queryKeys } from "@/lib/performance/query-client";

interface StoredPreferences {
  brandColor?: string;
  reduceMotion?: boolean;
}

function readPreferences(userId: string | undefined): StoredPreferences {
  if (!userId) return {};

  try {
    return JSON.parse(
      localStorage.getItem(`maxform-settings:${userId}`) || "{}",
    ) as StoredPreferences;
  } catch {
    return {};
  }
}

export function UserPreferencesSync() {
  const { user } = useAuth();
  const { resolvedTheme } = useTheme();
  const [preferences, setPreferences] = useState<StoredPreferences>(() =>
    readPreferences(user?.id),
  );
  const workspaceSettings = usePersistentQuery({
    cacheKey: persistentCacheKey("workspace", "settings", user?.id),
    cacheScope: "workspace-settings",
    enabled: Boolean(user?.id),
    queryFn: () => getWorkspaceSettings(user!.id),
    queryKey: queryKeys.workspace.settings(user?.id),
    tags: ["workspace-settings", user?.id || ""],
  });

  useEffect(() => {
    setPreferences(readPreferences(user?.id));

    const handleSettingsUpdate = (event: Event) => {
      const customEvent = event as CustomEvent<StoredPreferences>;
      setPreferences(customEvent.detail || readPreferences(user?.id));
    };

    window.addEventListener("maxform-settings-updated", handleSettingsUpdate);
    return () => {
      window.removeEventListener(
        "maxform-settings-updated",
        handleSettingsUpdate,
      );
    };
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id || !workspaceSettings.data) return;
    setPreferences((current) => {
      const next = {
        ...current,
        brandColor: workspaceSettings.data.brandColor,
      };
      localStorage.setItem(
        `maxform-settings:${user.id}`,
        JSON.stringify(next),
      );
      return next;
    });
  }, [user?.id, workspaceSettings.data]);

  useEffect(() => {
    const primary = brandColorToHsl(
      preferences.brandColor || DEFAULT_BRAND_COLOR,
      resolvedTheme === "dark",
    );
    const root = document.documentElement;

    // --primary is deliberately contrast-adjusted, so it is never exactly the
    // colour that was picked. --brand keeps the chosen hex for the places that
    // must match it exactly: solid fills with their own foreground colour, and
    // the default accent of anything the workspace sends out.
    root.style.setProperty(
      "--brand",
      normalizeBrandColor(preferences.brandColor || DEFAULT_BRAND_COLOR),
    );
    root.style.setProperty("--primary", primary);
    root.style.setProperty("--ring", primary);
    root.style.setProperty("--sidebar-primary", primary);
    root.style.setProperty("--sidebar-ring", primary);
    root.dataset.reduceMotion = String(Boolean(preferences.reduceMotion));
  }, [preferences.brandColor, preferences.reduceMotion, resolvedTheme]);

  return null;
}

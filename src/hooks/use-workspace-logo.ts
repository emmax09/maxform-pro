import { useEffect, useState } from "react";

import { useAuth } from "@/contexts/AuthContext";
import { usePersistentQuery } from "@/hooks/use-persistent-query";
import { persistentCacheKey } from "@/lib/performance/indexed-cache";
import { queryKeys } from "@/lib/performance/query-client";
import { getWorkspaceSettings } from "@/lib/settings";

const WORKSPACE_IDENTITY_EVENT = "maxform-workspace-identity-updated";

const workspaceLogoKey = (userId: string) =>
  `maxform-workspace-logo:${userId}`;
const workspaceNameKey = (userId: string) =>
  `maxform-workspace-name:${userId}`;

type WorkspaceIdentity = {
  logoUrl: string | null;
  workspaceName: string;
};

export function storeWorkspaceIdentity(
  userId: string,
  identity: WorkspaceIdentity,
) {
  localStorage.setItem(workspaceLogoKey(userId), identity.logoUrl || "");
  localStorage.setItem(workspaceNameKey(userId), identity.workspaceName);
  window.dispatchEvent(
    new CustomEvent(WORKSPACE_IDENTITY_EVENT, {
      detail: { ...identity, userId },
    }),
  );
}

export function storeWorkspaceLogo(userId: string, logoUrl: string | null) {
  storeWorkspaceIdentity(userId, {
    logoUrl,
    workspaceName: localStorage.getItem(workspaceNameKey(userId)) || "",
  });
}

export function useWorkspaceIdentity() {
  const { user } = useAuth();
  const userId = user?.id;
  const [identity, setIdentity] = useState<WorkspaceIdentity>({
    logoUrl: null,
    workspaceName: "",
  });
  const workspaceSettings = usePersistentQuery({
    cacheKey: persistentCacheKey("workspace", "settings", userId),
    cacheScope: "workspace-settings",
    enabled: Boolean(userId),
    queryFn: () => getWorkspaceSettings(userId!),
    queryKey: queryKeys.workspace.settings(userId),
    tags: ["workspace-settings", userId || ""],
  });

  useEffect(() => {
    if (!userId) {
      setIdentity({ logoUrl: null, workspaceName: "" });
      return;
    }

    const logoStorageKey = workspaceLogoKey(userId);
    const nameStorageKey = workspaceNameKey(userId);
    const storedLogo = localStorage.getItem(logoStorageKey);
    const storedName = localStorage.getItem(nameStorageKey);

    if (storedLogo !== null || storedName !== null) {
      setIdentity({
        logoUrl: storedLogo || null,
        workspaceName: storedName || "",
      });
    }

    const handleIdentityUpdate = (event: Event) => {
      const detail = (
        event as CustomEvent<WorkspaceIdentity & { userId: string }>
      ).detail;
      if (detail?.userId === userId) {
        setIdentity({
          logoUrl: detail.logoUrl,
          workspaceName: detail.workspaceName,
        });
      }
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== logoStorageKey && event.key !== nameStorageKey) return;
      setIdentity({
        logoUrl: localStorage.getItem(logoStorageKey) || null,
        workspaceName: localStorage.getItem(nameStorageKey) || "",
      });
    };

    window.addEventListener(WORKSPACE_IDENTITY_EVENT, handleIdentityUpdate);
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener(
        WORKSPACE_IDENTITY_EVENT,
        handleIdentityUpdate,
      );
      window.removeEventListener("storage", handleStorage);
    };
  }, [userId]);

  useEffect(() => {
    if (!userId || !workspaceSettings.data) return;
    const nextIdentity = {
      logoUrl: workspaceSettings.data.companyLogoUrl,
      workspaceName: workspaceSettings.data.companyName,
    };
    setIdentity(nextIdentity);
    localStorage.setItem(workspaceLogoKey(userId), nextIdentity.logoUrl || "");
    localStorage.setItem(workspaceNameKey(userId), nextIdentity.workspaceName);
  }, [userId, workspaceSettings.data]);

  return identity;
}

export function useWorkspaceLogo() {
  return useWorkspaceIdentity().logoUrl;
}

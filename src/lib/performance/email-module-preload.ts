import {
  getEmailAnalytics,
  getEmailProviderSchemas,
  getEmailWorkspace,
} from "@/lib/email";
import {
  queryClient,
  SERVER_STATE_STALE_TIME,
} from "@/lib/performance/query-client";

export const emailWorkspaceQueryKey = (
  userId: string,
  status = "",
  search = "",
) => ["email", "workspace", userId, status, search] as const;

export const emailAnalyticsQueryKey = (userId: string, days = 30) =>
  ["email", "analytics", userId, days] as const;

export const emailProviderSchemasQueryKey = [
  "email",
  "provider-schemas",
] as const;

export async function preloadEmailModuleData(userId: string) {
  if (!userId) return;
  await Promise.allSettled([
    queryClient.prefetchQuery({
      queryKey: emailWorkspaceQueryKey(userId),
      queryFn: () => getEmailWorkspace(),
      staleTime: SERVER_STATE_STALE_TIME,
    }),
    queryClient.prefetchQuery({
      queryKey: emailAnalyticsQueryKey(userId),
      queryFn: () => getEmailAnalytics(30),
      staleTime: SERVER_STATE_STALE_TIME,
    }),
    queryClient.prefetchQuery({
      queryKey: emailProviderSchemasQueryKey,
      queryFn: getEmailProviderSchemas,
      staleTime: Infinity,
    }),
  ]);
}

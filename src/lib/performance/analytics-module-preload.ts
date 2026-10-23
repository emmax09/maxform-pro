import { getWorkspaceAnalytics } from "@/lib/analytics";
import {
  queryClient,
  SERVER_STATE_STALE_TIME,
} from "@/lib/performance/query-client";

export const analyticsWorkspaceQueryKey = (
  userId: string,
  range = 30,
) => ["analytics", "workspace", userId, range] as const;

export async function preloadAnalyticsModuleData(
  userId: string,
  range = 30,
) {
  if (!userId) return;
  await queryClient.prefetchQuery({
    queryKey: analyticsWorkspaceQueryKey(userId, range),
    queryFn: () => getWorkspaceAnalytics(range),
    staleTime: SERVER_STATE_STALE_TIME,
  });
}

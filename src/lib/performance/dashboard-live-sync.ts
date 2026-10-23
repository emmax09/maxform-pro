export const DASHBOARD_LIVE_SYNC_INTERVAL_MS = 20_000;
export const DASHBOARD_LIVE_SYNC_EVENT = "maxform:dashboard-live-sync";

export type DashboardLiveSyncDetail = {
  at: number;
  userId: string;
};

export const emitDashboardLiveSync = (userId: string) => {
  window.dispatchEvent(
    new CustomEvent<DashboardLiveSyncDetail>(DASHBOARD_LIVE_SYNC_EVENT, {
      detail: { at: Date.now(), userId },
    }),
  );
};

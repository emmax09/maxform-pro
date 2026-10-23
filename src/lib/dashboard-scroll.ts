const dashboardScrollRootSelector = '[data-dashboard-scroll-root="true"]';

export function getDashboardScrollRoot() {
  if (typeof document === "undefined") return null;
  return document.querySelector<HTMLElement>(dashboardScrollRootSelector);
}

export function scrollDashboardToTop(
  behavior: ScrollBehavior = "smooth",
) {
  if (typeof requestAnimationFrame === "undefined") return;
  requestAnimationFrame(() => {
    getDashboardScrollRoot()?.scrollTo({ top: 0, behavior });
  });
}

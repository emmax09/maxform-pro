export type ProjectsTab =
  | "overview"
  | "all"
  | "archived"
  | "forms"
  | "workflows"
  | "events"
  | "files"
  | "team"
  | "settings";

/**
 * Kept out of ProjectsModule so the dashboard shell can validate a `section`
 * URL parameter without pulling the lazily loaded module into the main bundle.
 */
export const PROJECT_TABS: ProjectsTab[] = [
  "overview",
  "all",
  "archived",
  "forms",
  "workflows",
  "events",
  "files",
  "team",
  "settings",
];

/** Tabs shown before a project is opened. */
export const PROJECT_LANDING_TABS: ProjectsTab[] = [
  "overview",
  "all",
  "archived",
];

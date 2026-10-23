/**
 * The one list of workspace modules both sides of the wire agree on.
 *
 * The dashboard rail renders from it, the members screen offers it as
 * checkboxes, and the server validates saved grants against it. Adding a module
 * to the product means adding it here once.
 */

export const WORKSPACE_MODULE_KEYS = [
  "home",
  "analytics",
  "projects",
  "crm",
  "campaigns",
  "forms",
  "events",
  "appointments",
  "workflows",
  "files",
  "documents",
  "payments",
  "orders",
  "stores",
  "store_connector",
  "ai",
  "emails",
  "integrations",
  "settings",
] as const;

export type WorkspaceModuleKey = (typeof WORKSPACE_MODULE_KEYS)[number];

/**
 * Granted to everyone regardless of what the owner picked. Home is where a
 * member lands after signing in, and Settings is where they change their own
 * password — locking either one out would strand the account.
 */
export const ALWAYS_GRANTED_MODULES: WorkspaceModuleKey[] = ["home", "settings"];

export const ASSIGNABLE_MODULE_KEYS = WORKSPACE_MODULE_KEYS.filter(
  (key) => !ALWAYS_GRANTED_MODULES.includes(key),
);

/**
 * Tabs shown below the dashboard's "Workspace tools" divider. These are
 * deliberately opt-in for non-admin members: they often expose credentials,
 * provider connections, or workspace-wide automation rather than a single
 * day-to-day record list.
 */
export const WORKSPACE_TOOL_MODULE_KEYS = [
  "ai",
  "emails",
  "integrations",
  "store_connector",
] as const satisfies readonly WorkspaceModuleKey[];

export type WorkspaceToolModuleKey = (typeof WORKSPACE_TOOL_MODULE_KEYS)[number];

/** Regular dashboard tabs offered by the member picker. */
export const WORKSPACE_STANDARD_MODULE_KEYS = ASSIGNABLE_MODULE_KEYS.filter(
  (key) =>
    !(WORKSPACE_TOOL_MODULE_KEYS as readonly string[]).includes(key),
);

export const WORKSPACE_MODULE_LABELS: Record<WorkspaceModuleKey, string> = {
  home: "Home",
  analytics: "Analytics",
  projects: "Projects",
  crm: "CRM",
  campaigns: "Campaigns",
  forms: "Forms",
  events: "Events",
  appointments: "Appointments",
  workflows: "Workflows",
  files: "Files",
  documents: "Documents",
  payments: "Payments",
  orders: "Orders",
  stores: "Connected stores",
  store_connector: "Store connector",
  ai: "MaxAI",
  emails: "Email settings",
  integrations: "Integrations",
  settings: "Settings",
};

export const WORKSPACE_MODULE_DESCRIPTIONS: Record<WorkspaceModuleKey, string> = {
  home: "Workspace overview and activity",
  analytics: "Response, conversion and revenue reporting",
  projects: "Project folders and their contents",
  crm: "Contacts, companies and deal pipeline",
  campaigns: "Audience messaging and broadcast sends",
  forms: "Form builder, responses and sharing",
  events: "Events, tickets and check-in",
  appointments: "Booking pages, calendar and availability",
  workflows: "Cross-module workflows, triggers and execution history",
  files: "Uploaded files and folders",
  documents: "Document templates and signatures",
  payments: "Checkout, transactions and payouts",
  orders: "Every sale the workspace has taken",
  stores: "Connected Shopify and WooCommerce sites, products and orders",
  store_connector: "Connect and manage commerce platform credentials",
  ai: "AI generation and assistants",
  emails: "Sending identities, templates and logs",
  integrations: "Connected third-party services",
  settings: "Workspace and personal settings",
};

const moduleKeySet = new Set<string>(WORKSPACE_MODULE_KEYS);

export const isWorkspaceModuleKey = (value: unknown): value is WorkspaceModuleKey =>
  typeof value === "string" && moduleKeySet.has(value);

/**
 * Cleans a caller-supplied grant list: unknown keys dropped, duplicates
 * removed, the always-granted modules added, and the result ordered the way the
 * rail is ordered so stored rows read the same as the UI.
 */
export const normalizeModuleAccess = (
  value: unknown,
): WorkspaceModuleKey[] => {
  const requested = new Set<WorkspaceModuleKey>(ALWAYS_GRANTED_MODULES);
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (isWorkspaceModuleKey(entry)) requested.add(entry);
    }
  }
  return WORKSPACE_MODULE_KEYS.filter((key) => requested.has(key));
};

/** `null` means unrestricted, which is what an owner or admin always gets. */
export const moduleAccessAllows = (
  allowed: readonly string[] | null | undefined,
  key: string,
) => {
  if (!allowed) return true;
  if (ALWAYS_GRANTED_MODULES.includes(key as WorkspaceModuleKey)) return true;
  return allowed.includes(key);
};

export const describeModuleAccess = (
  allowed: readonly string[] | null | undefined,
) => {
  if (!allowed) return "Every module";
  const granted = allowed.filter(
    (key) => !ALWAYS_GRANTED_MODULES.includes(key as WorkspaceModuleKey),
  );
  if (granted.length === 0) return "Home and personal settings only";
  if (granted.length === ASSIGNABLE_MODULE_KEYS.length) return "Every module";
  return `${granted.length} of ${ASSIGNABLE_MODULE_KEYS.length} modules`;
};

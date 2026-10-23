export type IntegrationStatus =
  | "available"
  | "coming_soon"
  | "configuration_required"
  | "not_connected"
  | "connecting"
  | "connected"
  | "partially_connected"
  | "reconnect_required"
  | "expired"
  | "error"
  | "disabled"
  | "revoked";

export type IntegrationModule =
  | "appointments"
  | "forms"
  | "events"
  | "crm"
  | "files"
  | "documents"
  | "campaigns"
  | "reports"
  | "automations"
  | "emails";

export type IntegrationCapability =
  | "calendar.read"
  | "calendar.write"
  | "availability.read"
  | "meeting.create"
  | "spreadsheet.write"
  | "file.read"
  | "file.write"
  | "folder.read"
  | "folder.create"
  | "file.import"
  | "file.export"
  | "email.read"
  | "email.send"
  | "message.send"
  | "contacts.read"
  | "contact.sync"
  | "webhook.send";

export type IntegrationPurpose =
  | "calendar"
  | "meeting"
  | "spreadsheet"
  | "storage"
  | "email"
  | "messaging"
  | "contacts"
  | "webhook";

export type IntegrationProvider = {
  key: string;
  name: string;
  description: string;
  category: string;
  authType: string;
  capabilities: string[];
  supportedModules: string[];
  setupUrl: string;
  platformConfigured: boolean;
  status: IntegrationStatus;
  connectionCount: number;
  connectedCount: number;
  attentionCount: number;
  configurationMessage: string;
  availability: "active" | "coming_soon";
};

export type IntegrationConnection = {
  id: string;
  providerKey: string;
  providerName: string;
  scopeType: "workspace" | "personal";
  connectionName: string;
  accountLabel: string;
  accountId: string;
  status: IntegrationStatus;
  authType: string;
  grantedScopes: string[];
  grantedCapabilities: string[];
  enabled: boolean;
  hasCredentials: boolean;
  credentialHint: string;
  enabledModuleCount: number;
  dependencyCount: number;
  lastConnectedAt: string | null;
  lastSuccessAt: string | null;
  lastHealthCheckAt: string | null;
  lastError: string;
  reconnectRequired: boolean;
  legacySource: string;
  metadata: {
    endpointUrl?: string;
    method?: string;
    authType?: string;
    authHeader?: string;
    headerNames?: string[];
    queryParameterNames?: string[];
    hasBodyTemplate?: boolean;
    hasSecret?: boolean;
  };
};

export type IntegrationModuleAccess = {
  id: string;
  connectionId: string;
  providerKey: string;
  providerName: string;
  connectionName: string;
  moduleKey: string;
  capabilities: string[];
  enabled: boolean;
};

export type IntegrationDefault = {
  id: string;
  moduleKey: string;
  purposeKey: string;
  connectionId: string;
  providerKey: string;
  providerName: string;
  connectionName: string;
};

export type IntegrationLog = {
  id: string;
  connectionId: string;
  moduleKey: string;
  capability: string;
  actionKey: string;
  status: string;
  errorCode: string;
  errorMessage: string;
  durationMs: number | null;
  createdAt: string;
};

export type IntegrationAudit = {
  id: string;
  connectionId: string;
  providerKey: string;
  eventType: string;
  details: Record<string, unknown>;
  createdAt: string;
};

export type IntegrationsWorkspace = {
  summary: {
    connectedCount: number;
    providerCount: number;
    attentionCount: number;
    accessCount: number;
    role: string;
    canManage: boolean;
  };
  providers: IntegrationProvider[];
  connections: IntegrationConnection[];
  moduleAccess: IntegrationModuleAccess[];
  defaults: IntegrationDefault[];
  logs: IntegrationLog[];
  audit: IntegrationAudit[];
  modules: IntegrationModule[];
  purposes: IntegrationPurpose[];
};

const accessToken = () => {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem("access_token") || "";
};

const request = async <T>(action: string, options: RequestInit = {}) => {
  const token = accessToken();
  const response = await fetch(`/api/integrations/data?action=${encodeURIComponent(action)}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const value = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(value.error || "The integration request could not be completed.");
  return value as T;
};

export const getIntegrationsWorkspace = () => request<IntegrationsWorkspace>("workspace");

export type IntegrationWebhookInput = {
  connectionId?: string;
  providerKey?: "custom_webhook" | "make";
  name: string;
  endpointUrl: string;
  method: "POST" | "PUT" | "PATCH" | "DELETE" | "GET";
  headers: Record<string, string>;
  query: Record<string, string>;
  bodyTemplate: string;
  authType: "none" | "bearer" | "api_key" | "basic";
  authHeader?: string;
  authSecret?: string;
  username?: string;
  password?: string;
};

export const saveIntegrationWebhook = (input: IntegrationWebhookInput) =>
  request<{ connectionId: string }>("webhook-save", { method: "POST", body: JSON.stringify(input) });

export const setIntegrationModuleAccess = (input: {
  connectionId: string;
  moduleKey: IntegrationModule;
  enabled: boolean;
  capabilities: string[];
}) => request<{ updated: boolean }>("module-access", { method: "POST", body: JSON.stringify(input) });

export const setIntegrationDefault = (input: {
  moduleKey: IntegrationModule;
  purposeKey: IntegrationPurpose;
  connectionId: string;
}) => request<{ updated: boolean }>("default", { method: "POST", body: JSON.stringify(input) });

export const testIntegrationConnection = (connectionId: string) =>
  request<{ ok: boolean; error?: string; statusCode?: number; durationMs?: number; responseBody?: string }>("test", { method: "POST", body: JSON.stringify({ connectionId }) });

export const disconnectIntegrationConnection = (connectionId: string, confirmed = false) =>
  request<{ disconnected: boolean; dependencies?: { workflows: number; modules: number } }>("disconnect", {
    method: "POST",
    body: JSON.stringify({ connectionId, confirmed }),
  });

const schedulingProviders = new Set(["zoom", "calendly", "cal_com"]);
const generalProviders = new Set(["slack", "airtable", "hubspot", "mailchimp", "notion", "dropbox"]);

const providerAlias = (providerKey: string, capability = "") => {
  if (providerKey === "google_workspace") return capability.startsWith("calendar") || capability === "availability.read" || capability === "meeting.create" ? "google_calendar" : "google_sheets";
  if (providerKey === "microsoft_365") return capability === "meeting.create" ? "teams" : "outlook";
  return providerKey;
};

/** Starts one of the existing hardened OAuth handshakes without exposing tokens to the browser. */
export const beginIntegrationConnection = async (
  providerKey: string,
  capability = "",
) => {
  if (["box", "zapier"].includes(providerKey)) {
    throw new Error("This provider is coming soon and cannot be connected yet.");
  }
  const alias = providerAlias(providerKey, capability);
  const scheduling = schedulingProviders.has(alias);
  const general = generalProviders.has(alias) || alias === "google_sheets";
  if (!scheduling && !general) throw new Error("This connection method is not available yet.");
  const token = accessToken();
  const endpoint = scheduling ? "/api/appointments/integrations?action=prepare" : "/api/integrations/oauth?action=prepare";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ provider: alias, returnTo: "/dashboard?tab=integrations&section=connections" }),
  });
  const value = (await response.json().catch(() => ({}))) as { authorizationUrl?: string; error?: string };
  if (!response.ok || !value.authorizationUrl) throw new Error(value.error || "This integration is not available in this workspace yet.");
  return value.authorizationUrl;
};

export const connectIntegrationApiKey = async (providerKey: string, apiKey: string) => {
  const alias = providerAlias(providerKey);
  const token = accessToken();
  const response = await fetch("/api/appointments/integrations?action=connect-key", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ provider: alias, apiKey }),
  });
  const value = (await response.json().catch(() => ({}))) as { connected?: boolean; error?: string };
  if (!response.ok || !value.connected) throw new Error(value.error || "The provider rejected that key.");
  return value;
};

export const openIntegrationPopup = (authorizationUrl: string) => {
  if (typeof window === "undefined") return null;
  return window.open(authorizationUrl, "maxform-integration-connect", "popup,width=620,height=760,resizable=yes,scrollbars=yes");
};

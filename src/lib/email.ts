export type EmailProviderId =
  | "tosend"
  | "resend"
  | "sender"
  | "smtp"
  | "sendgrid"
  | "postmark"
  | "mailgun"
  | "ses";

export type EmailProviderSchema = {
  name: string;
  description: string;
  fields: Array<{
    key: string;
    label: string;
    type: "text" | "number" | "secret" | "select";
    default?: string;
    options?: string[];
  }>;
};

export type EmailConnection = {
  id: string;
  provider: EmailProviderId;
  mode: "managed" | "custom";
  credentialHint: string;
  role: "primary" | "fallback" | "none";
  isActive: boolean;
  status: "connected" | "attention" | "disconnected";
  healthOk: boolean;
  validationMode: "api" | "delivery";
  accessMode: "send" | "send_receive";
  lastHealthCheckAt: string | null;
  lastVerifiedAt: string | null;
  lastError: string;
  createdAt: string | null;
  inboundEnabled: boolean;
  eventsEnabled: boolean;
};

export type EmailIdentity = {
  id: string;
  senderName: string;
  senderEmail: string;
  replyTo: string;
  sendingMode: "managed" | "custom";
  senderPrefix: string;
  managedDomain: string;
  generatedSenderEmail: string;
  managedSenderEmail: string;
  customSenderEmail: string;
  customDomain: string;
  domainVerified: boolean;
  domainVerificationStatus: "not_required" | "pending" | "verified" | "failed";
  senderReady: boolean;
  senderError: string;
  status: "unverified" | "pending" | "verified";
  isDefault: boolean;
  updatedAt: string | null;
};

export type EmailDnsRecord = {
  type: string;
  name: string;
  value: string;
  priority?: number | null;
};

export type EmailSendingDomain = {
  id: string;
  provider: EmailProviderId;
  domain: string;
  providerDomainId: string;
  status: "pending" | "verified" | "failed" | "unknown";
  records: EmailDnsRecord[];
  lastError: string;
  lastCheckedAt: string | null;
  verifiedAt: string | null;
  createdAt: string | null;
};

export type EmailTemplate = {
  id: string;
  key: string;
  module: string;
  name: string;
  subject: string;
  htmlBody: string;
  textBody: string;
  blocks: unknown[];
  identityId: string | null;
  isCustom: boolean;
  updatedAt: string | null;
};

export type EmailLog = {
  id: string;
  templateKey: string;
  module: string;
  provider: string;
  recipient: string;
  subject: string;
  status: "queued" | "sending" | "sent" | "delivered" | "opened" | "clicked" | "bounced" | "complained" | "failed" | "skipped" | "unknown";
  providerMessageId: string;
  attemptCount: number;
  error: string;
  relatedTicketIds: string[];
  createdAt: string | null;
  sentAt: string | null;
};

export type InboundEmail = {
  id: string;
  provider: string;
  sender: string;
  recipient: string;
  subject: string;
  htmlBody: string;
  textBody: string;
  status: "received" | "read" | "archived";
  receivedAt: string | null;
};

export type EmailActiveProvider = {
  provider: EmailProviderId;
  mode: "managed" | "custom";
};

export type EmailWorkspace = {
  managedSendingDomain: string;
  managedSendingConfigured: boolean;
  activeProvider: EmailActiveProvider | null;
  managedConnection: EmailConnection;
  connections: EmailConnection[];
  identities: EmailIdentity[];
  domains: EmailSendingDomain[];
  templates: EmailTemplate[];
  logs: EmailLog[];
  received: InboundEmail[];
  settings: {
    defaultIdentityId: string | null;
    rateLimitPerHour: number;
    suppressionThreshold: number;
    suppressionBehavior: "suppress" | "pause_campaigns";
  };
  overview: {
    sent30d: number;
    negative30d: number;
    failed30d: number;
    delivered30d: number;
    suppressions: number;
  };
};

/** Browser event used to keep the Email and Events template galleries in sync. */
export const EMAIL_TEMPLATES_UPDATED_EVENT = "maxform:email-templates-updated";

export const isWorkspaceEmailTemplate = (template: Pick<EmailTemplate, "key">) =>
  !template.key.startsWith("event_override_");

export const isSharedEventEmailTemplate = (
  template: Pick<EmailTemplate, "key" | "module">,
) => template.module === "events" && isWorkspaceEmailTemplate(template);

export type EmailAnalytics = {
  rangeDays: number;
  generatedAt: string;
  totals: {
    total: number;
    queued: number;
    accepted: number;
    delivered: number;
    opened: number;
    clicked: number;
    bounced: number;
    complained: number;
    failed: number;
  };
  rates: { acceptance: number; open: number; click: number; risk: number; failure: number };
  trend: Array<{ date: string; total: number; accepted: number; opened: number; clicked: number; failed: number }>;
  providers: Array<{ provider: string; total: number; accepted: number; opened: number; clicked: number; failed: number }>;
  templates: Array<{ key: string; module: string; total: number; accepted: number; opened: number; clicked: number; failed: number }>;
  modules: Array<{ module: string; total: number; accepted: number; failed: number }>;
};

const headers = () => ({
  Authorization: `Bearer ${localStorage.getItem("access_token") || ""}`,
  "Content-Type": "application/json",
});

export class EmailRequestError extends Error {
  constructor(
    message: string,
    readonly code = "email_request_failed",
    readonly status = 0,
  ) {
    super(message);
    this.name = "EmailRequestError";
  }
}

const request = async <T>(
  action: string,
  init: RequestInit = {},
  query: Record<string, string> = {},
) => {
  const params = new URLSearchParams({ action, ...query });
  const response = await fetch(`/api/email/data?${params.toString()}`, {
    ...init,
    headers: { ...headers(), ...(init.headers || {}) },
  });
  // A body that is not JSON has to fail loudly. Treating it as `{}` lets an
  // HTML error page, a proxy notice, or a re-auth redirect through as a
  // successful workspace, and every panel then dereferences fields that are not
  // there — which blanks the tab instead of showing the error state.
  let parsed: unknown;
  let readable = true;
  try {
    parsed = await response.json();
  } catch {
    readable = false;
  }
  const value = (readable && parsed && typeof parsed === "object" ? parsed : {}) as T & {
    error?: string;
    code?: string;
  };
  if (!response.ok) {
    throw new EmailRequestError(
      value.error || "Email settings could not be updated.",
      value.code || "email_request_failed",
      response.status,
    );
  }
  if (!readable || !parsed || typeof parsed !== "object") {
    throw new EmailRequestError(
      "Email settings returned an unexpected response. Please try again.",
      "email_invalid_response",
      response.status,
    );
  }
  return value;
};

export const getEmailWorkspace = (filters: { status?: string; search?: string } = {}) =>
  request<EmailWorkspace>("workspace", {}, {
    status: filters.status || "",
    search: filters.search || "",
  });

export const getEmailAnalytics = (days = 30) =>
  request<EmailAnalytics>("analytics", {}, { days: String(days) });

export const getEmailProviderSchemas = async () =>
  (await request<{ providers: Record<EmailProviderId, EmailProviderSchema> }>("schema")).providers;

export const connectEmailProvider = (provider: EmailProviderId, credentials: Record<string, string>) =>
  request<{ connection: EmailConnection }>("connect", { method: "POST", body: JSON.stringify({ provider, credentials }) });

export const connectManagedEmailProvider = () =>
  request<{ connected: true }>("connect-managed", { method: "POST", body: "{}" });

export const disconnectEmailProvider = (provider: EmailProviderId) =>
  request("disconnect", { method: "POST", body: JSON.stringify({ provider }) });

export const disconnectManagedEmailProvider = () =>
  request<{ disconnected: true }>("disconnect-managed", { method: "POST", body: "{}" });

export const checkEmailProviderHealth = (provider: EmailProviderId) =>
  request<{ health: { ok: boolean; checkedAt: string; error: string } }>("health", { method: "POST", body: JSON.stringify({ provider }) });

export const setEmailProviderRole = (provider: EmailProviderId, role: EmailConnection["role"] | "active", mode: EmailConnection["mode"] = "custom") =>
  request("provider-role", { method: "POST", body: JSON.stringify({ provider, role, mode }) });

export const createEmailInboundWebhook = (provider: EmailProviderId) =>
  request<{ webhook: { connectionId: string; token: string; path: string } }>("inbound-webhook", { method: "POST", body: JSON.stringify({ provider }) });

export const createEmailAnalyticsWebhook = (provider: EmailProviderId) =>
  request<{ webhook: { connectionId: string; token: string; path: string } }>("analytics-webhook", { method: "POST", body: JSON.stringify({ provider }) });

export const saveEmailIdentity = (input: Partial<EmailIdentity>) =>
  request<{ identity: EmailIdentity }>("identity", { method: "POST", body: JSON.stringify(input) });

export const addEmailSendingDomain = (domain: string) =>
  request<{ domain: EmailSendingDomain }>("domain-add", {
    method: "POST",
    body: JSON.stringify({ domain }),
  });

export const verifyEmailSendingDomain = (id: string) =>
  request<{ domain: EmailSendingDomain }>("domain-verify", {
    method: "POST",
    body: JSON.stringify({ id }),
  });

export const deleteEmailSendingDomain = (id: string) =>
  request<{ deleted: true; domain: string }>("domain-delete", {
    method: "POST",
    body: JSON.stringify({ id }),
  });

export const deleteEmailIdentity = (id: string) =>
  request("delete-identity", { method: "POST", body: JSON.stringify({ id }) });

export const saveEmailTemplate = async (input: Partial<EmailTemplate>) => {
  const result = await request<{ template: EmailTemplate }>("template", {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(EMAIL_TEMPLATES_UPDATED_EVENT));
  }
  return result;
};

export const saveEmailSettings = (input: EmailWorkspace["settings"]) =>
  request("settings", { method: "POST", body: JSON.stringify(input) });

export const sendEmailTest = (input: { to: string; templateKey: string; identityId?: string | null }) =>
  request("send-test", { method: "POST", body: JSON.stringify(input) });

export const retryEmailLog = (id: string) =>
  request("retry", { method: "POST", body: JSON.stringify({ id }) });

export const deleteEmailLogs = (input: { ids?: string[]; all?: boolean }) =>
  request<{ deleted: number; skippedActive: number; ids: string[] }>("delete-logs", {
    method: "POST",
    body: JSON.stringify(input),
  });

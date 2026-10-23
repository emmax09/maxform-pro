import type { IncomingMessage, ServerResponse } from "node:http";
import { lookup } from "node:dns/promises";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { isIP } from "node:net";

import { neon } from "@neondatabase/serverless";
import { jwtVerify } from "jose";

import { testAutomationConnectionForCentral } from "./integration-oauth";
import { testSchedulingConnectionForCentral } from "./scheduling-oauth";
import { isComingSoonProvider } from "./integration-provider-registry";
import { workspaceScopeFor } from "./workspace-access";

/**
 * The central integrations service is deliberately payment-blind. Payment
 * providers do not appear in this registry, these capability maps, or any of
 * the mutation routes below.
 */

export const INTEGRATION_MODULES = [
  "appointments",
  "forms",
  "events",
  "crm",
  "files",
  "documents",
  "campaigns",
  "reports",
  "automations",
  "emails",
] as const;

export type IntegrationModule = (typeof INTEGRATION_MODULES)[number];

export const INTEGRATION_CAPABILITIES = [
  "calendar.read",
  "calendar.write",
  "availability.read",
  "meeting.create",
  "spreadsheet.write",
  "file.read",
  "file.write",
  "folder.read",
  "folder.create",
  "file.import",
  "file.export",
  "email.read",
  "email.send",
  "message.send",
  "contacts.read",
  "contact.sync",
  "webhook.send",
] as const;

export type IntegrationCapability = (typeof INTEGRATION_CAPABILITIES)[number];

export const INTEGRATION_PURPOSES = [
  "calendar",
  "meeting",
  "spreadsheet",
  "storage",
  "email",
  "messaging",
  "contacts",
  "webhook",
] as const;

export type IntegrationPurpose = (typeof INTEGRATION_PURPOSES)[number];

export const MODULE_CAPABILITIES: Record<IntegrationModule, IntegrationCapability[]> = {
  appointments: ["calendar.read", "calendar.write", "availability.read", "meeting.create"],
  forms: ["spreadsheet.write", "file.read", "file.write", "folder.read", "folder.create", "file.import", "file.export", "message.send", "webhook.send", "contact.sync"],
  events: ["calendar.write", "meeting.create", "spreadsheet.write", "file.read", "file.write", "folder.read", "folder.create", "file.import", "file.export", "message.send", "webhook.send"],
  crm: ["email.read", "email.send", "calendar.read", "calendar.write", "message.send", "contacts.read", "contact.sync"],
  files: ["file.read", "file.write", "folder.read", "folder.create", "file.import", "file.export"],
  documents: ["file.read", "file.write", "folder.read", "folder.create", "file.import", "file.export"],
  campaigns: ["email.send", "message.send", "contact.sync", "webhook.send"],
  reports: ["spreadsheet.write", "file.write"],
  automations: [...INTEGRATION_CAPABILITIES],
  emails: ["email.read", "email.send"],
};

type ProviderDefinition = {
  key: string;
  name: string;
  description: string;
  category: string;
  authType: "oauth" | "api_key" | "webhook" | "managed";
  capabilities: IntegrationCapability[];
  supportedModules: IntegrationModule[];
  env: string[];
  setupUrl: string;
};

const provider = (
  input: Omit<ProviderDefinition, "key"> & { key: string },
): ProviderDefinition => input;

/**
 * This mirrors the seeded database registry and is also used to make server
 * configuration status safe. Environment variable names never leave this
 * module; ordinary users see only a normalized configuration_required state.
 */
export const INTEGRATION_PROVIDER_DEFINITIONS: Record<string, ProviderDefinition> = {
  google_workspace: provider({
    key: "google_workspace",
    name: "Google Workspace",
    description: "Connect Google Calendar, Meet, Drive, Docs, and Sheets to MaxForm.",
    category: "productivity",
    authType: "oauth",
    capabilities: ["calendar.read", "calendar.write", "availability.read", "meeting.create", "spreadsheet.write", "file.read", "file.write", "folder.read", "folder.create", "file.import", "file.export", "email.send"],
    supportedModules: ["appointments", "forms", "events", "crm", "files", "documents", "campaigns", "reports", "automations"],
    env: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    setupUrl: "https://console.cloud.google.com/apis/credentials",
  }),
  microsoft_365: provider({
    key: "microsoft_365",
    name: "Microsoft 365",
    description: "Connect Outlook Calendar, Teams, OneDrive, Word, and Excel to MaxForm.",
    category: "productivity",
    authType: "oauth",
    capabilities: ["calendar.read", "calendar.write", "availability.read", "meeting.create", "file.read", "file.write", "spreadsheet.write"],
    supportedModules: ["appointments", "forms", "events", "crm", "files", "documents", "campaigns", "reports", "automations"],
    env: ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET"],
    setupUrl: "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps",
  }),
  zoom: provider({
    key: "zoom", name: "Zoom", description: "Create and manage video meetings from appointments and events.", category: "video", authType: "oauth", capabilities: ["meeting.create"], supportedModules: ["appointments", "events"], env: ["ZOOM_CLIENT_ID", "ZOOM_CLIENT_SECRET"], setupUrl: "https://marketplace.zoom.us/develop/create",
  }),
  slack: provider({
    key: "slack", name: "Slack", description: "Send workspace messages and operational alerts.", category: "messaging", authType: "oauth", capabilities: ["message.send"], supportedModules: ["forms", "events", "crm", "campaigns", "automations"], env: ["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET"], setupUrl: "https://api.slack.com/apps",
  }),
  airtable: provider({
    key: "airtable", name: "Airtable", description: "Write form and event data into Airtable bases.", category: "data", authType: "oauth", capabilities: ["spreadsheet.write", "contact.sync"], supportedModules: ["forms", "events", "crm", "automations"], env: ["AIRTABLE_CLIENT_ID", "AIRTABLE_CLIENT_SECRET"], setupUrl: "https://airtable.com/create/oauth",
  }),
  hubspot: provider({
    key: "hubspot", name: "HubSpot", description: "Keep contacts, leads, and lifecycle activity in sync.", category: "crm", authType: "oauth", capabilities: ["contacts.read", "contact.sync", "email.read", "email.send"], supportedModules: ["crm", "forms", "events", "campaigns", "automations"], env: ["HUBSPOT_CLIENT_ID", "HUBSPOT_CLIENT_SECRET"], setupUrl: "https://developers.hubspot.com/",
  }),
  mailchimp: provider({
    key: "mailchimp", name: "Mailchimp", description: "Sync audiences and campaign recipients.", category: "messaging", authType: "oauth", capabilities: ["contact.sync", "email.send"], supportedModules: ["forms", "crm", "campaigns", "automations"], env: ["MAILCHIMP_CLIENT_ID", "MAILCHIMP_CLIENT_SECRET"], setupUrl: "https://admin.mailchimp.com/account/api/",
  }),
  notion: provider({
    key: "notion", name: "Notion", description: "Create pages and keep workspace notes connected.", category: "productivity", authType: "oauth", capabilities: ["file.write"], supportedModules: ["forms", "events", "crm", "documents", "automations"], env: ["NOTION_CLIENT_ID", "NOTION_CLIENT_SECRET"], setupUrl: "https://www.notion.so/my-integrations",
  }),
  calendly: provider({
    key: "calendly", name: "Calendly", description: "Sync scheduling availability and booking links.", category: "scheduling", authType: "oauth", capabilities: ["availability.read", "meeting.create"], supportedModules: ["appointments", "events"], env: ["CALENDLY_CLIENT_ID", "CALENDLY_CLIENT_SECRET"], setupUrl: "https://developer.calendly.com/",
  }),
  cal_com: provider({
    key: "cal_com", name: "Cal.com", description: "Sync scheduling availability and bookings.", category: "scheduling", authType: "api_key", capabilities: ["availability.read", "meeting.create"], supportedModules: ["appointments", "events"], env: [], setupUrl: "https://cal.com/docs/api",
  }),
  resend: provider({
    key: "resend", name: "Resend", description: "Deliver workspace and campaign email.", category: "email", authType: "api_key", capabilities: ["email.send"], supportedModules: ["forms", "events", "crm", "campaigns", "automations", "emails"], env: [], setupUrl: "https://resend.com/api-keys",
  }),
  sendgrid: provider({
    key: "sendgrid", name: "SendGrid", description: "Deliver transactional and campaign email.", category: "email", authType: "api_key", capabilities: ["email.send"], supportedModules: ["forms", "events", "crm", "campaigns", "automations", "emails"], env: [], setupUrl: "https://app.sendgrid.com/guide/integrate",
  }),
  postmark: provider({
    key: "postmark", name: "Postmark", description: "Deliver reliable transactional email.", category: "email", authType: "api_key", capabilities: ["email.send"], supportedModules: ["forms", "events", "crm", "campaigns", "automations", "emails"], env: [], setupUrl: "https://account.postmarkapp.com/servers",
  }),
  mailgun: provider({
    key: "mailgun", name: "Mailgun", description: "Deliver transactional and campaign email.", category: "email", authType: "api_key", capabilities: ["email.send"], supportedModules: ["forms", "events", "crm", "campaigns", "automations", "emails"], env: [], setupUrl: "https://app.mailgun.com/app/account/security/api_keys",
  }),
  ses: provider({
    key: "ses", name: "Amazon SES", description: "Deliver high-volume workspace email.", category: "email", authType: "api_key", capabilities: ["email.send"], supportedModules: ["forms", "events", "crm", "campaigns", "automations", "emails"], env: [], setupUrl: "https://console.aws.amazon.com/ses/",
  }),
  dropbox: provider({
    key: "dropbox", name: "Dropbox", description: "Copy, import, organize, and link workspace files.", category: "storage", authType: "oauth", capabilities: ["file.read", "file.write", "folder.read", "folder.create", "file.import", "file.export"], supportedModules: ["files", "documents", "forms", "events", "automations"], env: ["DROPBOX_CLIENT_ID", "DROPBOX_CLIENT_SECRET"], setupUrl: "https://www.dropbox.com/developers/apps",
  }),
  box: provider({
    key: "box", name: "Box", description: "Read and write shared workspace files.", category: "storage", authType: "oauth", capabilities: ["file.read", "file.write"], supportedModules: ["files", "documents", "forms", "events"], env: ["BOX_CLIENT_ID", "BOX_CLIENT_SECRET"], setupUrl: "https://developer.box.com/",
  }),
  custom_webhook: provider({
    key: "custom_webhook", name: "Custom webhook", description: "Send signed events to any HTTPS endpoint.", category: "automation", authType: "webhook", capabilities: ["webhook.send"], supportedModules: ["forms", "events", "crm", "campaigns", "automations", "reports"], env: [], setupUrl: "",
  }),
  zapier: provider({
    key: "zapier", name: "Zapier", description: "Route MaxForm events into your Zapier workflows.", category: "automation", authType: "webhook", capabilities: ["webhook.send"], supportedModules: ["forms", "events", "crm", "campaigns", "automations"], env: [], setupUrl: "https://zapier.com/app/developer",
  }),
  make: provider({
    key: "make", name: "Make", description: "Route MaxForm events into your Make scenarios.", category: "automation", authType: "webhook", capabilities: ["webhook.send"], supportedModules: ["forms", "events", "crm", "campaigns", "automations"], env: [], setupUrl: "https://www.make.com/en/developers",
  }),
};

/** Email delivery and email-marketing providers belong to the Email module,
 * not to this workspace-wide productivity hub. Keep their legacy adapters
 * intact, but never project them into the central directory or its counts. */
const isExcludedProvider = (providerKey: string) => {
  const definition = INTEGRATION_PROVIDER_DEFINITIONS[providerKey];
  return definition?.category === "email" || providerKey === "mailchimp";
};

const PAYMENT_WORDS = /payment|paystack|stripe|flutterwave|paypal|checkout|wallet|invoice/i;

export const safeIntegrationError = (message: unknown) => {
  const value = String(message || "").trim().slice(0, 300);
  if (!value || PAYMENT_WORDS.test(value)) return "The integration request could not be completed.";
  if (/not configured|configuration|client[_ -]?secret|client[_ -]?id|encryption key|environment/i.test(value)) {
    return "This integration is not available in this workspace yet.";
  }
  return value;
};

export const normalizeLegacyProvider = (providerKey: string) => {
  if (providerKey === "google_sheets" || providerKey === "google_calendar" || providerKey === "google_meet") return "google_workspace";
  if (providerKey === "outlook" || providerKey === "teams") return "microsoft_365";
  if (providerKey === "webhook") return "custom_webhook";
  return providerKey;
};

export const normalizeLegacyStatus = (status: string) => {
  if (status === "connected") return "connected";
  if (status === "needs_reconnect") return "reconnect_required";
  if (status === "attention") return "error";
  if (status === "disabled") return "disabled";
  if (status === "error") return "error";
  return "not_connected";
};

const database = () => {
  const url = process.env.DATABASE_URL || "";
  if (!url) throw new IntegrationDataError("The integrations workspace is temporarily unavailable.", 503, "integrations_unavailable");
  return neon(url);
};

type DatabaseRow = Record<string, unknown>;

const query = async <Row extends DatabaseRow = DatabaseRow>(text: string, params: unknown[] = []) =>
  (await database().query(text, params)) as Row[];

export class IntegrationDataError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "integration_error",
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const signingSecret = () => {
  const secret = process.env.JWT_SECRET || "";
  if (secret.length < 32) throw new IntegrationDataError("The integrations workspace is temporarily unavailable.", 503, "integrations_unavailable");
  return new TextEncoder().encode(secret);
};

const authenticatedUserId = async (request: IncomingMessage) => {
  const authorization = String(request.headers.authorization || "");
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) throw new IntegrationDataError("Your session has expired. Sign in and try again.", 401, "authentication_required");
  try {
    const { payload } = await jwtVerify(token, signingSecret(), { audience: "maxform-dashboard", issuer: "maxform" });
    const userId = String(payload.userId || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) throw new Error("Invalid user");
    // The workspace this request acts in. Identical to the signed-in id
    // for a workspace owner; an added member resolves to the workspace
    // they belong to, so every query below reads the same rows.
    return workspaceScopeFor(userId);
  } catch (error) {
    if (error instanceof IntegrationDataError) throw error;
    throw new IntegrationDataError("Your session has expired. Sign in and try again.", 401, "authentication_required");
  }
};

const readBody = async (request: IncomingMessage) => {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) throw new IntegrationDataError("This integrations request is too large.", 413);
  }
  if (!body) return {} as Record<string, unknown>;
  try {
    const value = JSON.parse(body) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid");
    return value as Record<string, unknown>;
  } catch {
    throw new IntegrationDataError("This integrations request could not be read.", 400);
  }
};

const json = (response: ServerResponse, status: number, value: Record<string, unknown>) => {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "private, no-store, max-age=0");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("Vary", "Authorization");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.end(JSON.stringify(value));
};

const asString = (value: unknown) => (value == null ? "" : String(value));
const asBoolean = (value: unknown) => value === true || value === "true" || value === 1;
const asJsonArray = (value: unknown) => {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
};

type WebhookAuthType = "none" | "bearer" | "api_key" | "basic";
export type WebhookConfig = {
  endpointUrl: string;
  method: "POST" | "PUT" | "PATCH" | "DELETE" | "GET";
  headers: Record<string, string>;
  query: Record<string, string>;
  bodyTemplate: string;
  authType: WebhookAuthType;
  authHeader?: string;
  authSecret?: string;
  username?: string;
  password?: string;
};

const webhookMethods = new Set<WebhookConfig["method"]>(["POST", "PUT", "PATCH", "DELETE", "GET"]);
const webhookAuthTypes = new Set<WebhookAuthType>(["none", "bearer", "api_key", "basic"]);
const webhookKey = () => createHash("sha256").update(String(process.env.INTEGRATION_ENCRYPTION_KEY || "")).digest();

const encryptWebhookConfig = (config: WebhookConfig) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", webhookKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(config), "utf8"), cipher.final()]);
  return `webhook:v1:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${encrypted.toString("base64url")}`;
};

const decryptWebhookConfig = (value: unknown): WebhookConfig => {
  const parts = String(value || "").split(":");
  if (parts.length !== 5 || parts[0] !== "webhook" || parts[1] !== "v1") throw new Error("This webhook connection needs to be saved again.");
  const decipher = createDecipheriv("aes-256-gcm", webhookKey(), Buffer.from(parts[2], "base64url"));
  decipher.setAuthTag(Buffer.from(parts[3], "base64url"));
  const raw = Buffer.concat([decipher.update(Buffer.from(parts[4], "base64url")), decipher.final()]).toString("utf8");
  const parsed = JSON.parse(raw) as WebhookConfig;
  if (!parsed.endpointUrl || !webhookMethods.has(parsed.method)) throw new Error("This webhook connection is incomplete.");
  return parsed;
};

const blockedIp = (address: string) => {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127);
  }
  const normalized = address.toLowerCase();
  return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb");
};

const validateWebhookEndpoint = async (value: unknown) => {
  const endpointUrl = String(value || "").trim();
  let parsed: URL;
  try { parsed = new URL(endpointUrl); } catch { throw new IntegrationDataError("Enter a valid webhook URL.", 422, "webhook_url_invalid"); }
  const allowHttp = String(process.env.ALLOW_INSECURE_WEBHOOKS || "").toLowerCase() === "true";
  if (parsed.protocol !== "https:" && !(allowHttp && parsed.protocol === "http:")) throw new IntegrationDataError("Use an HTTPS webhook URL.", 422, "webhook_url_insecure");
  if (parsed.username || parsed.password || parsed.hostname === "localhost" || parsed.hostname.endsWith(".local")) throw new IntegrationDataError("That webhook destination is not allowed.", 422, "webhook_url_blocked");
  if (blockedIp(parsed.hostname)) throw new IntegrationDataError("That webhook destination is not allowed.", 422, "webhook_url_blocked");
  try {
    const addresses = isIP(parsed.hostname) ? [{ address: parsed.hostname }] : await lookup(parsed.hostname, { all: true });
    if (addresses.some((address) => blockedIp(address.address))) throw new IntegrationDataError("That webhook destination is not allowed.", 422, "webhook_url_blocked");
  } catch (error) {
    if (error instanceof IntegrationDataError) throw error;
    throw new IntegrationDataError("The webhook destination could not be verified.", 422, "webhook_url_unresolved");
  }
  return parsed.toString();
};

const safeMap = (value: unknown, label: string) => {
  if (value == null || value === "") return {} as Record<string, string>;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new IntegrationDataError(`${label} must be a key/value object.`, 422, "webhook_config_invalid");
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 40) throw new IntegrationDataError(`${label} has too many entries.`, 422, "webhook_config_invalid");
  return Object.fromEntries(entries.map(([key, entryValue]) => {
    if (!/^[\w .:-]{1,100}$/.test(key) || /[\r\n]/.test(String(entryValue))) throw new IntegrationDataError(`${label} contains an invalid entry.`, 422, "webhook_config_invalid");
    return [key, String(entryValue).slice(0, 2_000)];
  }));
};

const webhookConfigFromInput = async (input: Record<string, unknown>): Promise<WebhookConfig> => {
  const method = String(input.method || "POST").toUpperCase() as WebhookConfig["method"];
  const authType = String(input.authType || "none") as WebhookAuthType;
  if (!webhookMethods.has(method)) throw new IntegrationDataError("Choose a supported webhook method.", 422, "webhook_method_invalid");
  if (!webhookAuthTypes.has(authType)) throw new IntegrationDataError("Choose a supported webhook authentication type.", 422, "webhook_auth_invalid");
  const config: WebhookConfig = {
    endpointUrl: await validateWebhookEndpoint(input.endpointUrl),
    method,
    headers: safeMap(input.headers, "Headers"),
    query: safeMap(input.query, "Query parameters"),
    bodyTemplate: String(input.bodyTemplate || "").slice(0, 100_000),
    authType,
  };
  if (authType === "bearer") config.authSecret = String(input.authSecret || "").slice(0, 4_000);
  if (authType === "api_key") {
    config.authHeader = String(input.authHeader || "X-API-Key").trim().slice(0, 100);
    config.authSecret = String(input.authSecret || "").slice(0, 4_000);
    if (!config.authHeader || /[\r\n]/.test(config.authHeader)) throw new IntegrationDataError("Enter a valid API-key header name.", 422, "webhook_auth_invalid");
  }
  if (authType === "basic") {
    config.username = String(input.username || "").slice(0, 200);
    config.password = String(input.password || "").slice(0, 4_000);
    if (!config.username || !config.password) throw new IntegrationDataError("Enter both basic-auth fields.", 422, "webhook_auth_invalid");
  }
  if (authType === "bearer" || authType === "api_key") {
    if (!config.authSecret) throw new IntegrationDataError("Enter the authentication secret.", 422, "webhook_auth_invalid");
  }
  return config;
};

const webhookMetadata = (config: WebhookConfig) => ({
  endpointUrl: config.endpointUrl,
  method: config.method,
  authType: config.authType,
  authHeader: config.authHeader || "",
  headerNames: Object.keys(config.headers),
  queryParameterNames: Object.keys(config.query),
  hasBodyTemplate: Boolean(config.bodyTemplate),
  hasSecret: Boolean(config.authSecret || config.password),
});

const cleanWebhookResponse = (value: string) =>
  Array.from(value).filter((character) => {
    const code = character.charCodeAt(0);
    return !(code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31));
  }).join("");

const webhookTemplateValue = (payload: Record<string, unknown>, path: string) => {
  const value = path.trim().split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[key];
  }, payload);
  return value == null ? "" : typeof value === "string" ? value : JSON.stringify(value);
};

const renderWebhookBody = (template: string, payload: Record<string, unknown>) => {
  if (!template.trim()) return JSON.stringify(payload);
  const rendered = template.replace(/{{\s*([^}]+)\s*}}/g, (_match, path: string) => webhookTemplateValue(payload, path));
  try { return JSON.stringify(JSON.parse(rendered)); } catch { return rendered; }
};

const runWebhookRequest = async (config: WebhookConfig, payload: Record<string, unknown>) => {
  const url = new URL(config.endpointUrl);
  for (const [key, value] of Object.entries(config.query)) url.searchParams.set(key, value);
  const headers: Record<string, string> = { "Content-Type": "application/json", ...config.headers };
  if (config.authType === "bearer") headers.Authorization = `Bearer ${config.authSecret}`;
  if (config.authType === "api_key" && config.authHeader) headers[config.authHeader] = config.authSecret || "";
  if (config.authType === "basic") headers.Authorization = `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  const started = Date.now();
  try {
    const response = await fetch(url, { method: config.method, headers, body: config.method === "GET" ? undefined : renderWebhookBody(config.bodyTemplate, payload), signal: controller.signal });
    const raw = cleanWebhookResponse((await response.text()).slice(0, 64_000));
    return { ok: response.ok, statusCode: response.status, durationMs: Date.now() - started, responseBody: raw };
  } catch (error) {
    return { ok: false, statusCode: 0, durationMs: Date.now() - started, responseBody: error instanceof Error && error.name === "AbortError" ? "The webhook request timed out." : "The webhook request could not be completed." };
  } finally {
    clearTimeout(timer);
  }
};

const configuredForProvider = (key: string) => {
  if (["cal_com", "resend", "sendgrid", "postmark", "mailgun", "ses", "custom_webhook", "make"].includes(key)) return true;
  const definition = INTEGRATION_PROVIDER_DEFINITIONS[key];
  return Boolean(definition?.env.every((name) => String(process.env[name] || "").trim()) && process.env.INTEGRATION_ENCRYPTION_KEY && process.env.DATABASE_URL);
};

const connectionStatus = (row: DatabaseRow) => {
  const status = asString(row.status);
  if (asBoolean(row.reconnect_required)) return "reconnect_required";
  return status || "not_connected";
};

export const syncLegacyConnections = async (workspaceId: string) => {
  await query(
    `INSERT INTO integration_connections (
       id, workspace_id, scope_type, provider_key, connection_name,
       external_account_id, external_account_name, status, auth_type,
       credentials_encrypted, token_expires_at, granted_scopes, metadata,
       reconnect_required, last_error, legacy_source, legacy_connection_id,
       created_at, updated_at
     )
     SELECT c.id, c.user_id, 'workspace',
       CASE c.provider WHEN 'google_sheets' THEN 'google_workspace' WHEN 'webhook' THEN 'custom_webhook' ELSE c.provider END,
       c.name, COALESCE(c.external_account_id, ''), COALESCE(c.external_account_name, c.name),
       CASE c.status WHEN 'connected' THEN 'connected' WHEN 'error' THEN 'error' WHEN 'disabled' THEN 'disabled' ELSE 'not_connected' END,
       COALESCE(c.auth_type, 'oauth'), c.credentials_encrypted, c.token_expires_at,
       COALESCE(c.scopes, '[]'::jsonb), jsonb_build_object('legacyProvider', c.provider), FALSE,
       COALESCE(c.last_error, ''), 'automation', c.id, c.created_at, c.updated_at
     FROM automation_connections c
     WHERE c.user_id = $1
       AND EXISTS (SELECT 1 FROM integration_providers p WHERE p.key = CASE c.provider WHEN 'google_sheets' THEN 'google_workspace' WHEN 'webhook' THEN 'custom_webhook' ELSE c.provider END)
     ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status,
       credentials_encrypted = COALESCE(EXCLUDED.credentials_encrypted, integration_connections.credentials_encrypted),
       external_account_id = EXCLUDED.external_account_id, external_account_name = EXCLUDED.external_account_name,
       granted_scopes = EXCLUDED.granted_scopes, last_error = EXCLUDED.last_error,
       updated_at = EXCLUDED.updated_at
     WHERE integration_connections.legacy_source = 'automation'`,
    [workspaceId],
  );

  await query(
    `INSERT INTO integration_connections (
       id, workspace_id, scope_type, provider_key, connection_name,
       external_account_id, external_account_name, status, auth_type,
       credentials_encrypted, token_expires_at, granted_scopes, metadata,
       reconnect_required, last_error, legacy_source, legacy_connection_id,
       created_at, updated_at
     )
     SELECT c.id, c.user_id, 'workspace',
       CASE c.provider WHEN 'google_calendar' THEN 'google_workspace' WHEN 'google_meet' THEN 'google_workspace' WHEN 'outlook' THEN 'microsoft_365' WHEN 'teams' THEN 'microsoft_365' ELSE c.provider END,
       c.account_label, COALESCE(c.external_account_id, ''), c.account_label,
       CASE c.status WHEN 'connected' THEN 'connected' WHEN 'needs_reconnect' THEN 'reconnect_required' WHEN 'error' THEN 'error' ELSE 'not_connected' END,
       COALESCE(c.auth_type, 'oauth'), c.credentials_encrypted->>'cipher', c.token_expires_at,
       COALESCE(c.scopes, '[]'::jsonb), jsonb_build_object('legacyProvider', c.provider),
       c.status = 'needs_reconnect', COALESCE(c.last_error, ''), 'scheduling', c.id, c.created_at, c.updated_at
     FROM scheduling_tool_connections c
     WHERE c.user_id = $1
       AND EXISTS (SELECT 1 FROM integration_providers p WHERE p.key = CASE c.provider WHEN 'google_calendar' THEN 'google_workspace' WHEN 'google_meet' THEN 'google_workspace' WHEN 'outlook' THEN 'microsoft_365' WHEN 'teams' THEN 'microsoft_365' ELSE c.provider END)
     ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status, credentials_encrypted = EXCLUDED.credentials_encrypted,
       external_account_id = EXCLUDED.external_account_id, external_account_name = EXCLUDED.external_account_name,
       granted_scopes = EXCLUDED.granted_scopes, reconnect_required = EXCLUDED.reconnect_required,
       last_error = EXCLUDED.last_error, updated_at = EXCLUDED.updated_at
     WHERE integration_connections.legacy_source = 'scheduling'`,
    [workspaceId],
  );

  await query(
    `INSERT INTO integration_connections (
       id, workspace_id, scope_type, provider_key, connection_name,
       external_account_name, status, auth_type, credentials_encrypted,
       metadata, last_error, legacy_source, legacy_connection_id,
       created_at, updated_at
     )
     SELECT c.id, c.user_id, 'workspace', c.provider, c.provider, c.provider,
       CASE c.status WHEN 'connected' THEN 'connected' WHEN 'attention' THEN 'error' ELSE 'not_connected' END,
       'api_key', c.credentials_encrypted,
       jsonb_build_object('legacyProvider', c.provider, 'credentialHint', c.credential_hint, 'role', c.role),
       COALESCE(c.last_error, ''), 'email', c.id, c.created_at, c.updated_at
     FROM email_provider_connections c
     WHERE c.user_id = $1
       AND EXISTS (SELECT 1 FROM integration_providers p WHERE p.key = c.provider)
     ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status, metadata = EXCLUDED.metadata, last_error = EXCLUDED.last_error,
       updated_at = EXCLUDED.updated_at
     WHERE integration_connections.legacy_source = 'email'`,
    [workspaceId],
  );
};

/**
 * A connected account is automatically usable by every compatible module.
 * The table remains as a compatibility projection for older workflow records,
 * but access is never a second setup step in the central hub.
 */
const syncAutomaticModuleAccess = async (workspaceId: string) => {
  const rows = await query(`
    SELECT c.id, c.provider_key, c.status, p.capabilities, p.supported_modules
    FROM integration_connections c
    JOIN integration_providers p ON p.key = c.provider_key
    WHERE c.workspace_id = $1
      AND c.status IN ('connected', 'partially_connected')
      AND c.provider_key NOT IN ('box', 'zapier')
      AND p.category <> 'email'
      AND p.key <> 'mailchimp'
  `, [workspaceId]);
  for (const row of rows) {
    const providerKey = asString(row.provider_key);
    const definition = INTEGRATION_PROVIDER_DEFINITIONS[providerKey];
    const providerCapabilities = (definition?.capabilities || asJsonArray(row.capabilities)) as IntegrationCapability[];
    const modules = (definition?.supportedModules || asJsonArray(row.supported_modules)) as IntegrationModule[];
    for (const moduleKey of modules) {
      if (moduleKey === "emails") continue;
      const capabilities = providerCapabilities.filter((capability) => MODULE_CAPABILITIES[moduleKey]?.includes(capability));
      if (!capabilities.length) continue;
      await query(`
        INSERT INTO integration_module_access (workspace_id, connection_id, module_key, capabilities, enabled)
        VALUES ($1, $2, $3, $4::jsonb, TRUE)
        ON CONFLICT (connection_id, module_key) DO UPDATE SET
          capabilities = EXCLUDED.capabilities,
          enabled = TRUE,
          updated_at = NOW()
      `, [workspaceId, asString(row.id), moduleKey, JSON.stringify(capabilities)]);
    }
  }
};

export async function saveCustomWebhookConnection(workspaceId: string, actorId: string, input: Record<string, unknown>) {
  if (!process.env.INTEGRATION_ENCRYPTION_KEY) throw new IntegrationDataError("Custom webhook is temporarily unavailable.", 503, "webhook_unavailable");
  const providerKey = String(input.providerKey || "custom_webhook");
  if (isComingSoonProvider(providerKey)) {
    throw new IntegrationDataError("This provider is coming soon and cannot be connected yet.", 409, "provider_coming_soon");
  }
  if (!(providerKey === "custom_webhook" || providerKey === "make")) throw new IntegrationDataError("That webhook provider is not available.", 422, "provider_not_supported");
  const name = String(input.name || "").trim().slice(0, 120);
  if (name.length < 2) throw new IntegrationDataError("Give this webhook a name.", 422, "webhook_name_invalid");
  const connectionId = String(input.connectionId || randomUUID());
  const existing = await query(`SELECT id, credentials_encrypted FROM integration_connections WHERE id = $1 AND workspace_id = $2 AND provider_key = $3 LIMIT 1`, [connectionId, workspaceId, providerKey]);
  if (input.connectionId && !existing.length) throw new IntegrationDataError("That webhook connection is not available in this workspace.", 404, "connection_not_found");
  let previous: WebhookConfig | null = null;
  if (existing[0]?.credentials_encrypted) {
    try { previous = decryptWebhookConfig(existing[0].credentials_encrypted); } catch { previous = null; }
  }
  const requestedAuthType = String(input.authType || previous?.authType || "none") as WebhookAuthType;
  const inputHeaders = input.headers && typeof input.headers === "object" && !Array.isArray(input.headers) ? input.headers as Record<string, unknown> : {};
  const inputQuery = input.query && typeof input.query === "object" && !Array.isArray(input.query) ? input.query as Record<string, unknown> : {};
  const config = await webhookConfigFromInput({
    ...input,
    endpointUrl: input.endpointUrl || previous?.endpointUrl,
    method: input.method || previous?.method || "POST",
    authType: requestedAuthType,
    headers: Object.keys(inputHeaders).length ? inputHeaders : previous?.headers || {},
    query: Object.keys(inputQuery).length ? inputQuery : previous?.query || {},
    bodyTemplate: input.bodyTemplate || previous?.bodyTemplate || "",
    authHeader: input.authHeader || previous?.authHeader || "X-API-Key",
    authSecret: input.authSecret || (previous?.authType === requestedAuthType ? previous.authSecret : ""),
    username: input.username || (previous?.authType === requestedAuthType ? previous.username : ""),
    password: input.password || (previous?.authType === requestedAuthType ? previous.password : ""),
  });

  // Keep the old automation FK projection on the same UUID so existing form
  // workflows continue to use the central webhook without a second setup.
  const legacyConfig = {
    endpointUrl: config.endpointUrl,
    method: config.method,
    headers: config.headers,
    query: config.query,
    bodyTemplate: config.bodyTemplate,
    authType: config.authType,
    authHeader: config.authHeader || "",
    // Secrets live only in the encrypted central connection. The legacy row
    // remains a non-secret compatibility projection for form selectors.
    authToken: "",
  };
  await query(`
    INSERT INTO automation_connections (id, user_id, provider, name, status, configuration, auth_type, created_at, updated_at)
    VALUES ($1, $2, 'webhook', $3, 'untested', $4::jsonb, 'webhook', NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = 'untested', configuration = EXCLUDED.configuration, auth_type = 'webhook', last_error = NULL, updated_at = NOW()
  `, [connectionId, workspaceId, name, JSON.stringify(legacyConfig)]);
  await query(`
    INSERT INTO integration_connections (
      id, workspace_id, scope_type, owner_user_id, provider_key, connection_name,
      external_account_name, status, auth_type, credentials_encrypted, metadata,
      legacy_source, legacy_connection_id, created_by, updated_by, last_error, updated_at
    ) VALUES ($1, $2, 'workspace', $2, $3, $4, $4, 'not_connected', 'webhook', $5, $6::jsonb, 'automation', $1, $7, $7, '', NOW())
    ON CONFLICT (id) DO UPDATE SET connection_name = EXCLUDED.connection_name,
      external_account_name = EXCLUDED.external_account_name,
      provider_key = EXCLUDED.provider_key,
      status = 'not_connected', auth_type = 'webhook',
      credentials_encrypted = EXCLUDED.credentials_encrypted,
      metadata = EXCLUDED.metadata, last_error = '',
      reconnect_required = FALSE, updated_by = EXCLUDED.updated_by, updated_at = NOW()
  `, [connectionId, workspaceId, providerKey, name, encryptWebhookConfig(config), JSON.stringify(webhookMetadata(config)), actorId]);
  await audit(workspaceId, actorId, existing.length ? "connection_updated" : "connection_created", providerKey, connectionId, { method: config.method, authType: config.authType });
  return { connectionId };
}

/**
 * Resolve a saved webhook only at execution time. The form editor receives a
 * non-secret compatibility projection, while this server-only helper is the
 * single place that can decrypt the destination credentials.
 */
export async function getCustomWebhookConfig(workspaceId: string, connectionId: string) {
  const rows = await query(`
    SELECT provider_key, credentials_encrypted
    FROM integration_connections
    WHERE id = $1 AND workspace_id = $2
      AND provider_key IN ('custom_webhook', 'make')
      AND status IN ('not_connected', 'connected', 'partially_connected', 'error')
    LIMIT 1
  `, [connectionId, workspaceId]);
  if (!rows[0]) return null;
  return decryptWebhookConfig(rows[0].credentials_encrypted);
}

const audit = async (workspaceId: string, actorId: string, eventType: string, providerKey: string, connectionId: string | null, details: Record<string, unknown> = {}) => {
  await query(
    `INSERT INTO integration_audit_events (workspace_id, actor_user_id, connection_id, provider_key, event_type, details)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [workspaceId, actorId, connectionId, providerKey, eventType, JSON.stringify(details)],
  );
};

const findConnection = async (workspaceId: string, connectionId: string) => {
  const rows = await query(
    `SELECT c.*, p.name AS provider_name, p.capabilities AS provider_capabilities,
       p.supported_modules AS provider_modules
     FROM integration_connections c
     JOIN integration_providers p ON p.key = c.provider_key
     WHERE c.workspace_id = $1 AND c.id = $2
     LIMIT 1`,
    [workspaceId, connectionId],
  );
  if (!rows.length) throw new IntegrationDataError("That connection is not available in this workspace.", 404, "connection_not_found");
  return rows[0];
};

const capabilitiesFor = (row: DatabaseRow) => {
  const definition = INTEGRATION_PROVIDER_DEFINITIONS[asString(row.provider_key)];
  return (definition?.capabilities || asJsonArray(row.provider_capabilities)) as IntegrationCapability[];
};

const moduleFor = (value: unknown): IntegrationModule => {
  const moduleKey = asString(value) as IntegrationModule;
  if (!INTEGRATION_MODULES.includes(moduleKey)) throw new IntegrationDataError("Choose a valid MaxForm module.", 422, "invalid_module");
  return moduleKey;
};

const capabilityFor = (value: unknown): IntegrationCapability => {
  const capability = asString(value) as IntegrationCapability;
  if (!INTEGRATION_CAPABILITIES.includes(capability)) throw new IntegrationDataError("That integration capability is not supported.", 422, "invalid_capability");
  return capability;
};

const safeCredentialHint = (row: DatabaseRow) => {
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata as DatabaseRow : {};
  const hint = asString(metadata.credentialHint);
  if (!hint) return "";
  return hint.length > 4 ? `••••${hint.slice(-4)}` : "••••";
};

const safeConnection = (row: DatabaseRow, dependencyCount: number, accessCount: number) => {
  const definition = INTEGRATION_PROVIDER_DEFINITIONS[asString(row.provider_key)];
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata as DatabaseRow : {};
  const configured = configuredForProvider(asString(row.provider_key));
  const rawStatus = connectionStatus(row);
  const status = configured || rawStatus === "not_connected" ? rawStatus : "configuration_required";
  return {
    id: asString(row.id),
    providerKey: asString(row.provider_key),
    providerName: asString(row.provider_name) || definition?.name || asString(row.provider_key),
    scopeType: asString(row.scope_type) || "workspace",
    connectionName: asString(row.connection_name),
    accountLabel: asString(row.external_account_name) || asString(row.connection_name) || "Connected account",
    accountId: asString(row.external_account_id),
    status,
    authType: asString(row.auth_type),
    grantedScopes: asJsonArray(row.granted_scopes),
    grantedCapabilities: asJsonArray(row.granted_capabilities),
    enabled: asBoolean(row.enabled),
    hasCredentials: Boolean(row.credentials_encrypted),
    credentialHint: safeCredentialHint(row),
    enabledModuleCount: accessCount,
    dependencyCount,
    lastConnectedAt: row.last_connected_at ? String(row.last_connected_at) : null,
    lastSuccessAt: row.last_success_at ? String(row.last_success_at) : null,
    lastHealthCheckAt: row.last_health_check_at ? String(row.last_health_check_at) : null,
    lastError: row.last_error ? safeIntegrationError(row.last_error) : "",
    reconnectRequired: asBoolean(row.reconnect_required) || status === "reconnect_required",
    legacySource: asString(row.legacy_source),
    metadata: {
      endpointUrl: asString(metadata.endpointUrl),
      method: asString(metadata.method),
      authType: asString(metadata.authType),
      authHeader: asString(metadata.authHeader),
      headerNames: asJsonArray(metadata.headerNames),
      queryParameterNames: asJsonArray(metadata.queryParameterNames),
      hasBodyTemplate: asBoolean(metadata.hasBodyTemplate),
      hasSecret: asBoolean(metadata.hasSecret),
    },
  };
};

export async function listIntegrationsWorkspace(workspaceId: string) {
  await syncLegacyConnections(workspaceId);
  await syncAutomaticModuleAccess(workspaceId);
  const [providerRows, connectionRows, accessRows, defaultRows, logRows, auditRows, dependencyRows] = await Promise.all([
    query(`SELECT * FROM integration_providers WHERE enabled = TRUE ORDER BY sort_order, name`),
    query(`SELECT c.*, p.name AS provider_name, p.category AS provider_category, p.capabilities AS provider_capabilities, p.supported_modules AS provider_modules FROM integration_connections c JOIN integration_providers p ON p.key = c.provider_key WHERE c.workspace_id = $1 ORDER BY c.updated_at DESC`, [workspaceId]),
    query(`SELECT a.*, c.provider_key, c.connection_name, p.name AS provider_name FROM integration_module_access a JOIN integration_connections c ON c.id = a.connection_id JOIN integration_providers p ON p.key = c.provider_key WHERE a.workspace_id = $1 ORDER BY a.module_key, a.created_at`, [workspaceId]),
    query(`SELECT d.*, c.provider_key, c.connection_name, p.name AS provider_name FROM integration_defaults d JOIN integration_connections c ON c.id = d.connection_id JOIN integration_providers p ON p.key = c.provider_key WHERE d.workspace_id = $1 ORDER BY d.module_key, d.purpose_key`, [workspaceId]),
    query(`SELECT * FROM integration_execution_logs WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 60`, [workspaceId]),
    query(`SELECT * FROM integration_audit_events WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 60`, [workspaceId]),
    query(`SELECT c.id, COUNT(DISTINCT w.id)::int AS dependency_count, COUNT(DISTINCT a.id)::int AS access_count FROM integration_connections c LEFT JOIN workflow_actions w ON w.connection_id = c.id LEFT JOIN integration_module_access a ON a.connection_id = c.id WHERE c.workspace_id = $1 GROUP BY c.id`, [workspaceId]),
  ]);

  const dependencyMap = new Map(dependencyRows.map((row) => [asString(row.id), { dependencies: Number(row.dependency_count) || 0, access: Number(row.access_count) || 0 }]));
  const visibleConnectionRows = connectionRows.filter((row) => !isExcludedProvider(asString(row.provider_key)) && !isComingSoonProvider(asString(row.provider_key)) && asString(row.provider_category) !== "email");
  const connections = visibleConnectionRows.map((row) => {
    const counts = dependencyMap.get(asString(row.id)) || { dependencies: 0, access: 0 };
    return safeConnection(row, counts.dependencies, counts.access);
  });
  const connectedByProvider = new Map<string, number>();
  const attentionByProvider = new Map<string, number>();
  for (const connection of connections) {
    if (connection.status === "connected") connectedByProvider.set(connection.providerKey, (connectedByProvider.get(connection.providerKey) || 0) + 1);
    if (["error", "reconnect_required", "expired", "configuration_required"].includes(connection.status)) attentionByProvider.set(connection.providerKey, (attentionByProvider.get(connection.providerKey) || 0) + 1);
  }
  const providers = providerRows.filter((row) => !isExcludedProvider(asString(row.key)) && asString(row.category) !== "email").map((row) => {
    const key = asString(row.key);
    const definition = INTEGRATION_PROVIDER_DEFINITIONS[key];
    const configured = configuredForProvider(key);
    const providerConnections = connections.filter((connection) => connection.providerKey === key);
    const connectedCount = connectedByProvider.get(key) || 0;
    const status = isComingSoonProvider(key)
      ? "coming_soon"
      : !configured
        ? "configuration_required"
        : connectedCount > 0
          ? (attentionByProvider.get(key) ? "partially_connected" : "connected")
          : "not_connected";
    return {
      key,
      name: asString(row.name) || definition?.name || key,
      description: asString(row.description) || definition?.description || "",
      category: asString(row.category),
      authType: asString(row.auth_type) || definition?.authType || "oauth",
      capabilities: (definition?.capabilities || asJsonArray(row.capabilities)) as string[],
      supportedModules: (definition?.supportedModules || asJsonArray(row.supported_modules)) as string[],
      setupUrl: asString(row.setup_url) || definition?.setupUrl || "",
      platformConfigured: configured,
      status,
      availability: isComingSoonProvider(key) ? "coming_soon" : "active",
      connectionCount: providerConnections.length,
      connectedCount,
      attentionCount: attentionByProvider.get(key) || 0,
      configurationMessage: configured ? "" : "This integration is not available in this workspace yet.",
    };
  });

  const roleRows = await query(`SELECT COALESCE((SELECT role FROM user_roles WHERE user_id = $1 ORDER BY CASE role WHEN 'admin' THEN 1 WHEN 'moderator' THEN 2 ELSE 3 END LIMIT 1), 'user') AS role`, [workspaceId]);
  const role = asString(roleRows[0]?.role) || "user";
  const visibleAccessRows = accessRows.filter((row) => asString(row.provider_key) && !isExcludedProvider(asString(row.provider_key)) && asString(row.module_key) !== "emails");
  return {
    summary: {
      connectedCount: connections.filter((connection) => connection.status === "connected").length,
      providerCount: providers.length,
      attentionCount: connections.filter((connection) => ["error", "reconnect_required", "expired", "configuration_required"].includes(connection.status)).length,
      accessCount: visibleAccessRows.filter((row) => asBoolean(row.enabled)).length,
      role,
      canManage: true,
    },
    providers,
    connections,
    moduleAccess: visibleAccessRows.filter((row) => !isExcludedProvider(asString(row.provider_key))).map((row) => ({
      id: asString(row.id), connectionId: asString(row.connection_id), providerKey: asString(row.provider_key), providerName: asString(row.provider_name), connectionName: asString(row.connection_name), moduleKey: asString(row.module_key), capabilities: asJsonArray(row.capabilities), enabled: asBoolean(row.enabled),
    })),
    defaults: defaultRows.filter((row) => asString(row.purpose_key) !== "email" && !isExcludedProvider(asString(row.provider_key))).map((row) => ({ id: asString(row.id), moduleKey: asString(row.module_key), purposeKey: asString(row.purpose_key), connectionId: asString(row.connection_id), providerKey: asString(row.provider_key), providerName: asString(row.provider_name), connectionName: asString(row.connection_name) })),
    logs: logRows.filter((row) => asString(row.module_key) !== "emails").map((row) => ({ id: asString(row.id), connectionId: asString(row.connection_id), moduleKey: asString(row.module_key), capability: asString(row.capability), actionKey: asString(row.action_key), status: asString(row.status), errorCode: asString(row.error_code), errorMessage: row.error_message ? safeIntegrationError(row.error_message) : "", durationMs: Number(row.duration_ms) || null, createdAt: String(row.created_at || "") })),
    audit: auditRows.filter((row) => !isExcludedProvider(asString(row.provider_key))).map((row) => ({ id: asString(row.id), connectionId: asString(row.connection_id), providerKey: asString(row.provider_key), eventType: asString(row.event_type), details: row.details && typeof row.details === "object" ? row.details : {}, createdAt: String(row.created_at || "") })),
    modules: INTEGRATION_MODULES.filter((moduleKey) => moduleKey !== "emails"),
    purposes: INTEGRATION_PURPOSES.filter((purposeKey) => purposeKey !== "email"),
  };
}

const assertConnected = (row: DatabaseRow) => {
  const status = connectionStatus(row);
  if (status !== "connected" && status !== "partially_connected") throw new IntegrationDataError("Connect and test this account before assigning module access.", 409, "connection_not_ready");
};

export async function setIntegrationModuleAccess(workspaceId: string, actorId: string, input: { connectionId: string; moduleKey: unknown; enabled: boolean; capabilities?: unknown[] }) {
  const row = await findConnection(workspaceId, input.connectionId);
  const moduleKey = moduleFor(input.moduleKey);
  const definition = INTEGRATION_PROVIDER_DEFINITIONS[asString(row.provider_key)];
  if (!definition?.supportedModules.includes(moduleKey)) throw new IntegrationDataError(`${definition?.name || "This connection"} does not support the selected MaxForm module.`, 422, "module_not_supported");
  if (input.enabled) assertConnected(row);
  const allowed = new Set(MODULE_CAPABILITIES[moduleKey].filter((capability) => capabilitiesFor(row).includes(capability)));
  const requested = Array.isArray(input.capabilities) ? input.capabilities.map(capabilityFor) : [...allowed];
  const capabilities = requested.filter((capability) => allowed.has(capability));
  if (input.enabled && !capabilities.length) throw new IntegrationDataError("Choose at least one capability for this module.", 422, "capability_required");
  await query(
    `INSERT INTO integration_module_access (workspace_id, connection_id, module_key, capabilities, enabled, created_by, updated_by)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $6)
     ON CONFLICT (connection_id, module_key) DO UPDATE SET capabilities = EXCLUDED.capabilities, enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [workspaceId, input.connectionId, moduleKey, JSON.stringify(capabilities), input.enabled, actorId],
  );
  await audit(workspaceId, actorId, input.enabled ? "module_access_granted" : "module_access_revoked", asString(row.provider_key), input.connectionId, { moduleKey, capabilities });
  return { updated: true };
}

const PURPOSE_CAPABILITY: Record<IntegrationPurpose, IntegrationCapability> = {
  calendar: "calendar.write",
  meeting: "meeting.create",
  spreadsheet: "spreadsheet.write",
  storage: "file.write",
  email: "email.send",
  messaging: "message.send",
  contacts: "contacts.read",
  webhook: "webhook.send",
};

export async function setIntegrationDefault(workspaceId: string, actorId: string, input: { moduleKey: unknown; purposeKey: unknown; connectionId: string }) {
  const moduleKey = moduleFor(input.moduleKey);
  const purposeKey = asString(input.purposeKey) as IntegrationPurpose;
  if (!INTEGRATION_PURPOSES.includes(purposeKey)) throw new IntegrationDataError("Choose a valid integration default.", 422, "invalid_purpose");
  if (!input.connectionId) {
    await query(`DELETE FROM integration_defaults WHERE workspace_id = $1 AND module_key = $2 AND purpose_key = $3`, [workspaceId, moduleKey, purposeKey]);
    await audit(workspaceId, actorId, "default_cleared", "", null, { moduleKey, purposeKey });
    return { updated: true, cleared: true };
  }
  const row = await findConnection(workspaceId, input.connectionId);
  assertConnected(row);
  const requiredCapability = PURPOSE_CAPABILITY[purposeKey];
  const accessRows = await query(`SELECT capabilities, enabled FROM integration_module_access WHERE workspace_id = $1 AND connection_id = $2 AND module_key = $3 LIMIT 1`, [workspaceId, input.connectionId, moduleKey]);
  const access = accessRows[0];
  const accessCapabilities = asJsonArray(access?.capabilities);
  if (!access || !asBoolean(access.enabled) || !accessCapabilities.includes(requiredCapability)) throw new IntegrationDataError("Grant this connection access to the module and capability before setting it as a default.", 409, "default_requires_access");
  await query(
    `INSERT INTO integration_defaults (workspace_id, module_key, purpose_key, connection_id, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $5)
     ON CONFLICT (workspace_id, module_key, purpose_key) DO UPDATE SET connection_id = EXCLUDED.connection_id, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [workspaceId, moduleKey, purposeKey, input.connectionId, actorId],
  );
  await audit(workspaceId, actorId, "default_changed", asString(row.provider_key), input.connectionId, { moduleKey, purposeKey });
  return { updated: true };
}

export async function testIntegrationConnection(workspaceId: string, actorId: string, connectionId: string) {
  const row = await findConnection(workspaceId, connectionId);
  if (isComingSoonProvider(asString(row.provider_key))) {
    throw new IntegrationDataError("This provider is coming soon and cannot be tested yet.", 409, "provider_coming_soon");
  }
  const started = Date.now();
  let message = "";
  let responseMetadata: { statusCode?: number; durationMs?: number; responseBody?: string } = {};
  try {
    if (["custom_webhook", "zapier", "make"].includes(asString(row.provider_key))) {
      const result = await runWebhookRequest(decryptWebhookConfig(row.credentials_encrypted), { event: "maxform.connection_test", sentAt: new Date().toISOString() });
      responseMetadata = { statusCode: result.statusCode, durationMs: result.durationMs, responseBody: result.responseBody.slice(0, 240) };
      if (!result.ok) throw new Error(result.statusCode ? `The webhook returned HTTP ${result.statusCode}.` : result.responseBody);
      await query(`UPDATE automation_connections SET status = 'connected', last_tested_at = NOW(), last_error = NULL, updated_at = NOW() WHERE id = $1 AND user_id = $2`, [connectionId, workspaceId]);
    } else if (asString(row.legacy_source) === "automation") await testAutomationConnectionForCentral(workspaceId, connectionId);
    else if (asString(row.legacy_source) === "scheduling") await testSchedulingConnectionForCentral(workspaceId, connectionId);
    else if (!row.credentials_encrypted && asString(row.auth_type) !== "webhook") throw new Error("This connection needs to be connected again.");
    await query(`UPDATE integration_connections SET status = 'connected', reconnect_required = FALSE, last_success_at = NOW(), last_health_check_at = NOW(), last_error = '', updated_at = NOW(), updated_by = $2 WHERE id = $1 AND workspace_id = $3`, [connectionId, actorId, workspaceId]);
    await query(`INSERT INTO integration_execution_logs (workspace_id, connection_id, module_key, capability, action_key, status, duration_ms, completed_at) VALUES ($1, $2, 'automations', 'webhook.send', 'connection.test', 'succeeded', $3, NOW())`, [workspaceId, connectionId, Date.now() - started]);
    await audit(workspaceId, actorId, "connection_test_succeeded", asString(row.provider_key), connectionId);
    return { ok: true, message, ...responseMetadata };
  } catch (error) {
    message = safeIntegrationError(error instanceof Error ? error.message : "The provider rejected this connection.");
    await query(`UPDATE integration_connections SET status = 'error', last_health_check_at = NOW(), last_error = $1, updated_at = NOW(), updated_by = $2 WHERE id = $3 AND workspace_id = $4`, [message, actorId, connectionId, workspaceId]);
    await query(`INSERT INTO integration_execution_logs (workspace_id, connection_id, module_key, capability, action_key, status, error_code, error_message, duration_ms, completed_at) VALUES ($1, $2, 'automations', 'webhook.send', 'connection.test', 'failed', 'provider_rejected', $3, $4, NOW())`, [workspaceId, connectionId, message, Date.now() - started]);
    await audit(workspaceId, actorId, "connection_test_failed", asString(row.provider_key), connectionId, { error: message });
    return { ok: false, error: message };
  }
}

export async function disconnectIntegrationConnection(workspaceId: string, actorId: string, connectionId: string, confirmed: boolean) {
  const row = await findConnection(workspaceId, connectionId);
  if (isComingSoonProvider(asString(row.provider_key))) {
    throw new IntegrationDataError("This provider is coming soon and cannot be changed yet.", 409, "provider_coming_soon");
  }
  const dependencyRows = await query(`SELECT COUNT(*)::int AS workflow_count FROM workflow_actions WHERE connection_id = $1`, [connectionId]);
  const accessRows = await query(`SELECT COUNT(*)::int AS access_count FROM integration_module_access WHERE connection_id = $1 AND enabled = TRUE`, [connectionId]);
  const dependencies = { workflows: Number(dependencyRows[0]?.workflow_count) || 0, modules: Number(accessRows[0]?.access_count) || 0 };
  const dependencyTotal = dependencies.workflows + dependencies.modules;
  if (dependencyTotal && !confirmed) throw new IntegrationDataError("This connection is still used by workspace modules.", 409, "connection_has_dependencies", { dependencies });
  await audit(workspaceId, actorId, "connection_disconnected", asString(row.provider_key), connectionId, { dependencies });
  const source = asString(row.legacy_source);
  if (source === "automation") {
    await query(`DELETE FROM automation_connections WHERE id = $1 AND user_id = $2`, [connectionId, workspaceId]);
    const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata as DatabaseRow : {};
    if (asString(row.provider_key) === "google_workspace" && asString(metadata.legacyProvider) === "google_sheets") {
      await query(`DELETE FROM scheduling_tool_connections WHERE id = $1 AND user_id = $2`, [connectionId, workspaceId]);
    }
  }
  if (source === "scheduling") await query(`DELETE FROM scheduling_tool_connections WHERE id = $1 AND user_id = $2`, [connectionId, workspaceId]);
  if (source === "email") await query(`DELETE FROM email_provider_connections WHERE id = $1 AND user_id = $2`, [connectionId, workspaceId]);
  await query(`DELETE FROM integration_defaults WHERE connection_id = $1 AND workspace_id = $2`, [connectionId, workspaceId]);
  await query(`DELETE FROM integration_connections WHERE id = $1 AND workspace_id = $2`, [connectionId, workspaceId]);
  return { disconnected: true, dependencies };
}

export async function authorizeIntegrationAction(input: { workspaceId: string; connectionId: string; moduleKey: IntegrationModule; capability: IntegrationCapability; actionKey: string; requestMetadata?: Record<string, unknown> }) {
  const row = await findConnection(input.workspaceId, input.connectionId);
  const providerKey = asString(row.provider_key);
  if (isComingSoonProvider(providerKey)) {
    throw new IntegrationDataError("This provider is coming soon and cannot be used yet.", 409, "provider_coming_soon");
  }
  const definition = INTEGRATION_PROVIDER_DEFINITIONS[providerKey];
  const providerSupportsModule = Boolean(definition?.supportedModules.includes(input.moduleKey));
  const providerSupportsCapability = capabilitiesFor(row).includes(input.capability);
  // Connected providers are automatically available to compatible modules. A
  // legacy access row may still exist, but it is no longer a user-facing gate.
  const allowed = connectionStatus(row) === "connected" && providerSupportsModule && providerSupportsCapability;
  const status = allowed ? "succeeded" : "blocked";
  await query(`INSERT INTO integration_execution_logs (workspace_id, connection_id, module_key, capability, action_key, status, error_code, error_message, request_metadata, completed_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW())`, [input.workspaceId, input.connectionId, input.moduleKey, input.capability, input.actionKey, status, allowed ? "" : "integration_access_denied", allowed ? "" : "This module is not allowed to use that connection capability.", JSON.stringify(input.requestMetadata || {})]);
  if (!allowed) throw new IntegrationDataError("This module is not allowed to use that connection capability.", 403, "integration_access_denied");
  return { authorized: true, providerKey: asString(row.provider_key) };
}

export async function handleIntegrationsData(request: IncomingMessage, response: ServerResponse) {
  try {
    const userId = await authenticatedUserId(request);
    const url = new URL(request.url || "/", "http://localhost");
    const action = url.searchParams.get("action") || "workspace";
    if (request.method === "GET" && (action === "workspace" || action === "summary")) {
      json(response, 200, await listIntegrationsWorkspace(userId));
      return;
    }
    if (request.method !== "POST") {
      json(response, 405, { error: "That integration request is not supported." });
      return;
    }
    const body = await readBody(request);
    if (action === "module-access") {
      json(response, 200, await setIntegrationModuleAccess(userId, userId, { connectionId: String(body.connectionId || ""), moduleKey: body.moduleKey, enabled: body.enabled !== false, capabilities: Array.isArray(body.capabilities) ? body.capabilities : undefined }));
      return;
    }
    if (action === "default") {
      json(response, 200, await setIntegrationDefault(userId, userId, { moduleKey: body.moduleKey, purposeKey: body.purposeKey, connectionId: String(body.connectionId || "") }));
      return;
    }
    if (action === "test") {
      json(response, 200, await testIntegrationConnection(userId, userId, String(body.connectionId || "")));
      return;
    }
    if (action === "webhook-save") {
      json(response, 200, await saveCustomWebhookConnection(userId, userId, body));
      return;
    }
    if (action === "disconnect") {
      json(response, 200, await disconnectIntegrationConnection(userId, userId, String(body.connectionId || ""), body.confirmed === true));
      return;
    }
    json(response, 404, { error: "That integration action is not available." });
  } catch (error) {
    if (error instanceof IntegrationDataError) {
      json(response, error.status, { error: safeIntegrationError(error.message), code: error.code, ...error.details });
      return;
    }
    json(response, 500, { error: "The integrations workspace could not complete that request." });
  }
}

/**
 * OAuth for the appointments integrations.
 *
 * The appointments module previously "connected" a provider by inserting a row
 * that said so. This runs the real handshake: authorization code in, encrypted
 * refreshable token out, stored against the workspace.
 *
 * Two auth styles live here because the providers differ. Google, Microsoft,
 * Zoom and Calendly issue OAuth apps any workspace can register, so those use a
 * popup handshake. Cal.com has no self-serve OAuth for individual accounts, so
 * it takes an API key, which is validated against the provider before it is
 * stored — a key that does not work never reaches the database.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { neon } from "@neondatabase/serverless";
import { jwtVerify } from "jose";
import { configuredAppUrl } from "./app-url";
import { workspaceScopeFor } from "./workspace-access";

export type SchedulingProvider =
  | "google_calendar"
  | "outlook"
  | "zoom"
  | "google_meet"
  | "teams"
  | "calendly"
  | "cal_com";

type ProviderCategory = "calendar" | "video" | "scheduling";

type Identity = { accountId: string; accountLabel: string };

type ProviderDefinition = {
  label: string;
  category: ProviderCategory;
  /** OAuth providers run the popup handshake; api_key providers take a token. */
  authType: "oauth" | "api_key";
  clientIdEnv?: string;
  clientSecretEnv?: string;
  /** Lets an operator track provider scope renames without a code change. */
  scopesEnv?: string;
  scopes: string[];
  authorizeUrl?: string;
  tokenUrl?: string;
  revokeUrl?: string;
  /** Extra authorize-URL parameters this provider needs. */
  authorizeParams?: Record<string, string>;
  /** Basic-auth the token request instead of putting the secret in the body. */
  basicAuth?: boolean;
  /** Where to look the connected account up, so the card can name it. */
  identify: (accessToken: string) => Promise<Identity>;
  /** A cheap authenticated call used by the Test button. */
  healthCheck: (accessToken: string) => Promise<void>;
  /** Where a workspace registers the app, shown when it is not configured. */
  setupUrl: string;
};

type TokenCredentials = {
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  expiresAt?: string;
};

const MICROSOFT_TENANT = () => process.env.MICROSOFT_TENANT_ID || "common";
const microsoftBase = () =>
  `https://login.microsoftonline.com/${encodeURIComponent(MICROSOFT_TENANT())}/oauth2/v2.0`;

/* ------------------------------------------------------------ http helpers */

const providerTimeout = () =>
  Math.min(30_000, Math.max(2_000, Number(process.env.PROVIDER_TIMEOUT_MS) || 12_000));

const fetchJson = async (
  url: string,
  init: RequestInit = {},
): Promise<Record<string, unknown>> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), providerTimeout());
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const raw = await response.text();
    let value: Record<string, unknown> = {};
    try {
      value = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      value = { message: raw };
    }
    if (!response.ok) {
      // Providers disagree on the error field; take whichever is present so the
      // stored last_error says something a person can act on.
      const detail =
        value.error_description || value.error || value.message || `HTTP ${response.status}`;
      throw new Error(String(detail).slice(0, 300));
    }
    return value;
  } finally {
    clearTimeout(timer);
  }
};

const bearer = (accessToken: string) => ({ Authorization: `Bearer ${accessToken}` });

/* ------------------------------------------------------- provider registry */

const providers: Record<SchedulingProvider, ProviderDefinition> = {
  google_calendar: {
    label: "Google Calendar",
    category: "calendar",
    authType: "oauth",
    clientIdEnv: "GOOGLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CLIENT_SECRET",
    scopesEnv: "GOOGLE_CALENDAR_SCOPES",
    scopes: [
      "openid",
      "email",
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/documents",
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/drive.metadata.readonly",
      "https://www.googleapis.com/auth/drive.readonly",
    ],
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    revokeUrl: "https://oauth2.googleapis.com/revoke",
    // Without access_type=offline Google returns no refresh token and the
    // connection silently dies an hour later.
    authorizeParams: {
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
    },
    identify: async (accessToken) => {
      const profile = await fetchJson("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: bearer(accessToken),
      });
      return {
        accountId: String(profile.sub || ""),
        accountLabel: String(profile.email || "Google account"),
      };
    },
    healthCheck: async (accessToken) => {
      await fetchJson(
        "https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1",
        { headers: bearer(accessToken) },
      );
    },
    setupUrl: "https://console.cloud.google.com/apis/credentials",
  },

  google_meet: {
    label: "Google Meet",
    category: "video",
    authType: "oauth",
    clientIdEnv: "GOOGLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CLIENT_SECRET",
    scopesEnv: "GOOGLE_MEET_SCOPES",
    // Meet rooms are minted through the Calendar API's conferenceData, so this
    // is a calendar.events grant even though the product is Meet.
    scopes: [
      "openid",
      "email",
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/documents",
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/drive.metadata.readonly",
    ],
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    revokeUrl: "https://oauth2.googleapis.com/revoke",
    authorizeParams: {
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
    },
    identify: async (accessToken) => {
      const profile = await fetchJson("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: bearer(accessToken),
      });
      return {
        accountId: String(profile.sub || ""),
        accountLabel: String(profile.email || "Google account"),
      };
    },
    healthCheck: async (accessToken) => {
      await fetchJson("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: bearer(accessToken),
      });
    },
    setupUrl: "https://console.cloud.google.com/apis/credentials",
  },

  outlook: {
    label: "Outlook Calendar",
    category: "calendar",
    authType: "oauth",
    clientIdEnv: "MICROSOFT_CLIENT_ID",
    clientSecretEnv: "MICROSOFT_CLIENT_SECRET",
    scopesEnv: "MICROSOFT_OUTLOOK_SCOPES",
    // offline_access is what makes Microsoft return a refresh token.
    scopes: ["openid", "email", "profile", "offline_access", "Calendars.ReadWrite"],
    tokenUrl: "",
    identify: async (accessToken) => {
      const profile = await fetchJson("https://graph.microsoft.com/v1.0/me", {
        headers: bearer(accessToken),
      });
      return {
        accountId: String(profile.id || ""),
        accountLabel: String(profile.mail || profile.userPrincipalName || "Microsoft account"),
      };
    },
    healthCheck: async (accessToken) => {
      await fetchJson("https://graph.microsoft.com/v1.0/me/calendars?$top=1", {
        headers: bearer(accessToken),
      });
    },
    setupUrl: "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps",
  },

  teams: {
    label: "Microsoft Teams",
    category: "video",
    authType: "oauth",
    clientIdEnv: "MICROSOFT_CLIENT_ID",
    clientSecretEnv: "MICROSOFT_CLIENT_SECRET",
    scopesEnv: "MICROSOFT_TEAMS_SCOPES",
    scopes: ["openid", "email", "profile", "offline_access", "OnlineMeetings.ReadWrite", "Calendars.ReadWrite"],
    tokenUrl: "",
    identify: async (accessToken) => {
      const profile = await fetchJson("https://graph.microsoft.com/v1.0/me", {
        headers: bearer(accessToken),
      });
      return {
        accountId: String(profile.id || ""),
        accountLabel: String(profile.mail || profile.userPrincipalName || "Microsoft account"),
      };
    },
    healthCheck: async (accessToken) => {
      await fetchJson("https://graph.microsoft.com/v1.0/me", { headers: bearer(accessToken) });
    },
    setupUrl: "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps",
  },

  zoom: {
    label: "Zoom",
    category: "video",
    authType: "oauth",
    clientIdEnv: "ZOOM_CLIENT_ID",
    clientSecretEnv: "ZOOM_CLIENT_SECRET",
    scopesEnv: "ZOOM_SCOPES",
    // Zoom renamed these to granular scopes; older apps still use
    // "meeting:write user:read". Override with ZOOM_SCOPES if the app is older.
    scopes: ["meeting:write:meeting", "user:read:user"],
    authorizeUrl: "https://zoom.us/oauth/authorize",
    tokenUrl: "https://zoom.us/oauth/token",
    revokeUrl: "https://zoom.us/oauth/revoke",
    basicAuth: true,
    identify: async (accessToken) => {
      const profile = await fetchJson("https://api.zoom.us/v2/users/me", {
        headers: bearer(accessToken),
      });
      return {
        accountId: String(profile.id || ""),
        accountLabel: String(profile.email || "Zoom account"),
      };
    },
    healthCheck: async (accessToken) => {
      await fetchJson("https://api.zoom.us/v2/users/me", { headers: bearer(accessToken) });
    },
    setupUrl: "https://marketplace.zoom.us/develop/create",
  },

  calendly: {
    label: "Calendly",
    category: "scheduling",
    authType: "oauth",
    clientIdEnv: "CALENDLY_CLIENT_ID",
    clientSecretEnv: "CALENDLY_CLIENT_SECRET",
    scopes: [],
    authorizeUrl: "https://auth.calendly.com/oauth/authorize",
    tokenUrl: "https://auth.calendly.com/oauth/token",
    revokeUrl: "https://auth.calendly.com/oauth/revoke",
    identify: async (accessToken) => {
      const me = await fetchJson("https://api.calendly.com/users/me", {
        headers: bearer(accessToken),
      });
      const resource = (me.resource || {}) as Record<string, unknown>;
      return {
        accountId: String(resource.uri || ""),
        accountLabel: String(resource.email || "Calendly account"),
      };
    },
    healthCheck: async (accessToken) => {
      await fetchJson("https://api.calendly.com/users/me", { headers: bearer(accessToken) });
    },
    setupUrl: "https://calendly.com/integrations/api_webhooks",
  },

  cal_com: {
    label: "Cal.com",
    category: "scheduling",
    // Cal.com's OAuth is for platform customers only, so an individual
    // workspace connects with an API key from its own settings page.
    authType: "api_key",
    scopes: [],
    identify: async (apiKey) => {
      const me = await fetchJson(
        `https://api.cal.com/v1/me?apiKey=${encodeURIComponent(apiKey)}`,
      );
      const user = (me.user || me) as Record<string, unknown>;
      return {
        accountId: String(user.id || ""),
        accountLabel: String(user.email || user.username || "Cal.com account"),
      };
    },
    healthCheck: async (apiKey) => {
      await fetchJson(`https://api.cal.com/v1/me?apiKey=${encodeURIComponent(apiKey)}`);
    },
    setupUrl: "https://app.cal.com/settings/developer/api-keys",
  },
};

const isProvider = (value: string): value is SchedulingProvider =>
  Object.prototype.hasOwnProperty.call(providers, value);

/** Scope list, with the env override applied when one is set. */
const scopesFor = (provider: SchedulingProvider) => {
  const definition = providers[provider];
  const override = definition.scopesEnv ? process.env[definition.scopesEnv] || "" : "";
  const parsed = override.split(/[\s,]+/).filter(Boolean);
  return parsed.length ? parsed : definition.scopes;
};

const tokenUrlFor = (provider: SchedulingProvider) => {
  if (provider === "outlook" || provider === "teams") return `${microsoftBase()}/token`;
  return providers[provider].tokenUrl || "";
};

const authorizeUrlFor = (provider: SchedulingProvider) => {
  if (provider === "outlook" || provider === "teams") return `${microsoftBase()}/authorize`;
  return providers[provider].authorizeUrl || "";
};

/* -------------------------------------------------------------- encryption */

const encryptionKey = () => {
  const secret = process.env.INTEGRATION_ENCRYPTION_KEY || "";
  if (secret.length < 24) throw new Error("INTEGRATION_ENCRYPTION_KEY is not configured");
  return createHash("sha256").update(secret).digest();
};

const encryptCredentials = (credentials: TokenCredentials) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(credentials), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
};

const decryptCredentials = (value: string): TokenCredentials => {
  const [ivValue, tagValue, encryptedValue] = value.split(".");
  if (!ivValue || !tagValue || !encryptedValue) {
    throw new Error("Stored credential is unreadable");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]);
  return JSON.parse(decrypted.toString("utf8")) as TokenCredentials;
};

/* ------------------------------------------------------------------- infra */

const sqlClient = () => {
  const url = process.env.DATABASE_URL || "";
  if (!url) throw new Error("DATABASE_URL is not configured");
  return neon(url);
};

const json = (response: ServerResponse, status: number, value: Record<string, unknown>) => {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.end(JSON.stringify(value));
};

class AuthenticationError extends Error {}
class RequestError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const authenticatedUserId = async (request: IncomingMessage) => {
  const authorization = String(request.headers.authorization || "");
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  if (!token) throw new AuthenticationError("Authentication required");
  try {
    const signingSecret = process.env.JWT_SECRET || "";
    if (signingSecret.length < 32) throw new AuthenticationError("Authentication required");
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(signingSecret),
      { audience: "maxform-dashboard", issuer: "maxform" },
    );
    const userId = String(payload.userId || "");
    if (!/^[0-9a-f-]{36}$/i.test(userId)) {
      throw new AuthenticationError("Authentication required");
    }
    // The workspace this request acts in. Identical to the signed-in id
    // for a workspace owner; an added member resolves to the workspace
    // they belong to, so every query below reads the same rows.
    return workspaceScopeFor(userId);
  } catch {
    throw new AuthenticationError("Authentication required");
  }
};

const readBody = async (request: IncomingMessage) => {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 100_000) throw new RequestError("That request is too large.");
  }
  if (!body) return {};
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    throw new RequestError("That request could not be read.");
  }
};

const requestOrigin = (request: IncomingMessage) => {
  const forwardedProto = String(request.headers["x-forwarded-proto"] || "").split(",")[0];
  const protocol =
    forwardedProto || (request.socket && "encrypted" in request.socket ? "https" : "http");
  const host = String(
    request.headers["x-forwarded-host"] || request.headers.host || "localhost",
  ).split(",")[0];
  return `${protocol}://${host}`;
};

/**
 * The redirect URI registered with each provider.
 *
 * It must match character for character on both the authorize and token calls,
 * which is why it is derived once here rather than rebuilt at each call site.
 */
export const schedulingCallbackUrl = (request: IncomingMessage | null) => {
  const configured = configuredAppUrl();
  const base = configured || (request ? requestOrigin(request) : "");
  return `${base}/api/appointments/integrations?action=callback`;
};

const connectionResultPage = (
  request: IncomingMessage,
  response: ServerResponse,
  status: "connected" | "cancelled" | "error",
  provider: string,
) => {
  const origin = requestOrigin(request);
  const payload = JSON.stringify({
    type: "maxform:connection-result",
    status,
    provider,
  }).replace(/</g, "\\u003c");
  response.statusCode = 200;
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
  );
  response.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>MaxForm connection</title>
    <style>
      body{margin:0;background:#fff;color:#18181b;font:14px system-ui,sans-serif}
      main{min-height:100vh;display:grid;place-items:center;padding:32px;box-sizing:border-box;text-align:center}
      p{color:#71717a;line-height:1.6}
    </style>
  </head>
  <body>
    <main><div><strong>Returning to MaxForm</strong><p>This window will close automatically.</p></div></main>
    <script>
      if (window.opener) window.opener.postMessage(${payload}, ${JSON.stringify(origin)});
      window.close();
    </script>
  </body>
</html>`);
};

/* ------------------------------------------------------- configured status */

const providerConfigured = (provider: SchedulingProvider) => {
  const definition = providers[provider];
  if (!process.env.INTEGRATION_ENCRYPTION_KEY || !process.env.DATABASE_URL) return false;
  // An API-key provider needs no client credentials — the user supplies the key.
  if (definition.authType === "api_key") return true;
  return Boolean(
    process.env[definition.clientIdEnv || ""] && process.env[definition.clientSecretEnv || ""],
  );
};

export const getSchedulingProviderStatus = () =>
  Object.fromEntries(
    (Object.keys(providers) as SchedulingProvider[]).map((key) => [
      key,
      {
        configured: providerConfigured(key),
        authType: providers[key].authType,
        label: providers[key].label,
        category: providers[key].category,
        setupUrl: providers[key].setupUrl,
        scopes: scopesFor(key),
      },
    ]),
  );

/* -------------------------------------------------------- token operations */

const credentialsFromToken = (token: Record<string, unknown>): TokenCredentials => {
  const expiresIn = Number(token.expires_in || 0);
  return {
    accessToken: String(token.access_token || ""),
    refreshToken: token.refresh_token ? String(token.refresh_token) : undefined,
    tokenType: token.token_type ? String(token.token_type) : "Bearer",
    expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : undefined,
  };
};

const tokenRequest = async (provider: SchedulingProvider, params: URLSearchParams) => {
  const definition = providers[provider];
  const clientId = process.env[definition.clientIdEnv || ""] || "";
  const clientSecret = process.env[definition.clientSecretEnv || ""] || "";
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (definition.basicAuth) {
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  } else {
    params.set("client_id", clientId);
    params.set("client_secret", clientSecret);
  }
  return fetchJson(tokenUrlFor(provider), { method: "POST", headers, body: params });
};

const exchangeCode = async (
  provider: SchedulingProvider,
  code: string,
  redirectUri: string,
  codeVerifier: string | null,
) => {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
  if (codeVerifier) params.set("code_verifier", codeVerifier);
  const token = await tokenRequest(provider, params);
  const credentials = credentialsFromToken(token);
  if (!credentials.accessToken) throw new Error("Provider did not return an access token");
  return credentials;
};

const refreshCredentials = async (
  provider: SchedulingProvider,
  current: TokenCredentials,
) => {
  if (!current.refreshToken) {
    throw new RequestError("This connection expired. Reconnect the account.", 409);
  }
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: current.refreshToken,
  });
  // Microsoft wants the scope repeated on refresh.
  if (provider === "outlook" || provider === "teams") {
    params.set("scope", scopesFor(provider).join(" "));
  }
  const token = await tokenRequest(provider, params);
  const next = credentialsFromToken(token);
  if (!next.accessToken) throw new Error("Provider did not refresh the access token");
  return {
    ...next,
    // Microsoft, Zoom and Calendly rotate refresh tokens; Google does not return
    // one at all on refresh. Keep the previous one whenever a new one is absent.
    refreshToken: next.refreshToken || current.refreshToken,
  } satisfies TokenCredentials;
};

/* ------------------------------------------------------------- persistence */

type ConnectionRow = {
  id: string;
  provider: SchedulingProvider;
  credentials_encrypted: { cipher?: string } | null;
  token_expires_at: string | null;
  auth_type: string;
};

const markNeedsReconnect = async (connectionId: string, message: string) => {
  const sql = sqlClient();
  await sql`
    UPDATE scheduling_tool_connections
    SET status = 'needs_reconnect', health_ok = FALSE,
        last_error = ${message.slice(0, 300)}, updated_at = NOW()
    WHERE id = ${connectionId}
  `;
};

/**
 * A usable access token for a provider, refreshing it first when it is close to
 * expiry. Exported so the booking flow can mint Meet/Zoom links without needing
 * to know anything about how the credential is stored.
 */
export const usableSchedulingToken = async (
  userId: string,
  provider: SchedulingProvider,
) => {
  const sql = sqlClient();
  const rows = await sql`
    SELECT id, provider, credentials_encrypted, token_expires_at, auth_type
    FROM scheduling_tool_connections
    WHERE user_id = ${userId} AND provider = ${provider}
    LIMIT 1
  `;
  if (rows.length !== 1) throw new RequestError("That account is not connected.", 404);
  const row = rows[0] as ConnectionRow;
  const cipher = row.credentials_encrypted?.cipher || "";
  if (!cipher) {
    await markNeedsReconnect(row.id, "Reconnect this account to finish authorizing it.");
    throw new RequestError("This connection is incomplete. Reconnect the account.", 409);
  }

  const current = decryptCredentials(cipher);
  // API keys do not expire on a schedule, so they are used as-is.
  if (row.auth_type === "api_key") return { connectionId: row.id, credentials: current };

  const expiresAt = Date.parse(current.expiresAt || row.token_expires_at || "");
  // A minute of headroom, so a token does not expire mid-request.
  if (!Number.isFinite(expiresAt) || expiresAt > Date.now() + 60_000) {
    return { connectionId: row.id, credentials: current };
  }

  try {
    const refreshed = await refreshCredentials(provider, current);
    await sql`
      UPDATE scheduling_tool_connections
      SET credentials_encrypted = ${JSON.stringify({ cipher: encryptCredentials(refreshed) })}::jsonb,
          token_expires_at = ${refreshed.expiresAt || null},
          status = 'connected', health_ok = TRUE, last_error = '', updated_at = NOW()
      WHERE id = ${row.id}
    `;
    return { connectionId: row.id, credentials: refreshed };
  } catch (error) {
    // A failed refresh is terminal until the user reconnects, so record that
    // rather than letting the card keep claiming the account is healthy.
    const message =
      error instanceof Error ? error.message : "The provider rejected the stored token.";
    await markNeedsReconnect(row.id, `Reconnect required: ${message}`);
    throw new RequestError("This connection expired. Reconnect the account.", 409);
  }
};

export type EventMeetingProvider = "google_meet" | "teams" | "zoom";

export type SchedulingMeetingInput = {
  title: string;
  description?: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
};

export type SchedulingMeetingResult = {
  provider: EventMeetingProvider;
  connectionId: string;
  externalMeetingId: string;
  calendarEventId: string;
  joinUrl: string;
  hostUrl: string;
  calendarSynced: boolean;
};

const schedulingProvidersForMeeting: Record<EventMeetingProvider, SchedulingProvider[]> = {
  google_meet: ["google_meet", "google_calendar"],
  teams: ["teams"],
  zoom: ["zoom"],
};

const usableMeetingToken = async (userId: string, provider: EventMeetingProvider) => {
  const sql = sqlClient();
  const candidates = schedulingProvidersForMeeting[provider];
  const rows = await sql`
    SELECT provider
    FROM scheduling_tool_connections
    WHERE user_id = ${userId}
      AND provider = ANY(${candidates}::text[])
      AND status = 'connected'
    ORDER BY array_position(${candidates}::text[], provider)
    LIMIT 1
  `;
  const selected = String((rows[0] as { provider?: string } | undefined)?.provider || "");
  if (!isProvider(selected)) throw new RequestError(`Connect ${providers[candidates[0]].label} before creating a meeting.`, 409);
  return usableSchedulingToken(userId, selected);
};

/** Creates a provider-native meeting and, where the provider supports it,
 * places the event on the connected calendar in the same operation. */
export const createSchedulingMeeting = async (
  userId: string,
  provider: EventMeetingProvider,
  input: SchedulingMeetingInput,
): Promise<SchedulingMeetingResult> => {
  const token = await usableMeetingToken(userId, provider);
  const common = {
    provider,
    connectionId: token.connectionId,
    externalMeetingId: "",
    calendarEventId: "",
    joinUrl: "",
    hostUrl: "",
    calendarSynced: false,
  } satisfies SchedulingMeetingResult;
  if (provider === "google_meet") {
    const event = await fetchJson(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=none",
      {
        method: "POST",
        headers: { ...bearer(token.credentials.accessToken), "Content-Type": "application/json" },
        body: JSON.stringify({
          summary: input.title,
          description: input.description || "",
          start: { dateTime: input.startsAt, timeZone: input.timezone },
          end: { dateTime: input.endsAt, timeZone: input.timezone },
          conferenceData: {
            createRequest: {
              requestId: randomUUID(),
              conferenceSolutionKey: { type: "hangoutsMeet" },
            },
          },
        }),
      },
    );
    const conference = (event.conferenceData || {}) as Record<string, unknown>;
    const entries = Array.isArray(conference.entryPoints) ? conference.entryPoints as Array<Record<string, unknown>> : [];
    const video = entries.find((entry) => String(entry.entryPointType || "") === "video") || entries[0] || {};
    const joinUrl = String(video.uri || event.hangoutLink || "");
    if (!joinUrl) throw new Error("Google Calendar created the event but did not return a Meet link.");
    return {
      ...common,
      externalMeetingId: String(conference.conferenceId || event.id || ""),
      calendarEventId: String(event.id || ""),
      joinUrl,
      hostUrl: String(event.htmlLink || joinUrl),
      calendarSynced: true,
    };
  }
  if (provider === "zoom") {
    const start = new Date(input.startsAt);
    const end = new Date(input.endsAt);
    const duration = Math.max(15, Math.ceil((end.getTime() - start.getTime()) / 60_000));
    const meeting = await fetchJson("https://api.zoom.us/v2/users/me/meetings", {
      method: "POST",
      headers: { ...bearer(token.credentials.accessToken), "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: input.title,
        type: 2,
        start_time: start.toISOString(),
        duration,
        timezone: input.timezone,
        agenda: input.description || undefined,
        settings: { waiting_room: true, join_before_host: false },
      }),
    });
    const joinUrl = String(meeting.join_url || "");
    if (!joinUrl) throw new Error("Zoom did not return a participant link.");
    return { ...common, externalMeetingId: String(meeting.id || ""), joinUrl, hostUrl: String(meeting.start_url || joinUrl) };
  }

  const graphHeaders = { ...bearer(token.credentials.accessToken), "Content-Type": "application/json" };
  try {
    const calendarEvent = await fetchJson("https://graph.microsoft.com/v1.0/me/events", {
      method: "POST",
      headers: graphHeaders,
      body: JSON.stringify({
        subject: input.title,
        body: { contentType: "text", content: input.description || "" },
        start: { dateTime: input.startsAt.replace(/Z$/, ""), timeZone: input.timezone },
        end: { dateTime: input.endsAt.replace(/Z$/, ""), timeZone: input.timezone },
        isOnlineMeeting: true,
        onlineMeetingProvider: "teamsForBusiness",
      }),
    });
    const onlineMeeting = (calendarEvent.onlineMeeting || {}) as Record<string, unknown>;
    const joinUrl = String(onlineMeeting.joinUrl || "");
    if (joinUrl) return { ...common, externalMeetingId: String(calendarEvent.id || ""), calendarEventId: String(calendarEvent.id || ""), joinUrl, hostUrl: joinUrl, calendarSynced: true };
  } catch {
    // Some existing Teams grants only contain OnlineMeetings.ReadWrite. Fall
    // back to the meeting endpoint so a valid Teams link is still created.
  }
  const meeting = await fetchJson("https://graph.microsoft.com/v1.0/me/onlineMeetings", {
    method: "POST",
    headers: graphHeaders,
    body: JSON.stringify({ subject: input.title, startDateTime: input.startsAt, endDateTime: input.endsAt }),
  });
  const joinUrl = String(meeting.joinWebUrl || meeting.joinUrl || "");
  if (!joinUrl) throw new Error("Microsoft Teams did not return a participant link.");
  return { ...common, externalMeetingId: String(meeting.id || ""), joinUrl, hostUrl: joinUrl };
};

/** Update an existing provider-native meeting without ever returning stored
 * credentials to the caller. These operations are deliberately idempotent at
 * the event layer: a missing external id is rejected instead of creating a
 * second meeting as a side effect of an update. */
export const updateSchedulingMeeting = async (
  userId: string,
  provider: EventMeetingProvider,
  ids: { externalMeetingId?: string; calendarEventId?: string },
  input: SchedulingMeetingInput,
) => {
  const token = await usableMeetingToken(userId, provider);
  const externalId = String(ids.externalMeetingId || ids.calendarEventId || "");
  if (!externalId) throw new RequestError("The provider meeting is missing its external identifier. Retry creation.", 409);
  if (provider === "google_meet") {
    await fetchJson(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(String(ids.calendarEventId || externalId))}`, {
      method: "PATCH",
      headers: { ...bearer(token.credentials.accessToken), "Content-Type": "application/json" },
      body: JSON.stringify({ summary: input.title, description: input.description || "", start: { dateTime: input.startsAt, timeZone: input.timezone }, end: { dateTime: input.endsAt, timeZone: input.timezone } }),
    });
    return { calendarSynced: true };
  }
  if (provider === "zoom") {
    const start = new Date(input.startsAt);
    const end = new Date(input.endsAt);
    const duration = Math.max(15, Math.ceil((end.getTime() - start.getTime()) / 60_000));
    await fetchJson(`https://api.zoom.us/v2/meetings/${encodeURIComponent(externalId)}`, {
      method: "PATCH",
      headers: { ...bearer(token.credentials.accessToken), "Content-Type": "application/json" },
      body: JSON.stringify({ topic: input.title, start_time: start.toISOString(), duration, timezone: input.timezone, agenda: input.description || undefined }),
    });
    return { calendarSynced: false };
  }
  const calendarId = String(ids.calendarEventId || "");
  const endpoint = calendarId
    ? `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(calendarId)}`
    : `https://graph.microsoft.com/v1.0/me/onlineMeetings/${encodeURIComponent(externalId)}`;
  await fetchJson(endpoint, {
    method: "PATCH",
    headers: { ...bearer(token.credentials.accessToken), "Content-Type": "application/json" },
    body: JSON.stringify(calendarId
      ? { subject: input.title, body: { contentType: "text", content: input.description || "" }, start: { dateTime: input.startsAt.replace(/Z$/, ""), timeZone: input.timezone }, end: { dateTime: input.endsAt.replace(/Z$/, ""), timeZone: input.timezone } }
      : { subject: input.title, startDateTime: input.startsAt, endDateTime: input.endsAt }),
  });
  return { calendarSynced: Boolean(calendarId) };
};

export const cancelSchedulingMeeting = async (
  userId: string,
  provider: EventMeetingProvider,
  ids: { externalMeetingId?: string; calendarEventId?: string },
) => {
  const token = await usableMeetingToken(userId, provider);
  const externalId = String(ids.externalMeetingId || ids.calendarEventId || "");
  if (!externalId) return { cancelled: true };
  if (provider === "google_meet") {
    await fetchJson(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(String(ids.calendarEventId || externalId))}`, { method: "DELETE", headers: bearer(token.credentials.accessToken) });
  } else if (provider === "zoom") {
    await fetchJson(`https://api.zoom.us/v2/meetings/${encodeURIComponent(externalId)}`, { method: "DELETE", headers: bearer(token.credentials.accessToken) });
  } else {
    const endpoint = ids.calendarEventId
      ? `https://graph.microsoft.com/v1.0/me/events/${encodeURIComponent(String(ids.calendarEventId))}`
      : `https://graph.microsoft.com/v1.0/me/onlineMeetings/${encodeURIComponent(externalId)}`;
    await fetchJson(endpoint, { method: "DELETE", headers: bearer(token.credentials.accessToken) });
  }
  return { cancelled: true };
};

const storeConnection = async (input: {
  userId: string;
  provider: SchedulingProvider;
  credentials: TokenCredentials;
  identity: Identity;
  authType: "oauth" | "api_key";
}) => {
  const sql = sqlClient();
  const definition = providers[input.provider];
  const rows = await sql`
    INSERT INTO scheduling_tool_connections (
      user_id, provider, category, credentials_encrypted, account_label, status,
      health_ok, last_error, auth_type, external_account_id, scopes,
      token_expires_at, connected_at, last_synced_at, updated_at
    )
    VALUES (
      ${input.userId}, ${input.provider}, ${definition.category},
      ${JSON.stringify({ cipher: encryptCredentials(input.credentials) })}::jsonb,
      ${input.identity.accountLabel.slice(0, 200)}, 'connected', TRUE, '',
      ${input.authType}, ${input.identity.accountId.slice(0, 200)},
      ${JSON.stringify(scopesFor(input.provider))}::jsonb,
      ${input.credentials.expiresAt || null}, NOW(), NOW(), NOW()
    )
    ON CONFLICT (user_id, provider) DO UPDATE SET
      category = EXCLUDED.category,
      credentials_encrypted = EXCLUDED.credentials_encrypted,
      account_label = EXCLUDED.account_label,
      status = 'connected',
      health_ok = TRUE,
      last_error = '',
      auth_type = EXCLUDED.auth_type,
      external_account_id = EXCLUDED.external_account_id,
      scopes = EXCLUDED.scopes,
      token_expires_at = EXCLUDED.token_expires_at,
      connected_at = COALESCE(scheduling_tool_connections.connected_at, NOW()),
      last_synced_at = NOW(),
      updated_at = NOW()
    RETURNING id
  `;
  const connectionId = String((rows[0] as Record<string, unknown>).id);
  if (input.provider === "google_calendar" || input.provider === "google_meet") {
    // Keep one Google Workspace connection visible to Forms as well as Events.
    // The same encrypted token is stored under the legacy Sheets adapter so
    // existing form workflows immediately see the connected Workspace.
    await sql`
      INSERT INTO automation_connections (
        id, user_id, provider, name, auth_type, status, configuration,
        external_account_id, external_account_name, scopes,
        credentials_encrypted, token_expires_at, last_tested_at,
        created_at, updated_at
      ) VALUES (
        ${connectionId}, ${input.userId}, 'google_sheets', ${definition.label},
        'oauth', 'connected', ${JSON.stringify({ authType: "oauth" })}::jsonb,
        ${input.identity.accountId || null}, ${input.identity.accountLabel || null},
        ${JSON.stringify(scopesFor(input.provider))}::jsonb,
        ${encryptCredentials(input.credentials)}, ${input.credentials.expiresAt || null}, NOW(), NOW(), NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        status = 'connected',
        configuration = EXCLUDED.configuration,
        external_account_id = EXCLUDED.external_account_id,
        external_account_name = EXCLUDED.external_account_name,
        scopes = EXCLUDED.scopes,
        credentials_encrypted = EXCLUDED.credentials_encrypted,
        token_expires_at = EXCLUDED.token_expires_at,
        last_tested_at = NOW(),
        last_error = NULL,
        updated_at = NOW()
    `;
  }
  return connectionId;
};

/* ---------------------------------------------------------------- handlers */

const STATE_PREFIX = "sched_";

const handlePrepare = async (request: IncomingMessage, response: ServerResponse) => {
  const userId = await authenticatedUserId(request);
  const body = await readBody(request);
  const provider = String(body.provider || "");
  if (!isProvider(provider)) throw new RequestError("That provider is not available.");
  const definition = providers[provider];
  if (definition.authType !== "oauth") {
    throw new RequestError(`${definition.label} connects with an API key, not a sign-in.`);
  }
  if (!providerConfigured(provider)) {
    throw new RequestError(
      `${definition.label} is not configured on this server yet.`,
      503,
    );
  }

  const sql = sqlClient();
  const stateToken = randomUUID();
  const stateProvider = `${STATE_PREFIX}${provider}`;
  // Clear this user's stale attempts so repeated cancels do not pile up.
  await sql`
    DELETE FROM automation_oauth_states
    WHERE user_id = ${userId} AND provider = ${stateProvider} AND expires_at <= NOW()
  `;
  await sql`
    INSERT INTO automation_oauth_states (state, user_id, provider, return_url, expires_at)
    VALUES (
      ${stateToken}, ${userId}, ${stateProvider},
      '/dashboard?tab=appointments', NOW() + INTERVAL '10 minutes'
    )
  `;

  const authorizeUrl = new URL(authorizeUrlFor(provider));
  authorizeUrl.searchParams.set("client_id", process.env[definition.clientIdEnv || ""] || "");
  authorizeUrl.searchParams.set("redirect_uri", schedulingCallbackUrl(request));
  authorizeUrl.searchParams.set("response_type", "code");
  // The provider is carried in state, not the redirect URI, so every provider
  // shares one registered callback URL.
  authorizeUrl.searchParams.set("state", stateToken);
  const scopes = scopesFor(provider);
  if (scopes.length) authorizeUrl.searchParams.set("scope", scopes.join(" "));
  for (const [key, value] of Object.entries(definition.authorizeParams || {})) {
    authorizeUrl.searchParams.set(key, value);
  }
  json(response, 200, { authorizationUrl: authorizeUrl.toString() });
};

const handleCallback = async (
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
) => {
  const stateToken = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  if (!stateToken) {
    connectionResultPage(request, response, "error", "");
    return;
  }

  const sql = sqlClient();
  // Consuming the state row here is what makes it single use.
  const stateRows = await sql`
    DELETE FROM automation_oauth_states
    WHERE state = ${stateToken}
      AND provider LIKE ${`${STATE_PREFIX}%`}
      AND expires_at > NOW()
    RETURNING user_id, provider, code_verifier
  `;
  if (stateRows.length !== 1) {
    connectionResultPage(request, response, "error", "");
    return;
  }
  const state = stateRows[0] as {
    user_id: string;
    provider: string;
    code_verifier: string | null;
  };
  const provider = state.provider.slice(STATE_PREFIX.length);
  if (!isProvider(provider)) {
    connectionResultPage(request, response, "error", provider);
    return;
  }
  if (!code || url.searchParams.get("error")) {
    connectionResultPage(request, response, "cancelled", provider);
    return;
  }

  try {
    const credentials = await exchangeCode(
      provider,
      code,
      schedulingCallbackUrl(request),
      state.code_verifier,
    );
    const identity = await providers[provider].identify(credentials.accessToken);
    await storeConnection({
      userId: state.user_id,
      provider,
      credentials,
      identity,
      authType: "oauth",
    });
    connectionResultPage(request, response, "connected", provider);
  } catch {
    connectionResultPage(request, response, "error", provider);
  }
};

/** Cal.com and Calendly personal access tokens. */
const handleConnectKey = async (request: IncomingMessage, response: ServerResponse) => {
  const userId = await authenticatedUserId(request);
  const body = await readBody(request);
  const provider = String(body.provider || "");
  const apiKey = String(body.apiKey || "").trim();
  if (!isProvider(provider)) throw new RequestError("That provider is not available.");
  if (!apiKey) throw new RequestError("Paste the API key to continue.");
  const definition = providers[provider];
  if (definition.authType !== "api_key" && provider !== "calendly") {
    throw new RequestError(`${definition.label} connects by signing in, not with a key.`);
  }

  // Validating before storing means a mistyped key fails here with a clear
  // message instead of becoming a connection that silently never works.
  let identity: Identity;
  try {
    identity = await definition.identify(apiKey);
  } catch {
    throw new RequestError(
      `${definition.label} rejected that key. Check it was copied in full and has not been revoked.`,
      422,
    );
  }

  await storeConnection({
    userId,
    provider,
    credentials: { accessToken: apiKey, tokenType: "ApiKey" },
    identity,
    authType: "api_key",
  });
  json(response, 200, { connected: true, accountLabel: identity.accountLabel });
};

const handleTest = async (request: IncomingMessage, response: ServerResponse) => {
  const userId = await authenticatedUserId(request);
  const body = await readBody(request);
  const provider = String(body.provider || "");
  if (!isProvider(provider)) throw new RequestError("That provider is not available.");

  const sql = sqlClient();
  const { connectionId, credentials } = await usableSchedulingToken(userId, provider);
  try {
    await providers[provider].healthCheck(credentials.accessToken);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The provider rejected this connection.";
    await sql`
      UPDATE scheduling_tool_connections
      SET status = 'error', health_ok = FALSE, last_error = ${message.slice(0, 300)},
          updated_at = NOW()
      WHERE id = ${connectionId}
    `;
    json(response, 200, { ok: false, error: message.slice(0, 300) });
    return;
  }
  await sql`
    UPDATE scheduling_tool_connections
    SET status = 'connected', health_ok = TRUE, last_error = '',
        last_synced_at = NOW(), updated_at = NOW()
    WHERE id = ${connectionId}
  `;
  json(response, 200, { ok: true });
};

/** Workspace-scoped adapter used by the central integrations hub. */
export async function testSchedulingConnectionForCentral(
  userId: string,
  connectionId: string,
) {
  const sql = sqlClient();
  const rows = await sql`
    SELECT provider
    FROM scheduling_tool_connections
    WHERE id = ${connectionId} AND user_id = ${userId}
    LIMIT 1
  `;
  if (rows.length !== 1) throw new Error("This connection is no longer available.");
  const provider = String((rows[0] as Record<string, unknown>).provider || "");
  if (!isProvider(provider)) throw new Error("This connection provider is no longer supported.");
  const { credentials } = await usableSchedulingToken(userId, provider);
  await providers[provider].healthCheck(credentials.accessToken);
  await sql`
    UPDATE scheduling_tool_connections
    SET status = 'connected', health_ok = TRUE, last_error = '', last_synced_at = NOW(), updated_at = NOW()
    WHERE id = ${connectionId} AND user_id = ${userId}
  `;
}

/**
 * Disconnect.
 *
 * The local row goes regardless of what the provider says — a user who clicks
 * Disconnect must end up disconnected here even if the remote revoke call
 * fails, otherwise a provider outage would trap them in a connected state.
 */
const handleDisconnect = async (request: IncomingMessage, response: ServerResponse) => {
  const userId = await authenticatedUserId(request);
  const body = await readBody(request);
  const provider = String(body.provider || "");
  if (!isProvider(provider)) throw new RequestError("That provider is not available.");

  const sql = sqlClient();
  const rows = await sql`
    SELECT credentials_encrypted, auth_type FROM scheduling_tool_connections
    WHERE user_id = ${userId} AND provider = ${provider} LIMIT 1
  `;

  let revoked = false;
  const definition = providers[provider];
  const cipher =
    (rows[0] as { credentials_encrypted?: { cipher?: string } } | undefined)
      ?.credentials_encrypted?.cipher || "";
  if (definition.revokeUrl && cipher) {
    try {
      const credentials = decryptCredentials(cipher);
      const clientId = process.env[definition.clientIdEnv || ""] || "";
      const clientSecret = process.env[definition.clientSecretEnv || ""] || "";
      const headers: Record<string, string> = {
        "Content-Type": "application/x-www-form-urlencoded",
      };
      const params = new URLSearchParams({ token: credentials.accessToken });
      if (definition.basicAuth) {
        headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
      } else if (provider === "calendly") {
        params.set("client_id", clientId);
        params.set("client_secret", clientSecret);
      }
      await fetchJson(definition.revokeUrl, { method: "POST", headers, body: params });
      revoked = true;
    } catch {
      revoked = false;
    }
  }

  await sql`
    DELETE FROM scheduling_tool_connections
    WHERE user_id = ${userId} AND provider = ${provider}
  `;
  json(response, 200, { disconnected: true, revoked });
};

export async function handleSchedulingIntegrations(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const url = new URL(request.url || "/", requestOrigin(request));
  const action = url.searchParams.get("action") || "providers";
  try {
    if (action === "providers") {
      json(response, 200, {
        providers: getSchedulingProviderStatus(),
        callbackUrl: schedulingCallbackUrl(request),
      });
      return;
    }
    if (action === "callback") {
      await handleCallback(request, response, url);
      return;
    }
    if (request.method !== "POST") {
      json(response, 405, { error: "That request is not supported." });
      return;
    }
    if (action === "prepare") return void (await handlePrepare(request, response));
    if (action === "connect-key") return void (await handleConnectKey(request, response));
    if (action === "test") return void (await handleTest(request, response));
    if (action === "disconnect") return void (await handleDisconnect(request, response));
    json(response, 404, { error: "That request is not supported." });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      json(response, 401, { error: "Sign in again to continue." });
      return;
    }
    if (error instanceof RequestError) {
      json(response, error.status, { error: error.message });
      return;
    }
    json(response, 500, { error: "That integration request could not be completed." });
  }
}

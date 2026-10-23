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
import { isComingSoonProvider } from "./integration-provider-registry";
import { workspaceScopeFor } from "./workspace-access";

type ProviderKey =
  | "slack"
  | "google_sheets"
  | "airtable"
  | "hubspot"
  | "mailchimp"
  | "notion"
  | "dropbox"
  | "box";

type ProviderDefinition = {
  authorizeUrl: string;
  clientIdEnv: string;
  clientSecretEnv: string;
  label: string;
  scopes: string[];
  tokenUrl: string;
  usesPkce?: boolean;
  authorizeParams?: Record<string, string>;
};

type TokenCredentials = {
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  expiresAt?: string;
};

/** Server-only token shape shared with optional storage adapters. */
export type IntegrationTokenCredentials = TokenCredentials;

type ConnectionRow = {
  id: string;
  provider: ProviderKey;
  configuration: Record<string, unknown>;
  credentials_encrypted: string;
  token_expires_at: string | null;
};

const providers: Record<ProviderKey, ProviderDefinition> = {
  slack: {
    authorizeUrl: "https://slack.com/oauth/v2/authorize",
    clientIdEnv: "SLACK_CLIENT_ID",
    clientSecretEnv: "SLACK_CLIENT_SECRET",
    label: "Slack",
    scopes: ["incoming-webhook", "chat:write"],
    tokenUrl: "https://slack.com/api/oauth.v2.access",
  },
  google_sheets: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    clientIdEnv: "GOOGLE_CLIENT_ID",
    clientSecretEnv: "GOOGLE_CLIENT_SECRET",
    label: "Google Sheets",
    scopes: [
      "openid",
      "email",
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive.metadata.readonly",
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/gmail.send",
    ],
    tokenUrl: "https://oauth2.googleapis.com/token",
  },
  airtable: {
    authorizeUrl: "https://airtable.com/oauth2/v1/authorize",
    clientIdEnv: "AIRTABLE_CLIENT_ID",
    clientSecretEnv: "AIRTABLE_CLIENT_SECRET",
    label: "Airtable",
    scopes: [
      "data.records:read",
      "data.records:write",
      "schema.bases:read",
    ],
    tokenUrl: "https://airtable.com/oauth2/v1/token",
    usesPkce: true,
  },
  hubspot: {
    authorizeUrl: "https://app.hubspot.com/oauth/authorize",
    clientIdEnv: "HUBSPOT_CLIENT_ID",
    clientSecretEnv: "HUBSPOT_CLIENT_SECRET",
    label: "HubSpot",
    scopes: ["oauth", "crm.objects.contacts.read", "crm.objects.contacts.write"],
    tokenUrl: "https://api.hubapi.com/oauth/v3/token",
  },
  mailchimp: {
    authorizeUrl: "https://login.mailchimp.com/oauth2/authorize",
    clientIdEnv: "MAILCHIMP_CLIENT_ID",
    clientSecretEnv: "MAILCHIMP_CLIENT_SECRET",
    label: "Mailchimp",
    scopes: [],
    tokenUrl: "https://login.mailchimp.com/oauth2/token",
  },
  notion: {
    authorizeUrl: "https://api.notion.com/v1/oauth/authorize",
    clientIdEnv: "NOTION_CLIENT_ID",
    clientSecretEnv: "NOTION_CLIENT_SECRET",
    label: "Notion",
    scopes: [],
    tokenUrl: "https://api.notion.com/v1/oauth/token",
  },
  dropbox: {
    authorizeUrl: "https://www.dropbox.com/oauth2/authorize",
    clientIdEnv: "DROPBOX_CLIENT_ID",
    clientSecretEnv: "DROPBOX_CLIENT_SECRET",
    label: "Dropbox",
    scopes: ["account_info.read", "files.metadata.read", "files.content.read", "files.content.write"],
    tokenUrl: "https://api.dropboxapi.com/oauth2/token",
    authorizeParams: { token_access_type: "offline" },
  },
  box: {
    authorizeUrl: "https://account.box.com/api/oauth2/authorize",
    clientIdEnv: "BOX_CLIENT_ID",
    clientSecretEnv: "BOX_CLIENT_SECRET",
    label: "Box",
    scopes: [],
    tokenUrl: "https://api.box.com/oauth2/token",
  },
};

const grantedScopesFor = (provider: ProviderKey, rawToken: Record<string, unknown>) => {
  const rawScope = rawToken.scope;
  const scopes = Array.isArray(rawScope)
    ? rawScope.map(String).filter(Boolean)
    : String(rawScope || "").split(/[\s,]+/).map((scope) => scope.trim()).filter(Boolean);
  return scopes.length ? scopes : providers[provider].scopes;
};

const databaseUrl = () => process.env.DATABASE_URL || "";

const sqlClient = () => {
  const url = databaseUrl();
  if (!url) throw new Error("DATABASE_URL is not configured");
  return neon(url);
};

const isProvider = (value: string): value is ProviderKey =>
  Object.prototype.hasOwnProperty.call(providers, value);

const json = (
  response: ServerResponse,
  status: number,
  value: Record<string, unknown>,
) => {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.end(JSON.stringify(value));
};

class AuthenticationError extends Error {}

const authenticatedUserId = async (request: IncomingMessage) => {
  const authorization = String(request.headers.authorization || "");
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  if (!token) throw new AuthenticationError("Authentication required");
  try {
    const signingSecret = process.env.JWT_SECRET || "";
    if (signingSecret.length < 32) {
      throw new AuthenticationError("Authentication required");
    }
    const secret = new TextEncoder().encode(signingSecret);
    const { payload } = await jwtVerify(token, secret, {
      audience: "maxform-dashboard",
      issuer: "maxform",
    });
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

const redirect = (response: ServerResponse, location: string) => {
  response.statusCode = 302;
  response.setHeader("Location", location);
  response.end();
};

const requestOrigin = (request: IncomingMessage) => {
  const forwardedProto = String(
    request.headers["x-forwarded-proto"] || "",
  ).split(",")[0];
  const protocol =
    forwardedProto || (request.socket && "encrypted" in request.socket ? "https" : "http");
  const host = String(
    request.headers["x-forwarded-host"] || request.headers.host || "localhost",
  ).split(",")[0];
  return `${protocol}://${host}`;
};

const callbackUrl = (request: IncomingMessage, provider: ProviderKey) => {
  const configuredBase = configuredAppUrl();
  const base = configuredBase || requestOrigin(request);
  return `${base}/api/integrations/oauth?action=callback&provider=${provider}`;
};

const safeReturnTo = (value: string) =>
  value.startsWith("/dashboard")
    ? value
    : "/dashboard?tab=forms&section=automations";

const encryptionKey = () => {
  const secret = process.env.INTEGRATION_ENCRYPTION_KEY || "";
  if (secret.length < 24) {
    throw new Error("INTEGRATION_ENCRYPTION_KEY is not configured");
  }
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

// These helpers stay server-only. They let the Files module use the same
// encrypted OAuth material as Forms and the central integrations hub without
// putting provider credentials in browser state or duplicating encryption.
export const encryptIntegrationCredentials = encryptCredentials;
export const decryptIntegrationCredentials = decryptCredentials;

const providerConfigured = (provider: ProviderKey) => {
  const definition = providers[provider];
  return Boolean(
    process.env[definition.clientIdEnv] &&
      process.env[definition.clientSecretEnv] &&
      process.env.INTEGRATION_ENCRYPTION_KEY &&
      databaseUrl(),
  );
};

export const getAutomationOAuthProviderStatusServer = () =>
  Object.fromEntries(
    Object.keys(providers).map((key) => [
      key,
      { configured: providerConfigured(key as ProviderKey) },
    ]),
  );

const readBody = async (request: IncomingMessage) => {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) {
      throw new Error("Integration request is too large");
    }
  }
  if (!body) return {};
  return JSON.parse(body) as Record<string, unknown>;
};

const fetchJson = async (
  url: string,
  init?: RequestInit,
): Promise<Record<string, unknown>> => {
  const response = await fetch(url, init);
  const text = await response.text();
  let value: Record<string, unknown> = {};
  try {
    value = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    value = { message: text };
  }
  if (!response.ok || value.ok === false) {
    throw new Error(
      String(value.error || value.message || `HTTP ${response.status}`),
    );
  }
  return value;
};

export const refreshIntegrationCredentials = async (
  provider: ProviderKey,
  current: TokenCredentials,
) => {
  if (!current.refreshToken) {
    throw new Error("This connection expired. Reconnect the provider.");
  }
  const definition = providers[provider];
  const clientId = process.env[definition.clientIdEnv] || "";
  const clientSecret = process.env[definition.clientSecretEnv] || "";
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: current.refreshToken,
  });
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };

  if (provider === "airtable" || provider === "notion") {
    headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
    if (provider === "airtable") params.set("client_id", clientId);
  } else {
    params.set("client_id", clientId);
    params.set("client_secret", clientSecret);
  }

  const token = await fetchJson(definition.tokenUrl, {
    method: "POST",
    headers,
    body: params,
  });
  const accessToken = String(token.access_token || "");
  if (!accessToken) throw new Error("Provider did not refresh the access token");
  const expiresIn = Number(token.expires_in || 0);
  return {
    accessToken,
    refreshToken: token.refresh_token
      ? String(token.refresh_token)
      : current.refreshToken,
    tokenType: token.token_type
      ? String(token.token_type)
      : current.tokenType,
    expiresAt: expiresIn
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : undefined,
  } satisfies TokenCredentials;
};

const exchangeCode = async (
  provider: ProviderKey,
  code: string,
  redirectUri: string,
  codeVerifier: string | null,
) => {
  const definition = providers[provider];
  const clientId = process.env[definition.clientIdEnv] || "";
  const clientSecret = process.env[definition.clientSecretEnv] || "";
  let token: Record<string, unknown>;

  if (provider === "slack") {
    token = await fetchJson(definition.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });
  } else if (provider === "notion") {
    token = await fetchJson(definition.tokenUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
    });
  } else if (provider === "airtable") {
    token = await fetchJson(definition.tokenUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier || "",
      }),
    });
  } else {
    token = await fetchJson(definition.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code,
      }),
    });
  }

  const expiresIn = Number(token.expires_in || 0);
  return {
    raw: token,
    credentials: {
      accessToken: String(
        token.access_token ||
          (token.authed_user as Record<string, unknown> | undefined)
            ?.access_token ||
          "",
      ),
      refreshToken: token.refresh_token
        ? String(token.refresh_token)
        : undefined,
      tokenType: token.token_type ? String(token.token_type) : "Bearer",
      expiresAt: expiresIn
        ? new Date(Date.now() + expiresIn * 1000).toISOString()
        : undefined,
    } satisfies TokenCredentials,
  };
};

const connectionIdentity = async (
  provider: ProviderKey,
  token: Record<string, unknown>,
  credentials: TokenCredentials,
) => {
  if (provider === "slack") {
    const team = (token.team || {}) as Record<string, unknown>;
    const hook = (token.incoming_webhook || {}) as Record<string, unknown>;
    return {
      accountId: String(team.id || ""),
      accountName: String(team.name || providers[provider].label),
      configuration: {
        endpointUrl: String(hook.url || ""),
        channel: String(hook.channel || ""),
      },
    };
  }
  if (provider === "notion") {
    return {
      accountId: String(token.workspace_id || ""),
      accountName: String(token.workspace_name || providers[provider].label),
      configuration: {
        workspaceIcon: String(token.workspace_icon || ""),
      },
    };
  }
  if (provider === "hubspot") {
    return {
      accountId: String(token.hub_id || ""),
      accountName: token.hub_id
        ? `HubSpot ${String(token.hub_id)}`
        : providers[provider].label,
      configuration: {},
    };
  }
  if (provider === "mailchimp") {
    const metadata = await fetchJson(
      "https://login.mailchimp.com/oauth2/metadata",
      {
        headers: { Authorization: `OAuth ${credentials.accessToken}` },
      },
    );
    return {
      accountId: String(metadata.user_id || metadata.accountname || ""),
      accountName: String(metadata.accountname || providers[provider].label),
      configuration: {
        dataCenter: String(metadata.dc || ""),
        apiEndpoint: String(metadata.api_endpoint || ""),
      },
    };
  }
  if (provider === "google_sheets") {
    const profile = await fetchJson(
      "https://www.googleapis.com/oauth2/v3/userinfo",
      {
        headers: { Authorization: `Bearer ${credentials.accessToken}` },
      },
    );
    return {
      accountId: String(profile.sub || profile.email || ""),
      accountName: String(profile.email || providers[provider].label),
      configuration: {},
    };
  }
  if (provider === "dropbox") {
    const account = await fetchJson("https://api.dropboxapi.com/2/users/get_current_account", {
      method: "POST",
      headers: { Authorization: `Bearer ${credentials.accessToken}` },
    });
    const name = (account.name || {}) as Record<string, unknown>;
    return {
      accountId: String(account.account_id || account.email || ""),
      accountName: String(account.email || name.display_name || providers[provider].label),
      configuration: {},
    };
  }
  if (provider === "box") {
    const account = await fetchJson("https://api.box.com/2.0/users/me", {
      headers: { Authorization: `Bearer ${credentials.accessToken}` },
    });
    return {
      accountId: String(account.id || account.login || ""),
      accountName: String(account.login || account.name || providers[provider].label),
      configuration: {},
    };
  }
  const profile = await fetchJson("https://airtable.com/oauth2/v1/userInfo", {
    headers: { Authorization: `Bearer ${credentials.accessToken}` },
  });
  return {
    accountId: String(profile.id || profile.email || ""),
    accountName: String(profile.email || providers[provider].label),
    configuration: {},
  };
};

const handleProviders = (response: ServerResponse) => {
  json(response, 200, {
    providers: getAutomationOAuthProviderStatusServer(),
  });
};

const handleStart = async (
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
) => {
  const providerValue = url.searchParams.get("provider") || "";
  const userId = await authenticatedUserId(request);
  const returnTo = safeReturnTo(url.searchParams.get("returnTo") || "");
  if (!isProvider(providerValue) || !userId) {
    json(response, 400, { error: "Invalid OAuth request" });
    return;
  }
  if (isComingSoonProvider(providerValue)) {
    json(response, 409, { error: "This provider is coming soon and cannot be connected yet.", code: "provider_coming_soon" });
    return;
  }
  if (!providerConfigured(providerValue)) {
    json(response, 503, {
      error: "This integration is temporarily unavailable.",
      code: "provider_not_configured",
    });
    return;
  }

  const definition = providers[providerValue];
  const stateToken = randomUUID();
  const codeVerifier = definition.usesPkce
    ? randomBytes(48).toString("base64url")
    : null;
  const sql = sqlClient();
  await sql`
    INSERT INTO automation_oauth_states (
      state, user_id, provider, return_url, code_verifier, expires_at
    )
    VALUES (
      ${stateToken}, ${userId}, ${providerValue}, ${returnTo},
      ${codeVerifier}, NOW() + INTERVAL '10 minutes'
    )
  `;

  const redirectUri = callbackUrl(request, providerValue);
  const authorizeUrl = new URL(definition.authorizeUrl);
  authorizeUrl.searchParams.set(
    "client_id",
    process.env[definition.clientIdEnv] || "",
  );
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("state", stateToken);
  if (definition.scopes.length > 0) {
    authorizeUrl.searchParams.set("scope", definition.scopes.join(" "));
  }
  if (providerValue === "slack") {
    authorizeUrl.searchParams.set("scope", definition.scopes.join(","));
  }
  if (providerValue === "google_sheets") {
    authorizeUrl.searchParams.set("access_type", "offline");
    authorizeUrl.searchParams.set("prompt", "consent");
  }
  if (providerValue === "notion") {
    authorizeUrl.searchParams.set("owner", "user");
  }
  for (const [key, value] of Object.entries(definition.authorizeParams || {})) {
    authorizeUrl.searchParams.set(key, value);
  }
  if (codeVerifier) {
    authorizeUrl.searchParams.set(
      "code_challenge",
      createHash("sha256").update(codeVerifier).digest("base64url"),
    );
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
  }
  redirect(response, authorizeUrl.toString());
};

const handlePrepare = async (
  request: IncomingMessage,
  response: ServerResponse,
) => {
  const userId = await authenticatedUserId(request);
  const body = await readBody(request);
  const providerValue = String(body.provider || "");
  const returnTo = safeReturnTo(String(body.returnTo || ""));
  if (!isProvider(providerValue)) {
    json(response, 400, { error: "This provider is not available." });
    return;
  }
  if (isComingSoonProvider(providerValue)) {
    json(response, 409, { error: "This provider is coming soon and cannot be connected yet.", code: "provider_coming_soon" });
    return;
  }
  if (!providerConfigured(providerValue)) {
    json(response, 503, {
      error: "This integration is temporarily unavailable.",
      code: "provider_not_configured",
    });
    return;
  }

  const definition = providers[providerValue];
  const stateToken = randomUUID();
  const codeVerifier = definition.usesPkce
    ? randomBytes(48).toString("base64url")
    : null;
  const sql = sqlClient();
  await sql`
    DELETE FROM automation_oauth_states
    WHERE user_id = ${userId}
      AND provider = ${providerValue}
      AND expires_at <= NOW()
  `;
  await sql`
    INSERT INTO automation_oauth_states (
      state, user_id, provider, return_url, code_verifier, expires_at
    )
    VALUES (
      ${stateToken}, ${userId}, ${providerValue}, ${returnTo},
      ${codeVerifier}, NOW() + INTERVAL '10 minutes'
    )
  `;

  const redirectUri = callbackUrl(request, providerValue);
  const authorizeUrl = new URL(definition.authorizeUrl);
  authorizeUrl.searchParams.set(
    "client_id",
    process.env[definition.clientIdEnv] || "",
  );
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("state", stateToken);
  if (definition.scopes.length > 0) {
    authorizeUrl.searchParams.set("scope", definition.scopes.join(" "));
  }
  if (providerValue === "slack") {
    authorizeUrl.searchParams.set("scope", definition.scopes.join(","));
  }
  if (providerValue === "google_sheets") {
    authorizeUrl.searchParams.set("access_type", "offline");
    authorizeUrl.searchParams.set("prompt", "consent");
  }
  if (providerValue === "notion") {
    authorizeUrl.searchParams.set("owner", "user");
  }
  for (const [key, value] of Object.entries(definition.authorizeParams || {})) {
    authorizeUrl.searchParams.set(key, value);
  }
  if (codeVerifier) {
    authorizeUrl.searchParams.set(
      "code_challenge",
      createHash("sha256").update(codeVerifier).digest("base64url"),
    );
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
  }
  json(response, 200, { authorizationUrl: authorizeUrl.toString() });
};

const handleCallback = async (
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
) => {
  const providerValue = url.searchParams.get("provider") || "";
  const stateToken = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  if (!isProvider(providerValue) || !stateToken) {
    connectionResultPage(request, response, "error", providerValue);
    return;
  }
  const sql = sqlClient();
  const stateRows = await sql`
    DELETE FROM automation_oauth_states
    WHERE state = ${stateToken}
      AND provider = ${providerValue}
      AND expires_at > NOW()
    RETURNING user_id, return_url, code_verifier
  `;
  if (stateRows.length !== 1) {
    connectionResultPage(request, response, "error", providerValue);
    return;
  }
  const state = stateRows[0] as {
    user_id: string;
    return_url: string;
    code_verifier: string | null;
  };
  if (!code || url.searchParams.get("error")) {
    connectionResultPage(request, response, "cancelled", providerValue);
    return;
  }

  try {
    const exchanged = await exchangeCode(
      providerValue,
      code,
      callbackUrl(request, providerValue),
      state.code_verifier,
    );
    if (!exchanged.credentials.accessToken) {
      throw new Error("Provider did not return an access token");
    }
    const identity = await connectionIdentity(
      providerValue,
      exchanged.raw,
      exchanged.credentials,
    );
    const grantedScopes = grantedScopesFor(providerValue, exchanged.raw);
    const encrypted = encryptCredentials(exchanged.credentials);
    const name = identity.accountName
      ? `${providers[providerValue].label} - ${identity.accountName}`
      : providers[providerValue].label;
    const existing = await sql`
      SELECT id
      FROM automation_connections
      WHERE user_id = ${state.user_id}
        AND provider = ${providerValue}
        AND COALESCE(external_account_id, '') = ${identity.accountId}
      LIMIT 1
    `;
    if (existing.length > 0) {
      await sql`
        UPDATE automation_connections
        SET name = ${name},
            auth_type = 'oauth',
            status = 'connected',
            configuration = ${JSON.stringify({
              ...identity.configuration,
              authType: "oauth",
            })}::jsonb,
            external_account_id = ${identity.accountId || null},
            external_account_name = ${identity.accountName || null},
            scopes = ${JSON.stringify(grantedScopes)}::jsonb,
            credentials_encrypted = ${encrypted},
            token_expires_at = ${exchanged.credentials.expiresAt || null},
            last_tested_at = NOW(),
            last_error = NULL,
            updated_at = NOW()
        WHERE id = ${existing[0].id}
      `;
    } else {
      await sql`
        INSERT INTO automation_connections (
          user_id, provider, name, auth_type, status, configuration,
          external_account_id, external_account_name, scopes,
          credentials_encrypted, token_expires_at, last_tested_at,
          created_at, updated_at
        )
        VALUES (
          ${state.user_id}, ${providerValue}, ${name}, 'oauth', 'connected',
          ${JSON.stringify({
            ...identity.configuration,
            authType: "oauth",
          })}::jsonb,
          ${identity.accountId || null}, ${identity.accountName || null},
          ${JSON.stringify(grantedScopes)}::jsonb,
          ${encrypted}, ${exchanged.credentials.expiresAt || null}, NOW(),
          NOW(), NOW()
        )
      `;
    }
    connectionResultPage(request, response, "connected", providerValue);
  } catch {
    connectionResultPage(request, response, "error", providerValue);
  }
};

const connectionForRequest = async (
  connectionId: string,
  userId?: string,
) => {
  const sql = sqlClient();
  const rows = userId
    ? await sql`
        SELECT id, provider, configuration, credentials_encrypted, token_expires_at
        FROM automation_connections
        WHERE id = ${connectionId}
          AND user_id = ${userId}
          AND auth_type = 'oauth'
          AND status <> 'disabled'
        LIMIT 1
      `
    : await sql`
        SELECT id, provider, configuration, credentials_encrypted, token_expires_at
        FROM automation_connections
        WHERE id = ${connectionId}
          AND auth_type = 'oauth'
          AND status <> 'disabled'
        LIMIT 1
      `;
  if (rows.length !== 1) throw new Error("OAuth connection was not found");
  return rows[0] as ConnectionRow;
};

const usableCredentials = async (connection: ConnectionRow) => {
  const current = decryptCredentials(connection.credentials_encrypted);
  const expiresAt = Date.parse(
    current.expiresAt || connection.token_expires_at || "",
  );
  if (!Number.isFinite(expiresAt) || expiresAt > Date.now() + 60_000) {
    return current;
  }
  const refreshed = await refreshIntegrationCredentials(connection.provider, current);
  const sql = sqlClient();
  await sql`
    UPDATE automation_connections
    SET credentials_encrypted = ${encryptCredentials(refreshed)},
        token_expires_at = ${refreshed.expiresAt || null},
        status = 'connected',
        last_error = NULL,
        updated_at = NOW()
    WHERE id = ${connection.id}
  `;
  return refreshed;
};

const testProviderConnection = async (connection: ConnectionRow) => {
  const credentials = await usableCredentials(connection);
  const headers = { Authorization: `Bearer ${credentials.accessToken}` };
  if (connection.provider === "slack") {
    return fetchJson("https://slack.com/api/auth.test", { headers });
  }
  if (connection.provider === "google_sheets") {
    return fetchJson("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers,
    });
  }
  if (connection.provider === "airtable") {
    return fetchJson("https://airtable.com/oauth2/v1/userInfo", { headers });
  }
  if (connection.provider === "hubspot") {
    return fetchJson(
      "https://api.hubapi.com/crm/v3/objects/contacts?limit=1&archived=false",
      {
      headers,
      },
    );
  }
  if (connection.provider === "mailchimp") {
    return fetchJson("https://login.mailchimp.com/oauth2/metadata", {
      headers: { Authorization: `OAuth ${credentials.accessToken}` },
    });
  }
  if (connection.provider === "dropbox") {
    return fetchJson("https://api.dropboxapi.com/2/users/get_current_account", {
      method: "POST",
      headers,
    });
  }
  if (connection.provider === "box") {
    return fetchJson("https://api.box.com/2.0/users/me", { headers });
  }
  return fetchJson("https://api.notion.com/v1/users/me", {
    headers: {
      ...headers,
      "Notion-Version": "2026-03-11",
    },
  });
};

/**
 * Central integrations hub bridge. The old forms automation engine still owns
 * this provider adapter and credential refresh logic; the central service calls
 * this small, workspace-scoped wrapper so we do not duplicate token handling.
 */
export async function testAutomationConnectionForCentral(
  userId: string,
  connectionId: string,
) {
  const sql = sqlClient();
  const rows = await sql`
    SELECT id, provider, configuration, credentials_encrypted, token_expires_at
    FROM automation_connections
    WHERE id = ${connectionId} AND user_id = ${userId}
    LIMIT 1
  `;
  if (rows.length !== 1) throw new Error("This connection is no longer available.");
  const raw = rows[0] as Record<string, unknown>;
  const connection = {
    id: String(raw.id),
    provider: String(raw.provider) as ProviderKey,
    configuration:
      raw.configuration && typeof raw.configuration === "object"
        ? (raw.configuration as Record<string, unknown>)
        : {},
    credentials_encrypted: String(raw.credentials_encrypted || ""),
    token_expires_at: raw.token_expires_at ? String(raw.token_expires_at) : null,
  } satisfies ConnectionRow;
  await testProviderConnection(connection);
  await sql`
    UPDATE automation_connections
    SET status = 'connected', last_tested_at = NOW(), last_error = NULL, updated_at = NOW()
    WHERE id = ${connectionId} AND user_id = ${userId}
  `;
}

type ProviderResource = {
  description?: string;
  label: string;
  value: string;
};

const notionTitle = (value: unknown) => {
  if (!Array.isArray(value)) return "";
  return value
    .map((part) =>
      part && typeof part === "object" && "plain_text" in part
        ? String((part as Record<string, unknown>).plain_text || "")
        : "",
    )
    .join("");
};

const providerResources = async (
  connection: ConnectionRow,
  resource: string,
  parentId: string,
): Promise<ProviderResource[]> => {
  const credentials = await usableCredentials(connection);
  const bearerHeaders = {
    Authorization: `Bearer ${credentials.accessToken}`,
  };

  if (connection.provider === "google_sheets" && resource === "spreadsheets") {
    const data = await fetchJson(
      "https://www.googleapis.com/drive/v3/files?" +
        new URLSearchParams({
          q: "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
          fields: "files(id,name,modifiedTime)",
          orderBy: "modifiedTime desc",
          pageSize: "100",
        }),
      { headers: bearerHeaders },
    );
    return (Array.isArray(data.files) ? data.files : []).map((item) => {
      const file = item as Record<string, unknown>;
      return {
        value: String(file.id || ""),
        label: String(file.name || "Untitled spreadsheet"),
        description: file.modifiedTime
          ? `Updated ${new Date(String(file.modifiedTime)).toLocaleDateString()}`
          : undefined,
      };
    });
  }

  if (
    connection.provider === "google_sheets" &&
    resource === "sheets" &&
    parentId
  ) {
    const data = await fetchJson(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(parentId)}?fields=sheets.properties`,
      { headers: bearerHeaders },
    );
    return (Array.isArray(data.sheets) ? data.sheets : []).map((item) => {
      const sheet = item as Record<string, unknown>;
      const properties = (sheet.properties || {}) as Record<string, unknown>;
      return {
        value: String(properties.title || ""),
        label: String(properties.title || "Untitled sheet"),
        description: `${String(properties.gridProperties ? "Worksheet" : "Sheet")}`,
      };
    });
  }

  if (connection.provider === "airtable" && resource === "bases") {
    const data = await fetchJson("https://api.airtable.com/v0/meta/bases", {
      headers: bearerHeaders,
    });
    return (Array.isArray(data.bases) ? data.bases : []).map((item) => {
      const base = item as Record<string, unknown>;
      return {
        value: String(base.id || ""),
        label: String(base.name || "Untitled base"),
        description: String(base.permissionLevel || ""),
      };
    });
  }

  if (
    connection.provider === "airtable" &&
    resource === "tables" &&
    parentId
  ) {
    const data = await fetchJson(
      `https://api.airtable.com/v0/meta/bases/${encodeURIComponent(parentId)}/tables`,
      { headers: bearerHeaders },
    );
    return (Array.isArray(data.tables) ? data.tables : []).map((item) => {
      const table = item as Record<string, unknown>;
      return {
        value: String(table.id || ""),
        label: String(table.name || "Untitled table"),
        description: `${Array.isArray(table.fields) ? table.fields.length : 0} fields`,
      };
    });
  }

  if (connection.provider === "mailchimp" && resource === "audiences") {
    const apiEndpoint = String(connection.configuration.apiEndpoint || "");
    if (!apiEndpoint) return [];
    const data = await fetchJson(
      `${apiEndpoint.replace(/\/$/, "")}/3.0/lists?count=100&fields=lists.id,lists.name,lists.stats.member_count`,
      {
        headers: {
          Authorization: `OAuth ${credentials.accessToken}`,
        },
      },
    );
    return (Array.isArray(data.lists) ? data.lists : []).map((item) => {
      const list = item as Record<string, unknown>;
      const stats = (list.stats || {}) as Record<string, unknown>;
      return {
        value: String(list.id || ""),
        label: String(list.name || "Untitled audience"),
        description: `${Number(stats.member_count || 0).toLocaleString()} contacts`,
      };
    });
  }

  if (
    connection.provider === "notion" &&
    (resource === "data_sources" || resource === "pages")
  ) {
    const object = resource === "data_sources" ? "data_source" : "page";
    const data = await fetchJson("https://api.notion.com/v1/search", {
      method: "POST",
      headers: {
        ...bearerHeaders,
        "Content-Type": "application/json",
        "Notion-Version": "2026-03-11",
      },
      body: JSON.stringify({
        filter: { property: "object", value: object },
        page_size: 100,
        sort: { direction: "descending", timestamp: "last_edited_time" },
      }),
    });
    return (Array.isArray(data.results) ? data.results : []).map((item) => {
      const result = item as Record<string, unknown>;
      const properties = (result.properties || {}) as Record<string, unknown>;
      const titleProperty = Object.values(properties).find(
        (property) =>
          property &&
          typeof property === "object" &&
          (property as Record<string, unknown>).type === "title",
      ) as Record<string, unknown> | undefined;
      return {
        value: String(result.id || ""),
        label:
          notionTitle(result.title) ||
          notionTitle(titleProperty?.title) ||
          "Untitled",
        description: result.last_edited_time
          ? `Updated ${new Date(String(result.last_edited_time)).toLocaleDateString()}`
          : undefined,
      };
    });
  }

  return [];
};

const handleResources = async (
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
) => {
  const userId = await authenticatedUserId(request);
  const connection = await connectionForRequest(
    url.searchParams.get("connectionId") || "",
    userId,
  );
  try {
    const resources = await providerResources(
      connection,
      url.searchParams.get("resource") || "",
      url.searchParams.get("parentId") || "",
    );
    json(response, 200, { resources });
  } catch {
    json(response, 502, {
      error: "Destinations could not be loaded. Reconnect the account and try again.",
    });
  }
};

type ProviderFormField = {
  id: string;
  label: string;
  type: string;
};

const providerTemplateValue = (value: unknown) => {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

const resolveProviderTemplate = (
  template: string,
  payload: Record<string, unknown>,
) => {
  const answers = (payload.answers || {}) as Record<string, unknown>;
  const form = (payload.form || {}) as Record<string, unknown>;
  const submission = (payload.submission || {}) as Record<string, unknown>;
  const valueAtPath = (value: unknown, path: string) => {
    const parts = path.split(".").filter(Boolean);
    let current = value;
    for (const part of parts) {
      if (!current || typeof current !== "object" || Array.isArray(current)) return "";
      current = (current as Record<string, unknown>)[part];
    }
    return providerTemplateValue(current);
  };
  return template.replace(
    /\{\{\s*([^}]+?)\s*\}\}/g,
    (_match, rawKey: string) => {
      const key = rawKey.trim();
      if (key === "$json") return providerTemplateValue(payload);
      if (key.startsWith("$json.")) return valueAtPath(payload, key.slice("$json.".length));
      if (key.startsWith("json.")) return valueAtPath(payload, key.slice("json.".length));
      if (key === "form.title") return String(form.title || "");
      if (key === "form.id") return String(form.id || "");
      if (key === "form.slug") return String(form.slug || "");
      if (key === "submission.id") return String(submission.id || "");
      if (key === "submission.created_at") {
        return String(submission.submittedAt || new Date().toISOString());
      }
      if (key.startsWith("response.")) {
        return providerTemplateValue(
          answers[key.slice("response.".length)],
        );
      }
      return "";
    },
  );
};

const payloadFields = (payload: Record<string, unknown>) =>
  (Array.isArray(payload.fields) ? payload.fields : []).filter(
    (field): field is ProviderFormField =>
      Boolean(
        field &&
          typeof field === "object" &&
          "id" in field &&
          "label" in field,
      ),
  );

const configuredAnswer = (
  payload: Record<string, unknown>,
  actionConfig: Record<string, unknown>,
  configKey: string,
  fallback: (field: ProviderFormField) => boolean,
) => {
  const answers = (payload.answers || {}) as Record<string, unknown>;
  const fields = payloadFields(payload);
  const configuredFieldId = String(actionConfig[configKey] || "");
  const fieldId =
    configuredFieldId || fields.find((field) => fallback(field))?.id || "";
  return providerTemplateValue(answers[fieldId]).trim();
};

const providerEmail = (
  payload: Record<string, unknown>,
  actionConfig: Record<string, unknown>,
) => {
  const mapped = configuredAnswer(
    payload,
    actionConfig,
    "emailFieldId",
    (field) => field.type === "email" || /email/i.test(field.label),
  );
  if (mapped) return mapped;
  const answers = (payload.answers || {}) as Record<string, unknown>;
  return (
    Object.values(answers)
      .map(String)
      .find((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) || ""
  );
};

const answersByLabel = (payload: Record<string, unknown>) => {
  const answers = (payload.answers || {}) as Record<string, unknown>;
  const fields = payloadFields(payload);
  return Object.fromEntries(
    fields
      .filter((field) => answers[field.id] != null)
      .map((field) => [field.label, answers[field.id]]),
  );
};

const orderedAnswerValues = (payload: Record<string, unknown>) => {
  const answers = (payload.answers || {}) as Record<string, unknown>;
  const fields = payloadFields(payload);
  return fields.length > 0
    ? fields.map((field) => providerTemplateValue(answers[field.id]))
    : Object.values(answers).map(providerTemplateValue);
};

const executeProviderAction = async (
  connection: ConnectionRow,
  actionConfig: Record<string, unknown>,
  payload: Record<string, unknown>,
) => {
  const credentials = await usableCredentials(connection);
  const form = (payload.form || {}) as Record<string, unknown>;
  const operation = String(actionConfig.operation || "");
  const authHeaders = {
    Authorization: `Bearer ${credentials.accessToken}`,
    "Content-Type": "application/json",
  };
  if (connection.provider === "slack") {
    const endpointUrl = String(connection.configuration.endpointUrl || "");
    if (!endpointUrl) throw new Error("Slack webhook URL is unavailable");
    return fetchJson(endpointUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: resolveProviderTemplate(
          String(actionConfig.message || "") ||
            `New response received for ${String(form.title || "a form")}`,
          payload,
        ),
      }),
    });
  }
  if (connection.provider === "google_sheets") {
    if (["gmail.send", "email.send"].includes(operation)) {
      const configuredTo = resolveProviderTemplate(String(actionConfig.to || actionConfig.recipient || ""), payload).trim();
      const to = configuredTo || providerEmail(payload, actionConfig);
      const recipients = to.split(/[;,]/).map((item) => item.trim()).filter(Boolean);
      if (!recipients.length || recipients.some((recipient) => !/^\S+@\S+\.\S+$/.test(recipient))) throw new Error("Gmail needs a valid recipient mapping.");
      const safeHeader = (value: unknown) => String(value || "").replace(/[\r\n]+/g, " ").trim();
      const subject = safeHeader(resolveProviderTemplate(String(actionConfig.subject || "Workspace update"), payload) || "Workspace update");
      const html = resolveProviderTemplate(String(actionConfig.html || actionConfig.message || ""), payload).trim();
      if (!html) throw new Error("Gmail needs an HTML message.");
      const cc = safeHeader(resolveProviderTemplate(String(actionConfig.cc || ""), payload));
      const bcc = safeHeader(resolveProviderTemplate(String(actionConfig.bcc || ""), payload));
      const replyTo = safeHeader(resolveProviderTemplate(String(actionConfig.replyTo || ""), payload));
      const headers = [
        `To: ${recipients.join(", ")}`,
        cc ? `Cc: ${cc}` : "",
        bcc ? `Bcc: ${bcc}` : "",
        replyTo ? `Reply-To: ${replyTo}` : "",
        `Subject: ${subject}`,
        "MIME-Version: 1.0",
        "Content-Type: text/html; charset=UTF-8",
      ].filter(Boolean).join("\r\n");
      const raw = Buffer.from(`${headers}\r\n\r\n${html}`, "utf8").toString("base64url");
      return fetchJson("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ raw }),
      });
    }
    const spreadsheetId = String(actionConfig.spreadsheetId || "");
    const sheetName = String(actionConfig.sheetName || "Responses");
    if (!spreadsheetId) throw new Error("Select a Google spreadsheet");
    const range = encodeURIComponent(
      operation === "update_row"
        ? String(actionConfig.range || "")
        : `'${sheetName}'!A:ZZ`,
    );
    if (operation === "update_row" && !String(actionConfig.range || "")) {
      throw new Error("Choose a row range to update");
    }
    return fetchJson(
      operation === "update_row"
        ? `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}?valueInputOption=USER_ENTERED`
        : `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: operation === "update_row" ? "PUT" : "POST",
        headers: authHeaders,
        body: JSON.stringify({ values: [orderedAnswerValues(payload)] }),
      },
    );
  }
  if (connection.provider === "airtable") {
    const baseId = String(actionConfig.baseId || "");
    const tableId = String(actionConfig.tableId || "");
    if (!baseId || !tableId) throw new Error("Select an Airtable base and table");
    const recordId = String(actionConfig.recordId || "");
    if (operation === "update_record" && !recordId) {
      throw new Error("Choose an Airtable record to update");
    }
    return fetchJson(
      `https://api.airtable.com/v0/${encodeURIComponent(baseId)}/${encodeURIComponent(tableId)}${
        operation === "update_record"
          ? `/${encodeURIComponent(recordId)}`
          : ""
      }`,
      {
        method: operation === "update_record" ? "PATCH" : "POST",
        headers: authHeaders,
        body: JSON.stringify(
          operation === "update_record"
            ? { fields: answersByLabel(payload) }
            : { records: [{ fields: answersByLabel(payload) }] },
        ),
      },
    );
  }
  if (connection.provider === "hubspot") {
    const email = providerEmail(payload, actionConfig);
    if (!email) throw new Error("No email answer was available");
    const fullName = configuredAnswer(
      payload,
      actionConfig,
      "fullNameFieldId",
      (field) => /full.?name|name/i.test(field.label),
    );
    const phone = configuredAnswer(
      payload,
      actionConfig,
      "phoneFieldId",
      (field) => field.type === "phone" || /phone/i.test(field.label),
    );
    const company = configuredAnswer(
      payload,
      actionConfig,
      "companyFieldId",
      (field) => /company|organization|organisation/i.test(field.label),
    );
    const [firstname = "", ...lastNameParts] = fullName.split(/\s+/);
    const properties = Object.fromEntries(
      Object.entries({
        email,
        firstname,
        lastname: lastNameParts.join(" "),
        phone,
        company,
      }).filter(([, value]) => Boolean(value)),
    );
    if (operation === "create_contact") {
      return fetchJson("https://api.hubapi.com/crm/v3/objects/contacts", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ properties }),
      });
    }
    const search = await fetchJson(
      "https://api.hubapi.com/crm/v3/objects/contacts/search",
      {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          filterGroups: [
            {
              filters: [
                {
                  propertyName: "email",
                  operator: "EQ",
                  value: email,
                },
              ],
            },
          ],
          limit: 1,
        }),
      },
    );
    const existing = Array.isArray(search.results)
      ? (search.results[0] as Record<string, unknown> | undefined)
      : undefined;
    if (existing?.id) {
      return fetchJson(
        `https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(String(existing.id))}`,
        {
          method: "PATCH",
          headers: authHeaders,
          body: JSON.stringify({ properties }),
        },
      );
    }
    if (operation === "update_contact") {
      throw new Error("No matching HubSpot contact was found");
    }
    return fetchJson("https://api.hubapi.com/crm/v3/objects/contacts", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ properties }),
    });
  }
  if (connection.provider === "mailchimp") {
    const audienceId = String(actionConfig.audienceId || "");
    const dataCenter = String(connection.configuration.dataCenter || "");
    const email = providerEmail(payload, actionConfig);
    if (!audienceId || !dataCenter || !email) {
      throw new Error("Choose an audience and map an email field");
    }
    const fullName = configuredAnswer(
      payload,
      actionConfig,
      "fullNameFieldId",
      (field) => /full.?name|name/i.test(field.label),
    );
    const [firstName = "", ...lastNameParts] = fullName.split(/\s+/);
    const subscriberHash = createHash("md5")
      .update(email.toLowerCase())
      .digest("hex");
    const subscriber = await fetchJson(
      `https://${dataCenter}.api.mailchimp.com/3.0/lists/${encodeURIComponent(audienceId)}/members/${subscriberHash}`,
      {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({
          email_address: email,
          status_if_new: "subscribed",
          merge_fields: {
            FNAME: firstName,
            LNAME: lastNameParts.join(" "),
          },
        }),
      },
    );
    if (operation !== "add_tags") return subscriber;
    const tags = String(actionConfig.tags || "")
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    if (tags.length === 0) throw new Error("Add at least one subscriber tag");
    const tagResult = await fetchJson(
      `https://${dataCenter}.api.mailchimp.com/3.0/lists/${encodeURIComponent(audienceId)}/members/${subscriberHash}/tags`,
      {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          tags: tags.map((name) => ({ name, status: "active" })),
        }),
      },
    );
    return { subscriber, tags: tagResult };
  }
  if (connection.provider === "dropbox") {
    const path = resolveProviderTemplate(String(actionConfig.path || ""), payload).trim();
    if (!path || !path.startsWith("/")) throw new Error("Dropbox needs an absolute file or folder path.");
    if (operation === "create_folder") {
      return fetchJson("https://api.dropboxapi.com/2/files/create_folder_v2", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ path, autorename: false }),
      });
    }
    const content = resolveProviderTemplate(String(actionConfig.content || ""), payload);
    if (!content) throw new Error("Dropbox needs file content to upload.");
    return fetchJson("https://content.dropboxapi.com/2/files/upload", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": JSON.stringify({ path, mode: "add", autorename: true, mute: false, strict_conflict: false }),
      },
      body: content,
    });
  }
  if (connection.provider !== "notion") {
    throw new Error("This provider action is not supported by the workflow adapter yet.");
  }
  const content = JSON.stringify(answersByLabel(payload), null, 2).slice(
    0,
    1900,
  );
  const children = [
    {
      object: "block",
      type: "code",
      code: {
        language: "json",
        rich_text: [
          {
            type: "text",
            text: { content },
          },
        ],
      },
    },
  ];
  if (operation === "append_content") {
    const pageId = String(actionConfig.pageId || "");
    if (!pageId) throw new Error("Select a Notion page");
    return fetchJson(
      `https://api.notion.com/v1/blocks/${encodeURIComponent(pageId)}/children`,
      {
        method: "PATCH",
        headers: {
          ...authHeaders,
          "Notion-Version": "2026-03-11",
        },
        body: JSON.stringify({ children }),
      },
    );
  }
  const databaseId = String(actionConfig.databaseId || "");
  if (!databaseId) throw new Error("Select a Notion data source");
  const pageTitle =
    resolveProviderTemplate(
      String(actionConfig.pageTitle || "{{form.title}} response"),
      payload,
    ) || `${String(form.title || "Form")} response`;
  const notionHeaders = {
    ...authHeaders,
    "Notion-Version": "2026-03-11",
  };
  const dataSource = await fetchJson(
    `https://api.notion.com/v1/data_sources/${encodeURIComponent(databaseId)}`,
    { headers: notionHeaders },
  );
  const properties = (dataSource.properties || {}) as Record<
    string,
    unknown
  >;
  const titleProperty =
    Object.entries(properties).find(
      ([, property]) =>
        property &&
        typeof property === "object" &&
        (property as Record<string, unknown>).type === "title",
    )?.[0] || "Name";
  return fetchJson("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: notionHeaders,
    body: JSON.stringify({
      parent: { data_source_id: databaseId },
      properties: {
        [titleProperty]: {
          title: [
            {
              text: {
                content: pageTitle,
              },
            },
          ],
        },
      },
      children,
    }),
  });
};

/**
 * Workflow bridge for connected applications. It deliberately reuses the
 * same encrypted credential refresh and provider action implementation as the
 * Forms automation engine; workflow runs never receive the token material.
 */
export async function executeAutomationProviderAction(input: {
  workspaceId: string;
  connectionId: string;
  actionConfig: Record<string, unknown>;
  payload: Record<string, unknown>;
}) {
  const connection = await connectionForRequest(input.connectionId, input.workspaceId);
  return executeProviderAction(connection, input.actionConfig, input.payload);
}

const handleTest = async (
  request: IncomingMessage,
  response: ServerResponse,
  connectionId: string,
) => {
  const sql = sqlClient();
  const userId = await authenticatedUserId(request);
  try {
    const connection = await connectionForRequest(connectionId, userId);
    await testProviderConnection(connection);
    await sql`
      UPDATE automation_connections
      SET status = 'connected',
          last_tested_at = NOW(),
          last_error = NULL,
          updated_at = NOW()
      WHERE id = ${connectionId}
        AND user_id = ${userId}
    `;
    json(response, 200, { connected: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Connection failed";
    await sql`
      UPDATE automation_connections
      SET status = 'error',
          last_tested_at = NOW(),
          last_error = ${message},
          updated_at = NOW()
      WHERE id = ${connectionId}
        AND user_id = ${userId}
    `;
    json(response, 502, {
      connected: false,
      error: "We could not verify this connection. Reconnect it and try again.",
    });
  }
};

export async function executeFormAutomationProviderAction(input: {
  actionId: string;
  connectionId: string;
  formId: string;
  submissionId: string;
}) {
  const connectionId = String(input.connectionId || "");
  const actionId = String(input.actionId || "");
  const formId = String(input.formId || "");
  const submissionId = String(input.submissionId || "");
  if (!connectionId || !actionId || !formId || !submissionId) {
    throw new Error("Invalid automation request");
  }
  const sql = sqlClient();
  const rows = await sql`
      SELECT connection.id,
             connection.provider,
             connection.configuration,
             connection.credentials_encrypted,
             connection.token_expires_at,
             action.configuration AS action_configuration,
             form.id AS form_id,
             form.title AS form_title,
             form.slug AS form_slug,
             form.fields AS form_fields,
             submission.id AS submission_id,
             submission.submitted_at,
             COALESCE(
               (
                 SELECT jsonb_object_agg(answer.field_id, answer.answer)
                 FROM form_submission_answers answer
                 WHERE answer.submission_id = submission.id
               ),
               submission.data - '_meta',
               '{}'::jsonb
             ) AS answers
      FROM automation_connections connection
      JOIN workflow_actions action
        ON action.connection_id = connection.id
      JOIN workflows workflow
        ON workflow.id = action.workflow_id
      JOIN forms form
        ON form.id = workflow.form_id
       AND form.created_by = connection.user_id
      JOIN form_submissions submission
        ON submission.form_id = form.id
      WHERE connection.id = ${connectionId}
        AND action.id = ${actionId}
        AND form.id = ${formId}
        AND submission.id = ${submissionId}
        AND connection.auth_type = 'oauth'
        AND connection.status <> 'disabled'
        AND workflow.enabled = TRUE
        AND action.enabled = TRUE
      LIMIT 1
    `;
  if (rows.length !== 1) throw new Error("Automation request was not found");
  const row = rows[0] as Record<string, unknown>;
  const rawFields = Array.isArray(row.form_fields) ? row.form_fields : [];
  const fields = rawFields
    .filter(
      (field): field is Record<string, unknown> =>
        Boolean(field && typeof field === "object" && !Array.isArray(field)),
    )
    .map((field) => ({
      id: String(field.id || ""),
      label: String(field.label || ""),
      type: String(field.type || ""),
    }));
  const payload = {
    event: "maxform.form_submitted",
    form: {
      id: String(row.form_id || ""),
      slug: String(row.form_slug || ""),
      title: String(row.form_title || ""),
    },
    fields,
    submission: {
      id: String(row.submission_id || ""),
      submittedAt: String(row.submitted_at || ""),
    },
    answers:
      row.answers && typeof row.answers === "object" ? row.answers : {},
  };
  const connection = {
    id: String(row.id || ""),
    provider: String(row.provider || "") as ProviderKey,
    configuration:
      row.configuration && typeof row.configuration === "object"
        ? (row.configuration as Record<string, unknown>)
        : {},
    credentials_encrypted: String(row.credentials_encrypted || ""),
    token_expires_at: row.token_expires_at
      ? String(row.token_expires_at)
      : null,
  } satisfies ConnectionRow;
  return executeProviderAction(
    connection,
    row.action_configuration &&
      typeof row.action_configuration === "object"
      ? (row.action_configuration as Record<string, unknown>)
      : {},
    payload,
  );
}

const handleExecute = async (
  request: IncomingMessage,
  response: ServerResponse,
) => {
  try {
    const body = await readBody(request);
    const result = await executeFormAutomationProviderAction({
      connectionId: String(body.connectionId || ""),
      actionId: String(body.actionId || ""),
      formId: String(body.formId || ""),
      submissionId: String(body.submissionId || ""),
    });
    json(response, 200, { ok: true, result });
  } catch (error) {
    json(response, 502, {
      ok: false,
      error: "The connected app could not complete this action.",
    });
  }
};

export async function handleIntegrationOAuth(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const url = new URL(request.url || "/", requestOrigin(request));
  const action = url.searchParams.get("action") || "providers";
  try {
    if (action === "providers") {
      handleProviders(response);
      return;
    }
    if (action === "prepare" && request.method === "POST") {
      await handlePrepare(request, response);
      return;
    }
    if (action === "start") {
      await handleStart(request, response, url);
      return;
    }
    if (action === "callback") {
      await handleCallback(request, response, url);
      return;
    }
    if (action === "test") {
      await handleTest(
        request,
        response,
        url.searchParams.get("connectionId") || "",
      );
      return;
    }
    if (action === "resources") {
      await handleResources(request, response, url);
      return;
    }
    if (action === "execute" && request.method === "POST") {
      await handleExecute(request, response);
      return;
    }
    json(response, 404, { error: "OAuth action was not found" });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      json(response, 401, {
        error: "Sign in again to continue.",
      });
      return;
    }
    json(response, 500, {
      error: "The integration could not complete this request.",
    });
  }
}

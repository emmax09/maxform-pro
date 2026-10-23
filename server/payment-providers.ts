import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { neon } from "@neondatabase/serverless";
import { jwtVerify } from "jose";
import { configuredAppUrl } from "./app-url";
import { refreshCampaignMetrics } from "./campaign-analytics-engine";
import { sendEventRefundEmailsNow } from "./event-mail";
import { workspaceScopeFor } from "./workspace-access";
import { dispatchWorkspaceWorkflowEvent } from "./workflows-data";

type PaymentProvider = "stripe" | "paypal" | "paystack" | "opay";
type CredentialRecord = Record<string, string>;

type ConnectionRow = {
  id: string;
  provider: PaymentProvider;
  credentials_encrypted: string;
  external_account_id: string;
  external_account_name: string;
  credential_hint: string;
  is_default: boolean;
  status: string;
  health_ok: boolean;
  last_checked_at: string | null;
  last_error: string;
  connected_at: string;
};

class RequestError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "payment_provider_error",
  ) {
    super(message);
  }
}

const databaseUrl = () => process.env.DATABASE_URL || "";

const sqlClient = () => {
  const url = databaseUrl();
  if (!url) {
    throw new RequestError(
      "Payments are temporarily unavailable. Please try again later.",
      503,
      "payments_unavailable",
    );
  }
  return neon(url);
};

const jwtSigningSecret = () => {
  const secret = process.env.JWT_SECRET || "";
  if (secret.length < 32) {
    throw new RequestError(
      "Payments are temporarily unavailable. Please try again later.",
      503,
      "payments_unavailable",
    );
  }
  return new TextEncoder().encode(secret);
};

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
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  );
  response.end(JSON.stringify(value));
};

const requestOrigin = (request: IncomingMessage) => {
  const configured = configuredAppUrl();
  if (configured) {
    try {
      const url = new URL(configured);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error();
      return url.origin;
    } catch {
      throw new RequestError(
        "Payments are temporarily unavailable. Please try again later.",
        503,
      );
    }
  }
  if (process.env.NODE_ENV === "production") {
    throw new RequestError(
      "Payments are temporarily unavailable. Please try again later.",
      503,
    );
  }
  const forwardedProto = String(
    request.headers["x-forwarded-proto"] || "",
  ).split(",")[0];
  const protocol =
    forwardedProto ||
    (request.socket && "encrypted" in request.socket ? "https" : "http");
  const host = String(
    request.headers["x-forwarded-host"] ||
      request.headers.host ||
      "localhost:8080",
  ).split(",")[0];
  return `${protocol}://${host}`;
};

const callbackUrl = (request: IncomingMessage, provider: PaymentProvider) => {
  const base = configuredAppUrl() || requestOrigin(request);
  return `${base}/api/payments/providers?action=callback&provider=${provider}`;
};

const connectionResultPage = (
  request: IncomingMessage,
  response: ServerResponse,
  status: "connected" | "cancelled" | "error",
  provider: string,
) => {
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
    <title>MaxForm payments</title>
    <style>
      body{margin:0;background:#fff;color:#18181b;font:14px system-ui,sans-serif}
      main{min-height:100vh;display:grid;place-items:center;padding:32px;box-sizing:border-box;text-align:center}
      p{color:#71717a;line-height:1.6}
    </style>
  </head>
  <body>
    <main><div><strong>Returning to MaxForm</strong><p>This window will close automatically.</p></div></main>
    <script>
      if (window.opener) window.opener.postMessage(${payload}, ${JSON.stringify(requestOrigin(request))});
      window.close();
    </script>
  </body>
</html>`);
};

const authenticatedUserId = async (request: IncomingMessage) => {
  const authorization = String(request.headers.authorization || "");
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  if (!token) {
    throw new RequestError(
      "Please sign in again to manage payment providers.",
      401,
      "authentication_required",
    );
  }
  try {
    const { payload } = await jwtVerify(token, jwtSigningSecret(), {
      audience: "maxform-dashboard",
      issuer: "maxform",
    });
    const userId = String(payload.userId || "");
    if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("Missing user");
    // The workspace this request acts in. Identical to the signed-in id
    // for a workspace owner; an added member resolves to the workspace
    // they belong to, so every query below reads the same rows.
    return workspaceScopeFor(userId);
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(
      "Your session has expired. Sign in and try again.",
      401,
      "authentication_required",
    );
  }
};

const readBody = async (request: IncomingMessage) => {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) {
      throw new RequestError("This payment request is too large.", 413);
    }
  }
  if (!body) return {} as Record<string, unknown>;
  try {
    const value = JSON.parse(body);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Expected a JSON object");
    }
    return value as Record<string, unknown>;
  } catch {
    throw new RequestError("The payment request could not be read.");
  }
};

const readRawBody = async (request: IncomingMessage) => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > 1_000_000) {
      throw new RequestError("This payment callback is too large.", 413);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
};

const safeEqual = (left: string, right: string) => {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(left.toLowerCase());
  const rightBuffer = Buffer.from(right.toLowerCase());
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
};

const isProvider = (value: string): value is PaymentProvider =>
  ["stripe", "paypal", "paystack", "opay"].includes(value);

const encryptionKeys = () => {
  const secrets = [
    process.env.PAYMENT_ENCRYPTION_KEY || "",
    process.env.INTEGRATION_ENCRYPTION_KEY || "",
  ].filter(
    (secret, index, values) =>
      secret.length >= 24 && values.indexOf(secret) === index,
  );
  if (secrets.length === 0) {
    throw new RequestError(
      "Secure payment connections are temporarily unavailable.",
      503,
      "encryption_unavailable",
    );
  }
  return secrets.map((secret) =>
    createHash("sha256").update(secret).digest(),
  );
};

const encryptionKey = () => encryptionKeys()[0];

const encryptCredentials = (credentials: CredentialRecord) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(credentials), "utf8"),
    cipher.final(),
  ]);
  return [
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
};

const decryptCredentials = (value: string): CredentialRecord => {
  const [iv, tag, encrypted] = value.split(".");
  if (!iv || !tag || !encrypted) {
    throw new RequestError("This provider needs to be connected again.", 409);
  }
  for (const key of encryptionKeys()) {
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(iv, "base64url"),
      );
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      const result = Buffer.concat([
        decipher.update(Buffer.from(encrypted, "base64url")),
        decipher.final(),
      ]);
      return JSON.parse(result.toString("utf8")) as CredentialRecord;
    } catch {
      // Continue through keys retained only for credential rotation.
    }
  }
  throw new RequestError("This provider needs to be connected again.", 409);
};

const providerTimeoutMs = () => {
  const configured = Number(process.env.PAYMENT_PROVIDER_TIMEOUT_MS || 12_000);
  return Math.max(
    3_000,
    Math.min(30_000, Number.isFinite(configured) ? configured : 12_000),
  );
};

const fetchRecord = async (
  url: string,
  init?: RequestInit,
): Promise<Record<string, unknown>> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), providerTimeoutMs());
  let response: Response;
  let text = "";
  try {
    response = await fetch(url, {
      ...init,
      redirect: "error",
      signal: controller.signal,
    });
    text = await response.text();
  } catch {
    throw new RequestError(
      "The payment provider is temporarily unavailable. Please try again.",
      503,
      "provider_network_unreachable",
    );
  } finally {
    clearTimeout(timeout);
  }
  let value: Record<string, unknown> = {};
  try {
    value = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    value = {};
  }
  if (!response.ok) {
    throw new RequestError(
      "The provider could not verify this request. Check the account and try again.",
      503,
      "provider_verification_failed",
    );
  }
  return value;
};

const providerConfigured = (provider: PaymentProvider) => {
  const secureBase = Boolean(databaseUrl()) && (() => {
    try {
      encryptionKey();
      return true;
    } catch {
      return false;
    }
  })();
  if (!secureBase) return false;
  if (provider === "stripe") {
    return Boolean(process.env.STRIPE_CONNECT_CLIENT_ID && process.env.STRIPE_SECRET_KEY);
  }
  if (provider === "paypal") {
    return Boolean(
      process.env.PAYPAL_CLIENT_ID &&
        process.env.PAYPAL_CLIENT_SECRET &&
        process.env.PAYPAL_PARTNER_MERCHANT_ID,
    );
  }
  return true;
};

const paypalBaseUrl = () =>
  (process.env.PAYMENT_MODE || process.env.PAYPAL_MODE) === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

const paypalAccessToken = async () => {
  const clientId = process.env.PAYPAL_CLIENT_ID || "";
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET || "";
  const value = await fetchRecord(`${paypalBaseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });
  const token = String(value.access_token || "");
  if (!token) {
    throw new RequestError(
      "PayPal is temporarily unavailable. Please try again later.",
      503,
    );
  }
  return token;
};

const paypalAssertion = (merchantId: string) => {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString(
    "base64url",
  );
  const payload = Buffer.from(
    JSON.stringify({
      iss: process.env.PAYPAL_CLIENT_ID || "",
      payer_id: merchantId,
    }),
  ).toString("base64url");
  return `${header}.${payload}.`;
};

const mapConnection = (row: ConnectionRow) => ({
  id: row.id,
  provider: row.provider,
  authType:
    row.provider === "stripe" || row.provider === "paypal"
      ? "oauth"
      : "api_key",
  status: row.status,
  externalAccountId: row.external_account_id,
  externalAccountName: row.external_account_name,
  credentialHint: row.credential_hint,
  isDefault: row.is_default,
  healthOk: row.health_ok,
  lastCheckedAt: row.last_checked_at || "",
  lastError: row.last_error,
  connectedAt: row.connected_at,
});

const saveConnection = async (
  userId: string,
  provider: PaymentProvider,
  credentials: CredentialRecord,
  identity: { id: string; name: string; hint: string },
) => {
  const sql = sqlClient();
  const encrypted = encryptCredentials(credentials);
  const rows = await sql`
    INSERT INTO payment_provider_connections (
      user_id, provider, auth_type, status, external_account_id,
      external_account_name, credentials_encrypted, credential_hint,
      is_default, health_ok, last_checked_at, last_error, connected_at,
      created_at, updated_at
    )
    VALUES (
      ${userId}, ${provider},
      ${provider === "stripe" || provider === "paypal" ? "oauth" : "api_key"},
      'connected', ${identity.id}, ${identity.name}, ${encrypted},
      ${identity.hint},
      NOT EXISTS (
        SELECT 1 FROM payment_provider_connections
        WHERE user_id = ${userId} AND status = 'connected'
      ),
      TRUE, NOW(), '', NOW(), NOW(), NOW()
    )
    ON CONFLICT (user_id, provider)
    DO UPDATE SET
      auth_type = EXCLUDED.auth_type,
      status = 'connected',
      external_account_id = EXCLUDED.external_account_id,
      external_account_name = EXCLUDED.external_account_name,
      credentials_encrypted = EXCLUDED.credentials_encrypted,
      credential_hint = EXCLUDED.credential_hint,
      health_ok = TRUE,
      last_checked_at = NOW(),
      last_error = '',
      connected_at = NOW(),
      updated_at = NOW()
    RETURNING id, provider, credentials_encrypted, external_account_id,
      external_account_name, credential_hint, is_default, status, health_ok,
      last_checked_at, last_error, connected_at
  `;
  return mapConnection(rows[0] as ConnectionRow);
};

const connectionForUser = async (
  userId: string,
  provider: PaymentProvider,
) => {
  const sql = sqlClient();
  const rows = await sql`
    SELECT id, provider, credentials_encrypted, external_account_id,
      external_account_name, credential_hint, is_default, status, health_ok,
      last_checked_at, last_error, connected_at
    FROM payment_provider_connections
    WHERE user_id = ${userId}
      AND provider = ${provider}
      AND status <> 'disconnected'
    LIMIT 1
  `;
  if (rows.length !== 1) {
    throw new RequestError(
      "Connect this provider before using it for payments.",
      404,
      "provider_not_connected",
    );
  }
  return rows[0] as ConnectionRow;
};

export const verifyPaystack = async (credentials: CredentialRecord) => {
  const publicKey = String(credentials.publicKey || "").trim();
  const secretKey = String(credentials.secretKey || "").trim();
  if (!/^pk_(test|live)_/.test(publicKey) || !/^sk_(test|live)_/.test(secretKey)) {
    throw new RequestError(
      "These Paystack keys do not look valid. Check both keys and try again.",
      422,
    );
  }
  if (publicKey.includes("_live_") !== secretKey.includes("_live_")) {
    throw new RequestError(
      "Use Paystack keys from the same environment.",
      422,
    );
  }
  const value = await fetchRecord(
    "https://api.paystack.co/transaction/totals",
    { headers: { Authorization: `Bearer ${secretKey}` } },
  );
  if (value.status !== true) {
    throw new RequestError(
      "Paystack could not verify these keys. Check the account and try again.",
      422,
    );
  }
  return {
    credentials: { publicKey, secretKey },
    identity: {
      id: createHash("sha256").update(publicKey).digest("hex").slice(0, 20),
      name: "Paystack merchant",
      hint: `${publicKey.slice(0, 12)}...${publicKey.slice(-4)}`,
    },
  };
};

const verifyOpay = (credentials: CredentialRecord) => {
  const merchantId = String(credentials.merchantId || "").trim();
  const publicKey = String(credentials.publicKey || "").trim();
  const secretKey = String(credentials.secretKey || "").trim();
  const country = String(credentials.country || "NG").trim().toUpperCase();
  if (!merchantId || !publicKey || !secretKey) {
    throw new RequestError("Complete all OPay merchant fields.", 422);
  }
  if (
    !/^OPAYPUB/i.test(publicKey) ||
    !/^OPAYPRV/i.test(secretKey) ||
    !/^[A-Z]{2}$/.test(country)
  ) {
    throw new RequestError(
      "These OPay merchant details do not look valid. Copy the public and secret keys from your OPay dashboard.",
      422,
    );
  }
  return {
    credentials: { merchantId, publicKey, secretKey, country },
    identity: {
      id: merchantId,
      name: `OPay ${merchantId}`,
      hint: `Merchant ${merchantId.slice(-6).padStart(6, "•")}`,
    },
  };
};

const checkHealth = async (
  provider: PaymentProvider,
  credentials: CredentialRecord,
) => {
  if (provider === "stripe") {
    const value = await fetchRecord("https://api.stripe.com/v1/account", {
      headers: { Authorization: `Bearer ${credentials.accessToken || ""}` },
    });
    return Boolean(value.id);
  }
  if (provider === "paypal") {
    const token = await paypalAccessToken();
    const partnerId = process.env.PAYPAL_PARTNER_MERCHANT_ID || "";
    const value = await fetchRecord(
      `${paypalBaseUrl()}/v1/customer/partners/${encodeURIComponent(partnerId)}/merchant-integrations/${encodeURIComponent(credentials.merchantId || "")}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    return Boolean(
      value.payments_receivable === true &&
        value.primary_email_confirmed === true,
    );
  }
  if (provider === "paystack") {
    const value = await fetchRecord(
      "https://api.paystack.co/transaction/totals",
      {
        headers: {
          Authorization: `Bearer ${credentials.secretKey || ""}`,
        },
      },
    );
    return value.status === true;
  }
  verifyOpay(credentials);
  return true;
};

const handleProviders = async (
  request: IncomingMessage,
  response: ServerResponse,
) => {
  await authenticatedUserId(request);
  json(response, 200, {
    providers: {
      stripe: { configured: providerConfigured("stripe") },
      paypal: { configured: providerConfigured("paypal") },
      paystack: { configured: providerConfigured("paystack") },
      opay: { configured: providerConfigured("opay") },
    },
  });
};

const handlePrepare = async (
  request: IncomingMessage,
  response: ServerResponse,
) => {
  const userId = await authenticatedUserId(request);
  const body = await readBody(request);
  const provider = String(body.provider || "");
  if (provider !== "stripe" && provider !== "paypal") {
    throw new RequestError("This provider does not use account authorization.");
  }
  if (!providerConfigured(provider)) {
    throw new RequestError(
      `${provider === "stripe" ? "Stripe" : "PayPal"} connection is temporarily unavailable.`,
      503,
      "provider_unavailable",
    );
  }
  const sql = sqlClient();
  const state = randomUUID();
  await sql`
    DELETE FROM payment_provider_oauth_states
    WHERE user_id = ${userId} AND expires_at <= NOW()
  `;
  await sql`
    INSERT INTO payment_provider_oauth_states (
      state, user_id, provider, expires_at
    )
    VALUES (${state}, ${userId}, ${provider}, NOW() + INTERVAL '10 minutes')
  `;

  if (provider === "stripe") {
    const authorize = new URL("https://connect.stripe.com/oauth/authorize");
    authorize.searchParams.set("response_type", "code");
    authorize.searchParams.set(
      "client_id",
      process.env.STRIPE_CONNECT_CLIENT_ID || "",
    );
    authorize.searchParams.set("scope", "read_write");
    authorize.searchParams.set("state", state);
    authorize.searchParams.set("redirect_uri", callbackUrl(request, provider));
    json(response, 200, { authorizationUrl: authorize.toString() });
    return;
  }

  const accessToken = await paypalAccessToken();
  const referral = await fetchRecord(
    `${paypalBaseUrl()}/v2/customer/partner-referrals`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tracking_id: state,
        partner_config_override: {
          return_url: `${callbackUrl(request, provider)}&state=${encodeURIComponent(state)}`,
          return_url_description: "Return to MaxForm",
        },
        operations: [
          {
            operation: "API_INTEGRATION",
            api_integration_preference: {
              rest_api_integration: {
                integration_method: "PAYPAL",
                integration_type: "THIRD_PARTY",
                third_party_details: {
                  features: ["PAYMENT", "REFUND"],
                },
              },
            },
          },
        ],
        products: ["EXPRESS_CHECKOUT"],
        legal_consents: [
          {
            type: "SHARE_DATA_CONSENT",
            granted: true,
          },
        ],
      }),
    },
  );
  const links = Array.isArray(referral.links)
    ? (referral.links as Array<Record<string, unknown>>)
    : [];
  const action = links.find((link) => link.rel === "action_url");
  const authorizationUrl = String(action?.href || "");
  if (!authorizationUrl) {
    throw new RequestError(
      "PayPal connection is temporarily unavailable.",
      503,
    );
  }
  json(response, 200, { authorizationUrl });
};

const handleCallback = async (
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
) => {
  const providerValue = url.searchParams.get("provider") || "";
  const state = url.searchParams.get("state") || "";
  if (
    (providerValue !== "stripe" && providerValue !== "paypal") ||
    !state
  ) {
    connectionResultPage(request, response, "error", providerValue);
    return;
  }
  const provider = providerValue as "stripe" | "paypal";
  const sql = sqlClient();
  const states = await sql`
    DELETE FROM payment_provider_oauth_states
    WHERE state = ${state}
      AND provider = ${provider}
      AND expires_at > NOW()
    RETURNING user_id
  `;
  if (states.length !== 1) {
    connectionResultPage(request, response, "error", provider);
    return;
  }
  const userId = String(states[0].user_id || "");
  try {
    if (url.searchParams.get("error")) {
      connectionResultPage(request, response, "cancelled", provider);
      return;
    }

    if (provider === "stripe") {
      const code = url.searchParams.get("code") || "";
      if (!code) {
        connectionResultPage(request, response, "cancelled", provider);
        return;
      }
      const token = await fetchRecord("https://connect.stripe.com/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_secret: process.env.STRIPE_SECRET_KEY || "",
          code,
        }),
      });
      const accessToken = String(token.access_token || "");
      const stripeUserId = String(token.stripe_user_id || "");
      if (!accessToken || !stripeUserId) throw new Error("Missing Stripe account");
      const account = await fetchRecord("https://api.stripe.com/v1/account", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const business = (account.business_profile || {}) as Record<
        string,
        unknown
      >;
      await saveConnection(
        userId,
        provider,
        {
          accessToken,
          refreshToken: String(token.refresh_token || ""),
          stripeUserId,
        },
        {
          id: stripeUserId,
          name: String(
            business.name ||
              account.business_name ||
              account.email ||
              `Stripe ${stripeUserId}`,
          ),
          hint: String(account.email || stripeUserId),
        },
      );
    } else {
      const merchantId = String(
        url.searchParams.get("merchantIdInPayPal") ||
          url.searchParams.get("merchantId") ||
          url.searchParams.get("payerId") ||
          "",
      );
      if (!merchantId) {
        connectionResultPage(request, response, "cancelled", provider);
        return;
      }
      const token = await paypalAccessToken();
      const partnerId = process.env.PAYPAL_PARTNER_MERCHANT_ID || "";
      const status = await fetchRecord(
        `${paypalBaseUrl()}/v1/customer/partners/${encodeURIComponent(partnerId)}/merchant-integrations/${encodeURIComponent(merchantId)}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const products = Array.isArray(status.products)
        ? status.products.map(String)
        : [];
      if (!products.includes("EXPRESS_CHECKOUT")) {
        throw new Error("PayPal onboarding incomplete");
      }
      await saveConnection(
        userId,
        provider,
        { merchantId },
        {
          id: merchantId,
          name: `PayPal ${merchantId}`,
          hint: `Merchant ${merchantId.slice(-6)}`,
        },
      );
    }
    connectionResultPage(request, response, "connected", provider);
  } catch {
    connectionResultPage(request, response, "error", provider);
  }
};

const handleConnectKey = async (
  request: IncomingMessage,
  response: ServerResponse,
) => {
  const userId = await authenticatedUserId(request);
  const body = await readBody(request);
  const provider = String(body.provider || "");
  const credentials =
    body.credentials && typeof body.credentials === "object"
      ? (body.credentials as CredentialRecord)
      : {};
  if (provider !== "paystack" && provider !== "opay") {
    throw new RequestError("This provider uses secure account authorization.");
  }
  const verified =
    provider === "paystack"
      ? await verifyPaystack(credentials)
      : verifyOpay(credentials);
  const connection = await saveConnection(
    userId,
    provider,
    verified.credentials,
    verified.identity,
  );
  json(response, 200, { connection });
};

const handleHealth = async (
  request: IncomingMessage,
  response: ServerResponse,
) => {
  const userId = await authenticatedUserId(request);
  const body = await readBody(request);
  const providerValue = String(body.provider || "");
  if (!isProvider(providerValue)) {
    throw new RequestError("Choose a valid payment provider.");
  }
  const connection = await connectionForUser(userId, providerValue);
  let ok = false;
  let lastError = "";
  try {
    ok = await checkHealth(
      providerValue,
      decryptCredentials(connection.credentials_encrypted),
    );
  } catch {
    ok = false;
    // Do not persist or expose a provider's raw response. It can contain
    // account identifiers or implementation details.
    lastError = "Provider verification failed";
  }
  const sql = sqlClient();
  await sql`
    UPDATE payment_provider_connections
    SET health_ok = ${ok},
        status = ${ok ? "connected" : "attention"},
        last_checked_at = NOW(),
        last_error = ${ok ? "" : lastError || "Provider verification failed"},
        updated_at = NOW()
    WHERE id = ${connection.id} AND user_id = ${userId}
  `;
  json(response, 200, {
    health: {
      ok,
      checkedAt: new Date().toISOString(),
      error: ok ? "" : lastError || "Provider verification failed",
    },
  });
};

const handleDisconnect = async (
  request: IncomingMessage,
  response: ServerResponse,
) => {
  const userId = await authenticatedUserId(request);
  const body = await readBody(request);
  const providerValue = String(body.provider || "");
  if (!isProvider(providerValue)) {
    throw new RequestError("Choose a valid payment provider.");
  }
  const connection = await connectionForUser(userId, providerValue);
  const sql = sqlClient();
  const activity = await sql`
    SELECT
      (
        SELECT COUNT(*)::int
        FROM payment_subscriptions
        WHERE user_id = ${userId}
          AND provider_connection_id = ${connection.id}
          AND status IN ('trialing', 'active', 'past_due', 'paused')
      ) AS subscriptions,
      (
        SELECT COUNT(*)::int
        FROM checkout_attempts
        WHERE user_id = ${userId}
          AND provider = ${providerValue}
          AND status IN ('pending', 'redirected', 'processing')
      ) AS checkouts
  `;
  const blocked =
    Number(activity[0]?.subscriptions || 0) +
    Number(activity[0]?.checkouts || 0);
  if (blocked > 0) {
    throw new RequestError(
      "This provider still has active billing or a payment in progress. Resolve it before disconnecting.",
      409,
      "provider_in_use",
    );
  }

  if (providerValue === "stripe") {
    try {
      const credentials = decryptCredentials(connection.credentials_encrypted);
      await fetch("https://connect.stripe.com/oauth/deauthorize", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: process.env.STRIPE_CONNECT_CLIENT_ID || "",
          stripe_user_id: credentials.stripeUserId || "",
          client_secret: process.env.STRIPE_SECRET_KEY || "",
        }),
      });
    } catch {
      // Local access is revoked even if the remote deauthorization is delayed.
    }
  }
  await sql`
    UPDATE payment_provider_connections
    SET status = 'disconnected',
        is_default = FALSE,
        health_ok = FALSE,
        updated_at = NOW()
    WHERE id = ${connection.id} AND user_id = ${userId}
  `;
  await sql`
    UPDATE payment_provider_connections
    SET is_default = TRUE, updated_at = NOW()
    WHERE id = (
      SELECT id
      FROM payment_provider_connections
      WHERE user_id = ${userId}
        AND status = 'connected'
        AND health_ok = TRUE
      ORDER BY connected_at
      LIMIT 1
    )
      AND NOT EXISTS (
        SELECT 1
        FROM payment_provider_connections
        WHERE user_id = ${userId}
          AND status = 'connected'
          AND is_default = TRUE
      )
  `;
  await sql`
    UPDATE form_settings settings
    SET lifecycle = 'paused', updated_at = NOW()
    FROM forms form
    WHERE form.id = settings.form_id
      AND form.created_by = ${userId}
      AND form.status = 'published'
      AND COALESCE(
        (settings.live_snapshot->'payment'->>'enabled')::boolean,
        (settings.payment->>'enabled')::boolean,
        FALSE
      ) = TRUE
      AND (
        COALESCE(
          settings.live_snapshot->'payment'->>'provider',
          settings.payment->>'provider',
          'workspace'
        ) = ${providerValue}
        OR (
          COALESCE(
            settings.live_snapshot->'payment'->>'provider',
            settings.payment->>'provider',
            'workspace'
          ) = 'workspace'
          AND NOT EXISTS (
            SELECT 1
            FROM payment_provider_connections remaining
            WHERE remaining.user_id = ${userId}
              AND remaining.status = 'connected'
              AND remaining.health_ok = TRUE
          )
        )
      )
  `;
  json(response, 200, { disconnected: true });
};

const sendRefund = (
  response: ServerResponse,
  status: number,
  refund: Record<string, unknown>,
) => {
  json(response, status, {
    refund: {
      id: refund.id,
      orderId: refund.order_id,
      orderNumber: refund.order_number,
      provider: refund.provider,
      amount: Number(refund.amount || 0),
      currency: refund.currency,
      reason: refund.reason,
      status: refund.status,
      restockInventory: refund.restock_inventory !== false,
      inventoryRestockedAt: refund.inventory_restocked_at || "",
      failureReason:
        refund.status === "failed"
          ? "The provider could not complete this refund."
          : "",
      requestedAt: refund.requested_at,
      completedAt: refund.completed_at || "",
    },
  });
};

type RefundItemRequest = {
  orderItemId: string;
  quantity: number;
};

const refundItemRequests = (value: unknown): RefundItemRequest[] => {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 100) {
    throw new RequestError("Choose valid refund items.");
  }
  const quantities = new Map<string, number>();
  for (const entry of value) {
    const item = entry && typeof entry === "object"
      ? entry as Record<string, unknown>
      : {};
    const orderItemId = String(item.orderItemId || "");
    const quantity = Number(item.quantity);
    if (!/^[0-9a-f-]{36}$/i.test(orderItemId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 10_000) {
      throw new RequestError("Choose valid refund items.");
    }
    quantities.set(orderItemId, (quantities.get(orderItemId) || 0) + quantity);
  }
  return [...quantities.entries()].map(([orderItemId, quantity]) => ({
    orderItemId,
    quantity,
  }));
};

const syncRefundToCrm = async (refundId: string) => {
  const sql = sqlClient();
  await sql`
    WITH refund_record AS (
      SELECT refund.*, payment_order.contact_id,
        payment_order.order_number
      FROM payment_refunds refund
      JOIN payment_orders payment_order ON payment_order.id = refund.order_id
      WHERE refund.id = ${refundId}
        AND payment_order.contact_id IS NOT NULL
      LIMIT 1
    ),
    saved_activity AS (
      INSERT INTO contact_activity (
        id, contact_id, user_id, activity_type, title, detail, entity_type,
        entity_id, metadata, created_at
      )
      SELECT refund_record.id, refund_record.contact_id,
        refund_record.user_id, 'payment_refund',
        CASE refund_record.status
          WHEN 'failed' THEN 'Payment refund failed'
          WHEN 'succeeded' THEN 'Payment refunded'
          ELSE 'Payment refund requested'
        END,
        CONCAT(
          refund_record.order_number,
          ' · ',
          refund_record.currency,
          ' ',
          refund_record.amount,
          CASE
            WHEN TRIM(refund_record.reason) = '' THEN ''
            ELSE ' · ' || refund_record.reason
          END
        ),
        'payment_refund', refund_record.id,
        jsonb_build_object(
          'amount', refund_record.amount,
          'currency', refund_record.currency,
          'orderId', refund_record.order_id,
          'provider', refund_record.provider,
          'refundId', refund_record.id,
          'status', refund_record.status
        ),
        refund_record.requested_at
      FROM refund_record
      ON CONFLICT (id) DO UPDATE SET
        activity_type = EXCLUDED.activity_type,
        title = EXCLUDED.title,
        detail = EXCLUDED.detail,
        metadata = EXCLUDED.metadata
      RETURNING contact_id, created_at
    )
    UPDATE contacts contact
    SET last_activity_at = GREATEST(
          contact.last_activity_at,
          saved_activity.created_at
        ),
        updated_at = NOW()
    FROM saved_activity
    WHERE contact.id = saved_activity.contact_id
  `;
  const completed = await sql`
    SELECT refund.id, refund.user_id, refund.order_id, refund.amount,
           refund.currency, refund.status, payment_order.order_number
    FROM payment_refunds refund
    JOIN payment_orders payment_order ON payment_order.id = refund.order_id
    WHERE refund.id = ${refundId} AND refund.status = 'succeeded'
    LIMIT 1
  `;
  const refund = completed[0] as Record<string, unknown> | undefined;
  if (refund) {
    void dispatchWorkspaceWorkflowEvent(
      String(refund.user_id || ""),
      "refund_issued",
      {
        id: String(refund.id || ""),
        refundId: String(refund.id || ""),
        orderId: String(refund.order_id || ""),
        orderNumber: String(refund.order_number || ""),
        amount: Number(refund.amount || 0),
        currency: String(refund.currency || ""),
        status: String(refund.status || "succeeded"),
      },
      `refund_issued:${String(refund.id || "")}`,
    ).catch(() => undefined);
  }
};

const reconcileEventRefund = async (
  sql: ReturnType<typeof sqlClient>,
  orderId: string,
  refundId: string,
  notify: boolean,
) => {
  const orders = await sql`
    SELECT payment_order.id, payment_order.user_id, payment_order.status,
      payment_order.source_type, payment_order.source_id
    FROM payment_orders payment_order
    WHERE payment_order.id = ${orderId}
      AND payment_order.source_type = 'event'
    LIMIT 1
  `;
  const order = orders[0] as Record<string, unknown> | undefined;
  if (!order) return;
  const eventId = String(order.source_id || "");
  if (!eventId) return;
  if (String(order.status) === "refunded") {
    // A fully refunded event order must not remain scannable. The event order
    // is the bridge between the payment order and every issued ticket.
    await sql`
      UPDATE event_orders event_order
      SET status = 'refunded', updated_at = NOW()
      FROM payments payment
      WHERE payment.id = event_order.payment_id
        AND payment.order_id = ${orderId}
        AND event_order.event_id = ${eventId}
    `;
    await sql`
      UPDATE event_attendees attendee
      SET ticket_status = 'refunded', ticket_code = NULL, updated_at = NOW()
      FROM event_orders event_order
      JOIN payments payment ON payment.id = event_order.payment_id
      WHERE attendee.order_id = event_order.id
        AND payment.order_id = ${orderId}
        AND attendee.event_id = ${eventId}
        AND attendee.ticket_status IN ('valid', 'transferred')
    `;
    void dispatchWorkspaceWorkflowEvent(
      String(order.user_id || ""),
      "event_registration_cancelled",
      { id: orderId, orderId, eventId, refundId, reason: "order_refunded" },
      `event_registration_cancelled:${orderId}`,
    ).catch(() => undefined);
  }
  if (notify) {
    void sendEventRefundEmailsNow(eventId, orderId, refundId).catch(() => undefined);
  }
};

const refreshAttributedCampaign = async (
  sql: ReturnType<typeof sqlClient>,
  orderId: string,
) => {
  const rows = await sql`
    SELECT user_id, source_campaign_id
    FROM payment_orders
    WHERE id = ${orderId}
      AND source_campaign_id IS NOT NULL
    LIMIT 1
  `;
  const row = rows[0] as Record<string, unknown> | undefined;
  if (row?.source_campaign_id && row.user_id) {
    await refreshCampaignMetrics(
      sql,
      String(row.user_id),
      String(row.source_campaign_id),
    );
  }
};

const handleRefund = async (
  request: IncomingMessage,
  response: ServerResponse,
) => {
  const userId = await authenticatedUserId(request);
  const body = await readBody(request);
  const orderId = String(body.orderId || "");
  const reason = String(body.reason || "").trim().slice(0, 500);
  const amount = Math.round(Number(body.amount || 0) * 100) / 100;
  const idempotencyKey = String(body.idempotencyKey || "");
  const requestedRefundItems = refundItemRequests(body.items);
  const restockRequested = body.restockInventory !== false;
  if (
    !/^[0-9a-f-]{36}$/i.test(orderId) ||
    !reason ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !/^[0-9a-f-]{36}$/i.test(idempotencyKey)
  ) {
    throw new RequestError("Enter a valid refund amount and reason.");
  }
  const sql = sqlClient();
  const existing = await sql`
    SELECT refund.*, payment_order.order_number
    FROM payment_refunds refund
    JOIN payment_orders payment_order ON payment_order.id = refund.order_id
    WHERE refund.user_id = ${userId}
      AND refund.idempotency_key = ${idempotencyKey}::uuid
    LIMIT 1
  `;
  if (existing[0]) {
    await syncRefundToCrm(String(existing[0].id));
    if (existing[0].status === "succeeded") {
      await reconcileEventRefund(sql, orderId, String(existing[0].id), true);
      await refreshAttributedCampaign(sql, orderId);
    }
    sendRefund(
      response,
      existing[0].status === "processing" ? 202 : 200,
      existing[0] as Record<string, unknown>,
    );
    return;
  }
  const orderPreview = await sql`
    SELECT total_amount, refunded_amount
    FROM payment_orders
    WHERE id = ${orderId} AND user_id = ${userId}
    LIMIT 1
  `;
  if (!orderPreview[0]) {
    throw new RequestError("This order could not be found.", 404);
  }
  const refundableAmount = Math.max(
    0,
    Number(orderPreview[0].total_amount || 0) -
      Number(orderPreview[0].refunded_amount || 0),
  );
  let refundItems = requestedRefundItems;
  // A full refund restocks every remaining catalog line by default. Partial
  // refunds only restock when the caller explicitly supplies line quantities.
  if (
    restockRequested &&
    refundItems.length === 0 &&
    Math.abs(amount - refundableAmount) <= 0.01
  ) {
    const itemRows = await sql`
      SELECT id, GREATEST(quantity - refunded_quantity, 0)::integer AS quantity
      FROM payment_order_items
      WHERE order_id = ${orderId}
        AND product_id IS NOT NULL
        AND quantity > refunded_quantity
    `;
    refundItems = itemRows.map((row) => ({
      orderItemId: String(row.id),
      quantity: Number(row.quantity || 0),
    })).filter((item) => item.quantity > 0);
  }
  const restockInventory = restockRequested && refundItems.length > 0;
  const refundId = randomUUID();
  const reserved = await sql`
    SELECT maxform_reserve_payment_refund(
      ${userId}::uuid,
      ${orderId}::uuid,
      ${refundId}::uuid,
      ${idempotencyKey}::uuid,
      ${amount},
      ${reason},
      ${JSON.stringify(refundItems)}::jsonb,
      ${restockInventory}
    ) AS reserved
  `;
  if (reserved[0]?.reserved !== true) {
    throw new RequestError(
      "This order does not have enough refundable balance.",
      409,
      "refund_unavailable",
    );
  }
  const orders = await sql`
    SELECT payment_order.id, payment_order.order_number,
      payment_order.provider, payment_order.provider_reference,
      payment_order.total_amount, payment_order.refunded_amount,
      payment_order.currency, refund.requested_at
    FROM payment_orders payment_order
    JOIN payment_refunds refund
      ON refund.order_id = payment_order.id
     AND refund.id = ${refundId}
    WHERE payment_order.id = ${orderId}
      AND payment_order.user_id = ${userId}
    LIMIT 1
  `;
  if (orders.length !== 1) {
    throw new RequestError("This refund could not be prepared.", 409);
  }
  const order = orders[0] as Record<string, unknown>;
  const providerValue = String(order.provider || "");
  if (!isProvider(providerValue) || !order.provider_reference) {
    await sql`
      SELECT maxform_release_payment_refund(${refundId}::uuid)
    `;
    throw new RequestError("This order does not have a refundable payment.");
  }
  const providerReference = String(order.provider_reference);
  let providerRefundId = "";
  let providerStatus = "succeeded";

  try {
    const connection = await connectionForUser(userId, providerValue);
    const credentials = decryptCredentials(connection.credentials_encrypted);
    if (providerValue === "stripe") {
    const value = await fetchRecord("https://api.stripe.com/v1/refunds", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.accessToken || ""}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": refundId,
      },
      body: new URLSearchParams({
        payment_intent: providerReference,
        amount: String(Math.round(amount * 100)),
        reason: "requested_by_customer",
        "metadata[maxform_reason]": reason.slice(0, 450),
      }),
    });
    providerRefundId = String(value.id || "");
    providerStatus =
      String(value.status || "") === "succeeded" ? "succeeded" : "processing";
    } else if (providerValue === "paystack") {
    const value = await fetchRecord("https://api.paystack.co/refund", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.secretKey || ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        transaction: providerReference,
        amount: Math.round(amount * 100),
        currency: String(order.currency || "USD"),
        customer_note: reason,
        merchant_note: `MaxForm ${String(order.order_number || "")}`,
      }),
    });
    const data = (value.data || {}) as Record<string, unknown>;
    providerRefundId = String(data.id || data.refund_reference || "");
    providerStatus = "processing";
    } else if (providerValue === "paypal") {
    const token = await paypalAccessToken();
    const value = await fetchRecord(
      `${paypalBaseUrl()}/v2/payments/captures/${encodeURIComponent(providerReference)}/refund`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "PayPal-Auth-Assertion": paypalAssertion(
            credentials.merchantId || "",
          ),
          "PayPal-Request-Id": refundId,
        },
        body: JSON.stringify({
          amount: {
            value: amount.toFixed(2),
            currency_code: String(order.currency || "USD"),
          },
          note_to_payer: reason.slice(0, 255),
        }),
      },
    );
    providerRefundId = String(value.id || "");
    providerStatus =
      String(value.status || "") === "COMPLETED" ? "succeeded" : "processing";
    } else {
    const reference = `RF-${refundId.replace(/-/g, "").slice(0, 18)}`;
    const refundBody = {
      amount: {
        currency: String(order.currency || "NGN"),
        total: Math.round(amount * 100),
      },
      callbackUrl: `${requestOrigin(request)}/api/payments/providers?action=opay-refund-callback`,
      country: credentials.country || "NG",
      originalReference: providerReference,
      reference,
      refundWay: "Original",
    };
    const signature = createHmac("sha512", credentials.secretKey || "")
      .update(JSON.stringify(refundBody))
      .digest("hex");
    const opayBase =
      process.env.PAYMENT_MODE === "live"
        ? "https://liveapi.opaycheckout.com"
        : "https://testapi.opaycheckout.com";
    const value = await fetchRecord(
      `${opayBase}/api/v1/international/payment/refund/create`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${signature}`,
          "Content-Type": "application/json",
          MerchantId: credentials.merchantId || "",
        },
        body: JSON.stringify(refundBody),
      },
    );
    if (String(value.code || "") !== "00000") {
      throw new RequestError(
        "OPay could not start this refund. Check the merchant account and try again.",
        422,
      );
    }
    const data = (value.data || {}) as Record<string, unknown>;
    providerRefundId = String(data.reference || reference);
    providerStatus =
      String(data.orderStatus || "") === "SUCCESS"
        ? "succeeded"
        : "processing";
    }
  } catch (error) {
    if (error instanceof RequestError) {
      await sql`
        SELECT maxform_release_payment_refund(${refundId}::uuid)
      `;
      await syncRefundToCrm(refundId);
      throw error;
    }
    await sql`
      UPDATE payment_refunds
      SET status = 'processing', updated_at = NOW()
      WHERE id = ${refundId} AND status = 'pending'
    `;
    const pending = await sql`
      SELECT refund.*, payment_order.order_number
      FROM payment_refunds refund
      JOIN payment_orders payment_order ON payment_order.id = refund.order_id
      WHERE refund.id = ${refundId}
      LIMIT 1
    `;
    await syncRefundToCrm(refundId);
    sendRefund(response, 202, pending[0] as Record<string, unknown>);
    return;
  }

  const completedAt = providerStatus === "succeeded" ? new Date() : null;
  const refunds = await sql`
    UPDATE payment_refunds
    SET provider_refund_id = ${providerRefundId},
        status = ${providerStatus},
        completed_at = ${completedAt},
        updated_at = NOW()
    WHERE id = ${refundId} AND user_id = ${userId}
    RETURNING *
  `;
  await syncRefundToCrm(refundId);
  if (providerStatus === "succeeded") {
    await sql`SELECT maxform_restock_payment_inventory(${refundId}::uuid)`;
    await reconcileEventRefund(sql, orderId, refundId, true);
    await refreshAttributedCampaign(sql, orderId);
  }
  sendRefund(
    response,
    providerStatus === "processing" ? 202 : 200,
    {
      ...(refunds[0] as Record<string, unknown>),
      order_number: order.order_number,
    },
  );
};

export const finalizePaymentRefund = async (input: {
  failureReason?: string;
  providerRefundId?: string;
  refundId: string;
  status: "failed" | "succeeded";
}) => {
  const sql = sqlClient();
  if (input.status === "succeeded") {
    const rows = await sql`
      UPDATE payment_refunds
      SET status = 'succeeded',
          provider_refund_id = COALESCE(NULLIF(${input.providerRefundId || ""}, ''), provider_refund_id),
          completed_at = COALESCE(completed_at, NOW()),
          updated_at = NOW()
      WHERE id = ${input.refundId}
        AND status IN ('pending', 'processing')
      RETURNING order_id
    `;
    if (rows.length > 0) {
      await sql`SELECT maxform_restock_payment_inventory(${input.refundId}::uuid)`;
      await reconcileEventRefund(
        sql,
        String(rows[0].order_id || ""),
        input.refundId,
        true,
      );
      await refreshAttributedCampaign(sql, String(rows[0].order_id || ""));
    }
  } else {
    await sql`SELECT maxform_release_payment_refund(${input.refundId}::uuid)`;
    await sql`
      UPDATE payment_refunds
      SET failure_reason = LEFT(NULLIF(${input.failureReason || ""}, ''), 500),
          updated_at = NOW()
      WHERE id = ${input.refundId} AND status = 'failed'
    `;
  }
  await syncRefundToCrm(input.refundId);
};

const handleOpayRefundCallback = async (
  request: IncomingMessage,
  response: ServerResponse,
) => {
  const rawBody = await readRawBody(request);
  let event: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Expected an object");
    }
    event = parsed as Record<string, unknown>;
  } catch {
    throw new RequestError("The OPay refund callback could not be read.", 400);
  }
  const payload =
    event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
      ? event.payload as Record<string, unknown>
      : event;
  const references = [
    payload.reference,
    payload.refundReference,
    payload.refundId,
    payload.orderNo,
    payload.transactionId,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index);
  if (references.length === 0) {
    throw new RequestError("The OPay refund reference is missing.", 400);
  }
  const sql = sqlClient();
  const rows = await sql.query(
    `SELECT refund.id, refund.provider_refund_id, refund.user_id,
            payment_order.provider_reference, connection.credentials_encrypted
     FROM payment_refunds refund
     JOIN payment_orders payment_order ON payment_order.id = refund.order_id
     JOIN payment_provider_connections connection
       ON connection.user_id = refund.user_id
      AND connection.provider = 'opay'
     WHERE refund.provider = 'opay'
       AND (
         refund.provider_refund_id = ANY($1::text[])
         OR payment_order.provider_reference = ANY($1::text[])
       )
     ORDER BY refund.requested_at DESC
     LIMIT 1`,
    [references],
  );
  // Providers may retry callbacks after a refund is already deleted or
  // reconciled. A verified-looking but unknown callback is acknowledged so
  // the provider does not retry forever; it cannot mutate workspace data.
  if (rows.length !== 1) {
    json(response, 200, { received: true });
    return;
  }
  const refund = rows[0] as Record<string, unknown>;
  const credentials = decryptCredentials(String(refund.credentials_encrypted));
  const canonical = `{Amount:"${String(payload.amount || "")}",Currency:"${String(
    payload.currency || "",
  )}",Reference:"${String(payload.reference || "")}",Refunded:${
    payload.refunded === true || String(payload.refunded || "").toLowerCase() === "true"
      ? "t"
      : "f"
  },Status:"${String(payload.status || "")}",Timestamp:"${String(
    payload.timestamp || "",
  )}",Token:"${String(payload.token || "")}",TransactionID:"${String(
    payload.transactionId || "",
  )}"}`;
  const expected = createHmac("sha3-512", credentials.secretKey || "")
    .update(canonical)
    .digest("hex");
  if (!safeEqual(expected, String(event.sha512 || ""))) {
    throw new RequestError("Callback verification failed.", 401);
  }
  const eventId = String(
    event.id ||
      `${references[0]}:refund:${String(payload.timestamp || "")}`,
  );
  const inserted = await sql`
    INSERT INTO webhook_events (
      user_id, provider, provider_event_id, event_type, processing_status,
      processed_at, created_at
    ) VALUES (
      ${String(refund.user_id)}, 'opay', ${eventId}, 'refund', 'received',
      NOW(), NOW()
    )
    ON CONFLICT (provider, provider_event_id) DO UPDATE
    SET processing_status = 'received', processed_at = NOW()
    WHERE webhook_events.processing_status IN ('received', 'failed')
    RETURNING id
  `;
  if (inserted.length === 0) {
    json(response, 200, { received: true });
    return;
  }
  const status = String(
    payload.status || payload.refundStatus || payload.orderStatus || "",
  ).toLowerCase();
  const succeeded =
    payload.refunded === true ||
    String(payload.refunded || "").toLowerCase() === "true" ||
    /success|succeed|completed|complete|processed|refunded/.test(status);
  const failed = /failed|fail|reject|declin|cancel/.test(status);
  if (succeeded) {
    await finalizePaymentRefund({
      providerRefundId: String(
        payload.refundReference || payload.refundId || payload.reference || references[0],
      ),
      refundId: String(refund.id),
      status: "succeeded",
    });
  } else if (failed) {
    await finalizePaymentRefund({
      failureReason: "OPay rejected the refund.",
      refundId: String(refund.id),
      status: "failed",
    });
  }
  await sql`
    UPDATE webhook_events
    SET processing_status = ${succeeded || failed ? "processed" : "ignored"},
        processed_at = NOW()
    WHERE id = ${String(inserted[0].id)}
  `;
  json(response, 200, { received: true });
};

const handleCancelSubscription = async (
  request: IncomingMessage,
  response: ServerResponse,
) => {
  const userId = await authenticatedUserId(request);
  const body = await readBody(request);
  const subscriptionId = String(body.subscriptionId || "");
  if (!subscriptionId) {
    throw new RequestError("Choose a subscription to cancel.");
  }
  const sql = sqlClient();
  const rows = await sql`
    SELECT subscription.id, subscription.provider_subscription_id,
      connection.provider, connection.credentials_encrypted
    FROM payment_subscriptions subscription
    JOIN payment_provider_connections connection
      ON connection.id = subscription.provider_connection_id
    WHERE subscription.id = ${subscriptionId}
      AND subscription.user_id = ${userId}
      AND subscription.status IN ('trialing', 'active', 'past_due', 'paused')
    LIMIT 1
  `;
  if (rows.length !== 1) {
    throw new RequestError(
      "This subscription is no longer available to cancel.",
      404,
    );
  }
  const subscription = rows[0] as Record<string, unknown>;
  const provider = String(subscription.provider || "") as PaymentProvider;
  const providerSubscriptionId = String(
    subscription.provider_subscription_id || "",
  );
  if (!providerSubscriptionId || provider === "opay") {
    throw new RequestError(
      "This subscription cannot be changed through its payment provider.",
      409,
    );
  }
  const credentials = decryptCredentials(
    String(subscription.credentials_encrypted),
  );
  if (provider === "stripe") {
    await fetchRecord(
      `https://api.stripe.com/v1/subscriptions/${encodeURIComponent(providerSubscriptionId)}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${credentials.accessToken || ""}`,
        },
      },
    );
  } else if (provider === "paypal") {
    const token = await paypalAccessToken();
    await fetchRecord(
      `${paypalBaseUrl()}/v1/billing/subscriptions/${encodeURIComponent(providerSubscriptionId)}/cancel`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "PayPal-Auth-Assertion": paypalAssertion(
            credentials.merchantId || "",
          ),
        },
        body: JSON.stringify({ reason: "Cancelled by the workspace owner" }),
      },
    );
  } else {
    const fetched = await fetchRecord(
      `https://api.paystack.co/subscription/${encodeURIComponent(providerSubscriptionId)}`,
      {
        headers: {
          Authorization: `Bearer ${credentials.secretKey || ""}`,
        },
      },
    );
    const providerData = (fetched.data || {}) as Record<string, unknown>;
    const token = String(providerData.email_token || "");
    if (!token) {
      throw new RequestError(
        "Paystack could not authorize this subscription change.",
        409,
      );
    }
    await fetchRecord("https://api.paystack.co/subscription/disable", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.secretKey || ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        code: providerSubscriptionId,
        token,
      }),
    });
  }
  await sql`
    UPDATE payment_subscriptions
    SET status = 'cancelled',
        cancelled_at = NOW(),
        cancel_at_period_end = FALSE,
        updated_at = NOW()
    WHERE id = ${subscriptionId} AND user_id = ${userId}
  `;
  json(response, 200, { cancelled: true });
};

export async function handlePaymentProviders(
  request: IncomingMessage,
  response: ServerResponse,
) {
  try {
    const url = new URL(
      request.url || "/",
      `${requestOrigin(request)}/api/payments/providers`,
    );
    const action = url.searchParams.get("action") || "providers";
    if (action === "opay-refund-callback" && request.method === "POST") {
      await handleOpayRefundCallback(request, response);
      return;
    }
    if (action === "callback") {
      await handleCallback(request, response, url);
      return;
    }
    if (action === "providers" && request.method === "GET") {
      await handleProviders(request, response);
      return;
    }
    if (action === "prepare" && request.method === "POST") {
      await handlePrepare(request, response);
      return;
    }
    if (action === "connect-key" && request.method === "POST") {
      await handleConnectKey(request, response);
      return;
    }
    if (action === "health" && request.method === "POST") {
      await handleHealth(request, response);
      return;
    }
    if (action === "disconnect" && request.method === "POST") {
      await handleDisconnect(request, response);
      return;
    }
    if (action === "refund" && request.method === "POST") {
      await handleRefund(request, response);
      return;
    }
    if (action === "cancel-subscription" && request.method === "POST") {
      await handleCancelSubscription(request, response);
      return;
    }
    json(response, 404, { error: "This payment action is not available." });
  } catch (error) {
    if (error instanceof RequestError) {
      json(response, error.status, { error: error.message, code: error.code });
      return;
    }
    const unexpectedCode =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code || "unknown")
        : "unknown";
    console.error("[payment-providers] unexpected request failure", {
      code: unexpectedCode,
      type: error instanceof Error ? error.name : typeof error,
    });
    json(response, 500, {
      error: "Payments could not be updated right now. Please try again.",
      code: "payment_provider_error",
    });
  }
}

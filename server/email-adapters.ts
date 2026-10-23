import {
  createHash,
  createHmac,
} from "node:crypto";

import nodemailer from "nodemailer";

export type EmailProviderId =
  | "mock"
  | "tosend"
  | "resend"
  | "sender"
  | "smtp"
  | "sendgrid"
  | "postmark"
  | "mailgun"
  | "ses";

export type EmailProviderCredentials = Record<string, string>;

export type ProviderAddress = {
  name?: string;
  email: string;
};

export type ProviderSendInput = {
  from: ProviderAddress;
  replyTo?: string;
  to: string;
  recipientName?: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
  /** Internal correlation only. Providers do not provide idempotency. */
  messageHash?: string;
  tags?: Record<string, string>;
};

export type ProviderSendResult = {
  messageId: string;
  response: Record<string, unknown>;
};

export type ProviderBatchItemResult =
  | {
      ok: true;
      messageId: string;
      response: Record<string, unknown>;
    }
  | {
      ok: false;
      error: string;
      code: string;
      retryable: boolean;
      response: Record<string, unknown>;
    };

export type ProviderBatchSendResult = {
  results: ProviderBatchItemResult[];
  response: Record<string, unknown>;
  status: number;
};

export type ProviderSendingLimits = {
  maxPerSecond: number;
  maxPerHour?: number | null;
  maxBatchSize?: number | null;
  accountStatus?: string;
  creditBalance?: number | null;
  monthlyEmailLimit?: number | null;
  refreshedAt: string;
};

export type ProviderValidationMode = "api" | "delivery";

export type ProviderStatus = {
  healthy: boolean;
  validationMode: ProviderValidationMode;
  checkedAt: string;
};

export type ProviderDnsRecord = {
  type: string;
  name: string;
  value: string;
  priority?: number | null;
};

export type ProviderSendingDomain = {
  id: string;
  domain: string;
  status: "pending" | "verified" | "failed" | "unknown";
  records: ProviderDnsRecord[];
  raw?: Record<string, unknown>;
};

export class EmailAdapterError extends Error {
  constructor(
    message: string,
    readonly provider: EmailProviderId,
    readonly status = 502,
    readonly code = "provider_request_failed",
    readonly retryable = false,
    readonly detail = message,
  ) {
    super(message);
    this.name = "EmailAdapterError";
  }
}

export interface EmailProviderAdapter {
  readonly provider: EmailProviderId;
  connectCredentials(credentials: EmailProviderCredentials): Promise<ProviderStatus>;
  validateCredentials(credentials: EmailProviderCredentials): Promise<void>;
  sendEmail(credentials: EmailProviderCredentials, input: ProviderSendInput): Promise<ProviderSendResult>;
  sendBatch?(credentials: EmailProviderCredentials, inputs: ProviderSendInput[]): Promise<ProviderBatchSendResult>;
  getProviderStatus(credentials: EmailProviderCredentials): Promise<ProviderStatus>;
  getSendingLimits?(credentials: EmailProviderCredentials, options?: { forceRefresh?: boolean }): Promise<ProviderSendingLimits>;
  getSendingDomains(credentials: EmailProviderCredentials): Promise<ProviderSendingDomain[]>;
  verifyDomain(credentials: EmailProviderCredentials, domain: string): Promise<ProviderSendingDomain>;
  addDomain?(credentials: EmailProviderCredentials, domain: string): Promise<ProviderSendingDomain>;
}

const clean = (value: unknown, max = 2_000) => String(value ?? "").trim().slice(0, max);
const validEmail = (value: string) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value) && !/[\r\n]/.test(value);
const validDomain = (value: string) => /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value);
const providerTimeout = () => {
  const configured = Number(process.env.EMAIL_PROVIDER_TIMEOUT_MS || 12_000);
  return Math.max(3_000, Math.min(30_000, Number.isFinite(configured) ? configured : 12_000));
};

const extractMessage = (value: Record<string, unknown>) => {
  const nested = value.error && typeof value.error === "object" && !Array.isArray(value.error)
    ? value.error as Record<string, unknown>
    : {};
  return clean(
    value.message || value.error || value.detail || nested.message || nested.detail || value.error_type,
    1_000,
  );
};

const providerError = (provider: EmailProviderId, status: number, message: string, retryable = false) => {
  const normalized = message.toLowerCase();
  const invalidCredentials = status === 401 || /invalid api key|api key is missing|credentials? invalid/.test(normalized);
  const insufficientCredits = /insufficient credit|credit balance|monthly email limit/.test(normalized);
  const domainError = /domain (?:is )?(?:not verified|not allowed|not found)|sender domain/.test(normalized);
  return new EmailAdapterError(
    message || (retryable ? "The email provider is temporarily unavailable." : "The email provider rejected this request."),
    provider,
    status,
    invalidCredentials
      ? "provider_credentials_invalid"
      : insufficientCredits
        ? "provider_insufficient_credits"
        : domainError
          ? "sender_domain_unverified"
          : status === 403 && /paused|suspended|disabled/.test(normalized)
            ? "provider_account_paused"
            : "provider_request_failed",
    retryable,
    message,
  );
};

const requestJson = async (
  provider: EmailProviderId,
  url: string,
  init: RequestInit = {},
) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), providerTimeout());
  try {
    const response = await fetch(url, {
      ...init,
      redirect: "error",
      signal: controller.signal,
    });
    const body = await response.text();
    let value: Record<string, unknown> = {};
    if (body) {
      try {
        const parsed = JSON.parse(body) as unknown;
        if (Array.isArray(parsed)) value = { data: parsed };
        else if (parsed && typeof parsed === "object") value = parsed as Record<string, unknown>;
      } catch {
        if (!response.ok) value = { message: body.slice(0, 1_000) };
      }
    }
    if (!response.ok) {
      throw providerError(provider, response.status, extractMessage(value), response.status === 429 || response.status >= 500);
    }
    return { value, headers: response.headers, status: response.status };
  } catch (error) {
    if (error instanceof EmailAdapterError) throw error;
    throw new EmailAdapterError(
      "The email provider could not be reached.",
      provider,
      502,
      "provider_network_error",
      true,
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    clearTimeout(timeout);
  }
};

const requireCredential = (provider: EmailProviderId, credentials: EmailProviderCredentials, key: string, label = key) => {
  const value = clean(credentials[key], 2_000);
  if (!value) throw new EmailAdapterError(`${label} is required.`, provider, 400, "invalid_provider_credentials");
  return value;
};

const normaliseDomainStatus = (value: unknown): ProviderSendingDomain["status"] => {
  const status = clean(value, 80).toLowerCase();
  if (/verified|active|valid|success|successfully/.test(status)) return "verified";
  if (/fail|invalid|error|reject/.test(status)) return "failed";
  if (/pending|process|wait|new|created|not[_ -]?started|unverified/.test(status)) return "pending";
  return "unknown";
};

const recordList = (value: unknown): ProviderDnsRecord[] => {
  const values = Array.isArray(value)
    ? value
    : value && typeof value === "object" && !Array.isArray(value)
      ? Object.values(value as Record<string, unknown>)
      : [];
  return values.flatMap((record) => {
    const item = record && typeof record === "object" && !Array.isArray(record)
      ? record as Record<string, unknown>
      : {};
    const hasRecordFields = Boolean(item.type || item.record_type || item.recordType || item.name || item.host || item.hostname || item.value || item.data || item.target);
    if (!hasRecordFields) return [];
    return [{
      type: clean(item.type || item.record_type || item.recordType || item.record, 40).toUpperCase(),
      name: clean(item.name || item.host || item.hostname || item.record_name || item.recordName, 255),
      value: clean(item.value || item.data || item.target || item.record_value || item.recordValue, 2_000),
      priority: item.priority == null ? null : Number(item.priority),
    }];
  }).filter((record) => record.name && record.value);
};

const normaliseDomain = (value: unknown, fallback = ""): ProviderSendingDomain => {
  const item = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const domain = clean(
    item.domain || item.name || item.Domain || item.domain_name || item.domainName || fallback,
    255,
  ).toLowerCase();
  const records = recordList(item.records || item.dns_records || item.dnsRecords || item.dns || item.verification_records);
  const postmarkVerified = item.SPFVerified === true && item.DKIMVerified === true;
  const verifiedFlag = item.verified === true
    || item.is_verified === true
    || item.isVerified === true
    || item.valid === true
    || item.VerifiedForSendingStatus === true
    || postmarkVerified
    || clean(item.DkimVerificationStatus || item.DKIMVerificationStatus, 40).toUpperCase() === "SUCCESS";
  const dkim = item.DkimAttributes && typeof item.DkimAttributes === "object" && !Array.isArray(item.DkimAttributes)
    ? item.DkimAttributes as Record<string, unknown>
    : {};
  const tokens = Array.isArray(dkim.Tokens) ? dkim.Tokens.map((token) => clean(token, 255)).filter(Boolean) : [];
  const dkimRecords = tokens.map((token) => ({
    type: "CNAME",
    name: `${token}._domainkey.${domain}`,
    value: `${token}.dkim.amazonses.com`,
  }));
  return {
    id: clean(item.id || item.uuid || item.domain_id || item.domainId, 160) || domain,
    domain,
    status: verifiedFlag
      ? "verified"
      : normaliseDomainStatus(
          item.status ||
            item.state ||
            item.verification_status ||
            item.verificationStatus ||
            (item.SPFVerified === true || item.DKIMVerified === true ? "pending" : item.verified || item.is_verified),
        ),
    records: records.length ? records : dkimRecords,
    raw: item,
  };
};

const normaliseDomains = (value: Record<string, unknown>): ProviderSendingDomain[] => {
  const candidates = Array.isArray(value.data)
    ? value.data
    : Array.isArray(value.domains)
      ? value.domains
      : Array.isArray(value.results)
        ? value.results
        : Array.isArray(value.items)
          ? value.items
          : Array.isArray(value.Domains)
            ? value.Domains
            : Array.isArray(value.Identities)
              ? value.Identities
              : Array.isArray(value.EmailIdentities)
                ? value.EmailIdentities
                : [];
  return candidates.map((item) => normaliseDomain(item, typeof item === "string" ? item : "")).filter((domain) => domain.domain);
};

const formatFrom = (from: ProviderAddress) => from.name ? `${from.name} <${from.email}>` : from.email;

const smtpTransport = (credentials: EmailProviderCredentials) => {
  const port = Number(credentials.port || 587);
  const host = requireCredential("smtp", credentials, "host", "SMTP host");
  const username = requireCredential("smtp", credentials, "username", "SMTP username");
  const password = requireCredential("smtp", credentials, "password", "SMTP password");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new EmailAdapterError("Enter a valid SMTP port.", "smtp", 400, "invalid_provider_credentials");
  }
  return nodemailer.createTransport({
    host,
    port,
    secure: credentials.encryption === "TLS",
    requireTLS: credentials.encryption === "STARTTLS",
    auth: { user: username, pass: password },
    connectionTimeout: providerTimeout(),
    greetingTimeout: providerTimeout(),
    socketTimeout: providerTimeout(),
  });
};

const hmac = (key: Buffer | string, value: string) => createHmac("sha256", key).update(value, "utf8").digest();
const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const canonicalHeader = (name: string, value: string) => `${name}:${value.trim().replace(/\s+/g, " ")}\n`;

const sesRequest = async (
  credentials: EmailProviderCredentials,
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
) => {
  const region = requireCredential("ses", credentials, "region", "AWS region");
  const accessKey = requireCredential("ses", credentials, "access_key_id", "AWS access key ID");
  const secretKey = requireCredential("ses", credentials, "secret_access_key", "AWS secret access key");
  const host = `email.${region}.amazonaws.com`;
  const now = new Date();
  const date = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const shortDate = date.slice(0, 8);
  const payload = body ? JSON.stringify(body) : "";
  const canonicalHeaders = canonicalHeader("content-type", "application/json") + canonicalHeader("host", host) + canonicalHeader("x-amz-date", date);
  const signedHeaders = "content-type;host;x-amz-date";
  const scope = `${shortDate}/${region}/ses/aws4_request`;
  const canonicalRequest = `${method}\n${path}\n\n${canonicalHeaders}\n${signedHeaders}\n${sha256(payload)}`;
  const stringToSign = `AWS4-HMAC-SHA256\n${date}\n${scope}\n${sha256(canonicalRequest)}`;
  const dateKey = hmac(`AWS4${secretKey}`, shortDate);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, "ses");
  const signingKey = hmac(serviceKey, "aws4_request");
  const signature = hmac(signingKey, stringToSign).toString("hex");
  return requestJson("ses", `https://${host}${path}`, {
    method,
    headers: {
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      "Content-Type": "application/json",
      "X-Amz-Date": date,
    },
    body: payload || undefined,
  });
};

const basicAuth = (username: string, password: string) => `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;

const senderHeaders = (credentials: EmailProviderCredentials) => ({
  Authorization: `Bearer ${requireCredential("sender", credentials, "api_key", "Sender API key")}`,
  Accept: "application/json",
  "Content-Type": "application/json",
});

const senderApi = async (
  credentials: EmailProviderCredentials,
  path: string,
  init: RequestInit = {},
) => requestJson("sender", `https://api.sender.net/v2${path}`, {
  ...init,
  headers: {
    ...senderHeaders(credentials),
    ...(init.headers || {}),
  },
});

const resend: EmailProviderAdapter = {
  provider: "resend",
  async validateCredentials(credentials) {
    const key = requireCredential("resend", credentials, "api_key", "Resend API key");
    if (key.length < 12) throw new EmailAdapterError("Enter a valid Resend API key.", "resend", 400, "invalid_provider_credentials");
  },
  async connectCredentials(credentials) {
    await this.validateCredentials(credentials);
    // Send-only Resend keys cannot read /domains. Delivery is the least
    // privilege validation path; the first send proves the key can deliver.
    return { healthy: true, validationMode: "delivery", checkedAt: new Date().toISOString() };
  },
  async getProviderStatus(credentials) {
    await this.validateCredentials(credentials);
    return { healthy: true, validationMode: "delivery", checkedAt: new Date().toISOString() };
  },
  async sendEmail(credentials, input) {
    const result = await requestJson("resend", "https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${requireCredential("resend", credentials, "api_key", "Resend API key")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: formatFrom(input.from), to: [input.to], reply_to: input.replyTo || undefined, subject: input.subject, html: input.html, text: input.text, headers: input.headers }),
    });
    return { messageId: clean(result.value.id, 255), response: { id: clean(result.value.id, 255) } };
  },
  async getSendingDomains(credentials) {
    const result = await requestJson("resend", "https://api.resend.com/domains?limit=100", {
      headers: { Authorization: `Bearer ${requireCredential("resend", credentials, "api_key", "Resend API key")}` },
    });
    return normaliseDomains(result.value);
  },
  async addDomain(credentials, domain) {
    const result = await requestJson("resend", "https://api.resend.com/domains", {
      method: "POST",
      headers: { Authorization: `Bearer ${requireCredential("resend", credentials, "api_key", "Resend API key")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: domain }),
    });
    return normaliseDomain(result.value, domain);
  },
  async verifyDomain(credentials, domain) {
    const domains = await this.getSendingDomains(credentials);
    const existing = domains.find((item) => item.domain === domain.toLowerCase());
    if (!existing) throw new EmailAdapterError("Add this domain in the provider before checking it.", "resend", 404, "domain_not_found");
    if (existing.status === "verified") return existing;
    const result = await requestJson("resend", `https://api.resend.com/domains/${encodeURIComponent(existing.id)}/verify`, {
      method: "POST",
      headers: { Authorization: `Bearer ${requireCredential("resend", credentials, "api_key", "Resend API key")}` },
    });
    return normaliseDomain(result.value, domain);
  },
};

type ToSendAccountInfo = {
  account: {
    status?: string;
    credit_balance?: number | null;
    monthly_email_limit?: number | null;
    limit_per_second?: number;
    ses_status?: string;
    bounce_rate?: number;
    complaint_rate?: number;
    [key: string]: unknown;
  };
  domains?: unknown[];
};

const toSendInfoCache = new Map<string, { value: ToSendAccountInfo; expiresAt: number }>();
const TOSEND_INFO_TTL_MS = 10 * 60 * 1_000;
const TOSEND_API_BASE_URL = "https://api.tosend.com";
const TOSEND_MAX_BATCH_SIZE = 100;

const toSendBaseUrl = (credentials: EmailProviderCredentials) => {
  const configured = clean(credentials.base_url || TOSEND_API_BASE_URL, 500).replace(/\/+$/, "");
  try {
    const parsed = new URL(configured);
    if (parsed.protocol !== "https:" && process.env.NODE_ENV === "production") {
      throw new Error("ToSend base URL must use HTTPS in production.");
    }
    return parsed.toString().replace(/\/$/, "");
  } catch {
    throw new EmailAdapterError("Enter a valid ToSend API base URL.", "tosend", 400, "invalid_provider_credentials");
  }
};

const toSendCredentials = (credentials: EmailProviderCredentials): EmailProviderCredentials => ({
  ...credentials,
});

const toSendHeaders = (credentials: EmailProviderCredentials) => ({
  Authorization: `Bearer ${requireCredential("tosend", toSendCredentials(credentials), "api_key", "ToSend API key")}`,
  Accept: "application/json",
  "Content-Type": "application/json",
});

const toSendInfo = async (credentials: EmailProviderCredentials, forceRefresh = false) => {
  const resolvedCredentials = toSendCredentials(credentials);
  const apiKey = requireCredential("tosend", resolvedCredentials, "api_key", "ToSend API key");
  const cacheKey = createHash("sha256").update(`${toSendBaseUrl(resolvedCredentials)}:${apiKey}`).digest("hex");
  const cached = toSendInfoCache.get(cacheKey);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) return cached.value;
  const result = await requestJson("tosend", `${toSendBaseUrl(resolvedCredentials)}/v2/info`, {
    headers: toSendHeaders(resolvedCredentials),
  });
  const value = result.value as ToSendAccountInfo;
  if (!value.account || typeof value.account !== "object") {
    throw new EmailAdapterError("ToSend returned an invalid account response.", "tosend", 502, "provider_response_invalid", true);
  }
  toSendInfoCache.set(cacheKey, { value, expiresAt: Date.now() + TOSEND_INFO_TTL_MS });
  return value;
};

const toSendConfiguredBatchSize = () => {
  return TOSEND_MAX_BATCH_SIZE;
};

const toSendResultError = (result: Record<string, unknown>) => {
  const status = Number(result.status_code || 422);
  const message = extractMessage(result) || "ToSend rejected this email.";
  const error = providerError("tosend", status, message, status === 429 || status >= 500);
  return {
    error: error.message,
    code: error.code,
    retryable: error.retryable,
    response: {
      statusCode: status,
      errorType: clean(result.error_type, 100),
      message: clean(message, 1_000),
    },
  };
};

/**
 * ToSend's REST contract is deliberately kept in this adapter. The account
 * response is cached so a campaign does not perform an account lookup for
 * every recipient or batch.
 */
const tosend: EmailProviderAdapter = {
  provider: "tosend",
  async validateCredentials(credentials) {
    const key = requireCredential("tosend", toSendCredentials(credentials), "api_key", "ToSend API key");
    if (key.length < 12) throw new EmailAdapterError("Enter a valid ToSend API key.", "tosend", 400, "invalid_provider_credentials");
    toSendBaseUrl(credentials);
  },
  async connectCredentials(credentials) {
    await this.validateCredentials(credentials);
    const info = await toSendInfo(credentials, true);
    const accountStatus = clean(info.account.status, 40).toLowerCase();
    const sesStatus = clean(info.account.ses_status, 40).toLowerCase();
    if (accountStatus && !["active", "ok", "healthy"].includes(accountStatus)) {
      throw new EmailAdapterError("The ToSend account is not active.", "tosend", 403, "provider_account_paused");
    }
    if (sesStatus === "paused" || sesStatus === "under_review") {
      throw new EmailAdapterError("ToSend has paused this account for review.", "tosend", 403, "provider_account_paused");
    }
    return {
      healthy: true,
      validationMode: "api",
      checkedAt: new Date().toISOString(),
    };
  },
  async getProviderStatus(credentials) {
    await this.connectCredentials(credentials);
    return { healthy: true, validationMode: "api", checkedAt: new Date().toISOString() };
  },
  async getSendingLimits(credentials, options) {
    await this.validateCredentials(credentials);
    const info = await toSendInfo(credentials, options?.forceRefresh === true);
    const perSecond = Number(info.account.limit_per_second || 0);
    if (!Number.isFinite(perSecond) || perSecond <= 0) {
      throw new EmailAdapterError("ToSend did not return a valid sending limit.", "tosend", 502, "provider_response_invalid", true);
    }
    return {
      maxPerSecond: Math.floor(perSecond),
      maxPerHour: null,
      maxBatchSize: toSendConfiguredBatchSize(),
      accountStatus: clean(info.account.status, 40),
      creditBalance: info.account.credit_balance == null ? null : Number(info.account.credit_balance),
      monthlyEmailLimit: info.account.monthly_email_limit == null ? null : Number(info.account.monthly_email_limit),
      refreshedAt: new Date().toISOString(),
    };
  },
  async sendEmail(credentials, input) {
    const resolvedCredentials = toSendCredentials(credentials);
    await this.validateCredentials(resolvedCredentials);
    const result = await requestJson("tosend", `${toSendBaseUrl(resolvedCredentials)}/v2/emails`, {
      method: "POST",
      headers: toSendHeaders(resolvedCredentials),
      body: JSON.stringify({
        from: input.from,
        to: [{ email: input.to, ...(input.recipientName ? { name: input.recipientName } : {}) }],
        reply_to: input.replyTo || undefined,
        subject: input.subject,
        html: input.html || undefined,
        text: input.text || undefined,
        headers: input.headers,
        message_hash: input.messageHash || undefined,
        tags: input.tags,
      }),
    });
    const messageId = clean(result.value.message_id, 255);
    if (!messageId) throw new EmailAdapterError("ToSend returned an invalid message identifier.", "tosend", 502, "provider_response_invalid", true);
    return {
      messageId,
      response: {
        messageId,
        recipientCount: Number(result.headers.get("x-recipient-count") || 1),
        tenantId: clean(result.headers.get("x-tenant-id"), 160),
      },
    };
  },
  async sendBatch(credentials, inputs) {
    const resolvedCredentials = toSendCredentials(credentials);
    await this.validateCredentials(resolvedCredentials);
    const maximum = toSendConfiguredBatchSize();
    if (!inputs.length || inputs.length > maximum) {
      throw new EmailAdapterError(`ToSend accepts 1-${maximum} emails per batch.`, "tosend", 422, "invalid_batch_size");
    }
    const result = await requestJson("tosend", `${toSendBaseUrl(resolvedCredentials)}/v2/emails/batch`, {
      method: "POST",
      headers: toSendHeaders(resolvedCredentials),
      body: JSON.stringify({
        emails: inputs.map((input) => ({
          from: input.from,
          to: [{ email: input.to, ...(input.recipientName ? { name: input.recipientName } : {}) }],
          reply_to: input.replyTo || undefined,
          subject: input.subject,
          html: input.html || undefined,
          text: input.text || undefined,
          headers: input.headers,
          message_hash: input.messageHash || undefined,
          tags: input.tags,
        })),
      }),
    });
    const rawResults = Array.isArray(result.value.results) ? result.value.results : [];
    if (rawResults.length !== inputs.length) {
      throw new EmailAdapterError("ToSend returned an incomplete batch response.", "tosend", 502, "provider_response_invalid", true);
    }
    return {
      status: result.status,
      response: {
        status: result.status,
        recipientCount: Number(result.headers.get("x-recipient-count") || 0),
        tenantId: clean(result.headers.get("x-tenant-id"), 160),
      },
      results: rawResults.map((raw) => {
        const item = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
        if (clean(item.status, 30).toLowerCase() === "success") {
          const messageId = clean(item.message_id, 255);
          if (!messageId) {
            return { ok: false as const, error: "ToSend returned an invalid message identifier.", code: "provider_response_invalid", retryable: true, response: item };
          }
          return { ok: true as const, messageId, response: item };
        }
        const failure = toSendResultError(item);
        return { ok: false as const, ...failure };
      }),
    };
  },
  async getSendingDomains(credentials) {
    await this.validateCredentials(credentials);
    const info = await toSendInfo(credentials);
    return normaliseDomains({ domains: info.domains || [] });
  },
  async verifyDomain(credentials, domain) {
    const domains = await this.getSendingDomains(credentials);
    const existing = domains.find((item) => item.domain === domain.toLowerCase());
    if (!existing) throw new EmailAdapterError("Add and verify this domain in ToSend before checking it here.", "tosend", 404, "domain_not_found");
    return existing;
  },
  async addDomain() {
    throw new EmailAdapterError("Add the domain in ToSend, then import it into MaxForm.", "tosend", 422, "domain_management_unsupported");
  },
};

export const resetToSendInfoCache = () => toSendInfoCache.clear();

const sender: EmailProviderAdapter = {
  provider: "sender",
  async validateCredentials(credentials) {
    const key = requireCredential("sender", credentials, "api_key", "Sender API key");
    if (key.length < 12) {
      throw new EmailAdapterError(
        "Enter a valid Sender API key.",
        "sender",
        400,
        "invalid_provider_credentials",
      );
    }
  },
  async connectCredentials(credentials) {
    const status = await this.getProviderStatus(credentials);
    return status;
  },
  async getProviderStatus(credentials) {
    await this.validateCredentials(credentials);
    // Sender documents the transactional-campaign collection as a read-only
    // authenticated endpoint. It is a safe connection check: it does not
    // create a campaign or send a message.
    await senderApi(credentials, "/transactional?limit=1");
    return { healthy: true, validationMode: "api", checkedAt: new Date().toISOString() };
  },
  async sendEmail(credentials, input) {
    await this.validateCredentials(credentials);
    if (!validEmail(input.from.email) || !validEmail(input.to)) {
      throw new EmailAdapterError(
        "Sender requires valid From and recipient email addresses.",
        "sender",
        400,
        "invalid_email_address",
      );
    }
    const headers: Record<string, string> = { charset: "utf-8", ...(input.headers || {}) };
    if (input.replyTo) headers["Reply-To"] = input.replyTo;
    const result = await senderApi(credentials, "/message/send", {
      method: "POST",
      body: JSON.stringify({
        from: { email: input.from.email, name: input.from.name || "MaxForm" },
        to: { email: input.to },
        subject: input.subject,
        text: input.text,
        html: input.html,
        headers,
      }),
    });
    if (result.value.success === false) {
      throw providerError(
        "sender",
        422,
        extractMessage(result.value) || "Sender rejected the email.",
      );
    }
    const messageId = clean(result.value.emailId || result.value.messageId || result.value.id, 255);
    if (!messageId) {
      throw new EmailAdapterError(
        "Sender returned an invalid delivery response.",
        "sender",
        502,
        "provider_response_invalid",
        true,
      );
    }
    return {
      messageId,
      response: {
        success: result.value.success === true,
        message: clean(result.value.message, 500),
        emailId: messageId,
      },
    };
  },
  // Sender's public API documents transactional message and campaign
  // endpoints, but not a DNS-domain management endpoint. Domain verification
  // remains an account-side Sender setup step; the send API still rejects an
  // unverified From domain.
  async getSendingDomains(credentials) {
    await this.validateCredentials(credentials);
    return [];
  },
  async verifyDomain() {
    throw new EmailAdapterError(
      "Verify this sending domain in Sender, then save the verified From address in MaxForm.",
      "sender",
      422,
      "domain_management_unsupported",
    );
  },
};

const sendgrid: EmailProviderAdapter = {
  provider: "sendgrid",
  async validateCredentials(credentials) {
    const key = requireCredential("sendgrid", credentials, "api_key", "SendGrid API key");
    if (key.length < 20) throw new EmailAdapterError("Enter a valid SendGrid API key.", "sendgrid", 400, "invalid_provider_credentials");
  },
  async connectCredentials(credentials) {
    await this.validateCredentials(credentials);
    return { healthy: true, validationMode: "delivery", checkedAt: new Date().toISOString() };
  },
  async getProviderStatus(credentials) {
    await this.validateCredentials(credentials);
    return { healthy: true, validationMode: "delivery", checkedAt: new Date().toISOString() };
  },
  async sendEmail(credentials, input) {
    await this.validateCredentials(credentials);
    const result = await requestJson("sendgrid", "https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${credentials.api_key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ personalizations: [{ to: [{ email: input.to }] }], from: input.from, reply_to: input.replyTo ? { email: input.replyTo } : undefined, subject: input.subject, content: [{ type: "text/plain", value: input.text }, { type: "text/html", value: input.html }], headers: input.headers }),
    });
    return { messageId: clean(result.headers.get("x-message-id"), 255), response: {} };
  },
  async getSendingDomains(credentials) {
    const result = await requestJson("sendgrid", "https://api.sendgrid.com/v3/whitelabel/domains", { headers: { Authorization: `Bearer ${requireCredential("sendgrid", credentials, "api_key", "SendGrid API key")}` } });
    return normaliseDomains(result.value);
  },
  async addDomain(credentials, domain) {
    const result = await requestJson("sendgrid", "https://api.sendgrid.com/v3/whitelabel/domains", {
      method: "POST",
      headers: { Authorization: `Bearer ${requireCredential("sendgrid", credentials, "api_key", "SendGrid API key")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ domain, automatic_security: true }),
    });
    return normaliseDomain(result.value, domain);
  },
  async verifyDomain(credentials, domain) {
    const domains = await this.getSendingDomains(credentials);
    const existing = domains.find((item) => item.domain === domain.toLowerCase());
    if (!existing) throw new EmailAdapterError("Add this domain in the provider before checking it.", "sendgrid", 404, "domain_not_found");
    if (existing.status === "verified") return existing;
    const result = await requestJson("sendgrid", `https://api.sendgrid.com/v3/whitelabel/domains/${encodeURIComponent(existing.id)}/validate`, { method: "POST", headers: { Authorization: `Bearer ${requireCredential("sendgrid", credentials, "api_key", "SendGrid API key")}` } });
    return normaliseDomain(result.value, domain);
  },
};

const postmark: EmailProviderAdapter = {
  provider: "postmark",
  async validateCredentials(credentials) {
    const token = requireCredential("postmark", credentials, "server_token", "Postmark server token");
    if (token.length < 12) throw new EmailAdapterError("Enter a valid Postmark server token.", "postmark", 400, "invalid_provider_credentials");
  },
  async connectCredentials(credentials) { await this.validateCredentials(credentials); return { healthy: true, validationMode: "delivery", checkedAt: new Date().toISOString() }; },
  async getProviderStatus(credentials) { await this.validateCredentials(credentials); return { healthy: true, validationMode: "delivery", checkedAt: new Date().toISOString() }; },
  async sendEmail(credentials, input) {
    const result = await requestJson("postmark", "https://api.postmarkapp.com/email", {
      method: "POST",
      headers: { "X-Postmark-Server-Token": requireCredential("postmark", credentials, "server_token", "Postmark server token"), "Content-Type": "application/json" },
      body: JSON.stringify({ From: formatFrom(input.from), To: input.to, ReplyTo: input.replyTo || undefined, Subject: input.subject, HtmlBody: input.html, TextBody: input.text, Headers: Object.entries(input.headers || {}).map(([Name, Value]) => ({ Name, Value })) }),
    });
    return { messageId: clean(result.value.MessageID, 255), response: { errorCode: Number(result.value.ErrorCode || 0) } };
  },
  async getSendingDomains(credentials) {
    const result = await requestJson("postmark", "https://api.postmarkapp.com/domains", { headers: { "X-Postmark-Server-Token": requireCredential("postmark", credentials, "server_token", "Postmark server token") } });
    return normaliseDomains(result.value);
  },
  async addDomain(credentials, domain) {
    const result = await requestJson("postmark", "https://api.postmarkapp.com/domains", { method: "POST", headers: { "X-Postmark-Server-Token": requireCredential("postmark", credentials, "server_token", "Postmark server token"), "Content-Type": "application/json" }, body: JSON.stringify({ Name: domain }) });
    return normaliseDomain(result.value, domain);
  },
  async verifyDomain(credentials, domain) {
    const domains = await this.getSendingDomains(credentials);
    const existing = domains.find((item) => item.domain === domain.toLowerCase());
    if (!existing) throw new EmailAdapterError("Add this domain in the provider before checking it.", "postmark", 404, "domain_not_found");
    return existing;
  },
};

const mailgun: EmailProviderAdapter = {
  provider: "mailgun",
  async validateCredentials(credentials) {
    const key = requireCredential("mailgun", credentials, "api_key", "Mailgun API key");
    const domain = requireCredential("mailgun", credentials, "domain", "Mailgun sending domain").toLowerCase();
    if (key.length < 12 || !validDomain(domain)) throw new EmailAdapterError("Enter a valid Mailgun API key and sending domain.", "mailgun", 400, "invalid_provider_credentials");
  },
  async connectCredentials(credentials) { await this.validateCredentials(credentials); return { healthy: true, validationMode: "delivery", checkedAt: new Date().toISOString() }; },
  async getProviderStatus(credentials) { await this.validateCredentials(credentials); return { healthy: true, validationMode: "delivery", checkedAt: new Date().toISOString() }; },
  async sendEmail(credentials, input) {
    const key = requireCredential("mailgun", credentials, "api_key", "Mailgun API key");
    const domain = requireCredential("mailgun", credentials, "domain", "Mailgun sending domain");
    const body = new URLSearchParams({ from: formatFrom(input.from), to: input.to, subject: input.subject, html: input.html, text: input.text });
    if (input.replyTo) body.set("h:Reply-To", input.replyTo);
    Object.entries(input.headers || {}).forEach(([name, value]) => body.set(`h:${name}`, value));
    const result = await requestJson("mailgun", `https://api.mailgun.net/v3/${encodeURIComponent(domain)}/messages`, { method: "POST", headers: { Authorization: basicAuth("api", key), "Content-Type": "application/x-www-form-urlencoded" }, body });
    return { messageId: clean(result.value.id, 255), response: { id: clean(result.value.id, 255) } };
  },
  async getSendingDomains(credentials) {
    const key = requireCredential("mailgun", credentials, "api_key", "Mailgun API key");
    const result = await requestJson("mailgun", "https://api.mailgun.net/v3/domains", { headers: { Authorization: basicAuth("api", key) } });
    return normaliseDomains(result.value);
  },
  async addDomain(credentials, domain) {
    const key = requireCredential("mailgun", credentials, "api_key", "Mailgun API key");
    const body = new URLSearchParams({ name: domain });
    const result = await requestJson("mailgun", "https://api.mailgun.net/v3/domains", { method: "POST", headers: { Authorization: basicAuth("api", key), "Content-Type": "application/x-www-form-urlencoded" }, body });
    return normaliseDomain(result.value, domain);
  },
  async verifyDomain(credentials, domain) {
    const key = requireCredential("mailgun", credentials, "api_key", "Mailgun API key");
    const result = await requestJson("mailgun", `https://api.mailgun.net/v3/domains/${encodeURIComponent(domain)}`, { headers: { Authorization: basicAuth("api", key) } });
    return normaliseDomain(result.value, domain);
  },
};

const ses: EmailProviderAdapter = {
  provider: "ses",
  async validateCredentials(credentials) {
    const region = requireCredential("ses", credentials, "region", "AWS region");
    requireCredential("ses", credentials, "access_key_id", "AWS access key ID");
    requireCredential("ses", credentials, "secret_access_key", "AWS secret access key");
    if (!/^[a-z]{2}(?:-gov)?-[a-z0-9-]+-\d$/.test(region)) throw new EmailAdapterError("Enter a valid AWS region.", "ses", 400, "invalid_provider_credentials");
  },
  async connectCredentials(credentials) { await this.validateCredentials(credentials); return { healthy: true, validationMode: "delivery", checkedAt: new Date().toISOString() }; },
  async getProviderStatus(credentials) { await this.validateCredentials(credentials); return { healthy: true, validationMode: "delivery", checkedAt: new Date().toISOString() }; },
  async sendEmail(credentials, input) {
    const result = await sesRequest(credentials, "POST", "/v2/email/outbound-emails", { FromEmailAddress: formatFrom(input.from), ReplyToAddresses: input.replyTo ? [input.replyTo] : undefined, Destination: { ToAddresses: [input.to] }, Content: { Simple: { Subject: { Data: input.subject, Charset: "UTF-8" }, Body: { Text: { Data: input.text, Charset: "UTF-8" }, Html: { Data: input.html, Charset: "UTF-8" } } } } });
    return { messageId: clean(result.value.MessageId, 255), response: { id: clean(result.value.MessageId, 255) } };
  },
  async getSendingDomains(credentials) {
    const result = await sesRequest(credentials, "GET", "/v2/email/identities");
    return normaliseDomains(result.value);
  },
  async addDomain(credentials, domain) {
    const result = await sesRequest(credentials, "POST", "/v2/email/identity", { EmailIdentity: domain });
    return normaliseDomain(result.value, domain);
  },
  async verifyDomain(credentials, domain) {
    const result = await sesRequest(credentials, "GET", `/v2/email/identity/${encodeURIComponent(domain)}`);
    return normaliseDomain(result.value, domain);
  },
};

const smtp: EmailProviderAdapter = {
  provider: "smtp",
  async validateCredentials(credentials) {
    smtpTransport(credentials).close();
  },
  async connectCredentials(credentials) {
    await this.validateCredentials(credentials);
    await smtpTransport(credentials).verify();
    return { healthy: true, validationMode: "api", checkedAt: new Date().toISOString() };
  },
  async getProviderStatus(credentials) {
    await this.validateCredentials(credentials);
    await smtpTransport(credentials).verify();
    return { healthy: true, validationMode: "api", checkedAt: new Date().toISOString() };
  },
  async sendEmail(credentials, input) {
    const result = await smtpTransport(credentials).sendMail({ from: formatFrom(input.from), to: input.to, replyTo: input.replyTo || undefined, subject: input.subject, html: input.html, text: input.text, headers: input.headers });
    return { messageId: clean(result.messageId, 255), response: { accepted: Array.isArray(result.accepted) ? result.accepted.length : 0 } };
  },
  async getSendingDomains() { return []; },
  async verifyDomain() { throw new EmailAdapterError("Custom domain management is not available through SMTP. Verify the domain with your mail service, then use the authenticated mailbox as the sender.", "smtp", 422, "domain_management_unsupported"); },
};

/**
 * Deterministic provider used by local/CI queue tests. Set
 * EMAIL_PROVIDER=mock and optionally MOCK_EMAIL_OUTCOME to success, bounce,
 * complaint, or temporary. A recipient containing +bounce, +complaint, or
 * +temporary before the @ selects that outcome for fixture tests.
 */
const mock: EmailProviderAdapter = {
  provider: "mock",
  async validateCredentials() {},
  async connectCredentials() {
    return { healthy: true, validationMode: "api", checkedAt: new Date().toISOString() };
  },
  async getProviderStatus() {
    return { healthy: true, validationMode: "api", checkedAt: new Date().toISOString() };
  },
  async sendEmail(_credentials, input) {
    const configured = String(process.env.MOCK_EMAIL_OUTCOME || "success").trim().toLowerCase();
    const recipientOutcome = /\+(bounce|complaint|temporary)@/i.exec(input.to)?.[1]?.toLowerCase();
    const outcome = recipientOutcome || configured;
    if (outcome === "temporary") {
      throw new EmailAdapterError(
        "Mock provider temporary failure.",
        "mock",
        503,
        "mock_temporary_failure",
        true,
      );
    }
    return {
      messageId: `mock-${createHash("sha256").update(`${input.to}:${input.subject}`).digest("hex").slice(0, 32)}`,
      response: {
        mock: true,
        outcome: outcome === "bounce" || outcome === "complaint" ? outcome : "success",
      },
    };
  },
  async getSendingDomains() {
    return [];
  },
  async verifyDomain(_credentials, domain) {
    return { id: `mock-${domain}`, domain, status: "verified", records: [] };
  },
};

const adapters: Record<EmailProviderId, EmailProviderAdapter> = { mock, tosend, resend, sender, smtp, sendgrid, postmark, mailgun, ses };

export const emailProviderAdapter = (provider: EmailProviderId) => adapters[provider];

export const emailProviderAdapters = adapters;

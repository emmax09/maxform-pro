import {
  createDecipheriv,
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { neon } from "@neondatabase/serverless";

import { configuredAppUrl } from "./app-url";
import {
  campaignAttributionMessageId,
} from "./campaign-tracking";
import {
  kickCampaignAnalyticsWorker,
  recordCampaignEvent,
  refreshCampaignMetrics,
} from "./campaign-analytics-engine";
import { issueStoredEventTicket } from "./event-tickets";
import {
  sendEventAttendeeEmailsNow,
  sendEventRegistrationEmailNow,
} from "./event-mail";
import { finalizePaymentRefund } from "./payment-providers";
import { dispatchWorkspaceWorkflowEvent } from "./workflows-data";

type Provider = "stripe" | "paypal" | "paystack" | "opay";
type BillingInterval = "week" | "month" | "quarter" | "year";
type RecordValue = Record<string, unknown>;
type Credentials = Record<string, string>;
type ProviderPaymentResult = {
  paid: boolean;
  subscriptionId?: string;
  transactionId: string;
};
type CheckoutCustomerDetails = {
  addressLine1: string;
  addressLine2: string;
  city: string;
  country: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  postalCode: string;
  region: string;
};

type CheckoutPurchaseItem = {
  productId: string;
  variantId: string | null;
  name: string;
  variantName: string;
  sku: string;
  description: string;
  quantity: number;
  unitAmount: number;
  totalAmount: number;
  taxAmount: number;
  requiresShipping: boolean;
  /** Weight of one unit; used by the server-side shipping rate engine. */
  weightGrams: number;
};

type CouponProductAmount = {
  amount: number;
  productId: string;
};

const paidProviders = ["stripe", "paypal", "paystack", "opay"] as const;
const isPaidProvider = (value: string): value is Provider =>
  paidProviders.includes(value as Provider);

type CheckoutRateLimitAction = "create" | "coupon" | "quote" | "status";

const checkoutRateLimitMaximum: Record<CheckoutRateLimitAction, number> = {
  create: 12,
  coupon: 30,
  quote: 45,
  status: 60,
};

class CheckoutError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "checkout_error",
  ) {
    super(message);
  }
}

const databaseUrl = () => process.env.DATABASE_URL || "";

const database = () => {
  const url = databaseUrl();
  if (!url) {
    throw new CheckoutError(
      "Checkout is temporarily unavailable. Please try again later.",
      503,
    );
  }
  return neon(url);
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

const originFor = (request: IncomingMessage) => {
  const configured = configuredAppUrl();
  if (configured) {
    try {
      const url = new URL(configured);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error();
      return url.origin;
    } catch {
      throw new CheckoutError(
        "Checkout is temporarily unavailable. Please try again later.",
        503,
      );
    }
  }
  if (process.env.NODE_ENV === "production") {
    throw new CheckoutError(
      "Checkout is temporarily unavailable. Please try again later.",
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

const paymentVerificationUrl = (
  request: IncomingMessage,
  context: RecordValue,
  idempotencyKey: string,
) => {
  const brandingParams = new URLSearchParams();
  if (context.workspace_name) {
    brandingParams.set("wn", String(context.workspace_name));
  }
  if (context.workspace_brand_color) {
    brandingParams.set("wc", String(context.workspace_brand_color));
  }
  if (context.workspace_logo_url) {
    brandingParams.set("wl", String(context.workspace_logo_url));
  }
  const brandingQuery = brandingParams.toString();
  return `${originFor(request)}/payments/verify/${encodeURIComponent(idempotencyKey)}${
    brandingQuery ? `?${brandingQuery}` : ""
  }`;
};

const requestAddress = (request: IncomingMessage) => {
  const forwarded =
    process.env.TRUST_PROXY_HEADERS === "true"
      ? String(request.headers["x-forwarded-for"] || "")
          .split(",")[0]
          .trim()
      : "";
  return forwarded || request.socket.remoteAddress || "unknown";
};

const enforceCheckoutRateLimit = (
  request: IncomingMessage,
  action: CheckoutRateLimitAction,
) => {
  const identity = couponIdentityHash("checkout", requestAddress(request));
  if (!identity) {
    throw new CheckoutError(
      "Checkout is temporarily unavailable. Please try again later.",
      503,
    );
  }
  return database()`
    WITH pruned AS (
      DELETE FROM payment_checkout_rate_limits
      WHERE window_started_at < NOW() - INTERVAL '24 hours'
    ),
    limited AS (
      INSERT INTO payment_checkout_rate_limits (
        endpoint, identity_hash, request_count, window_started_at, updated_at
      )
      VALUES (${action}, ${identity}, 1, NOW(), NOW())
      ON CONFLICT (endpoint, identity_hash) DO UPDATE
      SET request_count = CASE
            WHEN payment_checkout_rate_limits.window_started_at
              <= NOW() - INTERVAL '1 minute' THEN 1
            ELSE payment_checkout_rate_limits.request_count + 1
          END,
          window_started_at = CASE
            WHEN payment_checkout_rate_limits.window_started_at
              <= NOW() - INTERVAL '1 minute' THEN NOW()
            ELSE payment_checkout_rate_limits.window_started_at
          END,
          updated_at = NOW()
      RETURNING request_count
    )
    SELECT request_count FROM limited
  `.then((rows) => {
    if (Number(rows[0]?.request_count || 0) > checkoutRateLimitMaximum[action]) {
    throw new CheckoutError(
      "Too many checkout requests were received. Wait a minute and try again.",
      429,
      "checkout_rate_limited",
    );
    }
  });
};

const couponIdentityHash = (kind: "ip" | "device" | "checkout", value: string) => {
  if (!value) return null;
  const secret =
    process.env.PAYMENT_ENCRYPTION_KEY ||
    process.env.INTEGRATION_ENCRYPTION_KEY ||
    process.env.JWT_SECRET ||
    databaseUrl();
  return createHmac("sha256", secret)
    .update(`maxform:coupon:${kind}:${value}`)
    .digest("hex");
};

const couponIdentityForRequest = (
  request: IncomingMessage,
  body: RecordValue,
) => {
  const ip = requestAddress(request).trim().slice(0, 200);
  const rawDeviceFingerprint = String(body.deviceFingerprint || "")
    .trim()
    .toLowerCase();
  const deviceFingerprint = /^[a-f0-9]{64}$/.test(rawDeviceFingerprint)
    ? rawDeviceFingerprint
    : "";
  const rawDeviceId = String(body.deviceId || "").trim();
  const deviceId = /^[A-Za-z0-9_-]{16,160}$/.test(rawDeviceId)
    ? rawDeviceId
    : "";
  return {
    deviceHash: couponIdentityHash("device", deviceFingerprint || deviceId),
    ipHash: couponIdentityHash("ip", ip),
  };
};

const readBody = async (request: IncomingMessage) => {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) {
      throw new CheckoutError("This checkout request is too large.", 413);
    }
  }
  if (!body) return {} as RecordValue;
  try {
    const value = JSON.parse(body);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Expected a JSON object");
    }
    return value as RecordValue;
  } catch {
    throw new CheckoutError("The checkout request could not be read.");
  }
};

const encryptionKeys = () => {
  const secrets = [
    process.env.PAYMENT_ENCRYPTION_KEY || "",
    process.env.INTEGRATION_ENCRYPTION_KEY || "",
  ].filter(
    (secret, index, values) =>
      secret.length >= 24 && values.indexOf(secret) === index,
  );
  if (secrets.length === 0) {
    throw new CheckoutError(
      "Secure checkout is temporarily unavailable.",
      503,
    );
  }
  return secrets.map((secret) =>
    createHash("sha256").update(secret).digest(),
  );
};

const decrypt = (value: string): Credentials => {
  const [iv, tag, encrypted] = value.split(".");
  if (!iv || !tag || !encrypted) {
    throw new CheckoutError(
      "This payment method is temporarily unavailable.",
      409,
    );
  }
  for (const key of encryptionKeys()) {
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(iv, "base64url"),
      );
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return JSON.parse(
        Buffer.concat([
          decipher.update(Buffer.from(encrypted, "base64url")),
          decipher.final(),
        ]).toString("utf8"),
      ) as Credentials;
    } catch {
      // Continue through keys retained only for credential rotation.
    }
  }
  throw new CheckoutError(
    "This payment method is temporarily unavailable.",
    409,
  );
};

const providerTimeoutMs = () => {
  const configured = Number(process.env.PAYMENT_PROVIDER_TIMEOUT_MS || 12_000);
  return Math.max(3_000, Math.min(30_000, Number.isFinite(configured) ? configured : 12_000));
};

const fetchJson = async (url: string, init?: RequestInit) => {
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
    throw new CheckoutError(
      "The payment provider is temporarily unavailable. Please try again.",
      503,
      "provider_unavailable",
    );
  } finally {
    clearTimeout(timeout);
  }
  let value: RecordValue = {};
  try {
    value = text ? (JSON.parse(text) as RecordValue) : {};
  } catch {
    value = {};
  }
  if (!response.ok) {
    throw new CheckoutError(
      "The payment provider could not process this request. Please try another method.",
      503,
      "provider_checkout_failed",
    );
  }
  return value;
};

const paypalBase = () =>
  (process.env.PAYMENT_MODE || process.env.PAYPAL_MODE) === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

const paypalToken = async () => {
  const value = await fetchJson(`${paypalBase()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(
        `${process.env.PAYPAL_CLIENT_ID || ""}:${process.env.PAYPAL_CLIENT_SECRET || ""}`,
      ).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });
  return String(value.access_token || "");
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

const formContext = async (identifier: string) => {
  const sql = database();
  const rows = await sql`
    SELECT form.id AS form_id,
      form.slug,
      form.title,
      form.created_by AS user_id,
      COALESCE(settings.live_snapshot->'payment', settings.payment, '{}'::jsonb)
        AS payment,
      event.id AS event_id,
      COALESCE(event.ticketing_enabled, FALSE) AS ticketing_enabled,
      COALESCE(
        (
          SELECT BOOL_OR(ticket_type.price > 0)
          FROM event_ticket_types ticket_type
          WHERE ticket_type.event_id = event.id
            AND ticket_type.active = TRUE
        ),
        FALSE
      ) AS event_has_paid_tickets,
      COALESCE(
        EXISTS (
          SELECT 1
          FROM jsonb_array_elements(
            COALESCE(settings.live_snapshot->'fields', form.fields, '[]'::jsonb)
          ) published_field
          WHERE published_field->>'type' = 'product'
            AND COALESCE(
              (published_field->'config'->>'productCouponsEnabled')::boolean,
              FALSE
            ) = TRUE
        ),
        FALSE
      ) AS product_coupons_enabled,
      COALESCE(pricing.enabled, FALSE) AS event_pricing_enabled,
      COALESCE(pricing.amount, 0) AS event_pricing_amount,
      COALESCE(pricing.currency, '') AS event_pricing_currency,
      COALESCE(pricing.coupons_enabled, FALSE) AS event_coupons_enabled,
      COALESCE(company.company_name, '') AS workspace_name,
      COALESCE(company.company_logo_url, '') AS workspace_logo_url,
      COALESCE(company.brand_color, '#F93D0A') AS workspace_brand_color
    FROM forms form
    JOIN form_settings settings ON settings.form_id = form.id
    LEFT JOIN events event ON event.registration_form_id = form.id
    LEFT JOIN event_pricing pricing ON pricing.event_id = event.id
    LEFT JOIN company_settings company ON company.user_id = form.created_by
    WHERE (form.id::text = ${identifier} OR form.slug = ${identifier})
      AND form.status = 'published'
    LIMIT 1
  `;
  if (rows.length !== 1) {
    throw new CheckoutError("This checkout is no longer available.", 404);
  }
  return rows[0] as RecordValue;
};

const connectedProviders = async (
  userId: string,
  configuredProvider = "workspace",
) => {
  const sql = database();
  const rows = await sql`
    SELECT id, provider, external_account_name, is_default,
      credentials_encrypted
    FROM payment_provider_connections
    WHERE user_id = ${userId}
      AND status = 'connected'
      AND health_ok = TRUE
      AND (
        ${configuredProvider} = 'workspace'
        OR provider = ${configuredProvider}
      )
    ORDER BY is_default DESC, provider
  `;
  return rows as Array<RecordValue>;
};

const paymentValue = (context: RecordValue) =>
  (context.payment && typeof context.payment === "object"
    ? context.payment
    : {}) as RecordValue;

export const eventCheckoutConfigured = (context: RecordValue) => {
  if (!String(context.event_id || "")) return false;
  if (context.ticketing_enabled === true) {
    // Free tickets still need an order so attendee identities, secure codes,
    // invoices, and downloadable event designs are issued consistently.
    return true;
  }
  return (
    context.event_pricing_enabled === true &&
    Number(context.event_pricing_amount || 0) > 0
  );
};

const checkoutEnabled = (context: RecordValue, payment = paymentValue(context)) =>
  (payment.enabled === true &&
    !(String(payment.mode || "") === "cart" &&
      payment.productCommerceEnabled === false)) ||
  eventCheckoutConfigured(context);

const recordValue = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const jsonArray = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

const checkoutEffectivePrice = (row: RecordValue) => {
  const regular = Number(row.price || 0);
  const sale = row.sale_price == null ? null : Number(row.sale_price);
  return sale != null && Number.isFinite(sale) && sale >= 0 && sale <= regular
    ? sale
    : regular;
};

const checkoutAvailabilityError = (
  row: RecordValue,
  quantity: number,
  label: string,
) => {
  const status = String(row.product_status || "active");
  if (["draft", "hidden", "sold_out"].includes(status)) {
    return `${label} is not currently available.`;
  }
  const now = Date.now();
  const startsAt = row.availability_start_at
    ? new Date(String(row.availability_start_at)).getTime()
    : NaN;
  const endsAt = row.availability_end_at
    ? new Date(String(row.availability_end_at)).getTime()
    : NaN;
  if (Number.isFinite(startsAt) && now < startsAt) return `${label} is not available yet.`;
  if (Number.isFinite(endsAt) && now >= endsAt) return `${label} is no longer available.`;
  const minimum = Math.max(1, Math.floor(Number(row.min_quantity || 1)));
  const maximum = Math.max(minimum, Math.floor(Number(row.max_quantity || 1000)));
  if (quantity < minimum || quantity > maximum) {
    return `${label} quantity must be between ${minimum} and ${maximum}.`;
  }
  return "";
};

const variantAvailabilityError = (
  row: RecordValue,
  quantity: number,
  label: string,
) => {
  const now = Date.now();
  const startsAt = row.availability_start_at
    ? new Date(String(row.availability_start_at)).getTime()
    : NaN;
  const endsAt = row.availability_end_at
    ? new Date(String(row.availability_end_at)).getTime()
    : NaN;
  if (Number.isFinite(startsAt) && now < startsAt) return `${label} is not available yet.`;
  if (Number.isFinite(endsAt) && now >= endsAt) return `${label} is no longer available.`;
  const minimum = Math.max(1, Math.floor(Number(row.min_quantity || 1)));
  const maximum = Math.max(minimum, Math.floor(Number(row.max_quantity || 1000)));
  if (quantity < minimum || quantity > maximum) {
    return `${label} quantity must be between ${minimum} and ${maximum}.`;
  }
  return "";
};

const ensureOnePerCustomer = async (
  sql: ReturnType<typeof database>,
  userId: string,
  customerEmail: unknown,
  productIds: string[],
) => {
  const email = String(customerEmail || "").trim().toLowerCase();
  if (!email || productIds.length === 0) return;
  const rows = await sql.query(
    `SELECT item.product_id
     FROM payment_order_items item
     JOIN payment_orders payment_order ON payment_order.id = item.order_id
     WHERE payment_order.user_id = $1
       AND LOWER(TRIM(payment_order.customer_email)) = $2
       AND payment_order.status IN ('paid', 'processing')
       AND item.product_id = ANY($3::uuid[])
     LIMIT 1`,
    [userId, email, productIds],
  );
  if (rows.length > 0) {
    throw new CheckoutError(
      "This product is limited to one purchase per customer.",
      409,
      "product_one_per_customer",
    );
  }
};

const checkoutSubmissionFor = async (
  context: RecordValue,
  submissionId: string,
) => {
  if (!uuidPattern.test(submissionId)) {
    throw new CheckoutError("The saved response could not be found.", 404);
  }
  const rows = await database()`
    SELECT id, data
    FROM form_submissions
    WHERE id = ${submissionId} AND form_id = ${String(context.form_id)}
    LIMIT 1
  `;
  if (rows.length !== 1) {
    throw new CheckoutError("The saved response could not be found.", 404);
  }
  return rows[0] as RecordValue;
};

const ensureSubmissionAwaitingPayment = (submission: RecordValue) => {
  const meta = recordValue(recordValue(submission.data)._meta);
  if (
    meta.status !== "pending_payment" ||
    meta.paymentStatus !== "pending"
  ) {
    throw new CheckoutError(
      "This response has already been completed and cannot be charged again.",
      409,
      "submission_already_completed",
    );
  }
};

const trimmedField = (value: unknown, maxLength: number) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, maxLength);

const checkoutCustomerFromBody = (
  value: unknown,
): CheckoutCustomerDetails => {
  const input = recordValue(value);
  return {
    addressLine1: trimmedField(input.addressLine1, 180),
    addressLine2: trimmedField(input.addressLine2, 180),
    city: trimmedField(input.city, 90),
    country: trimmedField(input.country, 90),
    email: trimmedField(input.email, 160).toLowerCase(),
    firstName: trimmedField(input.firstName, 80),
    lastName: trimmedField(input.lastName, 80),
    phone: trimmedField(input.phone, 40),
    postalCode: trimmedField(input.postalCode, 32),
    region: trimmedField(input.region, 90),
  };
};

const validCheckoutEmail = (value: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const checkoutCustomerComplete = (customer: CheckoutCustomerDetails) =>
  Boolean(
    customer.firstName &&
      customer.lastName &&
      validCheckoutEmail(customer.email) &&
      customer.addressLine1 &&
      customer.city &&
      customer.region &&
      customer.postalCode &&
      customer.country,
  );

const customerNameFromDetails = (customer: CheckoutCustomerDetails) =>
  [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim();

const checkoutCustomerForStatus = (
  metadata: RecordValue,
  customerName: string,
  customerEmail: string,
) => {
  const details = checkoutCustomerFromBody(metadata.checkoutCustomer);
  if (!details.email) details.email = customerEmail;
  if ((!details.firstName || !details.lastName) && customerName) {
    const parts = customerName.split(/\s+/);
    if (!details.firstName) details.firstName = parts.shift() || "";
    if (!details.lastName) details.lastName = parts.join(" ");
  }
  return details;
};

const destinationToken = (value: unknown) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const destinationRule = (
  rules: unknown,
  customer: Partial<CheckoutCustomerDetails>,
) => {
  const country = destinationToken(customer.country);
  const region = destinationToken(customer.region);
  const candidates = Array.isArray(rules)
    ? rules.filter((value): value is RecordValue => Boolean(value && typeof value === "object" && !Array.isArray(value)))
      .filter((rule) => {
        const ruleCountry = destinationToken(rule.country);
        const ruleRegion = destinationToken(rule.region);
        return (!ruleCountry || ruleCountry === country) &&
          (!ruleRegion || ruleRegion === region);
      })
      .sort((left, right) => {
        const leftSpecificity = Number(Boolean(destinationToken(left.country))) + Number(Boolean(destinationToken(left.region)));
        const rightSpecificity = Number(Boolean(destinationToken(right.country))) + Number(Boolean(destinationToken(right.region)));
        return rightSpecificity - leftSpecificity;
      })
    : [];
  return candidates[0] || null;
};

const destinationTaxRate = (
  payment: RecordValue,
  customer: Partial<CheckoutCustomerDetails>,
) => {
  const matching = destinationRule(payment.taxRules, customer);
  const configured = matching?.rate ?? payment.destinationTaxRate;
  const rate = Number(configured || 0);
  return Number.isFinite(rate) ? Math.min(100, Math.max(0, rate)) : 0;
};

type ShippingRateType = "flat" | "per_item" | "weight";
type ShippingMode =
  | "flat"
  | "destination"
  | "weight"
  | "quantity"
  | "advanced";

type ShippingMetrics = {
  subtotal: number;
  quantity: number;
  weightGrams: number;
};

type ShippingResolution = {
  amount: number;
  deliveryEstimate: string;
  freeShippingThreshold: number;
  label: string;
  rule: RecordValue | null;
};

const nonNegativeShippingValue = (value: unknown, maximum = 100_000_000) => {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(maximum, Math.max(0, number))
    : 0;
};

const shippingModeValue = (payment: RecordValue): ShippingMode => {
  const mode = String(payment.shippingMode || "flat");
  return ["destination", "weight", "quantity", "advanced"].includes(mode)
    ? (mode as ShippingMode)
    : "flat";
};

const shippingRateTypeValue = (
  value: unknown,
  fallback: ShippingRateType = "flat",
): ShippingRateType => {
  const mode = String(value || "");
  return ["per_item", "weight"].includes(mode)
    ? (mode as ShippingRateType)
    : mode === "flat"
      ? "flat"
      : fallback;
};

const shippingCountriesFromRule = (rule: RecordValue) => {
  const explicit = Array.isArray(rule.countries)
    ? rule.countries.map(String)
    : [];
  const legacy = String(rule.country || "")
    .split(/[\n,]/)
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set([...explicit, ...legacy].map(destinationToken).filter(Boolean))];
};

const shippingValues = (value: unknown) =>
  String(value || "")
    .split(/[\n,]/)
    .map((part) => destinationToken(part))
    .filter(Boolean);

const shippingCountryMatches = (rule: RecordValue, country: string) => {
  const countries = shippingCountriesFromRule(rule);
  return countries.length === 0 || countries.includes(country);
};

const shippingRegionMatches = (rule: RecordValue, region: string) => {
  const regions = shippingValues(rule.regions || rule.region);
  return regions.length === 0 || regions.includes(region);
};

const shippingPostalMatches = (patternValue: unknown, postalCode: string) => {
  const normalizePostal = (value: unknown) =>
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "");
  const patterns = String(patternValue || "")
    .split(/[\n,]/)
    .map(normalizePostal)
    .filter(Boolean);
  if (patterns.length === 0) return true;
  const normalizedPostalCode = normalizePostal(postalCode);
  if (!normalizedPostalCode) return false;
  return patterns.some((pattern) => {
    const escaped = pattern
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*");
    return new RegExp(`^${escaped}$`, "i").test(normalizedPostalCode);
  });
};

const shippingRuleMatches = (
  rule: RecordValue,
  customer: Partial<CheckoutCustomerDetails>,
  metrics: ShippingMetrics,
) => {
  if (rule.active === false) return false;
  const country = destinationToken(customer.country);
  const region = destinationToken(customer.region);
  const postalCode = destinationToken(customer.postalCode);
  if (!shippingCountryMatches(rule, country)) return false;
  if (!shippingRegionMatches(rule, region)) return false;
  if (!shippingPostalMatches(rule.postalCode, postalCode)) return false;
  const minSubtotal = nonNegativeShippingValue(rule.minSubtotal);
  const maxSubtotal = nonNegativeShippingValue(rule.maxSubtotal);
  const minQuantity = Math.floor(nonNegativeShippingValue(rule.minQuantity, 100_000));
  const maxQuantity = Math.floor(nonNegativeShippingValue(rule.maxQuantity, 100_000));
  const minWeightGrams = nonNegativeShippingValue(rule.minWeightGrams, 1_000_000_000);
  const maxWeightGrams = nonNegativeShippingValue(rule.maxWeightGrams, 1_000_000_000);
  return !(minSubtotal > 0 && metrics.subtotal < minSubtotal) &&
    !(maxSubtotal > 0 && metrics.subtotal > maxSubtotal) &&
    !(minQuantity > 0 && metrics.quantity < minQuantity) &&
    !(maxQuantity > 0 && metrics.quantity > maxQuantity) &&
    !(minWeightGrams > 0 && metrics.weightGrams < minWeightGrams) &&
    !(maxWeightGrams > 0 && metrics.weightGrams > maxWeightGrams);
};

const shippingRuleSpecificity = (rule: RecordValue) => {
  const countries = shippingCountriesFromRule(rule);
  const regions = shippingValues(rule.regions || rule.region);
  const postal = shippingValues(rule.postalCode);
  const conditionCount = [
    rule.minSubtotal,
    rule.maxSubtotal,
    rule.minQuantity,
    rule.maxQuantity,
    rule.minWeightGrams,
    rule.maxWeightGrams,
  ].filter((value) => nonNegativeShippingValue(value) > 0).length;
  return Number(countries.length > 0) * 100 +
    Number(regions.length > 0) * 20 +
    Number(postal.length > 0) * 10 +
    conditionCount;
};

const matchingShippingRule = (
  payment: RecordValue,
  customer: Partial<CheckoutCustomerDetails>,
  metrics: ShippingMetrics,
) => {
  const rules = Array.isArray(payment.shippingRules)
    ? payment.shippingRules.filter(
        (value): value is RecordValue =>
          Boolean(value && typeof value === "object" && !Array.isArray(value)),
      )
    : [];
  return rules
    .filter((rule) => shippingRuleMatches(rule, customer, metrics))
    .map((rule, index) => ({ rule, index }))
    .sort((left, right) =>
      shippingRuleSpecificity(right.rule) -
      shippingRuleSpecificity(left.rule) ||
      left.index - right.index,
    )[0]?.rule || null;
};

export const shippingCountryAllowed = (
  payment: RecordValue,
  customer: Partial<CheckoutCustomerDetails>,
) => {
  const country = destinationToken(customer.country);
  if (!country) return true;
  const countries = Array.isArray(payment.shippingCountries)
    ? payment.shippingCountries.map(destinationToken).filter(Boolean)
    : [];
  if (countries.length === 0) return true;
  const policy = String(payment.shippingCountryPolicy || "worldwide");
  return policy === "allowlist"
    ? countries.includes(country)
    : policy === "blocklist"
      ? !countries.includes(country)
      : true;
};

const shippingWeightUnitGrams = (payment: RecordValue) => {
  const unit = String(payment.shippingWeightUnit || "kg");
  return unit === "g" ? 1 : unit === "lb" ? 453.592 : 1_000;
};

const shippingRateAmount = (
  payment: RecordValue,
  rule: RecordValue | null,
  metrics: ShippingMetrics,
) => {
  const mode = shippingModeValue(payment);
  const fallbackRateType = mode === "quantity"
    ? "per_item"
    : mode === "weight"
      ? "weight"
      : "flat";
  const rateType = shippingRateTypeValue(
    rule?.rateType ?? payment.shippingRateType,
    fallbackRateType,
  );
  const baseAmount = nonNegativeShippingValue(
    rule?.amount ?? payment.shippingAmount,
  );
  const perItemAmount = nonNegativeShippingValue(
    rule?.perItemAmount ?? payment.shippingPerItemAmount ?? baseAmount,
  );
  const perWeightUnitAmount = nonNegativeShippingValue(
    rule?.perWeightUnitAmount ??
      payment.shippingPerWeightUnitAmount ??
      baseAmount,
  );
  const packageWeightGrams = nonNegativeShippingValue(
    payment.shippingPackageWeightGrams,
    1_000_000_000,
  );
  const weightUnits = (metrics.weightGrams + packageWeightGrams) /
    shippingWeightUnitGrams(payment);
  const rate = rateType === "per_item"
    ? perItemAmount * metrics.quantity
    : rateType === "weight"
      ? perWeightUnitAmount * weightUnits
      : baseAmount;
  return Math.max(
    0,
    rate +
      nonNegativeShippingValue(payment.shippingHandlingFee) +
      nonNegativeShippingValue(rule?.handlingFee),
  );
};

export const calculateShipping = (
  payment: RecordValue,
  customer: Partial<CheckoutCustomerDetails>,
  metrics: ShippingMetrics,
): ShippingResolution => {
  const mode = shippingModeValue(payment);
  const shouldMatchRule = mode === "destination" || mode === "advanced";
  const rule = shouldMatchRule
    ? matchingShippingRule(payment, customer, metrics)
    : null;
  const freeShippingThreshold = nonNegativeShippingValue(
    rule?.freeShippingThreshold ?? payment.freeShippingThreshold,
  );
  const free = freeShippingThreshold > 0 && metrics.subtotal >= freeShippingThreshold;
  const amount = free ? 0 : shippingRateAmount(payment, rule, metrics);
  return {
    amount: Math.round(amount * 100) / 100,
    deliveryEstimate: String(
      rule?.deliveryEstimate || payment.shippingDefaultDeliveryEstimate || "",
    ).trim().slice(0, 120),
    freeShippingThreshold,
    label: String(
      rule?.name ||
        (mode === "weight"
          ? "Weight-based shipping"
          : mode === "quantity"
            ? "Quantity-based shipping"
            : "Shipping"),
    ).trim().slice(0, 120),
    rule,
  };
};

const confirmationForStatus = (value: unknown) => {
  const input = recordValue(value);
  const type = ["message", "redirect", "message_redirect"].includes(
    String(input.type || ""),
  )
    ? String(input.type)
    : "message";
  return {
    message: trimmedField(
      input.message || "Thanks. Your response has been received.",
      500,
    ),
    redirectDelay: Math.min(
      120,
      Math.max(0, Number(input.redirectDelay || 0) || 0),
    ),
    redirectUrl: trimmedField(input.redirectUrl, 500),
    title: trimmedField(input.title || "Response received", 160),
    type,
  };
};

const checkoutTarget = (context: RecordValue) => {
  const eventId = String(context.event_id || "");
  return eventId
    ? { id: eventId, type: "event" as const }
    : { id: String(context.form_id || ""), type: "form" as const };
};

const couponsEnabledForContext = (
  context: RecordValue,
  payment = paymentValue(context),
) =>
  String(context.event_id || "")
    ? context.event_coupons_enabled === true
    : payment.allowCoupons === true ||
      (context.product_coupons_enabled === true &&
        payment.mode === "cart" &&
        payment.productCommerceEnabled !== false);

const purchaseForSubmission = async (
  context: RecordValue,
  submissionId: string,
  requestedAmount: number,
  customer: Partial<CheckoutCustomerDetails> = {},
) => {
  const sql = database();
  const payment = paymentValue(context);
  const eventId = String(context.event_id || "");
  if (eventId) {
    if (context.ticketing_enabled === true) {
      const selected = await sql`
        SELECT answer.answer #>> '{}' AS ticket_name
        FROM form_submission_answers answer
        WHERE answer.submission_id = ${submissionId}
          AND answer.field_id = 'ticket-selection'
        LIMIT 1
      `;
      const rawTicketAnswer = String(selected[0]?.ticket_name || "");
      let ticketName = rawTicketAnswer;
      let quantity = 1;
      try {
        const parsed = JSON.parse(rawTicketAnswer) as {
          name?: unknown;
          quantity?: unknown;
        };
        if (parsed && typeof parsed === "object" && parsed.name) {
          ticketName = String(parsed.name);
          quantity = Math.max(1, Math.floor(Number(parsed.quantity) || 1));
        }
      } catch {
        // Older event forms stored the ticket name without quantity metadata.
      }
      const tickets = await sql`
        SELECT ticket_type.id, ticket_type.name, ticket_type.description,
          ticket_type.price, ticket_type.currency, ticket_type.product_id,
          ticket_type.min_per_order, ticket_type.max_per_order,
          ticket_type.quantity_available,
          (SELECT COUNT(*)
           FROM event_attendees attendee
           WHERE attendee.ticket_type_id = ticket_type.id
             AND attendee.ticket_status IN ('valid', 'transferred')) AS sold_count
        FROM event_ticket_types ticket_type
        WHERE ticket_type.event_id = ${eventId}
          AND ticket_type.active = TRUE
          AND LOWER(ticket_type.name) = LOWER(${ticketName})
        LIMIT 1
      `;
      if (tickets.length !== 1) {
        throw new CheckoutError(
          "The selected ticket is no longer available. Return to the event and choose another ticket.",
          409,
        );
      }
      const ticket = tickets[0] as RecordValue;
      const minimum = Math.max(1, Number(ticket.min_per_order || 1));
      const maximum = Math.max(minimum, Number(ticket.max_per_order || minimum));
      const remaining = Math.max(
        0,
        Number(ticket.quantity_available || 0) - Number(ticket.sold_count || 0),
      );
      if (quantity < minimum || quantity > maximum) {
        throw new CheckoutError(
          `Choose between ${minimum} and ${maximum} ${String(ticket.name)} ticket${maximum === 1 ? "" : "s"}.`,
          422,
          "ticket_quantity_limit",
        );
      }
      if (quantity > remaining) {
        throw new CheckoutError(
          "There are not enough tickets remaining for that quantity.",
          409,
          "ticket_inventory",
        );
      }
      const unitAmount = Number(ticket.price || 0);
      return {
        amount: unitAmount * quantity,
        unitAmount,
        quantity,
        billingInterval: null,
        billingType: "one_time" as const,
        currency: String(ticket.currency || "USD"),
        description: String(ticket.description || ""),
        name: String(ticket.name || "Event ticket"),
        productId: String(ticket.product_id || "") || null,
        sourceId: eventId,
        sourceType: "event" as const,
      };
    }
    const prices = await sql`
      SELECT amount, currency, label
      FROM event_pricing
      WHERE event_id = ${eventId} AND enabled = TRUE
      LIMIT 1
    `;
    if (prices.length !== 1) {
      return {
        amount: 0,
        unitAmount: 0,
        quantity: 1,
        billingInterval: null,
        billingType: "one_time" as const,
        currency: String(payment.currency || "USD"),
        description: "",
        name: String(context.title || "Event registration"),
        productId: null,
        sourceId: eventId,
        sourceType: "event" as const,
      };
    }
    return {
      amount: Number(prices[0].amount || 0),
      unitAmount: Number(prices[0].amount || 0),
      quantity: 1,
      billingInterval: null,
      billingType: "one_time" as const,
      currency: String(prices[0].currency || "USD"),
      description: "",
      name: String(prices[0].label || "Event registration"),
      productId: null,
      sourceId: eventId,
      sourceType: "event" as const,
    };
  }

  if (String(payment.mode || "") === "cart") {
    const answerRows = await sql.query(
      `SELECT answer.answer, field.config
       FROM form_submission_answers answer
       JOIN form_fields field
         ON field.form_id = $1 AND field.field_id = answer.field_id
       WHERE answer.submission_id = $2 AND field.field_type = 'product'`,
      [String(context.form_id), submissionId],
    );
    const requested = new Map<string, { productId: string; variantId: string; quantity: number }>();
    for (const row of answerRows as RecordValue[]) {
      const config = row.config && typeof row.config === "object" && !Array.isArray(row.config)
        ? row.config as RecordValue
        : {};
      const allowedIds = new Set(
        Array.isArray(config.productIds) ? config.productIds.map(String) : [],
      );
      const values = Array.isArray(row.answer)
        ? row.answer
        : typeof row.answer === "string"
          ? (() => { try { const parsed = JSON.parse(row.answer); return Array.isArray(parsed) ? parsed : []; } catch { return []; } })()
          : [];
      for (const raw of values) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
          throw new CheckoutError("The product selection is not valid.", 422, "cart_invalid");
        }
        const selection = raw as RecordValue;
        const productId = String(selection.productId || "");
        const variantId = String(selection.variantId || "");
        const quantity = Math.floor(Number(selection.quantity));
        if (!uuidPattern.test(productId) || (variantId && !uuidPattern.test(variantId)) || !allowedIds.has(productId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 1000) {
          throw new CheckoutError("The product selection is no longer valid.", 422, "cart_invalid");
        }
        const key = `${productId}:${variantId}`;
        const existing = requested.get(key);
        requested.set(key, { productId, variantId, quantity: (existing?.quantity || 0) + quantity });
      }
    }
    if (requested.size === 0 || requested.size > 100) {
      throw new CheckoutError("Choose at least one available product.", 422, "cart_empty");
    }
    const productIds = [...new Set([...requested.values()].map((item) => item.productId))];
    const productRows = await sql.query(
      `SELECT product.id, product.name, product.description, product.sku,
              product.price, product.sale_price, product.currency, product.billing_type,
              product.product_status, product.availability_start_at,
              product.availability_end_at, product.min_quantity,
               product.max_quantity, product.one_per_customer,
               product.hide_when_sold_out,
               product.taxable, product.tax_rate, product.requires_shipping,
               product.weight_grams,
               product.track_inventory, product.inventory_quantity,
               product.allow_backorder,
              COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'id', variant.id, 'name', variant.name, 'sku', variant.sku,
                  'price', variant.price, 'active', variant.active,
                  'salePrice', variant.sale_price,
                  'description', variant.description,
                  'availabilityStartAt', variant.availability_start_at,
                   'availabilityEndAt', variant.availability_end_at,
                   'trackInventory', variant.track_inventory,
                   'inventoryQuantity', variant.inventory_quantity,
                   'allowBackorder', variant.allow_backorder,
                   'weightGrams', variant.weight_grams
                 )) FROM payment_product_variants variant
                WHERE variant.product_id = product.id
              ), '[]'::jsonb) AS variants
       FROM payment_products product
       WHERE product.id = ANY($1::uuid[])
         AND product.user_id = $2
         AND product.active = TRUE`,
      [productIds, String(context.user_id)],
    );
    const products = new Map((productRows as RecordValue[]).map((row) => [String(row.id), row]));
    await ensureOnePerCustomer(
      sql,
      String(context.user_id),
      customer.email,
      [...products.values()]
        .filter((product) => product.one_per_customer === true)
        .map((product) => String(product.id)),
    );
    const items: CheckoutPurchaseItem[] = [];
    let cartCurrency = "";
    for (const selection of requested.values()) {
      const product = products.get(selection.productId);
      if (!product || product.billing_type !== "one_time") {
        throw new CheckoutError("A selected product is no longer available.", 409, "cart_product_unavailable");
      }
      const productAvailabilityError = checkoutAvailabilityError(
        product,
        selection.quantity,
        String(product.name || "Product"),
      );
      if (productAvailabilityError) {
        throw new CheckoutError(productAvailabilityError, 409, "cart_product_unavailable");
      }
      const productCurrency = String(product.currency || "USD");
      if (cartCurrency && cartCurrency !== productCurrency) {
        throw new CheckoutError("All products in one form cart must use the same currency.", 422, "cart_currency_mismatch");
      }
      cartCurrency = productCurrency;
      const variants = Array.isArray(product.variants) ? product.variants as RecordValue[] : [];
      const variant = selection.variantId
        ? variants.find((item) => String(item.id) === selection.variantId && item.active === true)
        : null;
      if ((variants.length > 0 && !variant) || (!variants.length && selection.variantId)) {
        throw new CheckoutError("Choose an available product variation.", 409, "cart_variant_unavailable");
      }
      if (variant) {
        const variantAvailabilityErrorMessage = variantAvailabilityError(
          variant,
          selection.quantity,
          String(variant.name || product.name || "Product variation"),
        );
        if (variantAvailabilityErrorMessage) {
          throw new CheckoutError(
            variantAvailabilityErrorMessage,
            409,
            "cart_variant_unavailable",
          );
        }
      }
      const tracksInventory = variant
        ? variant.trackInventory === true
        : product.track_inventory === true;
      const inventoryQuantity = Number(
        variant ? variant.inventoryQuantity : product.inventory_quantity,
      );
      const allowBackorder = variant
        ? variant.allowBackorder === true
        : product.allow_backorder === true;
      if (tracksInventory && !allowBackorder && selection.quantity > inventoryQuantity) {
        throw new CheckoutError(`${String(product.name)} does not have enough stock for that quantity.`, 409, "cart_inventory");
      }
      if (
        product.hide_when_sold_out === true &&
        tracksInventory &&
        inventoryQuantity <= 0
      ) {
        throw new CheckoutError(
          `${String(product.name)} is sold out.`,
          409,
          "cart_product_unavailable",
        );
      }
      const unitAmount = variant
        ? (variant.salePrice == null
            ? Number(variant.price)
            : Number(variant.salePrice))
        : checkoutEffectivePrice(product);
      const weightGrams = nonNegativeShippingValue(
        variant?.weightGrams ?? product.weight_grams,
        1_000_000_000,
      );
      const totalAmount = Math.round(unitAmount * selection.quantity * 100) / 100;
      const taxRate = payment.taxMode === "destination"
        ? destinationTaxRate(payment, customer)
        : Number(product.tax_rate || 0);
      const taxAmount = payment.taxEnabled === true && product.taxable === true
        ? Math.round(totalAmount * taxRate) / 100
        : 0;
      items.push({
        productId: selection.productId,
        variantId: selection.variantId || null,
        name: String(product.name),
        variantName: variant ? String(variant.name || "") : "",
        sku: String(variant?.sku || product.sku || ""),
        description: String(product.description || ""),
        quantity: selection.quantity,
        unitAmount,
        totalAmount,
        taxAmount,
        requiresShipping: product.requires_shipping === true,
        weightGrams,
      });
    }
    const subtotal = Math.round(items.reduce((sum, item) => sum + item.totalAmount, 0) * 100) / 100;
    const taxAmount = Math.round(items.reduce((sum, item) => sum + item.taxAmount, 0) * 100) / 100;
    const shippingRequired = items.some((item) => item.requiresShipping);
    const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
    const totalWeightGrams = items.reduce(
      (sum, item) => sum + item.weightGrams * item.quantity,
      0,
    );
    if (
      payment.shippingEnabled === true &&
      shippingRequired &&
      !shippingCountryAllowed(payment, customer)
    ) {
      throw new CheckoutError(
        "We do not currently ship to this destination.",
        422,
        "shipping_destination_unavailable",
      );
    }
    const shipping = payment.shippingEnabled === true && shippingRequired
      ? calculateShipping(payment, customer, {
          subtotal,
          quantity: totalQuantity,
          weightGrams: totalWeightGrams,
        })
      : {
          amount: 0,
          deliveryEstimate: "",
          freeShippingThreshold: 0,
          label: "",
          rule: null,
        };
    const shippingAmount = shipping.amount;
    const amount = Math.round((subtotal + taxAmount + shippingAmount) * 100) / 100;
    if (amount <= 0 || amount > 100_000_000) {
      throw new CheckoutError("The cart total is not valid.", 422, "cart_total_invalid");
    }
    return {
      amount,
      subtotal,
      taxAmount,
      shippingAmount,
      shippingDeliveryEstimate: shipping.deliveryEstimate,
      shippingLabel: shipping.label,
      items,
      unitAmount: amount,
      quantity: 1,
      billingInterval: null,
      billingType: "one_time" as const,
      currency: cartCurrency,
      description: `${items.length} order item${items.length === 1 ? "" : "s"}`,
      name: `${String(context.title || "Form order")} (${items.length} item${items.length === 1 ? "" : "s"})`,
      productId: null,
      sourceId: String(context.form_id),
      sourceType: "form" as const,
    };
  }

  if (String(payment.mode || "fixed") === "product") {
    const products = await sql`
      SELECT id, name, description, price, sale_price, currency, billing_type,
        billing_interval, product_status, availability_start_at,
        availability_end_at, min_quantity, max_quantity, one_per_customer,
        hide_when_sold_out
      FROM payment_products
      WHERE id = ${String(payment.productId || "")}
        AND user_id = ${String(context.user_id)}
        AND active = TRUE
      LIMIT 1
    `;
    if (products.length !== 1) {
      throw new CheckoutError("This product is no longer available.", 409);
    }
    const product = products[0] as RecordValue;
    const availabilityError = checkoutAvailabilityError(
      product,
      1,
      String(product.name || "Product"),
    );
    if (availabilityError) {
      throw new CheckoutError(availabilityError, 409, "product_unavailable");
    }
    if (product.one_per_customer === true) {
      await ensureOnePerCustomer(
        sql,
        String(context.user_id),
        customer.email,
        [String(product.id)],
      );
    }
    const unitAmount = checkoutEffectivePrice(product);
    return {
      amount: unitAmount,
      unitAmount,
      quantity: 1,
      billingInterval: String(products[0].billing_interval || "month") as
        | "week"
        | "month"
        | "quarter"
        | "year",
      billingType:
        product.billing_type === "recurring"
          ? ("recurring" as const)
          : ("one_time" as const),
      currency: String(product.currency || "USD"),
      description: String(product.description || ""),
      name: String(product.name || context.title),
      productId: String(product.id),
      sourceId: String(context.form_id),
      sourceType: "form" as const,
    };
  }
  const variable = String(payment.mode || "") === "variable";
  const amount = variable ? requestedAmount : Number(payment.amount || 0);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000_000) {
    throw new CheckoutError("Enter a valid payment amount.");
  }
  return {
    amount,
    unitAmount: amount,
    quantity: 1,
    billingInterval: null,
    billingType: "one_time" as const,
    currency: String(payment.currency || "USD"),
    description: "",
    name: String(context.title || "Form payment"),
    productId: null,
    sourceId: String(context.form_id),
    sourceType: "form" as const,
  };
};

type CheckoutPurchase = Awaited<ReturnType<typeof purchaseForSubmission>>;

type CheckoutCartPurchase = CheckoutPurchase & {
  items: CheckoutPurchaseItem[];
  subtotal: number;
  taxAmount: number;
  shippingAmount: number;
};

/**
 * Whether this purchase is a cart, as opposed to a single product or a
 * variable amount.
 *
 * The three shapes purchaseForSubmission returns are inferred as one
 * normalised union, which leaves every cart-only field optional -- so
 * `isCartPurchase(purchase)` reads as a guard but narrows nothing, and each use of
 * `purchase.subtotal` behind it stays possibly-undefined. Testing the value
 * rather than the key both narrows properly and checks the thing that actually
 * matters.
 */
const isCartPurchase = (
  purchase: CheckoutPurchase,
): purchase is CheckoutCartPurchase =>
  Array.isArray((purchase as { items?: unknown }).items);

const couponProductAmounts = (
  purchase: CheckoutPurchase,
): CouponProductAmount[] =>
  isCartPurchase(purchase)
    ? purchase.items.map((item) => ({
        amount: item.totalAmount + item.taxAmount,
        productId: item.productId,
      }))
    : purchase.productId
      ? [{ amount: purchase.amount, productId: purchase.productId }]
      : [];

const customerForSubmission = async (submissionId: string) => {
  const sql = database();
  const rows = await sql`
    SELECT
      COALESCE(
        MAX(answer.answer #>> '{}') FILTER (WHERE field.field_type = 'email'),
        ''
      ) AS email,
      COALESCE(
        MAX(answer.answer #>> '{}') FILTER (
          WHERE field.field_type = 'shortText'
            AND LOWER(field.label) LIKE '%name%'
        ),
        ''
      ) AS name
    FROM form_submission_answers answer
    LEFT JOIN form_fields field
      ON field.form_id = (
        SELECT form_id FROM form_submissions WHERE id = ${submissionId}
      )
     AND field.field_id = answer.field_id
    WHERE answer.submission_id = ${submissionId}
  `;
  return {
    email: String(rows[0]?.email || ""),
    name: String(rows[0]?.name || ""),
  };
};

const applyCoupon = async (
  userId: string,
  amount: number,
  currency: string,
  code: string,
  allowed: boolean,
  target: ReturnType<typeof checkoutTarget>,
  productIds: string[] = [],
  productAmounts: CouponProductAmount[] = [],
) => {
  if (!code) {
    return { couponId: null as string | null, discount: 0, total: amount };
  }
  if (!allowed) {
    throw new CheckoutError(
      "This coupon is not valid for the current checkout.",
      422,
      "coupon_invalid",
    );
  }
  const sql = database();
  const assignment = JSON.stringify([{ id: target.id, type: target.type }]);
  const rows = await sql`
    SELECT *
    FROM payment_coupons
    WHERE user_id = ${userId}
      AND UPPER(code) = ${code.toUpperCase()}
      AND active = TRUE
      AND (starts_at IS NULL OR starts_at <= NOW())
      AND (ends_at IS NULL OR ends_at > NOW())
      AND (
        redemption_limit IS NULL
        OR redemption_count < redemption_limit
      )
      AND (
        applies_to = '[]'::jsonb
        OR applies_to @> ${assignment}::jsonb
      )
    LIMIT 1
  `;
  if (rows.length !== 1) {
    throw new CheckoutError(
      "This coupon is not valid for the current checkout.",
      422,
      "coupon_invalid",
    );
  }
  const coupon = rows[0] as RecordValue;
  const eligibleProductIds = jsonArray(coupon.eligible_product_ids).map(String);
  const excludedProductIds = new Set(
    jsonArray(coupon.excluded_product_ids).map(String),
  );
  if (
    excludedProductIds.size > 0 &&
    productIds.some((productId) => excludedProductIds.has(productId))
  ) {
    throw new CheckoutError(
      "This coupon is not valid for one or more selected products.",
      422,
      "coupon_product_invalid",
    );
  }
  const eligibleAmount = eligibleProductIds.length
    ? productAmounts
        .filter((item) => eligibleProductIds.includes(item.productId))
        .reduce((total, item) => total + item.amount, 0)
    : amount;
  if (
    eligibleProductIds.length > 0 &&
    (productIds.length === 0 || eligibleAmount <= 0)
  ) {
    throw new CheckoutError(
      "This coupon is not valid for one or more selected products.",
      422,
      "coupon_product_invalid",
    );
  }
  if (eligibleAmount < Number(coupon.minimum_amount || 0)) {
    throw new CheckoutError(
      `This coupon requires a minimum order of ${currency} ${Number(
        coupon.minimum_amount || 0,
      ).toFixed(2)}.`,
      422,
      "coupon_minimum",
    );
  }
  if (
    coupon.discount_type === "fixed" &&
    String(coupon.currency || currency) !== currency
  ) {
    throw new CheckoutError(
      "This coupon uses a different currency.",
      422,
      "coupon_currency",
    );
  }
  const discount =
    coupon.discount_type === "percentage"
      ? eligibleAmount * (Number(coupon.discount_value || 0) / 100)
      : Number(coupon.discount_value || 0);
  const cappedDiscount =
    coupon.discount_type === "percentage" && coupon.maximum_discount != null
      ? Math.min(discount, Number(coupon.maximum_discount))
      : discount;
  const boundedDiscount = Math.min(
    eligibleAmount,
    Math.max(0, cappedDiscount),
  );
  return {
    code: String(coupon.code || code).toUpperCase(),
    couponId: String(coupon.id),
    discount: boundedDiscount,
    total: Math.max(0, amount - boundedDiscount),
  };
};

const handleCoupon = async (
  request: IncomingMessage,
  response: ServerResponse,
) => {
  await enforceCheckoutRateLimit(request, "coupon");
  const body = await readBody(request);
  const formIdentifier = String(body.formId || "");
  const submissionId = String(body.submissionId || "");
  const couponCode = String(body.couponCode || "")
    .trim()
    .toUpperCase();
  if (
    !formIdentifier ||
    formIdentifier.length > 120 ||
    !uuidPattern.test(submissionId) ||
    !couponCode ||
    couponCode.length > 80
  ) {
    throw new CheckoutError("Enter a coupon code to validate.");
  }
  const context = await formContext(formIdentifier);
  const submission = await checkoutSubmissionFor(context, submissionId);
  ensureSubmissionAwaitingPayment(submission);
  const payment = paymentValue(context);
  if (!checkoutEnabled(context, payment)) {
    throw new CheckoutError("This checkout does not accept payments.", 409);
  }
  const purchase = await purchaseForSubmission(
    context,
    submissionId,
    Number(body.amount || 0),
    checkoutCustomerFromBody(body.customer),
  );
  if (purchase.amount <= 0) {
    throw new CheckoutError("This checkout does not require payment.", 409);
  }
  const target = checkoutTarget(context);
  const acceptsCoupons = couponsEnabledForContext(context, payment);
  const couponableAmount = isCartPurchase(purchase)
    ? purchase.subtotal + purchase.taxAmount
    : purchase.amount;
  const couponProductIds = isCartPurchase(purchase)
    ? purchase.items.map((item) => item.productId).filter(Boolean)
    : purchase.productId
      ? [purchase.productId]
      : [];
  const coupon = await applyCoupon(
    String(context.user_id),
    couponableAmount,
    purchase.currency,
    couponCode,
    acceptsCoupons,
    target,
    couponProductIds,
    couponProductAmounts(purchase),
  );
  json(response, 200, {
    coupon: {
      code: coupon.code,
      id: coupon.couponId,
    },
    currency: purchase.currency,
    discount: coupon.discount,
    subtotal: couponableAmount,
    total: isCartPurchase(purchase)
      ? Math.round((coupon.total + purchase.shippingAmount) * 100) / 100
      : coupon.total,
    valid: true,
  });
};

const handleQuote = async (
  request: IncomingMessage,
  response: ServerResponse,
) => {
  await enforceCheckoutRateLimit(request, "quote");
  const body = await readBody(request);
  const formIdentifier = String(body.formId || "");
  const submissionId = String(body.submissionId || "");
  if (
    !formIdentifier ||
    formIdentifier.length > 120 ||
    !uuidPattern.test(submissionId)
  ) {
    throw new CheckoutError("This checkout request is incomplete.");
  }
  const context = await formContext(formIdentifier);
  const submission = await checkoutSubmissionFor(context, submissionId);
  ensureSubmissionAwaitingPayment(submission);
  const payment = paymentValue(context);
  if (!checkoutEnabled(context, payment)) {
    json(response, 200, {
      currency: String(payment.currency || "USD"),
      itemName: String(context.title || "Form payment"),
      paymentRequired: false,
      subtotal: 0,
      total: 0,
    });
    return;
  }
  const purchase = await purchaseForSubmission(
    context,
    submissionId,
    Number(body.amount || 0),
    checkoutCustomerFromBody(body.customer),
  );
  json(response, 200, {
    currency: purchase.currency,
    itemName: purchase.name,
    paymentRequired: purchase.amount > 0,
      subtotal: isCartPurchase(purchase) ? purchase.subtotal : purchase.amount,
      taxAmount: isCartPurchase(purchase) ? purchase.taxAmount : 0,
      shippingAmount: isCartPurchase(purchase) ? purchase.shippingAmount : 0,
      shippingDeliveryEstimate: isCartPurchase(purchase)
        ? purchase.shippingDeliveryEstimate
        : "",
      shippingLabel: isCartPurchase(purchase) ? purchase.shippingLabel : "",
      items: isCartPurchase(purchase)
      ? purchase.items.map((item) => ({
          name: item.name,
          variantName: item.variantName,
          quantity: item.quantity,
          unitPrice: item.unitAmount,
          totalAmount: item.totalAmount,
        }))
      : [{
          name: purchase.name,
          variantName: "",
          quantity: purchase.quantity,
          unitPrice: purchase.unitAmount,
          totalAmount: purchase.amount,
        }],
    total: purchase.amount,
  });
};

const stripeRecurringInterval = (interval: BillingInterval) => ({
  count: interval === "quarter" ? 3 : 1,
  unit: interval === "quarter" ? "month" : interval,
});

const paypalRecurringInterval = (interval: BillingInterval) => ({
  count: interval === "quarter" ? 3 : 1,
  unit: (interval === "quarter" ? "MONTH" : interval.toUpperCase()) as
    | "WEEK"
    | "MONTH"
    | "YEAR",
});

const paystackRecurringInterval = (interval: BillingInterval) =>
  interval === "year" ? "annually" : interval === "quarter" ? "quarterly" : `${interval}ly`;

const storedProviderPlan = async (
  productId: string,
  provider: "paypal" | "paystack",
) => {
  const sql = database();
  const rows = await sql`
    SELECT jsonb_extract_path_text(metadata, 'providerPlans', ${provider})
      AS plan_id
    FROM payment_products
    WHERE id = ${productId}
    LIMIT 1
  `;
  return String(rows[0]?.plan_id || "");
};

const saveProviderPlan = async (
  productId: string,
  provider: "paypal" | "paystack",
  planId: string,
) => {
  const sql = database();
  await sql`
    UPDATE payment_products
    SET metadata = COALESCE(metadata, '{}'::jsonb) ||
      jsonb_build_object(
        'providerPlans',
        COALESCE(metadata->'providerPlans', '{}'::jsonb) ||
          jsonb_build_object(${provider}, ${planId})
      ),
      updated_at = NOW()
    WHERE id = ${productId}
  `;
};

const ensurePaystackPlan = async (input: {
  amountMinor: number;
  credentials: Credentials;
  currency: string;
  interval: BillingInterval;
  itemName: string;
  productId: string;
}) => {
  const saved = await storedProviderPlan(input.productId, "paystack");
  if (saved) return saved;
  const value = await fetchJson("https://api.paystack.co/plan", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.credentials.secretKey || ""}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: input.amountMinor,
      currency: input.currency,
      interval: paystackRecurringInterval(input.interval),
      name: input.itemName.slice(0, 100),
    }),
  });
  const data = (value.data || {}) as RecordValue;
  const planId = String(data.plan_code || "");
  if (!planId) {
    throw new CheckoutError("Paystack could not prepare recurring billing.");
  }
  await saveProviderPlan(input.productId, "paystack", planId);
  return planId;
};

const ensurePaypalPlan = async (input: {
  amount: number;
  credentials: Credentials;
  currency: string;
  interval: BillingInterval;
  itemName: string;
  productId: string;
  token: string;
}) => {
  const saved = await storedProviderPlan(input.productId, "paypal");
  if (saved) return saved;
  const headers = {
    Authorization: `Bearer ${input.token}`,
    "Content-Type": "application/json",
    "PayPal-Auth-Assertion": paypalAssertion(
      input.credentials.merchantId || "",
    ),
  };
  const product = await fetchJson(`${paypalBase()}/v1/catalogs/products`, {
    method: "POST",
    headers: {
      ...headers,
      "PayPal-Request-Id": `product-${input.productId}`,
    },
    body: JSON.stringify({
      description: input.itemName.slice(0, 256),
      name: input.itemName.slice(0, 127),
      type: "SERVICE",
    }),
  });
  const productId = String(product.id || "");
  if (!productId) {
    throw new CheckoutError("PayPal could not prepare recurring billing.");
  }
  const frequency = paypalRecurringInterval(input.interval);
  const plan = await fetchJson(`${paypalBase()}/v1/billing/plans`, {
    method: "POST",
    headers: {
      ...headers,
      "PayPal-Request-Id": `plan-${input.productId}`,
    },
    body: JSON.stringify({
      billing_cycles: [
        {
          frequency: {
            interval_count: frequency.count,
            interval_unit: frequency.unit,
          },
          pricing_scheme: {
            fixed_price: {
              currency_code: input.currency,
              value: input.amount.toFixed(2),
            },
          },
          sequence: 1,
          tenure_type: "REGULAR",
          total_cycles: 0,
        },
      ],
      description: input.itemName.slice(0, 127),
      name: input.itemName.slice(0, 127),
      payment_preferences: {
        auto_bill_outstanding: true,
        payment_failure_threshold: 3,
      },
      product_id: productId,
      status: "ACTIVE",
    }),
  });
  const planId = String(plan.id || "");
  if (!planId) {
    throw new CheckoutError("PayPal could not prepare recurring billing.");
  }
  await saveProviderPlan(input.productId, "paypal", planId);
  return planId;
};

const handleOptions = async (
  response: ServerResponse,
  url: URL,
) => {
  const identifier = url.searchParams.get("form") || "";
  const context = await formContext(identifier);
  const payment = paymentValue(context);
  const enabled = checkoutEnabled(context, payment);
  const eventTicketing = Boolean(context.event_id && context.ticketing_enabled);
  const workspace = {
    accentColor: String(context.workspace_brand_color || "#F93D0A"),
    logoUrl: String(context.workspace_logo_url || ""),
    name: String(context.workspace_name || "MaxForm workspace"),
  };
  if (!enabled) {
    json(response, 200, {
      allowCoupons: false,
      enabled: false,
      providers: [],
      workspace,
    });
    return;
  }
  const providers = await connectedProviders(
    String(context.user_id),
    String(payment.provider || "workspace"),
  );
  const allowCoupons = couponsEnabledForContext(context, payment);
  let recurring = false;
  if (String(payment.mode || "") === "product" && payment.productId) {
    const sql = database();
    const products = await sql`
      SELECT billing_type
      FROM payment_products
      WHERE id = ${String(payment.productId)}
        AND user_id = ${String(context.user_id)}
        AND active = TRUE
      LIMIT 1
    `;
    recurring = products[0]?.billing_type === "recurring";
  }
  const checkoutProviders = recurring
    ? providers.filter((provider) => provider.provider !== "opay")
    : providers;
  const mode = eventTicketing ? "product" : String(payment.mode || "fixed");
  const amount =
    !eventTicketing && context.event_id && context.event_pricing_enabled === true
      ? Number(context.event_pricing_amount || 0)
      : Number(payment.amount || 0);
  const currency =
    !eventTicketing && context.event_id && context.event_pricing_currency
      ? String(context.event_pricing_currency)
      : String(payment.currency || "USD");
  json(response, 200, {
    enabled: true,
    mode,
    amount,
    currency,
    allowCoupons,
    workspace,
    providers: checkoutProviders.map((provider) => ({
      id: provider.provider,
      name:
        provider.provider === "opay"
          ? "OPay"
          : String(provider.provider).slice(0, 1).toUpperCase() +
            String(provider.provider).slice(1),
      accountName: String(provider.external_account_name || ""),
    })),
  });
};

type ProviderCheckoutInput = {
  amount: number;
  billingInterval: BillingInterval | null;
  billingType: "one_time" | "recurring";
  cancelUrl: string;
  connection: RecordValue;
  currency: string;
  customerEmail: string;
  customerName: string;
  itemName: string;
  orderId: string;
  orderNumber: string;
  productId: string | null;
  returnUrl: string;
  webhookUrl: string;
};

export const initializePaystackCheckout = async (
  input: Omit<ProviderCheckoutInput, "connection">,
  credentials: Credentials,
) => {
  if (!input.customerEmail) {
    throw new CheckoutError(
      "Add an email address before continuing to payment.",
    );
  }
  const amountMinor = Math.round(input.amount * 100);
  const recurring = input.billingType === "recurring" && input.billingInterval;
  const plan =
    recurring && input.productId
      ? await ensurePaystackPlan({
          amountMinor,
          credentials,
          currency: input.currency,
          interval: input.billingInterval!,
          itemName: input.itemName,
          productId: input.productId,
        })
      : "";
  const value = await fetchJson(
    "https://api.paystack.co/transaction/initialize",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.secretKey || ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: amountMinor,
        callback_url: input.returnUrl,
        currency: input.currency,
        email: input.customerEmail,
        metadata: {
          maxform_order_id: input.orderId,
          customer_name: input.customerName,
        },
        ...(plan ? { plan } : {}),
        reference: input.orderNumber,
      }),
    },
  );
  const data = (value.data || {}) as RecordValue;
  if (value.status !== true || !data.authorization_url) {
    throw new CheckoutError("Paystack could not start checkout.", 422);
  }
  return {
    reference: String(data.reference || input.orderNumber),
    url: String(data.authorization_url),
  };
};

const createProviderCheckout = async (input: ProviderCheckoutInput) => {
  const provider = String(input.connection.provider) as Provider;
  const credentials = decrypt(String(input.connection.credentials_encrypted));
  const amountMinor = Math.round(input.amount * 100);

  if (provider === "stripe") {
    const recurring =
      input.billingType === "recurring" && input.billingInterval;
    const body = new URLSearchParams({
      mode: recurring ? "subscription" : "payment",
      success_url: input.returnUrl,
      cancel_url: input.cancelUrl,
      client_reference_id: input.orderId,
      customer_email: input.customerEmail,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": input.currency.toLowerCase(),
      "line_items[0][price_data][unit_amount]": String(amountMinor),
      "line_items[0][price_data][product_data][name]": input.itemName,
      "metadata[maxform_order_id]": input.orderId,
    });
    if (recurring) {
      const frequency = stripeRecurringInterval(input.billingInterval!);
      body.set(
        "line_items[0][price_data][recurring][interval]",
        frequency.unit,
      );
      body.set(
        "line_items[0][price_data][recurring][interval_count]",
        String(frequency.count),
      );
      body.set(
        "subscription_data[metadata][maxform_order_id]",
        input.orderId,
      );
    }
    const value = await fetchJson(
      "https://api.stripe.com/v1/checkout/sessions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credentials.accessToken || ""}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Idempotency-Key": `checkout-${input.orderId}`,
        },
        body,
      },
    );
    return {
      reference: String(value.id || ""),
      url: String(value.url || ""),
    };
  }

  if (provider === "paystack") {
    const { connection: _connection, ...paystackInput } = input;
    return initializePaystackCheckout(paystackInput, credentials);
  }

  if (provider === "paypal") {
    const token = await paypalToken();
    if (input.billingType === "recurring") {
      if (!input.billingInterval || !input.productId) {
        throw new CheckoutError(
          "This recurring product is not configured correctly.",
        );
      }
      const planId = await ensurePaypalPlan({
        amount: input.amount,
        credentials,
        currency: input.currency,
        interval: input.billingInterval,
        itemName: input.itemName,
        productId: input.productId,
        token,
      });
      const names = input.customerName.trim().split(/\s+/);
      const value = await fetchJson(
        `${paypalBase()}/v1/billing/subscriptions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "PayPal-Auth-Assertion": paypalAssertion(
              credentials.merchantId || "",
            ),
            "PayPal-Request-Id": `subscription-${input.orderId}`,
          },
          body: JSON.stringify({
            application_context: {
              cancel_url: input.cancelUrl,
              return_url: input.returnUrl,
              user_action: "SUBSCRIBE_NOW",
            },
            custom_id: input.orderId,
            plan_id: planId,
            subscriber: {
              email_address: input.customerEmail,
              name: {
                given_name: names[0] || "Customer",
                surname: names.slice(1).join(" ") || "Customer",
              },
            },
          }),
        },
      );
      const links = Array.isArray(value.links)
        ? (value.links as Array<RecordValue>)
        : [];
      return {
        reference: String(value.id || ""),
        url: String(
          links.find((link) => link.rel === "approve")?.href || "",
        ),
      };
    }
    const value = await fetchJson(`${paypalBase()}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "PayPal-Auth-Assertion": paypalAssertion(
          credentials.merchantId || "",
        ),
        "PayPal-Request-Id": `checkout-${input.orderId}`,
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            custom_id: input.orderId,
            invoice_id: input.orderNumber,
            amount: {
              currency_code: input.currency,
              value: input.amount.toFixed(2),
            },
            description: input.itemName,
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              return_url: input.returnUrl,
              cancel_url: input.cancelUrl,
              user_action: "PAY_NOW",
            },
          },
        },
      }),
    });
    const links = Array.isArray(value.links)
      ? (value.links as Array<RecordValue>)
      : [];
    return {
      reference: String(value.id || ""),
      url: String(
        links.find((link) => link.rel === "payer-action")?.href ||
          links.find((link) => link.rel === "approve")?.href ||
          "",
      ),
    };
  }

  if (input.billingType === "recurring") {
    throw new CheckoutError(
      "Choose Stripe, PayPal, or Paystack for recurring billing.",
      409,
      "recurring_provider_unavailable",
    );
  }
  const opayBase =
    process.env.PAYMENT_MODE === "live"
      ? "https://liveapi.opaycheckout.com"
      : "https://testapi.opaycheckout.com";
  const value = await fetchJson(
    `${opayBase}/api/v1/international/cashier/create`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.publicKey || ""}`,
        "Content-Type": "application/json",
        MerchantId: credentials.merchantId || "",
      },
      body: JSON.stringify({
        amount: { currency: input.currency, total: amountMinor },
        callbackUrl: input.webhookUrl,
        cancelUrl: input.cancelUrl,
        country: credentials.country || "NG",
        customerVisitSource: "WEB",
        evokeOpay: true,
        expireAt: 30,
        product: { description: input.itemName, name: input.itemName },
        reference: input.orderNumber,
        returnUrl: input.returnUrl,
      }),
    },
  );
  const data = (value.data || {}) as RecordValue;
  if (String(value.code || "") !== "00000" || !data.cashierUrl) {
    throw new CheckoutError("OPay could not start checkout.", 422);
  }
  return {
    reference: String(data.reference || input.orderNumber),
    url: String(data.cashierUrl),
  };
};

const handleCreate = async (
  request: IncomingMessage,
  response: ServerResponse,
) => {
  await enforceCheckoutRateLimit(request, "create");
  const body = await readBody(request);
  const couponIdentity = couponIdentityForRequest(request, body);
  const formIdentifier = String(body.formId || "");
  const submissionId = String(body.submissionId || "");
  const provider = String(body.provider || "");
  const idempotencyKey = String(body.idempotencyKey || "");
  if (
    !formIdentifier || formIdentifier.length > 120 ||
    !uuidPattern.test(submissionId) ||
    Boolean(provider && !isPaidProvider(provider)) ||
    !/^[0-9a-f-]{30,40}$/i.test(idempotencyKey)
  ) {
    throw new CheckoutError("This checkout request is incomplete.");
  }
  const context = await formContext(formIdentifier);
  const sql = database();
  const submission = await checkoutSubmissionFor(context, submissionId);
  const existing = await sql`
    SELECT attempt.checkout_url, attempt.status, attempt.order_id,
      attempt.submission_id, attempt.user_id, payment_order.order_number
    FROM checkout_attempts attempt
    LEFT JOIN payment_orders payment_order ON payment_order.id = attempt.order_id
    WHERE attempt.idempotency_key = ${idempotencyKey}
    LIMIT 1
  `;
  if (
    existing.length === 1 &&
    (String(existing[0].submission_id || "") !== submissionId ||
      String(existing[0].user_id || "") !== String(context.user_id))
  ) {
    throw new CheckoutError(
      "This checkout key cannot be used for a different response.",
      409,
      "checkout_key_reused",
    );
  }
  if (existing.length === 1 && existing[0].status === "confirmed") {
    json(response, 200, {
      attemptKey: idempotencyKey,
      free: true,
      status: "confirmed",
    });
    return;
  }
  ensureSubmissionAwaitingPayment(submission);
  if (existing.length === 1 && existing[0].checkout_url) {
    json(response, 200, {
      attemptKey: idempotencyKey,
      checkoutUrl: existing[0].checkout_url,
      status: existing[0].status,
    });
    return;
  }
  if (
    existing.length === 1 &&
    existing[0].status !== "failed"
  ) {
    throw new CheckoutError(
      "This checkout is already being prepared. Please try again in a moment.",
      409,
      "checkout_in_progress",
    );
  }
  const reusingFailedAttempt =
    existing.length === 1 &&
    existing[0].status === "failed" &&
    Boolean(existing[0].order_id);
  const payment = paymentValue(context);
  if (!checkoutEnabled(context, payment)) {
    await sql`
      UPDATE form_submissions
      SET data = jsonb_set(
        jsonb_set(data, '{_meta,status}', '"completed"', TRUE),
        '{_meta,paymentStatus}', '"not_required"', TRUE
      )
      WHERE id = ${submissionId}
    `;
    json(response, 200, { free: true });
    return;
  }
  const checkoutCustomer = checkoutCustomerFromBody(body.customer);
  const purchase = await purchaseForSubmission(
    context,
    submissionId,
    Number(body.amount || 0),
    checkoutCustomer,
  );
  const orderItems: CheckoutPurchaseItem[] = isCartPurchase(purchase)
    ? purchase.items
    : [{
        productId: purchase.productId || "",
        variantId: null,
        name: purchase.name,
        variantName: "",
        sku: "",
        description: purchase.description,
        quantity: purchase.quantity,
         unitAmount: purchase.unitAmount,
         totalAmount: purchase.amount,
         taxAmount: 0,
         requiresShipping: false,
         weightGrams: 0,
       }];
  const orderSubtotal = isCartPurchase(purchase) ? purchase.subtotal : purchase.amount;
  const orderTaxAmount = isCartPurchase(purchase) ? purchase.taxAmount : 0;
  const orderShippingAmount = isCartPurchase(purchase) ? purchase.shippingAmount : 0;
  const couponCode = String(body.couponCode || "").trim();
  const target = checkoutTarget(context);
  const acceptsCoupons = couponsEnabledForContext(context, payment);
  const couponableAmount = isCartPurchase(purchase)
    ? purchase.subtotal + purchase.taxAmount
    : purchase.amount;
  const couponProductIds = isCartPurchase(purchase)
    ? purchase.items.map((item) => item.productId).filter(Boolean)
    : purchase.productId
      ? [purchase.productId]
      : [];
  const coupon = await applyCoupon(
    String(context.user_id),
    couponableAmount,
    purchase.currency,
    couponCode,
    acceptsCoupons,
    target,
    couponProductIds,
    couponProductAmounts(purchase),
  );
  if (purchase.billingType === "recurring" && coupon.total <= 0) {
    throw new CheckoutError(
      "This coupon cannot reduce a recurring payment to zero.",
      422,
      "recurring_coupon_zero",
    );
  }
  const checkoutTotal = isCartPurchase(purchase)
    ? Math.round((coupon.total + purchase.shippingAmount) * 100) / 100
    : coupon.total;
  const couponPaysFull = checkoutTotal <= 0;
  if (!couponPaysFull && !checkoutCustomerComplete(checkoutCustomer)) {
    throw new CheckoutError(
      "Complete the billing contact and address before continuing to payment.",
      422,
      "checkout_customer_incomplete",
    );
  }
  const submissionCustomer = await customerForSubmission(submissionId);
  const customer = {
    email: checkoutCustomer.email || submissionCustomer.email,
    name: customerNameFromDetails(checkoutCustomer) || submissionCustomer.name,
  };
  const attributionMessageId = campaignAttributionMessageId(request);
  const attribution =
    uuidPattern.test(attributionMessageId) && customer.email
      ? await sql`
          SELECT campaign.id AS campaign_id
          FROM contact_campaign_messages message
          JOIN contact_campaigns campaign ON campaign.id = message.campaign_id
          WHERE message.id = ${attributionMessageId}::uuid
            AND campaign.user_id = ${String(context.user_id)}::uuid
            AND LOWER(message.recipient) = LOWER(${customer.email})
          LIMIT 1
        `
      : [];
  const sourceCampaignId = String(attribution[0]?.campaign_id || "") || null;
  const orderMetadata = {
    checkoutCustomer,
    formId: context.form_id,
    submissionId,
    ...(isCartPurchase(purchase) && purchase.shippingLabel
      ? {
          shipping: {
            deliveryEstimate: purchase.shippingDeliveryEstimate,
            label: purchase.shippingLabel,
          },
        }
      : {}),
    ...(sourceCampaignId ? { campaignAttribution: sourceCampaignId } : {}),
  };
  const orderProvider = couponPaysFull ? "coupon" : provider;
  let connection: RecordValue | null = null;
  if (!couponPaysFull) {
    if (!isPaidProvider(provider)) {
      throw new CheckoutError(
        "Choose an available payment method to continue.",
        422,
        "provider_required",
      );
    }
    const connections = await connectedProviders(
      String(context.user_id),
      String(payment.provider || "workspace"),
    );
    connection =
      connections.find((item) => item.provider === provider) || null;
    if (!connection) {
      throw new CheckoutError(
        "This payment method is not available. Choose another method.",
        409,
      );
    }
  }
  const orderId = reusingFailedAttempt
    ? String(existing[0].order_id)
    : randomUUID();
  const orderNumber = reusingFailedAttempt
    ? String(existing[0].order_number)
    : `MF-${Date.now().toString(36).toUpperCase()}-${randomUUID()
        .slice(0, 5)
        .toUpperCase()}`;
  if (reusingFailedAttempt) {
    await sql`SELECT maxform_release_payment_inventory(${orderId}::uuid)`;
    await sql`
      WITH reset_order AS (
        UPDATE payment_orders
        SET source_type = ${purchase.sourceType},
            source_id = ${purchase.sourceId},
            source_campaign_id = ${sourceCampaignId},
            customer_name = ${customer.name},
            customer_email = ${customer.email},
            status = 'pending',
            provider = ${orderProvider},
            provider_reference = '',
            subtotal = ${orderSubtotal},
            discount_amount = ${coupon.discount},
            tax_amount = ${orderTaxAmount},
            shipping_amount = ${orderShippingAmount},
            total_amount = ${checkoutTotal},
            currency = ${purchase.currency},
            coupon_id = ${coupon.couponId},
            failure_reason = '',
            metadata =
              ${JSON.stringify(orderMetadata)}::jsonb,
            updated_at = NOW()
        WHERE id = ${orderId}
        RETURNING id
      ),
      removed_items AS (
        DELETE FROM payment_order_items
        WHERE order_id = ${orderId}
        RETURNING id
      )
      UPDATE checkout_attempts
      SET provider = ${orderProvider},
          source_type = ${purchase.sourceType},
          source_id = ${purchase.sourceId},
          submission_id = ${submissionId},
          status = 'pending',
          checkout_url = '',
          provider_reference = '',
          error_code = '',
          expires_at = NOW() + INTERVAL '30 minutes'
      WHERE idempotency_key = ${idempotencyKey}
    `;
  } else {
    await sql`
      WITH saved_order AS (
        INSERT INTO payment_orders (
          id, user_id, order_number, source_type, source_id, source_campaign_id,
          customer_name, customer_email, status, provider, subtotal, discount_amount,
          tax_amount, shipping_amount, total_amount, currency, coupon_id, metadata, created_at,
          updated_at
        )
        VALUES (
          ${orderId}, ${String(context.user_id)}, ${orderNumber},
          ${purchase.sourceType}, ${purchase.sourceId}, ${sourceCampaignId}, ${customer.name},
          ${customer.email}, 'pending', ${orderProvider}, ${orderSubtotal},
          ${coupon.discount}, ${orderTaxAmount}, ${orderShippingAmount}, ${checkoutTotal}, ${purchase.currency},
          ${coupon.couponId},
          ${JSON.stringify(orderMetadata)}::jsonb,
          NOW(), NOW()
        )
        RETURNING id
      )
      INSERT INTO checkout_attempts (
        user_id, idempotency_key, provider, source_type, source_id,
        submission_id, status, order_id, expires_at, created_at
      )
      VALUES (
        ${String(context.user_id)}, ${idempotencyKey}, ${orderProvider},
        ${purchase.sourceType}, ${purchase.sourceId}, ${submissionId},
        'pending', ${orderId}, NOW() + INTERVAL '30 minutes', NOW()
      )
    `;
  }
  await sql`DELETE FROM payment_order_items WHERE order_id = ${orderId}`;
  for (const item of orderItems) {
    await sql`
      INSERT INTO payment_order_items (
        order_id, product_id, variant_id, name, variant_name, sku,
        description, quantity, unit_price, total_amount, metadata, created_at
      ) VALUES (
        ${orderId}, ${item.productId || null}, ${item.variantId}, ${item.name},
        ${item.variantName}, ${item.sku}, ${item.description}, ${item.quantity},
        ${item.unitAmount}, ${item.totalAmount},
        ${JSON.stringify({
          taxAmount: item.taxAmount,
          requiresShipping: item.requiresShipping,
          weightGrams: item.weightGrams,
        })}::jsonb,
        NOW()
      )
    `;
  }
  if (isCartPurchase(purchase)) {
    try {
      await sql`
        SELECT maxform_reserve_payment_inventory(
          ${orderId}::uuid,
          ${JSON.stringify(orderItems.map((item) => ({
            productId: item.productId,
            variantId: item.variantId || "",
            quantity: item.quantity,
          })))}::jsonb,
          30
        )
      `;
    } catch {
      await sql`DELETE FROM checkout_attempts WHERE idempotency_key = ${idempotencyKey}`;
      await sql`DELETE FROM payment_orders WHERE id = ${orderId} AND status <> 'paid'`;
      throw new CheckoutError(
        "One or more products just sold out. Return to the form and update the quantity.",
        409,
        "cart_inventory",
      );
    }
  }
  if (coupon.couponId) {
    const reservations = await sql`
      SELECT maxform_reserve_payment_coupon(
        ${coupon.couponId}::uuid,
        ${orderId}::uuid,
        ${couponIdentity.ipHash},
        ${couponIdentity.deviceHash}
      ) AS reserved
    `;
    if (reservations[0]?.reserved !== true) {
      await sql`SELECT maxform_release_payment_inventory(${orderId}::uuid)`;
      await sql`
        DELETE FROM checkout_attempts
        WHERE idempotency_key = ${idempotencyKey}
      `;
      await sql`
        DELETE FROM payment_orders
        WHERE id = ${orderId} AND status <> 'paid'
      `;
      throw new CheckoutError(
        "This coupon cannot be used again from this device or network, or it has reached its overall usage limit. Remove the code or use another eligible coupon.",
        422,
        "coupon_redemption_limited",
      );
    }
  }
  if (checkoutTotal <= 0) {
    await completeAttempt(
      {
        idempotency_key: idempotencyKey,
        order_id: orderId,
        submission_id: submissionId,
      },
      `coupon-${orderNumber}`,
    );
    json(response, 200, {
      attemptKey: idempotencyKey,
      checkoutUrl: paymentVerificationUrl(
        request,
        context,
        idempotencyKey,
      ),
      free: true,
      status: "confirmed",
    });
    return;
  }
  if (!connection || !isPaidProvider(provider)) {
    await sql`SELECT maxform_release_payment_inventory(${orderId}::uuid)`;
    throw new CheckoutError(
      "Choose an available payment method to continue.",
      422,
      "provider_required",
    );
  }
  const origin = originFor(request);
  // The workspace's already-public branding is embedded so verification
  // renders correctly on its first paint, before the status request returns.
  const returnUrl = paymentVerificationUrl(request, context, idempotencyKey);
  try {
    const checkout = await createProviderCheckout({
      amount: checkoutTotal,
      billingInterval: purchase.billingInterval,
      billingType: purchase.billingType,
      cancelUrl: `${origin}/forms/${encodeURIComponent(String(context.user_id))}/${encodeURIComponent(String(context.slug))}?payment=cancelled`,
      connection,
      currency: purchase.currency,
      customerEmail: customer.email,
      customerName: customer.name,
      itemName: purchase.name,
      orderId,
      orderNumber,
      productId: purchase.productId,
      returnUrl,
      webhookUrl: `${origin}/api/payments/checkout?action=webhook&provider=${provider}`,
    });
    if (!checkout.url || !checkout.reference) {
      throw new CheckoutError("The provider did not return a checkout page.");
    }
    await sql`
      UPDATE checkout_attempts
      SET status = 'redirected',
          checkout_url = ${checkout.url},
          provider_reference = ${checkout.reference}
      WHERE idempotency_key = ${idempotencyKey}
    `;
    await sql`
      UPDATE payment_orders
      SET provider_reference = ${checkout.reference}, updated_at = NOW()
      WHERE id = ${orderId}
    `;
    json(response, 200, {
      attemptKey: idempotencyKey,
      checkoutUrl: checkout.url,
      status: "redirected",
    });
  } catch (error) {
    await sql`
      SELECT maxform_release_payment_coupon(${orderId}::uuid)
    `;
    await sql`SELECT maxform_release_payment_inventory(${orderId}::uuid)`;
    await sql`
      UPDATE checkout_attempts
      SET status = 'failed', error_code = 'provider_checkout_failed'
      WHERE idempotency_key = ${idempotencyKey}
    `;
    await sql`
      UPDATE payment_orders
      SET status = 'failed',
          failure_reason = 'Checkout could not be started',
          updated_at = NOW()
      WHERE id = ${orderId}
    `;
    void dispatchWorkspaceWorkflowEvent(
      String(context.user_id),
      "payment_failed",
      { id: orderId, orderId, error: error instanceof Error ? error.message : "Checkout could not be started" },
      `payment_failed:${orderId}:${idempotencyKey}`,
    ).catch(() => undefined);
    throw error;
  }
};

export const providerPaymentStatus = async (
  attempt: RecordValue,
  credentials: Credentials,
): Promise<ProviderPaymentResult> => {
  const provider = String(attempt.provider) as Provider;
  const reference = String(attempt.provider_reference || "");
  const expectedMinor = Math.round(
    Number(attempt.total_amount || 0) * 100,
  );
  const expectedCurrency = String(attempt.currency || "").toUpperCase();
  if (
    !reference ||
    !Number.isSafeInteger(expectedMinor) ||
    expectedMinor <= 0 ||
    !/^[A-Z]{3}$/.test(expectedCurrency)
  ) {
    return { paid: false, transactionId: reference };
  }
  const matchesOrder = (amountMinor: unknown, currency: unknown) => {
    const receivedMinor = Number(amountMinor);
    return (
      Number.isFinite(receivedMinor) &&
      Math.round(receivedMinor) === expectedMinor &&
      String(currency || "").toUpperCase() === expectedCurrency
    );
  };
  if (provider === "stripe") {
    const value = await fetchJson(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${credentials.accessToken || ""}` } },
    );
    return {
      paid:
        value.payment_status === "paid" &&
        matchesOrder(value.amount_total, value.currency),
      subscriptionId: String(value.subscription || ""),
      transactionId: String(value.payment_intent || reference),
    };
  }
  if (provider === "paystack") {
    const value = await fetchJson(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${credentials.secretKey || ""}` } },
    );
    const data = (value.data || {}) as RecordValue;
    return {
      paid:
        value.status === true &&
        data.status === "success" &&
        matchesOrder(data.amount, data.currency),
      subscriptionId: String(
        ((data.subscription || {}) as RecordValue).subscription_code || "",
      ),
      transactionId: String(data.reference || reference),
    };
  }
  if (provider === "paypal") {
    const token = await paypalToken();
    if (attempt.billing_type === "recurring") {
      const value = await fetchJson(
        `${paypalBase()}/v1/billing/subscriptions/${encodeURIComponent(reference)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "PayPal-Auth-Assertion": paypalAssertion(
              credentials.merchantId || "",
            ),
          },
        },
      );
      const billingInfo = recordValue(value.billing_info);
      const lastPayment = recordValue(billingInfo.last_payment);
      const lastPaymentAmount = recordValue(lastPayment.amount);
      return {
        // APPROVED means the buyer accepted the mandate, not that PayPal has
        // collected the first charge. Only an active subscription with a
        // matching, settled initial payment can complete the response.
        paid:
          value.status === "ACTIVE" &&
          matchesOrder(
            Number(lastPaymentAmount.value || 0) * 100,
            lastPaymentAmount.currency_code,
          ),
        subscriptionId: String(value.id || reference),
        transactionId: String(value.id || reference),
      };
    }
    let value = await fetchJson(
      `${paypalBase()}/v2/checkout/orders/${encodeURIComponent(reference)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "PayPal-Auth-Assertion": paypalAssertion(
            credentials.merchantId || "",
          ),
        },
      },
    );
    if (value.status === "APPROVED") {
      value = await fetchJson(
        `${paypalBase()}/v2/checkout/orders/${encodeURIComponent(reference)}/capture`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "PayPal-Auth-Assertion": paypalAssertion(
              credentials.merchantId || "",
            ),
            "PayPal-Request-Id": `capture-${String(attempt.order_id)}`,
          },
          body: "{}",
        },
      );
    }
    const purchaseUnits = Array.isArray(value.purchase_units)
      ? (value.purchase_units as Array<RecordValue>)
      : [];
    const payments = (purchaseUnits[0]?.payments || {}) as RecordValue;
    const captures = Array.isArray(payments.captures)
      ? (payments.captures as Array<RecordValue>)
      : [];
    const capturedAmount = (captures[0]?.amount || {}) as RecordValue;
    const orderedAmount = (purchaseUnits[0]?.amount || {}) as RecordValue;
    return {
      paid:
        value.status === "COMPLETED" &&
        matchesOrder(
          Number(capturedAmount.value || orderedAmount.value || 0) * 100,
          capturedAmount.currency_code || orderedAmount.currency_code,
        ),
      transactionId: String(captures[0]?.id || value.id || reference),
    };
  }
  const payload = {
    country: credentials.country || "NG",
    reference,
  };
  const signature = createHmac("sha512", credentials.secretKey || "")
    .update(JSON.stringify(payload))
    .digest("hex");
  const base =
    process.env.PAYMENT_MODE === "live"
      ? "https://liveapi.opaycheckout.com"
      : "https://testapi.opaycheckout.com";
  const value = await fetchJson(
    `${base}/api/v1/international/cashier/status`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${signature}`,
        "Content-Type": "application/json",
        MerchantId: credentials.merchantId || "",
      },
      body: JSON.stringify(payload),
    },
  );
  const data = (value.data || {}) as RecordValue;
  const providerAmount = (data.amount || {}) as RecordValue;
  return {
    paid:
      String(data.status || data.orderStatus || "") === "SUCCESS" &&
      matchesOrder(
        providerAmount.total || data.totalAmount,
        providerAmount.currency || data.currency,
      ),
    transactionId: String(data.orderNo || reference),
  };
};

export const syncPaidOrderToCrm = async (orderId: string) => {
  const sql = database();
  await sql`
    WITH paid_order AS (
      SELECT payment_order.*,
        LOWER(TRIM(payment_order.customer_email)) AS normalized_email
      FROM payment_orders payment_order
      WHERE payment_order.id = ${orderId}
        AND payment_order.status = 'paid'
        AND LENGTH(TRIM(payment_order.customer_email)) BETWEEN 3 AND 254
        AND LOWER(TRIM(payment_order.customer_email)) LIKE '%_@_%._%'
    ),
    synced_contact AS (
      INSERT INTO contacts (
        email, full_name, phone, tags, custom_fields, created_by,
        lifecycle_stage, source_type, source_id, last_activity_at,
        created_at, updated_at
      )
      SELECT paid_order.normalized_email,
        NULLIF(TRIM(paid_order.customer_name), ''),
        NULLIF(
          TRIM(COALESCE(
            paid_order.metadata #>> '{checkoutCustomer,phone}',
            ''
          )),
          ''
        ),
        '[]'::jsonb, '{}'::jsonb, paid_order.user_id,
        'customer', 'payment', paid_order.id,
        COALESCE(paid_order.paid_at, NOW()), NOW(), NOW()
      FROM paid_order
      ON CONFLICT (created_by, LOWER(email))
      DO UPDATE SET
        full_name = COALESCE(
          NULLIF(EXCLUDED.full_name, ''),
          contacts.full_name
        ),
        phone = COALESCE(NULLIF(EXCLUDED.phone, ''), contacts.phone),
        lifecycle_stage = 'customer',
        source_type = CASE
          WHEN contacts.source_type = 'manual' THEN 'payment'
          ELSE contacts.source_type
        END,
        source_id = CASE
          WHEN contacts.source_type = 'manual' THEN EXCLUDED.source_id
          ELSE contacts.source_id
        END,
        last_activity_at = GREATEST(
          COALESCE(contacts.last_activity_at, EXCLUDED.last_activity_at),
          EXCLUDED.last_activity_at
        ),
        updated_at = NOW()
      RETURNING id, created_by
    ),
    linked_order AS (
      UPDATE payment_orders payment_order
      SET contact_id = synced_contact.id, updated_at = NOW()
      FROM paid_order, synced_contact
      WHERE payment_order.id = paid_order.id
        AND payment_order.user_id = synced_contact.created_by
        AND payment_order.contact_id IS DISTINCT FROM synced_contact.id
      RETURNING payment_order.id
    ),
    linked_subscriptions AS (
      UPDATE payment_subscriptions subscription
      SET contact_id = synced_contact.id, updated_at = NOW()
      FROM paid_order, synced_contact
      WHERE subscription.user_id = paid_order.user_id
        AND (
          subscription.initial_order_id = paid_order.id
          OR (
            paid_order.source_type = 'subscription'
            AND subscription.id = paid_order.source_id
          )
        )
        AND subscription.contact_id IS DISTINCT FROM synced_contact.id
      RETURNING subscription.id
    ),
    linked_deals AS (
      UPDATE deals deal
      SET contact_id = COALESCE(deal.contact_id, synced_contact.id),
          updated_at = NOW()
      FROM paid_order, synced_contact
      WHERE deal.user_id = paid_order.user_id
        AND deal.order_id = paid_order.id
        AND deal.contact_id IS NULL
      RETURNING deal.id
    ),
    attached_lists AS (
      INSERT INTO contact_list_members (
        list_id, contact_id, source_type, source_id, added_at
      )
      SELECT mapping.list_id, synced_contact.id, 'payment', paid_order.id, NOW()
      FROM paid_order
      JOIN checkout_attempts attempt ON attempt.order_id = paid_order.id
      JOIN form_submissions submission
        ON submission.id = attempt.submission_id
      JOIN form_list_mappings mapping ON mapping.form_id = submission.form_id
      JOIN contact_lists list
        ON list.id = mapping.list_id
       AND list.user_id = paid_order.user_id
      CROSS JOIN synced_contact
      ON CONFLICT (list_id, contact_id) DO NOTHING
      RETURNING contact_id
    )
    INSERT INTO contact_activity (
      id, contact_id, user_id, activity_type, title, detail, entity_type,
      entity_id, metadata, created_at
    )
    SELECT paid_order.id, synced_contact.id, paid_order.user_id,
      'payment_confirmed', 'Payment confirmed',
      CONCAT(
        paid_order.order_number,
        ' · ',
        paid_order.currency,
        ' ',
        paid_order.total_amount
      ),
      'payment_order', paid_order.id,
      jsonb_build_object(
        'amount', paid_order.total_amount,
        'currency', paid_order.currency,
        'orderId', paid_order.id,
        'orderNumber', paid_order.order_number,
        'provider', paid_order.provider,
        'sourceType', paid_order.source_type
      ),
      COALESCE(paid_order.paid_at, NOW())
    FROM paid_order
    CROSS JOIN synced_contact
    ON CONFLICT (id) DO NOTHING
  `;
};

const completeAttempt = async (
  attempt: RecordValue,
  transactionId: string,
  subscriptionId = "",
) => {
  const sql = database();
  const redemptions = await sql`
    SELECT maxform_redeem_payment_coupon(
      ${String(attempt.order_id)}::uuid
    ) AS redeemed
  `;
  if (redemptions[0]?.redeemed !== true) {
    await sql`SELECT maxform_release_payment_inventory(${String(attempt.order_id)}::uuid)`;
    throw new CheckoutError(
      "This coupon reservation has expired. Please start checkout again.",
      409,
      "coupon_unavailable",
    );
  }
  await sql`
    WITH updated_order AS (
      UPDATE payment_orders
      SET status = 'paid',
          provider_reference = ${transactionId},
          paid_at = COALESCE(paid_at, NOW()),
          updated_at = NOW()
      WHERE id = ${String(attempt.order_id)}
        AND status <> 'paid'
      RETURNING *
    ),
    updated_attempt AS (
      UPDATE checkout_attempts
      SET status = 'confirmed',
          confirmed_at = COALESCE(confirmed_at, NOW()),
          provider_reference = ${transactionId}
      WHERE idempotency_key = ${String(attempt.idempotency_key)}
      RETURNING order_id
    ),
    updated_submission AS (
      UPDATE form_submissions
      SET data = jsonb_set(
        jsonb_set(data, '{_meta,status}', '"completed"', TRUE),
        '{_meta,paymentStatus}', '"completed"', TRUE
      )
      WHERE id = ${String(attempt.submission_id)}
      RETURNING id
    ),
    legacy_payment AS (
      INSERT INTO payments (
        submission_id, amount, currency, provider, transaction_id, status,
        payment_date, user_id, order_id, provider_reference
      )
      SELECT ${String(attempt.submission_id)}, updated_order.total_amount,
        updated_order.currency, updated_order.provider, ${transactionId},
        'completed', NOW(), updated_order.user_id, updated_order.id,
        ${transactionId}
      FROM updated_order
      WHERE NOT EXISTS (
        SELECT 1 FROM payments WHERE order_id = updated_order.id
      )
      RETURNING id
    )
    INSERT INTO payment_invoices (
      user_id, order_id, invoice_number, customer_name, customer_email,
      status, amount_due, amount_paid, currency, sent_at, paid_at, line_items,
      created_at, updated_at
    )
    SELECT updated_order.user_id, updated_order.id,
      'INV-' || updated_order.order_number, updated_order.customer_name,
      updated_order.customer_email, 'paid', updated_order.total_amount,
      updated_order.total_amount, updated_order.currency, NOW(), NOW(),
      COALESCE(
        (
          SELECT jsonb_agg(jsonb_build_object(
            'id', item.id,
            'name', item.name,
            'quantity', item.quantity,
            'unitPrice', item.unit_price
          ))
          FROM payment_order_items item
          WHERE item.order_id = updated_order.id
        ),
        '[]'::jsonb
      ),
      NOW(), NOW()
    FROM updated_order
    WHERE NOT EXISTS (
      SELECT 1 FROM payment_invoices WHERE order_id = updated_order.id
    )
  `;
  const attributedOrder = await sql`
    SELECT user_id, source_campaign_id, contact_id, total_amount, currency,
           order_number, paid_at
    FROM payment_orders
    WHERE id = ${String(attempt.order_id)}
      AND source_campaign_id IS NOT NULL
      AND status IN ('paid', 'partially_refunded', 'refunded')
    LIMIT 1
  `;
  const attributed = attributedOrder[0] as RecordValue | undefined;
  if (attributed?.source_campaign_id) {
    const campaignId = String(attributed.source_campaign_id);
    const workspaceId = String(attributed.user_id || "");
    const contactId = String(attributed.contact_id || "");
    const metadata = {
      orderId: String(attempt.order_id),
      orderNumber: String(attributed.order_number || ""),
      amount: Number(attributed.total_amount || 0),
      currency: String(attributed.currency || "USD"),
    };
    await recordCampaignEvent({
      workspaceId,
      campaignId,
      contactId,
      eventType: "campaign_converted",
      source: "system",
      eventKey: `campaign_conversion:${String(attempt.order_id)}`,
      metadata,
      occurredAt: attributed.paid_at ? String(attributed.paid_at) : undefined,
    });
    await recordCampaignEvent({
      workspaceId,
      campaignId,
      contactId,
      eventType: "campaign_revenue_attributed",
      source: "system",
      eventKey: `campaign_revenue:${String(attempt.order_id)}`,
      metadata,
      occurredAt: attributed.paid_at ? String(attributed.paid_at) : undefined,
    });
    kickCampaignAnalyticsWorker(campaignId);
  }
  await sql`
    INSERT INTO payment_subscriptions (
      user_id, product_id, provider_connection_id, initial_order_id,
      provider_subscription_id, customer_name, customer_email, status,
      amount, currency, interval_unit, current_period_start,
      current_period_end, created_at, updated_at
    )
    SELECT payment_order.user_id, product.id, connection.id,
      payment_order.id,
      COALESCE(
        NULLIF(${subscriptionId}, ''),
        NULLIF(payment_order.provider_reference, ''),
        ${transactionId}
      ),
      payment_order.customer_name, payment_order.customer_email, 'active',
      payment_order.total_amount, payment_order.currency,
      COALESCE(product.billing_interval, 'month'), NOW(),
      CASE COALESCE(product.billing_interval, 'month')
        WHEN 'week' THEN NOW() + INTERVAL '1 week'
        WHEN 'quarter' THEN NOW() + INTERVAL '3 months'
        WHEN 'year' THEN NOW() + INTERVAL '1 year'
        ELSE NOW() + INTERVAL '1 month'
      END,
      NOW(), NOW()
    FROM payment_orders payment_order
    JOIN payment_order_items item ON item.order_id = payment_order.id
    JOIN payment_products product ON product.id = item.product_id
    LEFT JOIN payment_provider_connections connection
      ON connection.user_id = payment_order.user_id
     AND connection.provider = payment_order.provider
    WHERE payment_order.id = ${String(attempt.order_id)}
      AND product.billing_type = 'recurring'
    ON CONFLICT (initial_order_id)
      WHERE initial_order_id IS NOT NULL
    DO UPDATE SET
      provider_subscription_id = EXCLUDED.provider_subscription_id,
      status = 'active',
      current_period_end = EXCLUDED.current_period_end,
      updated_at = NOW()
  `;
  await sql`SELECT maxform_consume_payment_inventory(${String(attempt.order_id)}::uuid)`;
  await syncPaidOrderToCrm(String(attempt.order_id));
  try {
    const paidOrder = await sql`
      SELECT id, user_id, order_number, customer_name, customer_email,
             total_amount, currency, source_type, source_id, paid_at
      FROM payment_orders
      WHERE id = ${String(attempt.order_id)} AND status = 'paid'
      LIMIT 1
    `;
    const order = paidOrder[0] as RecordValue | undefined;
    if (order) {
      const payload = {
        id: String(order.id),
        order: order as RecordValue,
      };
      await dispatchWorkspaceWorkflowEvent(
        String(order.user_id),
        "order_paid",
        payload,
        `order_paid:${String(order.id)}`,
      );
      await dispatchWorkspaceWorkflowEvent(
        String(order.user_id),
        "payment_completed",
        payload,
        `payment_completed:${String(order.id)}`,
      );
      const purchasedProducts = await sql`
        SELECT product_id, variant_id, name, quantity, total_amount
        FROM payment_order_items
        WHERE order_id = ${String(order.id)} AND product_id IS NOT NULL
      `;
      await Promise.allSettled(
        purchasedProducts.map((item) =>
          dispatchWorkspaceWorkflowEvent(
            String(order.user_id),
            "product_purchased",
            {
              id: String(item.product_id || ""),
              productId: String(item.product_id || ""),
              variantId: String(item.variant_id || ""),
              name: String(item.name || ""),
              quantity: Number(item.quantity || 0),
              amount: Number(item.total_amount || 0),
              orderId: String(order.id),
            },
            `product_purchased:${String(order.id)}:${String(item.product_id || "")}:${String(item.variant_id || "")}`,
          ).catch(() => undefined),
        ),
      );
    }
  } catch {
    // Cross-module workflow delivery is isolated from payment finalization.
  }
  const paidTickets = await sql`
    SELECT attendee.id AS attendee_id, attendee.event_id,
      payment_order.total_amount
    FROM event_attendees attendee
    JOIN events event ON event.id = attendee.event_id
    LEFT JOIN event_orders event_order ON event_order.id = attendee.order_id
    LEFT JOIN payments event_payment ON event_payment.id = event_order.payment_id
    LEFT JOIN payment_orders payment_order ON payment_order.id = event_payment.order_id
    WHERE attendee.order_id IN (
      SELECT purchased.order_id
      FROM event_attendees purchased
      WHERE purchased.registration_submission_id =
        ${String(attempt.submission_id)}
        AND purchased.order_id IS NOT NULL
    )
      AND event.ticketing_enabled = TRUE
    ORDER BY attendee.created_at, attendee.id
  `;
  // Issue every ticket instance before enqueueing the order-level delivery.
  // Queueing inside this map lets concurrent quantities race: the first email
  // worker can observe only the first issued ticket and send an incomplete
  // order. One order-level enqueue after this barrier keeps the delivery
  // payload complete and the database idempotency key still deduplicates
  // repeated payment webhooks.
  await Promise.all(
    paidTickets.map((paidTicket) =>
      issueStoredEventTicket(
        String(paidTicket.event_id),
        String(paidTicket.attendee_id),
      ),
    ),
  );
  const firstPaidTicket = paidTickets[0];
  await Promise.allSettled(
    paidTickets.map((paidTicket) =>
      dispatchWorkspaceWorkflowEvent(
        String(attempt.user_id || ""),
        "event_registration",
        {
          id: String(paidTicket.attendee_id || ""),
          attendeeId: String(paidTicket.attendee_id || ""),
          eventId: String(paidTicket.event_id || ""),
          orderId: String(attempt.order_id || ""),
          amount: Number(paidTicket.total_amount || 0),
        },
        `event_registration:${String(paidTicket.attendee_id || "")}`,
      ).catch(() => undefined),
    ),
  );
  if (firstPaidTicket) {
    void sendEventAttendeeEmailsNow(
      String(firstPaidTicket.event_id),
      String(firstPaidTicket.attendee_id),
      Number(firstPaidTicket.total_amount || 0) > 0,
    ).catch(() => undefined);
  }
  const registrationEvents = await sql`
    SELECT event.id, payment_order.total_amount
    FROM payment_orders payment_order
    JOIN events event
      ON event.id = payment_order.source_id
     AND payment_order.source_type = 'event'
    WHERE payment_order.id = ${String(attempt.order_id)}
      AND event.ticketing_enabled = FALSE
    LIMIT 1
  `;
  await Promise.all(
    registrationEvents.map((registrationEvent) =>
      sendEventRegistrationEmailNow(
        String(registrationEvent.id),
        String(attempt.submission_id),
        Number(registrationEvent.total_amount || 0) > 0,
      ).catch(() => undefined),
    ),
  );
  await Promise.allSettled(
    registrationEvents.map((registrationEvent) =>
      dispatchWorkspaceWorkflowEvent(
        String(attempt.user_id || ""),
        "event_registration",
        {
          id: String(attempt.submission_id || ""),
          submissionId: String(attempt.submission_id || ""),
          eventId: String(registrationEvent.id || ""),
          orderId: String(attempt.order_id || ""),
          amount: Number(registrationEvent.total_amount || 0),
        },
        `event_registration:${String(attempt.submission_id || "")}:${String(registrationEvent.id || "")}`,
      ).catch(() => undefined),
    ),
  );
};

const statusPayload = async (idempotencyKey: string, reconcile = true) => {
  const sql = database();
  const rows = await sql`
    SELECT attempt.*, payment_order.order_number, payment_order.status AS order_status,
      payment_order.customer_name, payment_order.customer_email,
      payment_order.subtotal, payment_order.discount_amount,
      payment_order.tax_amount, payment_order.shipping_amount, payment_order.total_amount,
      payment_order.currency, payment_order.paid_at, payment_order.metadata,
      connection.credentials_encrypted,
      form.id AS form_id,
      form.slug AS form_slug,
      settings.confirmation AS form_confirmation,
      COALESCE(company.company_name, '') AS workspace_name,
      COALESCE(company.company_logo_url, '') AS workspace_logo_url,
      COALESCE(company.brand_color, '#F93D0A') AS workspace_brand_color,
      (
        SELECT product.billing_type
        FROM payment_order_items item
        JOIN payment_products product ON product.id = item.product_id
        WHERE item.order_id = payment_order.id
        LIMIT 1
      ) AS billing_type
    FROM checkout_attempts attempt
    JOIN payment_orders payment_order ON payment_order.id = attempt.order_id
    LEFT JOIN payment_provider_connections connection
      ON connection.user_id = attempt.user_id
     AND connection.provider = attempt.provider
    LEFT JOIN form_submissions submission
      ON submission.id = attempt.submission_id
    LEFT JOIN forms form ON form.id = submission.form_id
    LEFT JOIN form_settings settings ON settings.form_id = form.id
    LEFT JOIN company_settings company ON company.user_id = form.created_by
    WHERE attempt.idempotency_key = ${idempotencyKey}
    LIMIT 1
  `;
  if (rows.length !== 1) {
    throw new CheckoutError("This payment could not be found.", 404);
  }
  const attempt = rows[0] as RecordValue;
  const orderConfirmed = attempt.status === "confirmed" || attempt.order_status === "paid";
  if (
    reconcile &&
    !["confirmed", "failed", "expired"].includes(String(attempt.status))
  ) {
    try {
      const result = await providerPaymentStatus(
        attempt,
        decrypt(String(attempt.credentials_encrypted)),
      );
      if (result.paid) {
        await completeAttempt(
          attempt,
          result.transactionId,
          result.subscriptionId,
        );
        return statusPayload(idempotencyKey, false);
      }
    } catch {
      // A provider delay remains a processing state, not a respondent error.
    }
  }
  const items = await sql`
    SELECT name, quantity, unit_price, total_amount
    FROM payment_order_items
    WHERE order_id = ${String(attempt.order_id)}
    ORDER BY created_at
  `;
  const ticketRows = await sql`
    SELECT attendee.id AS attendee_id, attendee.event_id,
      attendee.full_name AS attendee_name, attendee.email AS attendee_email,
      attendee.ticket_number, attendee.ticket_code,
      event.title AS event_title, event.description AS event_description,
      event.status AS event_status, event.event_code, event.starts_at,
      event.ends_at, event.timezone,
      event.venue_name, event.address, event.online_url,
      event.refund_policy, event.seo,
      COALESCE(NULLIF(event.address, ''), event.online_url, '') AS location,
      ticket_type.name AS ticket_type_name, ticket_type.price AS ticket_price,
      ticket_type.currency AS ticket_currency,
      CASE WHEN attendee.issued_at IS NOT NULL
        THEN COALESCE(attendee.issued_design_id::text, 'issued')
        ELSE design.id::text
      END AS design_id,
      CASE WHEN attendee.issued_at IS NOT NULL
        THEN attendee.issued_template_id
        ELSE design.template_id
      END AS template_id,
      CASE WHEN attendee.issued_at IS NOT NULL
        THEN COALESCE(attendee.issued_theme, '{}'::jsonb)
        ELSE COALESCE(design.theme, template.theme, '{}'::jsonb)
      END AS ticket_theme,
      CASE WHEN attendee.issued_at IS NOT NULL
        THEN COALESCE(attendee.issued_front_layout, '[]'::jsonb)
        ELSE COALESCE(design.front_layout, template.front_layout, '[]'::jsonb)
      END AS ticket_front_layout,
      CASE WHEN attendee.issued_at IS NOT NULL
        THEN COALESCE(attendee.issued_back_layout, '[]'::jsonb)
        ELSE COALESCE(design.back_layout, template.back_layout, '[]'::jsonb)
      END AS ticket_back_layout
    FROM event_attendees attendee
    JOIN events event ON event.id = attendee.event_id
    LEFT JOIN event_ticket_types ticket_type
      ON ticket_type.id = attendee.ticket_type_id
    LEFT JOIN LATERAL (
      SELECT saved_design.*
      FROM event_ticket_designs saved_design
      WHERE saved_design.event_id = attendee.event_id
        AND (
          saved_design.ticket_type_id = attendee.ticket_type_id
          OR saved_design.ticket_type_id IS NULL
        )
      ORDER BY
        CASE WHEN saved_design.ticket_type_id = attendee.ticket_type_id
          THEN 0 ELSE 1 END,
        saved_design.updated_at DESC
      LIMIT 1
    ) design ON TRUE
    LEFT JOIN event_ticket_design_templates template
      ON template.id = design.template_id
    WHERE attendee.order_id IN (
      SELECT purchased.order_id
      FROM event_attendees purchased
      WHERE purchased.registration_submission_id =
        ${String(attempt.submission_id)}
        AND purchased.order_id IS NOT NULL
    )
    ORDER BY attendee.created_at, attendee.id
  `;
  const issuedCodes = new Map<string, string>();
  await Promise.all(
    ticketRows.map(async (ticketRow) => {
      if (ticketRow.ticket_code) return;
      const issued = await issueStoredEventTicket(
        String(ticketRow.event_id),
        String(ticketRow.attendee_id),
      );
      if (issued?.ticketCode) {
        issuedCodes.set(String(ticketRow.attendee_id), issued.ticketCode);
      }
    }),
  );
  const eventTickets = ticketRows.map((ticketRow) =>
    publicEventTicketForStatus(
      ticketRow as RecordValue,
      attempt,
      issuedCodes.get(String(ticketRow.attendee_id)) || "",
      orderConfirmed,
    ),
  );
  const accessRows = await sql`
    SELECT event.title, event.event_date, event.range_start_date,
      event.schedule_start_time, event.schedule_end_time, event.timezone,
      event.online_url, event.settings
    FROM payment_orders payment_order
    JOIN events event
      ON event.id = payment_order.source_id
     AND payment_order.source_type = 'event'
     AND event.ticketing_enabled = FALSE
    WHERE payment_order.id = ${String(attempt.order_id)}
      AND event.status IN ('published', 'on_sale', 'sold_out', 'past')
      AND event.location_type IN ('online', 'hybrid')
      AND NULLIF(event.online_url, '') IS NOT NULL
    LIMIT 1
  `;
  const accessRow = accessRows[0] as RecordValue | undefined;
  const accessSettings = recordValue(accessRow?.settings);
  const accessMeeting = recordValue(accessSettings.meetingIntegration);
  const eventAccess = orderConfirmed && accessRow
    ? {
        date: String(accessRow.event_date || accessRow.range_start_date || ""),
        endTime: String(accessRow.schedule_end_time || ""),
        eventTitle: String(accessRow.title || ""),
        joinUrl: String(accessRow.online_url || ""),
        meetingProvider: String(accessMeeting.providerLabel || accessMeeting.provider || ""),
        startTime: String(accessRow.schedule_start_time || ""),
        timezone: String(accessRow.timezone || "UTC"),
      }
    : null;
  const metadata = recordValue(attempt.metadata);
  const billingDetails = checkoutCustomerForStatus(
    metadata,
    String(attempt.customer_name || ""),
    String(attempt.customer_email || ""),
  );
  return {
    status:
      attempt.status === "confirmed" || attempt.order_status === "paid"
        ? "confirmed"
        : attempt.status,
    confirmation: confirmationForStatus(attempt.form_confirmation),
    order: {
      number: attempt.order_number,
      amount: Number(attempt.total_amount || 0),
      billingDetails,
      currency: attempt.currency,
      customerEmail: attempt.customer_email,
      customerName: attempt.customer_name,
      discountAmount: Number(attempt.discount_amount || 0),
      paidAt: attempt.paid_at || "",
      provider: attempt.provider,
      providerReference: String(attempt.provider_reference || ""),
      subtotal: Number(attempt.subtotal || 0),
      taxAmount: Number(attempt.tax_amount || 0),
      shippingAmount: Number(attempt.shipping_amount || 0),
      ticket: eventTickets[0] || null,
      tickets: eventTickets,
      items: items.map((item) => ({
        name: item.name,
        quantity: Number(item.quantity || 0),
        unitPrice: Number(item.unit_price || 0),
        totalAmount: Number(item.total_amount || 0),
      })),
    },
    eventAccess,
    form: {
      id: String(attempt.form_id || ""),
      publicUrl: attempt.form_slug
        ? `/forms/${encodeURIComponent(String(attempt.user_id))}/${encodeURIComponent(String(attempt.form_slug))}`
        : "",
    },
    retryUrl: attempt.form_slug
      ? `/forms/${encodeURIComponent(String(attempt.user_id))}/${encodeURIComponent(String(attempt.form_slug))}`
      : "/",
    workspace: {
      accentColor: attempt.workspace_brand_color || "#F93D0A",
      logoUrl: attempt.workspace_logo_url || "",
      name: attempt.workspace_name || "Secure checkout",
    },
  };
};

export const publicEventTicketForStatus = (
  ticketRow: RecordValue,
  attempt: RecordValue,
  issuedCode = "",
  includeOnlineAccess = false,
) => {
  const eventIsLive = ["published", "on_sale", "sold_out", "past"].includes(
    String(ticketRow.event_status || ""),
  );
  return {
    attendeeEmail: String(ticketRow.attendee_email || ""),
    attendeeName: String(ticketRow.attendee_name || ""),
    code:
      String(ticketRow.ticket_code || "") ||
      issuedCode ||
      "",
    currency: String(ticketRow.ticket_currency || attempt.currency || "USD"),
    design: ticketRow.design_id
      ? {
          backLayout: ticketRow.ticket_back_layout || [],
          frontLayout: ticketRow.ticket_front_layout || [],
          templateId: String(ticketRow.template_id || "blank"),
          theme: ticketRow.ticket_theme || {},
        }
      : null,
    endsAt: ticketRow.ends_at || "",
    eventCode: String(ticketRow.event_code || ""),
    eventDescription: String(ticketRow.event_description || ""),
    eventTitle: String(ticketRow.event_title || ""),
    location: includeOnlineAccess
      ? String(ticketRow.location || "")
      : String(ticketRow.venue_name || "") || (String(ticketRow.online_url || "") ? "Online event" : ""),
    number: String(ticketRow.ticket_number || ""),
    onlineUrl: includeOnlineAccess && eventIsLive ? String(ticketRow.online_url || "") : "",
    orderCode: String(attempt.order_number || ""),
    price: Number(ticketRow.ticket_price || 0),
    seo: ticketRow.seo || {},
    startsAt: ticketRow.starts_at || "",
    terms: String(ticketRow.refund_policy || ""),
    ticketType: String(ticketRow.ticket_type_name || "Admission"),
    timezone: String(ticketRow.timezone || "UTC"),
    venue: String(ticketRow.venue_name || ""),
  };
};

const handleStatus = async (
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
) => {
  await enforceCheckoutRateLimit(request, "status");
  const key = url.searchParams.get("key") || "";
  if (!/^[0-9a-f-]{30,40}$/i.test(key)) {
    throw new CheckoutError("This payment reference is invalid.", 404);
  }
  json(response, 200, await statusPayload(key));
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

const readRawBody = async (request: IncomingMessage) => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += value.length;
    if (size > 1_000_000) {
      throw new CheckoutError("This callback is too large.", 413);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
};

const callbackReference = (provider: Provider, event: RecordValue) => {
  if (provider === "stripe") {
    const data = (event.data || {}) as RecordValue;
    const object = (data.object || {}) as RecordValue;
    return String(object.id || "");
  }
  if (provider === "paystack") {
    const data = (event.data || {}) as RecordValue;
    return String(data.reference || "");
  }
  if (provider === "opay") {
    const payload = (event.payload || {}) as RecordValue;
    return String(payload.reference || "");
  }
  const resource = (event.resource || {}) as RecordValue;
  const supplementary = (resource.supplementary_data || {}) as RecordValue;
  const related = (supplementary.related_ids || {}) as RecordValue;
  return String(related.order_id || resource.id || "");
};

const callbackSubscriptionReference = (
  provider: Provider,
  event: RecordValue,
) => {
  const eventType = String(event.type || event.event || "").toLowerCase();
  if (provider === "stripe") {
    const data = (event.data || {}) as RecordValue;
    const object = (data.object || {}) as RecordValue;
    return String(
      object.subscription ||
        (eventType.startsWith("customer.subscription") ? object.id : "") ||
        "",
    );
  }
  if (provider === "paystack") {
    const data = (event.data || {}) as RecordValue;
    const subscription = (data.subscription || {}) as RecordValue;
    return String(
      data.subscription_code || subscription.subscription_code || "",
    );
  }
  if (provider === "paypal") {
    const resource = (event.resource || {}) as RecordValue;
    return String(
      resource.billing_agreement_id ||
        (eventType.startsWith("billing.subscription") ? resource.id : "") ||
        "",
    );
  }
  return "";
};

const webhookEventId = (event: RecordValue, reference: string) =>
  String(
    event.id ||
      ((event.data || {}) as RecordValue).id ||
      `${reference}:${String(event.event || event.type || "payment")}:${String(
        ((event.payload || {}) as RecordValue).timestamp || "",
      )}`,
  );

export const verifyPaystackCallback = (
  rawBody: string,
  signature: string,
  secretKey: string,
) => {
  const expected = createHmac("sha512", secretKey)
    .update(rawBody)
    .digest("hex");
  return Boolean(secretKey && safeEqual(expected, signature));
};

const verifyCallback = async (
  provider: Provider,
  request: IncomingMessage,
  rawBody: string,
  event: RecordValue,
  credentials: Credentials,
) => {
  if (provider === "stripe") {
    const secret = process.env.STRIPE_WEBHOOK_SECRET || "";
    const values = String(request.headers["stripe-signature"] || "")
      .split(",")
      .map((item) => item.split("=", 2))
      .filter((item) => item.length === 2);
    const timestamp = String(
      values.find(([key]) => key === "t")?.[1] || "",
    );
    const signatures = values
      .filter(([key]) => key === "v1")
      .map(([, value]) => String(value || ""));
    const expected = createHmac("sha256", secret)
      .update(`${timestamp}.${rawBody}`)
      .digest("hex");
    const fresh =
      Number.isFinite(Number(timestamp)) &&
      Math.abs(Date.now() / 1000 - Number(timestamp)) <= 300;
    return Boolean(
      secret &&
        fresh &&
        signatures.some((signature) => safeEqual(expected, signature)),
    );
  }
  if (provider === "paystack") {
    return verifyPaystackCallback(
      rawBody,
      String(request.headers["x-paystack-signature"] || ""),
      credentials.secretKey || "",
    );
  }
  if (provider === "opay") {
    const payload = (event.payload || {}) as RecordValue;
    const canonical = `{Amount:"${String(payload.amount || "")}",Currency:"${String(
      payload.currency || "",
    )}",Reference:"${String(payload.reference || "")}",Refunded:${
      payload.refunded === true ? "t" : "f"
    },Status:"${String(payload.status || "")}",Timestamp:"${String(
      payload.timestamp || "",
    )}",Token:"${String(payload.token || "")}",TransactionID:"${String(
      payload.transactionId || "",
    )}"}`;
    const expected = createHmac("sha3-512", credentials.secretKey || "")
      .update(canonical)
      .digest("hex");
    return safeEqual(expected, String(event.sha512 || ""));
  }
  const webhookId = process.env.PAYPAL_WEBHOOK_ID || "";
  if (!webhookId) return false;
  const token = await paypalToken();
  const value = await fetchJson(
    `${paypalBase()}/v1/notifications/verify-webhook-signature`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        auth_algo: request.headers["paypal-auth-algo"],
        cert_url: request.headers["paypal-cert-url"],
        transmission_id: request.headers["paypal-transmission-id"],
        transmission_sig: request.headers["paypal-transmission-sig"],
        transmission_time: request.headers["paypal-transmission-time"],
        webhook_event: event,
        webhook_id: webhookId,
      }),
    },
  );
  return value.verification_status === "SUCCESS";
};

const processSubscriptionWebhook = async (input: {
  credentialsRequest: IncomingMessage;
  event: RecordValue;
  provider: Provider;
  rawBody: string;
  subscriptionReference: string;
}) => {
  const sql = database();
  const webhookData = (input.event.data || {}) as RecordValue;
  const webhookPlan = (webhookData.plan || {}) as RecordValue;
  const webhookCustomer = (webhookData.customer || {}) as RecordValue;
  const paystackPlanId = String(webhookPlan.plan_code || "");
  const paystackCustomerEmail = String(webhookCustomer.email || "");
  const rows = await sql`
    SELECT subscription.*, connection.credentials_encrypted,
           initial_order.source_campaign_id
    FROM payment_subscriptions subscription
    JOIN payment_provider_connections connection
      ON connection.id = subscription.provider_connection_id
    LEFT JOIN payment_products product ON product.id = subscription.product_id
    LEFT JOIN payment_orders initial_order
      ON initial_order.id = subscription.initial_order_id
    WHERE connection.provider = ${input.provider}
      AND (
        subscription.provider_subscription_id = ${input.subscriptionReference}
        OR (
          ${input.provider} = 'paystack'
          AND ${paystackPlanId} <> ''
          AND jsonb_extract_path_text(
            product.metadata, 'providerPlans', 'paystack'
          ) = ${paystackPlanId}
          AND (
            ${paystackCustomerEmail} = ''
            OR LOWER(subscription.customer_email) =
              LOWER(${paystackCustomerEmail})
          )
        )
      )
    ORDER BY subscription.created_at DESC
    LIMIT 1
  `;
  if (rows.length !== 1) return false;
  const subscription = rows[0] as RecordValue;
  const credentials = decrypt(String(subscription.credentials_encrypted));
  if (
    !(await verifyCallback(
      input.provider,
      input.credentialsRequest,
      input.rawBody,
      input.event,
      credentials,
    ))
  ) {
    throw new CheckoutError("Callback verification failed.", 401);
  }
  const eventId = webhookEventId(input.event, input.subscriptionReference);
  const inserted = await sql`
    INSERT INTO webhook_events (
      user_id, provider, provider_event_id, event_type, processing_status,
      processed_at, created_at
    )
    VALUES (
      ${String(subscription.user_id)}, ${input.provider}, ${eventId},
      ${String(input.event.type || input.event.event || "")}, 'received',
      NOW(), NOW()
    )
    ON CONFLICT (provider, provider_event_id) DO UPDATE
    SET processing_status = 'received', processed_at = NOW()
    WHERE webhook_events.processing_status IN ('received', 'failed')
    RETURNING id
  `;
  if (inserted.length === 0) return true;

  const eventType = String(
    input.event.type || input.event.event || "",
  ).toLowerCase();
  const nextStatus =
    /cancel|delete|disable|expired/.test(eventType)
      ? "cancelled"
      : /suspend|pause/.test(eventType)
        ? "paused"
        : /failed|past_due/.test(eventType)
          ? "past_due"
          : "active";
  const data = (input.event.data || {}) as RecordValue;
  const stripeObject = (data.object || {}) as RecordValue;
  const paystackSubscription = (data.subscription || {}) as RecordValue;
  const nextPayment =
    String(
      data.next_payment_date ||
        paystackSubscription.next_payment_date ||
        "",
    ) || null;
  const stripePeriodEnd = Number(
    stripeObject.current_period_end || stripeObject.period_end || 0,
  );
  await sql`
    UPDATE payment_subscriptions
    SET provider_subscription_id = ${input.subscriptionReference},
        status = ${nextStatus},
        current_period_start = CASE
          WHEN ${nextStatus} = 'active' THEN NOW()
          ELSE current_period_start
        END,
        current_period_end = COALESCE(
          ${stripePeriodEnd > 0 ? new Date(stripePeriodEnd * 1000) : null},
          ${nextPayment},
          current_period_end
        ),
        cancelled_at = CASE
          WHEN ${nextStatus} = 'cancelled' THEN NOW()
          ELSE cancelled_at
        END,
        updated_at = NOW()
    WHERE id = ${String(subscription.id)}
  `;

  const stripeRenewal =
    input.provider === "stripe" &&
    eventType === "invoice.paid" &&
    stripeObject.billing_reason !== "subscription_create";
  const paystackRenewal =
    input.provider === "paystack" && eventType === "charge.success";
  if (stripeRenewal || paystackRenewal) {
    const rawAmount = Number(
      stripeRenewal ? stripeObject.amount_paid || 0 : data.amount || 0,
    );
    const amount =
      rawAmount > 0
        ? rawAmount / 100
        : Number(subscription.amount || 0);
    const currency = String(
      (stripeRenewal ? stripeObject.currency : data.currency) ||
        subscription.currency ||
        "USD",
    ).toUpperCase();
    const orderNumber = `SUB-${createHash("sha256")
      .update(eventId)
      .digest("hex")
      .slice(0, 14)
      .toUpperCase()}`;
    const orderId = randomUUID();
    await sql`
      WITH saved_order AS (
        INSERT INTO payment_orders (
          id, user_id, order_number, source_type, source_id, source_campaign_id,
          customer_name,
          customer_email, status, provider, provider_reference, subtotal,
          total_amount, currency, paid_at, metadata, created_at, updated_at
        )
        VALUES (
          ${orderId}, ${String(subscription.user_id)}, ${orderNumber},
          'subscription', ${String(subscription.id)},
          ${String(subscription.source_campaign_id || "") || null},
          ${String(subscription.customer_name || "")},
          ${String(subscription.customer_email || "")}, 'paid',
          ${input.provider}, ${eventId}, ${amount}, ${amount}, ${currency},
          NOW(), ${JSON.stringify({ subscriptionId: subscription.id })}::jsonb,
          NOW(), NOW()
        )
        ON CONFLICT (user_id, order_number) DO NOTHING
        RETURNING id
      ),
      saved_item AS (
        INSERT INTO payment_order_items (
          order_id, product_id, name, quantity, unit_price, total_amount,
          created_at
        )
        SELECT saved_order.id, ${String(subscription.product_id || "") || null},
          'Subscription renewal', 1, ${amount}, ${amount}, NOW()
        FROM saved_order
        RETURNING id
      )
      INSERT INTO payment_invoices (
        user_id, order_id, invoice_number, customer_name, customer_email,
        status, amount_due, amount_paid, currency, sent_at, paid_at,
        line_items, created_at, updated_at
      )
      SELECT ${String(subscription.user_id)}, saved_order.id,
        'INV-' || ${orderNumber},
        ${String(subscription.customer_name || "")},
        ${String(subscription.customer_email || "")}, 'paid', ${amount},
        ${amount}, ${currency}, NOW(), NOW(),
        jsonb_build_array(jsonb_build_object(
          'name', 'Subscription renewal',
          'quantity', 1,
          'unitPrice', ${amount}
        )),
        NOW(), NOW()
      FROM saved_order
    `;
    const renewalOrder = await sql`
      SELECT id
      FROM payment_orders
      WHERE user_id = ${String(subscription.user_id)}
        AND order_number = ${orderNumber}
      LIMIT 1
    `;
    if (renewalOrder[0]?.id) {
      await syncPaidOrderToCrm(String(renewalOrder[0].id));
      const attributedRenewal = await sql`
        SELECT user_id, source_campaign_id
        FROM payment_orders
        WHERE id = ${String(renewalOrder[0].id)}
          AND source_campaign_id IS NOT NULL
        LIMIT 1
      `;
      if (attributedRenewal[0]?.source_campaign_id) {
        await refreshCampaignMetrics(
          sql,
          String(attributedRenewal[0].user_id),
          String(attributedRenewal[0].source_campaign_id),
        );
      }
    }
  }
  await sql`
    UPDATE webhook_events
    SET processing_status = 'processed', processed_at = NOW()
    WHERE id = ${String(inserted[0].id)}
  `;
  return true;
};

const refundWebhookReferences = (
  provider: Provider,
  event: RecordValue,
) => {
  const references = new Set<string>();
  const add = (value: unknown) => {
    const reference = String(value || "").trim();
    if (reference) references.add(reference);
  };
  if (provider === "stripe") {
    const object = recordValue(recordValue(event.data).object);
    add(object.id);
    add(object.payment_intent);
    add(object.charge);
  } else if (provider === "paystack") {
    const data = recordValue(event.data);
    add(data.id);
    add(data.reference);
    add(typeof data.transaction === "object" ? recordValue(data.transaction).reference : data.transaction);
  } else if (provider === "paypal") {
    const resource = recordValue(event.resource);
    const supplementary = recordValue(resource.supplementary_data);
    const related = recordValue(supplementary.related_ids);
    add(resource.id);
    add(related.order_id);
    add(related.capture_id);
  } else {
    const payload = recordValue(event.payload);
    add(payload.reference);
    add(payload.orderNo);
    add(payload.transactionId);
  }
  return [...references];
};

const refundWebhookOutcome = (provider: Provider, event: RecordValue) => {
  const eventType = String(event.type || event.event || "").toLowerCase();
  const object = provider === "stripe"
    ? recordValue(recordValue(event.data).object)
    : provider === "paypal"
      ? recordValue(event.resource)
      : provider === "opay"
        ? recordValue(event.payload)
        : recordValue(event.data);
  const status = String(object.status || object.refund_status || object.orderStatus || "").toLowerCase();
  if (
    /failed|fail|cancel|cancelled|canceled|reject|declin/.test(status) ||
    /refund\.(failed|rejected)|capture\.refund_failed/.test(eventType)
  ) return "failed" as const;
  if (
    object.refunded === true ||
    /succeeded|success|processed|completed|refunded/.test(status) ||
    /charge\.refunded|refund\.(succeeded|processed|completed)|capture\.refunded/.test(eventType)
  ) return "succeeded" as const;
  return "processing" as const;
};

const processRefundWebhook = async (
  provider: Provider,
  request: IncomingMessage,
  rawBody: string,
  event: RecordValue,
  sql: ReturnType<typeof database>,
) => {
  const eventType = String(event.type || event.event || "").toLowerCase();
  if (!/refund|refunded/.test(eventType)) return false;
  const references = refundWebhookReferences(provider, event);
  if (!references.length) return false;
  const rows = await sql.query(
    `SELECT refund.id, refund.provider_refund_id, refund.user_id,
            connection.credentials_encrypted
     FROM payment_refunds refund
     JOIN payment_orders payment_order ON payment_order.id = refund.order_id
     JOIN payment_provider_connections connection
       ON connection.user_id = refund.user_id
      AND connection.provider = refund.provider
     WHERE refund.provider = $1
       AND (
         refund.provider_refund_id = ANY($2::text[])
         OR payment_order.provider_reference = ANY($2::text[])
       )
     ORDER BY refund.requested_at DESC
     LIMIT 1`,
    [provider, references],
  );
  if (rows.length !== 1) return false;
  const refund = rows[0] as RecordValue;
  const credentials = decrypt(String(refund.credentials_encrypted));
  if (!(await verifyCallback(provider, request, rawBody, event, credentials))) {
    throw new CheckoutError("Callback verification failed.", 401);
  }
  const eventId = webhookEventId(event, references[0]);
  const inserted = await sql`
    INSERT INTO webhook_events (
      user_id, provider, provider_event_id, event_type, processing_status,
      processed_at, created_at
    ) VALUES (
      ${String(refund.user_id)}, ${provider}, ${eventId}, ${eventType},
      'received', NOW(), NOW()
    )
    ON CONFLICT (provider, provider_event_id) DO UPDATE
    SET processing_status = 'received', processed_at = NOW()
    WHERE webhook_events.processing_status IN ('received', 'failed')
    RETURNING id
  `;
  if (inserted.length === 0) return true;
  const outcome = refundWebhookOutcome(provider, event);
  if (outcome === "succeeded") {
    await finalizePaymentRefund({
      providerRefundId: references[0],
      refundId: String(refund.id),
      status: "succeeded",
    });
  } else if (outcome === "failed") {
    await finalizePaymentRefund({
      failureReason: "The payment provider rejected the refund.",
      refundId: String(refund.id),
      status: "failed",
    });
  }
  await sql`
    UPDATE webhook_events
    SET processing_status = ${outcome === "processing" ? "ignored" : "processed"},
        processed_at = NOW()
    WHERE id = ${String(inserted[0].id)}
  `;
  return true;
};

const handleWebhook = async (
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
) => {
  const providerValue = url.searchParams.get("provider") || "";
  if (!["stripe", "paypal", "paystack", "opay"].includes(providerValue)) {
    throw new CheckoutError("Unknown payment provider.", 404);
  }
  const provider = providerValue as Provider;
  const rawBody = await readRawBody(request);
  let event: RecordValue;
  try {
    event = JSON.parse(rawBody) as RecordValue;
  } catch {
    throw new CheckoutError("Invalid callback.", 400);
  }
  const reference = callbackReference(provider, event);
  const subscriptionReference = callbackSubscriptionReference(
    provider,
    event,
  );
  if (!reference && !subscriptionReference) {
    throw new CheckoutError("Callback reference is missing.", 400);
  }
  const sql = database();
  if (await processRefundWebhook(provider, request, rawBody, event, sql)) {
    json(response, 200, { received: true });
    return;
  }
  const rows = await sql`
    SELECT attempt.*, connection.credentials_encrypted,
      payment_order.total_amount, payment_order.currency,
      (
        SELECT product.billing_type
        FROM payment_order_items item
        JOIN payment_products product ON product.id = item.product_id
        WHERE item.order_id = attempt.order_id
        LIMIT 1
      ) AS billing_type
    FROM checkout_attempts attempt
    JOIN payment_orders payment_order ON payment_order.id = attempt.order_id
    JOIN payment_provider_connections connection
      ON connection.user_id = attempt.user_id
     AND connection.provider = attempt.provider
    WHERE attempt.provider = ${provider}
      AND attempt.provider_reference = ${reference || ""}
    LIMIT 1
  `;
  if (rows.length !== 1) {
    if (
      subscriptionReference &&
      (await processSubscriptionWebhook({
        credentialsRequest: request,
        event,
        provider,
        rawBody,
        subscriptionReference,
      }))
    ) {
      json(response, 200, { received: true });
      return;
    }
    json(response, 200, { received: true });
    return;
  }
  const attempt = rows[0] as RecordValue;
  const credentials = decrypt(String(attempt.credentials_encrypted));
  if (
    !(await verifyCallback(provider, request, rawBody, event, credentials))
  ) {
    throw new CheckoutError("Callback verification failed.", 401);
  }
  const eventId = webhookEventId(
    event,
    reference || subscriptionReference,
  );
  const inserted = await sql`
    INSERT INTO webhook_events (
      user_id, provider, provider_event_id, event_type, processing_status,
      processed_at, created_at
    )
    VALUES (
      ${String(attempt.user_id)}, ${provider}, ${eventId},
      ${String(event.type || event.event || "")}, 'received', NOW(), NOW()
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
  const verifiedStatus = await providerPaymentStatus(attempt, credentials);
  if (verifiedStatus.paid) {
    await completeAttempt(
      attempt,
      verifiedStatus.transactionId,
      verifiedStatus.subscriptionId,
    );
  }
  await sql`
    UPDATE webhook_events
    SET processing_status = ${verifiedStatus.paid ? "processed" : "ignored"},
        processed_at = NOW()
    WHERE id = ${String(inserted[0].id)}
  `;
  json(response, 200, { received: true });
};

export async function handlePaymentCheckout(
  request: IncomingMessage,
  response: ServerResponse,
) {
  try {
    const url = new URL(
      request.url || "/",
      `${originFor(request)}/api/payments/checkout`,
    );
    const action = url.searchParams.get("action") || "options";
    if (action === "options" && request.method === "GET") {
      await handleOptions(response, url);
      return;
    }
    if (action === "create" && request.method === "POST") {
      await handleCreate(request, response);
      return;
    }
    if (action === "coupon" && request.method === "POST") {
      await handleCoupon(request, response);
      return;
    }
    if (action === "quote" && request.method === "POST") {
      await handleQuote(request, response);
      return;
    }
    if (action === "status" && request.method === "GET") {
      await handleStatus(request, response, url);
      return;
    }
    if (action === "webhook" && request.method === "POST") {
      await handleWebhook(request, response, url);
      return;
    }
    json(response, 404, { error: "This checkout action is not available." });
  } catch (error) {
    if (error instanceof CheckoutError) {
      json(response, error.status, { error: error.message, code: error.code });
      return;
    }
    const unexpectedCode =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code || "unknown")
        : "unknown";
    console.error("[payment-checkout] unexpected request failure", {
      code: unexpectedCode,
      type: error instanceof Error ? error.name : typeof error,
    });
    json(response, 500, {
      error: "Checkout could not be updated right now. Please try again.",
      code: "checkout_error",
    });
  }
}

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { lookup } from "node:dns/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isIP } from "node:net";

import { neon } from "@neondatabase/serverless";
import { jwtVerify } from "jose";

import { configuredAppUrl } from "./app-url";
import { canOpenModule, workspaceScopeFor } from "./workspace-access";
import { dispatchWorkspaceWorkflowEvent } from "./workflows-data";
import {
  CMS_PLATFORMS,
  type CmsCategory,
  type CmsConnection,
  type CmsCustomField,
  type CmsOrder,
  type CmsPlatform,
  type CmsProductAttribute,
  type CmsProduct,
  type CmsProductVariant,
  type CmsSyncEvent,
  type CmsWorkspace,
} from "../src/lib/cms-stores";

type RecordValue = Record<string, unknown>;

type CmsCredentials =
  | { consumerKey: string; consumerSecret: string }
  | { accessToken: string; storeHash?: string }
  | { apiKey: string; siteId: string };

const cmsPlatformNames: Record<CmsPlatform, string> = {
  shopify: "Shopify",
  woocommerce: "WooCommerce",
  bigcommerce: "BigCommerce",
  wix: "Wix",
};

const cmsPlatformName = (platform: CmsPlatform) => cmsPlatformNames[platform];

type NormalizedProduct = Omit<
  CmsProduct,
  "id" | "connectionId" | "platform" | "storeName" | "variants" | "lastPulledAt"
> & { variants: CmsProductVariant[] };

type NormalizedCategory = Omit<
  CmsCategory,
  "id" | "connectionId" | "platform" | "storeName" | "lastPulledAt"
>;

type NormalizedOrder = Omit<CmsOrder, "id" | "connectionId" | "platform" | "storeName">;

type PullResult = {
  externalStoreId: string;
  products: NormalizedProduct[];
  categories: NormalizedCategory[];
  orders: NormalizedOrder[];
};

type CmsConnectionRow = RecordValue & {
  id: string;
  workspace_id: string;
  platform: CmsPlatform;
  name: string;
  store_url: string;
  credentials_encrypted: string;
  webhook_secret_encrypted: string;
  sync_lock_token?: string | null;
  sync_lock_expires_at?: string | null;
};

class CmsDataError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "cms_error",
    readonly details: RecordValue = {},
  ) {
    super(message);
  }
}

const database = () => {
  const url = process.env.DATABASE_URL || "";
  if (!url) {
    throw new CmsDataError(
      "Connected stores are temporarily unavailable. Please try again.",
      503,
      "cms_unavailable",
    );
  }
  return neon(url);
};

const query = async <Row extends RecordValue = RecordValue>(
  sqlText: string,
  params: unknown[] = [],
) => (await database().query(sqlText, params)) as Row[];

const text = (value: unknown, fallback = "", maximum = 4000) =>
  String(value ?? fallback).trim().slice(0, maximum);

const integer = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
};

const decimal = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const boolean = (value: unknown, fallback = false) =>
  value === true || value === "true" || value === 1
    ? true
    : value === false || value === "false" || value === 0
      ? false
      : fallback;

const object = (value: unknown): RecordValue =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};

const array = <T = unknown>(value: unknown): T[] =>
  Array.isArray(value) ? (value as T[]) : [];

const jsonText = (value: unknown, fallback: unknown) => {
  try {
    return JSON.stringify(value ?? fallback);
  } catch {
    return JSON.stringify(fallback);
  }
};

const safeJson = <T>(value: unknown, fallback: T): T => {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
};

const customFieldValueType = (value: unknown): CmsCustomField["valueType"] => {
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (value && typeof value === "object") return "json";
  return "string";
};

const customFieldValueText = (value: unknown) => {
  if (typeof value === "string") return value.slice(0, 12_000);
  if (value == null) return "";
  return jsonText(value, "").slice(0, 12_000);
};

const normalizeCustomFields = (value: unknown): CmsCustomField[] =>
  array<RecordValue>(value)
    .map((field) => ({
      id: Number.isFinite(Number(field.id)) && Number(field.id) > 0 ? integer(field.id) : undefined,
      key: text(field.key, "", 200),
      value: customFieldValueText(field.value),
      valueType: field.valueType === "number" || field.valueType === "boolean" || field.valueType === "json"
        ? field.valueType
        : customFieldValueType(field.value),
    }))
    .filter((field) => field.key)
    .slice(0, 200);

const customFieldValue = (field: CmsCustomField) => {
  const value = text(field.value, "", 12_000);
  if (field.valueType === "number") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value;
  }
  if (field.valueType === "boolean") {
    return value.toLowerCase() === "true";
  }
  if (field.valueType === "json") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
};

const customFieldPayload = (value: unknown) =>
  normalizeCustomFields(value).map((field) => ({
    ...(field.id ? { id: field.id } : {}),
    key: field.key,
    value: customFieldValue(field),
  }));

const normalizeCustomFieldIds = (value: unknown) =>
  Array.from(
    new Set(
      array<unknown>(value)
        .map((item) => integer(item))
        .filter((item) => item > 0),
    ),
  ).slice(0, 200);

const customFieldUpdatePayload = (value: unknown, deletedIds: unknown) => [
  ...customFieldPayload(value),
  ...normalizeCustomFieldIds(deletedIds).map((id) => ({ id, value: null })),
];

const customFieldDeletePayload = (value: unknown) =>
  array<RecordValue>(value)
    .map((field) => ({
      id: integer(field.id),
      key: text(field.key, "", 200),
    }))
    .filter((field) => field.id > 0 && field.key);

const mergeCustomFields = (
  existingValue: unknown,
  incomingValue: unknown,
  deletedIds: unknown,
  deletedFields: unknown,
) => {
  const deletedIdSet = new Set(normalizeCustomFieldIds(deletedIds));
  const deletedKeySet = new Set(customFieldDeletePayload(deletedFields).map((field) => field.key));
  const merged = normalizeCustomFields(existingValue).map((field) => ({ ...field }));
  for (const field of normalizeCustomFields(incomingValue)) {
    const index = field.id
      ? merged.findIndex((existing) => existing.id === field.id)
      : merged.findIndex((existing) => existing.key === field.key);
    if (index >= 0) {
      merged[index] = { ...merged[index], ...field, id: field.id || merged[index].id };
    } else {
      merged.push(field);
    }
  }
  return merged.filter((field) => !field.id || !deletedIdSet.has(field.id)).filter((field) => !deletedKeySet.has(field.key));
};

const normalizeProductAttributes = (value: unknown): CmsProductAttribute[] =>
  array<RecordValue>(value)
    .map((attribute, position) => ({
      id: Number.isFinite(Number(attribute.id)) && Number(attribute.id) > 0 ? integer(attribute.id) : undefined,
      name: text(attribute.name, "", 200),
      slug: text(attribute.slug, "", 200) || undefined,
      options: array<unknown>(attribute.options)
        .map((option) => text(option, "", 200))
        .filter(Boolean)
        .slice(0, 100),
      visible: boolean(attribute.visible, true),
      variation: boolean(attribute.variation, false),
      position: integer(attribute.position, position),
    }))
    .filter((attribute) => attribute.name && attribute.options.length)
    .slice(0, 100);

const normalizeCategoryIds = (value: unknown) =>
  Array.from(
    new Set(
      array<unknown>(value)
        .map((item) => text(typeof item === "object" ? object(item).id || object(item).externalId : item, "", 120))
        .filter(Boolean),
    ),
  ).slice(0, 100);

const normalizeVariantAttributes = (value: unknown): Record<string, string> => {
  if (!Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(object(value))
        .map(([name, option]) => [text(name, "", 200), text(option, "", 200)])
        .filter(([name, option]) => name && option),
    );
  }
  return Object.fromEntries(
    value
      .map((attribute) => {
        const item = object(attribute);
        return [text(item.name, "", 200), text(item.option, "", 200)];
      })
      .filter(([name, option]) => name && option),
  );
};

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

const encryptionKey = () => {
  const configured =
    process.env.CMS_ENCRYPTION_KEY ||
    process.env.INTEGRATION_ENCRYPTION_KEY ||
    process.env.AI_ENCRYPTION_KEY ||
    "";
  if (configured.length < 24) {
    throw new CmsDataError(
      "Connected stores are not configured securely yet. Set CMS_ENCRYPTION_KEY on the server.",
      503,
      "cms_encryption_unavailable",
    );
  }
  return createHash("sha256").update(configured).digest();
};

const encrypt = (value: unknown) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), encrypted]
    .map((part) => part.toString("base64url"))
    .join(".");
};

const decrypt = <T>(value: string): T => {
  try {
    const [ivText, tagText, encryptedText] = value.split(".");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(),
      Buffer.from(ivText, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedText, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    return JSON.parse(decrypted) as T;
  } catch {
    throw new CmsDataError(
      "This store connection could not be decrypted. Reconnect it to continue.",
      409,
      "cms_credentials_invalid",
    );
  }
};

const normalizeUrl = (platform: CmsPlatform, value: unknown) => {
  let candidate = text(value, "", 600).replace(/\/+$/, "");
  if (!candidate) throw new CmsDataError("Enter the store URL.");
  if (!/^https?:\/\//i.test(candidate)) candidate = `https://${candidate}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new CmsDataError("Enter a valid store URL.");
  }
  if (!parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new CmsDataError("Store URLs cannot include credentials, query parameters, or fragments.");
  }
  if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
    throw new CmsDataError("Store connections must use HTTPS in production.");
  }
  const host = parsed.hostname.toLowerCase();
  const privateHost =
    host === "localhost" ||
    host.endsWith(".local") ||
    host === "127.0.0.1" ||
    host === "::1" ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
  if (privateHost) throw new CmsDataError("Private or local store addresses cannot be connected.");
  if (platform === "shopify" && !host.includes("myshopify.com") && !host.includes("shopify.com")) {
    // Shopify custom domains are accepted by the UI, but the Admin API must
    // resolve to a shop domain. The adapter will return the precise provider
    // error if a custom storefront URL is not an Admin API host.
  }
  return parsed.toString().replace(/\/+$/, "");
};

const providerTimeout = () => {
  const value = Number(process.env.CMS_SYNC_TIMEOUT_MS || 15_000);
  return Math.max(3_000, Math.min(60_000, Number.isFinite(value) ? value : 15_000));
};

const blockedProviderIp = (address: string) => {
  const normalized = address.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(normalized) === 4) {
    const [a, b] = normalized.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 172 && b >= 16 && b <= 31)
    );
  }
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("::ffff:10.") ||
    normalized.startsWith("::ffff:127.") ||
    normalized.startsWith("::ffff:192.168.")
  );
};

const assertSafeProviderUrl = async (rawUrl: string) => {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new CmsDataError("The store provider URL is invalid.", 502, "cms_provider_unreachable");
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    parsed.username ||
    parsed.password ||
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    blockedProviderIp(hostname)
  ) {
    throw new CmsDataError("The store provider address is not allowed.", 422, "cms_provider_address_blocked");
  }
  try {
    const addresses = isIP(hostname)
      ? [{ address: hostname }]
      : await lookup(hostname, { all: true });
    if (!addresses.length || addresses.some((entry) => blockedProviderIp(entry.address))) {
      throw new CmsDataError("The store provider address is not allowed.", 422, "cms_provider_address_blocked");
    }
  } catch (error) {
    if (error instanceof CmsDataError) throw error;
    throw new CmsDataError("The store provider address could not be verified.", 502, "cms_provider_unreachable");
  }
};

const providerFetch = async (url: string, init: RequestInit = {}) => {
  await assertSafeProviderUrl(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), providerTimeout());
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = await response.text();
    let parsed: unknown = {};
    try {
      parsed = body ? JSON.parse(body) : {};
    } catch {
      parsed = { raw: body.slice(0, 2_000) };
    }
    if (!response.ok) {
      const message = text(object(parsed).message || object(parsed).error || body, "Provider request failed.", 600);
      throw new CmsDataError(message, 502, "cms_provider_error", { statusCode: response.status });
    }
    return parsed;
  } catch (error) {
    if (error instanceof CmsDataError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new CmsDataError("The store provider took too long to respond.", 504, "cms_provider_timeout");
    }
    throw new CmsDataError("The store provider could not be reached.", 502, "cms_provider_unreachable");
  } finally {
    clearTimeout(timeout);
  }
};

const moneyCents = (value: unknown) => Math.max(0, Math.round(decimal(value) * 100));
const money = (value: unknown) => Math.max(0, decimal(value));
const isoOrNull = (value: unknown) => {
  const raw = text(value, "", 80);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const storeOrigin = (connection: CmsConnectionRow) => normalizeUrl(connection.platform, connection.store_url);

const wooHeaders = (credentials: CmsCredentials) => {
  if (!("consumerKey" in credentials)) throw new CmsDataError("WooCommerce credentials are missing.");
  return {
    Accept: "application/json",
    Authorization: `Basic ${Buffer.from(`${credentials.consumerKey}:${credentials.consumerSecret}`).toString("base64")}`,
  };
};

const wooApi = async (connection: CmsConnectionRow, path: string, init: RequestInit = {}) => {
  const credentials = decrypt<CmsCredentials>(connection.credentials_encrypted);
  const base = `${storeOrigin(connection)}/wp-json/wc/v3`;
  return providerFetch(`${base}${path}`, {
    ...init,
    headers: { ...wooHeaders(credentials), ...(init.headers || {}) },
  });
};

const wooPages = async (connection: CmsConnectionRow, resource: string, params = "") => {
  const output: RecordValue[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const value = await wooApi(connection, `/${resource}?per_page=100&page=${page}${params}`);
    const rows = array<RecordValue>(value);
    output.push(...rows);
    if (rows.length < 100) break;
  }
  return output;
};

const mapWithConcurrency = async <T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>) => {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, () => worker()));
  return results;
};

const normalizeWooVariant = (item: RecordValue): CmsProductVariant => {
  const attributes = normalizeVariantAttributes(item.attributes);
  const attributeTitle = Object.entries(attributes)
    .map(([name, option]) => `${name}: ${option}`)
    .join(" / ");
  return {
    id: "",
    externalId: text(item.id),
    title: attributeTitle || text(item.description, "", 200) || "Default variant",
    status: text(item.status, "publish", 40),
    sku: text(item.sku, "", 160),
    price: money(item.price),
    compareAtPrice: item.regular_price ? money(item.regular_price) : null,
    inventoryQuantity: item.stock_quantity == null ? null : integer(item.stock_quantity),
    inventoryManaged: item.manage_stock === true,
    imageUrl: text(object(item.image).src, "", 1_000),
    attributes,
    customFields: normalizeCustomFields(item.meta_data),
  };
};

const pullWoo = async (connection: CmsConnectionRow): Promise<PullResult> => {
  await wooApi(connection, "/system_status");
  const [products, categories, orders] = await Promise.all([
    wooPages(connection, "products"),
    wooPages(connection, "products/categories"),
    wooPages(connection, "orders", "&orderby=date&order=desc"),
  ]);
  const variableProducts = products.filter(
    (product) => text(product.type, "simple", 40) === "variable" && text(product.id),
  );
  const variationEntries = await mapWithConcurrency(variableProducts, 4, async (product) => [
      text(product.id),
      await wooPages(connection, `products/${encodeURIComponent(text(product.id))}/variations`),
    ] as const);
  const variationsByProduct = new Map(variationEntries);
  return {
    externalStoreId: text(connection.store_url, "woocommerce", 600),
    products: products.map((item) =>
      normalizeWooProduct(item, variationsByProduct.get(text(item.id)) || []),
    ),
    categories: categories.map((item) => ({
      externalId: text(item.id),
      name: text(item.name, "Untitled category", 300),
      parentId: text(item.parent, "") || null,
      type: "category",
      productCount: integer(item.count),
    })),
    orders: orders.map((item) => ({
      externalId: text(item.id),
      orderNumber: text(item.number || item.id, "Order", 120),
      status: text(item.status, "pending", 50),
      fulfillmentStatus: text(item.status, "", 50),
      total: money(item.total),
      currency: text(item.currency, "USD", 8),
      customerName: `${text(object(item.billing).first_name)} ${text(object(item.billing).last_name)}`.trim(),
      customerEmail: text(object(item.billing).email, "", 320),
      paymentGateway: text(item.payment_method_title || item.payment_method, "", 180),
      trackingNumber: "",
      lineItems: array<RecordValue>(item.line_items).map((line) => ({
        externalId: text(line.id),
        name: text(line.name, "Item", 300),
        quantity: integer(line.quantity, 1),
        total: money(line.total),
      })),
      createdAt: isoOrNull(item.date_created),
      updatedAt: isoOrNull(item.date_modified),
    })),
  };
};

const bigcommerceCredentials = (connection: CmsConnectionRow) => {
  const credentials = decrypt<CmsCredentials>(connection.credentials_encrypted);
  if (!("accessToken" in credentials) || !credentials.accessToken || !credentials.storeHash) {
    throw new CmsDataError("BigCommerce API token or store hash is missing. Reconnect this store.");
  }
  return { accessToken: credentials.accessToken, storeHash: credentials.storeHash };
};

const bigcommerceApi = async (connection: CmsConnectionRow, path: string, init: RequestInit = {}) => {
  const credentials = bigcommerceCredentials(connection);
  const base = `https://api.bigcommerce.com/stores/${encodeURIComponent(credentials.storeHash)}`;
  return providerFetch(`${base}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Auth-Token": credentials.accessToken,
      ...(init.headers || {}),
    },
  });
};

const bigcommercePages = async (connection: CmsConnectionRow, resource: string, version: "v2" | "v3" = "v3") => {
  const output: RecordValue[] = [];
  const pageSize = version === "v2" ? 250 : 250;
  for (let page = 1; page <= 40; page += 1) {
    const value = await bigcommerceApi(connection, `/${version}/${resource}?limit=${pageSize}&page=${page}`);
    const body = object(value);
    const rows = array<RecordValue>(Array.isArray(value) ? value : body.data);
    output.push(...rows);
    if (rows.length < pageSize) break;
  }
  return output;
};

const bigcommerceProductImages = (item: RecordValue) =>
  array<RecordValue>(item.images)
    .map((image) => text(image.url_standard || image.url_zoom || image.url_thumbnail || image.url, "", 1_000))
    .filter(Boolean);

const normalizeBigCommerceProduct = (item: RecordValue, currency = "USD"): NormalizedProduct => {
  const variants = array<RecordValue>(item.variants).map((variant, index) => ({
    id: "",
    externalId: text(variant.id, `${text(item.id)}-variant-${index + 1}`),
    title: text(variant.option_values ? array<RecordValue>(variant.option_values).map((option) => text(option.label || option.option_display_name)).filter(Boolean).join(" / ") : "Default variant", "Default variant", 200),
    sku: text(variant.sku, "", 160),
    price: money(variant.price ?? item.price),
    compareAtPrice: variant.retail_price == null ? null : money(variant.retail_price),
    inventoryQuantity: variant.inventory_level == null ? null : integer(variant.inventory_level),
    inventoryManaged: text(variant.inventory_tracking, "none") !== "none",
    imageUrl: text(object(variant.image_url).url || variant.image_url, "", 1_000),
    attributes: { optionValues: array<RecordValue>(variant.option_values) },
  }));
  const images = bigcommerceProductImages(item);
  return {
    externalId: text(item.id),
    title: text(item.name, "Untitled product", 300),
    description: text(item.description, "", 20_000),
    shortDescription: "",
    status: item.is_visible === false ? "draft" : "publish",
    sku: text(item.sku, "", 160),
    price: money(item.price),
    compareAtPrice: item.retail_price == null ? null : money(item.retail_price),
    salePrice: item.sale_price && money(item.sale_price) > 0 ? money(item.sale_price) : null,
    currency,
    inventoryQuantity: item.inventory_level == null ? null : integer(item.inventory_level),
    inventoryManaged: text(item.inventory_tracking, "none") !== "none",
    featured: item.is_featured === true,
    productType: text(item.type, "physical", 80),
    vendor: text(item.brand_name, "", 180),
    tags: [],
    imageUrl: images[0] || "",
    images,
    externalUpdatedAt: isoOrNull(item.date_modified),
    variants,
  };
};

const pullBigCommerce = async (connection: CmsConnectionRow): Promise<PullResult> => {
  const store = object(await bigcommerceApi(connection, "/v2/store"));
  const currency = text(store.currency || store.currency_code || store.default_currency_code, "USD", 8);
  const [products, categories, orders] = await Promise.all([
    bigcommercePages(connection, "catalog/products", "v3"),
    bigcommercePages(connection, "catalog/categories", "v3"),
    bigcommercePages(connection, "orders", "v2"),
  ]);
  const ordersWithLines: NormalizedOrder[] = [];
  for (const item of orders) {
    const orderId = text(item.id);
    let lineItems: RecordValue[] = [];
    if (orderId) {
      const value = await bigcommerceApi(connection, `/v2/orders/${encodeURIComponent(orderId)}/products?limit=250`);
      const body = object(value);
      lineItems = array<RecordValue>(Array.isArray(value) ? value : body.data);
    }
    const billing = object(item.billing_address);
    ordersWithLines.push({
      externalId: orderId,
      orderNumber: text(item.order_number || item.id, "Order", 120),
      status: text(item.status, "pending", 50).toLowerCase().replace(/\s+/g, "_"),
      fulfillmentStatus: text(item.status, "", 50),
      total: money(item.total_inc_tax ?? item.total_ex_tax ?? item.total),
      currency: text(item.currency_code || item.default_currency_code, currency, 8),
      customerName: `${text(billing.first_name)} ${text(billing.last_name)}`.trim(),
      customerEmail: text(billing.email, "", 320),
      paymentGateway: text(item.payment_method, "", 180),
      trackingNumber: "",
      lineItems: lineItems.map((line) => ({
        externalId: text(line.id || line.order_product_id),
        name: text(line.name, "Item", 300),
        quantity: integer(line.quantity, 1),
        total: money(line.total_inc_tax ?? line.total_ex_tax ?? decimal(line.price_inc_tax) * integer(line.quantity, 1)),
      })),
      createdAt: isoOrNull(item.date_created),
      updatedAt: isoOrNull(item.date_modified),
    });
  }
  return {
    externalStoreId: text(store.id || store.domain || connection.store_url, "bigcommerce", 600),
    products: products.map((item) => normalizeBigCommerceProduct(item, currency)),
    categories: categories.map((item) => ({
      externalId: text(item.id),
      name: text(item.name, "Untitled category", 300),
      parentId: integer(item.parent_id) ? String(integer(item.parent_id)) : null,
      type: "category",
      productCount: integer(item.product_count),
    })),
    orders: ordersWithLines,
  };
};

const wixCredentials = (connection: CmsConnectionRow) => {
  const credentials = decrypt<CmsCredentials>(connection.credentials_encrypted);
  if (!("apiKey" in credentials) || !credentials.apiKey || !credentials.siteId) {
    throw new CmsDataError("Wix API key or site ID is missing. Reconnect this store.");
  }
  return credentials;
};

const wixApi = async (connection: CmsConnectionRow, path: string, init: RequestInit = {}) => {
  const credentials = wixCredentials(connection);
  return providerFetch(`https://www.wixapis.com${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: credentials.apiKey,
      "wix-site-id": credentials.siteId,
      ...(init.headers || {}),
    },
  });
};

const wixQueryPage = async (
  connection: CmsConnectionRow,
  readerPath: string,
  legacyPath: string,
  offset: number,
  extra: RecordValue = {},
) => {
  const body = JSON.stringify({ query: { paging: { limit: 100, offset } }, ...extra });
  try {
    return object(await wixApi(connection, readerPath, { method: "POST", body }));
  } catch (error) {
    if (!(error instanceof CmsDataError) || error.details.statusCode !== 404) throw error;
    return object(await wixApi(connection, legacyPath, { method: "POST", body }));
  }
};

const wixImageUrl = (value: unknown) => {
  const item = object(value);
  const image = object(item.image);
  const thumbnail = object(item.thumbnail);
  return text(item.url || image.url || thumbnail.url || item.src, "", 1_000);
};

const wixPrice = (value: unknown) => {
  if (typeof value === "number" || typeof value === "string") return money(value);
  const price = object(value);
  return money(price.amount ?? price.value ?? price.price);
};

const normalizeWixProduct = (item: RecordValue): NormalizedProduct => {
  const priceData = object(item.priceData || item.price);
  const images = array<unknown>(object(item.media).items || item.mediaItems || item.images).map(wixImageUrl).filter(Boolean);
  const variants = array<RecordValue>(item.variants).map((variant, index) => {
    const variantPrice = object(variant.priceData || variant.price);
    return {
      id: "",
      externalId: text(variant.id, `${text(item.id)}-variant-${index + 1}`),
      title: text(variant.name || array<RecordValue>(variant.choices).map((choice) => text(choice.value)).filter(Boolean).join(" / "), "Default variant", 200),
      sku: text(variant.sku, "", 160),
      price: wixPrice(variantPrice),
      compareAtPrice: variantPrice.discountedPrice == null ? null : wixPrice(variantPrice.price),
      inventoryQuantity: object(variant.stock).quantity == null ? null : integer(object(variant.stock).quantity),
      inventoryManaged: object(variant.stock).trackInventory === true,
      imageUrl: wixImageUrl(variant.media),
      attributes: { choices: object(variant.choices) },
    };
  });
  const price = wixPrice(priceData.price ?? priceData);
  return {
    externalId: text(item.id),
    title: text(item.name, "Untitled product", 300),
    description: text(item.description, "", 20_000),
    shortDescription: "",
    status: item.visible === false ? "draft" : "publish",
    sku: text(item.sku, "", 160),
    price,
    compareAtPrice: priceData.discountedPrice == null ? null : price,
    salePrice: priceData.discountedPrice == null ? null : wixPrice(priceData.discountedPrice),
    currency: text(priceData.currency, "USD", 8),
    inventoryQuantity: object(item.stock).quantity == null ? null : integer(object(item.stock).quantity),
    inventoryManaged: object(item.stock).trackInventory === true,
    featured: false,
    productType: text(item.productType, "physical", 80),
    vendor: text(item.brand, "", 180),
    tags: array<string>(item.tags).map((tag) => text(tag)).filter(Boolean),
    imageUrl: images[0] || wixImageUrl(item.mainMedia),
    images,
    externalUpdatedAt: isoOrNull(item._updatedDate || item.updatedDate),
    variants,
  };
};

const pullWixProducts = async (connection: CmsConnectionRow) => {
  const output: RecordValue[] = [];
  for (let offset = 0; offset < 10_000; offset += 100) {
    const value = await wixQueryPage(connection, "/stores-reader/v1/products/query", "/stores/v1/products/query", offset, { includeVariants: true });
    const rows = array<RecordValue>(value.products || value.items);
    output.push(...rows);
    if (rows.length < 100) break;
  }
  return output;
};

const pullWixCollections = async (connection: CmsConnectionRow) => {
  const output: RecordValue[] = [];
  for (let offset = 0; offset < 10_000; offset += 100) {
    const value = await wixQueryPage(connection, "/stores-reader/v1/collections/query", "/stores/v1/collections/query", offset);
    const rows = array<RecordValue>(value.collections || value.items);
    output.push(...rows);
    if (rows.length < 100) break;
  }
  return output;
};

const pullWixOrders = async (connection: CmsConnectionRow): Promise<NormalizedOrder[]> => {
  const output: NormalizedOrder[] = [];
  let cursor = "";
  for (let page = 0; page < 100; page += 1) {
    const body: RecordValue = { search: { cursorPaging: { limit: 100, ...(cursor ? { cursor } : {}) } } };
    const value = object(await wixApi(connection, "/ecom/v1/orders/search", { method: "POST", body: JSON.stringify(body) }));
    const rows = array<RecordValue>(value.orders);
    for (const item of rows) {
      const buyer = object(item.buyerInfo);
      const contact = object(object(item.billingInfo).contactDetails || object(item.recipientInfo).contactDetails);
      const summary = object(item.priceSummary);
      const total = object(summary.total);
      const lineItems = array<RecordValue>(item.lineItems);
      output.push({
        externalId: text(item.id),
        orderNumber: text(item.number || item.id, "Order", 120),
        status: text(item.paymentStatus || item.status, "pending", 50).toLowerCase().replace(/\s+/g, "_"),
        fulfillmentStatus: text(item.fulfillmentStatus, "", 50).toLowerCase().replace(/\s+/g, "_"),
        total: wixPrice(total),
        currency: text(total.currency, "USD", 8),
        customerName: `${text(contact.firstName || buyer.firstName)} ${text(contact.lastName || buyer.lastName)}`.trim(),
        customerEmail: text(buyer.email || contact.email, "", 320),
        paymentGateway: text(object(item.paymentInfo).paymentMethod || array<RecordValue>(item.transactions)[0]?.gateway, "", 180),
        trackingNumber: text(object(array<RecordValue>(item.fulfillments)[0]).trackingInfo ? object(object(array<RecordValue>(item.fulfillments)[0]).trackingInfo).number : "", "", 160),
        lineItems: lineItems.map((line) => ({
          externalId: text(line.id),
          name: text(object(line.productName).original || line.name, "Item", 300),
          quantity: integer(line.quantity, 1),
          total: wixPrice(object(line.price).total || line.totalPrice || line.price),
        })),
        createdAt: isoOrNull(item.createdDate || item.createdAt),
        updatedAt: isoOrNull(item.updatedDate || item.updatedAt),
      });
    }
    const metadata = object(value.metadata);
    const next = text(metadata.nextCursor || object(metadata.pagingMetadata).nextCursor || object(metadata.cursorPaging).nextCursor, "", 2_000);
    if (!rows.length || !next || next === cursor) break;
    cursor = next;
  }
  return output;
};

const pullWix = async (connection: CmsConnectionRow): Promise<PullResult> => {
  const [products, collections, orders] = await Promise.all([
    pullWixProducts(connection),
    pullWixCollections(connection),
    pullWixOrders(connection),
  ]);
  const credentials = wixCredentials(connection);
  return {
    externalStoreId: credentials.siteId,
    products: products.map(normalizeWixProduct),
    categories: collections.map((item) => ({
      externalId: text(item.id),
      name: text(item.name, "Untitled collection", 300),
      parentId: null,
      type: "collection",
      productCount: integer(item.numberOfProducts || item.productCount),
    })),
    orders,
  };
};

const shopifyVersion = () => text(process.env.SHOPIFY_ADMIN_API_VERSION, "2026-07", 20);

const shopifyApi = async (
  connection: CmsConnectionRow,
  queryText: string,
  variables: RecordValue = {},
) => {
  const credentials = decrypt<CmsCredentials>(connection.credentials_encrypted);
  if (!("accessToken" in credentials)) throw new CmsDataError("Shopify Admin API access token is missing.");
  const url = `${storeOrigin(connection)}/admin/api/${shopifyVersion()}/graphql.json`;
  const result = object(await providerFetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Shopify-Access-Token": credentials.accessToken,
    },
    body: JSON.stringify({ query: queryText, variables }),
  }));
  const errors = array<RecordValue>(result.errors);
  if (errors.length) {
    throw new CmsDataError(
      text(errors[0].message, "Shopify rejected the request.", 600),
      502,
      "cms_provider_error",
    );
  }
  return object(result.data);
};

const shopifyPage = async (
  connection: CmsConnectionRow,
  queryText: string,
  root: string,
  variables: RecordValue = {},
) => {
  const nodes: RecordValue[] = [];
  let after: string | null = null;
  for (let page = 0; page < 10; page += 1) {
    const data = await shopifyApi(connection, queryText, { ...variables, after });
    const collection = object(data[root]);
    nodes.push(...array<RecordValue>(collection.nodes));
    const pageInfo = object(collection.pageInfo);
    if (!pageInfo.hasNextPage) break;
    after = text(pageInfo.endCursor, "") || null;
    if (!after) break;
  }
  return nodes;
};

const pullShopify = async (connection: CmsConnectionRow): Promise<PullResult> => {
  const shopData = await shopifyApi(connection, "query { shop { id name myshopifyDomain } }");
  const productQuery = `query Products($after: String) {
    products(first: 100, after: $after) {
      nodes { id title descriptionHtml status vendor productType tags featuredImage { url }
        images(first: 10) { nodes { url } }
        variants(first: 100) { nodes { id title sku price compareAtPrice inventoryQuantity inventoryItem { tracked } image { url } } }
        updatedAt
      }
      pageInfo { hasNextPage endCursor }
    }
  }`;
  const orderQuery = `query Orders($after: String) {
    orders(first: 100, after: $after, sortKey: CREATED_AT, reverse: true) {
      nodes { id name displayFinancialStatus displayFulfillmentStatus email
        customer { displayName email }
        currentTotalPriceSet { shopMoney { amount currencyCode } }
        transactions(first: 5) { gateway }
        fulfillments(first: 5) { trackingInfo { number } }
        lineItems(first: 100) { nodes { id title quantity originalTotalSet { shopMoney { amount } } } }
        createdAt updatedAt
      }
      pageInfo { hasNextPage endCursor }
    }
  }`;
  const collectionQuery = `query Collections($after: String) {
    collections(first: 100, after: $after) { nodes { id title } pageInfo { hasNextPage endCursor } }
  }`;
  const [products, orders, categories] = await Promise.all([
    shopifyPage(connection, productQuery, "products"),
    shopifyPage(connection, orderQuery, "orders"),
    shopifyPage(connection, collectionQuery, "collections"),
  ]);
  const shop = object(shopData.shop);
  return {
    externalStoreId: text(shop.myshopifyDomain || shop.id, "shopify"),
    products: products.map((item) => {
      const variants = array<RecordValue>(object(item.variants).nodes).map((variant) => ({
        id: "",
        externalId: text(variant.id),
        title: text(variant.title, "Default variant", 200),
        sku: text(variant.sku, "", 160),
        price: money(variant.price),
        compareAtPrice: variant.compareAtPrice == null ? null : money(variant.compareAtPrice),
        inventoryQuantity: variant.inventoryQuantity == null ? null : integer(variant.inventoryQuantity),
        inventoryManaged: object(variant.inventoryItem).tracked === true,
        imageUrl: text(object(variant.image).url, "", 1_000),
        attributes: {},
      }));
      const first = variants[0];
      return {
        externalId: text(item.id),
        title: text(item.title, "Untitled product", 300),
        description: text(item.descriptionHtml, "", 20_000),
        shortDescription: "",
        status: text(item.status, "DRAFT", 40).toLowerCase(),
        sku: text(first?.sku, "", 160),
        price: first?.price || 0,
        compareAtPrice: first?.compareAtPrice ?? null,
        salePrice: null,
        currency: "USD",
        inventoryQuantity: first?.inventoryQuantity ?? null,
        inventoryManaged: first?.inventoryManaged || false,
        featured: false,
        productType: text(item.productType, "", 120),
        vendor: text(item.vendor, "", 180),
        tags: array<string>(item.tags).map((tag) => text(tag)).filter(Boolean),
        imageUrl: text(object(item.featuredImage).url, "", 1_000),
        images: array<RecordValue>(object(item.images).nodes).map((image) => text(image.url, "", 1_000)).filter(Boolean),
        externalUpdatedAt: isoOrNull(item.updatedAt),
        variants,
      };
    }),
    categories: categories.map((item) => ({
      externalId: text(item.id),
      name: text(item.title, "Untitled collection", 300),
      parentId: null,
      type: "collection",
      productCount: 0,
    })),
    orders: orders.map((item) => {
      const total = object(object(item.currentTotalPriceSet).shopMoney);
      const customer = object(item.customer);
      const fulfillments = array<RecordValue>(item.fulfillments);
      const tracking = object(array<RecordValue>(object(fulfillments[0]).trackingInfo)[0]);
      return {
        externalId: text(item.id),
        orderNumber: text(item.name || item.id, "Order", 120),
        status: text(item.displayFinancialStatus, "pending", 50).toLowerCase(),
        fulfillmentStatus: text(item.displayFulfillmentStatus, "", 50).toLowerCase(),
        total: money(total.amount),
        currency: text(total.currencyCode, "USD", 8),
        customerName: text(customer.displayName, "", 240),
        customerEmail: text(item.email || customer.email, "", 320),
        paymentGateway: text(array<RecordValue>(item.transactions)[0]?.gateway, "", 180),
        trackingNumber: text(tracking.number, "", 160),
        lineItems: array<RecordValue>(object(item.lineItems).nodes).map((line) => ({
          externalId: text(line.id),
          name: text(line.title, "Item", 300),
          quantity: integer(line.quantity, 1),
          total: money(object(object(line.originalTotalSet).shopMoney).amount),
        })),
        createdAt: isoOrNull(item.createdAt),
        updatedAt: isoOrNull(item.updatedAt),
      };
    }),
  };
};

type CmsProductPayload = {
  title: string;
  description: string;
  shortDescription?: string;
  status: string;
  sku: string;
  price: number;
  compareAtPrice: number | null;
  inventoryQuantity: number | null;
  inventoryManaged: boolean;
  productType: string;
  vendor: string;
  tags: string[];
  attributes?: CmsProductAttribute[];
  categoryIds?: string[];
  images?: string[];
  customFields?: CmsCustomField[];
  deletedCustomFieldIds?: number[];
  deletedCustomFields?: Array<{ id: number; key: string }>;
  variants?: RecordValue[];
  deletedVariantIds?: string[];
};

const hasInput = (input: RecordValue, key: string) =>
  Object.prototype.hasOwnProperty.call(input, key);

const normalizeExternalIds = (value: unknown) =>
  Array.from(
    new Set(
      array<unknown>(value)
        .map((item) => text(item, "", 120))
        .filter(Boolean),
    ),
  ).slice(0, 100);

const wooProductStatus = (value: unknown) => {
  const normalized = text(value, "draft", 40).toLowerCase();
  if (["publish", "pending", "private", "draft"].includes(normalized)) return normalized;
  if (normalized === "active" || normalized === "published") return "publish";
  return "draft";
};

const wooProductType = (value: unknown) => {
  const normalized = text(value, "simple", 40).toLowerCase();
  return ["simple", "variable", "grouped", "external"].includes(normalized) ? normalized : "simple";
};

const normalizeVariantInput = (value: unknown): RecordValue => {
  const input = object(value);
  const inventoryQuantity = input.inventoryQuantity == null ? null : integer(input.inventoryQuantity);
  return {
    externalId: text(input.externalId, "", 120),
    title: text(input.title, "", 300),
    status: wooProductStatus(input.status),
    sku: text(input.sku, "", 160),
    price: Math.max(0, decimal(input.price)),
    compareAtPrice: input.compareAtPrice == null ? null : Math.max(0, decimal(input.compareAtPrice)),
    inventoryQuantity,
    inventoryManaged: hasInput(input, "inventoryManaged")
      ? boolean(input.inventoryManaged, inventoryQuantity != null)
      : inventoryQuantity != null,
    imageUrl: text(input.imageUrl, "", 1_000),
    attributes: normalizeVariantAttributes(input.attributes),
    customFields: hasInput(input, "customFields") ? normalizeCustomFields(input.customFields) : undefined,
    deletedCustomFieldIds: normalizeCustomFieldIds(input.deletedCustomFieldIds),
    deletedCustomFields: customFieldDeletePayload(input.deletedCustomFields),
  };
};

const cmsPayload = (input: RecordValue): CmsProductPayload => {
  const inventoryQuantity = input.inventoryQuantity == null ? null : integer(input.inventoryQuantity);
  const payload: CmsProductPayload = {
    title: text(input.title, "Untitled product", 300),
    description: text(input.description, "", 20_000),
    status: text(input.status, "draft", 40).toLowerCase(),
    sku: text(input.sku, "", 160),
    price: Math.max(0, decimal(input.price)),
    compareAtPrice: input.compareAtPrice == null ? null : Math.max(0, decimal(input.compareAtPrice)),
    inventoryQuantity,
    inventoryManaged: hasInput(input, "inventoryManaged")
      ? boolean(input.inventoryManaged, inventoryQuantity != null)
      : inventoryQuantity != null,
    productType: text(input.productType, "", 120),
    vendor: text(input.vendor, "", 180),
    tags: array<string>(input.tags).map((tag) => text(tag, "", 80)).filter(Boolean).slice(0, 100),
    deletedCustomFieldIds: normalizeCustomFieldIds(input.deletedCustomFieldIds),
    deletedCustomFields: customFieldDeletePayload(input.deletedCustomFields),
    deletedVariantIds: normalizeExternalIds(input.deletedVariantIds),
  };
  if (hasInput(input, "shortDescription")) payload.shortDescription = text(input.shortDescription, "", 4_000);
  if (Array.isArray(input.attributes)) payload.attributes = normalizeProductAttributes(input.attributes);
  if (Array.isArray(input.categoryIds)) payload.categoryIds = normalizeCategoryIds(input.categoryIds);
  if (Array.isArray(input.images)) {
    payload.images = array<unknown>(input.images).map((image) => text(image, "", 1_000)).filter(Boolean).slice(0, 100);
  }
  if (hasInput(input, "customFields")) payload.customFields = normalizeCustomFields(input.customFields);
  if (Array.isArray(input.variants)) payload.variants = array<unknown>(input.variants).map(normalizeVariantInput).slice(0, 100);
  return payload;
};

const normalizeWooProduct = (item: RecordValue, variationItems: RecordValue[] = []): NormalizedProduct => ({
  externalId: text(item.id),
  title: text(item.name, "Untitled product", 300),
  description: text(item.description, "", 20_000),
  shortDescription: text(item.short_description, "", 4_000),
  status: text(item.status, "draft", 40),
  sku: text(item.sku, "", 160),
  price: money(item.price),
  compareAtPrice: item.regular_price ? money(item.regular_price) : null,
  salePrice: item.sale_price ? money(item.sale_price) : null,
  currency: "USD",
  inventoryQuantity: item.stock_quantity == null ? null : integer(item.stock_quantity),
  inventoryManaged: item.manage_stock === true,
  featured: item.featured === true,
  productType: text(item.type, "simple", 80),
  vendor: "",
  tags: array<RecordValue>(item.tags).map((tag) => text(tag.name)).filter(Boolean),
  attributes: normalizeProductAttributes(item.attributes),
  categoryIds: normalizeCategoryIds(item.categories),
  customFields: normalizeCustomFields(item.meta_data),
  imageUrl: text(object(array<RecordValue>(item.images)[0]).src, "", 1_000),
  images: array<RecordValue>(item.images).map((image) => text(image.src, "", 1_000)).filter(Boolean),
  externalUpdatedAt: isoOrNull(item.date_modified),
  variants: variationItems.map(normalizeWooVariant),
});

const wooProductPayload = (payload: CmsProductPayload): RecordValue => {
  const type = wooProductType(payload.productType);
  const body: RecordValue = {
    name: payload.title,
    type,
    status: wooProductStatus(payload.status),
    description: payload.description,
    sku: payload.sku,
    manage_stock: payload.inventoryManaged,
    stock_quantity: payload.inventoryQuantity,
    tags: payload.tags.map((name) => ({ name })),
  };
  if (payload.shortDescription !== undefined) body.short_description = payload.shortDescription;
  if (type !== "variable") {
    body.regular_price = payload.compareAtPrice == null ? payload.price.toFixed(2) : payload.compareAtPrice.toFixed(2);
    body.sale_price = payload.compareAtPrice == null ? "" : payload.price.toFixed(2);
  }
  if (payload.categoryIds !== undefined) {
    body.categories = payload.categoryIds
      .map((id) => integer(id))
      .filter((id) => id > 0)
      .map((id) => ({ id }));
  }
  if (payload.images !== undefined) body.images = payload.images.map((src) => ({ src }));
  if (payload.attributes !== undefined) {
    body.attributes = payload.attributes.map((attribute) => ({
      ...(attribute.id ? { id: attribute.id } : {}),
      name: attribute.name,
      ...(attribute.slug ? { slug: attribute.slug } : {}),
      position: attribute.position || 0,
      visible: attribute.visible,
      variation: attribute.variation,
      options: attribute.options,
    }));
  }
  if (payload.customFields !== undefined || payload.deletedCustomFieldIds?.length || payload.deletedCustomFields?.length) {
    body.meta_data = [
      ...(payload.customFields !== undefined ? customFieldPayload(payload.customFields) : []),
      ...(payload.deletedCustomFieldIds || []).map((id) => ({ id, value: null })),
      ...(payload.deletedCustomFields || []).map((field) => ({ id: field.id, key: field.key, value: null })),
    ];
  }
  return body;
};

const mergeWooProductInput = (input: RecordValue, existing: RecordValue): RecordValue => {
  const merged: RecordValue = { ...input };
  const copyIfMissing = (key: string, value: unknown) => {
    if (!hasInput(merged, key) && value !== undefined) merged[key] = value;
  };
  copyIfMissing("productType", existing.type);
  copyIfMissing("status", existing.status);
  copyIfMissing("title", existing.name);
  copyIfMissing("description", existing.description);
  copyIfMissing("shortDescription", existing.short_description);
  copyIfMissing("sku", existing.sku);
  copyIfMissing("price", existing.price);
  copyIfMissing("compareAtPrice", existing.regular_price);
  copyIfMissing("inventoryQuantity", existing.stock_quantity);
  copyIfMissing("inventoryManaged", existing.manage_stock);
  copyIfMissing("categoryIds", normalizeCategoryIds(existing.categories));
  copyIfMissing("images", array<RecordValue>(existing.images).map((image) => text(image.src, "", 1_000)).filter(Boolean));
  copyIfMissing("attributes", normalizeProductAttributes(existing.attributes));
  copyIfMissing("customFields", normalizeCustomFields(existing.meta_data));
  if (hasInput(input, "customFields") || hasInput(input, "deletedCustomFieldIds") || hasInput(input, "deletedCustomFields")) {
    const existingFields = normalizeCustomFields(existing.meta_data);
    const deletedIds = new Set(normalizeCustomFieldIds(input.deletedCustomFieldIds));
    const requestedDeletedFields = customFieldDeletePayload(input.deletedCustomFields);
    const deletedFields = [
      ...requestedDeletedFields,
      ...existingFields
        .filter((field) => field.id && deletedIds.has(field.id))
        .map((field) => ({ id: field.id as number, key: field.key })),
    ].filter((field, index, all) => all.findIndex((candidate) => candidate.id === field.id) === index);
    merged.customFields = mergeCustomFields(
      existing.meta_data,
      input.customFields,
      input.deletedCustomFieldIds,
      input.deletedCustomFields,
    );
    merged.deletedCustomFieldIds = [];
    merged.deletedCustomFields = deletedFields;
  }
  return merged;
};

const wooVariationPayload = (value: RecordValue, parentAttributes: CmsProductAttribute[]) => {
  const variant = normalizeVariantInput(value);
  const attributes = object(variant.attributes);
  const wooAttributes = Object.entries(attributes)
    .map(([name, option]) => {
      const match = parentAttributes.find((attribute) =>
        attribute.name.toLowerCase() === name.toLowerCase() ||
        Boolean(attribute.slug && attribute.slug.toLowerCase() === name.toLowerCase()),
      );
      return {
        ...(match?.id ? { id: match.id } : {}),
        name: match?.name || name,
        option,
      };
    })
    .filter((attribute) => attribute.name && attribute.option);
  const body: RecordValue = {
    status: wooProductStatus(variant.status),
    sku: text(variant.sku),
    regular_price: variant.compareAtPrice == null ? decimal(variant.price).toFixed(2) : decimal(variant.compareAtPrice).toFixed(2),
    sale_price: variant.compareAtPrice == null ? "" : decimal(variant.price).toFixed(2),
    manage_stock: variant.inventoryManaged === true,
    stock_quantity: variant.inventoryQuantity,
    attributes: wooAttributes,
  };
  if (text(variant.title)) body.description = text(variant.title, "", 20_000);
  if (text(variant.imageUrl)) body.image = { src: text(variant.imageUrl, "", 1_000) };
    if (variant.customFields !== undefined || array<number>(variant.deletedCustomFieldIds).length || array<RecordValue>(variant.deletedCustomFields).length) {
    body.meta_data = [
      ...(variant.customFields !== undefined ? customFieldPayload(variant.customFields) : []),
      ...array<number>(variant.deletedCustomFieldIds).map((id) => ({ id, value: null })),
      ...array<RecordValue>(variant.deletedCustomFields)
        .map((field) => ({ id: integer(field.id), key: text(field.key, "", 200), value: null }))
        .filter((field) => field.id > 0 && field.key),
    ];
  }
  return body;
};

const fetchWooProduct = async (connection: CmsConnectionRow, externalId: string) => {
  const item = object(await wooApi(connection, `/products/${encodeURIComponent(externalId)}`));
  const variations = wooProductType(item.type) === "variable"
    ? await wooPages(connection, `products/${encodeURIComponent(externalId)}/variations`)
    : [];
  return normalizeWooProduct(item, variations);
};

const syncWooVariations = async (connection: CmsConnectionRow, parentExternalId: string, payload: CmsProductPayload) => {
  const parentAttributes = payload.attributes || [];
  for (const variationId of payload.deletedVariantIds || []) {
    await wooApi(connection, `/products/${encodeURIComponent(parentExternalId)}/variations/${encodeURIComponent(variationId)}?force=true`, {
      method: "DELETE",
    });
  }
  for (const variant of payload.variants || []) {
    const externalId = text(variant.externalId, "", 120);
    const path = externalId
      ? `/products/${encodeURIComponent(parentExternalId)}/variations/${encodeURIComponent(externalId)}`
      : `/products/${encodeURIComponent(parentExternalId)}/variations`;
    await wooApi(connection, path, {
      method: externalId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(wooVariationPayload(variant, parentAttributes)),
    });
  }
};

const createWooProduct = async (connection: CmsConnectionRow, input: RecordValue) => {
  const payload = cmsPayload(input);
  const value = object(await wooApi(connection, "/products", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(wooProductPayload(payload)),
  }));
  const externalId = text(value.id, "", 120);
  if (!externalId) throw new CmsDataError("WooCommerce did not return the new product ID.", 502, "cms_provider_error");
  if (wooProductType(payload.productType) === "variable") await syncWooVariations(connection, externalId, payload);
  return fetchWooProduct(connection, externalId);
};

const updateWooProduct = async (connection: CmsConnectionRow, externalId: string, input: RecordValue) => {
  const existing = object(await wooApi(connection, `/products/${encodeURIComponent(externalId)}`));
  const payload = cmsPayload(mergeWooProductInput(input, existing));
  const shouldSyncVariations = payload.variants !== undefined || Boolean(payload.deletedVariantIds?.length);
  const isVariable = wooProductType(payload.productType) === "variable";
  await wooApi(connection, `/products/${encodeURIComponent(externalId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(wooProductPayload(payload)),
  });
  if (isVariable && shouldSyncVariations) {
    await syncWooVariations(connection, externalId, payload);
  }
  return fetchWooProduct(connection, externalId);
};

const bigcommerceProductPayload = (input: RecordValue) => {
  const payload = cmsPayload(input);
  return {
    name: payload.title,
    type: "physical",
    description: payload.description,
    sku: payload.sku,
    price: payload.price,
    retail_price: payload.compareAtPrice ?? payload.price,
    sale_price: payload.compareAtPrice != null ? payload.price : 0,
    is_visible: payload.status === "publish" || payload.status === "active",
    inventory_tracking: payload.inventoryQuantity == null ? "none" : "product",
    inventory_level: payload.inventoryQuantity == null ? 0 : payload.inventoryQuantity,
    brand_name: payload.vendor,
  };
};

const createBigCommerceProduct = async (connection: CmsConnectionRow, input: RecordValue) => {
  const value = object(await bigcommerceApi(connection, "/v3/catalog/products", {
    method: "POST",
    body: JSON.stringify(bigcommerceProductPayload(input)),
  }));
  return normalizeBigCommerceProduct(object(value.data));
};

const updateBigCommerceProduct = async (connection: CmsConnectionRow, externalId: string, input: RecordValue) => {
  const value = object(await bigcommerceApi(connection, `/v3/catalog/products/${encodeURIComponent(externalId)}`, {
    method: "PUT",
    body: JSON.stringify(bigcommerceProductPayload(input)),
  }));
  return normalizeBigCommerceProduct(object(value.data));
};

const createWixProduct = async (connection: CmsConnectionRow, input: RecordValue) => {
  const payload = cmsPayload(input);
  const value = object(await wixApi(connection, "/stores/v1/products", {
    method: "POST",
    body: JSON.stringify({ product: {
      name: payload.title,
      description: payload.description,
      productType: "physical",
      sku: payload.sku,
      visible: payload.status === "publish" || payload.status === "active",
      priceData: { price: payload.price },
    } }),
  }));
  return normalizeWixProduct(Object.keys(object(value.product)).length ? object(value.product) : value);
};

const updateWixProduct = async (connection: CmsConnectionRow, externalId: string, input: RecordValue) => {
  const payload = cmsPayload(input);
  const value = object(await wixApi(connection, `/stores/v1/products/${encodeURIComponent(externalId)}`, {
    method: "PATCH",
    body: JSON.stringify({ product: {
      name: payload.title,
      description: payload.description,
      sku: payload.sku,
      visible: payload.status === "publish" || payload.status === "active",
      priceData: { price: payload.price },
    } }),
  }));
  return normalizeWixProduct(Object.keys(object(value.product)).length ? object(value.product) : { ...value, id: externalId });
};

const deleteBigCommerceProduct = async (connection: CmsConnectionRow, externalId: string) => {
  await bigcommerceApi(connection, `/v3/catalog/products/${encodeURIComponent(externalId)}`, { method: "DELETE" });
};

const deleteWixProduct = async (connection: CmsConnectionRow, externalId: string) => {
  await wixApi(connection, `/stores/v1/products/${encodeURIComponent(externalId)}`, { method: "DELETE" });
};

const shopifyProductInput = (input: RecordValue) => {
  const payload = cmsPayload(input);
  return {
    title: payload.title,
    descriptionHtml: payload.description,
    status: payload.status === "publish" || payload.status === "active" ? "ACTIVE" : "DRAFT",
    vendor: payload.vendor,
    productType: payload.productType,
    tags: payload.tags,
  };
};

const createShopifyProduct = async (connection: CmsConnectionRow, input: RecordValue) => {
  const result = await shopifyApi(connection, `mutation ProductCreate($product: ProductCreateInput!) {
    productCreate(product: $product) { product { id title descriptionHtml status vendor productType tags updatedAt } userErrors { field message } }
  }`, { product: shopifyProductInput(input) });
  const payload = object(result.productCreate);
  const errors = array<RecordValue>(payload.userErrors);
  if (errors.length) throw new CmsDataError(text(errors[0].message, "Shopify could not create the product.", 600), 502, "cms_provider_error");
  const product = object(payload.product);
  return {
    externalId: text(product.id),
    title: text(product.title, "Untitled product", 300),
    description: text(product.descriptionHtml, "", 20_000),
    shortDescription: "",
    status: text(product.status, "DRAFT").toLowerCase(),
    sku: "",
    price: 0,
    compareAtPrice: null,
    salePrice: null,
    currency: "USD",
    inventoryQuantity: null,
    inventoryManaged: false,
    featured: false,
    productType: text(product.productType, "", 120),
    vendor: text(product.vendor, "", 180),
    tags: array<string>(product.tags),
    imageUrl: "",
    images: [],
    externalUpdatedAt: isoOrNull(product.updatedAt),
    variants: [],
  } satisfies NormalizedProduct;
};

const updateShopifyProduct = async (connection: CmsConnectionRow, externalId: string, input: RecordValue) => {
  const result = await shopifyApi(connection, `mutation ProductUpdate($product: ProductUpdateInput!) {
    productUpdate(product: $product) { product { id title descriptionHtml status vendor productType tags updatedAt } userErrors { field message } }
  }`, { product: { id: externalId, ...shopifyProductInput(input) } });
  const payload = object(result.productUpdate);
  const errors = array<RecordValue>(payload.userErrors);
  if (errors.length) throw new CmsDataError(text(errors[0].message, "Shopify could not update the product.", 600), 502, "cms_provider_error");
  const product = object(payload.product);
  return {
    externalId: text(product.id, externalId),
    title: text(product.title, "Untitled product", 300),
    description: text(product.descriptionHtml, "", 20_000),
    shortDescription: "",
    status: text(product.status, "DRAFT").toLowerCase(),
    sku: "",
    price: 0,
    compareAtPrice: null,
    salePrice: null,
    currency: "USD",
    inventoryQuantity: null,
    inventoryManaged: false,
    featured: false,
    productType: text(product.productType, "", 120),
    vendor: text(product.vendor, "", 180),
    tags: array<string>(product.tags),
    imageUrl: "",
    images: [],
    externalUpdatedAt: isoOrNull(product.updatedAt),
    variants: [],
  } satisfies NormalizedProduct;
};

const createProductOnProvider = async (connection: CmsConnectionRow, input: RecordValue) => {
  if (connection.platform === "woocommerce") return createWooProduct(connection, input);
  if (connection.platform === "bigcommerce") return createBigCommerceProduct(connection, input);
  if (connection.platform === "wix") return createWixProduct(connection, input);
  return createShopifyProduct(connection, input);
};

const updateProductOnProvider = async (connection: CmsConnectionRow, externalId: string, input: RecordValue) => {
  if (connection.platform === "woocommerce") return updateWooProduct(connection, externalId, input);
  if (connection.platform === "bigcommerce") return updateBigCommerceProduct(connection, externalId, input);
  if (connection.platform === "wix") return updateWixProduct(connection, externalId, input);
  return updateShopifyProduct(connection, externalId, input);
};

const deleteProductOnProvider = async (connection: CmsConnectionRow, externalId: string) => {
  if (connection.platform === "woocommerce") {
    await wooApi(connection, `/products/${encodeURIComponent(externalId)}?force=true`, { method: "DELETE" });
    return;
  }
  if (connection.platform === "bigcommerce") {
    await deleteBigCommerceProduct(connection, externalId);
    return;
  }
  if (connection.platform === "wix") {
    await deleteWixProduct(connection, externalId);
    return;
  }
  const result = await shopifyApi(connection, `mutation ProductDelete($input: ProductDeleteInput!) {
    productDelete(input: $input) { deletedProductId userErrors { field message } }
  }`, { input: { id: externalId } });
  const payload = object(result.productDelete);
  const errors = array<RecordValue>(payload.userErrors);
  if (errors.length) throw new CmsDataError(text(errors[0].message, "Shopify could not delete the product.", 600), 502, "cms_provider_error");
};

const registerWooWebhooks = async (connection: CmsConnectionRow, secret: string) => {
  const callback = webhookUrl(connection.id, secret);
  const topics = [
    "product.created", "product.updated", "product.deleted",
    "order.created", "order.updated", "order.deleted",
    "product_category.created", "product_category.updated", "product_category.deleted",
  ];
  for (const topic of topics) {
    await wooApi(connection, "/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `MaxForm ${topic}`, topic, delivery_url: callback, secret, status: "active" }),
    });
  }
};

const registerShopifyWebhooks = async (connection: CmsConnectionRow, secret: string) => {
  // Shopify signs webhook bodies with the app client secret, not the
  // per-connection callback token included in our URL.
  shopifyWebhookSecret();
  const callback = webhookUrl(connection.id, secret);
  const topics = [
    "PRODUCTS_CREATE", "PRODUCTS_UPDATE", "PRODUCTS_DELETE",
    "ORDERS_CREATE", "ORDERS_UPDATED", "ORDERS_DELETE",
    "COLLECTIONS_CREATE", "COLLECTIONS_UPDATE", "COLLECTIONS_DELETE",
  ];
  for (const topic of topics) {
    const result = await shopifyApi(connection, `mutation WebhookCreate($topic: WebhookSubscriptionTopic!, $callbackUrl: URL!) {
      webhookSubscriptionCreate(topic: $topic, webhookSubscription: { callbackUrl: $callbackUrl, format: JSON }) {
        webhookSubscription { id }
        userErrors { field message }
      }
    }`, { topic, callbackUrl: callback });
    const payload = object(result.webhookSubscriptionCreate);
    const errors = array<RecordValue>(payload.userErrors);
    if (errors.length) throw new CmsDataError(text(errors[0].message, "Shopify could not register webhooks.", 600), 502, "cms_webhook_error");
  }
};

const registerBigCommerceWebhooks = async (connection: CmsConnectionRow, secret: string) => {
  const callback = webhookUrl(connection.id, secret);
  const scopes = [
    "store/product/created", "store/product/updated", "store/product/deleted",
    "store/category/created", "store/category/updated", "store/category/deleted",
    "store/order/created", "store/order/updated", "store/order/statusUpdated",
  ];
  for (const scope of scopes) {
    await bigcommerceApi(connection, "/v3/hooks", {
      method: "POST",
      body: JSON.stringify({
        scope,
        destination: callback,
        is_active: true,
        headers: { "x-maxform-webhook-token": secret },
      }),
    });
  }
};

const webhookUrl = (connectionId: string, secret: string) => {
  const origin = configuredAppUrl();
  if (!origin) throw new CmsDataError("Set PUBLIC_APP_URL before enabling store webhooks.", 503, "cms_webhook_origin_missing");
  return `${origin}/api/cms/webhook?connection=${encodeURIComponent(connectionId)}&token=${encodeURIComponent(secret)}`;
};

const shopifyWebhookSecret = () => {
  const secret = text(
    process.env.SHOPIFY_APP_CLIENT_SECRET || process.env.SHOPIFY_WEBHOOK_CLIENT_SECRET,
    "",
    500,
  );
  if (!secret) {
    throw new CmsDataError(
      "Set SHOPIFY_APP_CLIENT_SECRET before enabling Shopify webhooks.",
      503,
      "cms_shopify_webhook_secret_missing",
    );
  }
  return secret;
};

const registerWebhooks = async (connection: CmsConnectionRow, secret: string) => {
  if (connection.platform === "woocommerce") return registerWooWebhooks(connection, secret);
  if (connection.platform === "bigcommerce") return registerBigCommerceWebhooks(connection, secret);
  if (connection.platform === "wix") return;
  return registerShopifyWebhooks(connection, secret);
};

const getConnection = async (workspaceId: string, connectionId: string) => {
  if (!isUuid(connectionId)) throw new CmsDataError("That store connection is not valid.");
  const rows = await query<CmsConnectionRow>(
    "SELECT * FROM cms_connections WHERE id = $1 AND workspace_id = $2 LIMIT 1",
    [connectionId, workspaceId],
  );
  if (!rows[0]) throw new CmsDataError("That store connection was not found.", 404, "cms_connection_not_found");
  return rows[0];
};

/**
 * Disconnecting removes only MaxForm's workspace projection. It never calls
 * a provider delete endpoint, so products, orders, customers, and settings
 * remain on the external store. The connection shell is retained as
 * `disconnected` so the user can reconnect without entering credentials
 * again; disconnected connections are rejected by sync and webhook paths.
 */
const disconnectConnection = async (workspaceId: string, connectionId: string) => {
  await getConnection(workspaceId, connectionId);
  const connectionDatabase = database();
  const timelinePattern = `store:%:${connectionId}:%`;
  await connectionDatabase.transaction((transaction) => [
    transaction.query(
      `WITH store_contacts AS (
         SELECT DISTINCT timeline.contact_id
         FROM crm_timeline_events timeline
         WHERE timeline.user_id=$1
           AND timeline.contact_id IS NOT NULL
           AND timeline.source_module='stores'
           AND (timeline.metadata->>'cmsConnectionId'=$2 OR timeline.dedupe_key LIKE $3)
       ), deletable_contacts AS (
         SELECT contact.id
         FROM contacts contact
         JOIN store_contacts store_contact ON store_contact.contact_id=contact.id
         WHERE contact.created_by=$1
           AND contact.source_type='store'
           AND NOT EXISTS (
             SELECT 1 FROM crm_timeline_events other_timeline
             WHERE other_timeline.user_id=$1
               AND other_timeline.contact_id=contact.id
               AND (
                 other_timeline.source_module <> 'stores'
                 OR (
                   (
                     other_timeline.metadata->>'cmsConnectionId' IS NOT NULL
                     AND other_timeline.metadata->>'cmsConnectionId' <> $2
                   )
                   OR (
                     other_timeline.metadata->>'cmsConnectionId' IS NULL
                     AND other_timeline.dedupe_key NOT LIKE $3
                   )
                 )
               )
           )
           AND NOT EXISTS (
             SELECT 1 FROM payment_orders other_order
             WHERE other_order.user_id=$1
               AND other_order.contact_id=contact.id
               AND NOT (
                 other_order.metadata->>'sourceModule'='stores'
                 AND other_order.metadata->>'cmsConnectionId'=$2
               )
           )
       )
       DELETE FROM contacts contact
       USING deletable_contacts
       WHERE contact.id=deletable_contacts.id`,
      [workspaceId, connectionId, timelinePattern],
    ),
    transaction.query(
      `DELETE FROM crm_timeline_events
       WHERE user_id=$1 AND source_module='stores'
         AND (metadata->>'cmsConnectionId'=$2 OR dedupe_key LIKE $3)`,
      [workspaceId, connectionId, timelinePattern],
    ),
    transaction.query(
      `DELETE FROM payment_orders
       WHERE user_id=$1
         AND metadata->>'sourceModule'='stores'
         AND metadata->>'cmsConnectionId'=$2`,
      [workspaceId, connectionId],
    ),
    transaction.query(
      `DELETE FROM workspace_workflow_executions execution
       USING workspace_workflows workflow
       WHERE execution.workflow_id=workflow.id
         AND workflow.workspace_id=$1
         AND execution.trigger_payload->>'connectionId'=$2`,
      [workspaceId, connectionId],
    ),
    transaction.query(
      `DELETE FROM workspace_workflow_events
       WHERE workspace_id=$1 AND payload_json->>'connectionId'=$2`,
      [workspaceId, connectionId],
    ),
    transaction.query(
      "DELETE FROM cms_sync_events WHERE cms_connection_id=$1",
      [connectionId],
    ),
    transaction.query(
      "DELETE FROM cms_products WHERE cms_connection_id=$1",
      [connectionId],
    ),
    transaction.query(
      "DELETE FROM cms_categories WHERE cms_connection_id=$1",
      [connectionId],
    ),
    transaction.query(
      "DELETE FROM cms_orders WHERE cms_connection_id=$1",
      [connectionId],
    ),
    transaction.query(
      `UPDATE cms_connections
       SET status='disconnected', external_store_id='', webhook_registered=FALSE,
           sync_lock_token=NULL, sync_lock_expires_at=NULL, last_error='',
           last_synced_at=NULL, last_reconciliation_at=NULL,
           product_count=0, category_count=0, order_count=0, updated_at=NOW()
       WHERE id=$1 AND workspace_id=$2`,
      [connectionId, workspaceId],
    ),
  ]);
  return { disconnected: true, dataRemoved: true };
};

const mapConnection = (row: RecordValue): CmsConnection => ({
  id: text(row.id),
  platform: CMS_PLATFORMS.includes(row.platform as CmsPlatform) ? row.platform as CmsPlatform : "woocommerce",
  platformName: CMS_PLATFORMS.includes(row.platform as CmsPlatform) ? cmsPlatformName(row.platform as CmsPlatform) : "WooCommerce",
  name: text(row.name, "Connected store", 160),
  storeUrl: text(row.store_url, "", 600),
  externalStoreId: text(row.external_store_id),
  status: row.status === "healthy" || row.status === "syncing" || row.status === "disconnected" ? row.status : "attention",
  webhookRegistered: row.webhook_registered === true,
  lastError: text(row.last_error, "", 1_000),
  lastSyncedAt: row.last_synced_at ? String(row.last_synced_at) : null,
  lastReconciliationAt: row.last_reconciliation_at ? String(row.last_reconciliation_at) : null,
  counts: {
    products: integer(row.product_count),
    categories: integer(row.category_count),
    orders: integer(row.order_count),
  },
  createdAt: String(row.created_at || new Date().toISOString()),
  updatedAt: String(row.updated_at || new Date().toISOString()),
});

const mapVariant = (row: RecordValue): CmsProductVariant => {
  const cached = safeJson<RecordValue>(row.cached_data, {});
  return {
    id: text(row.id),
    externalId: text(row.external_id),
    title: text(row.title, "Default variant", 200),
    status: text(cached.status, "publish", 40),
    sku: text(row.sku, "", 160),
    price: decimal(row.price_cents) / 100,
    compareAtPrice: row.compare_at_price_cents == null ? null : decimal(row.compare_at_price_cents) / 100,
    inventoryQuantity: row.inventory_quantity == null ? null : integer(row.inventory_quantity),
    inventoryManaged: row.inventory_managed === true,
    imageUrl: text(row.image_url, "", 1_000),
    attributes: safeJson<RecordValue>(row.attributes, {}),
    customFields: normalizeCustomFields(cached.customFields),
  };
};

const mapProduct = (row: RecordValue, variants: CmsProductVariant[] = []): CmsProduct => {
  const cached = safeJson<RecordValue>(row.cached_data, {});
  return {
  id: text(row.id),
  connectionId: text(row.cms_connection_id),
  platform: CMS_PLATFORMS.includes(row.platform as CmsPlatform) ? row.platform as CmsPlatform : "woocommerce",
  storeName: text(row.store_name, "Connected store", 160),
  externalId: text(row.external_id),
  title: text(row.title, "Untitled product", 300),
  description: text(row.description, "", 20_000),
  shortDescription: text(row.short_description, "", 4_000),
  status: text(row.status, "draft", 40),
  sku: text(row.sku, "", 160),
  price: decimal(row.price_cents) / 100,
  compareAtPrice: row.compare_at_price_cents == null ? null : decimal(row.compare_at_price_cents) / 100,
  salePrice: row.sale_price_cents == null ? null : decimal(row.sale_price_cents) / 100,
  currency: text(row.currency, "USD", 8),
  inventoryQuantity: row.inventory_quantity == null ? null : integer(row.inventory_quantity),
  inventoryManaged: row.inventory_managed === true,
  featured: row.featured === true,
  productType: text(row.product_type, "", 120),
  vendor: text(row.vendor, "", 180),
  tags: array<unknown>(safeJson(row.tags, [])).map((tag) => text(tag)).filter(Boolean),
  attributes: normalizeProductAttributes(cached.attributes),
  categoryIds: normalizeCategoryIds(cached.categoryIds),
  customFields: normalizeCustomFields(cached.customFields),
  imageUrl: text(row.image_url, "", 1_000),
  images: array<unknown>(safeJson(row.images, [])).map((image) => text(image)).filter(Boolean),
  variants,
  externalUpdatedAt: row.external_updated_at ? String(row.external_updated_at) : null,
  lastPulledAt: row.last_pulled_at ? String(row.last_pulled_at) : null,
  };
};

const mapCategory = (row: RecordValue): CmsCategory => ({
  id: text(row.id),
  connectionId: text(row.cms_connection_id),
  platform: CMS_PLATFORMS.includes(row.platform as CmsPlatform) ? row.platform as CmsPlatform : "woocommerce",
  storeName: text(row.store_name, "Connected store", 160),
  externalId: text(row.external_id),
  name: text(row.name, "Untitled collection", 300),
  parentId: text(row.parent_id, "") || null,
  type: row.type === "category" ? "category" : "collection",
  productCount: integer(row.product_count),
  lastPulledAt: row.last_pulled_at ? String(row.last_pulled_at) : null,
});

const mapOrder = (row: RecordValue): CmsOrder => ({
  id: text(row.id),
  connectionId: text(row.cms_connection_id),
  platform: CMS_PLATFORMS.includes(row.platform as CmsPlatform) ? row.platform as CmsPlatform : "woocommerce",
  storeName: text(row.store_name, "Connected store", 160),
  externalId: text(row.external_id),
  orderNumber: text(row.order_number, "Order", 120),
  status: text(row.status, "pending", 50),
  fulfillmentStatus: text(row.fulfillment_status, "", 50),
  total: decimal(row.total_cents) / 100,
  currency: text(row.currency, "USD", 8),
  customerName: text(row.customer_name, "", 240),
  customerEmail: text(row.customer_email, "", 320),
  paymentGateway: text(row.payment_gateway_used, "", 180),
  trackingNumber: text(row.tracking_number, "", 160),
  lineItems: array<RecordValue>(safeJson(row.line_items, [])).map((line) => ({
    externalId: text(line.externalId || line.external_id || line.id),
    name: text(line.name, "Item", 300),
    quantity: integer(line.quantity, 1),
    total: money(line.total),
  })),
  createdAt: row.external_created_at ? String(row.external_created_at) : null,
  updatedAt: row.external_updated_at ? String(row.external_updated_at) : null,
});

const mapSyncEvent = (row: RecordValue): CmsSyncEvent => ({
  id: text(row.id),
  connectionId: text(row.cms_connection_id),
  storeName: text(row.store_name, "Connected store", 160),
  platform: CMS_PLATFORMS.includes(row.platform as CmsPlatform) ? row.platform as CmsPlatform : "woocommerce",
  direction: row.direction === "webhook" || row.direction === "manual" ? row.direction : "reconciliation",
  resource: text(row.resource, "store", 80),
  eventType: text(row.event_type, "sync", 120),
  status: row.status === "failed" || row.status === "processing" ? row.status : "success",
  message: text(row.message, "", 1_000),
  occurredAt: String(row.occurred_at || row.created_at || new Date().toISOString()),
});

const loadWorkspace = async (workspaceId: string): Promise<CmsWorkspace> => {
  const [connectionRows, productRows, categoryRows, orderRows, eventRows, limitRows] = await Promise.all([
    query("SELECT * FROM cms_connections WHERE workspace_id = $1 ORDER BY updated_at DESC", [workspaceId]),
    query(`SELECT p.*, c.platform, c.name AS store_name
            FROM cms_products p JOIN cms_connections c ON c.id = p.cms_connection_id
            WHERE c.workspace_id = $1 AND c.status <> 'disconnected'
            ORDER BY p.updated_at DESC LIMIT 500`, [workspaceId]),
    query(`SELECT category.*, c.platform, c.name AS store_name
            FROM cms_categories category JOIN cms_connections c ON c.id = category.cms_connection_id
            WHERE c.workspace_id = $1 AND c.status <> 'disconnected'
            ORDER BY category.name ASC LIMIT 500`, [workspaceId]),
    query(`SELECT order_row.*, c.platform, c.name AS store_name
            FROM cms_orders order_row JOIN cms_connections c ON c.id = order_row.cms_connection_id
            WHERE c.workspace_id = $1 AND c.status <> 'disconnected'
            ORDER BY order_row.external_created_at DESC NULLS LAST LIMIT 500`, [workspaceId]),
    query(`SELECT event.*, c.platform, c.name AS store_name
            FROM cms_sync_events event JOIN cms_connections c ON c.id = event.cms_connection_id
            WHERE c.workspace_id = $1
            ORDER BY event.occurred_at DESC LIMIT 100`, [workspaceId]),
    query(`SELECT platform, COUNT(*)::int AS count
           FROM cms_connections WHERE workspace_id = $1 AND status <> 'disconnected'
           GROUP BY platform`, [workspaceId]),
  ]);
  const productIds = productRows.map((row) => text(row.id)).filter(isUuid);
  const variantRows = productIds.length
    ? await query("SELECT * FROM cms_product_variants WHERE cms_product_id = ANY($1::uuid[])", [productIds])
    : [];
  const variantsByProduct = new Map<string, CmsProductVariant[]>();
  for (const row of variantRows) {
    const productId = text(row.cms_product_id);
    const current = variantsByProduct.get(productId) || [];
    current.push(mapVariant(row));
    variantsByProduct.set(productId, current);
  }
  const connections = connectionRows.map(mapConnection);
  const products = productRows.map((row) => mapProduct(row, variantsByProduct.get(text(row.id)) || []));
  const categories = categoryRows.map(mapCategory);
  const orders = orderRows.map(mapOrder);
  const revenue = orders.reduce((sum, order) => sum + order.total, 0);
  const connected = connections.filter((connection) => connection.status !== "disconnected");
  const limits = { maxPerPlatform: 2, shopifyUsed: 0, woocommerceUsed: 0, bigcommerceUsed: 0, wixUsed: 0 };
  for (const row of limitRows) {
    if (row.platform === "shopify") limits.shopifyUsed = integer(row.count);
    if (row.platform === "woocommerce") limits.woocommerceUsed = integer(row.count);
    if (row.platform === "bigcommerce") limits.bigcommerceUsed = integer(row.count);
    if (row.platform === "wix") limits.wixUsed = integer(row.count);
  }
  return {
    summary: {
      connectedSites: connected.length,
      healthySites: connected.filter((connection) => connection.status === "healthy").length,
      products: products.length,
      categories: categories.length,
      orders: orders.length,
      revenue,
      currency: orders[0]?.currency || "USD",
    },
    connections,
    products,
    categories,
    orders,
    syncEvents: eventRows.map(mapSyncEvent),
    limits,
  };
};

const upsertProduct = async (connectionId: string, product: NormalizedProduct) => {
  const rows = await query(
    `INSERT INTO cms_products (
       cms_connection_id, external_id, title, description, short_description, status,
       sku, price_cents, compare_at_price_cents, sale_price_cents, currency,
       inventory_quantity, inventory_managed, featured, product_type, vendor, tags,
       image_url, images, external_updated_at, cached_data, last_pulled_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18,$19,$20::timestamptz,$21::jsonb,NOW(),NOW())
     ON CONFLICT (cms_connection_id, external_id) DO UPDATE SET
       title=EXCLUDED.title, description=EXCLUDED.description, short_description=EXCLUDED.short_description,
       status=EXCLUDED.status, sku=EXCLUDED.sku, price_cents=EXCLUDED.price_cents,
       compare_at_price_cents=EXCLUDED.compare_at_price_cents, sale_price_cents=EXCLUDED.sale_price_cents,
       currency=EXCLUDED.currency, inventory_quantity=EXCLUDED.inventory_quantity,
       inventory_managed=EXCLUDED.inventory_managed, featured=EXCLUDED.featured,
       product_type=EXCLUDED.product_type, vendor=EXCLUDED.vendor, tags=EXCLUDED.tags,
       image_url=EXCLUDED.image_url, images=EXCLUDED.images, external_updated_at=EXCLUDED.external_updated_at,
       cached_data=EXCLUDED.cached_data, last_pulled_at=NOW(), updated_at=NOW()
     RETURNING id`,
    [
      connectionId,
      product.externalId,
      product.title,
      product.description,
      product.shortDescription,
      product.status,
      product.sku,
      moneyCents(product.price),
      product.compareAtPrice == null ? null : moneyCents(product.compareAtPrice),
      product.salePrice == null ? null : moneyCents(product.salePrice),
      product.currency,
      product.inventoryQuantity,
      product.inventoryManaged,
      product.featured,
      product.productType,
      product.vendor,
      jsonText(product.tags, []),
      product.imageUrl,
      jsonText(product.images, []),
      product.externalUpdatedAt,
      jsonText(product, {}),
    ],
  );
  const productId = text(rows[0]?.id);
  if (!isUuid(productId)) return;
  await query("DELETE FROM cms_product_variants WHERE cms_product_id = $1", [productId]);
  for (const variant of product.variants.slice(0, 100)) {
    await query(
      `INSERT INTO cms_product_variants (
        cms_product_id, external_id, title, sku, price_cents, compare_at_price_cents,
        inventory_quantity, inventory_managed, image_url, attributes, cached_data, last_pulled_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,NOW())
      ON CONFLICT (cms_product_id, external_id) DO UPDATE SET
        title=EXCLUDED.title, sku=EXCLUDED.sku, price_cents=EXCLUDED.price_cents,
        compare_at_price_cents=EXCLUDED.compare_at_price_cents, inventory_quantity=EXCLUDED.inventory_quantity,
        inventory_managed=EXCLUDED.inventory_managed, image_url=EXCLUDED.image_url,
        attributes=EXCLUDED.attributes, cached_data=EXCLUDED.cached_data, last_pulled_at=NOW()`,
      [
        productId,
        variant.externalId,
        variant.title,
        variant.sku,
        moneyCents(variant.price),
        variant.compareAtPrice == null ? null : moneyCents(variant.compareAtPrice),
        variant.inventoryQuantity,
        variant.inventoryManaged,
        variant.imageUrl,
        jsonText(variant.attributes, {}),
        jsonText(variant, {}),
      ],
    );
  }
};

const upsertCategory = async (connectionId: string, category: NormalizedCategory) => {
  await query(
    `INSERT INTO cms_categories (
      cms_connection_id, external_id, name, parent_id, type, product_count, cached_data, last_pulled_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,NOW(),NOW())
    ON CONFLICT (cms_connection_id, external_id, type) DO UPDATE SET
      name=EXCLUDED.name, parent_id=EXCLUDED.parent_id, product_count=EXCLUDED.product_count,
      cached_data=EXCLUDED.cached_data, last_pulled_at=NOW(), updated_at=NOW()`,
    [connectionId, category.externalId, category.name, category.parentId, category.type, category.productCount, jsonText(category, {})],
  );
};

const upsertOrder = async (connectionId: string, order: NormalizedOrder) => {
  await query(
    `INSERT INTO cms_orders (
      cms_connection_id, external_id, order_number, status, fulfillment_status, total_cents, currency,
      customer_name, customer_email, payment_gateway_used, tracking_number, line_items,
      external_created_at, external_updated_at, cached_data, last_pulled_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::timestamptz,$14::timestamptz,$15::jsonb,NOW(),NOW())
    ON CONFLICT (cms_connection_id, external_id) DO UPDATE SET
      order_number=EXCLUDED.order_number, status=EXCLUDED.status, fulfillment_status=EXCLUDED.fulfillment_status,
      total_cents=EXCLUDED.total_cents, currency=EXCLUDED.currency, customer_name=EXCLUDED.customer_name,
      customer_email=EXCLUDED.customer_email, payment_gateway_used=EXCLUDED.payment_gateway_used,
      tracking_number=EXCLUDED.tracking_number, line_items=EXCLUDED.line_items,
      external_created_at=EXCLUDED.external_created_at, external_updated_at=EXCLUDED.external_updated_at,
      cached_data=EXCLUDED.cached_data, last_pulled_at=NOW(), updated_at=NOW()`,
    [
      connectionId,
      order.externalId,
      order.orderNumber,
      order.status,
      order.fulfillmentStatus,
      moneyCents(order.total),
      order.currency,
      order.customerName,
      order.customerEmail,
      order.paymentGateway,
      order.trackingNumber,
      jsonText(order.lineItems, []),
      order.createdAt,
      order.updatedAt,
      jsonText(order, {}),
    ],
  );
};

const logSync = async (
  connectionId: string,
  direction: "webhook" | "reconciliation" | "manual",
  eventType: string,
  status: "success" | "failed" | "processing",
  message: string,
  resource = "store",
  externalId = "",
) => {
  await query(
    `INSERT INTO cms_sync_events (cms_connection_id, direction, resource, external_id, event_type, status, message)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [connectionId, direction, resource, externalId, eventType, status, text(message, "", 1_000)],
  );
};

/**
 * Store events are optional from the store operation's point of view: a
 * missing queue or a workflow migration must never make a provider write look
 * failed. The workflow engine itself remains the single owner of execution.
 */
const emitStoreWorkflowEvent = async (
  workspaceId: string,
  eventType: string,
  payload: RecordValue,
  idempotencyKey: string,
) => {
  try {
    await dispatchWorkspaceWorkflowEvent(workspaceId, eventType, payload, idempotencyKey);
  } catch (error) {
    console.error("[cms-workflow-event] unable to publish store event", {
      eventType,
      type: error instanceof Error ? error.name : typeof error,
    });
  }
};

/**
 * Project store activity into the existing CRM Customer 360 timeline. The
 * provider cache remains authoritative; this projection only makes customer
 * and order changes visible beside forms, events, payments, and appointments.
 */
const emitStoreCrmTimeline = async (
  workspaceId: string,
  eventType: string,
  title: string,
  detail: string,
  metadata: RecordValue,
  externalId: string,
) => {
  try {
    const email = text(metadata.customerEmail, "", 320).toLowerCase();
    const customerName = text(metadata.customerName, "Guest", 240);
    const orderId = isUuid(text(metadata.orderId)) ? text(metadata.orderId) : null;
    const contactRows = email
      ? await query<{ id: string; company_id: string | null }>(
        "SELECT id, company_id FROM contacts WHERE created_by=$1 AND LOWER(email)=LOWER($2) LIMIT 1",
        [workspaceId, email],
      )
      : [];
    const contactId = contactRows[0]?.id || null;
    const companyId = contactRows[0]?.company_id || null;
    if (!contactId && email) {
      await query(
        `INSERT INTO contacts (
          email, full_name, tags, custom_fields, created_by, lifecycle_stage,
          source_type, source_id, last_activity_at, created_at, updated_at
        ) VALUES ($1,$2,'[]'::jsonb,'{}'::jsonb,$3,'customer','store',NULL,NOW(),NOW(),NOW())
        ON CONFLICT (created_by, LOWER(email)) DO UPDATE SET
          full_name=COALESCE(NULLIF(EXCLUDED.full_name,''), contacts.full_name),
          lifecycle_stage='customer', last_activity_at=NOW(), updated_at=NOW()`,
        [email, customerName, workspaceId],
      );
    }
    const refreshed = !contactId && email
      ? await query<{ id: string; company_id: string | null }>(
        "SELECT id, company_id FROM contacts WHERE created_by=$1 AND LOWER(email)=LOWER($2) LIMIT 1",
        [workspaceId, email],
      )
      : contactRows;
    const resolvedContactId = contactId || refreshed[0]?.id || null;
    const resolvedCompanyId = companyId || refreshed[0]?.company_id || null;
    await query(
      `SELECT maxform_crm_record_timeline(
        $1::uuid,$2::uuid,$3::uuid,NULL,$4,$5,$6::uuid,$7,NULL,$8,$9,$10::jsonb,NOW(),$11
      )`,
      [
        workspaceId,
        resolvedContactId,
        resolvedCompanyId,
        eventType,
        "stores",
        orderId,
        "store_order",
        title,
        detail,
        JSON.stringify({ ...metadata, sourceModule: "stores" }),
        `store:${eventType}:${externalId}`,
      ],
    );
  } catch (error) {
    console.error("[cms-crm-sync] unable to project store activity", {
      eventType,
      type: error instanceof Error ? error.name : typeof error,
    });
  }
};

/**
 * Store orders are intentionally kept in the CMS cache, but the Orders and
 * Payments surfaces read the shared payment ledger. This projection gives
 * those read models a stable UUID-backed mirror without ever replacing the
 * provider record or attempting to process a second payment.
 */
const syncStoreOrderLedger = async (
  workspaceId: string,
  connection: CmsConnectionRow,
  order: NormalizedOrder,
) => {
  const email = text(order.customerEmail, "", 320).toLowerCase();
  const contactRows = email
    ? await query<{ id: string }>(
      "SELECT id FROM contacts WHERE created_by=$1 AND LOWER(email)=LOWER($2) LIMIT 1",
      [workspaceId, email],
    )
    : [];
  const orderKey = `${connection.platform}:${connection.id}:${text(order.externalId, "", 300)}`;
  const orderNumber = `${connection.platform.toUpperCase()}-${connection.id.slice(0, 8)}-${text(order.orderNumber || order.externalId, "ORDER", 90)}`.slice(0, 160);
  const normalizedStatus = text(order.status, "pending", 50).toLowerCase().replace(/-/g, "_");
  const status = normalizedStatus === "completed" || normalizedStatus === "processing"
    ? "paid"
    : normalizedStatus === "on_hold"
      ? "pending"
      : normalizedStatus === "canceled"
        ? "cancelled"
        : ["paid", "partially_refunded", "refunded", "pending", "failed", "cancelled"].includes(normalizedStatus)
          ? normalizedStatus
          : "pending";
  const paid = ["paid", "partially_refunded", "refunded"].includes(status);
  const total = money(order.total);
  const candidateCurrency = text(order.currency, "", 8).toUpperCase();
  const currency = /^[A-Z]{3}$/.test(candidateCurrency) ? candidateCurrency : "USD";
  const refundedAmount = status === "refunded" ? total : 0;
  const rows = await query<{ id: string }>(
    `INSERT INTO payment_orders (
       user_id, order_number, source_type, source_id, contact_id,
       customer_name, customer_email, status, provider, provider_reference,
       subtotal, total_amount, refunded_amount, currency, paid_at, metadata, created_at, updated_at
     ) VALUES ($1,$2,'manual',NULL,$3,$4,$5,$6,NULL,$7,$8,$8,$9,$10,$11,$12::jsonb,$13,$14)
     ON CONFLICT (user_id, order_number) DO UPDATE SET
       contact_id=COALESCE(EXCLUDED.contact_id, payment_orders.contact_id),
       customer_name=EXCLUDED.customer_name, customer_email=EXCLUDED.customer_email,
       status=EXCLUDED.status, provider_reference=EXCLUDED.provider_reference,
       subtotal=EXCLUDED.subtotal, total_amount=EXCLUDED.total_amount,
       refunded_amount=CASE WHEN EXCLUDED.status='refunded' THEN EXCLUDED.refunded_amount ELSE payment_orders.refunded_amount END,
       currency=EXCLUDED.currency, paid_at=EXCLUDED.paid_at,
       metadata=EXCLUDED.metadata, updated_at=EXCLUDED.updated_at
     RETURNING id`,
    [
      workspaceId,
      orderNumber,
      contactRows[0]?.id || null,
      order.customerName,
      email,
      status,
      orderKey,
      total,
      refundedAmount,
      currency,
      paid ? order.updatedAt || order.createdAt || new Date().toISOString() : null,
      JSON.stringify({
        sourceModule: "stores",
        sourceLabel: `${connection.name} · Store order ${order.orderNumber}`,
        cmsConnectionId: connection.id,
        cmsPlatform: connection.platform,
        cmsExternalOrderId: order.externalId,
        cmsOrderNumber: order.orderNumber,
      }),
      order.createdAt || new Date().toISOString(),
      order.updatedAt || new Date().toISOString(),
    ],
  );
  const ledgerOrderId = text(rows[0]?.id);
  if (!isUuid(ledgerOrderId)) return;
  await query("DELETE FROM payment_order_items WHERE order_id=$1", [ledgerOrderId]);
  for (const line of order.lineItems.slice(0, 100)) {
    const quantity = Math.max(1, integer(line.quantity, 1));
    const lineTotal = money(line.total);
    await query(
      `INSERT INTO payment_order_items (order_id, name, quantity, unit_price, total_amount, metadata)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      [
        ledgerOrderId,
        text(line.name, "Item", 300),
        quantity,
        lineTotal / quantity,
        lineTotal,
        JSON.stringify({ sourceModule: "stores", cmsExternalLineItemId: line.externalId || "" }),
      ],
    );
  }
};

const pullConnection = async (connection: CmsConnectionRow): Promise<PullResult> => {
  if (connection.platform === "woocommerce") return pullWoo(connection);
  if (connection.platform === "bigcommerce") return pullBigCommerce(connection);
  if (connection.platform === "wix") return pullWix(connection);
  return pullShopify(connection);
};

const performSync = async (
  workspaceId: string,
  connectionId: string,
  direction: "webhook" | "reconciliation" | "manual" = "manual",
) : Promise<boolean> => {
  const existingConnection = await getConnection(workspaceId, connectionId);
  if (existingConnection.status === "disconnected") throw new CmsDataError("Reconnect this store before syncing it.");
  const leaseToken = randomUUID();
  const leaseMinutes = Math.max(5, Math.min(120, integer(process.env.CMS_SYNC_LEASE_MINUTES, 10)));
  const leasedRows = await query<CmsConnectionRow>(
    `UPDATE cms_connections SET
       status='syncing', last_error='', sync_lock_token=$3,
       sync_lock_expires_at=NOW() + ($4::int * INTERVAL '1 minute'), updated_at=NOW()
     WHERE id=$1 AND workspace_id=$2 AND status <> 'disconnected'
       AND (sync_lock_token IS NULL OR sync_lock_expires_at IS NULL
            OR sync_lock_expires_at < NOW() OR sync_lock_token=$3)
     RETURNING *`,
    [connectionId, workspaceId, leaseToken, leaseMinutes],
  );
  if (!leasedRows[0]) {
    if (direction === "reconciliation" || direction === "webhook") return false;
    throw new CmsDataError("This store is already syncing. Try again in a moment.", 409, "cms_sync_in_progress");
  }
  const connection = leasedRows[0];
  try {
    const result = await pullConnection(connection);
    for (const product of result.products) await upsertProduct(connectionId, product);
    for (const category of result.categories) await upsertCategory(connectionId, category);
    for (const order of result.orders) await upsertOrder(connectionId, order);
    const webhooksExpected = connection.platform !== "wix";
    let webhookRegistered = connection.webhook_registered === true;
    let webhookMessage = "";
    if (webhooksExpected && !webhookRegistered) {
      try {
        const webhookSecret = decrypt<string>(connection.webhook_secret_encrypted);
        await registerWebhooks(connection, webhookSecret);
        webhookRegistered = true;
      } catch (error) {
        webhookMessage = error instanceof Error ? error.message : "Webhooks could not be registered.";
      }
    }
    const status = webhookRegistered || !webhooksExpected ? "healthy" : "attention";
    const lastError = webhookMessage || (status === "attention" ? "Initial sync succeeded, but live webhooks need attention." : "");
    const finalizedRows = await query<{ id: string }>(
      `UPDATE cms_connections SET
         external_store_id=$2, status=$3, webhook_registered=$4, last_error=$5,
         last_synced_at=NOW(), last_reconciliation_at=NOW(), product_count=$6,
         category_count=$7, order_count=$8, updated_at=NOW()
       WHERE id=$1 AND status='syncing' AND sync_lock_token=$9
       RETURNING id`,
      [connectionId, result.externalStoreId, status, webhookRegistered, lastError, result.products.length, result.categories.length, result.orders.length, leaseToken],
    );
    if (!finalizedRows[0]) {
      throw new CmsDataError("The store sync lease expired before the update could be finalized. It will be retried automatically.", 409, "cms_sync_lease_expired");
    }
    await logSync(connectionId, direction, direction === "webhook" ? "webhook.sync" : "store.sync", "success", lastError || `Synced ${result.products.length} products, ${result.orders.length} orders.`);
    await emitStoreWorkflowEvent(
      workspaceId,
      "store_sync_completed",
      {
        connectionId,
        platform: connection.platform,
        storeUrl: connection.store_url,
        products: result.products.length,
        categories: result.categories.length,
        orders: result.orders.length,
        direction,
      },
      `store_sync_completed:${connectionId}:${new Date().toISOString().slice(0, 16)}`,
    );
    // The provider pull already applies bounded pagination. Project the full
    // normalized result so Orders, Payments and CRM do not silently diverge
    // from the Connected stores cache after a larger reconciliation.
    for (const order of result.orders) {
      try {
        await syncStoreOrderLedger(workspaceId, connection, order);
      } catch (error) {
        console.error("[cms-payment-sync] unable to project store order", {
          platform: connection.platform,
          type: error instanceof Error ? error.name : typeof error,
        });
      }
      await emitStoreCrmTimeline(
        workspaceId,
        "store_order_synced",
        `Store order ${order.orderNumber}`,
        `${connection.name} · ${order.customerName || "Guest"} · ${order.currency} ${order.total.toFixed(2)}`,
        {
          cmsConnectionId: connection.id,
          orderId: "",
          customerEmail: order.customerEmail,
          customerName: order.customerName,
          storeName: connection.name,
          platform: connection.platform,
          orderNumber: order.orderNumber,
          total: order.total,
          currency: order.currency,
          status: order.status,
        },
        `${connectionId}:${order.externalId}:${order.updatedAt || order.createdAt || "sync"}`,
      );
    }
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "The store could not be synchronized.";
    await query("UPDATE cms_connections SET status='attention', last_error=$2, last_reconciliation_at=NOW(), updated_at=NOW() WHERE id=$1 AND sync_lock_token=$3", [connectionId, text(message, "", 1_000), leaseToken]);
    await logSync(connectionId, direction, direction === "webhook" ? "webhook.sync" : "store.sync", "failed", message);
    await emitStoreWorkflowEvent(
      workspaceId,
      "store_sync_failed",
      { connectionId, platform: connection.platform, storeUrl: connection.store_url, error: message, direction },
      `store_sync_failed:${connectionId}:${new Date().toISOString().slice(0, 16)}`,
    );
    throw error;
  } finally {
    await query(
      "UPDATE cms_connections SET sync_lock_token=NULL, sync_lock_expires_at=NULL, updated_at=NOW() WHERE id=$1 AND sync_lock_token=$2",
      [connectionId, leaseToken],
    );
  }
};

const createConnection = async (workspaceId: string, input: RecordValue) => {
  const platform = text(input.platform) as CmsPlatform;
  if (!CMS_PLATFORMS.includes(platform)) throw new CmsDataError("Choose a supported store provider.");
  const storeUrl = normalizeUrl(platform, input.storeUrl);
  const name = text(input.name, `${cmsPlatformName(platform)} store`, 160);
  const rawCredentials = object(input.credentials);
  const credentials: CmsCredentials = platform === "shopify"
    ? { accessToken: text(rawCredentials.accessToken, "", 1_000) }
    : platform === "woocommerce"
      ? { consumerKey: text(rawCredentials.consumerKey, "", 1_000), consumerSecret: text(rawCredentials.consumerSecret, "", 1_000) }
      : platform === "bigcommerce"
        ? { accessToken: text(rawCredentials.accessToken, "", 1_000), storeHash: text(rawCredentials.storeHash, "", 160) }
        : { apiKey: text(rawCredentials.apiKey, "", 2_000), siteId: text(rawCredentials.siteId, "", 300) };
  if (platform === "shopify" && (!("accessToken" in credentials) || !credentials.accessToken)) throw new CmsDataError("Enter the Shopify Admin API access token.");
  if (platform === "woocommerce" && (!("consumerKey" in credentials) || !credentials.consumerKey || !credentials.consumerSecret)) throw new CmsDataError("Enter both WooCommerce consumer key and consumer secret.");
  if (platform === "bigcommerce" && (!("accessToken" in credentials) || !credentials.accessToken || !credentials.storeHash)) throw new CmsDataError("Enter the BigCommerce API access token and store hash.");
  if (platform === "wix" && (!("apiKey" in credentials) || !credentials.apiKey || !credentials.siteId)) throw new CmsDataError("Enter the Wix API key and site ID.");
  const webhookSecret = randomBytes(32).toString("base64url");
  const connectionDatabase = database();
  const connectionKey = `${workspaceId}:${platform}`;
  const encryptedCredentials = encrypt(credentials);
  const encryptedWebhookSecret = encrypt(webhookSecret);
  const transactionResults = await connectionDatabase.transaction((transaction) => [
    transaction.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [connectionKey]),
    transaction.query(
      `INSERT INTO cms_connections (
         workspace_id, platform, name, store_url, credentials_encrypted, webhook_secret_encrypted
       )
       SELECT $1,$2,$3,$4,$5,$6
       WHERE (SELECT COUNT(*) FROM cms_connections WHERE workspace_id=$1 AND platform=$2 AND status <> 'disconnected') < 2
          OR EXISTS (
            SELECT 1 FROM cms_connections
            WHERE workspace_id=$1 AND platform=$2 AND store_url=$4 AND status='disconnected'
          )
       ON CONFLICT (workspace_id, platform, store_url) DO UPDATE SET
         name=EXCLUDED.name,
         credentials_encrypted=EXCLUDED.credentials_encrypted,
         webhook_secret_encrypted=EXCLUDED.webhook_secret_encrypted,
         status='attention',
         webhook_registered=FALSE,
         sync_lock_token=NULL,
         sync_lock_expires_at=NULL,
         last_error='',
         updated_at=NOW()
       WHERE cms_connections.status='disconnected'
         AND (
           SELECT COUNT(*) FROM cms_connections active_connection
           WHERE active_connection.workspace_id=$1
             AND active_connection.platform=$2
             AND active_connection.status <> 'disconnected'
             AND active_connection.id <> cms_connections.id
         ) < 2
       RETURNING id`,
      [workspaceId, platform, name, storeUrl, encryptedCredentials, encryptedWebhookSecret],
    ),
  ]);
  const rows = (transactionResults[1] || []) as RecordValue[];
  if (!rows[0]) {
    const [activeRows, existingRows] = await Promise.all([
      query("SELECT COUNT(*)::int AS count FROM cms_connections WHERE workspace_id=$1 AND platform=$2 AND status <> 'disconnected'", [workspaceId, platform]),
      query("SELECT status FROM cms_connections WHERE workspace_id=$1 AND platform=$2 AND store_url=$3 LIMIT 1", [workspaceId, platform, storeUrl]),
    ]);
    const activeCount = activeRows;
    if (existingRows[0] && existingRows[0].status !== "disconnected") {
      throw new CmsDataError("This store is already connected in this workspace. Open Connected sites to sync or manage it.", 409, "cms_connection_exists");
    }
    if (integer(activeCount[0]?.count) >= 2) {
      throw new CmsDataError(`You can connect up to 2 ${cmsPlatformName(platform)} stores per workspace. Disconnect one before adding another.`, 409, "cms_connection_limit");
    }
    throw new CmsDataError("This store is already connected in this workspace. Open Connected sites to sync or manage it.", 409, "cms_connection_exists");
  }
  const connectionId = text(rows[0]?.id);
  if (!isUuid(connectionId)) throw new CmsDataError("The store connection could not be created.", 500);
  try {
    await performSync(workspaceId, connectionId, "manual");
  } catch {
    // Keep the connection so the UI can explain whether credentials, API
    // scopes, or the public webhook origin needs attention.
  }
  return loadWorkspace(workspaceId);
};

const reconnectConnection = async (workspaceId: string, connectionId: string) => {
  const connection = await getConnection(workspaceId, connectionId);
  const connectionDatabase = database();
  const connectionKey = `${workspaceId}:${connection.platform}`;
  const transactionResults = await connectionDatabase.transaction((transaction) => [
    transaction.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [connectionKey]),
    transaction.query(
      `UPDATE cms_connections
       SET status='attention', sync_lock_token=NULL, sync_lock_expires_at=NULL,
           last_error='', updated_at=NOW()
       WHERE id=$1 AND workspace_id=$2
         AND (
           status <> 'disconnected'
           OR (
             SELECT COUNT(*) FROM cms_connections active_connection
             WHERE active_connection.workspace_id=$2
               AND active_connection.platform=$3
               AND active_connection.status <> 'disconnected'
               AND active_connection.id <> cms_connections.id
           ) < 2
         )
       RETURNING id`,
      [connectionId, workspaceId, connection.platform],
    ),
  ]);
  const rows = (transactionResults[1] || []) as RecordValue[];
  if (!rows[0]) {
    throw new CmsDataError(`You can connect up to 2 ${cmsPlatformName(connection.platform)} stores per workspace. Disconnect one before reconnecting this site.`, 409, "cms_connection_limit");
  }
  await performSync(workspaceId, connectionId, "manual");
  return loadWorkspace(workspaceId);
};

const productConnection = async (workspaceId: string, connectionId: string) => {
  const connection = await getConnection(workspaceId, connectionId);
  if (connection.status === "disconnected") throw new CmsDataError("Reconnect this store before editing it.");
  return connection;
};

const createProduct = async (workspaceId: string, input: RecordValue) => {
  const connectionId = text(input.connectionId);
  const connection = await productConnection(workspaceId, connectionId);
  const product = await createProductOnProvider(connection, input);
  await upsertProduct(connectionId, product);
  await logSync(connectionId, "manual", "product.created", "success", `${product.title} was created.`, "product", product.externalId);
  await emitStoreWorkflowEvent(workspaceId, "store_product_created", { connectionId, platform: connection.platform, product }, `store_product_created:${connectionId}:${product.externalId}:${Date.now()}`);
  return loadWorkspace(workspaceId);
};

const updateProduct = async (workspaceId: string, input: RecordValue) => {
  const connectionId = text(input.connectionId);
  const productId = text(input.productId);
  const connection = await productConnection(workspaceId, connectionId);
  const rows = await query("SELECT external_id FROM cms_products WHERE id=$1 AND cms_connection_id=$2 LIMIT 1", [productId, connectionId]);
  if (!rows[0]) throw new CmsDataError("That product was not found.", 404);
  const product = await updateProductOnProvider(connection, text(rows[0].external_id), input);
  await upsertProduct(connectionId, product);
  await logSync(connectionId, "manual", "product.updated", "success", `${product.title} was updated.`, "product", product.externalId);
  await emitStoreWorkflowEvent(workspaceId, "store_product_updated", { connectionId, platform: connection.platform, product }, `store_product_updated:${connectionId}:${product.externalId}:${Date.now()}`);
  return loadWorkspace(workspaceId);
};

const deleteProduct = async (workspaceId: string, connectionId: string, productId: string) => {
  const connection = await productConnection(workspaceId, connectionId);
  const rows = await query("SELECT external_id, title FROM cms_products WHERE id=$1 AND cms_connection_id=$2 LIMIT 1", [productId, connectionId]);
  if (!rows[0]) throw new CmsDataError("That product was not found.", 404);
  await deleteProductOnProvider(connection, text(rows[0].external_id));
  await query("DELETE FROM cms_products WHERE id=$1 AND cms_connection_id=$2", [productId, connectionId]);
  await logSync(connectionId, "manual", "product.deleted", "success", `${text(rows[0].title, "Product")} was deleted.`, "product", text(rows[0].external_id));
  await emitStoreWorkflowEvent(workspaceId, "store_product_deleted", { connectionId, platform: connection.platform, productId: text(rows[0].external_id), title: text(rows[0].title) }, `store_product_deleted:${connectionId}:${text(rows[0].external_id)}:${Date.now()}`);
  return loadWorkspace(workspaceId);
};

const createOrUpdateBigCommerceCategory = async (connection: CmsConnectionRow, externalId: string, name: string, update: boolean, parentId: unknown) => {
  const path = update ? `/v3/catalog/categories/${encodeURIComponent(externalId)}` : "/v3/catalog/categories";
  await bigcommerceApi(connection, path, {
    method: update ? "PUT" : "POST",
    body: JSON.stringify({ name, parent_id: integer(parentId) || 0 }),
  });
};

const createOrUpdateWixCollection = async (connection: CmsConnectionRow, externalId: string, name: string, update: boolean) => {
  const path = update ? `/stores/v1/collections/${encodeURIComponent(externalId)}` : "/stores/v1/collections";
  await wixApi(connection, path, {
    method: update ? "PATCH" : "POST",
    body: JSON.stringify({ collection: { name } }),
  });
};

const createOrUpdateCategory = async (workspaceId: string, input: RecordValue, update: boolean) => {
  const connection = await productConnection(workspaceId, text(input.connectionId));
  const name = text(input.name, "Untitled category", 300);
  let externalCategoryId = text(input.categoryId);
  if (update) {
    const categoryRows = await query(
      "SELECT external_id FROM cms_categories WHERE id=$1 AND cms_connection_id=$2 LIMIT 1",
      [externalCategoryId, connection.id],
    );
    if (!categoryRows[0]) throw new CmsDataError("That category was not found.", 404);
    externalCategoryId = text(categoryRows[0].external_id);
  }
  if (connection.platform === "woocommerce") {
    const path = update ? `/products/categories/${encodeURIComponent(externalCategoryId)}` : "/products/categories";
    await wooApi(connection, path, {
      method: update ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, parent: integer(input.parentId) || 0 }),
    });
  } else if (connection.platform === "bigcommerce") {
    await createOrUpdateBigCommerceCategory(connection, externalCategoryId, name, update, input.parentId);
  } else if (connection.platform === "wix") {
    await createOrUpdateWixCollection(connection, externalCategoryId, name, update);
  } else {
    const mutation = update ? "collectionUpdate" : "collectionCreate";
    const inputName = update ? `{ id: ${JSON.stringify(externalCategoryId)}, title: ${JSON.stringify(name)} }` : `{ title: ${JSON.stringify(name)} }`;
    const result = await shopifyApi(connection, `mutation {
      ${mutation}(input: ${inputName}) { collection { id title } userErrors { field message } }
    }`);
    const payload = object(result[mutation]);
    const errors = array<RecordValue>(payload.userErrors);
    if (errors.length) throw new CmsDataError(text(errors[0].message, "The collection could not be saved.", 600), 502, "cms_provider_error");
  }
  await performSync(workspaceId, connection.id, "manual");
  return loadWorkspace(workspaceId);
};

const deleteCategory = async (workspaceId: string, connectionId: string, categoryId: string) => {
  const connection = await productConnection(workspaceId, connectionId);
  const rows = await query("SELECT external_id, type FROM cms_categories WHERE id=$1 AND cms_connection_id=$2 LIMIT 1", [categoryId, connectionId]);
  if (!rows[0]) throw new CmsDataError("That category was not found.", 404);
  if (connection.platform === "woocommerce") {
    await wooApi(connection, `/products/categories/${encodeURIComponent(text(rows[0].external_id))}?force=true`, { method: "DELETE" });
  } else if (connection.platform === "bigcommerce") {
    await bigcommerceApi(connection, `/v3/catalog/categories/${encodeURIComponent(text(rows[0].external_id))}`, { method: "DELETE" });
  } else if (connection.platform === "wix") {
    await wixApi(connection, `/stores/v1/collections/${encodeURIComponent(text(rows[0].external_id))}`, { method: "DELETE" });
  } else {
    const result = await shopifyApi(connection, `mutation CollectionDelete($input: CollectionDeleteInput!) {
      collectionDelete(input: $input) { deletedCollectionId userErrors { field message } }
    }`, { input: { id: text(rows[0].external_id) } });
    const payload = object(result.collectionDelete);
    const errors = array<RecordValue>(payload.userErrors);
    if (errors.length) throw new CmsDataError(text(errors[0].message, "The collection could not be deleted.", 600), 502, "cms_provider_error");
  }
  await query("DELETE FROM cms_categories WHERE id=$1 AND cms_connection_id=$2", [categoryId, connectionId]);
  await emitStoreWorkflowEvent(workspaceId, "store_product_updated", { connectionId, platform: connection.platform, categoryId, categoryDeleted: true }, `store_category_deleted:${connectionId}:${categoryId}:${Date.now()}`);
  return loadWorkspace(workspaceId);
};

const updateOrder = async (workspaceId: string, input: RecordValue) => {
  const connection = await productConnection(workspaceId, text(input.connectionId));
  const rows = await query("SELECT external_id FROM cms_orders WHERE id=$1 AND cms_connection_id=$2 LIMIT 1", [text(input.orderId), connection.id]);
  if (!rows[0]) throw new CmsDataError("That order was not found.", 404);
  const externalId = text(rows[0].external_id);
  if (connection.platform === "woocommerce") {
    await wooApi(connection, `/orders/${encodeURIComponent(externalId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: text(input.status, "", 50) || undefined, customer_note: text(input.note, "", 1_000) || undefined, meta_data: text(input.trackingNumber, "", 160) ? [{ key: "maxform_tracking_number", value: text(input.trackingNumber, "", 160) }] : undefined }),
    });
  } else if (connection.platform === "bigcommerce") {
  const status = text(input.status, "", 50).toLowerCase().replace(/-/g, "_");
    const statusIds: Record<string, number> = {
      pending: 1,
      processing: 11,
      on_hold: 12,
      completed: 10,
      cancelled: 5,
      canceled: 5,
      refunded: 4,
      failed: 7,
    };
    const body: RecordValue = {};
    if (status && statusIds[status] != null) body.status_id = statusIds[status];
    const note = text(input.note, "", 1_000) || (text(input.trackingNumber, "", 160) ? `Tracking: ${text(input.trackingNumber, "", 160)}` : "");
    if (note) body.staff_notes = note;
    if (!Object.keys(body).length) throw new CmsDataError("Enter a supported order status, note, or tracking number.");
    await bigcommerceApi(connection, `/v2/orders/${encodeURIComponent(externalId)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  } else if (connection.platform === "wix") {
    const status = text(input.status, "", 50).toLowerCase().replace(/-/g, "_");
    if (!["cancelled", "canceled"].includes(status)) {
      throw new CmsDataError("Wix order updates from MaxForm currently support cancellation. Other order changes can be made in Wix.");
    }
    await wixApi(connection, `/ecom/v1/orders/${encodeURIComponent(externalId)}/cancel`, {
      method: "POST",
      body: JSON.stringify({
        customMessage: text(input.note, "Cancelled from MaxForm", 1_000),
        restockAllItems: true,
        sendOrderCanceledEmail: false,
      }),
    });
  } else {
    const note = text(input.note, "", 1_000) || (text(input.trackingNumber, "", 160) ? `Tracking: ${text(input.trackingNumber, "", 160)}` : "");
    if (!note) throw new CmsDataError("Shopify order updates need a note or tracking number.");
    const result = await shopifyApi(connection, `mutation OrderUpdate($input: OrderInput!) {
      orderUpdate(input: $input) { order { id } userErrors { field message } }
    }`, { input: { id: externalId, note } });
    const payload = object(result.orderUpdate);
    const errors = array<RecordValue>(payload.userErrors);
    if (errors.length) throw new CmsDataError(text(errors[0].message, "Shopify could not update the order.", 600), 502, "cms_provider_error");
  }
  await performSync(workspaceId, connection.id, "manual");
  await emitStoreWorkflowEvent(workspaceId, "store_order_updated", { connectionId: connection.id, platform: connection.platform, orderId: externalId, status: text(input.status), trackingNumber: text(input.trackingNumber), note: text(input.note) }, `store_order_updated:${connection.id}:${externalId}:${Date.now()}`);
  return loadWorkspace(workspaceId);
};

const refundOrder = async (workspaceId: string, input: RecordValue) => {
  const connection = await productConnection(workspaceId, text(input.connectionId));
  const rows = await query("SELECT external_id, total_cents, currency, line_items FROM cms_orders WHERE id=$1 AND cms_connection_id=$2 LIMIT 1", [text(input.orderId), connection.id]);
  if (!rows[0]) throw new CmsDataError("That order was not found.", 404);
  const externalId = text(rows[0].external_id);
  const amount = input.amount == null ? null : decimal(input.amount);
  if (connection.platform === "woocommerce") {
    await wooApi(connection, `/orders/${encodeURIComponent(externalId)}/refunds`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: amount == null ? undefined : amount.toFixed(2), reason: text(input.reason, "Refund from MaxForm", 500), api_refund: true }),
    });
  } else if (connection.platform === "bigcommerce") {
    const orderTotal = decimal(rows[0].total_cents) / 100;
    if (amount != null && Math.abs(amount - orderTotal) > 0.01) {
      throw new CmsDataError("MaxForm currently supports full BigCommerce order refunds. Use the BigCommerce control panel for a partial refund.");
    }
    const quote = object(await bigcommerceApi(connection, `/v3/orders/${encodeURIComponent(externalId)}/payment_actions/refund_quotes`, {
      method: "POST",
      body: JSON.stringify({ items: [{ item_type: "ORDER", item_id: integer(externalId), amount: orderTotal }] }),
    }));
    const quoteData = object(quote.data);
    const methodGroups = array<unknown>(quoteData.refund_methods || quoteData.refundMethods);
    const methods = methodGroups.flatMap((group) => array<RecordValue>(group));
    const refundAmount = money(quoteData.total_refund_amount || orderTotal);
    if (!methods.length) throw new CmsDataError("BigCommerce did not return a refundable payment method for this order.");
    let remaining = refundAmount;
    const payments = methods.flatMap((method) => {
      const available = money(method.amount);
      const allocated = Math.min(remaining, available);
      if (allocated <= 0) return [];
      remaining = Math.max(0, remaining - allocated);
      return [{ provider_id: text(method.provider_id || method.providerId), amount: allocated, offline: method.offline === true }];
    });
    if (remaining > 0.01 || payments.some((payment) => !payment.provider_id)) {
      throw new CmsDataError("BigCommerce returned payment methods that cannot cover this refund.");
    }
    await bigcommerceApi(connection, `/v3/orders/${encodeURIComponent(externalId)}/payment_actions/refunds`, {
      method: "POST",
      body: JSON.stringify({
        items: [{ item_type: "ORDER", item_id: integer(externalId), amount: refundAmount }],
        payments,
      }),
    });
  } else if (connection.platform === "wix") {
    throw new CmsDataError("Wix refunds must be completed in Wix. This connection supports catalog and order synchronization plus cancellation.");
  } else {
    const orderTotal = decimal(rows[0].total_cents) / 100;
    if (amount != null && Math.abs(amount - orderTotal) > 0.01) {
      throw new CmsDataError("MaxForm currently supports full Shopify order refunds. Use the Shopify admin for a partial amount refund.");
    }
    const refundLineItems = array<RecordValue>(safeJson(rows[0].line_items, []))
      .map((line) => ({
        lineItemId: text(line.externalId || line.external_id || line.id),
        quantity: Math.max(1, integer(line.quantity, 1)),
      }))
      .filter((line) => line.lineItemId);
    if (!refundLineItems.length) {
      throw new CmsDataError("Sync this Shopify order before requesting a refund so its line items can be identified.");
    }
    const idempotencyKey = randomUUID();
    const result = await shopifyApi(connection, `mutation RefundCreate($input: RefundInput!) {
      refundCreate(input: $input) @idempotent(key: "${idempotencyKey}") {
        refund { id }
        userErrors { field message }
      }
    }`, { input: {
      orderId: externalId,
      notifyCustomer: false,
      note: text(input.reason, "Refund from MaxForm", 500),
      refundLineItems,
      transactions: [],
    } });
    const payload = object(result.refundCreate);
    const errors = array<RecordValue>(payload.userErrors);
    if (errors.length) throw new CmsDataError(text(errors[0].message, "Shopify could not create the refund.", 600), 502, "cms_provider_error");
  }
  await performSync(workspaceId, connection.id, "manual");
  await emitStoreWorkflowEvent(workspaceId, "store_order_refunded", { connectionId: connection.id, platform: connection.platform, orderId: externalId, amount, reason: text(input.reason) }, `store_order_refunded:${connection.id}:${externalId}:${Date.now()}`);
  return loadWorkspace(workspaceId);
};

const readRawBody = async (request: IncomingMessage, maximum = 2_000_000) => {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > maximum) throw new CmsDataError("This store request is too large.", 413);
  }
  return body;
};

const parseBody = (body: string) => {
  if (!body) return {} as RecordValue;
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid request");
    return parsed as RecordValue;
  } catch {
    throw new CmsDataError("The store request could not be read.");
  }
};

const readBody = async (request: IncomingMessage, maximum = 2_000_000) =>
  parseBody(await readRawBody(request, maximum));

const json = (response: ServerResponse, status: number, value: RecordValue) => {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "private, no-store, max-age=0");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(JSON.stringify(value));
};

const signingSecret = () => {
  const secret = process.env.JWT_SECRET || "";
  if (secret.length < 32) throw new CmsDataError("Connected stores are temporarily unavailable. Please try again.", 503, "cms_unavailable");
  return new TextEncoder().encode(secret);
};

const authenticatedWorkspace = async (request: IncomingMessage) => {
  const authorization = String(request.headers.authorization || "");
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) throw new CmsDataError("Your session has expired. Sign in and try again.", 401, "authentication_required");
  try {
    const { payload } = await jwtVerify(token, signingSecret(), { audience: "maxform-dashboard", issuer: "maxform" });
    const userId = text(payload.userId, "", 80);
    if (!isUuid(userId)) throw new Error("Invalid user");
    const workspaceId = await workspaceScopeFor(userId);
    const canOpenStores = await canOpenModule(userId, "stores");
    const canOpenConnector = await canOpenModule(userId, "store_connector");
    if (!canOpenStores && !canOpenConnector) throw new CmsDataError("You do not have access to Store connector in this workspace.", 403, "module_access_denied");
    return { userId, workspaceId };
  } catch (error) {
    if (error instanceof CmsDataError) throw error;
    throw new CmsDataError("Your session has expired. Sign in and try again.", 401, "authentication_required");
  }
};

const argsFrom = (body: RecordValue) => object(body.args);

const executeOperation = async (operation: string, args: RecordValue, workspaceId: string) => {
  switch (operation) {
    case "getCmsWorkspace":
      return loadWorkspace(workspaceId);
    case "getCmsOrders": {
      const rows = await query(`SELECT order_row.*, c.platform, c.name AS store_name
                                FROM cms_orders order_row
                                JOIN cms_connections c ON c.id = order_row.cms_connection_id
                                WHERE c.workspace_id = $1 AND c.status <> 'disconnected'
                                ORDER BY order_row.external_created_at DESC NULLS LAST
                                LIMIT 500`, [workspaceId]);
      return rows.map(mapOrder);
    }
    case "createCmsConnection":
      return createConnection(workspaceId, object(args.input));
    case "syncCmsConnection":
      await performSync(workspaceId, text(args.connectionId), "manual");
      return loadWorkspace(workspaceId);
    case "reconnectCmsConnection": {
      const connectionId = text(args.connectionId);
      return reconnectConnection(workspaceId, connectionId);
    }
    case "disconnectCmsConnection":
      return disconnectConnection(workspaceId, text(args.connectionId));
    case "createCmsProduct":
      return createProduct(workspaceId, object(args.input));
    case "updateCmsProduct":
      return updateProduct(workspaceId, object(args.input));
    case "deleteCmsProduct":
      return deleteProduct(workspaceId, text(args.connectionId), text(args.productId));
    case "createCmsCategory":
      return createOrUpdateCategory(workspaceId, object(args.input), false);
    case "updateCmsCategory":
      return createOrUpdateCategory(workspaceId, object(args.input), true);
    case "deleteCmsCategory":
      return deleteCategory(workspaceId, text(args.connectionId), text(args.categoryId));
    case "updateCmsOrder":
      return updateOrder(workspaceId, object(args.input));
    case "refundCmsOrder":
      return refundOrder(workspaceId, object(args.input));
    default:
      throw new CmsDataError("This connected stores action is not available.", 404);
  }
};

export async function handleCmsData(request: IncomingMessage, response: ServerResponse) {
  try {
    if (request.method !== "POST") {
      json(response, 405, { error: "Use POST for connected stores data." });
      return;
    }
    const actor = await authenticatedWorkspace(request);
    const body = await readBody(request, 6_000_000);
    const value = await executeOperation(text(body.operation), argsFrom(body), actor.workspaceId);
    json(response, 200, { value });
  } catch (error) {
    if (error instanceof CmsDataError) {
      json(response, error.status, { code: error.code, error: error.message, ...(Object.keys(error.details).length ? { details: error.details } : {}) });
      return;
    }
    console.error("[cms-data] unexpected request failure", { type: error instanceof Error ? error.name : typeof error });
    json(response, 500, { code: "cms_unavailable", error: "Connected stores could not be updated. Please try again." });
  }
}

const secureCompare = (provided: string, expected: string) => {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

const webhookConnection = async (connectionId: string, token: string) => {
  if (!isUuid(connectionId) || !token) throw new CmsDataError("This store webhook is not configured.", 404, "cms_webhook_not_found");
  const rows = await query<CmsConnectionRow>("SELECT * FROM cms_connections WHERE id=$1 LIMIT 1", [connectionId]);
  const connection = rows[0];
  if (!connection || connection.status === "disconnected") throw new CmsDataError("This store webhook is not available.", 404, "cms_webhook_not_found");
  const expected = decrypt<string>(connection.webhook_secret_encrypted);
  if (!secureCompare(token, expected)) throw new CmsDataError("This store webhook is not authorized.", 401, "cms_webhook_unauthorized");
  return connection;
};

export async function handleCmsWebhook(request: IncomingMessage, response: ServerResponse) {
  try {
    if (request.method !== "POST") {
      json(response, 405, { error: "Use POST for store webhooks." });
      return;
    }
    const url = new URL(request.url || "/", "http://localhost");
    const connection = await webhookConnection(text(url.searchParams.get("connection")), text(url.searchParams.get("token"), "", 200));
    const rawBody = await readRawBody(request, Number(process.env.CMS_WEBHOOK_MAX_BODY_BYTES || 2_000_000));
    const body = parseBody(rawBody);
    if (connection.platform === "woocommerce") {
      const signature = text(request.headers["x-wc-webhook-signature"], "", 500);
      if (!signature) throw new CmsDataError("The WooCommerce webhook signature is missing.", 401, "cms_webhook_unauthorized");
      {
        const secret = decrypt<string>(connection.webhook_secret_encrypted);
        const expected = createHmac("sha256", secret).update(rawBody).digest("base64");
        if (!secureCompare(signature, expected)) throw new CmsDataError("The WooCommerce webhook signature is invalid.", 401, "cms_webhook_unauthorized");
      }
    }
    if (connection.platform === "shopify") {
      const signature = text(request.headers["x-shopify-hmac-sha256"], "", 500);
      if (!signature) throw new CmsDataError("The Shopify webhook signature is missing.", 401, "cms_webhook_unauthorized");
      const secret = shopifyWebhookSecret();
      const expected = createHmac("sha256", secret).update(rawBody).digest("base64");
      if (!secureCompare(signature, expected)) throw new CmsDataError("The Shopify webhook signature is invalid.", 401, "cms_webhook_unauthorized");
    }
    if (connection.platform === "bigcommerce") {
      const token = text(request.headers["x-maxform-webhook-token"], "", 500);
      const secret = decrypt<string>(connection.webhook_secret_encrypted);
      if (!token || !secureCompare(token, secret)) throw new CmsDataError("The BigCommerce webhook token is invalid.", 401, "cms_webhook_unauthorized");
    }
    const topic = text(
      request.headers["x-wc-webhook-topic"] || request.headers["x-shopify-topic"] || body.scope,
      "store.webhook",
      120,
    );
    const synced = await performSync(connection.workspace_id, connection.id, "webhook");
    const normalizedTopic = topic.toLowerCase().replace(/[/.]/g, "_").replace(/\//g, "_");
    const topicEvent = normalizedTopic.includes("product_created")
      ? "store_product_created"
      : normalizedTopic.includes("product_updated")
        ? "store_product_updated"
        : normalizedTopic.includes("product_deleted")
          ? "store_product_deleted"
          : normalizedTopic.includes("order_created")
            ? "store_order_created"
            : normalizedTopic.includes("order_updated")
              ? "store_order_updated"
              : normalizedTopic.includes("order_deleted") || normalizedTopic.includes("order_refunded")
                ? "store_order_refunded"
                : "store_webhook_received";
    await emitStoreWorkflowEvent(connection.workspace_id, topicEvent, { connectionId: connection.id, platform: connection.platform, topic, payload: body, syncInProgress: !synced }, `store_webhook:${connection.id}:${text(request.headers["x-wc-webhook-id"] || request.headers["x-shopify-webhook-id"] || body.hash, randomUUID(), 160)}`);
    json(response, 200, { received: true, topic, syncInProgress: !synced });
  } catch (error) {
    if (error instanceof CmsDataError) {
      json(response, error.status, { code: error.code, error: error.message });
      return;
    }
    json(response, 500, { code: "cms_webhook_failed", error: "The store webhook could not be processed." });
  }
}

export async function handleCmsCron(request: IncomingMessage, response: ServerResponse) {
  const expected = text(process.env.CRON_SECRET, "", 500);
  const authorization = String(request.headers.authorization || "");
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!expected || !secureCompare(supplied, expected)) {
    json(response, 401, { code: "cron_unauthorized", error: "This scheduler request is not authorized." });
    return;
  }
  if (request.method !== "GET" && request.method !== "POST") {
    json(response, 405, { error: "Use GET or POST for the store scheduler." });
    return;
  }
  try {
    const batchSize = Math.max(1, Math.min(20, integer(process.env.CMS_RECONCILIATION_BATCH_SIZE, 5)));
    const reconciliationMinutes = Math.max(1, Math.min(60, integer(process.env.CMS_RECONCILIATION_INTERVAL_MINUTES, 1)));
    const fallbackMinutes = Math.max(1, Math.min(reconciliationMinutes, integer(process.env.CMS_RECONCILIATION_FALLBACK_INTERVAL_MINUTES, 1)));
    const rows = await query<CmsConnectionRow>(
      `SELECT * FROM cms_connections
       WHERE status <> 'disconnected'
         AND (status <> 'syncing' OR sync_lock_token IS NULL OR sync_lock_expires_at IS NULL OR sync_lock_expires_at < NOW())
         AND (last_reconciliation_at IS NULL OR last_reconciliation_at < NOW() -
           (CASE WHEN webhook_registered THEN $1 ELSE $2 END * INTERVAL '1 minute'))
         ORDER BY last_reconciliation_at NULLS FIRST LIMIT $3`,
      [reconciliationMinutes, fallbackMinutes, batchSize],
    );
    let succeeded = 0;
    let skipped = 0;
    let failed = 0;
    for (const connection of rows) {
      try {
        if (await performSync(connection.workspace_id, connection.id, "reconciliation")) succeeded += 1;
        else skipped += 1;
      } catch {
        failed += 1;
      }
    }
    json(response, 200, { value: { selected: rows.length, succeeded, skipped, failed } });
  } catch (error) {
    console.error("[cms-cron] unexpected scheduler failure", { type: error instanceof Error ? error.name : typeof error });
    json(response, 500, { code: "cms_scheduler_failed", error: "Connected stores could not be reconciled." });
  }
}

export { CmsDataError };

// Kept server-side for focused contract tests. These helpers contain the
// provider boundary rules but do not perform network or database work.
export const cmsDataTestHelpers = {
  customFieldPayload,
  customFieldUpdatePayload,
  customFieldDeletePayload,
  normalizeProductAttributes,
  normalizeVariantInput,
  wooProductPayload,
  wooVariationPayload,
};

export const CMS_PLATFORMS = ["shopify", "woocommerce", "bigcommerce", "wix"] as const;
export type CmsPlatform = (typeof CMS_PLATFORMS)[number];

export type CmsStoresTab =
  | "overview"
  | "analytics"
  | "sites"
  | "products"
  | "categories"
  | "orders"
  | "activity"
  | "settings";

export type StoreConnectorTab =
  | "overview"
  | "providers"
  | "connections"
  | "activity"
  | "settings";

export type CmsConnectionStatus =
  | "healthy"
  | "attention"
  | "syncing"
  | "disconnected";

export type CmsCustomFieldValueType = "string" | "number" | "boolean" | "json";

/**
 * A WooCommerce REST `meta_data` entry. The value is kept as text in the
 * editor so plugin-owned fields can be changed without assuming a plugin's
 * schema. `valueType` tells the server how to send it back to WooCommerce.
 */
export type CmsCustomField = {
  id?: number;
  key: string;
  value: string;
  valueType?: CmsCustomFieldValueType;
};

export type CmsDeletedCustomField = Pick<CmsCustomField, "id" | "key"> & { id: number };

export type CmsProductAttribute = {
  id?: number;
  name: string;
  slug?: string;
  options: string[];
  visible: boolean;
  variation: boolean;
  position?: number;
};

export type CmsConnection = {
  id: string;
  platform: CmsPlatform;
  platformName: string;
  name: string;
  storeUrl: string;
  externalStoreId: string;
  status: CmsConnectionStatus;
  webhookRegistered: boolean;
  lastError: string;
  lastSyncedAt: string | null;
  lastReconciliationAt: string | null;
  counts: { products: number; categories: number; orders: number };
  createdAt: string;
  updatedAt: string;
};

export type CmsProductVariant = {
  id: string;
  externalId: string;
  title: string;
  status?: string;
  sku: string;
  price: number;
  compareAtPrice: number | null;
  inventoryQuantity: number | null;
  inventoryManaged: boolean;
  imageUrl: string;
  attributes: Record<string, unknown>;
  customFields?: CmsCustomField[];
};

export type CmsProduct = {
  id: string;
  connectionId: string;
  platform: CmsPlatform;
  storeName: string;
  externalId: string;
  title: string;
  description: string;
  shortDescription: string;
  status: string;
  sku: string;
  price: number;
  compareAtPrice: number | null;
  salePrice: number | null;
  currency: string;
  inventoryQuantity: number | null;
  inventoryManaged: boolean;
  featured: boolean;
  productType: string;
  vendor: string;
  tags: string[];
  attributes?: CmsProductAttribute[];
  categoryIds?: string[];
  customFields?: CmsCustomField[];
  imageUrl: string;
  images: string[];
  variants: CmsProductVariant[];
  externalUpdatedAt: string | null;
  lastPulledAt: string | null;
};

export type CmsCategory = {
  id: string;
  connectionId: string;
  platform: CmsPlatform;
  storeName: string;
  externalId: string;
  name: string;
  parentId: string | null;
  type: "category" | "collection";
  productCount: number;
  lastPulledAt: string | null;
};

export type CmsOrder = {
  id: string;
  connectionId: string;
  platform: CmsPlatform;
  storeName: string;
  externalId: string;
  orderNumber: string;
  status: string;
  fulfillmentStatus: string;
  total: number;
  currency: string;
  customerName: string;
  customerEmail: string;
  paymentGateway: string;
  trackingNumber: string;
  lineItems: Array<{ name: string; quantity: number; total: number; externalId?: string }>;
  createdAt: string | null;
  updatedAt: string | null;
};

export type CmsSyncEvent = {
  id: string;
  connectionId: string;
  storeName: string;
  platform: CmsPlatform;
  direction: "webhook" | "reconciliation" | "manual";
  resource: string;
  eventType: string;
  status: "success" | "failed" | "processing";
  message: string;
  occurredAt: string;
};

export type CmsWorkspace = {
  summary: {
    connectedSites: number;
    healthySites: number;
    products: number;
    categories: number;
    orders: number;
    revenue: number;
    currency: string;
  };
  connections: CmsConnection[];
  products: CmsProduct[];
  categories: CmsCategory[];
  orders: CmsOrder[];
  syncEvents: CmsSyncEvent[];
  limits: {
    maxPerPlatform: number;
    shopifyUsed: number;
    woocommerceUsed: number;
    bigcommerceUsed: number;
    wixUsed: number;
  };
};

const accessToken = () => {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem("access_token") || "";
};

const cmsRequest = async <T>(operation: string, args: Record<string, unknown> = {}) => {
  const token = accessToken();
  const response = await fetch("/api/cms/data", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ operation, args }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    value?: T;
    error?: string;
  };
  if (!response.ok) {
    throw new Error(body.error || "The connected stores request could not be completed.");
  }
  return body.value as T;
};

export const getCmsWorkspace = () => cmsRequest<CmsWorkspace>("getCmsWorkspace");
export const getCmsOrders = () => cmsRequest<CmsOrder[]>("getCmsOrders");
export const syncCmsConnection = (connectionId: string) =>
  cmsRequest<CmsWorkspace>("syncCmsConnection", { connectionId });
export const reconnectCmsConnection = (connectionId: string) =>
  cmsRequest<CmsWorkspace>("reconnectCmsConnection", { connectionId });
export const disconnectCmsConnection = (connectionId: string) =>
  cmsRequest<{ disconnected: boolean; dataRemoved?: boolean }>("disconnectCmsConnection", { connectionId });

export type CreateCmsConnectionInput = {
  platform: CmsPlatform;
  name: string;
  storeUrl: string;
  credentials: Record<string, string>;
};

export const createCmsConnection = (input: CreateCmsConnectionInput) =>
  cmsRequest<CmsWorkspace>("createCmsConnection", { input });

export type CmsProductInput = {
  connectionId: string;
  productId?: string;
  title: string;
  description?: string;
  shortDescription?: string;
  status?: string;
  productType?: string;
  sku?: string;
  price?: number;
  compareAtPrice?: number | null;
  inventoryQuantity?: number | null;
  inventoryManaged?: boolean;
  vendor?: string;
  tags?: string[];
  attributes?: CmsProductAttribute[];
  categoryIds?: string[];
  images?: string[];
  customFields?: CmsCustomField[];
  deletedCustomFieldIds?: number[];
  deletedCustomFields?: CmsDeletedCustomField[];
  variants?: CmsProductVariantInput[];
  deletedVariantIds?: string[];
};

export type CmsProductVariantInput = {
  externalId?: string;
  title?: string;
  status?: string;
  sku?: string;
  price?: number;
  compareAtPrice?: number | null;
  inventoryQuantity?: number | null;
  inventoryManaged?: boolean;
  imageUrl?: string;
  attributes?: Record<string, string>;
  customFields?: CmsCustomField[];
  deletedCustomFieldIds?: number[];
  deletedCustomFields?: CmsDeletedCustomField[];
};

export const saveCmsProduct = (input: CmsProductInput) =>
  cmsRequest<CmsWorkspace>(input.productId ? "updateCmsProduct" : "createCmsProduct", { input });
export const deleteCmsProduct = (connectionId: string, productId: string) =>
  cmsRequest<CmsWorkspace>("deleteCmsProduct", { connectionId, productId });

export const saveCmsCategory = (input: {
  connectionId: string;
  categoryId?: string;
  name: string;
  parentId?: string | null;
}) => cmsRequest<CmsWorkspace>(input.categoryId ? "updateCmsCategory" : "createCmsCategory", { input });

export const deleteCmsCategory = (connectionId: string, categoryId: string) =>
  cmsRequest<CmsWorkspace>("deleteCmsCategory", { connectionId, categoryId });

export const updateCmsOrder = (input: {
  connectionId: string;
  orderId: string;
  status?: string;
  note?: string;
  trackingNumber?: string;
}) => cmsRequest<CmsWorkspace>("updateCmsOrder", { input });

export const refundCmsOrder = (input: {
  connectionId: string;
  orderId: string;
  amount?: number;
  reason?: string;
}) => cmsRequest<CmsWorkspace>("refundCmsOrder", { input });

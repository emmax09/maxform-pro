export type PaymentProviderId = "stripe" | "paypal" | "paystack" | "opay";

export type PaymentProviderConnection = {
  id: string;
  provider: PaymentProviderId;
  authType: "oauth" | "api_key";
  status: "connected" | "attention" | "disconnected";
  externalAccountId: string;
  externalAccountName: string;
  credentialHint: string;
  isDefault: boolean;
  healthOk: boolean;
  lastCheckedAt: string;
  lastError: string;
  connectedAt: string;
};

export type PaymentProduct = {
  id: string;
  name: string;
  description: string;
  shortDescription?: string;
  sku: string;
  price: number;
  salePrice?: number | null;
  currency: string;
  billingType: "one_time" | "recurring";
  billingInterval: "week" | "month" | "quarter" | "year" | null;
  sourceType: "catalog" | "form" | "event" | "ticket_type";
  sourceId: string | null;
  imageUrl: string;
  imageGallery?: string[];
  promotionalBanner?: string;
  category?: string;
  categories?: string[];
  status?: "active" | "draft" | "hidden" | "sold_out";
  availabilityStartAt?: string;
  availabilityEndAt?: string;
  minQuantity?: number;
  maxQuantity?: number;
  onePerCustomer?: boolean;
  hideWhenSoldOut?: boolean;
  taxable: boolean;
  taxRate: number;
  requiresShipping: boolean;
  trackInventory: boolean;
  inventoryQuantity: number;
  lowStockThreshold: number;
  allowBackorder: boolean;
  weightGrams: number;
  options: string[];
  variants: PaymentProductVariant[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PaymentProductVariant = {
  id: string;
  name: string;
  sku: string;
  price: number;
  salePrice?: number | null;
  description?: string;
  optionValues: Record<string, string>;
  imageUrl: string;
  trackInventory: boolean;
  inventoryQuantity: number;
  lowStockThreshold: number;
  allowBackorder: boolean;
  weightGrams?: number;
  availabilityStartAt?: string;
  availabilityEndAt?: string;
  active: boolean;
  sortOrder: number;
};

export type PaymentCouponTargetType = "form" | "event";

export type PaymentCouponTarget = {
  couponsEnabled: boolean;
  id: string;
  type: PaymentCouponTargetType;
  name: string;
  detail: string;
  currency: string;
};

export type PaymentCouponAssignment = Pick<
  PaymentCouponTarget,
  "id" | "type"
>;

export type PaymentCoupon = {
  id: string;
  code: string;
  name: string;
  description?: string;
  discountType: "percentage" | "fixed";
  discountValue: number;
  currency: string | null;
  redemptionLimit: number | null;
  redemptionLimitPerCustomer: number | null;
  redemptionLimitPerIdentity: number | null;
  redemptionCount: number;
  minimumAmount: number;
  maximumDiscount: number | null;
  appliesTo: PaymentCouponAssignment[];
  eligibleProductIds?: string[];
  excludedProductIds?: string[];
  /** Present only for coupons created inside a specific form or event builder. */
  directTarget: PaymentCouponAssignment | null;
  startsAt: string;
  endsAt: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PaymentOrderItem = {
  id: string;
  productId: string | null;
  variantId: string | null;
  sku: string;
  variantName: string;
  name: string;
  description: string;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
};

export type PaymentOrder = {
  id: string;
  orderNumber: string;
  sourceType: "form" | "event" | "invoice" | "manual" | "subscription";
  sourceId: string | null;
  contactId: string | null;
  sourceName: string;
  customerName: string;
  customerEmail: string;
  status:
    | "draft"
    | "pending"
    | "processing"
    | "paid"
    | "failed"
    | "cancelled"
    | "partially_refunded"
    | "refunded";
  provider: PaymentProviderId | "coupon" | null;
  providerReference: string;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  shippingAmount: number;
  totalAmount: number;
  refundedAmount: number;
  currency: string;
  paymentMethodSummary: string;
  failureReason: string;
  paidAt: string;
  createdAt: string;
  items: PaymentOrderItem[];
};

export type PaymentInvoice = {
  id: string;
  orderId: string | null;
  invoiceNumber: string;
  customerName: string;
  customerEmail: string;
  status: "draft" | "open" | "paid" | "overdue" | "void";
  amountDue: number;
  amountPaid: number;
  currency: string;
  dueAt: string;
  sentAt: string;
  paidAt: string;
  memo: string;
  lineItems: Array<{
    id: string;
    name: string;
    quantity: number;
    unitPrice: number;
  }>;
  createdAt: string;
  updatedAt: string;
};

export type PaymentSubscription = {
  id: string;
  productId: string | null;
  productName: string;
  provider: PaymentProviderId | null;
  customerName: string;
  customerEmail: string;
  status: "trialing" | "active" | "past_due" | "paused" | "cancelled" | "ended";
  amount: number;
  currency: string;
  intervalUnit: "week" | "month" | "quarter" | "year";
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PaymentRefund = {
  id: string;
  orderId: string;
  orderNumber: string;
  provider: PaymentProviderId;
  amount: number;
  currency: string;
  reason: string;
  status: "pending" | "processing" | "succeeded" | "failed" | "cancelled";
  failureReason: string;
  requestedAt: string;
  completedAt: string;
};

export type PaymentInventoryAlert = {
  id: string;
  productId: string;
  variantId: string | null;
  productName: string;
  variantName: string;
  status: "open" | "acknowledged" | "resolved";
  quantity: number;
  threshold: number;
  message: string;
  createdAt: string;
  updatedAt: string;
};

export type PaymentWorkspaceData = {
  connections: PaymentProviderConnection[];
  products: PaymentProduct[];
  coupons: PaymentCoupon[];
  couponTargets: PaymentCouponTarget[];
  orders: PaymentOrder[];
  invoices: PaymentInvoice[];
  inventoryAlerts: PaymentInventoryAlert[];
  subscriptions: PaymentSubscription[];
  refunds: PaymentRefund[];
};

export type PaymentProductInput = Omit<
  PaymentProduct,
  "createdAt" | "id" | "sourceId" | "sourceType" | "updatedAt" | "variants"
> & {
  id?: string;
  shortDescription?: string;
  salePrice?: number | null;
  imageGallery?: string[];
  promotionalBanner?: string;
  category?: string;
  categories?: string[];
  status?: "active" | "draft" | "hidden" | "sold_out";
  availabilityStartAt?: string;
  availabilityEndAt?: string;
  minQuantity?: number;
  maxQuantity?: number;
  onePerCustomer?: boolean;
  hideWhenSoldOut?: boolean;
  variants: Array<Omit<PaymentProductVariant, "id"> & { id?: string }>;
};

/**
 * Keep order limits valid while a product is being edited. Tracked inventory
 * is the hard ceiling; an empty tracked inventory is represented as a
 * zero-quantity, sold-out product until stock is added.
 */
export const normalizeProductQuantityLimits = (
  input: PaymentProductInput,
): PaymentProductInput => {
  const integerOr = (value: unknown, fallback: number) => {
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const inventoryQuantity = Math.max(
    0,
    integerOr(input.inventoryQuantity, 0),
  );
  const ceiling = input.trackInventory
    ? Math.min(1000, inventoryQuantity)
    : 1000;

  if (input.trackInventory && ceiling === 0) {
    return { ...input, minQuantity: 0, maxQuantity: 0 };
  }

  const minQuantity = Math.min(
    ceiling,
    Math.max(1, integerOr(input.minQuantity, 1)),
  );
  const maxQuantity = Math.min(
    ceiling,
    Math.max(minQuantity, integerOr(input.maxQuantity, 1000)),
  );
  return { ...input, minQuantity, maxQuantity };
};

export type PaymentCouponInput = Omit<
  PaymentCoupon,
  "createdAt" | "directTarget" | "id" | "redemptionCount" | "updatedAt"
> & {
  directTarget?: PaymentCouponAssignment | null;
  description?: string;
  eligibleProductIds?: string[];
  excludedProductIds?: string[];
  id?: string;
};

export type PaymentCouponAnalytics = {
  couponId: string;
  redeemedCount: number;
  reservedCount: number;
  releasedCount: number;
  uniqueCustomers: number;
  totals: Array<{
    currency: string;
    discountAmount: number;
    revenueAfterDiscount: number;
    redemptions: number;
  }>;
  recentRedemptions: Array<{
    createdAt: string;
    currency: string;
    customerEmail: string;
    customerName: string;
    discountAmount: number;
    orderNumber: string;
    redeemedAt: string;
    sourceName: string;
    status: "reserved" | "redeemed" | "released";
    totalAmount: number;
  }>;
};

export type PaymentInvoiceInput = Pick<
  PaymentInvoice,
  | "amountDue"
  | "currency"
  | "customerEmail"
  | "customerName"
  | "dueAt"
  | "lineItems"
  | "memo"
> & {
  id?: string;
};

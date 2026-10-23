import type {
  PaymentCoupon,
  PaymentCouponAssignment,
  PaymentCouponAnalytics,
  PaymentCouponInput,
  PaymentCouponTarget,
  PaymentInvoice,
  PaymentInvoiceInput,
  PaymentInventoryAlert,
  PaymentOrder,
  PaymentOrderItem,
  PaymentProduct,
  PaymentProductInput,
  PaymentProviderConnection,
  PaymentProviderId,
  PaymentRefund,
  PaymentSubscription,
  PaymentWorkspaceData,
} from "../components/payments/payment-types";

type DatabaseRow = Record<string, unknown>;

const asString = (value: unknown) =>
  typeof value === "string" ? value : value == null ? "" : String(value);
const asNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const asBoolean = (value: unknown) =>
  value === true || value === "true" || value === 1;
const asNullableString = (value: unknown) => {
  const text = asString(value);
  return text || null;
};
const asJson = <T>(value: unknown, fallback: T): T => {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return typeof value === "object" ? (value as T) : fallback;
};

const asCouponAssignment = (
  value: unknown,
): PaymentCouponAssignment | null => {
  const target = asJson<Partial<PaymentCouponAssignment>>(value, {});
  return target.id && (target.type === "form" || target.type === "event")
    ? { id: target.id, type: target.type }
    : null;
};

const mapConnection = (row: DatabaseRow): PaymentProviderConnection => ({
  id: asString(row.id),
  provider: asString(row.provider) as PaymentProviderId,
  authType: asString(row.auth_type) === "oauth" ? "oauth" : "api_key",
  status: asString(row.status) as PaymentProviderConnection["status"],
  externalAccountId: asString(row.external_account_id),
  externalAccountName: asString(row.external_account_name),
  credentialHint: asString(row.credential_hint),
  isDefault: asBoolean(row.is_default),
  healthOk: asBoolean(row.health_ok),
  lastCheckedAt: asString(row.last_checked_at),
  lastError: asString(row.last_error),
  connectedAt: asString(row.connected_at),
});

const mapProductVariant = (value: unknown): PaymentProduct["variants"][number] => {
  const row = asJson<DatabaseRow>(value, {});
  return {
    id: asString(row.id),
    name: asString(row.name),
    sku: asString(row.sku),
    price: asNumber(row.price),
    salePrice:
      row.salePrice == null && row.sale_price == null
        ? null
        : asNumber(row.salePrice ?? row.sale_price),
    description: asString(row.description),
    optionValues: asJson<Record<string, string>>(row.optionValues ?? row.option_values, {}),
    imageUrl: asString(row.imageUrl ?? row.image_url),
    trackInventory: asBoolean(row.trackInventory ?? row.track_inventory),
    inventoryQuantity: asNumber(row.inventoryQuantity ?? row.inventory_quantity),
    lowStockThreshold: asNumber(row.lowStockThreshold ?? row.low_stock_threshold),
    allowBackorder: asBoolean(row.allowBackorder ?? row.allow_backorder),
    weightGrams: asNumber(row.weightGrams ?? row.weight_grams),
    availabilityStartAt: asString(row.availabilityStartAt ?? row.availability_start_at),
    availabilityEndAt: asString(row.availabilityEndAt ?? row.availability_end_at),
    active: asBoolean(row.active),
    sortOrder: asNumber(row.sortOrder ?? row.sort_order),
  };
};

const mapProduct = (row: DatabaseRow): PaymentProduct => ({
  id: asString(row.id),
  name: asString(row.name),
  description: asString(row.description),
  shortDescription: asString(row.short_description),
  sku: asString(row.sku),
  price: asNumber(row.price),
  salePrice:
    row.sale_price == null ? null : asNumber(row.sale_price),
  currency: asString(row.currency),
  billingType:
    asString(row.billing_type) === "recurring" ? "recurring" : "one_time",
  billingInterval:
    (asNullableString(row.billing_interval) as PaymentProduct["billingInterval"]) ||
    null,
  sourceType: asString(row.source_type) as PaymentProduct["sourceType"],
  sourceId: asNullableString(row.source_id),
  imageUrl: asString(row.image_url),
  imageGallery: asJson<string[]>(row.image_gallery, []).filter(Boolean),
  promotionalBanner: asString(row.promotional_banner),
  category: asString(row.category),
  categories: asString(row.category)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
  status:
    (asString(row.product_status) as PaymentProduct["status"]) || "active",
  availabilityStartAt: asString(row.availability_start_at),
  availabilityEndAt: asString(row.availability_end_at),
  minQuantity: row.min_quantity == null ? 1 : asNumber(row.min_quantity),
  maxQuantity: row.max_quantity == null ? 1000 : asNumber(row.max_quantity),
  onePerCustomer: asBoolean(row.one_per_customer),
  hideWhenSoldOut: asBoolean(row.hide_when_sold_out),
  taxable: asBoolean(row.taxable),
  taxRate: asNumber(row.tax_rate),
  requiresShipping: asBoolean(row.requires_shipping),
  trackInventory: asBoolean(row.track_inventory),
  inventoryQuantity: asNumber(row.inventory_quantity),
  lowStockThreshold: asNumber(row.low_stock_threshold),
  allowBackorder: asBoolean(row.allow_backorder),
  weightGrams: asNumber(row.weight_grams),
  options: asJson<string[]>(row.options, []).filter(
    (option) => typeof option === "string" && option.trim(),
  ),
  variants: asJson<unknown[]>(row.variants, []).map(mapProductVariant),
  active: asBoolean(row.active),
  createdAt: asString(row.created_at),
  updatedAt: asString(row.updated_at),
});

const mapCoupon = (row: DatabaseRow): PaymentCoupon => ({
  id: asString(row.id),
  code: asString(row.code),
  name: asString(row.name),
  description: asString(row.description),
  discountType: asString(row.discount_type) as PaymentCoupon["discountType"],
  discountValue: asNumber(row.discount_value),
  currency: asNullableString(row.currency),
  redemptionLimit:
    row.redemption_limit == null ? null : asNumber(row.redemption_limit),
  redemptionLimitPerCustomer:
    row.redemption_limit_per_customer == null
      ? null
      : asNumber(row.redemption_limit_per_customer),
  redemptionLimitPerIdentity:
    row.redemption_limit_per_identity == null
      ? null
      : asNumber(row.redemption_limit_per_identity),
  redemptionCount: asNumber(row.redemption_count),
  minimumAmount: asNumber(row.minimum_amount),
  maximumDiscount:
    row.maximum_discount == null ? null : asNumber(row.maximum_discount),
  eligibleProductIds: asJson<string[]>(row.eligible_product_ids, []).filter(Boolean),
  excludedProductIds: asJson<string[]>(row.excluded_product_ids, []).filter(Boolean),
  appliesTo: asJson<PaymentCouponAssignment[]>(row.applies_to, []).filter(
    (target) =>
      Boolean(target?.id) &&
      (target.type === "form" || target.type === "event"),
  ),
  directTarget: asCouponAssignment(row.direct_target),
  startsAt: asString(row.starts_at),
  endsAt: asString(row.ends_at),
  active: asBoolean(row.active),
  createdAt: asString(row.created_at),
  updatedAt: asString(row.updated_at),
});

const mapCouponTarget = (row: DatabaseRow): PaymentCouponTarget => ({
  couponsEnabled: asBoolean(row.coupons_enabled),
  id: asString(row.id),
  type: asString(row.type) === "event" ? "event" : "form",
  name: asString(row.name),
  detail: asString(row.detail),
  currency: asString(row.currency) || "USD",
});

const mapOrderItem = (value: unknown): PaymentOrderItem => {
  const item = asJson<DatabaseRow>(value, {});
  return {
    id: asString(item.id),
    productId: asNullableString(item.productId),
    variantId: asNullableString(item.variantId),
    sku: asString(item.sku),
    variantName: asString(item.variantName),
    name: asString(item.name),
    description: asString(item.description),
    quantity: asNumber(item.quantity),
    unitPrice: asNumber(item.unitPrice),
    totalAmount: asNumber(item.totalAmount),
  };
};

const mapOrder = (row: DatabaseRow): PaymentOrder => ({
  id: asString(row.id),
  orderNumber: asString(row.order_number),
  sourceType: asString(row.source_type) as PaymentOrder["sourceType"],
  sourceId: asNullableString(row.source_id),
  contactId: asNullableString(row.contact_id),
  sourceName: asString(row.source_name),
  customerName: asString(row.customer_name),
  customerEmail: asString(row.customer_email),
  status: asString(row.status) as PaymentOrder["status"],
  provider:
    (asNullableString(row.provider) as PaymentOrder["provider"]) || null,
  providerReference: asString(row.provider_reference),
  subtotal: asNumber(row.subtotal),
  discountAmount: asNumber(row.discount_amount),
  taxAmount: asNumber(row.tax_amount),
  shippingAmount: asNumber(row.shipping_amount),
  totalAmount: asNumber(row.total_amount),
  refundedAmount: asNumber(row.refunded_amount),
  currency: asString(row.currency),
  paymentMethodSummary: asString(row.payment_method_summary),
  failureReason: asString(row.failure_reason),
  paidAt: asString(row.paid_at),
  createdAt: asString(row.created_at),
  items: asJson<unknown[]>(row.items, []).map(mapOrderItem),
});

const mapInvoice = (row: DatabaseRow): PaymentInvoice => ({
  id: asString(row.id),
  orderId: asNullableString(row.order_id),
  invoiceNumber: asString(row.invoice_number),
  customerName: asString(row.customer_name),
  customerEmail: asString(row.customer_email),
  status: asString(row.status) as PaymentInvoice["status"],
  amountDue: asNumber(row.amount_due),
  amountPaid: asNumber(row.amount_paid),
  currency: asString(row.currency),
  dueAt: asString(row.due_at),
  sentAt: asString(row.sent_at),
  paidAt: asString(row.paid_at),
  memo: asString(row.memo),
  lineItems: asJson<PaymentInvoice["lineItems"]>(row.line_items, []),
  createdAt: asString(row.created_at),
  updatedAt: asString(row.updated_at),
});

const mapSubscription = (row: DatabaseRow): PaymentSubscription => ({
  id: asString(row.id),
  productId: asNullableString(row.product_id),
  productName: asString(row.product_name),
  provider:
    (asNullableString(row.provider) as PaymentProviderId | null) || null,
  customerName: asString(row.customer_name),
  customerEmail: asString(row.customer_email),
  status: asString(row.status) as PaymentSubscription["status"],
  amount: asNumber(row.amount),
  currency: asString(row.currency),
  intervalUnit: asString(
    row.interval_unit,
  ) as PaymentSubscription["intervalUnit"],
  currentPeriodStart: asString(row.current_period_start),
  currentPeriodEnd: asString(row.current_period_end),
  cancelAtPeriodEnd: asBoolean(row.cancel_at_period_end),
  createdAt: asString(row.created_at),
  updatedAt: asString(row.updated_at),
});

const mapRefund = (row: DatabaseRow): PaymentRefund => ({
  id: asString(row.id),
  orderId: asString(row.order_id),
  orderNumber: asString(row.order_number),
  provider: asString(row.provider) as PaymentProviderId,
  amount: asNumber(row.amount),
  currency: asString(row.currency),
  reason: asString(row.reason),
  status: asString(row.status) as PaymentRefund["status"],
  failureReason: asString(row.failure_reason),
  requestedAt: asString(row.requested_at),
  completedAt: asString(row.completed_at),
});

const mapInventoryAlert = (row: DatabaseRow): PaymentInventoryAlert => ({
  id: asString(row.id),
  productId: asString(row.product_id),
  variantId: asNullableString(row.variant_id),
  productName: asString(row.product_name),
  variantName: asString(row.variant_name),
  status: asString(row.status) as PaymentInventoryAlert["status"],
  quantity: asNumber(row.quantity),
  threshold: asNumber(row.threshold),
  message: asString(row.message),
  createdAt: asString(row.created_at),
  updatedAt: asString(row.updated_at),
});

const paymentDataRequest = async <T>(
  action: string,
  init: RequestInit = {},
  parameters: Record<string, string> = {},
) => {
  const search = new URLSearchParams({ action, ...parameters });
  const response = await fetch(`/api/payments/data?${search.toString()}`, {
    ...init,
    headers: { ...apiHeaders(), ...(init.headers || {}) },
  });
  const result = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(result.error || "Payments could not be updated.");
  }
  return result;
};

export async function listPaymentProviderConnections(userId: string) {
  void userId;
  const result = await paymentDataRequest<{ rows: DatabaseRow[] }>(
    "connections",
  );
  return result.rows.map(mapConnection);
}

export async function listPaymentProducts(userId: string) {
  void userId;
  const result = await paymentDataRequest<{ rows: DatabaseRow[] }>("products");
  return result.rows.map(mapProduct);
}

export async function hasConnectedPaymentProvider(
  userId: string,
  provider: PaymentProviderId | "workspace" = "workspace",
  recurringOnly = false,
) {
  void userId;
  const result = await paymentDataRequest<{ connected: boolean }>(
    "has-provider",
    {},
    { provider, recurring: String(recurringOnly) },
  );
  return result.connected;
}

export async function listSecureFormPayments(
  userId: string,
  formId: string,
) {
  void userId;
  const result = await paymentDataRequest<{ rows: DatabaseRow[] }>(
    "form-payments",
    {},
    { formId },
  );
  return result.rows;
}

export async function listSecureContactPayments(
  userId: string,
  email: string,
) {
  void userId;
  const result = await paymentDataRequest<{ rows: DatabaseRow[] }>(
    "contact-payments",
    {},
    { email },
  );
  return result.rows;
}

export async function syncEventTicketPaymentProduct(
  userId: string,
  ticketTypeId: string,
) {
  void userId;
  await paymentDataRequest("sync-ticket-product", {
    method: "POST",
    body: JSON.stringify({ ticketTypeId }),
  });
}

export async function deactivateEventTicketPaymentProduct(
  userId: string,
  ticketTypeId: string,
) {
  void userId;
  await paymentDataRequest("deactivate-ticket-product", {
    method: "POST",
    body: JSON.stringify({ ticketTypeId }),
  });
}

/**
 * Takes only the id, because only the id is sent.
 *
 * The parameter previously described a whole form, including a payment `mode`
 * union that had to be kept in step with the form types by hand -- and was not:
 * adding "cart" made every real form fail to satisfy a shape whose extra fields
 * this function never reads.
 */
export async function syncFormPaymentProduct(
  userId: string,
  form: { id: string },
) {
  void userId;
  await paymentDataRequest("sync-form-product", {
    method: "POST",
    body: JSON.stringify({ formId: form.id }),
  });
}

export async function listPaymentWorkspace(
  userId: string,
): Promise<PaymentWorkspaceData> {
  void userId;
  const result = await paymentDataRequest<{
    workspace: {
      connections: DatabaseRow[];
      coupons: DatabaseRow[];
      couponTargets: DatabaseRow[];
      invoices: DatabaseRow[];
      inventoryAlerts: DatabaseRow[];
      orders: DatabaseRow[];
      products: DatabaseRow[];
      refunds: DatabaseRow[];
      subscriptions: DatabaseRow[];
    };
  }>("workspace");
  const workspace = result.workspace;

  return {
    connections: workspace.connections.map(mapConnection),
    products: workspace.products.map(mapProduct),
    coupons: workspace.coupons.map(mapCoupon),
    couponTargets: workspace.couponTargets.map(mapCouponTarget),
    orders: workspace.orders.map(mapOrder),
    invoices: workspace.invoices.map(mapInvoice),
    inventoryAlerts: workspace.inventoryAlerts.map(mapInventoryAlert),
    subscriptions: workspace.subscriptions.map(mapSubscription),
    refunds: workspace.refunds.map(mapRefund),
  };
}

export async function adjustPaymentInventory(input: {
  adjustment: number;
  productId: string;
  reason: string;
  variantId?: string | null;
  referenceKey?: string;
}) {
  const result = await paymentDataRequest<{ quantity: number }>(
    "adjust-inventory",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return asNumber(result.quantity);
}

export async function acknowledgePaymentInventoryAlert(alertId: string) {
  await paymentDataRequest("ack-inventory-alert", {
    method: "POST",
    body: JSON.stringify({ id: alertId }),
  });
}

export async function savePaymentProduct(
  userId: string,
  input: PaymentProductInput,
) {
  void userId;
  const result = await paymentDataRequest<{ row: DatabaseRow }>(
    "save-product",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return mapProduct(result.row);
}

export async function setPaymentProductActive(
  userId: string,
  productId: string,
  active: boolean,
) {
  void userId;
  await paymentDataRequest("toggle-product", {
    method: "POST",
    body: JSON.stringify({ active, id: productId }),
  });
}

export async function savePaymentCoupon(
  userId: string,
  input: PaymentCouponInput,
) {
  void userId;
  const result = await paymentDataRequest<{ row: DatabaseRow }>(
    "save-coupon",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return mapCoupon(result.row);
}

export async function setPaymentCouponActive(
  userId: string,
  couponId: string,
  active: boolean,
) {
  void userId;
  await paymentDataRequest("toggle-coupon", {
    method: "POST",
    body: JSON.stringify({ active, id: couponId }),
  });
}

export async function deletePaymentCoupon(userId: string, couponId: string) {
  void userId;
  await paymentDataRequest("delete-coupon", {
    method: "POST",
    body: JSON.stringify({ id: couponId }),
  });
}

export async function getPaymentCouponAnalytics(
  userId: string,
  couponId: string,
): Promise<PaymentCouponAnalytics> {
  void userId;
  const result = await paymentDataRequest<PaymentCouponAnalytics>(
    "coupon-analytics",
    {
      method: "POST",
      body: JSON.stringify({ id: couponId }),
    },
  );
  return {
    ...result,
    redeemedCount: asNumber(result.redeemedCount),
    reservedCount: asNumber(result.reservedCount),
    releasedCount: asNumber(result.releasedCount),
    uniqueCustomers: asNumber(result.uniqueCustomers),
    totals: Array.isArray(result.totals)
      ? result.totals.map((total) => ({
          currency: asString(total.currency) || "USD",
          discountAmount: asNumber(total.discountAmount),
          revenueAfterDiscount: asNumber(total.revenueAfterDiscount),
          redemptions: asNumber(total.redemptions),
        }))
      : [],
    recentRedemptions: Array.isArray(result.recentRedemptions)
      ? result.recentRedemptions.map((redemption) => ({
          createdAt: asString(redemption.createdAt),
          currency: asString(redemption.currency) || "USD",
          customerEmail: asString(redemption.customerEmail),
          customerName: asString(redemption.customerName),
          discountAmount: asNumber(redemption.discountAmount),
          orderNumber: asString(redemption.orderNumber),
          redeemedAt: asString(redemption.redeemedAt),
          sourceName: asString(redemption.sourceName),
          status:
            redemption.status === "redeemed" ||
            redemption.status === "released"
              ? redemption.status
              : "reserved",
          totalAmount: asNumber(redemption.totalAmount),
        }))
      : [],
  };
}

export async function savePaymentInvoice(
  userId: string,
  input: PaymentInvoiceInput,
) {
  void userId;
  const result = await paymentDataRequest<{ row: DatabaseRow }>(
    "save-invoice",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return mapInvoice(result.row);
}

export async function updatePaymentInvoiceStatus(
  userId: string,
  invoiceId: string,
  status: PaymentInvoice["status"],
) {
  void userId;
  const result = await paymentDataRequest<{ row: DatabaseRow }>(
    "update-invoice",
    {
      method: "POST",
      body: JSON.stringify({ id: invoiceId, status }),
    },
  );
  return mapInvoice(result.row);
}

export async function setDefaultPaymentProvider(
  userId: string,
  connectionId: string,
) {
  void userId;
  await paymentDataRequest("default-provider", {
    method: "POST",
    body: JSON.stringify({ id: connectionId }),
  });
}

const apiHeaders = () => {
  const token = localStorage.getItem("access_token");
  return {
    Authorization: `Bearer ${token || ""}`,
    "Content-Type": "application/json",
  };
};

const paymentProviderRequest = async <T>(
  action: string,
  init: RequestInit = {},
) => {
  const response = await fetch(
    `/api/payments/providers?action=${encodeURIComponent(action)}`,
    {
      ...init,
      headers: { ...apiHeaders(), ...(init.headers || {}) },
    },
  );
  const result = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(
      result.error || "The payment provider could not be updated.",
    );
  }
  return result;
};

export async function getPaymentProviderAvailability() {
  const result = await paymentProviderRequest<{
    providers: Record<PaymentProviderId, { configured: boolean }>;
  }>("providers");
  return result.providers;
}

export async function beginPaymentProviderConnection(
  provider: Extract<PaymentProviderId, "stripe" | "paypal">,
) {
  const result = await paymentProviderRequest<{ authorizationUrl: string }>(
    "prepare",
    {
      method: "POST",
      body: JSON.stringify({ provider }),
    },
  );
  return result.authorizationUrl;
}

export async function connectPaymentApiProvider(
  provider: Extract<PaymentProviderId, "paystack" | "opay">,
  credentials: Record<string, string>,
) {
  return paymentProviderRequest<{ connection: PaymentProviderConnection }>(
    "connect-key",
    {
      method: "POST",
      body: JSON.stringify({ provider, credentials }),
    },
  );
}

export async function disconnectPaymentProvider(
  provider: PaymentProviderId,
) {
  await paymentProviderRequest("disconnect", {
    method: "POST",
    body: JSON.stringify({ provider }),
  });
}

export async function checkPaymentProviderHealth(
  provider: PaymentProviderId,
) {
  return paymentProviderRequest<{
    health: { ok: boolean; checkedAt: string; error?: string };
  }>("health", {
    method: "POST",
    body: JSON.stringify({ provider }),
  });
}

export async function requestPaymentRefund(input: {
  amount: number;
  orderId: string;
  reason: string;
}) {
  return paymentProviderRequest<{ refund: PaymentRefund }>("refund", {
    method: "POST",
    body: JSON.stringify({
      ...input,
      idempotencyKey: crypto.randomUUID(),
    }),
  });
}

export async function cancelPaymentSubscription(subscriptionId: string) {
  await paymentProviderRequest("cancel-subscription", {
    method: "POST",
    body: JSON.stringify({ subscriptionId }),
  });
}

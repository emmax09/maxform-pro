/**
 * The Orders module's read API.
 *
 * Orders are one ledger across the whole workspace — forms, events, invoices,
 * subscriptions and manual sales all land in the same table — so this is a
 * single set of calls rather than one per selling module. Money still moves in
 * Payments: the only writes here close or remove orders that never settled.
 */

export const ORDER_SOURCES = [
  "form",
  "event",
  "invoice",
  "subscription",
  "manual",
] as const;

export type OrderSource = (typeof ORDER_SOURCES)[number];

export const ORDER_SOURCE_LABELS: Record<OrderSource, string> = {
  form: "Forms",
  event: "Events",
  invoice: "Invoices",
  subscription: "Subscriptions",
  manual: "Manual",
};

export const ORDER_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending: "Pending",
  processing: "Processing",
  paid: "Paid",
  failed: "Failed",
  cancelled: "Cancelled",
  partially_refunded: "Part refunded",
  refunded: "Refunded",
};

/** Settled money, as opposed to promised money. */
export const SETTLED_STATUSES = ["paid", "partially_refunded", "refunded"];
export const OPEN_STATUSES = ["draft", "pending", "processing"];

export interface WorkspaceOrder {
  id: string;
  orderNumber: string;
  sourceType: string;
  sourceId: string;
  sourceLabel: string;
  customerName: string;
  customerEmail: string;
  contactId: string;
  status: string;
  provider: string;
  currency: string;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  shippingAmount: number;
  totalAmount: number;
  refundedAmount: number;
  itemCount: number;
  paidAt: string;
  createdAt: string;
}

export interface OrderListResult {
  orders: WorkspaceOrder[];
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
  filteredGross: number;
  filteredRefunded: number;
}

export interface OrderItem {
  id: string;
  productId: string;
  name: string;
  description: string;
  sku: string;
  variantName: string;
  quantity: number;
  refundedQuantity: number;
  unitPrice: number;
  totalAmount: number;
}

export interface OrderRefund {
  id: string;
  amount: number;
  currency: string;
  reason: string;
  status: string;
  provider: string;
  requestedAt: string;
  completedAt: string;
  failureReason: string;
}

export interface OrderInvoice {
  id: string;
  invoiceNumber: string;
  status: string;
  amountDue: number;
  amountPaid: number;
  currency: string;
  dueAt: string;
  paidAt: string;
}

export interface OrderSubscription {
  id: string;
  status: string;
  amount: number;
  currency: string;
  intervalUnit: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
}

export interface OrderPaymentAttempt {
  id: string;
  provider: string;
  /** The reference a customer quotes and an operator reconciles against. */
  transactionId: string;
  providerReference: string;
  amount: number;
  currency: string;
  status: string;
  paidAt: string;
  createdAt: string;
}

export interface OrderDetail {
  order: WorkspaceOrder & {
    providerReference: string;
    paymentMethodSummary: string;
    failureReason: string;
    contactName: string;
    campaignId: string;
    campaignName: string;
    metadata: Record<string, unknown>;
  };
  items: OrderItem[];
  refunds: OrderRefund[];
  invoices: OrderInvoice[];
  subscriptions: OrderSubscription[];
  payments: OrderPaymentAttempt[];
}

export interface OrderItemsResult {
  days: number;
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
  items: Array<{
    name: string;
    sku: string;
    quantity: number;
    refundedQuantity: number;
    revenue: number;
    orders: number;
  }>;
}

export interface OrdersSummary {
  days: number;
  totals: {
    orders: number;
    settled: number;
    open: number;
    lost: number;
    gross: number;
    refunded: number;
    outstanding: number;
    net: number;
  };
  bySource: Array<{ sourceType: string; orders: number; gross: number }>;
  byStatus: Array<{ status: string; orders: number }>;
  trend: Array<{ day: string; orders: number; gross: number }>;
  topProducts: Array<{
    name: string;
    sku: string;
    quantity: number;
    revenue: number;
  }>;
  currencies: Array<{ currency: string; orders: number }>;
}

const ordersRequest = async <T>(
  action: string,
  params: Record<string, string> = {},
  body?: object,
) => {
  const token = localStorage.getItem("access_token") || "";
  const query = new URLSearchParams({ action, ...params });
  const response = await fetch(`/api/orders/data?${query.toString()}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(result.error || "Orders could not be loaded.");
  }
  return result;
};

export const listOrders = (filters: {
  source?: string;
  status?: string;
  search?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}) =>
  ordersRequest<OrderListResult>(
    "list",
    Object.fromEntries(
      Object.entries(filters)
        .filter(([, value]) => value !== undefined && value !== "")
        .map(([key, value]) => [key, String(value)]),
    ),
  );

export const getOrderDetail = (orderId: string) =>
  ordersRequest<OrderDetail>("detail", { orderId });

/**
 * Everything sold in the window. Separate from the summary's `topProducts`,
 * which is the ten-row leaderboard the overview panel ranks.
 */
export const listOrderItems = (options: {
  days?: number;
  page?: number;
  pageSize?: number;
}) =>
  ordersRequest<OrderItemsResult>("items", {
    days: String(options.days ?? 30),
    page: String(options.page ?? 1),
    pageSize: String(options.pageSize ?? 50),
  });

export const getOrdersSummary = (days = 30) =>
  ordersRequest<{ summary: OrdersSummary }>("summary", {
    days: String(days),
  }).then((result) => result.summary);

/**
 * Deletes orders that never took payment.
 *
 * The server refuses any order that settled: deleting one destroys the record
 * a refund or chargeback is reconciled against. Cancel those instead.
 */
export const deleteOrders = (ids: string[]) =>
  ordersRequest<{ deleted: number }>("delete", {}, { ids });

/** Closes unpaid orders without destroying them. */
export const cancelOrders = (ids: string[]) =>
  ordersRequest<{ cancelled: number }>("cancel", {}, { ids });

export const exportOrders = (ids: string[]) =>
  ordersRequest<{ rows: Array<Record<string, unknown>> }>("export", {}, { ids });

/** Turns the export payload into a CSV file the browser downloads. */
export const downloadOrdersCsv = (
  rows: Array<Record<string, unknown>>,
  filename = "orders.csv",
) => {
  if (rows.length === 0) return;
  const columns = Object.keys(rows[0]);
  const escape = (value: unknown) => {
    const cell = String(value ?? "");
    // Quote whenever the value could otherwise break the row apart.
    return /[",\n\r]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
  };
  const csv = [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => escape(row[column])).join(",")),
  ].join("\r\n");
  // The BOM is what makes Excel read the file as UTF-8 rather than as the
  // system codepage, which otherwise mangles every non-ASCII customer name.
  const url = URL.createObjectURL(
    new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

/**
 * Money is acted on in Payments, so the Orders screen links there rather than
 * duplicating refund and provider controls. One place builds these links.
 */
export const paymentsLink = (section: string) =>
  `/dashboard?tab=payments&section=${encodeURIComponent(section)}`;

/** The module an order came from, for "open the form/event behind this". */
export const orderSourceLink = (order: {
  sourceType: string;
  sourceId: string;
}) => {
  if (!order.sourceId) return "";
  if (order.sourceType === "form") {
    return `/dashboard?tab=forms&formId=${encodeURIComponent(order.sourceId)}`;
  }
  if (order.sourceType === "event") {
    return `/dashboard?tab=events&eventId=${encodeURIComponent(order.sourceId)}`;
  }
  if (order.sourceType === "invoice") return paymentsLink("invoices");
  if (order.sourceType === "subscription") return paymentsLink("subscriptions");
  return "";
};

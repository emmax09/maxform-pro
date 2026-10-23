/**
 * Orders, across the whole workspace.
 *
 * Every module that takes money writes the same ledger: `payment_orders`
 * carries a `source_type` of form, event, invoice, subscription or manual, and
 * the row is the order regardless of which part of the product produced it.
 * This module is the read side of that ledger — one list, one detail view, and
 * the summary the overview tab needs — so a workspace can answer "what has
 * been sold" without opening five screens.
 *
 * Money *moves* in the Payments module: refunds, providers and payouts stay
 * there, and the detail view links across rather than duplicating them. The
 * split is deliberate — this module reports, Payments acts.
 *
 * Note on `event_orders`: nothing has inserted into it since event checkout
 * moved onto the shared ledger, so it is not read here. Event sales arrive as
 * `payment_orders` rows with `source_type = 'event'`.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

import { neon } from "@neondatabase/serverless";
import { jwtVerify } from "jose";

import { canOpenModule, workspaceScopeFor } from "./workspace-access";

type RecordValue = Record<string, unknown>;

export class OrdersDataError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "orders_data_error",
  ) {
    super(message);
  }
}

const database = () => {
  const url = process.env.DATABASE_URL || "";
  if (!url) {
    throw new OrdersDataError(
      "Orders are temporarily unavailable. Please try again later.",
      503,
      "orders_unavailable",
    );
  }
  return neon(url);
};

const signingSecret = () => {
  const secret = process.env.JWT_SECRET || "";
  if (secret.length < 32) {
    throw new OrdersDataError(
      "Orders are temporarily unavailable. Please try again later.",
      503,
      "orders_unavailable",
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

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

const authenticatedUserId = async (request: IncomingMessage) => {
  const authorization = String(request.headers.authorization || "");
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  if (!token) {
    throw new OrdersDataError(
      "Your session has expired. Sign in and try again.",
      401,
      "authentication_required",
    );
  }
  try {
    const { payload } = await jwtVerify(token, signingSecret(), {
      audience: "maxform-dashboard",
      issuer: "maxform",
    });
    const userId = String(payload.userId || "");
    if (!isUuid(userId)) throw new Error("Invalid user");
    // The workspace this request acts in. Identical to the signed-in id for a
    // workspace owner; a member resolves to the workspace they belong to.
    const workspaceId = await workspaceScopeFor(userId);
    // Orders is the whole workspace's revenue, its customer list and its
    // customers' email addresses. A member who was never granted the module
    // does not see it in the rail, and must not be able to read it by calling
    // this endpoint directly either.
    if (!(await canOpenModule(userId, "orders"))) {
      throw new OrdersDataError(
        "You do not have access to Orders in this workspace.",
        403,
        "module_access_denied",
      );
    }
    return workspaceId;
  } catch (error) {
    if (error instanceof OrdersDataError) throw error;
    throw new OrdersDataError(
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
    if (body.length > 200_000) {
      throw new OrdersDataError("This orders request is too large.", 413);
    }
  }
  if (!body) return {} as RecordValue;
  try {
    const value = JSON.parse(body) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Invalid body");
    }
    return value as RecordValue;
  } catch {
    throw new OrdersDataError("This orders request could not be read.");
  }
};

const text = (value: unknown, maximum: number) =>
  String(value ?? "").trim().slice(0, maximum);

const money = (value: unknown) => {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
};

const count = (value: unknown) => {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? Math.trunc(amount) : 0;
};

/**
 * A date the database will accept. Anything unparseable becomes no filter at
 * all, because casting it would raise in Postgres and turn a mistyped range —
 * or an assistant's "last week" — into a 500 rather than an unfiltered list.
 */
const timestamp = (value: unknown) => {
  const raw = text(value, 40);
  if (!raw) return "";
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
};

/**
 * A search term as a LIKE pattern. The wildcards are escaped: a customer
 * searching for a literal "%" or "_" means the character, and an unescaped "%"
 * matches the whole table.
 */
const likePattern = (value: string) =>
  `%${value.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;

/** The sources the ledger recognises, plus "all" for the unfiltered view. */
export const ORDER_SOURCES = [
  "form",
  "event",
  "invoice",
  "subscription",
  "manual",
] as const;

export const ORDER_STATUSES = [
  "draft",
  "pending",
  "processing",
  "paid",
  "failed",
  "cancelled",
  "partially_refunded",
  "refunded",
] as const;

const sourceFilter = (value: unknown) => {
  const source = text(value, 20).toLowerCase();
  return (ORDER_SOURCES as readonly string[]).includes(source) ? source : "";
};

const statusFilter = (value: unknown) => {
  const status = text(value, 24).toLowerCase();
  if (status === "open") return "open";
  return (ORDER_STATUSES as readonly string[]).includes(status) ? status : "";
};

/**
 * The row shape the table renders. Amounts are numbers rather than the
 * driver's numeric strings, so the client never has to parse money.
 */
const orderRow = (row: RecordValue) => ({
  id: text(row.id, 36),
  orderNumber: text(row.order_number, 60),
  sourceType: text(row.source_type, 20),
  sourceId: text(row.source_id, 36),
  /** The form, event or invoice this came from, ready to display. */
  sourceLabel: text(row.source_label, 200),
  customerName: text(row.customer_name, 200),
  customerEmail: text(row.customer_email, 320),
  contactId: text(row.contact_id, 36),
  status: text(row.status, 24),
  provider: text(row.provider, 32),
  currency: text(row.currency, 3) || "USD",
  subtotal: money(row.subtotal),
  discountAmount: money(row.discount_amount),
  taxAmount: money(row.tax_amount),
  shippingAmount: money(row.shipping_amount),
  totalAmount: money(row.total_amount),
  refundedAmount: money(row.refunded_amount),
  itemCount: count(row.item_count),
  paidAt: row.paid_at ? String(row.paid_at) : "",
  createdAt: row.created_at ? String(row.created_at) : "",
});

export type WorkspaceOrder = ReturnType<typeof orderRow>;

/**
 * The joins that give an order its human label. Kept in one place because the
 * list, the detail view and the export all need the same names, and a source
 * added to the ledger should only have to be taught here once.
 */
const sourceLabelJoins = `
  LEFT JOIN forms form
    ON payment_order.source_type = 'form' AND form.id = payment_order.source_id
  LEFT JOIN events event
    ON payment_order.source_type = 'event' AND event.id = payment_order.source_id
  LEFT JOIN payment_invoices invoice
    ON payment_order.source_type = 'invoice'
   AND invoice.id = payment_order.source_id`;

const sourceLabelExpression = `
  COALESCE(
    NULLIF(payment_order.metadata->>'sourceLabel', ''),
    NULLIF(form.title, ''),
    NULLIF(event.title, ''),
    NULLIF(invoice.invoice_number, ''),
    payment_order.order_number
  )`;

export const listOrders = async (
  userId: string,
  options: {
    source?: unknown;
    status?: unknown;
    search?: unknown;
    from?: unknown;
    to?: unknown;
    page?: unknown;
    pageSize?: unknown;
  },
) => {
  const sql = database();
  const source = sourceFilter(options.source);
  const status = statusFilter(options.status);
  const search = text(options.search, 160);
  const from = timestamp(options.from);
  const to = timestamp(options.to);
  const page = Math.max(1, count(options.page) || 1);
  const pageSize = Math.min(200, Math.max(10, count(options.pageSize) || 50));

  const filters: string[] = ["payment_order.user_id = $1"];
  const parameters: unknown[] = [userId];

  if (source) {
    parameters.push(source);
    filters.push(`payment_order.source_type = $${parameters.length}`);
  }
  if (status === "open") {
    // "Open" is what an operator chases: money promised but not settled.
    filters.push(`payment_order.status IN ('draft', 'pending', 'processing')`);
  } else if (status) {
    parameters.push(status);
    filters.push(`payment_order.status = $${parameters.length}`);
  }
  if (search) {
    parameters.push(likePattern(search));
    const like = `$${parameters.length}`;
    filters.push(`(
      payment_order.order_number ILIKE ${like}
      OR payment_order.customer_name ILIKE ${like}
      OR payment_order.customer_email ILIKE ${like}
      OR ${sourceLabelExpression} ILIKE ${like}
    )`);
  }
  if (from) {
    parameters.push(from);
    filters.push(`payment_order.created_at >= $${parameters.length}::timestamptz`);
  }
  if (to) {
    parameters.push(to);
    filters.push(`payment_order.created_at < $${parameters.length}::timestamptz`);
  }

  const where = filters.join(" AND ");
  const listParameters = [...parameters, pageSize, (page - 1) * pageSize];

  const [rows, totals] = await Promise.all([
    sql.query(
      `SELECT payment_order.*,
              ${sourceLabelExpression} AS source_label,
              (
                SELECT COUNT(*) FROM payment_order_items item
                WHERE item.order_id = payment_order.id
              )::int AS item_count
       FROM payment_orders payment_order
       ${sourceLabelJoins}
       WHERE ${where}
       ORDER BY COALESCE(payment_order.paid_at, payment_order.created_at) DESC,
                payment_order.id DESC
       LIMIT $${parameters.length + 1} OFFSET $${parameters.length + 2}`,
      listParameters,
    ),
    sql.query(
      `SELECT COUNT(*)::int AS total,
              COALESCE(SUM(payment_order.total_amount) FILTER (
                WHERE payment_order.status IN ('paid', 'partially_refunded', 'refunded')
              ), 0) AS gross,
              COALESCE(SUM(payment_order.refunded_amount), 0) AS refunded
       FROM payment_orders payment_order
       ${sourceLabelJoins}
       WHERE ${where}`,
      parameters,
    ),
  ]);

  const summary = (totals[0] || {}) as RecordValue;
  const total = count(summary.total);
  return {
    orders: rows.map((row) => orderRow(row as RecordValue)),
    page,
    pageSize,
    total,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    /** Totals for the current filter, not just the current page. */
    filteredGross: money(summary.gross),
    filteredRefunded: money(summary.refunded),
  };
};

const itemRow = (row: RecordValue) => ({
  id: text(row.id, 36),
  productId: text(row.product_id, 36),
  name: text(row.name, 200),
  description: text(row.description, 500),
  sku: text(row.sku, 120),
  variantName: text(row.variant_name, 200),
  quantity: count(row.quantity),
  refundedQuantity: count(row.refunded_quantity),
  unitPrice: money(row.unit_price),
  totalAmount: money(row.total_amount),
});

/**
 * Everything about one order, including what Payments knows about it.
 *
 * The refunds, invoice and subscription are read here rather than linked
 * blindly so the detail view can say whether an action is available before
 * sending someone to the Payments module for it.
 */
export const getOrderDetail = async (userId: string, orderId: string) => {
  if (!isUuid(orderId)) {
    throw new OrdersDataError("That order could not be found.", 404);
  }
  const sql = database();
  const rows = await sql.query(
    `SELECT payment_order.*,
            ${sourceLabelExpression} AS source_label,
            (
              SELECT COUNT(*) FROM payment_order_items item
              WHERE item.order_id = payment_order.id
            )::int AS item_count,
            payment_order.metadata AS order_metadata,
            payment_order.payment_method_summary,
            payment_order.failure_reason,
            payment_order.provider_reference,
            payment_order.source_campaign_id,
            campaign.name AS campaign_name,
            contact.full_name AS contact_name
     FROM payment_orders payment_order
     ${sourceLabelJoins}
     LEFT JOIN contact_campaigns campaign
       ON campaign.id = payment_order.source_campaign_id
     LEFT JOIN contacts contact ON contact.id = payment_order.contact_id
     WHERE payment_order.id = $1 AND payment_order.user_id = $2
     LIMIT 1`,
    [orderId, userId],
  );
  const row = rows[0] as RecordValue | undefined;
  if (!row) throw new OrdersDataError("That order could not be found.", 404);

  const [items, refunds, invoices, subscriptions, payments] = await Promise.all([
    sql.query(
      `SELECT * FROM payment_order_items WHERE order_id = $1 ORDER BY created_at`,
      [orderId],
    ),
    sql.query(
      `SELECT id, amount, currency, reason, status, provider, requested_at,
              completed_at, failure_reason
       FROM payment_refunds
       WHERE order_id = $1 AND user_id = $2
       ORDER BY created_at DESC`,
      [orderId, userId],
    ),
    sql.query(
      `SELECT id, invoice_number, status, amount_due, amount_paid, currency,
              due_at, paid_at
       FROM payment_invoices
       WHERE order_id = $1 AND user_id = $2
       ORDER BY created_at DESC
       LIMIT 5`,
      [orderId, userId],
    ),
    sql.query(
      `SELECT id, status, amount, currency, interval_unit,
              current_period_start, current_period_end, cancel_at_period_end
       FROM payment_subscriptions
       WHERE initial_order_id = $1 AND user_id = $2
       ORDER BY created_at DESC
       LIMIT 5`,
      [orderId, userId],
    ),
    // The payment attempts behind the order. This is where the transaction id
    // lives -- the reference a customer quotes and an operator reconciles
    // against the provider's dashboard.
    sql.query(
      `SELECT id, provider, transaction_id, provider_reference, amount,
              currency, status, payment_date, created_at
       FROM payments
       WHERE order_id = $1 AND user_id = $2
       ORDER BY created_at DESC`,
      [orderId, userId],
    ),
  ]);

  return {
    order: {
      ...orderRow(row),
      providerReference: text(row.provider_reference, 200),
      paymentMethodSummary: text(row.payment_method_summary, 200),
      failureReason: text(row.failure_reason, 500),
      contactName: text(row.contact_name, 200),
      campaignId: text(row.source_campaign_id, 36),
      campaignName: text(row.campaign_name, 200),
      metadata: (row.order_metadata || {}) as RecordValue,
    },
    items: items.map((item) => itemRow(item as RecordValue)),
    refunds: refunds.map((refund) => {
      const value = refund as RecordValue;
      return {
        id: text(value.id, 36),
        amount: money(value.amount),
        currency: text(value.currency, 3) || "USD",
        reason: text(value.reason, 200),
        status: text(value.status, 24),
        provider: text(value.provider, 32),
        requestedAt: value.requested_at ? String(value.requested_at) : "",
        completedAt: value.completed_at ? String(value.completed_at) : "",
        failureReason: text(value.failure_reason, 300),
      };
    }),
    invoices: invoices.map((invoice) => {
      const value = invoice as RecordValue;
      return {
        id: text(value.id, 36),
        invoiceNumber: text(value.invoice_number, 60),
        status: text(value.status, 24),
        amountDue: money(value.amount_due),
        amountPaid: money(value.amount_paid),
        currency: text(value.currency, 3) || "USD",
        dueAt: value.due_at ? String(value.due_at) : "",
        paidAt: value.paid_at ? String(value.paid_at) : "",
      };
    }),
    payments: payments.map((payment) => {
      const value = payment as RecordValue;
      return {
        id: text(value.id, 36),
        provider: text(value.provider, 32),
        transactionId: text(value.transaction_id, 200),
        providerReference: text(value.provider_reference, 200),
        amount: money(value.amount),
        currency: text(value.currency, 3) || "USD",
        status: text(value.status, 24),
        paidAt: value.payment_date ? String(value.payment_date) : "",
        createdAt: value.created_at ? String(value.created_at) : "",
      };
    }),
    subscriptions: subscriptions.map((subscription) => {
      const value = subscription as RecordValue;
      return {
        id: text(value.id, 36),
        status: text(value.status, 24),
        amount: money(value.amount),
        currency: text(value.currency, 3) || "USD",
        intervalUnit: text(value.interval_unit, 20),
        currentPeriodStart: value.current_period_start
          ? String(value.current_period_start)
          : "",
        currentPeriodEnd: value.current_period_end
          ? String(value.current_period_end)
          : "",
        cancelAtPeriodEnd: value.cancel_at_period_end === true,
      };
    }),
  };
};

/**
 * The overview tab: what sold, from where, and what still needs attention.
 * One round trip rather than a query per tile.
 */
export const getOrdersSummary = async (userId: string, days: number) => {
  const sql = database();
  const window = Math.min(365, Math.max(1, days || 30));
  const since = new Date(Date.now() - window * 24 * 60 * 60 * 1000).toISOString();

  const [totals, bySource, byStatus, trend, topProducts, currencies] =
    await Promise.all([
      sql.query(
        `SELECT COUNT(*)::int AS orders,
                COUNT(*) FILTER (WHERE status IN ('paid', 'partially_refunded', 'refunded'))::int AS settled,
                COUNT(*) FILTER (WHERE status IN ('draft', 'pending', 'processing'))::int AS open,
                COUNT(*) FILTER (WHERE status IN ('failed', 'cancelled'))::int AS lost,
                COALESCE(SUM(total_amount) FILTER (
                  WHERE status IN ('paid', 'partially_refunded', 'refunded')
                ), 0) AS gross,
                COALESCE(SUM(refunded_amount), 0) AS refunded,
                COALESCE(SUM(total_amount) FILTER (
                  WHERE status IN ('draft', 'pending', 'processing')
                ), 0) AS outstanding
         FROM payment_orders
         WHERE user_id = $1 AND created_at >= $2::timestamptz`,
        [userId, since],
      ),
      sql.query(
        `SELECT source_type,
                COUNT(*)::int AS orders,
                COALESCE(SUM(total_amount) FILTER (
                  WHERE status IN ('paid', 'partially_refunded', 'refunded')
                ), 0) AS gross
         FROM payment_orders
         WHERE user_id = $1 AND created_at >= $2::timestamptz
         GROUP BY source_type
         ORDER BY gross DESC`,
        [userId, since],
      ),
      sql.query(
        `SELECT status, COUNT(*)::int AS orders
         FROM payment_orders
         WHERE user_id = $1 AND created_at >= $2::timestamptz
         GROUP BY status`,
        [userId, since],
      ),
      sql.query(
        `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
                COUNT(*)::int AS orders,
                COALESCE(SUM(total_amount) FILTER (
                  WHERE status IN ('paid', 'partially_refunded', 'refunded')
                ), 0) AS gross
         FROM payment_orders
         WHERE user_id = $1 AND created_at >= $2::timestamptz
         GROUP BY 1
         ORDER BY 1`,
        [userId, since],
      ),
      sql.query(
        `SELECT item.name,
                COALESCE(NULLIF(item.sku, ''), '') AS sku,
                SUM(item.quantity)::int AS quantity,
                COALESCE(SUM(item.total_amount), 0) AS revenue
         FROM payment_order_items item
         JOIN payment_orders payment_order ON payment_order.id = item.order_id
         WHERE payment_order.user_id = $1
           AND payment_order.created_at >= $2::timestamptz
           AND payment_order.status IN ('paid', 'partially_refunded', 'refunded')
         GROUP BY item.name, COALESCE(NULLIF(item.sku, ''), '')
         ORDER BY revenue DESC
         LIMIT 10`,
        [userId, since],
      ),
      // A workspace can take more than one currency, and summing across them
      // would be meaningless. The client shows the dominant one and says so.
      sql.query(
        `SELECT currency, COUNT(*)::int AS orders
         FROM payment_orders
         WHERE user_id = $1 AND created_at >= $2::timestamptz
         GROUP BY currency
         ORDER BY orders DESC`,
        [userId, since],
      ),
    ]);

  const summary = (totals[0] || {}) as RecordValue;
  return {
    days: window,
    totals: {
      orders: count(summary.orders),
      settled: count(summary.settled),
      open: count(summary.open),
      lost: count(summary.lost),
      gross: money(summary.gross),
      refunded: money(summary.refunded),
      outstanding: money(summary.outstanding),
      net: money(money(summary.gross) - money(summary.refunded)),
    },
    bySource: bySource.map((row) => {
      const value = row as RecordValue;
      return {
        sourceType: text(value.source_type, 20),
        orders: count(value.orders),
        gross: money(value.gross),
      };
    }),
    byStatus: byStatus.map((row) => {
      const value = row as RecordValue;
      return { status: text(value.status, 24), orders: count(value.orders) };
    }),
    trend: trend.map((row) => {
      const value = row as RecordValue;
      return {
        day: text(value.day, 10),
        orders: count(value.orders),
        gross: money(value.gross),
      };
    }),
    topProducts: topProducts.map((row) => {
      const value = row as RecordValue;
      return {
        name: text(value.name, 200),
        sku: text(value.sku, 120),
        quantity: count(value.quantity),
        revenue: money(value.revenue),
      };
    }),
    currencies: currencies.map((row) => {
      const value = row as RecordValue;
      return {
        currency: text(value.currency, 3) || "USD",
        orders: count(value.orders),
      };
    }),
  };
};

/**
 * Everything sold in the window, paginated.
 *
 * The summary's `topProducts` is deliberately the leaderboard — ten rows, for
 * the overview's "best sellers" panel. The Items tab is the full catalogue of
 * what moved, so it gets its own query rather than being handed a truncated
 * list it would then present as complete.
 */
export const listOrderItems = async (
  userId: string,
  options: { days?: unknown; page?: unknown; pageSize?: unknown },
) => {
  const sql = database();
  const window = Math.min(365, Math.max(1, count(options.days) || 30));
  const since = new Date(Date.now() - window * 24 * 60 * 60 * 1000).toISOString();
  const page = Math.max(1, count(options.page) || 1);
  const pageSize = Math.min(200, Math.max(10, count(options.pageSize) || 50));

  const [rows, totals] = await Promise.all([
    sql.query(
      `SELECT item.name,
              COALESCE(NULLIF(item.sku, ''), '') AS sku,
              SUM(item.quantity)::int AS quantity,
              SUM(item.refunded_quantity)::int AS refunded_quantity,
              COALESCE(SUM(item.total_amount), 0) AS revenue,
              COUNT(DISTINCT item.order_id)::int AS orders
       FROM payment_order_items item
       JOIN payment_orders payment_order ON payment_order.id = item.order_id
       WHERE payment_order.user_id = $1
         AND payment_order.created_at >= $2::timestamptz
         AND payment_order.status IN ('paid', 'partially_refunded', 'refunded')
       GROUP BY item.name, COALESCE(NULLIF(item.sku, ''), '')
       ORDER BY revenue DESC, item.name
       LIMIT $3 OFFSET $4`,
      [userId, since, pageSize, (page - 1) * pageSize],
    ),
    sql.query(
      `SELECT COUNT(*)::int AS total
       FROM (
         SELECT 1
         FROM payment_order_items item
         JOIN payment_orders payment_order ON payment_order.id = item.order_id
         WHERE payment_order.user_id = $1
           AND payment_order.created_at >= $2::timestamptz
           AND payment_order.status IN ('paid', 'partially_refunded', 'refunded')
         GROUP BY item.name, COALESCE(NULLIF(item.sku, ''), '')
       ) grouped`,
      [userId, since],
    ),
  ]);

  const total = count((totals[0] as RecordValue | undefined)?.total);
  return {
    days: window,
    page,
    pageSize,
    total,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    items: rows.map((row) => {
      const value = row as RecordValue;
      return {
        name: text(value.name, 200),
        sku: text(value.sku, 120),
        quantity: count(value.quantity),
        refundedQuantity: count(value.refunded_quantity),
        revenue: money(value.revenue),
        orders: count(value.orders),
      };
    }),
  };
};

const orderIdList = (value: unknown) => {
  const ids = Array.isArray(value) ? value : [];
  const cleaned = [...new Set(ids.map((id) => text(id, 36)).filter(isUuid))];
  if (cleaned.length === 0) {
    throw new OrdersDataError("Select at least one order.");
  }
  if (cleaned.length > 200) {
    throw new OrdersDataError("Select 200 orders or fewer at a time.");
  }
  return cleaned;
};

/**
 * An order that took money is a financial record, and deleting one destroys
 * the trail a refund, a chargeback or an audit is reconciled against. Only
 * orders that never settled can be removed; the rest are refused by name so
 * the caller can see which ones and why.
 */
const DELETABLE_STATUSES = ["draft", "pending", "failed", "cancelled"];

/**
 * Hands back what an unsettled order was holding.
 *
 * A checkout decrements `payment_products.inventory_quantity` and writes a
 * `held` reservation row; the stock only comes back when something calls
 * `maxform_release_payment_inventory`. Every abandon path in checkout does.
 * Closing or removing an order here is the same kind of abandon, so it has to
 * as well — and for a delete it has to happen *first*, because the reservation
 * row is `ON DELETE CASCADE` and a deleted `held` row can never be swept.
 *
 * The coupon reservation goes back the same way, so a code that was never paid
 * for stops counting against its redemption limit immediately rather than
 * waiting out its hold.
 */
const releaseOrderHolds = async (
  sql: ReturnType<typeof database>,
  userId: string,
  orderIds: string[],
  statuses: string[],
  cause: string,
) => {
  await sql.query(
    `SELECT maxform_release_payment_inventory(payment_order.id, $4::text),
            maxform_release_payment_coupon(payment_order.id)
     FROM payment_orders payment_order
     WHERE payment_order.user_id = $1
       AND payment_order.id = ANY($2::uuid[])
       AND payment_order.status = ANY($3::text[])`,
    [userId, orderIds, statuses, cause],
  );
};

export const deleteOrders = async (userId: string, ids: unknown) => {
  const orderIds = orderIdList(ids);
  const sql = database();
  const blocked = await sql.query(
    `SELECT order_number, status FROM payment_orders
     WHERE user_id = $1 AND id = ANY($2::uuid[]) AND NOT (status = ANY($3::text[]))
     ORDER BY order_number
     LIMIT 5`,
    [userId, orderIds, DELETABLE_STATUSES],
  );
  if (blocked.length > 0) {
    const names = blocked
      .map((row) => text((row as RecordValue).order_number, 60))
      .filter(Boolean)
      .join(", ");
    throw new OrdersDataError(
      `An order that has taken payment cannot be deleted: ${names}. Refund it in Payments instead — the record is what a refund or chargeback is reconciled against.`,
      409,
      "order_settled",
    );
  }
  // Before the rows go: the items cascade on their own, but stock and coupons
  // are counters elsewhere that a cascade would leave overstated.
  await releaseOrderHolds(
    sql,
    userId,
    orderIds,
    DELETABLE_STATUSES,
    "order_deleted",
  );
  const removed = await sql.query(
    `DELETE FROM payment_orders
     WHERE user_id = $1 AND id = ANY($2::uuid[]) AND status = ANY($3::text[])
     RETURNING id`,
    [userId, orderIds, DELETABLE_STATUSES],
  );
  return { deleted: removed.length };
};

/** Closes an unpaid order without destroying it. The reversible alternative. */
export const cancelOrders = async (userId: string, ids: unknown) => {
  const orderIds = orderIdList(ids);
  const sql = database();
  const updated = await sql.query(
    `UPDATE payment_orders
     SET status = 'cancelled', updated_at = NOW()
     WHERE user_id = $1 AND id = ANY($2::uuid[])
       AND status IN ('draft', 'pending', 'processing')
     RETURNING id`,
    [userId, orderIds],
  );
  // Released against what the update actually closed rather than what was
  // asked for: an order that settled in between is not in this list, and its
  // stock stays consumed.
  const cancelledIds = updated
    .map((row) => text((row as RecordValue).id, 36))
    .filter(Boolean);
  if (cancelledIds.length > 0) {
    await releaseOrderHolds(
      sql,
      userId,
      cancelledIds,
      ["cancelled"],
      "order_cancelled",
    );
  }
  return { cancelled: updated.length };
};

/** The selected orders as CSV, for a spreadsheet or an accountant. */
export const exportOrders = async (userId: string, ids: unknown) => {
  const orderIds = orderIdList(ids);
  const sql = database();
  const rows = await sql.query(
    `SELECT payment_order.order_number, payment_order.source_type,
            ${sourceLabelExpression} AS source_label,
            payment_order.customer_name, payment_order.customer_email,
            payment_order.status, payment_order.provider,
            payment_order.currency, payment_order.subtotal,
            payment_order.discount_amount, payment_order.tax_amount,
            payment_order.shipping_amount, payment_order.total_amount,
            payment_order.refunded_amount, payment_order.paid_at,
            payment_order.created_at
     FROM payment_orders payment_order
     ${sourceLabelJoins}
     WHERE payment_order.user_id = $1 AND payment_order.id = ANY($2::uuid[])
     ORDER BY payment_order.created_at DESC`,
    [userId, orderIds],
  );
  return {
    rows: rows.map((row) => {
      const value = row as RecordValue;
      return {
        orderNumber: text(value.order_number, 60),
        source: text(value.source_type, 20),
        sourceLabel: text(value.source_label, 200),
        customerName: text(value.customer_name, 200),
        customerEmail: text(value.customer_email, 320),
        status: text(value.status, 24),
        provider: text(value.provider, 32),
        currency: text(value.currency, 3) || "USD",
        subtotal: money(value.subtotal),
        discount: money(value.discount_amount),
        tax: money(value.tax_amount),
        shipping: money(value.shipping_amount),
        total: money(value.total_amount),
        refunded: money(value.refunded_amount),
        paidAt: value.paid_at ? String(value.paid_at) : "",
        createdAt: value.created_at ? String(value.created_at) : "",
      };
    }),
  };
};

export async function handleOrdersData(
  request: IncomingMessage,
  response: ServerResponse,
) {
  try {
    const userId = await authenticatedUserId(request);
    const url = new URL(request.url || "/", "http://localhost");
    const action = url.searchParams.get("action") || "list";

    if (request.method === "POST") {
      const body = await readBody(request);
      if (action === "delete") {
        json(response, 200, await deleteOrders(userId, body.ids));
        return;
      }
      if (action === "cancel") {
        json(response, 200, await cancelOrders(userId, body.ids));
        return;
      }
      if (action === "export") {
        json(response, 200, await exportOrders(userId, body.ids));
        return;
      }
      json(response, 404, { error: "This orders action is not available." });
      return;
    }
    if (request.method !== "GET") {
      json(response, 405, { error: "This orders action is not available." });
      return;
    }

    if (action === "list") {
      json(
        response,
        200,
        await listOrders(userId, {
          source: url.searchParams.get("source"),
          status: url.searchParams.get("status"),
          search: url.searchParams.get("search"),
          from: url.searchParams.get("from"),
          to: url.searchParams.get("to"),
          page: url.searchParams.get("page"),
          pageSize: url.searchParams.get("pageSize"),
        }),
      );
      return;
    }
    if (action === "detail") {
      json(
        response,
        200,
        await getOrderDetail(userId, text(url.searchParams.get("orderId"), 36)),
      );
      return;
    }
    if (action === "items") {
      json(
        response,
        200,
        await listOrderItems(userId, {
          days: url.searchParams.get("days"),
          page: url.searchParams.get("page"),
          pageSize: url.searchParams.get("pageSize"),
        }),
      );
      return;
    }
    if (action === "summary") {
      json(response, 200, {
        summary: await getOrdersSummary(
          userId,
          count(url.searchParams.get("days")) || 30,
        ),
      });
      return;
    }
    json(response, 404, { error: "This orders action is not available." });
  } catch (error) {
    if (error instanceof OrdersDataError) {
      json(response, error.status, { error: error.message, code: error.code });
      return;
    }
    json(response, 500, {
      error: "Orders could not be loaded. Please try again.",
      code: "orders_failed",
    });
  }
}

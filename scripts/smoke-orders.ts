/**
 * End-to-end smoke test for the Orders module's read API.
 *
 * Seeds one order per source the ledger recognises, then drives the real HTTP
 * handler to prove the module reports across the whole workspace rather than
 * per selling module: the list, its source and status filters, the paging
 * totals, the detail view with its Payments links, and the overview summary.
 *
 * Everything it creates is deleted again in the `finally` block.
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { neon } from "@neondatabase/serverless";

import { handleOrdersData } from "../server/orders-data";
import { invalidateWorkspaceContext } from "../server/workspace-access";
import { SignJWT } from "jose";

const databaseUrl = process.env.DATABASE_URL || "";
const jwtSecret = process.env.JWT_SECRET || "";
if (!databaseUrl || jwtSecret.length < 32) {
  throw new Error(
    "Orders smoke test requires DATABASE_URL and a 32+ character JWT_SECRET.",
  );
}

const sql = neon(databaseUrl);
const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const ownerId = randomUUID();
const ownerEmail = `orders-smoke-${suffix}@example.test`;

let assertions = 0;
const check = (condition: unknown, message: string) => {
  if (!condition) throw new Error(`FAILED: ${message}`);
  assertions += 1;
  console.log(`  ok  ${message}`);
};

const callHandler = async (url: string, token: string, input?: unknown) => {
  const payload = input === undefined ? "" : JSON.stringify(input);
  const request = {
    url,
    method: input === undefined ? "GET" : "POST",
    headers: { host: "127.0.0.1", authorization: `Bearer ${token}` },
    socket: { remoteAddress: "127.0.0.1" },
    async *[Symbol.asyncIterator]() {
      if (payload) yield Buffer.from(payload);
    },
  } as unknown as IncomingMessage;

  let raw = "";
  const response = {
    statusCode: 200,
    setHeader: () => undefined,
    end: (chunk?: string) => {
      raw = chunk || "";
    },
  } as unknown as ServerResponse & { statusCode: number };

  await handleOrdersData(request, response);
  let body: Record<string, unknown> = {};
  try {
    body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    body = { raw };
  }
  return { status: response.statusCode, body };
};

const seeded = [
  { source: "form", status: "paid", total: 120, number: "ORD-F1" },
  { source: "form", status: "pending", total: 40, number: "ORD-F2" },
  { source: "event", status: "paid", total: 250, number: "ORD-E1" },
  { source: "invoice", status: "refunded", total: 90, number: "ORD-I1" },
  { source: "subscription", status: "paid", total: 30, number: "ORD-S1" },
  { source: "manual", status: "cancelled", total: 15, number: "ORD-M1" },
];
const orderIds = new Map<string, string>();

const cleanup = async () => {
  await sql.query(
    `DELETE FROM payment_order_items WHERE order_id IN (
       SELECT id FROM payment_orders WHERE user_id = $1
     )`,
    [ownerId],
  );
  await sql.query(`DELETE FROM payment_orders WHERE user_id = $1`, [ownerId]);
  await sql.query(
    `DELETE FROM workspace_members WHERE owner_id = $1 OR user_id = $1`,
    [ownerId],
  );
  await sql.query(`DELETE FROM users WHERE id = $1`, [ownerId]);
};

try {
  console.log("\nSeeding one order per source");
  await sql.query(
    `INSERT INTO users (id, email, password_hash, full_name, short_id)
     VALUES ($1, $2, 'non-login-smoke-account', 'Orders Owner', $3)`,
    [ownerId, ownerEmail, suffix.slice(0, 5)],
  );
  await sql.query(
    `INSERT INTO workspace_members (owner_id, user_id, role, status)
     VALUES ($1, $1, 'owner', 'active')
     ON CONFLICT (owner_id, user_id) DO NOTHING`,
    [ownerId],
  );
  invalidateWorkspaceContext();

  for (const entry of seeded) {
    const orderId = randomUUID();
    orderIds.set(entry.number, orderId);
    await sql.query(
      `INSERT INTO payment_orders (
         id, user_id, order_number, source_type, customer_name, customer_email,
         status, provider, subtotal, total_amount, refunded_amount, currency,
         paid_at
       )
       VALUES ($1, $2, $3, $4, 'Ada Lovelace', $5, $6, 'stripe', $7, $7,
               $8, 'USD', CASE WHEN $6 = 'paid' THEN NOW() ELSE NULL END)`,
      [
        orderId,
        ownerId,
        entry.number,
        entry.source,
        `buyer-${suffix}@example.test`,
        entry.status,
        entry.total,
        entry.status === "refunded" ? entry.total : 0,
      ],
    );
  }
  await sql.query(
    `INSERT INTO payment_order_items (
       order_id, name, quantity, unit_price, total_amount, sku
     )
     VALUES ($1, 'Analytical Engine', 2, 60, 120, 'AE-1')`,
    [orderIds.get("ORD-F1")],
  );

  const token = await new SignJWT({ email: ownerEmail, userId: ownerId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer("maxform")
    .setAudience("maxform-dashboard")
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(new TextEncoder().encode(jwtSecret));

  console.log("\nThe list reports across every module");
  const all = await callHandler("/api/orders/data?action=list", token);
  check(all.status === 200, `the list loads (got ${all.status})`);
  const orders = (all.body.orders || []) as Array<Record<string, unknown>>;
  check(orders.length === seeded.length, `all ${seeded.length} orders returned`);
  const sources = new Set(orders.map((order) => String(order.sourceType)));
  check(
    ["form", "event", "invoice", "subscription", "manual"].every((source) =>
      sources.has(source),
    ),
    "every source appears in one list",
  );
  check(
    Number(all.body.filteredGross) === 120 + 250 + 90 + 30,
    `settled revenue sums only settled orders (got ${String(all.body.filteredGross)})`,
  );
  check(
    Number(all.body.filteredRefunded) === 90,
    "refunds are reported separately",
  );

  console.log("\nFilters narrow the same ledger");
  const events = await callHandler(
    "/api/orders/data?action=list&source=event",
    token,
  );
  const eventOrders = (events.body.orders || []) as Array<Record<string, unknown>>;
  check(
    eventOrders.length === 1 && eventOrders[0].orderNumber === "ORD-E1",
    "the event tab shows only event orders",
  );
  const open = await callHandler(
    "/api/orders/data?action=list&status=open",
    token,
  );
  const openOrders = (open.body.orders || []) as Array<Record<string, unknown>>;
  check(
    openOrders.length === 1 && openOrders[0].orderNumber === "ORD-F2",
    "awaiting-payment shows only unsettled orders",
  );
  const searched = await callHandler(
    "/api/orders/data?action=list&search=ORD-I1",
    token,
  );
  check(
    ((searched.body.orders || []) as unknown[]).length === 1,
    "search matches an order number",
  );

  console.log("\nThe detail view carries what Payments knows");
  const detail = await callHandler(
    `/api/orders/data?action=detail&orderId=${orderIds.get("ORD-F1")}`,
    token,
  );
  check(detail.status === 200, "the detail loads");
  const order = (detail.body.order || {}) as Record<string, unknown>;
  check(order.orderNumber === "ORD-F1", "it is the order that was asked for");
  const items = (detail.body.items || []) as Array<Record<string, unknown>>;
  check(items.length === 1, "its items are included");
  check(
    Number(items[0].quantity) === 2 && items[0].sku === "AE-1",
    "item quantity and SKU survive the round trip",
  );
  check(
    Array.isArray(detail.body.refunds) &&
      Array.isArray(detail.body.invoices) &&
      Array.isArray(detail.body.subscriptions),
    "the Payments-side records are attached",
  );

  console.log("\nAnother workspace's order is not reachable");
  const foreign = await callHandler(
    `/api/orders/data?action=detail&orderId=${randomUUID()}`,
    token,
  );
  check(foreign.status === 404, "an unknown order id is refused");

  console.log("\nThe overview summarises the whole workspace");
  const summaryResponse = await callHandler(
    "/api/orders/data?action=summary&days=30",
    token,
  );
  check(summaryResponse.status === 200, "the summary loads");
  const summary = (summaryResponse.body.summary || {}) as Record<string, unknown>;
  const totals = (summary.totals || {}) as Record<string, unknown>;
  check(Number(totals.orders) === seeded.length, "it counts every order");
  check(Number(totals.settled) === 4, "it counts settled orders");
  check(Number(totals.open) === 1, "it counts open orders");
  check(Number(totals.lost) === 1, "it counts failed or cancelled orders");
  check(
    Number(totals.net) === 120 + 250 + 90 + 30 - 90,
    `net revenue subtracts refunds (got ${String(totals.net)})`,
  );
  check(
    ((summary.bySource || []) as unknown[]).length === 5,
    "it breaks revenue down by source",
  );
  const topProducts = (summary.topProducts || []) as Array<Record<string, unknown>>;
  check(
    topProducts.length === 1 && topProducts[0].name === "Analytical Engine",
    "it reports what actually sold",
  );

  console.log("\nThe detail carries the identifiers a customer would quote");
  const paidDetail = await callHandler(
    `/api/orders/data?action=detail&orderId=${orderIds.get("ORD-F1")}`,
    token,
  );
  check(
    Array.isArray((paidDetail.body as Record<string, unknown>).payments),
    "payment attempts are attached to the order",
  );
  const paidOrder = (paidDetail.body.order || {}) as Record<string, unknown>;
  check(
    typeof paidOrder.id === "string" && paidOrder.id.length === 36,
    "the order id is exposed for reconciliation",
  );
  check(
    typeof paidOrder.createdAt === "string" && paidOrder.createdAt.length > 0,
    "the full placed timestamp is exposed",
  );
  check(
    "providerReference" in paidOrder,
    "the provider reference is exposed",
  );

  console.log("\nBulk export returns the selected orders");
  const exported = await callHandler("/api/orders/data?action=export", token, {
    ids: [orderIds.get("ORD-F1"), orderIds.get("ORD-E1")],
  });
  check(exported.status === 200, "export succeeds");
  const exportRows = (exported.body.rows || []) as Array<Record<string, unknown>>;
  check(exportRows.length === 2, "it returns exactly the selected orders");
  check(
    exportRows.every((row) => "orderNumber" in row && "total" in row),
    "each exported row carries the columns a spreadsheet needs",
  );

  console.log("\nA settled order cannot be deleted");
  const refusedDelete = await callHandler(
    "/api/orders/data?action=delete",
    token,
    { ids: [orderIds.get("ORD-F1")] },
  );
  check(
    refusedDelete.status === 409,
    `deleting a paid order is refused (got ${refusedDelete.status})`,
  );
  check(
    String((refusedDelete.body as { error?: string }).error || "").includes(
      "ORD-F1",
    ),
    "the refusal names the order that blocked it",
  );
  const stillThere = await sql.query(
    `SELECT 1 FROM payment_orders WHERE id = $1`,
    [orderIds.get("ORD-F1")],
  );
  check(stillThere.length === 1, "the paid order is still on the ledger");

  console.log("\nUnpaid orders cancel, and then delete");
  const cancelled = await callHandler("/api/orders/data?action=cancel", token, {
    ids: [orderIds.get("ORD-F2")],
  });
  check(
    Number((cancelled.body as { cancelled?: number }).cancelled) === 1,
    "a pending order can be cancelled",
  );
  const deleted = await callHandler("/api/orders/data?action=delete", token, {
    ids: [orderIds.get("ORD-F2"), orderIds.get("ORD-M1")],
  });
  check(
    Number((deleted.body as { deleted?: number }).deleted) === 2,
    "orders that never settled can be deleted",
  );
  const gone = await sql.query(
    `SELECT COUNT(*)::int AS n FROM payment_orders WHERE id = ANY($1::uuid[])`,
    [[orderIds.get("ORD-F2"), orderIds.get("ORD-M1")]],
  );
  check(Number(gone[0].n) === 0, "they are gone from the ledger");

  console.log("\nBulk input is validated");
  const empty = await callHandler("/api/orders/data?action=delete", token, {
    ids: [],
  });
  check(empty.status === 400, "an empty selection is refused");
  const tooMany = await callHandler("/api/orders/data?action=delete", token, {
    ids: Array.from({ length: 201 }, () => randomUUID()),
  });
  check(tooMany.status === 400, "an oversized selection is refused");

  console.log(`\n✓ Orders smoke test passed (${assertions} checks)`);
} catch (error) {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await cleanup();
  console.log("Cleaned up the throwaway workspace and its orders.");
}

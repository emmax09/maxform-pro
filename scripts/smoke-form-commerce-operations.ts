import { randomUUID } from "node:crypto";

import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL || "";
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const sql = neon(databaseUrl);
const suffix = Date.now().toString(36).toUpperCase();
const users = await sql`SELECT id FROM users ORDER BY created_at LIMIT 1`;
const userId = String(users[0]?.id || "");
if (!userId) throw new Error("A test workspace user is required.");

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const variantProductId = randomUUID();
const variantId = randomUUID();
const idempotentOrderId = randomUUID();
const raceProductId = randomUUID();
const raceVariantId = randomUUID();
const raceOrderIds = Array.from({ length: 20 }, () => randomUUID());
const refundProductId = randomUUID();
const refundOrderId = randomUUID();
const refundItemId = randomUUID();
const refundId = randomUUID();
const cleanupOrderIds = [idempotentOrderId, refundOrderId, ...raceOrderIds];

try {
  await sql`
    INSERT INTO payment_products (
      id, user_id, name, sku, price, currency, billing_type, source_type,
      active, track_inventory, inventory_quantity, low_stock_threshold,
      allow_backorder, restock_on_refund
    ) VALUES (
      ${variantProductId}, ${userId}, ${`Ops smoke ${suffix}`},
      ${`OPS-${suffix}`}, 25, 'USD', 'one_time', 'catalog', TRUE, FALSE, 0,
      2, FALSE, TRUE
    ), (
      ${raceProductId}, ${userId}, ${`Race smoke ${suffix}`},
      ${`RACE-${suffix}`}, 10, 'USD', 'one_time', 'catalog', TRUE, FALSE, 0,
      2, FALSE, TRUE
    ), (
      ${refundProductId}, ${userId}, ${`Refund smoke ${suffix}`},
      ${`REF-${suffix}`}, 10, 'USD', 'one_time', 'catalog', TRUE, TRUE, 0,
      1, FALSE, TRUE
    )
  `;
  await sql`
    INSERT INTO payment_product_variants (
      id, product_id, name, sku, price, option_values, track_inventory,
      inventory_quantity, low_stock_threshold, allow_backorder, active
    ) VALUES
      (
        ${variantId}, ${variantProductId}, 'Black / Large', ${`OPS-${suffix}-BL`},
        29, ${JSON.stringify({ Color: "Black", Size: "Large" })}::jsonb,
        TRUE, 5, 2, FALSE, TRUE
      ), (
        ${raceVariantId}, ${raceProductId}, 'Default', ${`RACE-${suffix}-D`},
        10, '{}'::jsonb, TRUE, 10, 2, FALSE, TRUE
      )
  `;
  await sql`
    INSERT INTO payment_orders (
      id, user_id, order_number, source_type, status, subtotal, total_amount,
      currency, provider, provider_reference
    ) VALUES
      (${idempotentOrderId}, ${userId}, ${`OPS-${suffix}`}, 'manual', 'pending', 58, 58, 'USD', NULL, ''),
      (${refundOrderId}, ${userId}, ${`REF-${suffix}`}, 'manual', 'paid', 20, 20, 'USD', 'paystack', ${`REF-PAY-${suffix}`})
  `;
  for (const [index, orderId] of raceOrderIds.entries()) {
    await sql`
      INSERT INTO payment_orders (
        id, user_id, order_number, source_type, status, subtotal, total_amount,
        currency
      ) VALUES (
        ${orderId}, ${userId}, ${`RACE-${suffix}-${index}`}, 'manual', 'pending', 10, 10, 'USD'
      )
    `;
  }
  await sql`
    INSERT INTO payment_order_items (
      id, order_id, product_id, name, quantity, unit_price, total_amount
    ) VALUES (
      ${refundItemId}, ${refundOrderId}, ${refundProductId}, 'Refundable item',
      2, 10, 20
    )
  `;

  const requested = JSON.stringify([{ productId: variantProductId, variantId, quantity: 2 }]);
  await sql`
    SELECT maxform_reserve_payment_inventory(
      ${idempotentOrderId}::uuid, ${requested}::jsonb, 30
    )
  `;
  await sql`
    SELECT maxform_reserve_payment_inventory(
      ${idempotentOrderId}::uuid, ${requested}::jsonb, 30
    )
  `;
  const repeated = await sql`
    SELECT inventory_quantity FROM payment_product_variants WHERE id = ${variantId}
  `;
  assert(Number(repeated[0]?.inventory_quantity) === 3, "Repeated reserve double-decremented stock.");
  await sql`
    SELECT maxform_reserve_payment_inventory(
      ${idempotentOrderId}::uuid,
      ${JSON.stringify([{ productId: variantProductId, variantId, quantity: 4 }])}::jsonb,
      30
    )
  `;
  const resized = await sql`
    SELECT inventory_quantity FROM payment_product_variants WHERE id = ${variantId}
  `;
  assert(Number(resized[0]?.inventory_quantity) === 1, "Reservation resize did not apply the delta only.");
  await sql`SELECT maxform_release_payment_inventory(${idempotentOrderId}::uuid, 'smoke')`;
  const released = await sql`
    SELECT inventory_quantity FROM payment_product_variants WHERE id = ${variantId}
  `;
  assert(Number(released[0]?.inventory_quantity) === 5, "Reservation release did not restore stock.");

  const raceResults = await Promise.all(
    raceOrderIds.map((orderId) =>
      sql`
        SELECT maxform_reserve_payment_inventory(
          ${orderId}::uuid,
          ${JSON.stringify([{ productId: raceProductId, variantId: raceVariantId, quantity: 1 }])}::jsonb,
          30
        ) AS reserved
      `.then((rows) => rows[0]?.reserved === true)
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          if (!message.includes("Product is out of stock")) {
            console.warn("[form-commerce-operations-smoke] reservation rejected", message);
          }
          return false;
        }),
    ),
  );
  const raceSuccessCount = raceResults.filter(Boolean).length;
  assert(raceSuccessCount === 10, `Concurrent reservations did not allocate exactly ten units (${raceSuccessCount} succeeded).`);
  const raceStock = await sql`
    SELECT inventory_quantity FROM payment_product_variants WHERE id = ${raceVariantId}
  `;
  assert(Number(raceStock[0]?.inventory_quantity) === 0, "Concurrent reservation stock balance is incorrect.");
  assert(Number(raceStock[0]?.inventory_quantity) >= 0, "Inventory became negative.");

  await sql`
    SELECT maxform_adjust_payment_inventory(
      ${userId}::uuid, ${variantProductId}::uuid, ${variantId}::uuid,
      -3, 'Smoke sale', ${`ops-sale-${suffix}`}
    )
  `;
  const alertRows = await sql`
    SELECT id, status FROM payment_inventory_alerts
    WHERE product_id = ${variantProductId} AND variant_id = ${variantId}
    ORDER BY created_at DESC LIMIT 1
  `;
  assert(alertRows[0]?.status === "open", "Low-stock alert was not created.");
  await sql`
    SELECT maxform_acknowledge_payment_inventory_alert(
      ${userId}::uuid, ${String(alertRows[0]?.id)}::uuid
    )
  `;
  await sql`
    SELECT maxform_adjust_payment_inventory(
      ${userId}::uuid, ${variantProductId}::uuid, ${variantId}::uuid,
      10, 'Smoke restock', ${`ops-restock-${suffix}`}
    )
  `;
  const resolvedAlert = await sql`
    SELECT status FROM payment_inventory_alerts WHERE id = ${String(alertRows[0]?.id)}
  `;
  assert(resolvedAlert[0]?.status === "resolved", "Restock did not resolve the low-stock alert.");
  await sql`
    SELECT maxform_set_payment_inventory(
      ${userId}::uuid, ${variantProductId}::uuid, ${variantId}::uuid,
      7, 'Smoke absolute stock update', ${`ops-set-${suffix}`}
    )
  `;
  const setStock = await sql`
    SELECT inventory_quantity FROM payment_product_variants WHERE id = ${variantId}
  `;
  assert(Number(setStock[0]?.inventory_quantity) === 7, "Absolute stock update did not set the requested balance.");

  const refundItems = JSON.stringify([{ orderItemId: refundItemId, quantity: 2 }]);
  const refundReserved = await sql`
    SELECT maxform_reserve_payment_refund(
      ${userId}::uuid, ${refundOrderId}::uuid, ${refundId}::uuid,
      ${randomUUID()}::uuid, 20, 'Customer requested a return',
      ${refundItems}::jsonb, TRUE
    ) AS reserved
  `;
  assert(refundReserved[0]?.reserved === true, "Refund inventory allocation was not reserved.");
  await sql`
    UPDATE payment_refunds SET status = 'succeeded', completed_at = NOW()
    WHERE id = ${refundId}
  `;
  const firstRestock = await sql`
    SELECT maxform_restock_payment_inventory(${refundId}::uuid) AS restored
  `;
  const secondRestock = await sql`
    SELECT maxform_restock_payment_inventory(${refundId}::uuid) AS restored
  `;
  const restoredStock = await sql`
    SELECT inventory_quantity FROM payment_products WHERE id = ${refundProductId}
  `;
  const ledgerRows = await sql`
    SELECT COUNT(*)::int AS count FROM payment_inventory_ledger
    WHERE refund_id = ${refundId} AND reason = 'refund_restock'
  `;
  assert(Number(firstRestock[0]?.restored) === 2, "Successful refund did not restock inventory.");
  assert(Number(secondRestock[0]?.restored) === 0, "Refund restock was not idempotent.");
  assert(Number(restoredStock[0]?.inventory_quantity) === 2, "Restocked inventory balance is incorrect.");
  assert(Number(ledgerRows[0]?.count) === 1, "Refund restock ledger duplicated its movement.");

  console.log("[form-commerce-operations-smoke] passed", {
    concurrentSuccessfulReservations: raceSuccessCount,
    idempotentReserveStock: Number(repeated[0]?.inventory_quantity),
    refundedUnitsRestocked: Number(firstRestock[0]?.restored),
  });
} finally {
  await sql`DELETE FROM payment_orders WHERE id = ANY(${cleanupOrderIds}::uuid[])`.catch(() => undefined);
  await sql`DELETE FROM payment_products WHERE id = ANY(${[variantProductId, raceProductId, refundProductId]}::uuid[])`.catch(() => undefined);
}

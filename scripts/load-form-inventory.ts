import { randomUUID } from "node:crypto";

import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL || "";
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const requestedConcurrency = Math.floor(Number(process.env.FORM_LOAD_CONCURRENCY || 50));
const concurrency = Math.max(2, Math.min(500, Number.isFinite(requestedConcurrency) ? requestedConcurrency : 50));
const requestedStock = Math.floor(Number(process.env.FORM_LOAD_STOCK || Math.ceil(concurrency / 2)));
const stock = Math.max(1, Math.min(concurrency, Number.isFinite(requestedStock) ? requestedStock : Math.ceil(concurrency / 2)));
const sql = neon(databaseUrl);
const suffix = Date.now().toString(36).toUpperCase();
const productId = randomUUID();
const variantId = randomUUID();
const orderIds = Array.from({ length: concurrency }, () => randomUUID());

const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const users = await sql`SELECT id FROM users ORDER BY created_at LIMIT 1`;
const userId = String(users[0]?.id || "");
if (!userId) throw new Error("A test workspace user is required.");

try {
  await sql`
    INSERT INTO payment_products (
      id, user_id, name, sku, price, currency, billing_type, source_type,
      active, track_inventory, inventory_quantity, low_stock_threshold,
      allow_backorder, restock_on_refund
    ) VALUES (
      ${productId}, ${userId}, ${`Load smoke ${suffix}`}, ${`LOAD-${suffix}`},
      1, 'USD', 'one_time', 'catalog', TRUE, FALSE, 0, 1, FALSE, TRUE
    )
  `;
  await sql`
    INSERT INTO payment_product_variants (
      id, product_id, name, sku, price, option_values, track_inventory,
      inventory_quantity, low_stock_threshold, allow_backorder, active
    ) VALUES (
      ${variantId}, ${productId}, 'Load variant', ${`LOAD-${suffix}-V`}, 1,
      '{}'::jsonb, TRUE, ${stock}, 1, FALSE, TRUE
    )
  `;
  for (const [index, orderId] of orderIds.entries()) {
    await sql`
      INSERT INTO payment_orders (
        id, user_id, order_number, source_type, status, subtotal, total_amount,
        currency, provider
      ) VALUES (
        ${orderId}, ${userId}, ${`LOAD-${suffix}-${index}`}, 'manual', 'pending',
        1, 1, 'USD', 'paystack'
      )
    `;
  }

  const results = await Promise.all(
    orderIds.map((orderId) =>
      sql`
        SELECT maxform_reserve_payment_inventory(
          ${orderId}::uuid,
          ${JSON.stringify([{ productId, variantId, quantity: 1 }])}::jsonb,
          30
        ) AS reserved
      `.then((rows) => rows[0]?.reserved === true)
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          if (!/out of stock|inventory/i.test(message)) throw error;
          return false;
        }),
    ),
  );
  const successful = results.filter(Boolean).length;
  const rows = await sql`
    SELECT inventory_quantity FROM payment_product_variants WHERE id = ${variantId}
  `;
  const remaining = Number(rows[0]?.inventory_quantity || 0);
  assert(successful === stock, `Expected ${stock} reservations, got ${successful}.`);
  assert(remaining === 0, `Expected zero remaining stock, got ${remaining}.`);
  assert(remaining >= 0, "Inventory became negative.");

  const held = await sql`
    SELECT COUNT(*)::integer AS count
    FROM payment_inventory_reservations
    WHERE product_id = ${productId} AND status = 'held'
  `;
  assert(Number(held[0]?.count || 0) === successful, "Held reservation count is inconsistent.");

  console.log("[form-inventory-load] passed", {
    concurrency,
    successful,
    rejected: concurrency - successful,
    remaining,
  });
} finally {
  await sql`DELETE FROM payment_orders WHERE id = ANY(${orderIds}::uuid[])`.catch(() => undefined);
  await sql`DELETE FROM payment_products WHERE id = ${productId}`.catch(() => undefined);
}

import { randomUUID } from "node:crypto";

import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL || "";
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const sql = neon(databaseUrl);
const productId = randomUUID();
const variantId = randomUUID();
const orderId = randomUUID();
const suffix = Date.now().toString(36).toUpperCase();

try {
  const users = await sql`SELECT id FROM users ORDER BY created_at LIMIT 1`;
  const userId = String(users[0]?.id || "");
  if (!userId) throw new Error("A test workspace user is required.");

  await sql`
    INSERT INTO payment_products (
      id, user_id, name, sku, price, currency, billing_type, source_type,
      active, track_inventory, inventory_quantity
    ) VALUES (
      ${productId}, ${userId}, ${`Commerce smoke ${suffix}`},
      ${`SMOKE-${suffix}`}, 25, 'USD', 'one_time', 'catalog', TRUE, FALSE, 0
    )
  `;
  await sql`
    INSERT INTO payment_product_variants (
      id, product_id, name, sku, price, option_values, track_inventory,
      inventory_quantity, low_stock_threshold, allow_backorder, active
    ) VALUES (
      ${variantId}, ${productId}, 'Black / Large', ${`SMOKE-${suffix}-BLK-L`},
      29, ${JSON.stringify({ Color: "Black", Size: "Large" })}::jsonb,
      TRUE, 5, 2, FALSE, TRUE
    )
  `;
  await sql`
    INSERT INTO payment_orders (
      id, user_id, order_number, source_type, status, subtotal, total_amount,
      currency
    ) VALUES (
      ${orderId}, ${userId}, ${`SMOKE-${suffix}`}, 'manual', 'pending', 58, 58,
      'USD'
    )
  `;
  const reserved = await sql`
    SELECT maxform_reserve_payment_inventory(
      ${orderId}::uuid,
      ${JSON.stringify([{ productId, variantId, quantity: 2 }])}::jsonb,
      30
    ) AS reserved
  `;
  if (reserved[0]?.reserved !== true) throw new Error("Inventory was not reserved.");
  const afterReserve = await sql`
    SELECT inventory_quantity FROM payment_product_variants WHERE id = ${variantId}
  `;
  if (Number(afterReserve[0]?.inventory_quantity) !== 3) {
    throw new Error("Reserved stock was not deducted atomically.");
  }

  await sql`SELECT maxform_release_payment_inventory(${orderId}::uuid)`;
  const afterRelease = await sql`
    SELECT inventory_quantity FROM payment_product_variants WHERE id = ${variantId}
  `;
  if (Number(afterRelease[0]?.inventory_quantity) !== 5) {
    throw new Error("Released stock was not restored.");
  }

  console.log("[form-commerce-smoke] passed", {
    initialStock: 5,
    reservedStock: 3,
    restoredStock: 5,
  });
} finally {
  await sql`DELETE FROM payment_orders WHERE id = ${orderId}`.catch(() => undefined);
  await sql`DELETE FROM payment_products WHERE id = ${productId}`.catch(() => undefined);
}

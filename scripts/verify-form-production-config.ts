import { neon } from "@neondatabase/serverless";

let failures = 0;
const check = (condition: unknown, message: string) => {
  if (!condition) failures += 1;
  console.log(`${condition ? "ok  " : "FAIL"} ${message}`);
};

check(process.env.NODE_ENV === "production", "NODE_ENV is production");
check(
  String(process.env.PAYMENT_MODE || "").toLowerCase() === "live",
  "PAYMENT_MODE is live",
);

const databaseUrl = String(process.env.DATABASE_URL || "").trim();
const jwtSecret = String(process.env.JWT_SECRET || "").trim();
const encryptionKey = String(
  process.env.PAYMENT_ENCRYPTION_KEY || process.env.INTEGRATION_ENCRYPTION_KEY || "",
).trim();
check(Boolean(databaseUrl), "DATABASE_URL is configured");
check(jwtSecret.length >= 32, "JWT_SECRET is at least 32 characters");
check(encryptionKey.length >= 24, "payment encryption is configured");

const origin = String(process.env.PUBLIC_APP_URL || "").trim();
let parsedOrigin: URL | null = null;
try {
  parsedOrigin = new URL(origin);
} catch {
  parsedOrigin = null;
}
const hostname = parsedOrigin?.hostname.toLowerCase() || "";
const temporaryHost = /(?:ngrok|loca\.lt|trycloudflare|localtunnel)/i.test(hostname);
check(Boolean(parsedOrigin && parsedOrigin.protocol === "https:"), "PUBLIC_APP_URL uses HTTPS");
check(
  Boolean(
    hostname &&
      !temporaryHost &&
      !["localhost", "127.0.0.1", "::1"].includes(hostname),
  ),
  "PUBLIC_APP_URL is a stable deployment origin",
);

if (databaseUrl) {
  try {
    const sql = neon(databaseUrl);
    const rows = await sql`SELECT 1 AS ok`;
    check(Number(rows[0]?.ok || 0) === 1, "DATABASE_URL accepts a live query");
    const providerRows = await sql`
      SELECT provider, COUNT(*)::integer AS count
      FROM payment_provider_connections
      WHERE status = 'connected'
      GROUP BY provider
    `;
    check(providerRows.length > 0, "at least one payment provider is connected");
    const stripeConnected = providerRows.some((row) => row.provider === "stripe");
    const paypalConnected = providerRows.some((row) => row.provider === "paypal");
    if (stripeConnected) {
      check(Boolean(process.env.STRIPE_WEBHOOK_SECRET), "STRIPE_WEBHOOK_SECRET is configured for Stripe");
    }
    if (paypalConnected) {
      check(Boolean(process.env.PAYPAL_WEBHOOK_ID), "PAYPAL_WEBHOOK_ID is configured for PayPal");
    }
    const functionRows = await sql`
      SELECT
        to_regprocedure('maxform_reserve_payment_inventory(uuid,jsonb,integer)') IS NOT NULL AS inventory_reservation,
        to_regprocedure('maxform_set_payment_inventory(uuid,uuid,uuid,integer,text,text)') IS NOT NULL AS inventory_set,
        to_regprocedure('maxform_restock_payment_inventory(uuid)') IS NOT NULL AS inventory_restock,
        to_regclass('payment_inventory_ledger') IS NOT NULL AS inventory_ledger,
        to_regclass('payment_refund_items') IS NOT NULL AS refund_items,
        to_regclass('webhook_events') IS NOT NULL AS webhook_events
    `;
    const functions = (functionRows[0] || {}) as Record<string, unknown>;
    check(functions.inventory_reservation === true, "inventory reservation function is installed");
    check(functions.inventory_set === true, "inventory set function is installed");
    check(functions.inventory_restock === true, "inventory restock function is installed");
    check(functions.inventory_ledger === true, "inventory ledger table is installed");
    check(functions.refund_items === true, "refund item table is installed");
    check(functions.webhook_events === true, "webhook event table is installed");
  } catch (error) {
    check(false, `production database checks pass (${error instanceof Error ? error.name : "connection error"})`);
  }
}

if (failures) {
  console.error(`\nForms production configuration failed: ${failures} check(s).`);
  process.exitCode = 1;
} else {
  console.log("\nForms production configuration passed.");
}

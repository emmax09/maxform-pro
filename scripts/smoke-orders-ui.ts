/**
 * Browser smoke test for the Orders module.
 *
 * The API test proves the ledger reads correctly; this proves the screen does:
 * the rail entry exists, the on-screen tabs filter the same ledger, an order
 * opens its detail with the Payments links attached, and the overview totals
 * agree with the seeded data.
 *
 * Requires the dev server: `npm run dev`, then `npm run smoke:orders:ui`.
 * Everything it creates is deleted again in the `finally` block.
 */
import { randomUUID } from "node:crypto";

import { neon } from "@neondatabase/serverless";
import { chromium, type Browser } from "@playwright/test";
import { SignJWT } from "jose";

const databaseUrl = process.env.DATABASE_URL || "";
const jwtSecret = process.env.JWT_SECRET || "";
const baseUrl = process.env.SMOKE_BASE_URL || "http://127.0.0.1:8080";

if (!databaseUrl || jwtSecret.length < 32) {
  throw new Error(
    "Orders UI smoke test requires DATABASE_URL and a 32+ character JWT_SECRET.",
  );
}

const sql = neon(databaseUrl);
const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
const ownerId = randomUUID();
const ownerEmail = `orders-ui-${suffix}@example.test`;

let assertions = 0;
const check = (condition: unknown, message: string) => {
  if (!condition) throw new Error(`FAILED: ${message}`);
  assertions += 1;
  console.log(`  ok  ${message}`);
};

const seeded = [
  { source: "form", status: "paid", total: 120, number: "UIORD-F1" },
  { source: "event", status: "paid", total: 250, number: "UIORD-E1" },
  { source: "invoice", status: "pending", total: 90, number: "UIORD-I1" },
];

const cleanup = async () => {
  await sql.query(
    `DELETE FROM payment_order_items WHERE order_id IN (
       SELECT id FROM payment_orders WHERE user_id = $1
     )`,
    [ownerId],
  );
  await sql.query(`DELETE FROM payment_orders WHERE user_id = $1`, [ownerId]);
  await sql.query(`DELETE FROM company_settings WHERE user_id = $1`, [ownerId]);
  await sql.query(`DELETE FROM user_onboarding WHERE user_id = $1`, [ownerId]);
  await sql.query(
    `DELETE FROM workspace_members WHERE owner_id = $1 OR user_id = $1`,
    [ownerId],
  );
  await sql.query(`DELETE FROM users WHERE id = $1`, [ownerId]);
};

let browser: Browser | null = null;

try {
  const reachable = await fetch(baseUrl).then(
    () => true,
    () => false,
  );
  if (!reachable) {
    throw new Error(
      `The dev server is not answering on ${baseUrl}. Start it with "npm run dev" first.`,
    );
  }

  console.log("\nSeeding a workspace with orders from three modules");
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
  await sql.query(
    `INSERT INTO profiles (user_id, full_name) VALUES ($1, 'Orders Owner')
     ON CONFLICT (user_id) DO NOTHING`,
    [ownerId],
  );
  await sql.query(
    `INSERT INTO user_onboarding (user_id, business_name, completed_at)
     VALUES ($1, 'Orders Workspace', NOW())
     ON CONFLICT (user_id) DO UPDATE SET completed_at = NOW()`,
    [ownerId],
  );

  for (const entry of seeded) {
    const orderId = randomUUID();
    await sql.query(
      `INSERT INTO payment_orders (
         id, user_id, order_number, source_type, customer_name, customer_email,
         status, provider, subtotal, total_amount, currency, paid_at
       )
       VALUES ($1, $2, $3, $4, 'Ada Lovelace', $5, $6, 'stripe', $7, $7, 'USD',
               CASE WHEN $6 = 'paid' THEN NOW() ELSE NULL END)`,
      [
        orderId,
        ownerId,
        entry.number,
        entry.source,
        `buyer-${suffix}@example.test`,
        entry.status,
        entry.total,
      ],
    );
    if (entry.number === "UIORD-F1") {
      await sql.query(
        `INSERT INTO payment_order_items (
           order_id, name, quantity, unit_price, total_amount, sku
         )
         VALUES ($1, 'Analytical Engine', 2, 60, 120, 'AE-1')`,
        [orderId],
      );
    }
  }

  const token = await new SignJWT({ email: ownerEmail, userId: ownerId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer("maxform")
    .setAudience("maxform-dashboard")
    .setIssuedAt()
    .setExpirationTime("30m")
    .sign(new TextEncoder().encode(jwtSecret));

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 950 },
  });
  await context.addInitScript((value) => {
    window.localStorage.setItem("access_token", value as string);
    window.localStorage.setItem("refresh_token", value as string);
  }, token);
  const page = await context.newPage();
  page.on("pageerror", (error) => console.log(`  [page error] ${error.message}`));

  console.log("\nOrders is a workspace tab of its own");
  await page.goto(`${baseUrl}/dashboard`, { waitUntil: "domcontentloaded" });
  const rail = page.locator("aside nav button", { hasText: /^Orders$/ });
  await rail.first().waitFor({ timeout: 30_000 });
  check(true, "the rail offers Orders");

  await rail.first().click();
  await page.getByRole("heading", { name: "Orders", level: 1 }).waitFor({
    timeout: 30_000,
  });
  check(true, "the module opens from the rail");
  check(
    /tab=orders/.test(page.url()),
    `the tab is reflected in the URL (${page.url()})`,
  );

  console.log("\nThe overview totals the whole workspace");
  // Waits for the tile rather than a fixed pause: the module chunk compiles on
  // first open in dev, so any fixed timeout is a race waiting to be lost.
  await page.getByText(/net revenue/i).first().waitFor({ timeout: 30_000 });
  const overview = await page.locator("body").innerText();
  check(/net revenue/i.test(overview), "the overview shows net revenue");
  // 120 + 250 settled; the pending invoice is outstanding, not revenue.
  check(/370\.00/.test(overview), "settled revenue is totalled across modules");
  check(/where sales come from/i.test(overview), "sales are broken down by source");
  check(
    /analytical engine/i.test(overview),
    "the best-sellers panel reports what sold",
  );

  console.log("\nThe on-screen tabs filter the same ledger");
  // Scoped to the module's own tab strip: the sidebar rail carries an "Events"
  // button too, and an unscoped lookup matches both.
  const tabs = page.getByLabel("Orders sections");
  const openTab = async (name: string) => {
    await tabs.getByRole("button", { name }).click();
    await page.waitForTimeout(2_500);
  };

  await openTab("All orders");
  for (const entry of seeded) {
    check(
      (await page.locator("table tbody tr", { hasText: entry.number }).count()) > 0,
      `All orders lists ${entry.number}`,
    );
  }

  await openTab("Events");
  check(
    (await page.locator("table tbody tr", { hasText: "UIORD-E1" }).count()) > 0,
    "the Events tab keeps the event order",
  );
  check(
    (await page.locator("table tbody tr", { hasText: "UIORD-F1" }).count()) === 0,
    "the Events tab drops the form order",
  );

  console.log("\nAn order opens its detail, with the way across to Payments");
  await openTab("All orders");
  await page.locator("table tbody tr", { hasText: "UIORD-F1" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ timeout: 15_000 });
  // Waits for the loaded content rather than a fixed pause: the detail fans
  // out to five queries, and a timeout is a race waiting to be lost.
  await dialog.getByText(/Analytical Engine/).waitFor({ timeout: 20_000 });
  const detail = await dialog.innerText();
  check(/UIORD-F1/.test(detail), "the detail names the order");
  check(/Analytical Engine/.test(detail), "it lists the items");
  check(/Refund in Payments/.test(detail), "it links across to Payments");
  check(/Order ID/.test(detail), "it exposes the order id");
  check(/Placed/.test(detail), "it shows the full placed timestamp");
  check(/Receipt/.test(detail), "it offers the receipt");

  console.log("\nBulk selection drives the shared actions");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
  const firstRowCheckbox = page
    .locator("table tbody tr")
    .first()
    .getByRole("checkbox");
  await firstRowCheckbox.click();
  await page.getByRole("button", { name: /Bulk actions/ }).waitFor({
    timeout: 10_000,
  });
  check(true, "selecting a row reveals the bulk actions");
  const selectionText = await page.locator("body").innerText();
  check(
    /1 of \d+ selected/.test(selectionText),
    "the selection bar counts the selection",
  );

  console.log(`\n✓ Orders UI smoke test passed (${assertions} checks)`);
} catch (error) {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await cleanup();
  console.log("Cleaned up the throwaway workspace and its orders.");
}

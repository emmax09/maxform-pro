import { mkdir } from "node:fs/promises";
import {
  createCipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";

import { neon } from "@neondatabase/serverless";
import { chromium, type BrowserContext, type Page } from "@playwright/test";

const baseUrl = process.env.SMOKE_BASE_URL || "http://127.0.0.1:8080";
const runId = randomBytes(8).toString("hex");
const smokeIp = `198.51.100.${(Number.parseInt(runId.slice(0, 2), 16) % 254) + 1}`;
const email = `payment-ui-${runId}@example.test`;
const password = `Ui-${randomBytes(12).toString("base64url")}9!`;
const forbiddenResponseKeys = new Set([
  "client_secret",
  "credentials",
  "credentials_encrypted",
  "error_code",
  "metadata",
  "password_hash",
  "provider_payment_id",
  "provider_reference",
  "provider_refund_id",
  "provider_subscription_id",
  "provider_transaction_id",
  "reset_token",
  "secret",
]);

let assertions = 0;
let eventSaveElapsed = 0;
let formSaveElapsed = 0;
const paidFormTitle = "Save latency paid form";
const publicFormTitle = "Modern paid checkout";
const publicFormSlug = `checkout-form-${runId}`;
const publicEventTitle = "MaxForm Commerce Summit";
const publicEventSlug = `checkout-event-${runId}`;
const publicEventFormSlug = `checkout-event-registration-${runId}`;
const checkoutCouponCode = `UIFREE${runId.slice(0, 8).toUpperCase()}`;

const check = (condition: unknown, message: string) => {
  if (!condition) throw new Error(`Payment UI smoke check failed: ${message}`);
  assertions += 1;
};

const responseJson = async (response: Response) => {
  const value = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  return value;
};

const findForbiddenKey = (value: unknown): string | null => {
  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findForbiddenKey(item);
      if (match) return match;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenResponseKeys.has(key.toLowerCase())) return key;
    const match = findForbiddenKey(child);
    if (match) return match;
  }
  return null;
};

const observePage = (page: Page) => {
  const runtimeFailures: string[] = [];
  page.on("pageerror", (error) =>
    runtimeFailures.push(`pageerror: ${error.message}`),
  );
  page.on("console", (message) => {
    if (message.type() === "error") {
      const location = message.location();
      runtimeFailures.push(
        `console: ${message.text()}${location.url ? ` (${location.url}:${location.lineNumber})` : ""}`,
      );
    }
  });
  return runtimeFailures;
};

const validatePaymentPage = async (
  context: BrowserContext,
  viewportName: "desktop" | "mobile",
) => {
  const page = await context.newPage();
  const runtimeFailures = observePage(page);
  const networkDiagnostics: string[] = [];
  page.on("response", (response) => {
    if (response.url().includes("/api/")) {
      networkDiagnostics.push(
        `${response.request().method()} ${response.status()} ${response.url()}`,
      );
    }
  });
  page.on("requestfailed", (request) => {
    networkDiagnostics.push(
      `${request.method()} FAILED ${request.url()} (${request.failure()?.errorText || "unknown"})`,
    );
  });
  let workspacePayload: unknown;

  page.on("response", async (response) => {
    const url = new URL(response.url());
    if (
      url.pathname === "/api/payments/data" &&
      url.searchParams.get("action") === "workspace" &&
      response.ok()
    ) {
      workspacePayload = await response.json().catch(() => undefined);
    }
  });

  await page.goto(`${baseUrl}/dashboard?tab=payments`, {
    waitUntil: "domcontentloaded",
  });
  await page
    .getByRole("heading", { level: 1, name: "Payments" })
    .waitFor({ state: "visible", timeout: 30_000 });
  await page
    .getByRole("navigation", { name: "Payment views" })
    .waitFor({ state: "visible" });
  await page.waitForFunction(
    () => !document.body.textContent?.includes("Payments could not be loaded"),
  );

  check(
    page.url().includes("tab=payments"),
    `${viewportName} payment route is active`,
  );
  check(
    Boolean(workspacePayload),
    `${viewportName} payment workspace response was received`,
  );
  const forbiddenKey = findForbiddenKey(workspacePayload);
  check(
    !forbiddenKey,
    `${viewportName} payment response contains no protected fields${
      forbiddenKey ? ` (found ${forbiddenKey})` : ""
    }`,
  );
  check(
    runtimeFailures.length === 0,
    `${viewportName} payment page has no runtime errors (${runtimeFailures.join(" | ")}; network ${networkDiagnostics.slice(-12).join(" | ")})`,
  );

  const viewportOverflow = await page.evaluate(
    () =>
      Math.max(
        document.documentElement.scrollWidth,
        document.body.scrollWidth,
      ) -
      window.innerWidth,
  );
  check(
    viewportOverflow <= 1,
    `${viewportName} payment page does not overflow the viewport`,
  );

  if (viewportName === "desktop") {
    await page.getByRole("button", { name: "Coupons", exact: true }).click();
    await page
      .getByRole("button", { name: "New coupon", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("heading", { name: "New coupon" })
      .waitFor({ state: "visible" });
    check(
      await page.getByText("Applies to", { exact: true }).isVisible(),
      "coupon assignment control is visible",
    );
    check(
      await page.getByLabel("Limit per customer").isVisible(),
      "coupon customer limit is visible",
    );
    check(
      await page.getByText(paidFormTitle, { exact: true }).isVisible(),
      "paid form is searchable as a coupon target",
    );
    await page.screenshot({
      path: "artifacts/payment-coupon-modal-desktop.png",
      fullPage: false,
    });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
  }

  await page.screenshot({
    path: `artifacts/payments-security-${viewportName}.png`,
    fullPage: false,
  });
  await page.close();
};

const completePublicCheckout = async (
  context: BrowserContext,
  input: {
    event: boolean;
    screenshot: string;
    viewportName: "desktop" | "mobile";
  },
) => {
  const page = await context.newPage();
  const runtimeFailures = observePage(page);
  if (input.event) {
    await page.goto(
      `${baseUrl}/event/${temporaryWorkspaceId}/${publicEventSlug}`,
      { waitUntil: "domcontentloaded" },
    );
    await page
      .getByRole("heading", { level: 1, name: publicEventTitle })
      .waitFor({ state: "visible", timeout: 30_000 });
    await page.getByRole("link", { name: "Get tickets" }).click();
    await page.waitForURL(
      new RegExp(`/forms/${temporaryWorkspaceId}/${publicEventFormSlug}`),
    );
  } else {
    await page.goto(
      `${baseUrl}/forms/${temporaryWorkspaceId}/${publicFormSlug}`,
      { waitUntil: "domcontentloaded" },
    );
  }

  const checkoutHeading = page.getByRole("heading", {
    level: 1,
    name: input.event ? `${publicEventTitle} registration` : publicFormTitle,
  });
  try {
    await checkoutHeading.waitFor({ state: "visible", timeout: 30_000 });
  } catch (error) {
    await page.screenshot({
      path: `artifacts/public-checkout-${input.viewportName}-failure.png`,
      fullPage: true,
    });
    const pageText = (await page.locator("body").innerText()).trim().slice(0, 800);
    throw new Error(
      `Public checkout did not render at ${page.url()}. Page text: ${pageText || "(empty)"}. Network: ${networkDiagnostics.slice(-20).join(" | ") || "(none)"}`,
      { cause: error },
    );
  }
  await page.getByLabel("Full name").fill("Checkout Smoke Customer");
  await page
    .getByLabel("Email address")
    .fill(`checkout-${input.viewportName}-${runId}@example.test`);
  if (input.event) {
    await page.getByRole("combobox", { name: "Choose your ticket" }).click();
    await page
      .getByRole("option", { name: "General admission", exact: true })
      .click();
  }
  await page
    .getByRole("button", { name: "Continue to payment", exact: true })
    .click();
  try {
    await page
      .getByRole("heading", { level: 1, name: "Complete payment" })
      .waitFor({ state: "visible", timeout: 30_000 });
  } catch (error) {
    await page.screenshot({
      path: `artifacts/public-checkout-${input.viewportName}-failure.png`,
      fullPage: true,
    });
    const pageText = (await page.locator("body").innerText()).trim().slice(0, 800);
    throw new Error(
      `Checkout review did not open at ${page.url()}. Page text: ${pageText || "(empty)"}. Network: ${networkDiagnostics.slice(-20).join(" | ") || "(none)"}`,
      { cause: error },
    );
  }
  check(
    await page.getByText("Northstar Studio", { exact: true }).first().isVisible(),
    `${input.viewportName} checkout uses workspace identity`,
  );
  check(
    await page.getByRole("region", { name: "Secure checkout" }).isVisible(),
    `${input.viewportName} secure checkout panel is visible`,
  );
  check(
    await page.getByRole("button", { name: /Paystack/ }).isVisible(),
    `${input.viewportName} checkout offers the connected Paystack account`,
  );
  await page.getByLabel("First name").fill("Checkout");
  await page.getByLabel("Last name").fill("Customer");
  await page
    .getByLabel("Email receipt")
    .fill(`checkout-${input.viewportName}-${runId}@example.test`);
  await page.getByLabel("Country", { exact: true }).click();
  await page.getByRole("option", { name: /Nigeria/ }).click();
  const stateSelect = page.getByRole("combobox", { name: "State / region" });
  await stateSelect.waitFor({ state: "visible" });
  await page.waitForFunction(
    () => !document.querySelector<HTMLButtonElement>("#checkout-region")?.disabled,
  );
  await stateSelect.click();
  await page.getByRole("option", { name: /^Lagos\b/ }).click();
  const citySelect = page.getByRole("combobox", { name: "City" });
  await citySelect.waitFor({ state: "visible" });
  await page.waitForFunction(
    () => !document.querySelector<HTMLButtonElement>("#checkout-city")?.disabled,
  );
  await citySelect.click();
  await page.getByRole("option", { name: "Ikeja", exact: true }).click();
  await page.getByLabel("Postal code").fill("100001");
  await page.getByLabel("Address", { exact: true }).fill("1 Commerce Way");
  await page
    .getByRole("button", { name: /Do you have a coupon/ })
    .click();
  await page.getByLabel("Coupon code").fill(checkoutCouponCode);
  await page
    .getByRole("button", { name: "Validate coupon", exact: true })
    .click();
  await page
    .getByText(`${checkoutCouponCode} applied`, { exact: true })
    .first()
    .waitFor({ state: "visible", timeout: 30_000 });

  const overflow = await page.evaluate(
    () =>
      Math.max(
        document.documentElement.scrollWidth,
        document.body.scrollWidth,
      ) - window.innerWidth,
  );
  check(
    overflow <= 1,
    `${input.viewportName} public checkout does not overflow the viewport`,
  );
  await page.screenshot({ path: input.screenshot, fullPage: true });
  const completeOrder = page.getByRole("button", {
    name: "Complete with coupon",
    exact: true,
  });
  check(await completeOrder.isEnabled(), `${input.viewportName} checkout is ready`);
  await completeOrder.click();
  await page
    .getByRole("heading", { name: "Response received" })
    .waitFor({ state: "visible", timeout: 30_000 });
  check(
    runtimeFailures.length === 0,
    `${input.viewportName} public checkout has no runtime errors`,
  );
  await page.close();
};

const validateCountryCurrencySettings = async (context: BrowserContext) => {
  const page = await context.newPage();
  const runtimeFailures = observePage(page);
  await page.goto(`${baseUrl}/dashboard?tab=settings&section=currency`, {
    waitUntil: "domcontentloaded",
  });
  await page
    .getByRole("heading", { level: 1, name: "Currency" })
    .waitFor({ state: "visible", timeout: 30_000 });
  await page
    .getByRole("combobox", { name: "Default currency" })
    .click();
  const search = page.getByPlaceholder(
    "Search country, currency, code or symbol...",
  );
  await search.fill("Ecuador");
  const ecuador = page.getByRole("option", { name: /Ecuador - USD/ });
  await ecuador.waitFor({ state: "visible" });
  check(
    await ecuador.getByText(/US Dollar/i).isVisible(),
    "country currency search includes the currency name",
  );
  await ecuador.click();
  await page.getByRole("button", { name: "Save currency" }).click();
  await page.getByText("Workspace currency saved", { exact: true }).waitFor({
    state: "visible",
    timeout: 30_000,
  });
  const regional = await page.evaluate(async () => {
    const token = localStorage.getItem("access_token") || "";
    const response = await fetch("/api/settings?action=regional", {
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.json() as Promise<{
      regional?: {
        currency?: string;
        currencyCountryCode?: string;
      };
    }>;
  });
  check(
    regional.regional?.currency === "USD" &&
      regional.regional.currencyCountryCode === "EC",
    "country and currency selection persisted together",
  );
  check(
    runtimeFailures.length === 0,
    "country currency settings have no runtime errors",
  );
  await page.close();
};

const validateFormSaveSpeed = async (context: BrowserContext) => {
  const page = await context.newPage();
  const runtimeFailures = observePage(page);
  const networkDiagnostics: string[] = [];
  page.on("response", (response) => {
    if (response.url().includes("/api/")) {
      networkDiagnostics.push(
        `${response.request().method()} ${response.status()} ${response.url()}`,
      );
    }
  });
  page.on("requestfailed", (request) => {
    networkDiagnostics.push(
      `${request.method()} FAILED ${request.url()} (${request.failure()?.errorText || "unknown"})`,
    );
  });
  await page.goto(`${baseUrl}/dashboard?tab=forms&section=all`, {
    waitUntil: "domcontentloaded",
  });
  const formLink = page.getByRole("button", {
    name: new RegExp(`^${paidFormTitle}`),
  });
  await formLink.waitFor({ state: "visible", timeout: 30_000 });
  await formLink.click();
  const formTitle = page.getByLabel("Form title");
  try {
    await formTitle.waitFor({ state: "visible", timeout: 30_000 });
  } catch (error) {
    await page.screenshot({
      path: "artifacts/form-save-failure.png",
      fullPage: true,
    });
    const pageText = (await page.locator("body").innerText()).trim().slice(0, 800);
    throw new Error(
      `Form editor did not open. Page text: ${pageText || "(empty)"}. Network: ${networkDiagnostics.slice(-20).join(" | ") || "(none)"}`,
      { cause: error },
    );
  }
  await formTitle.fill(`${paidFormTitle} updated`);

  const saveButton = page.getByRole("button", {
    name: "Save draft",
    exact: true,
  });
  const startedAt = Date.now();
  await saveButton.click();
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll("button")).some(
      (button) =>
        button.textContent?.toLowerCase().includes("save draft") &&
        button.disabled,
    ),
  );
  await page
    .getByText("Draft saved", { exact: true })
    .waitFor({ state: "visible", timeout: 30_000 });
  formSaveElapsed = Date.now() - startedAt;
  check(formSaveElapsed < 5_000, "form draft save completes within five seconds");
  check(runtimeFailures.length === 0, "form save has no runtime errors");
  await page.close();
};

const validateEventSaveSpeed = async (context: BrowserContext) => {
  const page = await context.newPage();
  const runtimeFailures = observePage(page);
  await page.goto(`${baseUrl}/dashboard?tab=events`, {
    waitUntil: "domcontentloaded",
  });
  const newEvent = page.getByRole("button", { name: "New event", exact: true });
  await newEvent.first().waitFor({ state: "visible", timeout: 30_000 });
  await newEvent.first().click();
  await page.getByLabel("Event name").fill("Save latency check");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create event", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Save latency check" })
    .waitFor({ state: "visible", timeout: 30_000 });
  await page
    .getByLabel("Event name")
    .fill("Save latency check updated");

  const saveButton = page.getByRole("button", {
    name: "Save Draft",
    exact: true,
  });
  await page.waitForFunction(
    () =>
      !Array.from(document.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("Save Draft"),
      )?.disabled,
  );
  const startedAt = Date.now();
  await saveButton.click();
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll("button")).some(
      (button) =>
        button.textContent?.includes("Save Draft") && button.disabled,
    ),
  );
  await page
    .getByText("Draft saved", { exact: true })
    .waitFor({ state: "visible", timeout: 30_000 });
  eventSaveElapsed = Date.now() - startedAt;
  check(
    eventSaveElapsed < 5_000,
    "event draft save completes within five seconds",
  );
  check(runtimeFailures.length === 0, "event save has no runtime errors");
  await page.close();
};

let accessToken = "";
let temporaryUserId = "";
let temporaryWorkspaceId = "";
let smokeFailure: unknown;
const browser = await chromium.launch({ headless: true });
const adminSql = process.env.DATABASE_URL
  ? neon(process.env.DATABASE_URL)
  : null;

const retryTransient = async <T>(action: () => Promise<T>, attempts = 3) => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 500));
      }
    }
  }
  throw lastError;
};

const removeSmokeAccount = async (userId: string) => {
  if (!adminSql || !userId) return;
  await retryTransient(async () => {
    await adminSql.query(`DELETE FROM events WHERE created_by = $1`, [userId]);
    await adminSql.query(`DELETE FROM forms WHERE created_by = $1`, [userId]);
    await adminSql.query(`DELETE FROM contacts WHERE created_by = $1`, [userId]);
    await adminSql.query(`DELETE FROM activity_log WHERE user_id = $1`, [userId]);
    await adminSql.query(`DELETE FROM users WHERE id = $1`, [userId]);
  });
};

const encryptedPaystackCredentials = () => {
  const secret =
    process.env.PAYMENT_ENCRYPTION_KEY ||
    process.env.INTEGRATION_ENCRYPTION_KEY ||
    "";
  if (secret.length < 24) {
    throw new Error("Payment encryption is not configured for browser smoke.");
  }
  const iv = randomBytes(12);
  const key = createHash("sha256").update(secret).digest();
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(
      JSON.stringify({
        publicKey: "pk_test_browser_smoke",
        secretKey: "sk_test_browser_smoke_server_only",
      }),
      "utf8",
    ),
    cipher.final(),
  ]);
  return [
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
};

const createPaidSmokeForm = async (userId: string) => {
  if (!adminSql) return;
  const formId = randomUUID();
  const publicFormId = randomUUID();
  const eventFormId = randomUUID();
  const eventId = randomUUID();
  await adminSql.query(
    `INSERT INTO forms (
       id, title, slug, description, fields, settings, status, created_by,
       created_at, updated_at
     )
     VALUES (
       $1, $2, $3, 'Browser save timing fixture', '[]'::jsonb, '{}'::jsonb,
       'draft', $4, NOW(), NOW()
     )`,
    [formId, paidFormTitle, `save-latency-${runId}`, userId],
  );
  await adminSql.query(
    `INSERT INTO form_settings (
       form_id, payment, lifecycle, current_version,
       has_unpublished_changes, created_at, updated_at
     )
     VALUES (
       $1, $2::jsonb, 'active', 0, FALSE, NOW(), NOW()
     )`,
    [
      formId,
      JSON.stringify({
        allowCoupons: true,
        amount: 25,
        currency: "NGN",
        enabled: true,
        mode: "fixed",
        productId: "",
        provider: "workspace",
      }),
    ],
  );
  await adminSql.query(
    `INSERT INTO form_fields (
       form_id, field_id, position, field_type, label, required, width,
       updated_at
     )
     VALUES ($1, 'customer-name', 0, 'shortText', 'Name', TRUE, 'full', NOW())`,
    [formId],
  );

  await adminSql.query(
    `INSERT INTO company_settings (
       user_id, company_name, company_logo_url, company_website, company_size,
       industry, address, phone, brand_color, created_at, updated_at
     )
     VALUES (
       $1, 'Northstar Studio', NULL, '', '1-10', 'Technology',
       'Lagos, Nigeria', '+2348000000000', '#126B5E', NOW(), NOW()
     )
     ON CONFLICT (user_id)
     DO UPDATE SET company_name = EXCLUDED.company_name,
                   brand_color = EXCLUDED.brand_color,
                   updated_at = NOW()`,
    [userId],
  );
  await adminSql.query(
    `INSERT INTO payment_provider_connections (
       user_id, provider, auth_type, status, external_account_id,
       external_account_name, credentials_encrypted, credential_hint,
       is_default, health_ok, connected_at, created_at, updated_at
     )
     VALUES (
       $1, 'paystack', 'api_key', 'connected', 'browser-smoke',
       'Northstar Paystack', $2, 'pk_test...moke', TRUE, TRUE,
       NOW(), NOW(), NOW()
     )`,
    [userId, encryptedPaystackCredentials()],
  );

  for (const fixture of [
    {
      formId: publicFormId,
      payment: {
        allowCoupons: true,
        amount: 85,
        currency: "NGN",
        enabled: true,
        mode: "fixed",
        productId: "",
        provider: "workspace",
      },
      slug: publicFormSlug,
      title: publicFormTitle,
    },
    {
      formId: eventFormId,
      payment: {
        allowCoupons: true,
        amount: 0,
        currency: "NGN",
        enabled: true,
        mode: "product",
        productId: "",
        provider: "workspace",
      },
      slug: publicEventFormSlug,
      title: `${publicEventTitle} registration`,
    },
  ]) {
    await adminSql.query(
      `INSERT INTO forms (
         id, title, slug, description, fields, settings, status, created_by,
         created_at, updated_at
       )
       VALUES (
         $1, $2, $3, 'Complete the details below to continue.',
         '[]'::jsonb, '{}'::jsonb, 'published', $4, NOW(), NOW()
       )`,
      [fixture.formId, fixture.title, fixture.slug, userId],
    );
    await adminSql.query(
      `INSERT INTO form_settings (
         form_id, theme, payment, lifecycle, current_version,
         has_unpublished_changes, created_at, updated_at
       )
       VALUES (
         $1,
         '{"accentColor":"#126B5E","backgroundColor":"#F4F8F7","surfaceColor":"#FFFFFF","textColor":"#102A27","mutedTextColor":"#5D716E","borderColor":"#D8E3E1","fontFamily":"Inter","headingFontFamily":"Inter","fontSize":14,"headingSize":28,"fontWeight":400,"headingWeight":650,"cornerRadius":8,"contentWidth":720,"spacing":"comfortable","labelStyle":"above","inputStyle":"outlined","buttonStyle":"solid","backgroundImageUrl":"","logoUrl":"","coverImageUrl":""}'::jsonb,
         $2::jsonb, 'active', 1, FALSE, NOW(), NOW()
       )`,
      [fixture.formId, JSON.stringify(fixture.payment)],
    );
    await adminSql.query(
      `INSERT INTO form_fields (
         form_id, field_id, position, field_type, label, placeholder,
         required, width, updated_at
       )
       VALUES
         ($1, 'full-name', 0, 'shortText', 'Full name', 'Ada Lovelace',
          TRUE, 'half', NOW()),
         ($1, 'email', 1, 'email', 'Email address', 'ada@example.com',
          TRUE, 'half', NOW())`,
      [fixture.formId],
    );
  }
  await adminSql.query(
    `INSERT INTO form_fields (
       form_id, field_id, position, field_type, label, required, options, width,
       updated_at
     )
     VALUES (
       $1, 'ticket-selection', 2, 'dropdown', 'Choose your ticket', TRUE,
       '["General admission"]'::jsonb, 'full', NOW()
     )`,
    [eventFormId],
  );
  await adminSql.query(
    `INSERT INTO events (
       id, created_by, registration_form_id, title, slug, description, status,
       location_type, venue_name, address, starts_at, ends_at, timezone,
       ticketing_enabled, ticket_prefix, ticket_prefix_configured,
       created_at, updated_at
     )
     VALUES (
       $1, $2, $3, $4, $5,
       'A complete paid event fixture for responsive checkout validation.',
       'on_sale', 'physical', 'Harbour Conference Centre',
       'Victoria Island, Lagos', NOW() + INTERVAL '14 days',
       NOW() + INTERVAL '14 days 6 hours', 'Africa/Lagos', TRUE,
       'NSS-', TRUE, NOW(), NOW()
     )`,
    [eventId, userId, eventFormId, publicEventTitle, publicEventSlug],
  );
  await adminSql.query(
    `INSERT INTO event_pricing (
       event_id, enabled, amount, currency, label, tax_included,
       discounts_enabled, coupons_enabled, created_at, updated_at
     )
     VALUES (
       $1, FALSE, 0, 'NGN', 'Ticket price', FALSE, FALSE, TRUE, NOW(), NOW()
     )`,
    [eventId],
  );
  await adminSql.query(
    `INSERT INTO event_ticket_types (
       event_id, name, description, price, currency, quantity_available,
       min_per_order, max_per_order, active, sort_order
     )
     VALUES (
       $1, 'General admission', 'Full summit access', 150, 'NGN', 100,
       1, 4, TRUE, 0
     )`,
    [eventId],
  );
  await adminSql.query(
    `INSERT INTO payment_coupons (
       user_id, code, name, discount_type, discount_value, redemption_limit,
       active, applies_to, created_at, updated_at
     )
     VALUES (
       $1, $2, 'Browser checkout validation', 'percentage', 100, 4, TRUE,
       $3::jsonb, NOW(), NOW()
     )`,
    [
      userId,
      checkoutCouponCode,
      JSON.stringify([
        { id: publicFormId, type: "form" },
        { id: eventId, type: "event" },
      ]),
    ],
  );
};

try {
  await mkdir("artifacts", { recursive: true });
  if (adminSql) {
    const stale = await adminSql.query(
      `SELECT id FROM users WHERE email LIKE 'payment-ui-%@example.test'`,
    );
    for (const user of stale) {
      await removeSmokeAccount(String(user.id || ""));
    }
  }
  const signupResponse = await fetch(`${baseUrl}/api/auth?action=sign-up`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": smokeIp,
    },
    body: JSON.stringify({
      country: "Nigeria",
      email,
      fullName: "Payment UI Check",
      password,
      phone: "",
    }),
  });
  const signup = await responseJson(signupResponse);
  check(signupResponse.status === 201, "temporary account was created");
  accessToken = String(signup.access_token || "");
  temporaryUserId = String(
    (signup.user as Record<string, unknown> | undefined)?.id || "",
  );
  temporaryWorkspaceId = String(
    (signup.user as Record<string, unknown> | undefined)?.short_id || "",
  );
  check(Boolean(accessToken), "temporary account received a session");
  check(Boolean(temporaryWorkspaceId), "temporary account received a workspace ID");
  check(!findForbiddenKey(signup), "sign-up response contains no protected fields");
  await createPaidSmokeForm(temporaryUserId);

  const desktop = await browser.newContext({
    colorScheme: "dark",
    extraHTTPHeaders: { "X-Forwarded-For": smokeIp },
    viewport: { height: 900, width: 1440 },
  });
  const signInPage = await desktop.newPage();
  const signInFailures = observePage(signInPage);
  await signInPage.goto(`${baseUrl}/auth`, { waitUntil: "domcontentloaded" });
  const emailInput = signInPage.locator('input[type="email"]');
  try {
    await emailInput.waitFor({ state: "visible", timeout: 30_000 });
  } catch (error) {
    await signInPage.screenshot({
      path: "artifacts/payment-auth-page-failure.png",
      fullPage: true,
    });
    const pageText = (await signInPage.locator("body").innerText())
      .trim()
      .slice(0, 800);
    throw new Error(
      `Payment sign-in page did not render at ${signInPage.url()}. Page text: ${pageText || "(empty)"}. Runtime: ${signInFailures.join(" | ") || "(none)"}`,
      { cause: error },
    );
  }
  await emailInput.fill(email);
  await signInPage.locator('input[type="password"]').fill(password);
  await signInPage.getByRole("button", { name: "Sign in", exact: true }).click();
  try {
    await signInPage.waitForURL(/\/dashboard(?:\?|$)/, { timeout: 30_000 });
  } catch (error) {
    await signInPage.screenshot({
      path: "artifacts/payment-sign-in-failure.png",
      fullPage: true,
    });
    const pageText = (await signInPage.locator("body").innerText())
      .trim()
      .slice(0, 800);
    throw new Error(
      `Payment browser sign-in did not reach the dashboard. Page text: ${pageText || "(empty)"}. Runtime: ${signInFailures.join(" | ") || "(none)"}`,
      { cause: error },
    );
  }
  check(
    signInFailures.length === 0,
    `sign-in page has no runtime errors (${signInFailures.join(" | ")})`,
  );
  const browserToken = await signInPage.evaluate(() =>
    localStorage.getItem("access_token"),
  );
  check(Boolean(browserToken), "UI sign-in stored the server session");
  const storageState = await desktop.storageState();
  await signInPage.close();

  await validatePaymentPage(desktop, "desktop");
  await completePublicCheckout(desktop, {
    event: false,
    screenshot: "artifacts/public-checkout-form-desktop.png",
    viewportName: "desktop",
  });
  await validateCountryCurrencySettings(desktop);
  await validateFormSaveSpeed(desktop);
  await validateEventSaveSpeed(desktop);
  await desktop.close();

  const mobile = await browser.newContext({
    colorScheme: "light",
    extraHTTPHeaders: { "X-Forwarded-For": smokeIp },
    isMobile: true,
    storageState,
    viewport: { height: 844, width: 390 },
  });
  await validatePaymentPage(mobile, "mobile");
  await completePublicCheckout(mobile, {
    event: true,
    screenshot: "artifacts/public-checkout-event-mobile.png",
    viewportName: "mobile",
  });
  await mobile.close();
} catch (error) {
  smokeFailure = error;
} finally {
  await browser.close();
  if (accessToken) {
    try {
      const cleanupResponse = await retryTransient(() =>
        fetch(`${baseUrl}/api/auth?action=delete-account`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ currentPassword: password }),
        }),
      );
      if (cleanupResponse.ok) {
        check(true, "temporary account was removed");
      } else {
        await removeSmokeAccount(temporaryUserId);
        check(Boolean(temporaryUserId), "temporary account was removed");
      }
    } catch (cleanupError) {
      if (!smokeFailure) {
        smokeFailure = cleanupError;
      } else {
        process.stderr.write(
          `Payment browser smoke cleanup warning: ${
            cleanupError instanceof Error ? cleanupError.message : "unknown error"
          }\n`,
        );
      }
    }
  }
}

if (smokeFailure) throw smokeFailure;

process.stdout.write(
  `Payment browser smoke test passed (${assertions} assertions; form save ${formSaveElapsed} ms; event save ${eventSaveElapsed} ms).\n`,
);

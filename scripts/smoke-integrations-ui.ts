import { chromium, type BrowserContext } from "@playwright/test";
import { SignJWT } from "jose";
import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";

const databaseUrl = process.env.DATABASE_URL || "";
const jwtSecret = process.env.JWT_SECRET || "";
const baseUrl = process.env.SMOKE_BASE_URL || "http://127.0.0.1:8080";
if (!databaseUrl || !jwtSecret) throw new Error("Integrations UI smoke test requires DATABASE_URL and JWT_SECRET.");

const sql = neon(databaseUrl);
const userId = randomUUID();
const email = `integrations-ui-${userId}@example.test`;
const connectionId = randomUUID();
let assertions = 0;
const check = (condition: unknown, message: string) => {
  if (!condition) throw new Error(`Integrations UI smoke check failed: ${message}`);
  assertions += 1;
};

await sql.query(
  `INSERT INTO users (id, email, password_hash, full_name, short_id)
   VALUES ($1, $2, 'integration-ui-smoke-account', 'Integrations UI Smoke', $3)`,
  [userId, email, userId.replace(/-/g, "").slice(0, 6).toUpperCase()],
);
await sql.query(
  `INSERT INTO user_onboarding (user_id, completed_at, current_step)
   VALUES ($1, NOW(), 8)
   ON CONFLICT (user_id) DO UPDATE SET completed_at = EXCLUDED.completed_at, skipped_at = NULL, current_step = EXCLUDED.current_step`,
  [userId],
);
await sql.query(
  `INSERT INTO integration_connections (
     id, workspace_id, provider_key, connection_name, external_account_name,
     status, auth_type, credentials_encrypted, granted_scopes
   ) VALUES ($1, $2, 'cal_com', 'UI smoke Cal.com', 'ui-smoke@example.test', 'connected', 'api_key', 'ui-smoke-encrypted-credential', '[]'::jsonb)`,
  [connectionId, userId],
);

const token = await new SignJWT({ email, userId })
  .setProtectedHeader({ alg: "HS256", typ: "JWT" })
  .setIssuer("maxform")
  .setAudience("maxform-dashboard")
  .setIssuedAt()
  .setExpirationTime("15m")
  .sign(new TextEncoder().encode(jwtSecret));

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ colorScheme: "dark", viewport: { width: 1440, height: 900 } });
await context.addInitScript(({ accessToken, cachedUser }) => {
  window.localStorage.setItem("access_token", accessToken);
  window.localStorage.setItem("refresh_token", "");
  window.localStorage.setItem("maxform:auth-account", JSON.stringify({ profile: null, user: cachedUser }));
}, { accessToken: token, cachedUser: { id: userId, email, full_name: "Integrations UI Smoke", created_at: new Date(0).toISOString() } });

try {
  const page = await context.newPage();
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("response", (response) => { if (response.status() >= 500) runtimeErrors.push(`${response.status()} ${response.url()}`); });
  await page.goto(`${baseUrl}/dashboard?tab=integrations&section=directory`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { level: 1, name: "Integrations hub", exact: true }).waitFor({ state: "visible", timeout: 30_000 });
  check(await page.getByRole("button", { name: "Integrations", exact: true }).isVisible(), "Integrations is present under Workspace tools");
  for (const tab of ["Directory", "Connections", "Activity & health"]) {
    check(await page.getByRole("tab", { name: tab, exact: true }).isVisible(), `${tab} is an onscreen hub tab`);
  }
  check(await page.getByText("Google Workspace", { exact: true }).count() === 1, "Google Workspace is one provider card, not duplicate Calendar/Meet cards");
  check((await page.locator("body").innerText()).includes("Connected"), "provider state uses a normalized connection status");
  check(!(await page.locator("body").innerText()).includes("administrator"), "provider cards do not expose administrator/setup copy");
  check(!(await page.locator("body").innerText()).includes("Setup guide"), "provider cards do not expose a setup-guide action");
  check(!(await page.locator("body").innerText()).includes("contacts.read"), "provider cards do not expose capability identifiers");
  check(!(await page.locator("body").innerText()).includes("Resend"), "email providers are not duplicated in the integrations hub");
  check(!(await page.locator("body").innerText()).includes("SendGrid"), "email provider cards remain in the Email module only");
  check(!(await page.locator("body").innerText()).includes("Mailchimp"), "email marketing providers remain outside the integrations hub");
  check(await page.getByRole("button", { name: "Connect", exact: true }).count() > 0, "unavailable providers keep an interactive connection action");
  check(!(await page.getByRole("tab").allTextContents()).includes("Module access"), "Module access is not a user-facing hub tab");
  check(!(await page.getByRole("tab").allTextContents()).includes("Defaults"), "Defaults is not a user-facing hub tab");
  check(await page.getByText("Google Calendar", { exact: true }).count() === 0, "the directory does not expose the old appointment-only Google Calendar catalog");
  check(await page.getByText("Google Meet", { exact: true }).count() === 0, "the directory does not expose the old appointment-only Google Meet catalog");
  await page.screenshot({ path: "artifacts/integrations-directory.png", fullPage: true });

  await page.getByRole("tab", { name: "Connections", exact: true }).click();
  await page.getByText("ui-smoke@example.test", { exact: true }).waitFor({ state: "visible" });
  check(await page.getByRole("button", { name: "Test", exact: true }).isVisible(), "a central connection can be tested");
  await page.getByRole("button", { name: "Test", exact: true }).click();
  await page.getByText("Cal.com is healthy", { exact: true }).waitFor({ state: "visible", timeout: 15_000 });

  await page.getByRole("tab", { name: "Activity & health", exact: true }).click();
  check(await page.getByText("Execution health", { exact: true }).isVisible(), "execution health log is visible");
  check(await page.getByText("Audit trail", { exact: true }).isVisible(), "audit trail is visible");
  check(runtimeErrors.length === 0, `the integrations workspace has no runtime or 5xx errors (${runtimeErrors.join("; ")})`);
  await page.screenshot({ path: "artifacts/integrations-hub.png", fullPage: true });
  console.log(`Integrations UI smoke test passed with ${assertions} checks.`);
} finally {
  await context.close();
  await browser.close();
  await sql.query("DELETE FROM users WHERE id = $1", [userId]);
}

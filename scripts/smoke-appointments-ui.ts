/**
 * Scheduling OAuth and central-integrations browser smoke test.
 *
 * The scheduling adapter remains covered here, but its provider directory is
 * intentionally rendered only by Workspace Tools -> Integrations now.
 */
import { chromium } from "@playwright/test";
import { SignJWT } from "jose";
import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";

const databaseUrl = process.env.DATABASE_URL || "";
const jwtSecret = process.env.JWT_SECRET || "";
const baseUrl = process.env.SMOKE_BASE_URL || "http://127.0.0.1:8080";
if (!databaseUrl || !jwtSecret) throw new Error("Appointments UI smoke test requires DATABASE_URL and JWT_SECRET.");

const sql = neon(databaseUrl);
const suffix = randomUUID().replaceAll("-", "");
const email = `appointments-ui-smoke-${suffix}@example.test`;
const centralConnectionId = randomUUID();
let assertions = 0;
const check = (condition: unknown, message: string) => {
  if (!condition) throw new Error(`Appointments UI smoke check failed: ${message}`);
  assertions += 1;
};

const users = await sql.query(
  `INSERT INTO users (email, password_hash, full_name, short_id)
   VALUES ($1, 'non-login-smoke-account', 'Appointments UI Smoke', $2)
   RETURNING id, email`,
  [email, suffix.slice(0, 5)],
);
const userId = String(users[0].id);
const accessToken = await new SignJWT({ email, userId })
  .setProtectedHeader({ alg: "HS256", typ: "JWT" })
  .setIssuer("maxform")
  .setAudience("maxform-dashboard")
  .setIssuedAt()
  .setExpirationTime("15m")
  .sign(new TextEncoder().encode(jwtSecret));

await sql.query(
  `INSERT INTO user_onboarding (user_id, business_name, completed_at)
   VALUES ($1, 'Appointments Smoke Co', NOW())
   ON CONFLICT (user_id) DO UPDATE SET completed_at = NOW()`,
  [userId],
);
await sql.query(
  `INSERT INTO integration_connections (
     id, workspace_id, provider_key, connection_name, external_account_name,
     status, auth_type, credentials_encrypted
   ) VALUES ($1, $2, 'cal_com', 'Appointments UI Cal.com', 'appointments@example.test', 'connected', 'api_key', 'smoke-central-secret')`,
  [centralConnectionId, userId],
);

const cleanup = async () => {
  await sql.query(`DELETE FROM automation_oauth_states WHERE user_id = $1`, [userId]);
  await sql.query(`DELETE FROM scheduling_tool_connections WHERE user_id = $1`, [userId]);
  await sql.query(`DELETE FROM user_onboarding WHERE user_id = $1`, [userId]);
  await sql.query(`DELETE FROM users WHERE id = $1`, [userId]);
};

const api = async (action: string, body?: unknown) => {
  const response = await fetch(`${baseUrl}/api/appointments/integrations?action=${action}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, value: (await response.json()) as Record<string, unknown> };
};

try {
  const registry = await api("providers");
  check(registry.status === 200, "the scheduling adapter registry responds");
  const providers = registry.value.providers as Record<string, { configured: boolean; authType: string; scopes: string[] }>;
  check(["google_calendar", "google_meet", "outlook", "teams", "zoom", "calendly", "cal_com"].every((key) => providers[key]), "all scheduling adapters remain available to the appointment engine");
  check(String(registry.value.callbackUrl).endsWith("/api/appointments/integrations?action=callback"), "the scheduling callback remains registered");
  check(providers.cal_com.authType === "api_key" && providers.cal_com.configured, "Cal.com remains a key-based adapter");

  if (providers.google_calendar.configured) {
    const prepared = await api("prepare", { provider: "google_calendar" });
    check(prepared.status === 200, "configured Google OAuth preparation succeeds");
    const authorizeUrl = new URL(String(prepared.value.authorizationUrl));
    check(authorizeUrl.origin === "https://accounts.google.com", "Google OAuth uses the provider consent screen");
    check((authorizeUrl.searchParams.get("scope") || "").includes("calendar.events"), "calendar access is requested");
  } else {
    const prepared = await api("prepare", { provider: "google_calendar" });
    check(prepared.status === 503, "unconfigured Google OAuth fails with a safe setup response");
  }
  check((await api("prepare", { provider: "not-a-provider" })).status === 400, "unknown scheduling providers are rejected");
  check((await api("connect-key", { provider: "zoom", apiKey: "nope" })).status === 400, "OAuth providers reject pasted API keys");
  const anonymous = await fetch(`${baseUrl}/api/appointments/integrations?action=prepare`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "google_calendar" }) });
  check(anonymous.status === 401, "scheduling connections require a signed-in workspace");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ colorScheme: "dark", viewport: { width: 1440, height: 900 } });
  await context.addInitScript(({ token, cachedUser }) => {
    window.localStorage.setItem("access_token", token);
    window.localStorage.setItem("refresh_token", "");
    window.localStorage.setItem("maxform:auth-account", JSON.stringify({ profile: null, user: cachedUser }));
  }, { token: accessToken, cachedUser: { id: userId, email, full_name: "Appointments Smoke", created_at: new Date(0).toISOString() } });
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/dashboard?tab=integrations&section=directory`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Integrations hub", exact: true }).waitFor({ state: "visible", timeout: 30_000 });
    check(await page.getByRole("button", { name: "Integrations", exact: true }).isVisible(), "the central hub is reachable from Workspace tools");
    check(await page.getByText("Google Workspace", { exact: true }).count() === 1, "Google Workspace is represented as one provider");
    check(await page.getByText("Google Calendar", { exact: true }).count() === 0, "the central directory does not duplicate Google Calendar");
    check(await page.getByText("Google Meet", { exact: true }).count() === 0, "the central directory does not duplicate Google Meet");
    await page.getByRole("tab", { name: "Connections", exact: true }).click();
    await page.getByText("appointments@example.test", { exact: true }).waitFor({ state: "visible" });
    check(await page.getByRole("button", { name: "Refresh connections", exact: true }).isVisible(), "connections can be refreshed after OAuth or key setup");
    check(await page.getByRole("button", { name: "Test", exact: true }).isEnabled(), "a healthy central scheduling connection can be tested");
    await page.getByRole("button", { name: "Refresh connections", exact: true }).click();
    await page.getByRole("tab", { name: "Activity & health", exact: true }).click();
    check(await page.getByText("Execution health", { exact: true }).isVisible(), "central scheduling health is logged");
    await page.screenshot({ path: "artifacts/appointments-integrations-central.png", fullPage: true });
    console.log(`Appointments and integrations UI smoke test passed with ${assertions} checks.`);
  } finally {
    await context.close();
    await browser.close();
  }
} finally {
  await cleanup();
}

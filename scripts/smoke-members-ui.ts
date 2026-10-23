/**
 * Browser smoke test for adding a member, and for what that member then sees.
 *
 * The API-level test (smoke-workspace-members.ts) proves the handlers behave.
 * This proves the product does: an owner fills in the real dialog, and the
 * member the dialog created signs in through the real sign-in form and gets a
 * dashboard rail holding exactly the tabs that were ticked for them.
 *
 * Requires the dev server: `npm run dev`, then `npm run smoke:members:ui`.
 * Everything it creates is deleted again in the `finally` block.
 */
import { randomUUID } from "node:crypto";

import { neon } from "@neondatabase/serverless";
import { chromium, type Browser, type Page } from "@playwright/test";
import { hash } from "bcrypt-ts";
import { SignJWT } from "jose";

const databaseUrl = process.env.DATABASE_URL || "";
const jwtSecret = process.env.JWT_SECRET || "";
const baseUrl = process.env.SMOKE_BASE_URL || "http://127.0.0.1:8080";

if (!databaseUrl || jwtSecret.length < 32) {
  throw new Error(
    "Members UI smoke test requires DATABASE_URL and a 32+ character JWT_SECRET.",
  );
}

const sql = neon(databaseUrl);
const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
const ownerEmail = `members-ui-owner-${suffix}@example.test`;
const ownerPassword = "Owner-Password-99x";
const memberEmail = `members-ui-member-${suffix}@example.test`;
const memberUsername = `ui.member.${suffix.slice(0, 6)}`;
const memberPassword = "Harbour-Lane-42x";

// What the owner ticks, and therefore exactly what the member should end up
// with. Everything else in the rail has to be absent.
const grantedModules = ["forms", "events"] as const;
const withheldModules = [
  "crm",
  "campaigns",
  "payments",
  "analytics",
  "appointments",
  "workflows",
  "files",
  "documents",
  "integrations",
] as const;
const moduleLabels: Record<string, string> = {
  forms: "Forms",
  events: "Events",
  crm: "CRM",
  campaigns: "Campaigns",
  payments: "Payments",
  analytics: "Analytics",
  appointments: "Appointments",
  workflows: "Workflows",
  files: "Files",
  documents: "Documents",
  integrations: "Integrations",
};

let assertions = 0;
const check = (condition: unknown, message: string) => {
  if (!condition) throw new Error(`FAILED: ${message}`);
  assertions += 1;
  console.log(`  ok  ${message}`);
};

const ownerId = randomUUID();
let memberUserId = "";

const cleanup = async () => {
  const ids = [ownerId, memberUserId].filter(Boolean);
  for (const id of ids) {
    await sql.query(
      `DELETE FROM workspace_member_events
       WHERE workspace_id = $1 OR member_user_id = $1 OR actor_user_id = $1`,
      [id],
    );
    await sql.query(`DELETE FROM workspace_members WHERE owner_id = $1`, [id]);
    await sql.query(`DELETE FROM workspace_members WHERE user_id = $1`, [id]);
    await sql.query(`DELETE FROM invitations WHERE invited_by = $1`, [id]);
    await sql.query(`DELETE FROM email_logs WHERE user_id = $1`, [id]);
    await sql.query(`DELETE FROM company_settings WHERE user_id = $1`, [id]);
    await sql.query(`DELETE FROM user_onboarding WHERE user_id = $1`, [id]);
    await sql.query(`DELETE FROM users WHERE id = $1`, [id]);
  }
};

/** The rail entry for a module, by its visible label. */
const railItem = (page: Page, label: string) =>
  page.locator("aside nav button", { hasText: new RegExp(`^${label}$`) });

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

  console.log("\nProvisioning a throwaway workspace owner");
  await sql.query(
    `INSERT INTO users (id, email, username, password_hash, full_name, short_id)
     VALUES ($1, $2, $3, $4, 'Smoke Owner', $5)`,
    [
      ownerId,
      ownerEmail,
      `ui.owner.${suffix.slice(0, 6)}`,
      await hash(ownerPassword, 12),
      suffix.slice(0, 5),
    ],
  );
  await sql.query(
    `INSERT INTO workspace_members (owner_id, user_id, role, status)
     VALUES ($1, $1, 'owner', 'active')
     ON CONFLICT (owner_id, user_id) DO NOTHING`,
    [ownerId],
  );
  await sql.query(
    `INSERT INTO profiles (user_id, full_name) VALUES ($1, 'Smoke Owner')
     ON CONFLICT (user_id) DO NOTHING`,
    [ownerId],
  );
  await sql.query(
    `INSERT INTO company_settings (user_id, company_name)
     VALUES ($1, 'Smoke UI Workspace')
     ON CONFLICT (user_id) DO UPDATE SET company_name = EXCLUDED.company_name`,
    [ownerId],
  );

  // The dashboard shows the onboarding wizard until this row says otherwise,
  // and the wizard would sit in front of every assertion below.
  await sql.query(
    `INSERT INTO user_onboarding (user_id, business_name, completed_at)
     VALUES ($1, 'Smoke UI Workspace', NOW())
     ON CONFLICT (user_id) DO UPDATE SET completed_at = NOW()`,
    [ownerId],
  );

  const ownerToken = await new SignJWT({ email: ownerEmail, userId: ownerId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer("maxform")
    .setAudience("maxform-dashboard")
    .setIssuedAt()
    .setExpirationTime("30m")
    .sign(new TextEncoder().encode(jwtSecret));

  browser = await chromium.launch({ headless: true });

  // ---- The owner adds a member through the real dialog. -------------------
  console.log("\nOwner opens Settings -> Members and adds someone");
  const ownerContext = await browser.newContext({
    viewport: { width: 1440, height: 950 },
  });
  await ownerContext.addInitScript((token) => {
    window.localStorage.setItem("access_token", token as string);
    window.localStorage.setItem("refresh_token", token as string);
  }, ownerToken);
  const owner = await ownerContext.newPage();
  owner.on("pageerror", (error) => {
    console.log(`  [owner page error] ${error.message}`);
  });

  await owner.goto(`${baseUrl}/dashboard?tab=settings&section=team`, {
    waitUntil: "domcontentloaded",
  });
  await owner.getByRole("button", { name: "Add member" }).waitFor({
    timeout: 30_000,
  });
  check(true, "the Members screen loads for the owner");

  // The table is the point of the screen, so it has to be there before a
  // member exists, holding the owner's own row.
  const table = owner.locator("table");
  await table.first().waitFor({ timeout: 15_000 });
  const headers = await owner.locator("table thead th").allInnerTexts();
  check(
    headers.some((value) => /Member/i.test(value)) &&
      headers.some((value) => /Role/i.test(value)) &&
      headers.some((value) => /Tab access/i.test(value)) &&
      headers.some((value) => /Status/i.test(value)) &&
      headers.some((value) => /Last active/i.test(value)),
    `the members table shows its columns (${headers.join(", ")})`,
  );
  check(
    (await owner.locator("table tbody tr").count()) === 1,
    "the owner's own row is listed before anyone is added",
  );

  await owner.getByRole("button", { name: "Add member" }).click();
  await owner.getByLabel("Full name").fill("Smoke UI Member");
  await owner.getByLabel("Work email").fill(memberEmail);
  await owner.getByLabel("Job title (optional)").fill("Operations lead");

  // Owner-chosen credentials rather than generated, so the sign-in below can
  // use them: a generated password is only ever shown once, on screen.
  await owner
    .getByText("Set sign-in details myself")
    .locator("xpath=ancestor::div[1]/following-sibling::button")
    .first()
    .click();
  await owner.getByLabel("Username").fill(memberUsername);
  await owner.getByLabel("Password", { exact: true }).fill(memberPassword);

  // Start from nothing ticked, then tick exactly the two being granted.
  await owner.getByRole("button", { name: "Clear" }).click();
  for (const key of grantedModules) {
    await owner.locator(`#module-${key}`).click();
  }

  await owner
    .getByRole("button", { name: "Create account and send details" })
    .click();

  const memberRow = owner.locator("table tbody tr", { hasText: memberEmail });
  await memberRow.waitFor({ timeout: 30_000 });
  check(true, "the new member appears in the table");

  const rowText = await memberRow.innerText();
  check(/Member/.test(rowText), "the row shows their role");
  check(
    /2 of 14 modules/.test(rowText),
    `the row summarises granted tabs (row read: ${rowText.replace(/\s+/g, " ").trim()})`,
  );
  check(
    /Not signed in yet/.test(rowText),
    "the row shows they have not signed in yet",
  );
  check(
    new RegExp(`@${memberUsername}`).test(rowText),
    "the row shows the username the owner chose",
  );

  const created = await sql.query(
    `SELECT id FROM users WHERE lower(email) = $1 LIMIT 1`,
    [memberEmail],
  );
  memberUserId = String(created[0]?.id || "");
  check(Boolean(memberUserId), "the account really exists in the database");

  // ---- The member signs in through the real form. -------------------------
  console.log("\nMember signs in with those details, in a clean browser");
  const memberContext = await browser.newContext({
    viewport: { width: 1440, height: 950 },
  });
  const memberPage = await memberContext.newPage();
  memberPage.on("pageerror", (error) => {
    console.log(`  [member page error] ${error.message}`);
  });

  await memberPage.goto(`${baseUrl}/auth`, { waitUntil: "domcontentloaded" });
  await memberPage.getByLabel(/Email or username/i).fill(memberUsername);
  await memberPage.getByLabel("Password", { exact: true }).fill(memberPassword);
  await memberPage.getByRole("button", { name: /^Sign in$/ }).click();

  await memberPage.waitForURL(/\/dashboard/, { timeout: 30_000 });
  check(true, "the member reaches the dashboard by username and password");

  // ---- The rail holds only what was granted. ------------------------------
  console.log("\nThe member's dashboard is the owner's workspace, scoped");
  await railItem(memberPage, "Home").first().waitFor({ timeout: 30_000 });
  // Read the rail once and assert against that, so a failure can say what was
  // actually offered rather than only which lookup missed.
  const railLabels = (
    await memberPage.locator("aside nav button").allInnerTexts()
  )
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  console.log(`  rail: ${railLabels.join(", ")}`);
  for (const key of grantedModules) {
    check(
      railLabels.includes(moduleLabels[key]),
      `the rail offers ${moduleLabels[key]}`,
    );
  }
  for (const key of withheldModules) {
    check(
      !railLabels.includes(moduleLabels[key]),
      `the rail withholds ${moduleLabels[key]}`,
    );
  }

  // Typing a withheld tab into the URL must not open it either.
  await memberPage.goto(`${baseUrl}/dashboard?tab=payments`, {
    waitUntil: "domcontentloaded",
  });
  await memberPage.waitForTimeout(2_500);
  check(
    !/tab=payments/.test(memberPage.url()) ||
      (await memberPage.locator("text=Payments").count()) === 0,
    `a withheld tab cannot be opened by URL (landed on ${memberPage.url()})`,
  );

  // ---- Settings, for a member. --------------------------------------------
  await memberPage.goto(`${baseUrl}/dashboard?tab=settings`, {
    waitUntil: "domcontentloaded",
  });
  await memberPage.waitForTimeout(3_000);
  const settingsNav = await memberPage
    .locator("nav button, aside button")
    .allInnerTexts();
  const settingsText = settingsNav.join(" | ");
  check(
    !/Members/.test(settingsText),
    "Settings hides the Members section from a member",
  );
  check(
    !/Billing/.test(settingsText),
    "Settings hides Billing from a member",
  );
  check(
    !/Currency/.test(settingsText),
    "Settings hides Currency from a member",
  );
  const settingsBody = await memberPage.locator("body").innerText();
  check(
    !/Workspace identity/.test(settingsBody),
    "Settings never shows workspace identity to a member",
  );
  check(
    /Security/.test(settingsText),
    "the member keeps Security, so they can change their own password",
  );

  // ---- The owner can now review that member's activity. -------------------
  console.log("\nOwner reviews the member's activity log");
  await owner.reload({ waitUntil: "domcontentloaded" });
  const reloadedRow = owner.locator("table tbody tr", { hasText: memberEmail });
  await reloadedRow.waitFor({ timeout: 30_000 });
  check(
    !/Not signed in yet/.test(await reloadedRow.innerText()),
    "the table now reports the member as having signed in",
  );

  await reloadedRow.getByRole("button", { name: /^Manage/ }).click();
  await owner.getByRole("menuitem", { name: /View activity log/ }).click();
  const activityDialog = owner.getByRole("dialog");
  await activityDialog.waitFor({ timeout: 15_000 });
  await owner.waitForTimeout(2_500);
  const activityText = await activityDialog.innerText();
  check(
    /Added to the workspace/.test(activityText),
    "the activity log records the add",
  );
  check(/Signed in/.test(activityText), "the activity log records the sign-in");
  check(
    !activityText.includes(memberPassword),
    "the activity log never displays the password",
  );

  console.log(`\n✓ Members UI smoke test passed (${assertions} checks)`);
} catch (error) {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await cleanup();
  console.log("Cleaned up the throwaway owner and member.");
}

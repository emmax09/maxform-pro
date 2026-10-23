import { neon } from "@neondatabase/serverless";
import { chromium, type BrowserContext } from "@playwright/test";
import { SignJWT } from "jose";
import { randomUUID } from "node:crypto";

const databaseUrl = process.env.DATABASE_URL || "";
const jwtSecret = process.env.JWT_SECRET || "";
const baseUrl = process.env.SMOKE_BASE_URL || "http://127.0.0.1:8080";

if (!databaseUrl || !jwtSecret) {
  throw new Error("CRM UI smoke test requires DATABASE_URL and JWT_SECRET.");
}

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
const rawSql = neon(databaseUrl);
const sql = {
  query: (...args: Parameters<typeof rawSql.query>) =>
    retryTransient(() => rawSql.query(...args)),
};
const smokeSuffix = randomUUID().replaceAll("-", "");
const smokeEmail = `crm-browser-smoke-${smokeSuffix}@example.test`;
const users = await sql.query(
  `INSERT INTO users (email, password_hash, full_name, short_id)
   VALUES ($1, 'non-login-smoke-account', 'CRM Browser Smoke', $2)
   RETURNING id, email`,
  [smokeEmail, smokeSuffix.slice(0, 6).toUpperCase()],
);
const smokeUser = users[0];

const userId = String(smokeUser.id);
const email = String(smokeUser.email);
await sql.query(
  `INSERT INTO user_onboarding (user_id, completed_at, current_step)
   VALUES ($1, NOW(), 8)
   ON CONFLICT (user_id) DO UPDATE
   SET completed_at = EXCLUDED.completed_at,
       skipped_at = NULL,
       current_step = EXCLUDED.current_step`,
  [userId],
);
const cleanupSmokeWorkspace = async () => {
  await sql.query(`DELETE FROM contacts WHERE created_by = $1`, [userId]);
  await sql.query(`DELETE FROM activity_log WHERE user_id = $1`, [userId]);
  await sql.query(`DELETE FROM users WHERE id = $1`, [userId]);
};

try {
  const pipelineRows = await sql.query(
    `INSERT INTO pipelines (
       user_id, name, description, color, is_default
     )
     VALUES (
       $1, 'CRM Smoke Pipeline', 'Browser smoke pipeline', '#635BFF', TRUE
     )
     RETURNING id`,
    [userId],
  );
  const pipelineId = String(pipelineRows[0].id);
  const stageRows = await sql.query(
    `INSERT INTO pipeline_stages (
       pipeline_id, name, order_index, probability, color, is_won, is_lost,
       required_fields, stale_after_days
     )
     VALUES
       ($1, 'New opportunity', 0, 10, '#64748B', FALSE, FALSE, '{}', 30),
       ($1, 'Qualified', 1, 45, '#2563EB', FALSE, FALSE,
        ARRAY['value', 'expected_close_date'], 14),
       ($1, 'Won', 2, 100, '#059669', TRUE, FALSE, ARRAY['value'], NULL),
       ($1, 'Lost', 3, 0, '#E11D48', FALSE, TRUE,
        ARRAY['lost_reason'], NULL)
     RETURNING id, name`,
    [pipelineId],
  );
  const stageId = String(
    stageRows.find((row) => String(row.name) === "Qualified")?.id || "",
  );
  const companyRows = await sql.query(
    `INSERT INTO companies (
       user_id, name, industry, website, owner_id, revenue_cents,
       employee_count, notes
     )
     VALUES (
       $1, 'CRM Smoke Company', 'Technology', 'https://example.test', $1,
       2500000, 25, 'Browser smoke account'
     )
     RETURNING id`,
    [userId],
  );
  const companyId = String(companyRows[0].id);
  const contactRows = await sql.query(
    `INSERT INTO contacts (
       email, full_name, phone, company, company_id, tags, custom_fields,
       created_by, owner_id, lifecycle_stage, source_type, last_activity_at
     )
     VALUES (
       $2, 'CRM Smoke Contact', '+15550101010', 'CRM Smoke Company', $3,
       '["browser-smoke"]', '{}', $1, $1, 'lead', 'manual', NOW()
     )
     RETURNING id`,
    [userId, `crm-contact-${smokeSuffix}@example.test`, companyId],
  );
  const contactId = String(contactRows[0].id);
  const listRows = await sql.query(
    `INSERT INTO contact_lists (
       user_id, name, description, list_type, filter_definition, created_by
     )
     VALUES (
       $1, 'CRM Smoke Audience', 'Browser smoke list', 'static', '[]', $1
     )
     RETURNING id`,
    [userId],
  );
  const listId = String(listRows[0].id);
  await sql.query(
    `INSERT INTO contact_list_members (
       list_id, contact_id, source_type, added_at
     )
     VALUES ($1, $2, 'manual', NOW())`,
    [listId, contactId],
  );
  await sql.query(
    `INSERT INTO contact_field_definitions (
       user_id, field_key, label, field_type, options, form_mappable
     )
     VALUES (
       $1, 'smoke_tier', 'Smoke tier', 'text', '[]', TRUE
     )`,
    [userId],
  );
  await sql.query(
    `INSERT INTO leads (
       user_id, name, email, phone, source_type, source_label, status, score,
       score_reasons, assigned_user_id, company_id, budget_cents,
       interest_notes, score_updated_at
     )
     VALUES (
       $1, 'CRM Smoke Lead', $2, '+15550101011', 'form',
       'CRM browser smoke form', 'new', 85,
       '["First-party source", "Email and phone", "Budget fit"]',
       $1, $3, 500000, 'Requested a browser smoke proposal', NOW()
     )`,
    [userId, `crm-lead-${smokeSuffix}@example.test`, companyId],
  );
  const dealRows = await sql.query(
    `INSERT INTO deals (
       user_id, name, contact_id, company_id, pipeline_id, stage_id,
       value_cents, currency, probability, expected_close_date, owner_id,
       notes
     )
     VALUES (
       $1, 'CRM Smoke Deal', $2, $3, $4, $5, 750000, 'USD', 45,
       CURRENT_DATE + 14, $1, 'Browser smoke opportunity'
     )
     RETURNING id`,
    [userId, contactId, companyId, pipelineId, stageId],
  );
  const dealId = String(dealRows[0].id);
  const taskRows = await sql.query(
    `INSERT INTO tasks (
       user_id, title, description, due_at, priority, status, contact_id,
       company_id, deal_id, assigned_user_id
     )
     VALUES (
       $1, 'CRM Smoke Task', 'Browser smoke follow-up',
       NOW() + INTERVAL '1 day', 'high', 'open', $2, $3, $4, $1
     )
     RETURNING id`,
    [userId, contactId, companyId, dealId],
  );
  await sql.query(
    `INSERT INTO crm_activities (
       user_id, activity_type, title, detail, contact_id, company_id,
       deal_id, task_id, actor_user_id, metadata
     )
     VALUES (
       $1, 'browser_smoke', 'CRM Smoke Activity',
       'Validates the unified CRM timeline', $2, $3, $4, $5, $1,
       '{"browser_smoke":true}'
     )`,
    [userId, contactId, companyId, dealId, String(taskRows[0].id)],
  );
} catch (error) {
  await cleanupSmokeWorkspace();
  throw error;
}

const accessToken = await new SignJWT({ email, userId })
  .setProtectedHeader({ alg: "HS256", typ: "JWT" })
  .setIssuer("maxform")
  .setAudience("maxform-dashboard")
  .setIssuedAt()
  .setExpirationTime("15m")
  .sign(new TextEncoder().encode(jwtSecret));

const scopedSnapshot = async () => {
  const rows = await sql.query(
    `SELECT jsonb_build_object(
       'companies', (SELECT COUNT(*) FROM companies WHERE user_id = $1),
       'contacts', (SELECT COUNT(*) FROM contacts WHERE created_by = $1),
       'leads', (SELECT COUNT(*) FROM leads WHERE user_id = $1),
       'pipelines', (SELECT COUNT(*) FROM pipelines WHERE user_id = $1),
       'stages', (
         SELECT COUNT(*)
         FROM pipeline_stages stage
         JOIN pipelines pipeline ON pipeline.id = stage.pipeline_id
         WHERE pipeline.user_id = $1
       ),
       'deals', (SELECT COUNT(*) FROM deals WHERE user_id = $1),
       'tasks', (SELECT COUNT(*) FROM tasks WHERE user_id = $1),
       'activities', (SELECT COUNT(*) FROM crm_activities WHERE user_id = $1)
     ) AS snapshot`,
    [userId],
  );
  return JSON.stringify(rows[0]?.snapshot || {});
};

const before = await scopedSnapshot();
const browser = await chromium.launch({ headless: true });
let assertions = 0;

const check = (condition: unknown, message: string) => {
  if (!condition) throw new Error(`CRM UI smoke check failed: ${message}`);
  assertions += 1;
};

const prepareContext = async (context: BrowserContext) => {
  await context.addInitScript(
    ({ token, cachedUser }) => {
      window.localStorage.setItem("access_token", token);
      window.localStorage.setItem("refresh_token", "");
      window.localStorage.setItem(
        "maxform:auth-account",
        JSON.stringify({ profile: null, user: cachedUser }),
      );
    },
    {
      token: accessToken,
      cachedUser: {
        id: userId,
        email,
        full_name: "CRM Smoke",
        created_at: new Date(0).toISOString(),
      },
    },
  );
};

const sections = [
  ["overview", "Overview", "Sales pipeline"],
  ["contacts", "Contacts", "CRM Smoke Contact"],
  ["customer360", "Customer 360", "Customers"],
  ["command-center", "Command center", "Next best actions"],
  ["companies", "Companies", "CRM Smoke Company"],
  ["leads", "Leads", "CRM Smoke Lead"],
  ["deals", "Deals", "CRM Smoke Deal"],
  ["pipelines", "Pipelines", "Multiple pipelines"],
  ["activities", "Activities", "CRM Smoke Activity"],
  ["tasks", "Tasks", "CRM Smoke Task"],
  ["calendar", "Calendar", "Unified CRM calendar"],
  ["reports", "Reports", "CRM reports"],
  ["import", "Import & export", "Import contacts"],
  ["ai", "CRM intelligence", "Why this score?"],
  ["settings", "Settings", "Deduplication"],
] as const;

try {
  const desktop = await browser.newContext({
    colorScheme: "dark",
    viewport: { height: 900, width: 1440 },
  });
  await prepareContext(desktop);
  const page = await desktop.newPage();
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 500) {
      runtimeErrors.push(`${response.status()} ${response.url()}`);
    }
  });

  for (const [section, heading, landmark] of sections) {
    await page.goto(
      `${baseUrl}/dashboard?tab=crm&section=${encodeURIComponent(section)}`,
      { waitUntil: "domcontentloaded" },
    );
    await page
      .getByRole("heading", { level: 1, name: heading, exact: true })
      .waitFor({ state: "visible", timeout: 30_000 });
    await page
      .getByText(landmark, { exact: true })
      .first()
      .waitFor({ state: "visible", timeout: 30_000 });
    check(
      (await page.getByText("CRM could not be loaded", { exact: true }).count()) ===
        0,
      `${heading} loaded workspace data`,
    );
    check(
      page.url().includes(`section=${section}`),
      `${heading} route remains active`,
    );
  }

  await page.goto(`${baseUrl}/dashboard?tab=crm&section=command-center`, {
    waitUntil: "domcontentloaded",
  });
  const globalCrmSearch = page.getByRole("textbox", {
    name: "Search all CRM records",
  });
  await globalCrmSearch.fill("CRM Smoke Contact");
  await page.getByText("CRM Smoke Contact", { exact: true }).last().waitFor({
    state: "visible",
    timeout: 30_000,
  });
  check(
    await page.getByText("CRM Smoke Contact", { exact: true }).last().isVisible(),
    "command center global search finds the seeded contact",
  );
  await page.getByText("CRM Smoke Contact", { exact: true }).last().click();
  await page
    .getByRole("heading", { level: 1, name: "Customer 360", exact: true })
    .waitFor({ state: "visible", timeout: 30_000 });
  check(
    page.url().includes("section=customer360"),
    "command center search opens the matching CRM section",
  );

  await page.goto(`${baseUrl}/dashboard?tab=crm&section=customer360`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByText("Universal timeline", { exact: true }).waitFor({
    state: "visible",
    timeout: 30_000,
  });
  check(
    await page.getByText("CRM Smoke Activity", { exact: true }).isVisible(),
    "Customer 360 renders the seeded CRM timeline event",
  );
  check(
    await page.getByText("Connected records", { exact: true }).isVisible(),
    "Customer 360 renders connected module rollups",
  );

  await page.goto(`${baseUrl}/dashboard?tab=crm&section=contacts`, {
    waitUntil: "domcontentloaded",
  });
  await page
    .getByRole("button", { name: "Import", exact: true })
    .waitFor({ state: "visible", timeout: 30_000 });
  const contactSearch = page.getByRole("searchbox", {
    name: "Search contacts",
  });
  await contactSearch.fill("CRM Smoke Contact");
  check(
    await page.getByText("CRM Smoke Contact", { exact: true }).isVisible(),
    "contact search finds the seeded relationship",
  );
  await page.getByText("CRM Smoke Contact", { exact: true }).click();
  await page
    .getByRole("button", { name: "Close contact profile" })
    .waitFor({ state: "visible" });
  const contactProfile = page.getByRole("dialog");
  for (const profileTab of ["Timeline", "Lists", "Files", "Payments", "Notes"]) {
    await contactProfile
      .getByRole("button", { name: profileTab, exact: true })
      .click();
  }
  check(
    await contactProfile
      .getByPlaceholder("Add a private note")
      .isVisible(),
    "contact profile tabs reach the private notes workflow",
  );
  await page.getByRole("button", { name: "Close contact profile" }).click();

  const contactsViews = page.getByRole("navigation", {
    name: "Contacts views",
  });
  await contactsViews.getByRole("button", { name: "Lists" }).click();
  await page
    .getByRole("heading", { level: 2, name: "Contact lists" })
    .waitFor({ state: "visible" });
  check(
    await page.getByText("CRM Smoke Audience", { exact: true }).isVisible(),
    "contact lists show their live audience",
  );
  await contactsViews.getByRole("button", { name: "Segments" }).click();
  await page
    .getByRole("heading", { level: 2, name: "Dynamic segments" })
    .waitFor({ state: "visible" });
  await contactsViews.getByRole("button", { name: "Custom fields" }).click();
  await page
    .getByRole("heading", { level: 2, name: "Custom fields" })
    .waitFor({ state: "visible" });
  check(
    await page.getByText("Smoke tier", { exact: true }).isVisible(),
    "custom contact fields render from workspace data",
  );
  await contactsViews.getByRole("button", { name: "All contacts" }).click();
  await page
    .getByRole("searchbox", { name: "Search contacts" })
    .waitFor({ state: "visible" });

  await page.getByRole("button", { name: "New contact" }).click();
  const newContactDialog = page.getByRole("dialog");
  check(
    await newContactDialog
      .getByRole("button", { name: "Create contact" })
      .isDisabled(),
    "new contact validation requires an email",
  );
  await newContactDialog
    .getByLabel("Email")
    .fill(`new-contact-${smokeSuffix}@example.test`);
  check(
    await newContactDialog
      .getByRole("button", { name: "Create contact" })
      .isEnabled(),
    "new contact validation accepts a valid draft",
  );
  await newContactDialog
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  const intelligenceNavigation = page
    .getByRole("navigation", { name: "CRM sections" })
    .getByRole("button", { name: "CRM intelligence", exact: true });
  await intelligenceNavigation.waitFor({ state: "visible" });
  check(
    await intelligenceNavigation.isVisible(),
    "CRM intelligence is visible outside More",
  );
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByText("Import contacts", { exact: true })
    .waitFor({ state: "visible" });
  await page.locator('input[type="file"]').setInputFiles({
    name: "crm-browser-smoke.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Email Address,First Name,Last Name,Phone,Company,Tags,Subscription IP,Subscription time,Confirmation time,Confirmation IP,List status,Global status,List\nada@example.test,Ada,Smoke,+10000000000,Smoke Company,vip;test,102.89.83.148,11/17/2025 21:34,11/17/2025 23:33,174.138.66.1,subscribed,subscribed,Newsletter\ngrace@example.test,Grace,Smoke,+10000000001,Smoke Company,test,102.89.83.149,11/17/2025 21:35,11/17/2025 23:34,174.138.66.2,subscribed,subscribed,Newsletter",
    ),
  });
  await page.getByText("2 ready", { exact: true }).waitFor({ state: "visible" });
  check(
    await page.getByLabel("Map Email Address").isVisible(),
    "contact import column mapping is available",
  );
  check(
    await page.getByLabel("Map First Name").isVisible(),
    "separate first names are mapped",
  );
  check(
    await page.getByText("Ada Smoke", { exact: true }).isVisible(),
    "separate name columns are combined in the preview",
  );
  check(
    (await page.getByLabel("Map Subscription IP").count()) === 0 &&
      (await page.getByLabel("Map List").count()) === 0,
    "provider subscription metadata is hidden from column mapping",
  );
  check(
    await page.getByLabel("Import destination list").isVisible(),
    "an import destination list can be selected",
  );
  check(
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Import 2 contacts" })
      .isDisabled(),
    "contact import is blocked until a destination list is selected",
  );
  await page.getByRole("button", { name: "Create list" }).click();
  check(
    await page.getByLabel("New contact list name").isVisible(),
    "a list can be created from the import modal",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  await page.getByRole("button", { name: "Export", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByText("Export contacts", { exact: true })
    .waitFor({ state: "visible" });
  check(
    await page.getByLabel("Export contact list").isVisible(),
    "contact export opens a list-selection modal",
  );
  check(
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Export 0 contacts" })
      .isDisabled(),
    "contact export waits for a list selection",
  );
  await page.getByLabel("Export contact list").click();
  await page
    .getByRole("option", { name: "CRM Smoke Audience (1)" })
    .click();
  check(
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Export 1 contact" })
      .isEnabled(),
    "contact export enables for the selected audience",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  check(
    (await page
      .getByRole("navigation", { name: "CRM sections" })
      .getByRole("button", { name: "Campaigns", exact: true })
      .count()) === 0,
    "Campaigns is removed from the CRM on-screen tabs",
  );

  await page.goto(`${baseUrl}/dashboard?tab=campaigns`, {
    waitUntil: "domcontentloaded",
  });
  await page
    .getByRole("heading", { level: 2, name: "Campaigns" })
    .waitFor({ state: "visible", timeout: 30_000 });
  const newCampaign = page.getByRole("button", { name: "New campaign" });
  await newCampaign.waitFor({ state: "visible", timeout: 30_000 });
  check(
    await newCampaign.isVisible(),
    "standalone campaign creation is visible",
  );
  check(
    await page.getByRole("button", { name: "Campaigns", exact: true }).isVisible(),
    "Campaigns is available as a standalone sidebar module",
  );
  check(
    new URL(page.url()).searchParams.get("tab") === "campaigns",
    "Campaigns uses its own top-level dashboard route",
  );

  await page.goto(`${baseUrl}/dashboard?tab=crm&section=companies`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByLabel("Search companies").waitFor({ state: "visible" });
  await page.getByLabel("Search companies").fill("CRM Smoke Company");
  check(
    await page
      .getByRole("button", { name: "Open CRM Smoke Company" })
      .isVisible(),
    "company search returns the live account",
  );
  await page
    .getByRole("button", { name: "Open CRM Smoke Company" })
    .click();
  const companyDialog = page.getByRole("dialog");
  await companyDialog
    .getByRole("heading", { name: "CRM Smoke Company" })
    .waitFor({ state: "visible" });
  check(
    await companyDialog
      .getByRole("heading", { level: 3, name: "People" })
      .isVisible(),
    "company profile rolls up linked people",
  );
  check(
    await companyDialog
      .getByText("CRM Smoke Deal", { exact: true })
      .isVisible(),
    "company profile rolls up linked deals",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "New company" }).click();
  const newCompanyDialog = page.getByRole("dialog");
  check(
    await newCompanyDialog
      .getByRole("button", { name: "Create company" })
      .isDisabled(),
    "new company validation requires a name",
  );
  await newCompanyDialog.getByLabel("Company name").fill("Draft company");
  check(
    await newCompanyDialog
      .getByRole("button", { name: "Create company" })
      .isEnabled(),
    "new company accepts a complete draft",
  );
  await newCompanyDialog
    .getByRole("button", { name: "Cancel", exact: true })
    .click();

  await page.goto(`${baseUrl}/dashboard?tab=crm&section=leads`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByLabel("Search leads").waitFor({ state: "visible" });
  check(
    await page.getByText("CRM Smoke Lead", { exact: true }).isVisible(),
    "lead board renders a scored live lead",
  );
  await page.getByLabel("Lead table view").click();
  await page.getByLabel("Select CRM Smoke Lead").click();
  await page.getByRole("button", { name: "Bulk actions" }).click();
  check(
    await page
      .getByRole("menuitem", { name: "Mark as qualified" })
      .isVisible(),
    "lead table exposes bulk qualification",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Lead actions" }).click();
  check(
    await page
      .getByRole("menuitem", { name: "Convert to contact" })
      .isVisible(),
    "lead actions expose conversion without mutating the record",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "New lead" }).click();
  const newLeadDialog = page.getByRole("dialog");
  check(
    await newLeadDialog
      .getByRole("button", { name: "Create lead" })
      .isDisabled(),
    "new lead validation requires a name or email",
  );
  await newLeadDialog.getByLabel("Lead name").fill("Draft lead");
  check(
    await newLeadDialog
      .getByRole("button", { name: "Create lead" })
      .isEnabled(),
    "new lead accepts a named draft",
  );
  await newLeadDialog
    .getByRole("button", { name: "Cancel", exact: true })
    .click();

  await page.goto(`${baseUrl}/dashboard?tab=crm&section=deals`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByLabel("Search deals").waitFor({ state: "visible" });
  await page.getByLabel("Deal list view").click();
  await page
    .getByRole("button", { name: "Open CRM Smoke Deal" })
    .click();
  const dealDialog = page.getByRole("dialog");
  check(
    await dealDialog
      .getByRole("heading", { level: 3, name: "Linked relationship" })
      .isVisible(),
    "deal detail shows its linked relationship",
  );
  check(
    await dealDialog
      .getByRole("heading", { level: 3, name: "Deal timeline" })
      .isVisible(),
    "deal detail exposes its activity timeline",
  );
  await page.keyboard.press("Escape");
  await page.getByLabel("Deal calendar view").click();
  check(
    await page.getByText("CRM Smoke Deal", { exact: true }).isVisible(),
    "deal calendar renders expected close dates",
  );
  await page.getByLabel("Deal board view").click();
  await page.getByRole("button", { name: "New deal" }).click();
  const newDealDialog = page.getByRole("dialog");
  check(
    await newDealDialog
      .getByRole("button", { name: "Create deal" })
      .isDisabled(),
    "new deal validation requires a name",
  );
  await newDealDialog.getByLabel("Deal name").fill("Draft deal");
  check(
    await newDealDialog
      .getByRole("button", { name: "Create deal" })
      .isEnabled(),
    "new deal uses the default pipeline and stage",
  );
  await newDealDialog
    .getByRole("button", { name: "Cancel", exact: true })
    .click();

  await page.goto(`${baseUrl}/dashboard?tab=crm&section=pipelines`, {
    waitUntil: "domcontentloaded",
  });
  await page
    .getByRole("button", { name: "New pipeline" })
    .waitFor({ state: "visible" });
  check(
    (await page.getByRole("button", { name: /^Manage .* pipeline$/ }).count()) >
      0,
    "pipeline management actions are visible",
  );
  await page
    .getByRole("button", { name: "Manage CRM Smoke Pipeline pipeline" })
    .click();
  await page.getByRole("menuitem", { name: "Edit pipeline" }).click();
  check(
    await page.getByRole("dialog").getByText("Default pipeline").isVisible(),
    "pipeline editor exposes the default-pipeline control",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await page.getByRole("button", { name: "Add stage" }).click();
  const stageDialog = page.getByRole("dialog");
  check(
    await stageDialog.getByLabel("Stage type").isVisible(),
    "stage editor exposes forecasting and terminal-stage controls",
  );
  await stageDialog
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await page.getByRole("button", { name: "Manage Qualified stage" }).click();
  await page.getByRole("menuitem", { name: "Edit stage" }).click();
  check(
    await page
      .getByRole("dialog")
      .getByText("Required before entering this stage")
      .isVisible(),
    "existing stage rules are editable",
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();

  await page.goto(`${baseUrl}/dashboard?tab=crm&section=activities`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByLabel("Search CRM activities").waitFor({ state: "visible" });
  await page.getByLabel("Search CRM activities").fill("CRM Smoke Activity");
  check(
    await page.getByText("CRM Smoke Activity", { exact: true }).isVisible(),
    "activity search finds the unified timeline event",
  );
  await page.getByLabel("Select CRM Smoke Activity").click();
  await page.getByRole("button", { name: "Bulk actions" }).click();
  check(
    await page
      .getByRole("menuitem", { name: "Create follow-up tasks" })
      .isVisible(),
    "activity selection exposes follow-up actions",
  );
  await page.keyboard.press("Escape");

  await page.goto(`${baseUrl}/dashboard?tab=crm&section=tasks`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByLabel("Search CRM tasks").waitFor({ state: "visible" });
  await page.getByLabel("Task board view").click();
  check(
    await page.getByText("CRM Smoke Task", { exact: true }).isVisible(),
    "task board renders the live follow-up",
  );
  await page.getByLabel("Task calendar view").click();
  check(
    await page.getByText("CRM Smoke Task", { exact: true }).isVisible(),
    "task calendar renders scheduled work",
  );
  await page.getByLabel("Task list view").click();
  await page.getByLabel("Select CRM Smoke Task").click();
  await page.getByRole("button", { name: "Bulk actions" }).click();
  check(
    await page
      .getByRole("menuitem", { name: "Mark completed" })
      .isVisible(),
    "task list exposes bulk completion",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "New task" }).click();
  const newTaskDialog = page.getByRole("dialog");
  check(
    await newTaskDialog
      .getByRole("button", { name: "Create task" })
      .isDisabled(),
    "new task validation requires a title",
  );
  await newTaskDialog.getByLabel("Task title").fill("Draft task");
  check(
    await newTaskDialog
      .getByRole("button", { name: "Create task" })
      .isEnabled(),
    "new task accepts a titled draft",
  );
  await newTaskDialog
    .getByRole("button", { name: "Cancel", exact: true })
    .click();

  await page.goto(`${baseUrl}/dashboard?tab=crm&section=calendar`, {
    waitUntil: "domcontentloaded",
  });
  await page
    .getByRole("heading", { level: 2, name: "Unified CRM calendar" })
    .waitFor({ state: "visible" });
  await page.getByRole("button", { name: "Deal closes" }).click();
  await page.getByRole("button", { name: "Deal closes" }).click();
  check(
    await page.getByText("CRM Smoke Task", { exact: true }).isVisible(),
    "unified calendar keeps scheduled tasks visible while layers toggle",
  );

  await page.goto(`${baseUrl}/dashboard?tab=crm&section=reports`, {
    waitUntil: "domcontentloaded",
  });
  await page
    .getByRole("heading", { level: 2, name: "CRM reports" })
    .waitFor({ state: "visible" });
  const [reportDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export report" }).click(),
  ]);
  check(
    reportDownload.suggestedFilename().endsWith(".csv"),
    "CRM report exports as CSV",
  );

  await page.goto(`${baseUrl}/dashboard?tab=crm&section=ai`, {
    waitUntil: "domcontentloaded",
  });
  await page.getByText("Why this score?", { exact: true }).waitFor();
  await page.getByText("Review leads", { exact: true }).click();
  await page
    .getByRole("heading", { level: 1, name: "Leads", exact: true })
    .waitFor();
  check(
    page.url().includes("section=leads"),
    "CRM intelligence links to the underlying live records",
  );

  await page.goto(`${baseUrl}/dashboard?tab=crm&section=settings`, {
    waitUntil: "domcontentloaded",
  });
  await page
    .getByRole("heading", { level: 2, name: "Deduplication" })
    .waitFor({ state: "visible" });
  const lifecycleDraft = page.getByPlaceholder("New lifecycle stage");
  await lifecycleDraft.fill("Browser smoke stage");
  check(
    await page.getByRole("button", { name: "Add", exact: true }).isEnabled(),
    "CRM settings validate a new lifecycle stage",
  );
  check(
    await page
      .getByRole("button", { name: "Save CRM settings" })
      .isVisible(),
    "CRM settings expose an explicit save action",
  );

  check(runtimeErrors.length === 0, "desktop CRM has no runtime or 5xx errors");
  await desktop.close();

  const mobile = await browser.newContext({
    colorScheme: "dark",
    isMobile: true,
    viewport: { height: 844, width: 390 },
  });
  await prepareContext(mobile);
  const mobilePage = await mobile.newPage();
  const mobileErrors: string[] = [];
  mobilePage.on("pageerror", (error) => mobileErrors.push(error.message));
  mobilePage.on("response", (response) => {
    if (response.status() >= 500) {
      mobileErrors.push(`${response.status()} ${response.url()}`);
    }
  });
  await mobilePage.goto(`${baseUrl}/dashboard?tab=crm&section=pipelines`, {
    waitUntil: "domcontentloaded",
  });
  await mobilePage
    .getByRole("heading", { level: 1, name: "Pipelines", exact: true })
    .waitFor({ state: "visible", timeout: 30_000 });
  await mobilePage
    .getByRole("button", { name: "New pipeline" })
    .waitFor({ state: "visible", timeout: 30_000 });
  check(
    await mobilePage.getByRole("button", { name: "New pipeline" }).isVisible(),
    "mobile pipeline creation remains visible",
  );
  const horizontalOverflow = await mobilePage.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  check(horizontalOverflow <= 2, "mobile CRM has no page-level overflow");
  check(mobileErrors.length === 0, "mobile CRM has no runtime or 5xx errors");
  await mobile.close();
  const after = await scopedSnapshot();
  check(before === after, "browser smoke did not change CRM row counts");
} finally {
  await browser.close();
  await cleanupSmokeWorkspace();
}

process.stdout.write(
  `CRM browser smoke test passed (${assertions} assertions across all sections, real-user interactions, desktop, and mobile; all test data removed).\n`,
);

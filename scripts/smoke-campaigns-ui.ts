/**
 * Browser smoke test for the Campaigns v2 flow.
 *
 * jsdom cannot tell whether the full-screen builder actually covers the
 * dashboard, whether a slide-out panel is off-canvas, or what the dark preview
 * surface looks like — those are layout and paint concerns. This drives the
 * real app in Chromium and captures each stage.
 */
import { neon } from "@neondatabase/serverless";
import { chromium, type BrowserContext } from "@playwright/test";
import { SignJWT } from "jose";
import { randomUUID } from "node:crypto";

const databaseUrl = process.env.DATABASE_URL || "";
const jwtSecret = process.env.JWT_SECRET || "";
const baseUrl = process.env.SMOKE_BASE_URL || "http://127.0.0.1:8080";

if (!databaseUrl || !jwtSecret) {
  throw new Error("Campaigns UI smoke test requires DATABASE_URL and JWT_SECRET.");
}

const sql = neon(databaseUrl);
const smokeSuffix = randomUUID().replaceAll("-", "");
const smokeEmail = `campaigns-browser-smoke-${smokeSuffix}@example.test`;

const users = await sql.query(
  `INSERT INTO users (email, password_hash, full_name, short_id)
   VALUES ($1, 'non-login-smoke-account', 'Campaigns Browser Smoke', $2)
   RETURNING id, email`,
  [smokeEmail, smokeSuffix.slice(0, 5)],
);
const userId = String(users[0].id);
const email = String(users[0].email);

// This run exercises Campaigns, not signup, so the workspace starts already
// onboarded — otherwise the onboarding gate stands in front of the dashboard.
await sql.query(
  `INSERT INTO user_onboarding (user_id, business_name, completed_at)
   VALUES ($1, 'Campaigns Smoke Co', NOW())
   ON CONFLICT (user_id) DO UPDATE SET completed_at = NOW()`,
  [userId],
);

const cleanup = async () => {
  const statements: Array<[string, string[]]> = [
    [`DELETE FROM user_onboarding WHERE user_id = $1`, [userId]],
    [`DELETE FROM contact_campaigns WHERE user_id = $1`, [userId]],
    [`DELETE FROM contact_campaign_settings WHERE user_id = $1`, [userId]],
    [`DELETE FROM contacts WHERE created_by = $1`, [userId]],
    [`DELETE FROM contact_lists WHERE user_id = $1`, [userId]],
    [`DELETE FROM email_identities WHERE user_id = $1`, [userId]],
    [`DELETE FROM email_settings WHERE user_id = $1`, [userId]],
    [`DELETE FROM users WHERE id = $1`, [userId]],
  ];
  for (const [statement, params] of statements) {
    await sql.query(statement, params).catch(() => undefined);
  }
};

let assertions = 0;
const check = (condition: unknown, message: string) => {
  if (!condition) throw new Error(`Campaigns UI smoke check failed: ${message}`);
  assertions += 1;
};

try {
  const listRows = await sql.query(
    `INSERT INTO contact_lists (
       user_id, created_by, name, description, list_type
     )
     VALUES ($1, $1, 'Newsletter subscribers', 'Smoke audience', 'static')
     RETURNING id`,
    [userId],
  );
  const listId = String(listRows[0].id);
  const vipRows = await sql.query(
    `INSERT INTO contact_lists (
       user_id, created_by, name, description, list_type
     )
     VALUES ($1, $1, 'VIP customers', 'Smoke VIP audience', 'static')
     RETURNING id`,
    [userId],
  );
  const vipListId = String(vipRows[0].id);

  await sql.query(
    `WITH created_contacts AS (
       INSERT INTO contacts (created_by, full_name, email, lifecycle_stage)
       SELECT $1,
              'Smoke Contact ' || sequence::text,
              'smoke-' || sequence::text || '-' || $2 || '@example.test',
              'subscriber'
       FROM generate_series(0, 139) AS sequence
       RETURNING id
     )
     INSERT INTO contact_list_members (list_id, contact_id, source_type)
     SELECT $3, id, 'manual'
     FROM created_contacts
     ON CONFLICT DO NOTHING`,
    [userId, smokeSuffix, listId],
  );
  await sql.query(
    `INSERT INTO contact_list_members (list_id, contact_id, source_type)
     SELECT $2, contact.id, 'manual'
     FROM contacts contact
     WHERE contact.created_by = $1
     ORDER BY contact.created_at, contact.id
     LIMIT 20
     ON CONFLICT DO NOTHING`,
    [userId, vipListId],
  );

  await sql.query(
    `INSERT INTO contact_campaign_settings (
       user_id, mailing_address, footer_text, brand_voice
     )
     VALUES ($1, '1 Example Street, Lagos', 'Sent by Smoke', 'friendly')
     ON CONFLICT (user_id) DO NOTHING`,
    [userId],
  );
  // Left in managed sending mode. The flow refuses to leave step one on an
  // unverified sender, which is correct, and a managed identity is ready as
  // soon as it has a valid address — no custom domain to verify.
  await sql.query(
    `INSERT INTO email_identities (
       user_id, sender_name, sender_email, domain, dkim_selector, is_default
     )
     VALUES ($1, 'Smoke Sender', $2, 'example.test', 'default', TRUE)`,
    [userId, `sender-${smokeSuffix}@example.test`],
  );

  // The sender only counts as ready once the workspace has a working delivery
  // route. Managed sending is the simplest one, and its credentials come from
  // the environment rather than from a connection row.
  await sql.query(
    `INSERT INTO email_settings (user_id, active_provider, active_provider_mode,
       managed_sending_enabled)
     VALUES ($1, 'resend', 'managed', TRUE)
     ON CONFLICT (user_id) DO UPDATE SET active_provider = 'resend',
       active_provider_mode = 'managed', managed_sending_enabled = TRUE`,
    [userId],
  );

  const accessToken = await new SignJWT({ email, userId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer("maxform")
    .setAudience("maxform-dashboard")
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(new TextEncoder().encode(jwtSecret));

  const browser = await chromium.launch({ headless: true });
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
          full_name: "Campaigns Smoke",
          created_at: new Date(0).toISOString(),
        },
      },
    );
  };

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  await prepareContext(context);
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text().slice(0, 300));
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && response.url().includes("/api/")) {
      consoleErrors.push(`${response.status()} ${response.url().slice(0, 160)}`);
    }
  });

  await page.goto(`${baseUrl}/dashboard?tab=campaigns`, {
    waitUntil: "domcontentloaded",
  });
  try {
    await page
      .getByRole("heading", { level: 2, name: "Campaigns" })
      .waitFor({ state: "visible", timeout: 45_000 });
  } catch (error) {
    await page.screenshot({ path: "artifacts/campaigns-dashboard-load-failed.png" });
    throw new Error(
      `${error instanceof Error ? error.message : "The campaigns dashboard did not load."} API/console: ${consoleErrors.join(" | ")}`,
    );
  }

  // The tab strip is the v2 set only.
  const nav = page.getByRole("navigation", { name: "Campaign sections" });
  // Templates joined this list: it is step two of the create flow now, not a
  // place you navigate to.
  for (const gone of ["Audience", "Builder", "Scheduling", "Templates"]) {
    check(
      (await nav.getByRole("button", { name: gone, exact: true }).count()) === 0,
      `${gone} is no longer a persistent tab`,
    );
  }
  check(
    (await page.getByRole("button", { name: "Save draft" }).count()) === 0,
    "the list screen carries no Save draft for a draft it does not show",
  );

  /* --------------------------------------------------- the create flow ---- */
  await page.getByRole("button", { name: /New campaign/ }).click();
  const flow = page.getByRole("dialog");
  await flow.waitFor({ state: "visible", timeout: 30_000 });

  // Step one is settings, and it opens with the sender already resolved.
  await flow
    .getByRole("heading", { name: "Campaign settings" })
    .waitFor({ state: "visible", timeout: 15_000 });

  // Builder-sized, centred, with the dashboard greyed behind it rather than
  // replaced — the list is still in the DOM underneath.
  const flowBox = await flow.boundingBox();
  const vp = page.viewportSize();
  check(
    flowBox && vp && flowBox.width > vp.width * 0.85 && flowBox.width < vp.width,
    "the flow is a large centred modal, not edge-to-edge",
  );
  // A CSS locator, not a role query: an open modal marks the rest of the page
  // aria-hidden, so the tab strip is present in the DOM but out of the
  // accessibility tree — which is exactly the state being asserted.
  check(
    (await page.locator('nav[aria-label="Campaign sections"]').count()) === 1,
    "the campaign list stays mounted behind the modal",
  );

  const flowAdvance = flow.getByRole("button", { name: "Save and continue" });
  check(
    await flowAdvance.isDisabled(),
    "step one will not advance without a subject line",
  );

  // The sender is read from the Email module rather than typed here, so it
  // arrives with its own request. Step one stays locked until it lands — an
  // unverified or missing sender is a real reason not to continue.
  await flow
    .getByText("Smoke Sender", { exact: true })
    .first()
    .waitFor({ state: "visible", timeout: 20_000 });
  // Read-only on purpose: the address comes from the verified identity, so
  // there is nothing here to type a different one into.
  check(
    (await flow.getByRole("textbox", { name: /From name/ }).count()) === 0 &&
      (await flow.getByRole("textbox", { name: /Sender.*email/i }).count()) === 0,
    "the sender is shown from the identity rather than collected again",
  );

  await flow.getByLabel("Email subject").fill("48 hours: 20% off");
  await flow.getByLabel("Email preview text").fill("Ends Friday at midnight.");
  check(
    await flowAdvance.isEnabled(),
    "a subject line is what unlocks the rest of the flow",
  );

  /* ------------------------------------------- the close guard ------------ */
  // There is now unsaved work, so every exit has to ask first.
  await flow.getByRole("button", { name: "Close campaign flow" }).click();
  const exitPrompt = page.getByRole("alertdialog");
  await exitPrompt.waitFor({ state: "visible", timeout: 15_000 });
  check(
    await exitPrompt.getByText(/Save your changes\?/).isVisible(),
    "closing with unsaved work asks before discarding it",
  );
  await page.screenshot({ path: "artifacts/campaigns-flow-exit-prompt.png" });
  await exitPrompt.getByRole("button", { name: "Keep editing" }).click();
  await exitPrompt.waitFor({ state: "hidden", timeout: 15_000 });
  check(
    await flow.isVisible(),
    "keeping editing leaves the flow open on the same step",
  );
  check(
    (await flow.getByLabel("Email subject").inputValue()) === "48 hours: 20% off",
    "the typed subject survives a cancelled close",
  );

  // Escape routes through the same guard rather than discarding silently.
  await page.keyboard.press("Escape");
  await exitPrompt.waitFor({ state: "visible", timeout: 15_000 });
  await exitPrompt.getByRole("button", { name: "Keep editing" }).click();
  await exitPrompt.waitFor({ state: "hidden", timeout: 15_000 });
  check(await flow.isVisible(), "Escape asks before closing too");
  await page.waitForTimeout(300);
  await page.screenshot({
    path: "artifacts/campaigns-flow-settings.png",
    fullPage: false,
  });

  // Step two: the template gallery, inside the flow.
  await flowAdvance.click();
  await flow
    .getByRole("heading", { name: "Design your email" })
    .waitFor({ state: "visible", timeout: 15_000 });
  check(
    await flow.getByRole("button", { name: /Drag and drop builder/ }).isVisible(),
    "the design step offers builder, plain text and custom HTML",
  );
  await flow.getByPlaceholder("Find template by name").fill("");
  await page.waitForTimeout(600);
  await page.screenshot({
    path: "artifacts/campaigns-flow-design.png",
    fullPage: false,
  });

  /* ---------------------------- the other two authoring modes ------------- */
  // Plain text and custom HTML each open their own full-screen editor with the
  // builder's header — not the block palette, and not a description card.
  await flow.getByRole("button", { name: /Plain text email/ }).click();
  await flow
    .getByRole("heading", { name: "Plain text email" })
    .waitFor({ state: "visible", timeout: 15_000 });
  await flow.getByRole("button", { name: "Start creating" }).click();

  const textBuilder = page.getByRole("region", { name: "Campaign builder" });
  await textBuilder.waitFor({ state: "visible", timeout: 30_000 });
  const typePanel = page.getByRole("complementary", { name: "Type settings" });
  await typePanel.waitFor({ state: "visible", timeout: 20_000 });
  check(
    (await page.getByRole("complementary", { name: "Blocks" }).count()) === 0,
    "the text editor has no block palette",
  );
  check(
    await typePanel.getByLabel("Link colour", { exact: true }).isVisible(),
    "the type panel exposes the link colour",
  );
  check(
    await page.getByRole("button", { name: "Save draft" }).isDisabled(),
    "a clean simple builder keeps Save draft disabled",
  );
  for (const field of [
    "Body text font family",
    "Body text font size",
    "Heading 1 font size",
    "Heading 2 font size",
    "Heading 3 font size",
    "Language",
  ]) {
    check(
      await typePanel.getByLabel(field).isVisible(),
      `the type panel exposes ${field.toLowerCase()}`,
    );
  }

  // The document's own type settings drive the writing surface.
  await typePanel.getByLabel("Body text font size").fill("19");
  const bodyField = page.getByLabel("Plain text body");
  await bodyField.fill("Hi there,\n\nShort note, no styling.");
  check(
    (await bodyField.evaluate((node) => getComputedStyle(node).fontSize)) === "19px",
    "the canvas is styled with the document's own type settings",
  );

  // Variables are inserted by name; the token is never shown to read.
  await page.getByRole("button", { name: /^Variable/ }).click();
  const variableMenu = page.getByRole("dialog").last();
  await variableMenu.getByText("First name").waitFor({ state: "visible", timeout: 15_000 });
  check(
    (await variableMenu.getByText("{{contact.firstName}}").count()) === 0,
    "the variable menu shows labels, never raw tokens",
  );
  await variableMenu.getByText("First name").click();
  check(
    (await bodyField.inputValue()).includes("{{contact.firstName}}"),
    "picking a variable writes its token into the message",
  );
  await page.waitForTimeout(250);
  await page.screenshot({
    path: "artifacts/campaigns-plain-text-builder.png",
    fullPage: false,
  });

  /* ------------------------------------------ start from scratch ---------- */
  await page.getByRole("button", { name: /Start from scratch/ }).click();
  const startOver = page.getByRole("alertdialog");
  await startOver.waitFor({ state: "visible", timeout: 15_000 });
  check(
    await startOver.getByText(/discarded/i).isVisible(),
    "starting again warns that the work is discarded",
  );
  await page.screenshot({ path: "artifacts/campaigns-start-over.png" });
  await startOver.getByRole("button", { name: /Keep what I have/ }).click();
  await startOver.waitFor({ state: "hidden", timeout: 15_000 });
  check(
    (await bodyField.inputValue()).length > 0,
    "backing out of starting again keeps the writing",
  );

  await page.getByRole("button", { name: /Start from scratch/ }).click();
  await startOver.waitFor({ state: "visible", timeout: 15_000 });
  await startOver.getByRole("button", { name: /Discard and start again/ }).click();
  // Back to the design step, on the template gallery.
  await flow
    .getByRole("heading", { name: "Design your email" })
    .waitFor({ state: "visible", timeout: 30_000 });
  check(
    await flow.getByPlaceholder("Find template by name").isVisible(),
    "starting again lands back on the template gallery",
  );

  /* ------------------------------------------------- custom HTML ---------- */
  await flow.getByRole("button", { name: /Custom HTML email/ }).click();
  await flow.getByRole("button", { name: "Start creating" }).click();
  const htmlBuilder = page.getByRole("region", { name: "Campaign builder" });
  await htmlBuilder.waitFor({ state: "visible", timeout: 30_000 });
  const htmlField = page.getByLabel("Custom HTML source");
  await htmlField.waitFor({ state: "visible", timeout: 20_000 });
  await htmlField.fill("<h1>Hand written</h1><p>Sent exactly as typed.</p>");
  await page
    .frameLocator('iframe[title="Custom HTML preview"]')
    .getByRole("heading", { name: "Hand written" })
    .waitFor({ state: "visible", timeout: 15_000 });
  check(true, "custom HTML renders beside its source in a sandboxed preview");
  check(
    await page.getByLabel("Subject line").isVisible(),
    "the HTML editor keeps the builder's inbox bar",
  );
  await page.waitForTimeout(250);
  await page.screenshot({
    path: "artifacts/campaigns-html-builder.png",
    fullPage: false,
  });

  // Back to the block builder for the rest of the run.
  await page.getByRole("button", { name: /Start from scratch/ }).click();
  await startOver.waitFor({ state: "visible", timeout: 15_000 });
  await startOver.getByRole("button", { name: /Discard and start again/ }).click();
  await flow
    .getByRole("heading", { name: "Design your email" })
    .waitFor({ state: "visible", timeout: 30_000 });

  // Template → full-screen builder.
  await flow.getByRole("button", { name: "Start creating" }).click();
  const builder = page.getByRole("region", { name: "Campaign builder" });
  await builder.waitFor({ state: "visible", timeout: 30_000 });
  check(
    (await page
      .getByRole("navigation", { name: "Campaign sections" })
      .count()) === 0,
    "the dashboard tab strip is gone inside the builder",
  );

  // A large centred workspace: dominant, but inset from the viewport rather
  // than a bare full-screen takeover.
  const box = await builder.boundingBox();
  const viewport = page.viewportSize();
  check(
    box && viewport && box.width > viewport.width * 0.85 &&
      box.width < viewport.width,
    "the builder is a large centred panel, not edge-to-edge",
  );
  check(
    box && viewport && Math.abs(box.x - (viewport.width - box.width) / 2) < 4,
    "the builder is horizontally centred",
  );
  await page.waitForTimeout(400);
  await page.screenshot({ path: "artifacts/campaigns-builder-fullscreen.png" });

  // The block palette is docked and readable straight away, not hidden behind
  // a toggle.
  const palette = page.getByRole("complementary", { name: "Blocks" });
  await palette.waitFor({ state: "visible", timeout: 15_000 });
  const paletteBox = await palette.boundingBox();
  check(
    paletteBox && paletteBox.x >= 0 && paletteBox.width > 200,
    "the block palette is docked on the left and visible on arrival",
  );
  check(
    await palette
      .getByRole("button", { name: "Heading", exact: true })
      .isVisible(),
    "block types are readable without opening anything",
  );

  // Search matches what a block is for, not only its name.
  await page.getByLabel("Search blocks").fill("discount");
  await page.waitForTimeout(300);
  check(
    await palette
      .getByRole("button", { name: "Coupon code", exact: true })
      .isVisible(),
    "palette search matches a block by what it is for",
  );
  check(
    (await palette
      .getByRole("button", { name: "Heading", exact: true })
      .count()) === 0,
    "palette search filters out blocks that do not match",
  );
  await page.getByLabel("Search blocks").fill("");
  await page.waitForTimeout(300);

  // Settings live on the right, split into Details / Design / Advanced.
  const settingsPanel = page.getByRole("complementary", {
    name: "Block settings",
  });
  const settingsBox = await settingsPanel.boundingBox();
  check(
    settingsBox && paletteBox && settingsBox.x > paletteBox.x,
    "block settings sit on the right, opposite the palette",
  );
  check(
    await settingsPanel.getByText("Campaign container").isVisible(),
    "the panel edits the campaign container while no block is selected",
  );
  // Subject and preview line sit above the canvas, always visible.
  check(
    await page.getByLabel("Subject line").isVisible() &&
      await page.getByLabel("Preview line").isVisible(),
    "subject and preview line stay visible above the canvas",
  );

  await page
    .getByRole("button", { name: /^Select Heading block/ })
    .first()
    .click();
  await page.waitForTimeout(350);
  check(
    (await settingsPanel
      .getByRole("tab", { name: "Details" })
      .getAttribute("aria-selected")) === "true",
    "picking a block opens its Details on the right",
  );

  await settingsPanel.getByRole("tab", { name: "Design" }).click();
  await page.waitForTimeout(250);
  // Typography and colour open by default; spacing is one click away.
  check(
    await settingsPanel.getByLabel("Text colour").isVisible(),
    "the Design tab exposes an editable colour on every block",
  );
  check(
    await settingsPanel.getByRole("radiogroup", { name: "Weight" }).isVisible(),
    "typography uses segmented controls rather than dropdowns",
  );
  // The Design tab opens on the element layer, and names what it styles.
  check(
    (await settingsPanel
      .getByRole("tab", { name: /The heading/ })
      .getAttribute("aria-selected")) === "true",
    "the Design tab opens on the element, not the block wrapper",
  );
  await settingsPanel.getByRole("button", { name: /^Border/ }).click();
  await page.waitForTimeout(300);
  check(
    await settingsPanel
      .getByRole("spinbutton", { name: "Width" })
      .first()
      .isVisible(),
    "the element layer carries its own border, so it lands on the element",
  );

  // The block layer is a separate set of controls with its own spacing.
  await settingsPanel.getByRole("tab", { name: /The block/ }).click();
  await page.waitForTimeout(300);
  check(
    await settingsPanel.getByLabel("Padding Top").isVisible(),
    "the container layer exposes per-side padding",
  );
  check(
    await settingsPanel.getByLabel("Block background").isVisible(),
    "the container layer owns the block's background",
  );
  await page.screenshot({ path: "artifacts/campaigns-builder-design-tab.png" });

  await settingsPanel.getByRole("tab", { name: "Advanced" }).click();
  await page.waitForTimeout(250);
  check(
    await settingsPanel.getByLabel("Custom CSS").isVisible(),
    "the Advanced tab exposes the escape hatches",
  );
  await page.screenshot({ path: "artifacts/campaigns-builder-settings.png" });

  // Adding a block from the palette puts it on the canvas and selects it.
  const blockCountBefore = await page
    .getByRole("button", { name: /^Select .* block, / })
    .count();
  await palette
    .getByRole("button", { name: "Coupon code", exact: true })
    .click();
  await page.waitForTimeout(400);
  const blockCountAfter = await page
    .getByRole("button", { name: /^Select .* block, / })
    .count();
  check(
    blockCountAfter === blockCountBefore + 1,
    "adding a block from the palette puts it on the canvas",
  );
  check(
    (await settingsPanel
      .getByRole("tab", { name: "Details" })
      .getAttribute("aria-selected")) === "true",
    "a newly added block opens straight into its Details",
  );

  // Preview drops the editing chrome without leaving the builder.
  await page.getByRole("button", { name: /Preview/ }).click();
  await page.waitForTimeout(400);
  check(
    await page.getByRole("region", { name: "Campaign preview" }).isVisible(),
    "the canvas can render a clean preview of the campaign",
  );
  await page.screenshot({ path: "artifacts/campaigns-builder-preview.png" });
  await page.getByRole("button", { name: /^Edit/ }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "artifacts/campaigns-builder-palette.png" });

  check(
    (await page.getByLabel("Dark builder theme").count()) === 0 &&
      (await page.getByLabel("Light builder theme").count()) === 0,
    "the builder inherits the dashboard theme without a second theme switch",
  );
  await page.screenshot({ path: "artifacts/campaigns-builder-theme.png" });

  // Mobile preview re-renders the canvas narrower.
  await page.getByLabel("Mobile preview").click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "artifacts/campaigns-builder-mobile.png" });
  await page.getByLabel("Desktop preview").click();

  // Save & Continue → the send wizard.
  await page.getByLabel("Campaign name").fill("Smoke flash sale");

  // Leaving with unsaved edits asks first rather than discarding silently.
  await page.getByRole("button", { name: /^Exit/ }).click();
  const savePrompt = page.getByRole("dialog");
  await savePrompt.waitFor({ state: "visible", timeout: 15_000 });
  check(
    await savePrompt.getByText(/Save your changes\?/).isVisible(),
    "exiting with unsaved work prompts to save it",
  );
  await page.screenshot({ path: "artifacts/campaigns-builder-save-prompt.png" });
  await savePrompt.getByRole("button", { name: /Keep editing/ }).click();
  await savePrompt.waitFor({ state: "hidden", timeout: 15_000 });
  check(
    await builder.isVisible(),
    "keeping editing returns to the builder with the work intact",
  );

  /* ------------------------------- back into the flow, then the wizard ---- */
  await page.getByRole("button", { name: /Save & Continue/ }).click();

  // The builder now hands back to step three of the flow rather than jumping
  // straight to the wizard.
  const recipientsStep = page.getByRole("dialog");
  try {
    await recipientsStep.waitFor({ state: "visible", timeout: 45_000 });
  } catch (error) {
    await page.screenshot({ path: "artifacts/campaigns-flow-transition-failed.png" });
    throw new Error(
      `${error instanceof Error ? error.message : "The flow did not reopen."} API/console: ${consoleErrors.join(" | ")}`,
    );
  }
  await recipientsStep
    .getByText(/Selected recipients/)
    .waitFor({ state: "visible", timeout: 30_000 });
  check(
    (await recipientsStep.getByRole("checkbox").count()) > 0,
    "recipients are picked from multiple CRM lists",
  );
  check(
    (await recipientsStep.getByText("Newsletter subscribers").count()) > 0,
    "the CRM's own list is what the flow offers",
  );
  const vipCheckbox = recipientsStep.getByRole("checkbox", {
    name: "Select VIP customers",
  });
  await vipCheckbox.click();
  check(
    (await vipCheckbox.getAttribute("data-state")) === "checked",
    "a second CRM list can be selected in the primary flow",
  );
  await page.waitForTimeout(300);
  await page.screenshot({
    path: "artifacts/campaigns-flow-recipients.png",
    fullPage: false,
  });

  await recipientsStep
    .getByRole("button", { name: "Save and continue" })
    .click();
  await recipientsStep
    .getByRole("heading", { name: "Review and send" })
    .waitFor({ state: "visible", timeout: 30_000 });
  check(
    await recipientsStep.getByRole("button", { name: "Send now" }).isVisible(),
    "the review step can send without leaving the flow",
  );
  await page.waitForTimeout(400);
  await page.screenshot({
    path: "artifacts/campaigns-flow-review.png",
    fullPage: false,
  });

  await recipientsStep
    .getByRole("button", { name: /Open the full send wizard/ })
    .click();
  const wizard = page.getByRole("region", { name: "Campaign send wizard" });
  await wizard.waitFor({ state: "visible", timeout: 45_000 });
  await page
    .getByRole("heading", { name: /Who receives this/ })
    .waitFor({ state: "visible", timeout: 30_000 });
  await page
    .getByText("Will receive this")
    .waitFor({ state: "visible", timeout: 30_000 });
  await wizard
    .getByRole("button", { name: /Enter emails manually/ })
    .click();
  const customRecipientInput = wizard.getByLabel("Recipient email addresses");
  await customRecipientInput.fill("custom-one@example.test");
  await customRecipientInput.press("Enter");
  await customRecipientInput.fill("custom-two@example.test");
  await customRecipientInput.press("Enter");
  await wizard.getByText("2 emails").waitFor({ state: "visible", timeout: 30_000 });
  check(
    (await wizard.getByText("custom-one@example.test").count()) > 0 &&
      (await wizard.getByText("custom-two@example.test").count()) > 0,
    "custom recipients can be entered one by one without a CRM list",
  );
  await page.waitForTimeout(400);
  await page.screenshot({ path: "artifacts/campaigns-wizard-recipients.png" });

  const advance = async (heading: RegExp) => {
    const next = page.getByRole("button", { name: /^Continue/ });
    await next.waitFor({ state: "visible", timeout: 30_000 });
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (await next.isEnabled()) break;
      await page.waitForTimeout(250);
    }
    if (!(await next.isEnabled())) {
      await page.screenshot({ path: "artifacts/campaigns-wizard-stuck.png" });
      throw new Error(
        `Continue never became actionable before ${heading}. Console: ${consoleErrors.join(" | ")}`,
      );
    }
    await next.click();
    await page
      .getByRole("heading", { name: heading })
      .waitFor({ state: "visible", timeout: 30_000 });
  };

  await advance(/Who it comes from/);
  await page.screenshot({ path: "artifacts/campaigns-wizard-identity.png" });

  await advance(/Everything before it goes/);
  await page.waitForTimeout(500);
  await page.screenshot({
    path: "artifacts/campaigns-wizard-review.png",
    fullPage: true,
  });

  await advance(/When it goes/);
  check(
    await page
      .getByText(/sends in waves to protect deliverability/i)
      .isVisible(),
    "the wizard explains batch pacing before the send is confirmed",
  );
  await page.waitForTimeout(300);
  await page.screenshot({ path: "artifacts/campaigns-wizard-schedule.png" });

  await page.getByRole("button", { name: /Send now/ }).click();
  await advance(/Send this campaign\?/);
  await page.screenshot({ path: "artifacts/campaigns-wizard-confirm.png" });
  // Nothing is sent by this smoke run: the confirm button is deliberately left
  // unclicked so the test never puts real mail in a provider queue.

  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });
  await prepareContext(mobile);
  const mobilePage = await mobile.newPage();
  await mobilePage.goto(`${baseUrl}/dashboard?tab=campaigns`, {
    waitUntil: "domcontentloaded",
  });
  await mobilePage
    .getByRole("heading", { level: 2, name: "Campaigns" })
    .waitFor({ state: "visible", timeout: 45_000 });
  // Templates live in step two of the create flow now, so the mobile capture
  // goes through the flow rather than a tab that no longer exists.
  await mobilePage.getByRole("button", { name: /New campaign/ }).click();
  const mobileFlow = mobilePage.getByRole("dialog");
  await mobileFlow.waitFor({ state: "visible", timeout: 30_000 });
  await mobileFlow
    .getByRole("heading", { name: "Campaign settings" })
    .waitFor({ state: "visible", timeout: 20_000 });
  check(
    (await mobileFlow.boundingBox())!.width <= mobilePage.viewportSize()!.width,
    "the flow never overflows a phone viewport",
  );
  await mobilePage.waitForTimeout(400);
  await mobilePage.screenshot({
    path: "artifacts/campaigns-flow-mobile.png",
  });

  await mobileFlow.getByLabel("Email subject").fill("Mobile check");
  await mobileFlow.getByRole("button", { name: "Save and continue" }).click();
  await mobileFlow
    .getByRole("heading", { name: "Design your email" })
    .waitFor({ state: "visible", timeout: 20_000 });
  await mobilePage.waitForTimeout(600);
  await mobilePage.screenshot({
    path: "artifacts/campaigns-templates-mobile.png",
  });

  /* ------------------------------ the sender link out of the flow --------- */
  // "Manage in Email" deep links to the Identity tab, not the Email overview:
  // the sender shown in the flow is what the user came to change.
  await page.goto(`${baseUrl}/dashboard?tab=emails&section=identity`, {
    waitUntil: "domcontentloaded",
  });
  await page
    .getByRole("navigation", { name: "Email settings sections" })
    .waitFor({ state: "visible", timeout: 45_000 });
  // Asserted on the panel rather than the tab button: the identity on screen is
  // the proof the deep link landed, and it is the same one the flow displayed.
  await page
    .getByText("Smoke Sender")
    .first()
    .waitFor({ state: "visible", timeout: 30_000 });
  check(
    (await page.getByRole("button", { name: "Overview" }).count()) > 0,
    "Manage in Email lands inside the Email module",
  );
  check(
    (await page.getByText("Smoke Sender").count()) > 0,
    "the Identity tab is what opens, showing the sender the flow displayed",
  );

  await browser.close();
  console.log(
    `Campaigns UI smoke passed: ${assertions} checks, screenshots in artifacts/.`,
  );
} finally {
  await cleanup();
}

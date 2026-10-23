/**
 * Browser smoke test for new-user onboarding.
 *
 * Drives a genuinely new account through the flow and checks the thing that
 * makes it worth collecting at all: the postal address the user types here
 * ends up as the campaign compliance footer, without them being asked twice.
 */
import { neon } from "@neondatabase/serverless";
import { chromium, type BrowserContext } from "@playwright/test";
import { SignJWT } from "jose";
import { randomUUID } from "node:crypto";

const databaseUrl = process.env.DATABASE_URL || "";
const jwtSecret = process.env.JWT_SECRET || "";
const baseUrl = process.env.SMOKE_BASE_URL || "http://127.0.0.1:8080";

if (!databaseUrl || !jwtSecret) {
  throw new Error("Onboarding UI smoke test requires DATABASE_URL and JWT_SECRET.");
}

const sql = neon(databaseUrl);
const suffix = randomUUID().replaceAll("-", "");
const email = `onboarding-smoke-${suffix}@example.test`;

const users = await sql.query(
  `INSERT INTO users (email, password_hash, full_name, short_id)
   VALUES ($1, 'non-login-smoke-account', 'Ada Lovelace', $2)
   RETURNING id`,
  [email, suffix.slice(0, 5)],
);
const userId = String(users[0].id);

const cleanup = async () => {
  await sql.query(`DELETE FROM contact_campaign_settings WHERE user_id = $1`, [
    userId,
  ]);
  await sql.query(`DELETE FROM company_settings WHERE user_id = $1`, [userId]);
  await sql.query(`DELETE FROM user_onboarding WHERE user_id = $1`, [userId]);
  await sql.query(`DELETE FROM users WHERE id = $1`, [userId]);
};

let assertions = 0;
const check = (condition: unknown, message: string) => {
  if (!condition) throw new Error(`Onboarding UI smoke check failed: ${message}`);
  assertions += 1;
};

try {
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
          full_name: "Ada Lovelace",
          created_at: new Date(0).toISOString(),
        },
      },
    );
  };

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  await prepareContext(context);
  const page = await context.newPage();

  await page.goto(`${baseUrl}/dashboard`, { waitUntil: "domcontentloaded" });

  // A brand-new account meets onboarding, not an empty dashboard.
  await page
    .getByRole("heading", { name: /Welcome, Ada/ })
    .waitFor({ state: "visible", timeout: 45_000 });
  check(
    (await page.getByRole("navigation", { name: /Primary/ }).count()) === 0 ||
      !(await page
        .getByRole("navigation", { name: /Primary/ })
        .first()
        .isVisible()),
    "the dashboard shell is not shown behind the onboarding flow",
  );
  await page.screenshot({ path: "artifacts/onboarding-step-business.png" });

  await page.getByLabel("Business or workspace name").fill("Acme Events");
  await page.getByLabel("Website (optional)").fill("acmeevents.com");
  await page.getByRole("button", { name: /Continue/ }).click();

  // Brand identity is a required step of its own.
  await page
    .getByRole("heading", { name: /Set up your brand/ })
    .waitFor({ state: "visible", timeout: 20_000 });
  check(
    await page.getByText("How it will look").isVisible(),
    "the brand step previews the colour and logo before they are committed",
  );
  // Initials stand in until a logo exists, so the preview is never a hole.
  check(
    await page.getByText("AE", { exact: true }).isVisible(),
    "a brand with no logo yet previews as its initials",
  );

  // Nothing advances until a colour is actually chosen.
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.waitForTimeout(400);
  check(
    await page.getByRole("alert").isVisible(),
    "the brand step refuses to advance without a colour",
  );
  check(
    await page.getByRole("heading", { name: /Set up your brand/ }).isVisible(),
    "the flow stays on the brand step until it is answered",
  );

  await page.getByRole("radio", { name: "Brand colour #DB2777" }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: "artifacts/onboarding-step-brand.png" });
  await page.getByRole("button", { name: /Continue/ }).click();

  await page
    .getByRole("heading", { name: /What do you want to get done/ })
    .waitFor({ state: "visible", timeout: 20_000 });
  await page.getByRole("checkbox", { name: /Run email campaigns/ }).click();
  await page.getByRole("checkbox", { name: /Sell event tickets/ }).click();
  await page.screenshot({ path: "artifacts/onboarding-step-goals.png" });
  await page.getByRole("button", { name: /Continue/ }).click();

  await page
    .getByRole("heading", { name: /Which tools do you need first/ })
    .waitFor({ state: "visible", timeout: 20_000 });
  await page.getByRole("checkbox", { name: /Campaigns/ }).click();
  await page.screenshot({ path: "artifacts/onboarding-step-tools.png" });
  await page.getByRole("button", { name: /Continue/ }).click();

  await page
    .getByRole("heading", { name: /Where is your business based/ })
    .waitFor({ state: "visible", timeout: 20_000 });
  check(
    await page
      .getByText(/required by law to carry a physical address/i)
      .isVisible(),
    "the address step explains why it is being asked",
  );
  await page.getByLabel("Street address").fill("1 Example Street");
  await page.getByLabel("City").fill("Lagos");
  await page.getByLabel("State or region").fill("Lagos State");
  await page.getByLabel("Postal code").fill("100001");
  await page.getByLabel("Country").fill("Nigeria");
  await page.screenshot({ path: "artifacts/onboarding-step-address.png" });
  await page.getByRole("button", { name: /Continue/ }).click();

  await page
    .getByRole("heading", { name: /You are all set/ })
    .waitFor({ state: "visible", timeout: 20_000 });
  check(
    await page.getByText(/1 Example Street, Lagos, Nigeria/).isVisible(),
    "the summary reflects what was entered",
  );
  await page.screenshot({ path: "artifacts/onboarding-step-done.png" });
  await page.getByRole("button", { name: /Go to my workspace/ }).click();

  // Onboarding gives way to the real dashboard once it is finished.
  await page
    .getByRole("heading", { level: 2 })
    .first()
    .waitFor({ state: "visible", timeout: 45_000 });
  check(
    (await page.getByRole("heading", { name: /Welcome, Ada/ }).count()) === 0,
    "the flow does not reappear once it is complete",
  );

  // The address becomes the campaign compliance footer without being re-asked.
  const settings = (await sql.query(
    `SELECT mailing_address FROM contact_campaign_settings WHERE user_id = $1`,
    [userId],
  )) as Array<Record<string, unknown>>;
  check(
    String(settings[0]?.mailing_address || "").includes("1 Example Street"),
    "the onboarding address is seeded into campaign settings",
  );

  // Brand identity writes through to the workspace's real branding record,
  // rather than sitting unread in a signup table.
  const company = (await sql.query(
    `SELECT company_name, brand_color, company_website, industry
     FROM company_settings WHERE user_id = $1`,
    [userId],
  )) as Array<Record<string, unknown>>;
  check(
    String(company[0]?.brand_color || "").toUpperCase() === "#DB2777",
    "the chosen brand colour reaches company_settings",
  );
  check(
    String(company[0]?.company_name || "") === "Acme Events",
    "the business name becomes the workspace name",
  );
  check(
    String(company[0]?.company_website || "").includes("acmeevents.com"),
    "the website answer reaches company_settings",
  );

  await page.goto(`${baseUrl}/dashboard?tab=campaigns`, {
    waitUntil: "domcontentloaded",
  });
  await page
    .getByRole("heading", { level: 2, name: "Campaigns" })
    .waitFor({ state: "visible", timeout: 45_000 });
  await page
    .getByRole("navigation", { name: "Campaign sections" })
    .getByRole("button", { name: "Settings" })
    .click();
  const addressField = page.getByLabel(/mailing address/i).first();
  await addressField.waitFor({ state: "visible", timeout: 20_000 });
  check(
    (await addressField.inputValue()).includes("1 Example Street"),
    "campaign settings show the address the user already gave",
  );
  await page.screenshot({ path: "artifacts/onboarding-campaign-settings.png" });

  // Reloading a completed account goes straight to work.
  await page.goto(`${baseUrl}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1_500);
  check(
    (await page.getByRole("heading", { name: /Welcome, Ada/ }).count()) === 0,
    "a completed account is never asked again",
  );

  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await prepareContext(mobile);
  const mobilePage = await mobile.newPage();
  // A second, fresh account so the mobile pass sees the flow itself.
  const mobileUsers = await sql.query(
    `INSERT INTO users (email, password_hash, full_name, short_id)
     VALUES ($1, 'non-login-smoke-account', 'Grace Hopper', $2)
     RETURNING id`,
    [`onboarding-mobile-${suffix}@example.test`, suffix.slice(5, 10)],
  );
  const mobileUserId = String(mobileUsers[0].id);
  try {
    const mobileToken = await new SignJWT({
      email: `onboarding-mobile-${suffix}@example.test`,
      userId: mobileUserId,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer("maxform")
      .setAudience("maxform-dashboard")
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(new TextEncoder().encode(jwtSecret));
    await mobilePage.addInitScript((token) => {
      window.localStorage.setItem("access_token", token as string);
    }, mobileToken);
    await mobilePage.goto(`${baseUrl}/dashboard`, {
      waitUntil: "domcontentloaded",
    });
    await mobilePage
      .getByRole("heading", { name: /Welcome, Grace|Tell us about your business/ })
      .first()
      .waitFor({ state: "visible", timeout: 45_000 });
    // Nothing may overflow the viewport sideways on a phone.
    const scrollWidth = await mobilePage.evaluate(
      () => document.documentElement.scrollWidth,
    );
    check(
      scrollWidth <= 391,
      `onboarding fits a 390px viewport without sideways scroll (was ${scrollWidth})`,
    );
    await mobilePage.screenshot({
      path: "artifacts/onboarding-mobile.png",
      fullPage: true,
    });
  } finally {
    await sql.query(`DELETE FROM user_onboarding WHERE user_id = $1`, [
      mobileUserId,
    ]);
    await sql.query(`DELETE FROM users WHERE id = $1`, [mobileUserId]);
  }

  await browser.close();
  console.log(
    `Onboarding UI smoke passed: ${assertions} checks, screenshots in artifacts/.`,
  );
} finally {
  await cleanup();
}

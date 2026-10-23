import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const browser = await chromium.launch({ headless: true });
const baseUrl = process.env.FORMS_E2E_BASE_URL || "http://127.0.0.1:5174";
const email = process.env.FORMS_E2E_EMAIL || "test@maxform.com";
const password = process.env.FORMS_E2E_PASSWORD || "test123";
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  permissions: ["clipboard-read", "clipboard-write"],
});
const page = await context.newPage();
const pageErrors = [];
const testTitle = `Codex Forms Check ${Date.now()}`;

page.on("pageerror", (error) => pageErrors.push(error.message));

const login = async () => {
  await page.goto(`${baseUrl}/auth`, {
    waitUntil: "networkidle",
  });
  if (!page.url().includes("/auth")) return;
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator("#login-password").press("Enter");
  try {
    await page.waitForURL(/\/dashboard/, { timeout: 20_000 });
  } catch (error) {
    throw new Error(
      `Sign-in did not reach the dashboard (url=${page.url()}): ${await page.locator("body").innerText()}`,
      { cause: error },
    );
  }
};

const openFormsTab = async (tab) => {
  await page.goto(
    `${baseUrl}/dashboard?tab=forms&section=${tab}`,
    { waitUntil: "networkidle" },
  );
  await page.getByRole("heading", { name: tab === "all" ? "All forms" : new RegExp(tab, "i") }).first().waitFor();
};

const deleteTestForms = async () => {
  await page.evaluate(() => sessionStorage.clear());
  await openFormsTab("all");
  const rows = page.getByText(new RegExp(`^${testTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  while ((await rows.count()) > 0) {
    const title = await rows.first().innerText();
    await page.getByRole("button", { name: `Actions for ${title}` }).click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page.locator("#delete-form-name").fill(title);
    const responseCheckbox = page.getByText(/also deletes its non-financial response records/i);
    if (await responseCheckbox.count()) {
      await responseCheckbox.locator("..").getByRole("checkbox").check();
    }
    await page.getByRole("button", { name: "Delete permanently" }).click();
    await page.getByText("Form deleted", { exact: true }).waitFor();
  }
};

await login();
let created = false;

try {
  await openFormsTab("templates");
  const contactHeading = page.getByRole("heading", {
    name: "Contact form",
    exact: true,
  });
  const contactCard = contactHeading.locator("..");
  await contactCard.getByRole("button", { name: "Use template" }).click();
  created = true;

  const titleInput = page.getByRole("textbox", { name: "Form title" });
  await titleInput.waitFor();
  await titleInput.fill(testTitle);
  await page.getByRole("button", { name: "Short text", exact: true }).click();
  await page.waitForTimeout(1_200);
  await page.getByText("Saved", { exact: true }).waitFor();

  const initialFieldCount = await page.locator('[draggable="true"]').count();
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("textbox", { name: "Form title" }).waitFor();
  const persistedTitle = await page
    .getByRole("textbox", { name: "Form title" })
    .inputValue();

  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Publish", exact: true })
    .click();
  await page.getByText("Form published", { exact: true }).waitFor();

  await page.getByRole("button", { name: "Copy live link" }).click();
  const liveLink = await page.evaluate(() => navigator.clipboard.readText());
  const publicPage = await context.newPage();
  await publicPage.goto(liveLink, { waitUntil: "networkidle" });
  await publicPage.getByLabel("Full name").fill("Codex Test");
  await publicPage.getByLabel("Email address").fill("codex-check@example.com");
  await publicPage
    .getByLabel("How can we help?")
    .fill("Validating the published response flow.");
  await publicPage.getByRole("button", { name: "Submit", exact: true }).click();
  await publicPage.getByRole("heading", { name: "Response received" }).waitFor();
  await publicPage.close();

  await page.getByRole("button", { name: "Preview", exact: true }).last().click();
  await page.waitForURL(/section=preview/);
  const previewTitle = await page
    .getByRole("heading", { name: testTitle, exact: true })
    .count();
  const sharedRendererNotice = await page
    .getByText("Same renderer used by the live form", { exact: true })
    .count();

  const formsNav = page.getByLabel("Forms module");
  await formsNav.getByRole("button", { name: "Responses", exact: true }).click();
  await page.getByText("codex-check@example.com", { exact: true }).waitFor();
  const responsesEmpty = await page
    .getByText("No responses yet", { exact: true })
    .count();
  const submittedResponse = await page
    .getByText("codex-check@example.com", { exact: true })
    .count();

  await formsNav.getByRole("button", { name: "Analytics", exact: true }).click();
  await page.waitForFunction(() =>
    document.body.textContent?.includes("No response activity yet") ||
    document.body.textContent?.includes("100% completion"),
  );
  const analyticsEmpty = await page
    .getByText("No response activity yet", { exact: true })
    .count();
  const analyticsCompleted = await page
    .getByText("100% completion", { exact: true })
    .count();

  await formsNav.getByRole("button", { name: "Automations", exact: true }).click();
  await page.getByRole("button", { name: "New automation" }).click();
  await page.locator("#automation-name").fill("Codex confirmation");
  await page.getByRole("button", { name: "Create automation" }).click();
  await page.getByText("Automation attached", { exact: true }).waitFor();
  const automationCreated = await page
    .getByText("Codex confirmation", { exact: true })
    .count();

  await formsNav.getByRole("button", { name: "Settings", exact: true }).click();
  const settingsSections = await Promise.all(
    [
      "Submission notifications",
      "Confirmation",
      "Access control",
      "Response limits",
      "Submission window",
    ].map((text) => page.getByText(text, { exact: true }).count()),
  );

  await formsNav.getByRole("button", { name: "Builder", exact: true }).click();
  await page.screenshot({
    path: ".codex-forms-builder-desktop.png",
    fullPage: true,
  });

  const desktop = await page.evaluate(() => ({
    width: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const mobileAddField = await page
    .getByRole("button", { name: "Add field", exact: true })
    .count();
  const mobile = await page.evaluate(() => ({
    width: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  await page.screenshot({
    path: ".codex-forms-builder-mobile.png",
    fullPage: true,
  });

  assert.equal(persistedTitle, testTitle, "the builder draft did not survive reload");
  assert.ok(initialFieldCount > 0, "adding a field did not render a builder field");
  assert.equal(previewTitle, 1, "the live preview did not use the saved title");
  assert.equal(sharedRendererNotice, 1, "preview is not using the shared renderer");
  assert.equal(responsesEmpty, 0, "the submitted response was not listed");
  assert.ok(submittedResponse > 0, "the submitted response email was not found");
  assert.equal(
    analyticsEmpty + analyticsCompleted,
    1,
    "analytics did not resolve to an empty or completed state",
  );
  assert.equal(automationCreated, 1, "form automation was not created");
  assert.ok(
    settingsSections.every((count) => count > 0),
    "one or more form settings sections are missing",
  );
  assert.equal(mobileAddField, 1, "mobile builder controls are not available");
  assert.ok(
    desktop.documentWidth <= desktop.width + 1 &&
      desktop.bodyWidth <= desktop.width + 1,
    "desktop builder overflows horizontally",
  );
  assert.ok(
    mobile.documentWidth <= mobile.width + 1 && mobile.bodyWidth <= mobile.width + 1,
    "mobile builder overflows horizontally",
  );
  assert.deepEqual(pageErrors, [], "the browser reported a page error");

  console.log(
    JSON.stringify(
      {
        persistedTitle: persistedTitle === testTitle,
        fieldCountAfterAdd: initialFieldCount,
        previewTitle,
        sharedRendererNotice,
        responsesEmpty,
        submittedResponse,
        analyticsEmpty,
        analyticsCompleted,
        automationCreated,
        settingsSections,
        mobileAddField,
        desktop,
        mobile,
        pageErrors,
      },
      null,
      2,
    ),
  );
} finally {
  if (created) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await deleteTestForms();
  }
  await browser.close();
}

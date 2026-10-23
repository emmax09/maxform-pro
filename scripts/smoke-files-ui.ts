import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";

import { chromium } from "@playwright/test";
import { neon } from "@neondatabase/serverless";

import {
  deleteStorageObject,
  putStorageObject,
  resolveStorageLocation,
} from "../server/storage-service";

const databaseUrl = process.env.DATABASE_URL || "";
const baseUrl = (process.env.SMOKE_BASE_URL || "http://127.0.0.1:8080").replace(
  /\/$/,
  "",
);
if (!databaseUrl) {
  throw new Error("Files UI smoke test requires DATABASE_URL.");
}

const sql = neon(databaseUrl);
const runId = randomUUID().replace(/-/g, "").slice(0, 12);
const email = `files-ui-${runId}@example.test`;
const password = `Secure-${runId}-Ui`;
const fileName = "signature-signature.png";

const pngBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAM0lEQVR42u3OMQEAAAgDoC251a3gLwSgcndXKpVKpVKpVCqVSqVSqVQqlUqlUqlUKpXKl1lVpwGB0/CCUwAAAABJRU5ErkJggg==",
  "base64",
);

let checks = 0;
const failures: string[] = [];
let userId = "";
let objectKey = "";

const check = (condition: unknown, description: string) => {
  checks += 1;
  if (!condition) failures.push(description);
  console.log(`${condition ? "ok  " : "FAIL"} ${description}`);
};

const cleanup = async () => {
  if (objectKey) {
    await deleteStorageObject(resolveStorageLocation("private", objectKey)).catch(
      () => undefined,
    );
  }
  if (!userId) return;
  await sql.query(`DELETE FROM workspace_file_share_links WHERE user_id = $1`, [
    userId,
  ]);
  await sql.query(`DELETE FROM workspace_files WHERE user_id = $1`, [userId]);
  await sql.query(`DELETE FROM workspace_file_settings WHERE user_id = $1`, [
    userId,
  ]);
  await sql.query(`DELETE FROM storage_objects WHERE user_id = $1`, [userId]);
  await sql
    .query(`DELETE FROM storage_audit_events WHERE actor_user_id = $1`, [userId])
    .catch(() => undefined);
  await sql.query(`DELETE FROM activity_log WHERE user_id = $1`, [userId]);
  await sql.query(`DELETE FROM users WHERE id = $1`, [userId]);
};

const browser = await chromium.launch();

try {
  await mkdir("artifacts", { recursive: true });

  const signUp = await fetch(`${baseUrl}/api/auth?action=sign-up`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.SMOKE_CLIENT_IP
        ? { "X-Forwarded-For": process.env.SMOKE_CLIENT_IP }
        : {}),
    },
    body: JSON.stringify({
      country: "Nigeria",
      email,
      fullName: "Files UI Check",
      password,
      phone: "",
    }),
  });
  const account = (await signUp.json()) as Record<string, unknown>;
  const user = (account.user || {}) as Record<string, unknown>;
  userId = String(user.id || "");
  const workspaceShortId = String(user.short_id || "");
  check(signUp.status === 201, "a temporary account was created");
  check(
    /^[A-Za-z0-9]{4,6}$/.test(workspaceShortId),
    `the account received a workspace short id (${workspaceShortId})`,
  );

  objectKey = `tenants/${userId}/form-responses/smoke/${runId}/${fileName}`;
  const location = resolveStorageLocation("private", objectKey);
  const uploaded = await putStorageObject({
    location,
    fileName,
    mimeType: "image/png",
    body: pngBytes,
    sizeBytes: pngBytes.length,
    metadata: { purpose: "form_response" },
  });
  const objectRows = await sql.query(
    `INSERT INTO storage_objects (
       id, user_id, provider, bucket_name, object_key, file_name, mime_type,
       size_bytes, visibility, purpose, etag, status, scan_status,
       verified_at, created_at, updated_at
     )
     VALUES (
       gen_random_uuid(), $1, 'r2', $2, $3, $4, 'image/png', $5, 'private',
       'form_response', NULLIF($6, ''), 'ready', 'validated', NOW(), NOW(), NOW()
     )
     RETURNING id`,
    [userId, location.bucket, objectKey, fileName, pngBytes.length, uploaded.etag],
  );
  const storageObjectId = String(
    (objectRows[0] as Record<string, unknown>).id,
  );
  await sql.query(
    `INSERT INTO workspace_files (
       user_id, name, mime_type, size_bytes, storage_key, storage_object_id,
       storage_provider, source_type, source_label, uploaded_by, scan_status
     )
     VALUES ($1, $2, 'image/png', $3, $4, $5, 'r2', 'form_upload',
             'From: Forms / Files UI check', $1, 'validated')`,
    [userId, fileName, pngBytes.length, objectKey, storageObjectId],
  );

  const context = await browser.newContext({
    viewport: { height: 900, width: 1440 },
  });
  const page = await context.newPage();
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });

  await page.goto(`${baseUrl}/auth`, { waitUntil: "domcontentloaded" });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/dashboard(?:\?|$)/, { timeout: 30_000 });
  await page.waitForTimeout(1_000);

  // Newly-created smoke accounts may be routed through the optional workspace
  // onboarding screen before the Files module is available.
  const skipOnboarding = page.getByRole("button", {
    name: "Skip for now",
    exact: true,
  });
  if (await skipOnboarding.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await skipOnboarding.click();
    await page.waitForTimeout(1_000);
  }

  await page.goto(`${baseUrl}/dashboard?tab=files&section=all`, {
    waitUntil: "domcontentloaded",
  });
  const card = page.getByText(fileName).first();
  await card.waitFor({ state: "visible", timeout: 30_000 });

  // The grid thumbnail must load from the branded route, not from R2.
  const thumbnail = page.locator(`img[alt*="${fileName}"]`).first();
  await thumbnail.waitFor({ state: "visible", timeout: 30_000 });
  const thumbnailSource = String(await thumbnail.getAttribute("src"));
  check(
    thumbnailSource.startsWith(`${baseUrl}/${workspaceShortId}/file/`),
    `the grid thumbnail uses the branded URL (${thumbnailSource.slice(0, 90)})`,
  );
  check(
    !thumbnailSource.includes("X-Amz-Signature"),
    "the grid thumbnail is not a presigned storage URL",
  );
  const thumbnailDecoded = await thumbnail
    .evaluate(
      (node) =>
        new Promise<boolean>((resolve) => {
          const image = node as HTMLImageElement;
          if (image.complete) {
            resolve(image.naturalWidth > 0);
            return;
          }
          image.addEventListener("load", () => resolve(image.naturalWidth > 0));
          image.addEventListener("error", () => resolve(false));
        }),
      { timeout: 20_000 },
    )
    .catch(() => false);
  check(thumbnailDecoded, "the branded thumbnail actually decoded an image");

  await card.click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible", timeout: 15_000 });
  const previewImage = dialog.locator("img").first();
  await previewImage.waitFor({ state: "visible", timeout: 15_000 });
  const previewSource = String(await previewImage.getAttribute("src"));
  check(
    previewSource.startsWith(`${baseUrl}/${workspaceShortId}/file/`),
    `the preview uses the branded URL (${previewSource.slice(0, 90)})`,
  );
  check(
    previewSource.length < 150,
    `the branded preview URL is short (${previewSource.length} characters)`,
  );

  const openInNewTab = dialog.getByRole("button", {
    name: "Open file in a new tab",
  });
  check(
    await openInNewTab.isVisible(),
    "the modal offers an open-in-a-new-tab control",
  );

  await page.screenshot({
    path: "artifacts/files-preview-modal.png",
    fullPage: false,
  });

  // Downloading must save the file rather than opening a tab or navigating.
  const pagesBefore = context.pages().length;
  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await dialog.getByRole("button", { name: "Download", exact: true }).click();
  const download = await downloadPromise;
  check(
    download.suggestedFilename() === fileName,
    `the download keeps the file name (${download.suggestedFilename()})`,
  );
  check(
    context.pages().length === pagesBefore,
    "downloading did not open another tab",
  );
  check(
    page.url().includes("/dashboard"),
    "downloading did not navigate away from the dashboard",
  );
  check(
    await dialog.isVisible(),
    "the preview modal stays open after a download",
  );

  // The open-in-a-new-tab arrow is what actually opens a tab.
  const popupPromise = page.waitForEvent("popup", { timeout: 15_000 });
  await openInNewTab.click();
  const popup = await popupPromise;
  await popup.waitForLoadState("domcontentloaded").catch(() => undefined);
  check(
    popup.url().startsWith(`${baseUrl}/${workspaceShortId}/file/`),
    `the new tab shows the branded URL (${popup.url().slice(0, 90)})`,
  );
  await popup.close();

  // Sharing must not fail with the missing public sharing ID error.
  await page.keyboard.press("Escape");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page
    .getByRole("button", { name: `Actions for ${fileName}` })
    .first()
    .click();
  await page.getByRole("menuitem", { name: "Copy share link" }).click();
  const shareToast = page.getByText("Secure share link copied.");
  await shareToast.waitFor({ state: "visible", timeout: 20_000 });
  check(await shareToast.isVisible(), "copying a share link succeeds");
  check(
    !(await page.getByText("public sharing ID").isVisible().catch(() => false)),
    "sharing no longer reports a missing public sharing ID",
  );
  const shareUrl = await page.evaluate(() => navigator.clipboard.readText());
  check(
    shareUrl.startsWith(`${baseUrl}/${workspaceShortId}/content/`),
    `the copied share link is branded (${shareUrl})`,
  );

  check(
    runtimeErrors.length === 0,
    `the files module logged no runtime errors (${runtimeErrors.join(" | ") || "none"})`,
  );

  console.log(
    `\nFiles UI smoke test: ${checks - failures.length}/${checks} checks passed.`,
  );
  if (failures.length) {
    throw new Error(`Failed checks:\n- ${failures.join("\n- ")}`);
  }
} finally {
  await browser.close();
  await cleanup();
}

import { randomUUID } from "node:crypto";

import { neon } from "@neondatabase/serverless";
import { hash } from "bcrypt-ts";

import {
  deleteStorageObject,
  putStorageObject,
  resolveStorageLocation,
} from "../server/storage-service";

type JsonValue = Record<string, unknown>;

const databaseUrl = process.env.DATABASE_URL || "";
const baseUrl = (process.env.SMOKE_BASE_URL || "http://127.0.0.1:8080").replace(
  /\/$/,
  "",
);
if (!databaseUrl) {
  throw new Error("Files smoke test requires DATABASE_URL.");
}

const sql = neon(databaseUrl);
const runId = randomUUID().replace(/-/g, "").slice(0, 12);
const ownerId = randomUUID();
const ownerEmail = `files-owner-${runId}@example.test`;
// Deliberately five characters: the length signup and migration 031 issue.
const ownerShortId = `f${runId.slice(0, 4)}`;
const objectKey = `tenants/${ownerId}/form-responses/smoke/${runId}/signature.png`;
const storageLocation = resolveStorageLocation("private", objectKey);

// A one pixel PNG, small enough to compare byte for byte.
const pngBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let assertions = 0;
let storageObjectId = "";

const assert = (condition: unknown, message: string) => {
  assertions += 1;
  if (!condition) throw new Error(message);
};

const request = async (
  path: string,
  options: {
    method?: string;
    body?: JsonValue;
    token?: string;
    redirect?: RequestRedirect;
  } = {},
) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || (options.body ? "POST" : "GET"),
    headers: {
      Accept: "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    redirect: options.redirect || "follow",
  });
  const text = await response.text();
  let body: JsonValue = {};
  try {
    body = text ? (JSON.parse(text) as JsonValue) : {};
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  return { response, body };
};

const looksPresigned = (url: string) =>
  url.includes("X-Amz-Signature") ||
  url.includes("r2.cloudflarestorage.com") ||
  url.length > 300;

const cleanup = async () => {
  await deleteStorageObject(storageLocation).catch(() => undefined);
  await sql.query(`DELETE FROM workspace_file_share_links WHERE user_id = $1`, [
    ownerId,
  ]);
  await sql.query(`DELETE FROM workspace_files WHERE user_id = $1`, [ownerId]);
  await sql.query(`DELETE FROM workspace_file_settings WHERE user_id = $1`, [
    ownerId,
  ]);
  await sql.query(`DELETE FROM storage_objects WHERE user_id = $1`, [ownerId]);
  await sql
    .query(`DELETE FROM storage_audit_events WHERE actor_user_id = $1`, [
      ownerId,
    ])
    .catch(() => undefined);
  await sql.query(`DELETE FROM activity_log WHERE user_id = $1`, [ownerId]);
  await sql.query(`DELETE FROM users WHERE id = $1`, [ownerId]);
};

try {
  const password = `Secure-${runId}-Files`;
  await sql.query(
    `INSERT INTO users (id, email, password_hash, full_name, short_id)
     VALUES ($1, $2, $3, 'Files Smoke Owner', $4)`,
    [ownerId, ownerEmail, await hash(password, 10), ownerShortId],
  );

  const uploaded = await putStorageObject({
    location: storageLocation,
    fileName: "signature-signature.png",
    mimeType: "image/png",
    body: pngBytes,
    sizeBytes: pngBytes.length,
    metadata: { purpose: "form_response" },
  });
  const objectRows = await sql.query(
    `INSERT INTO storage_objects (
       id, user_id, provider, bucket_name, object_key, file_name,
       mime_type, size_bytes, visibility, purpose, etag, status,
       scan_status, verified_at, created_at, updated_at
     )
     VALUES (
       gen_random_uuid(), $1, 'r2', $2, $3, 'signature-signature.png',
       'image/png', $4, 'private', 'form_response', NULLIF($5, ''),
       'ready', 'validated', NOW(), NOW(), NOW()
     )
     RETURNING id`,
    [ownerId, storageLocation.bucket, objectKey, pngBytes.length, uploaded.etag],
  );
  storageObjectId = String((objectRows[0] as JsonValue).id);

  const fileRows = await sql.query(
    `INSERT INTO workspace_files (
       user_id, name, mime_type, size_bytes, storage_key, storage_object_id,
       storage_provider, source_type, source_label, uploaded_by, scan_status
     )
     VALUES (
       $1, 'signature-signature.png', 'image/png', $2, $3, $4, 'r2',
       'form_upload', 'From: Forms / Files smoke', $1, 'validated'
     )
     RETURNING id`,
    [ownerId, pngBytes.length, objectKey, storageObjectId],
  );
  const fileId = String((fileRows[0] as JsonValue).id);

  const signIn = await request("/api/auth?action=sign-in", {
    body: { email: ownerEmail, password },
  });
  assert(signIn.response.ok, "The smoke fixture could not sign in.");
  const token = String(signIn.body.access_token || "");
  assert(Boolean(token), "The smoke fixture received no access token.");

  // 1. Sharing must work for the five character short ids real accounts have.
  const shared = await request(
    `/api/workspace/content?module=files&action=share`,
    { body: { id: fileId }, token },
  );
  assert(
    shared.response.ok,
    `Sharing failed: ${String(shared.body.error || shared.response.status)}`,
  );
  const shareUrl = String(shared.body.url || "");
  assert(
    shareUrl === `${baseUrl}/${ownerShortId}/content/${shareUrl.split("/").pop()}`,
    `The share URL is not branded: ${shareUrl}`,
  );

  const sharedFetch = await fetch(shareUrl, { redirect: "manual" });
  assert(
    sharedFetch.status === 200,
    `The share link did not stream the file (status ${sharedFetch.status}).`,
  );
  assert(
    !sharedFetch.headers.get("location"),
    "The share link redirected to the storage provider instead of streaming.",
  );
  assert(
    sharedFetch.headers.get("content-type") === "image/png",
    "The share link returned the wrong content type.",
  );
  assert(
    Buffer.from(await sharedFetch.arrayBuffer()).equals(pngBytes),
    "The share link returned different bytes than were uploaded.",
  );

  // 2. File content must hand back branded links, never a presigned R2 URL.
  const content = await request(
    `/api/workspace/content?module=files&action=content&id=${fileId}`,
    { token },
  );
  assert(
    content.response.ok,
    `File content failed: ${String(content.body.error || "")}`,
  );
  const previewUrl = String(content.body.url || "");
  const downloadUrl = String(content.body.downloadUrl || "");
  assert(
    !looksPresigned(previewUrl) && !looksPresigned(downloadUrl),
    `File content still returns a presigned URL: ${previewUrl.slice(0, 120)}`,
  );
  assert(
    new RegExp(
      `^${baseUrl}/${ownerShortId}/file/[A-Za-z0-9_-]{44}$`,
    ).test(previewUrl),
    `The preview URL is not branded: ${previewUrl}`,
  );
  assert(
    previewUrl.length < 150,
    `The branded URL is still long (${previewUrl.length} characters).`,
  );

  const preview = await fetch(previewUrl);
  assert(
    preview.status === 200,
    `The branded preview URL failed (status ${preview.status}).`,
  );
  assert(
    (preview.headers.get("content-disposition") || "").startsWith("inline"),
    "The preview URL should render inline.",
  );
  assert(
    preview.headers.get("content-type") === "image/png",
    "The preview URL returned the wrong content type.",
  );
  assert(
    Buffer.from(await preview.arrayBuffer()).equals(pngBytes),
    "The preview URL returned different bytes than were uploaded.",
  );

  const download = await fetch(downloadUrl);
  assert(
    download.status === 200,
    `The branded download URL failed (status ${download.status}).`,
  );
  const disposition = download.headers.get("content-disposition") || "";
  assert(
    disposition.startsWith("attachment") &&
      disposition.includes("signature-signature.png"),
    `The download URL should save the file, got: ${disposition}`,
  );

  // 3. Branded links must reject tampering and the wrong workspace.
  const brandedToken = previewUrl.split("/").pop() || "";
  const tampered = `${baseUrl}/${ownerShortId}/file/${
    brandedToken.slice(0, 43)
  }${brandedToken.endsWith("A") ? "B" : "A"}`;
  assert(
    (await fetch(tampered)).status === 404,
    "A tampered branded token was accepted.",
  );
  assert(
    (await fetch(`${baseUrl}/zz9qq/file/${brandedToken}`)).status === 404,
    "A branded token was accepted under the wrong workspace.",
  );

  // 4. Stored object access (form responses, CRM attachments) is branded too.
  const access = await request("/api/storage?action=access", {
    body: { objectId: storageObjectId },
    token,
  });
  assert(
    access.response.ok,
    `Storage access failed: ${String(access.body.error || "")}`,
  );
  const accessUrl = String(access.body.url || "");
  assert(
    !looksPresigned(accessUrl),
    `Storage access still returns a presigned URL: ${accessUrl.slice(0, 120)}`,
  );

  const accessBatch = await request("/api/storage?action=access-batch", {
    body: { objectIds: [storageObjectId] },
    token,
  });
  assert(
    accessBatch.response.ok,
    `Storage batch access failed: ${String(accessBatch.body.error || "")}`,
  );
  const batchUrl = String(
    ((accessBatch.body.objects as JsonValue[])[0] || {}).url || "",
  );
  assert(
    !looksPresigned(batchUrl),
    `Batch access still returns a presigned URL: ${batchUrl.slice(0, 120)}`,
  );

  console.log(`Files smoke test passed (${assertions} assertions).`);
} finally {
  await cleanup();
}

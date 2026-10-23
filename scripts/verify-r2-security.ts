import { createServer } from "node:http";
import { once } from "node:events";

import { neon } from "@neondatabase/serverless";
import { SignJWT } from "jose";

import { handleStorageApi } from "../server/storage-api";
import {
  deleteStorageObject,
  headStorageObject,
  resetStorageConfigurationForTests,
  storageConfiguration,
  type StorageObjectLocation,
} from "../server/storage-service";

type JsonObject = Record<string, unknown>;
type StorageResponseObject = {
  id: string;
  objectKey: string;
  url: string | null;
  visibility: "private" | "public";
};

const databaseUrl = String(process.env.DATABASE_URL || "");
const jwtSecret = String(process.env.JWT_SECRET || "");
if (!databaseUrl || jwtSecret.length < 32) {
  throw new Error("DATABASE_URL and a secure JWT_SECRET are required.");
}

resetStorageConfigurationForTests();
const configuration = storageConfiguration();
const sql = neon(databaseUrl);
const users = await sql.query(
  `SELECT id
   FROM users
   ORDER BY created_at, id
   LIMIT 2`,
);
if (!users[0]?.id) throw new Error("A user is required for verification.");

const ownerId = String(users[0].id);
const otherUserId = users[1]?.id ? String(users[1].id) : "";
const signingKey = new TextEncoder().encode(jwtSecret);
const tokenFor = (userId: string) =>
  new SignJWT({ userId })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer("maxform")
    .setAudience("maxform-dashboard")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(signingKey);

const server = createServer((request, response) => {
  void handleStorageApi(request, response);
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
if (!address || typeof address === "string") {
  throw new Error("The local verification server did not start.");
}
const baseUrl = `http://127.0.0.1:${address.port}`;
const ownerToken = await tokenFor(ownerId);
const objectIds: string[] = [];
const locations: StorageObjectLocation[] = [];
const timedFetch = (
  input: string | URL,
  init: RequestInit = {},
  timeoutMilliseconds = 30_000,
) =>
  fetch(input, {
    ...init,
    signal: init.signal || AbortSignal.timeout(timeoutMilliseconds),
  });
const stage = (name: string) =>
  process.stderr.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level: "info",
      verificationStage: name,
    })}\n`,
  );

const post = async (
  action: string,
  body: JsonObject,
  token = ownerToken,
) => {
  const response = await timedFetch(
    `${baseUrl}/api/storage?action=${encodeURIComponent(action)}`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    },
  );
  const value = (await response.json().catch(() => ({}))) as JsonObject;
  return { response, value };
};

const requiredObject = (value: JsonObject) => {
  const object = value.object as StorageResponseObject | undefined;
  if (!object?.id) throw new Error("The storage API returned no object.");
  return object;
};

const uploadSingle = async (
  purpose: "event_asset" | "workspace_file",
  fileName: string,
  mimeType: string,
  content: Uint8Array,
) => {
  const intentResult = await post("intent", {
    purpose,
    visibility: purpose === "event_asset" ? "public" : "private",
    fileName,
    mimeType,
    sizeBytes: content.byteLength,
  });
  if (!intentResult.response.ok) {
    throw new Error(
      `Upload intent failed (${intentResult.response.status}).`,
    );
  }
  const intentObject = requiredObject(intentResult.value);
  const upload = intentResult.value.upload as
    | { mode: "single"; uploadUrl: string }
    | undefined;
  const completionToken = String(intentResult.value.completionToken || "");
  if (
    upload?.mode !== "single" ||
    !upload.uploadUrl ||
    !completionToken ||
    intentObject.objectKey ||
    intentObject.url
  ) {
    throw new Error("The upload intent exposed private storage metadata.");
  }
  objectIds.push(intentObject.id);
  const preflight = await timedFetch(upload.uploadUrl, {
    method: "OPTIONS",
    headers: {
      Origin: "http://localhost:8080",
      "Access-Control-Request-Method": "PUT",
      "Access-Control-Request-Headers": "content-type",
    },
  });
  if (
    !preflight.ok ||
    preflight.headers.get("access-control-allow-origin") !==
      "http://localhost:8080"
  ) {
    throw new Error("R2 rejected the exact-origin browser upload preflight.");
  }
  const put = await timedFetch(upload.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": mimeType },
    body: content,
  });
  if (!put.ok) {
    const providerCode =
      (await put.text())
        .match(/<Code>([^<]+)<\/Code>/i)?.[1]
        ?.replace(/[^A-Za-z0-9_-]/g, "")
        .slice(0, 80) || "unknown";
    const signedParameters = Array.from(
      new URL(upload.uploadUrl).searchParams.keys(),
    )
      .filter((name) => name.toLowerCase() !== "x-amz-signature")
      .sort();
    throw new Error(
      `R2 upload failed (${put.status}, ${providerCode}; signed parameters: ${signedParameters.join(", ")}).`,
    );
  }
  return {
    completionToken,
    uploadUrl: upload.uploadUrl,
    objectId: intentObject.id,
  };
};

try {
  stage("public_intent_and_private_stage");
  const pngHeader = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const publicUpload = await uploadSingle(
    "event_asset",
    "security-check.png",
    "image/png",
    pngHeader,
  );
  const stagedRows = await sql.query(
    `SELECT upload_bucket_name, upload_object_key
     FROM storage_upload_sessions
     WHERE storage_object_id = $1`,
    [publicUpload.objectId],
  );
  if (
    !stagedRows[0] ||
    String(stagedRows[0].upload_bucket_name) !== configuration.privateBucket
  ) {
    throw new Error("The public asset was not staged in the private bucket.");
  }
  const publicKey = String(stagedRows[0].upload_object_key);
  const candidatePublicUrl = `${configuration.publicUrl}/${publicKey
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  const beforePromotion = await timedFetch(candidatePublicUrl);
  if (beforePromotion.ok) {
    throw new Error("A public asset was reachable before verification.");
  }

  stage("public_validation_and_promotion");
  const completedPublicResult = await post("complete", {
    completionToken: publicUpload.completionToken,
  });
  if (!completedPublicResult.response.ok) {
    throw new Error(
      `Public upload completion failed (${completedPublicResult.response.status}).`,
    );
  }
  const completedPublic = requiredObject(completedPublicResult.value);
  if (
    completedPublic.visibility !== "public" ||
    !completedPublic.url ||
    !completedPublic.objectKey
  ) {
    throw new Error("A verified public asset was not promoted correctly.");
  }
  stage("public_delivery");
  const delivered = await timedFetch(completedPublic.url, {
    headers: { Origin: "http://localhost:8080" },
  });
  if (!delivered.ok) {
    throw new Error(`Public R2 delivery failed (${delivered.status}).`);
  }
  if (
    delivered.headers.get("access-control-allow-origin") !==
    "http://localhost:8080"
  ) {
    throw new Error("The public delivery CORS origin was not exact.");
  }
  const publicRows = await sql.query(
    `SELECT object.bucket_name, object.object_key, object.public_url,
            object.visibility, session.upload_bucket_name,
            session.target_bucket_name
     FROM storage_objects object
     JOIN storage_upload_sessions session
       ON session.storage_object_id = object.id
     WHERE object.id = $1
       AND object.status = 'ready'
       AND session.status = 'completed'`,
    [completedPublic.id],
  );
  if (
    !publicRows[0] ||
    String(publicRows[0].upload_bucket_name) !==
      configuration.privateBucket ||
    String(publicRows[0].target_bucket_name) !==
      configuration.publicBucket
  ) {
    throw new Error("Public staging metadata was not recorded correctly.");
  }
  locations.push({
    bucket: String(publicRows[0].bucket_name),
    key: String(publicRows[0].object_key),
    publicUrl: String(publicRows[0].public_url),
    visibility: "public",
  });

  stage("private_upload");
  const privateContent = new TextEncoder().encode(
    "MaxForm private R2 security verification",
  );
  const privateUpload = await uploadSingle(
    "workspace_file",
    "private-check.txt",
    "text/plain",
    privateContent,
  );
  const completedPrivateResult = await post("complete", {
    completionToken: privateUpload.completionToken,
  });
  if (!completedPrivateResult.response.ok) {
    throw new Error(
      `Private upload completion failed (${completedPrivateResult.response.status}).`,
    );
  }
  const completedPrivate = requiredObject(completedPrivateResult.value);
  if (
    completedPrivate.visibility !== "private" ||
    completedPrivate.url ||
    completedPrivate.objectKey
  ) {
    throw new Error("The private upload response exposed storage metadata.");
  }
  const privateRows = await sql.query(
    `SELECT bucket_name, object_key, public_url, visibility
     FROM storage_objects
     WHERE id = $1 AND user_id = $2 AND status = 'ready'`,
    [completedPrivate.id, ownerId],
  );
  if (
    !privateRows[0] ||
    privateRows[0].public_url != null ||
    String(privateRows[0].object_key).startsWith(`tenants/${ownerId}/`) ===
      false
  ) {
    throw new Error("Private metadata is not tenant-scoped and URL-free.");
  }
  const privateLocation: StorageObjectLocation = {
    bucket: String(privateRows[0].bucket_name),
    key: String(privateRows[0].object_key),
    publicUrl: null,
    visibility: "private",
  };
  locations.push(privateLocation);

  const accessResult = await post("access", {
    objectId: completedPrivate.id,
    disposition: "attachment",
  });
  const accessObject = requiredObject(accessResult.value);
  const signedUrl = String(accessResult.value.url || "");
  if (
    !accessResult.response.ok ||
    !signedUrl ||
    accessObject.objectKey ||
    accessObject.url
  ) {
    throw new Error("Private download authorization exposed object metadata.");
  }
  stage("private_authorized_download");
  const signedDownload = await timedFetch(signedUrl);
  if (!signedDownload.ok) {
    throw new Error(`Signed private download failed (${signedDownload.status}).`);
  }
  const unsignedUrl = new URL(signedUrl);
  unsignedUrl.search = "";
  const unsignedDownload = await timedFetch(unsignedUrl);
  if (unsignedDownload.ok) {
    throw new Error("The private object was accessible without a signature.");
  }

  if (otherUserId) {
    stage("cross_tenant_denial");
    const denied = await post(
      "access",
      { objectId: completedPrivate.id },
      await tokenFor(otherUserId),
    );
    if (denied.response.status !== 404) {
      throw new Error("Cross-tenant private access was not denied.");
    }
  }

  stage("private_delete");
  const deleted = await post("delete", { objectId: completedPrivate.id });
  if (!deleted.response.ok || deleted.value.deleted !== true) {
    throw new Error("Private object deletion failed.");
  }
  let privateStillExists = true;
  try {
    await headStorageObject(privateLocation);
  } catch {
    privateStillExists = false;
  }
  if (privateStillExists) {
    throw new Error("The deleted private object still exists in R2.");
  }

  process.stdout.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      status: "passed",
      checks: {
        publicUploadStagedPrivately: true,
        exactOriginCors: true,
        publicPromotionAfterValidation: true,
        privateMetadataRedacted: true,
        signedPrivateDownload: true,
        unsignedPrivateDownloadBlocked: true,
        crossTenantAccessBlocked: Boolean(otherUserId),
        privateDeleteVerified: true,
      },
    })}\n`,
  );
} finally {
  for (const location of locations) {
    await deleteStorageObject(location).catch(() => undefined);
  }
  if (objectIds.length > 0) {
    await sql
      .query(
        `DELETE FROM storage_audit_events
         WHERE storage_object_id = ANY($1::uuid[])`,
        [objectIds],
      )
      .catch(() => undefined);
    await sql
      .query(
        `DELETE FROM storage_objects
         WHERE id = ANY($1::uuid[])`,
        [objectIds],
      )
      .catch(() => undefined);
  }
  server.close();
  await once(server, "close");
}

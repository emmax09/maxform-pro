import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isIP } from "node:net";

import { neon } from "@neondatabase/serverless";
import { jwtVerify } from "jose";

import {
  createBrandedFileLink,
  defaultAppOrigin,
  ensureWorkspaceShortId,
  type WorkspaceQuery,
} from "./branded-file-links";
import { consumeRateLimit } from "./rate-limit";
import {
  abortStorageMultipartUpload,
  beginStorageUpload,
  checkStorageHealth,
  completeStorageMultipartUpload,
  copyStorageObject,
  createSignedStorageDownload,
  createStorageObjectKey,
  deleteStorageObject,
  headStorageObject,
  normalizeMimeType,
  readStorageObjectPrefix,
  resolveStorageLocation,
  sanitizeStorageFileName,
  signStorageUploadParts,
  storagePolicies,
  validateObjectSignature,
  validateStorageUpload,
  type StoragePurpose,
  type StorageVisibility,
  type StorageObjectLocation,
  StorageServiceError,
} from "./storage-service";
import { workspaceScopeFor } from "./workspace-access";

type DatabaseRow = Record<string, unknown>;
type RecordValue = Record<string, unknown>;

class StorageApiError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "storage_request_error",
  ) {
    super(message);
  }
}

const database = () => {
  const url = String(process.env.DATABASE_URL || "");
  if (!url) {
    throw new StorageApiError(
      "Storage metadata is temporarily unavailable.",
      503,
      "storage_unavailable",
    );
  }
  return neon(url);
};

const signingSecret = () => {
  const secret = String(process.env.JWT_SECRET || "");
  if (secret.length < 32) {
    throw new StorageApiError(
      "Storage authentication is temporarily unavailable.",
      503,
      "storage_unavailable",
    );
  }
  return new TextEncoder().encode(secret);
};

const cleanText = (value: unknown, maximum: number) =>
  String(value ?? "").trim().slice(0, maximum);

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

const json = (
  response: ServerResponse,
  status: number,
  value: RecordValue,
) => {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "private, no-store, max-age=0");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("Vary", "Authorization");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.end(JSON.stringify(value));
};

const requestOrigin = (request: IncomingMessage) => {
  const configured = defaultAppOrigin();
  if (configured) return configured;
  const protocol =
    cleanText(request.headers["x-forwarded-proto"], 20).split(",")[0] || "http";
  const host =
    cleanText(request.headers["x-forwarded-host"], 500).split(",")[0] ||
    cleanText(request.headers.host, 500);
  return host ? `${protocol}://${host}` : "";
};

const readBody = async (request: IncomingMessage) => {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 128_000) {
      throw new StorageApiError(
        "This storage request is too large.",
        413,
        "storage_request_too_large",
      );
    }
  }
  if (!body) return {} as RecordValue;
  try {
    const value = JSON.parse(body) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Invalid request");
    }
    return value as RecordValue;
  } catch {
    throw new StorageApiError("This storage request could not be read.");
  }
};

const optionalAuthenticatedUserId = async (request: IncomingMessage) => {
  const authorization = cleanText(request.headers.authorization, 4_096);
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, signingSecret(), {
      audience: "maxform-dashboard",
      issuer: "maxform",
    });
    const userId = cleanText(payload.userId, 64);
    if (!isUuid(userId)) throw new Error("Invalid user");
    return userId;
  } catch {
    throw new StorageApiError(
      "Your session has expired. Sign in and try again.",
      401,
      "authentication_required",
    );
  }
};

const authenticatedUserId = async (request: IncomingMessage) => {
  const userId = await optionalAuthenticatedUserId(request);
  if (!userId) {
    throw new StorageApiError(
      "Sign in before accessing this file.",
      401,
      "authentication_required",
    );
  }
  // The workspace this request acts in. Identical to the signed-in id for
  // a workspace owner; an added member resolves to the workspace they
  // belong to, so every query below reads and writes the same rows.
  return workspaceScopeFor(userId);
};

const jsonObject = (value: unknown): RecordValue => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as RecordValue;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as RecordValue)
        : {};
    } catch {
      return {};
    }
  }
  return {};
};

const requestIp = (request: IncomingMessage) => {
  const trustProxy = process.env.TRUST_PROXY_HEADERS === "true";
  const forwarded = trustProxy
    ? cleanText(request.headers["x-forwarded-for"], 200).split(",")[0].trim()
    : "";
  const candidate = forwarded || request.socket.remoteAddress || "";
  return isIP(candidate) ? candidate : "unknown";
};

const rateLimitUploadIntent = async (
  identifier: string,
  maximum: number,
) => {
  // Redis counts the window in one round trip; the table below is the
  // fallback for when Redis is unconfigured or unreachable.
  const limited = await consumeRateLimit({
    action: "storage:upload-intent",
    identifier,
    limit: maximum,
    windowSeconds: 60,
  });
  if (limited.supported) {
    if (!limited.allowed) {
      throw new StorageApiError(
        "Too many upload attempts. Wait a minute and try again.",
        429,
        "storage_rate_limited",
      );
    }
    return;
  }
  const hash = createHash("sha256").update(identifier).digest("hex");
  const rows = await database().query(
    `INSERT INTO storage_upload_rate_limits (
       identifier_hash, window_start, request_count
     )
     VALUES ($1, date_trunc('minute', NOW()), 1)
     ON CONFLICT (identifier_hash, window_start)
     DO UPDATE SET request_count =
       storage_upload_rate_limits.request_count + 1
     WHERE storage_upload_rate_limits.request_count < $2
     RETURNING request_count`,
    [hash, maximum],
  );
  if (!rows[0]) {
    throw new StorageApiError(
      "Too many upload attempts. Wait a minute and try again.",
      429,
      "storage_rate_limited",
    );
  }
};

const acceptedFormMimeType = (
  fieldType: string,
  config: RecordValue,
  mimeType: string,
  fileName: string,
) => {
  if (fieldType === "signature") return mimeType === "image/png";
  if (fieldType === "camera") return mimeType.startsWith("image/");
  const extension = fileName.split(".").pop()?.toLowerCase() || "";
  switch (cleanText(config.acceptedFileTypes, 30)) {
    case "images":
      return mimeType.startsWith("image/");
    case "pdf":
      return mimeType === "application/pdf" || extension === "pdf";
    case "documents":
      return new Set([
        "csv",
        "doc",
        "docx",
        "pdf",
        "rtf",
        "txt",
        "xls",
        "xlsx",
      ]).has(extension);
    default:
      return true;
  }
};

const publicFormUploadContext = async (input: RecordValue) => {
  const formId = cleanText(input.formId, 64);
  const fieldId = cleanText(input.fieldId, 160);
  if (!isUuid(formId) || !fieldId) {
    throw new StorageApiError("Choose a valid form upload field.");
  }
  const rows = await database().query(
    `SELECT form.created_by, field.field_type, field.config
     FROM forms form
     JOIN form_fields field ON field.form_id = form.id
     WHERE form.id = $1
       AND field.field_id = $2
       AND field.field_type IN ('file', 'multipleFiles', 'camera', 'signature')
       AND form.status = 'published'
       AND COALESCE(form.settings->>'lifecycle', 'active') = 'active'
     LIMIT 1`,
    [formId, fieldId],
  );
  const row = rows[0] as DatabaseRow | undefined;
  if (!row || !isUuid(cleanText(row.created_by, 64))) {
    throw new StorageApiError(
      "This form upload is unavailable.",
      404,
      "form_upload_unavailable",
    );
  }
  const config = jsonObject(row.config);
  const fieldType = cleanText(row.field_type, 30);
  const configuredMaximumMb =
    fieldType === "signature"
      ? 2
      : Math.max(1, Math.min(25, Number(config.maxFileSizeMb || 5) || 5));
  return {
    ownerUserId: cleanText(row.created_by, 64),
    sourceId: formId,
    fieldId,
    fieldType,
    config,
    maximumBytes: configuredMaximumMb * 1024 * 1024,
  };
};

const assertAuthenticatedSourceOwnership = async (
  userId: string,
  purpose: StoragePurpose,
  sourceIdValue: unknown,
) => {
  const sourceId = cleanText(sourceIdValue, 64);
  if (!sourceId) return null;
  if (!isUuid(sourceId)) {
    throw new StorageApiError("The upload source is invalid.");
  }
  const ownershipQuery =
    purpose === "event_asset"
      ? "SELECT id FROM events WHERE id = $1 AND created_by = $2 LIMIT 1"
      : purpose === "form_asset"
        ? "SELECT id FROM forms WHERE id = $1 AND created_by = $2 LIMIT 1"
        : purpose === "crm_attachment"
          ? `SELECT id FROM contacts
             WHERE id = $1 AND created_by = $2 LIMIT 1`
          : null;
  if (ownershipQuery) {
    const rows = await database().query(ownershipQuery, [sourceId, userId]);
    if (!rows[0]) {
      throw new StorageApiError(
        "The upload source was not found.",
        404,
        "storage_source_not_found",
      );
    }
  }
  return sourceId;
};

const uploadSessionToken = () => randomBytes(32).toString("base64url");
const tokenHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

const locationForRow = (row: DatabaseRow): StorageObjectLocation => ({
  bucket: cleanText(row.bucket_name, 255),
  key: cleanText(row.object_key, 1_024),
  publicUrl: cleanText(row.public_url, 2_000) || null,
  visibility:
    cleanText(row.visibility, 20) === "public" ? "public" : "private",
});

const uploadLocationForSession = (
  row: DatabaseRow,
): StorageObjectLocation => ({
  bucket: cleanText(row.upload_bucket_name || row.bucket_name, 255),
  key: cleanText(row.upload_object_key || row.object_key, 1_024),
  publicUrl: null,
  visibility:
    cleanText(row.upload_visibility || row.visibility, 20) === "public"
      ? "public"
      : "private",
});

const targetLocationForSession = (
  row: DatabaseRow,
): StorageObjectLocation => ({
  bucket: cleanText(row.target_bucket_name || row.bucket_name, 255),
  key: cleanText(row.target_object_key || row.object_key, 1_024),
  publicUrl:
    cleanText(row.target_public_url || row.public_url, 2_000) || null,
  visibility:
    cleanText(row.target_visibility || row.visibility, 20) === "public"
      ? "public"
      : "private",
});

const sameLocation = (
  left: StorageObjectLocation,
  right: StorageObjectLocation,
) => left.bucket === right.bucket && left.key === right.key;

const auditStorageEvent = async (input: {
  actorUserId?: string | null;
  storageObjectId?: string | null;
  action: string;
  outcome?: "succeeded" | "denied" | "failed";
  reasonCode?: string;
  metadata?: RecordValue;
}) => {
  await database()
    .query(
      `INSERT INTO storage_audit_events (
         actor_user_id, storage_object_id, action, outcome,
         reason_code, metadata, created_at
       )
       VALUES (
         NULLIF($1, '')::uuid, NULLIF($2, '')::uuid, $3, $4, $5,
         $6::jsonb, NOW()
       )`,
      [
        input.actorUserId || "",
        input.storageObjectId || "",
        cleanText(input.action, 80),
        input.outcome || "succeeded",
        cleanText(input.reasonCode, 120),
        JSON.stringify(input.metadata || {}),
      ],
    )
    .catch(() => undefined);
};

const uploadSessionByToken = async (value: unknown) => {
  const token = cleanText(value, 200);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new StorageApiError(
      "This upload session is invalid.",
      404,
      "upload_session_invalid",
    );
  }
  const rows = await database().query(
    `SELECT session.*, object.bucket_name, object.object_key,
            object.public_url, object.visibility, object.file_name,
            object.mime_type, object.size_bytes, object.user_id,
            object.purpose, object.status AS object_status
     FROM storage_upload_sessions session
     JOIN storage_objects object ON object.id = session.storage_object_id
     WHERE session.token_hash = $1
       AND session.expires_at > NOW()
       AND session.status IN ('pending', 'processing')
       AND object.status = 'pending'
     LIMIT 1`,
    [tokenHash(token)],
  );
  const row = rows[0] as DatabaseRow | undefined;
  if (!row) {
    throw new StorageApiError(
      "This upload session expired or was already completed.",
      404,
      "upload_session_expired",
    );
  }
  return row;
};

const publicObject = (row: DatabaseRow) => ({
  id: cleanText(row.id || row.storage_object_id, 64),
  provider: "r2",
  objectKey:
    cleanText(row.visibility, 20) === "public"
      ? cleanText(row.object_key, 1_024)
      : "",
  fileName: cleanText(row.file_name, 255),
  mimeType: cleanText(row.mime_type, 180),
  sizeBytes: Number(row.size_bytes || 0),
  url: cleanText(row.public_url, 2_000) || null,
  visibility:
    cleanText(row.visibility, 20) === "public" ? "public" : "private",
  etag: cleanText(row.etag, 255),
  checksumSha256: cleanText(row.checksum_sha256, 255),
  scanStatus: cleanText(row.scan_status, 30) || "pending",
});

async function createUploadIntent(
  request: IncomingMessage,
  input: RecordValue,
) {
  const requestedPurpose = cleanText(input.purpose, 40) as StoragePurpose;
  if (!(requestedPurpose in storagePolicies)) {
    throw new StorageApiError(
      "This upload destination is not available.",
      400,
      "storage_purpose_invalid",
    );
  }
  const fileName = sanitizeStorageFileName(input.fileName);
  const mimeType = normalizeMimeType(input.mimeType);
  const sizeBytes = Number(input.sizeBytes);
  let userId = await optionalAuthenticatedUserId(request);
  let sourceId: string | null = null;
  let maximumBytes: number | undefined;
  let visibility: StorageVisibility =
    storagePolicies[requestedPurpose].visibility === "public"
      ? "public"
      : "private";
  let fieldId = "";

  if (requestedPurpose === "form_response") {
    const context = await publicFormUploadContext(input);
    userId = context.ownerUserId;
    sourceId = context.sourceId;
    maximumBytes = context.maximumBytes;
    fieldId = context.fieldId;
    if (!acceptedFormMimeType(
      context.fieldType,
      context.config,
      mimeType,
      fileName,
    )) {
      throw new StorageApiError(
        "Choose an accepted file type for this field.",
        415,
        "storage_type_invalid",
      );
    }
    await rateLimitUploadIntent(
      `public-form:${requestIp(request)}:${sourceId}`,
      30,
    );
  } else {
    if (!userId) {
      throw new StorageApiError(
        "Sign in before uploading a file.",
        401,
        "authentication_required",
      );
    }
    sourceId = await assertAuthenticatedSourceOwnership(
      userId,
      requestedPurpose,
      input.sourceId,
    );
    await rateLimitUploadIntent(`user:${userId}`, 120);
    const requestedVisibility = cleanText(input.visibility, 20);
    if (storagePolicies[requestedPurpose].visibility === "either") {
      visibility = requestedVisibility === "public" ? "public" : "private";
    }
  }
  if (!userId) {
    throw new StorageApiError(
      "The storage owner could not be resolved.",
      400,
      "storage_owner_invalid",
    );
  }

  const validated = validateStorageUpload({
    purpose: requestedPurpose,
    visibility,
    mimeType,
    sizeBytes,
    maximumBytes,
  });
  const objectId = randomUUID();
  const key = createStorageObjectKey({
    userId,
    purpose: requestedPurpose,
    fileName,
    sourceId,
  });
  const targetLocation = resolveStorageLocation(visibility, key);
  // Public assets are staged in the private bucket. The completion path only
  // promotes them after metadata and file-signature verification.
  const uploadLocation =
    visibility === "public"
      ? resolveStorageLocation("private", key)
      : targetLocation;
  const upload = await beginStorageUpload({
    location: uploadLocation,
    fileName,
    mimeType: validated.mimeType,
    sizeBytes: validated.sizeBytes,
    metadata: {
      "storage-object-id": objectId,
      purpose: requestedPurpose,
    },
  });
  const completionToken = uploadSessionToken();
  try {
    const saved = await database().query(
       `WITH locked_owner AS (
         SELECT pg_advisory_xact_lock(
           hashtext($2::text)::bigint
         )
       ),
       quota AS (
         SELECT
           CASE COALESCE(subscription.plan, 'trial')
             WHEN 'trial' THEN 2147483648::bigint
             WHEN 'starter' THEN 10737418240::bigint
             WHEN 'pro' THEN 53687091200::bigint
             WHEN 'business' THEN 268435456000::bigint
             WHEN 'enterprise' THEN NULL::bigint
           END
           + COALESCE(subscription.extra_storage_bytes, 0) AS allowed_bytes
         FROM (SELECT 1) seed
         LEFT JOIN workspace_subscriptions subscription
           ON subscription.user_id = $2::uuid
       ),
       current_usage AS (
         SELECT COALESCE(SUM(size_bytes), 0)::bigint AS used_bytes
         FROM storage_objects
         WHERE user_id = $2::uuid
           AND status IN ('pending', 'ready', 'quarantined', 'deleting')
       ),
       saved_object AS (
         INSERT INTO storage_objects (
           id, user_id, provider, bucket_name, object_key, file_name,
           mime_type, size_bytes, visibility, purpose, source_id,
           public_url, status, scan_status, created_at, updated_at
         )
         SELECT
           $1::uuid, $2::uuid, 'r2', $3, $4, $5, $6, $7::bigint,
           $8, $9, NULLIF($10, '')::uuid, NULLIF($11, ''),
           'pending', 'pending', NOW(), NOW()
         FROM locked_owner
         CROSS JOIN quota
         CROSS JOIN current_usage
         WHERE quota.allowed_bytes IS NULL
            OR current_usage.used_bytes + $7::bigint <= quota.allowed_bytes
         RETURNING id
       )
       INSERT INTO storage_upload_sessions (
         id, storage_object_id, user_id, token_hash, multipart_upload_id,
         part_size_bytes, expected_size_bytes, expected_mime_type,
         field_id, upload_bucket_name, upload_object_key, upload_visibility,
         target_bucket_name, target_object_key, target_public_url,
         target_visibility, status, expires_at, created_at
       )
       SELECT $12::uuid, saved_object.id, $2::uuid, $13, NULLIF($14, ''),
              $15::bigint, $7::bigint, $6, NULLIF($16, ''),
              $17, $18, $19, $20, $21, NULLIF($22, ''), $23,
              'pending',
              NOW() + INTERVAL '20 minutes', NOW()
       FROM saved_object
       RETURNING storage_object_id`,
      [
        objectId,
        userId,
        uploadLocation.bucket,
        uploadLocation.key,
        fileName,
        validated.mimeType,
        validated.sizeBytes,
        uploadLocation.visibility,
        requestedPurpose,
        sourceId || "",
        uploadLocation.publicUrl || "",
        randomUUID(),
        tokenHash(completionToken),
        upload.mode === "multipart" ? upload.uploadId : null,
        upload.mode === "multipart" ? upload.partSize : null,
        fieldId,
        uploadLocation.bucket,
        uploadLocation.key,
        uploadLocation.visibility,
        targetLocation.bucket,
        targetLocation.key,
        targetLocation.publicUrl || "",
        targetLocation.visibility,
      ],
    );
    if (!saved[0]) {
      throw new StorageApiError(
        "This upload would exceed the workspace storage allowance.",
        413,
        "storage_quota_exceeded",
      );
    }
  } catch (error) {
    if (upload.mode === "multipart") {
      await abortStorageMultipartUpload({
        location: uploadLocation,
        uploadId: upload.uploadId,
      }).catch(() => undefined);
    }
    throw error;
  }
  return {
    object: {
      id: objectId,
      provider: "r2",
      objectKey: "",
      fileName,
      mimeType: validated.mimeType,
      sizeBytes: validated.sizeBytes,
      url: null,
      visibility,
    },
    upload,
    completionToken,
  };
}

async function signParts(input: RecordValue) {
  const session = await uploadSessionByToken(input.completionToken);
  if (cleanText(session.status, 30) !== "pending") {
    throw new StorageApiError(
      "This upload is already being verified.",
      409,
      "upload_processing",
    );
  }
  const uploadId = cleanText(session.multipart_upload_id, 2_000);
  if (!uploadId) {
    throw new StorageApiError(
      "This is not a multipart upload.",
      409,
      "multipart_not_enabled",
    );
  }
  if (!Array.isArray(input.partNumbers) || input.partNumbers.length > 100) {
    throw new StorageApiError(
      "Choose no more than 100 upload parts at a time.",
    );
  }
  const partNumbers = input.partNumbers.map(Number);
  const partSize = Number(session.part_size_bytes || 0);
  const maximumPart = Math.ceil(
    Number(session.expected_size_bytes || 0) / partSize,
  );
  if (
    partNumbers.some(
      (part) =>
        !Number.isInteger(part) || part < 1 || part > maximumPart,
    )
  ) {
    throw new StorageApiError("One or more upload parts are invalid.");
  }
  return {
    parts: await signStorageUploadParts({
      location: uploadLocationForSession(session),
      uploadId,
      partNumbers,
    }),
  };
}

async function quarantineUpload(
  session: DatabaseRow,
  reason: string,
) {
  const location = uploadLocationForSession(session);
  await deleteStorageObject(location).catch(() => undefined);
  await database().query(
    `WITH updated_object AS (
       UPDATE storage_objects
       SET status = 'quarantined', scan_status = 'quarantined',
           metadata = metadata || jsonb_build_object('rejectionReason', $1),
           updated_at = NOW()
       WHERE id = $2
     )
     UPDATE storage_upload_sessions
     SET status = 'rejected', completed_at = NOW()
     WHERE storage_object_id = $2
       AND status IN ('pending', 'processing')`,
    [reason, String(session.storage_object_id)],
  );
  await auditStorageEvent({
    actorUserId: cleanText(session.user_id, 64),
    storageObjectId: cleanText(session.storage_object_id, 64),
    action: "upload_verify",
    outcome: "denied",
    reasonCode: reason,
  });
}

async function completeUpload(input: RecordValue) {
  const session = await uploadSessionByToken(input.completionToken);
  const uploadLocation = uploadLocationForSession(session);
  const targetLocation = targetLocationForSession(session);
  const uploadId = cleanText(session.multipart_upload_id, 2_000);
  const wasPending = cleanText(session.status, 30) === "pending";
  if (wasPending) {
    const claimed = await database().query(
      `UPDATE storage_upload_sessions
       SET status = 'processing'
       WHERE id = $1 AND status = 'pending'
       RETURNING id`,
      [String(session.id)],
    );
    if (!claimed[0]) {
      throw new StorageApiError(
        "This upload is already being verified.",
        409,
        "upload_processing",
      );
    }
  }
  if (uploadId && wasPending) {
    if (!Array.isArray(input.parts)) {
      await database().query(
        `UPDATE storage_upload_sessions
         SET status = 'pending'
         WHERE id = $1 AND status = 'processing'`,
        [String(session.id)],
      );
      throw new StorageApiError("The multipart upload is incomplete.");
    }
    try {
      await completeStorageMultipartUpload({
        location: uploadLocation,
        uploadId,
        parts: input.parts.map((part) => {
          const value =
            part && typeof part === "object" ? (part as RecordValue) : {};
          return {
            partNumber: Number(value.partNumber),
            etag: cleanText(value.etag, 255),
          };
        }),
      });
    } catch (error) {
      await database()
        .query(
          `UPDATE storage_upload_sessions
           SET status = 'pending'
           WHERE id = $1 AND status = 'processing'`,
          [String(session.id)],
        )
        .catch(() => undefined);
      throw error;
    }
  }

  let head;
  try {
    head = await headStorageObject(uploadLocation);
  } catch (error) {
    if (error instanceof StorageServiceError) {
      throw new StorageApiError(
        "The uploaded file could not be verified. Upload it again.",
        422,
        "storage_verification_failed",
      );
    }
    throw error;
  }
  const expectedSize = Number(session.expected_size_bytes || 0);
  const expectedMimeType = normalizeMimeType(session.expected_mime_type);
  if (
    head.contentLength !== expectedSize ||
    head.contentType !== expectedMimeType
  ) {
    await quarantineUpload(session, "metadata_mismatch");
    throw new StorageApiError(
      "The uploaded file did not match the approved upload.",
      422,
      "storage_verification_failed",
    );
  }
  const prefix = await readStorageObjectPrefix(uploadLocation);
  if (!validateObjectSignature(expectedMimeType, prefix)) {
    await quarantineUpload(session, "signature_mismatch");
    throw new StorageApiError(
      "The uploaded file content does not match its declared type.",
      422,
      "storage_signature_invalid",
    );
  }

  let finalHead = head;
  if (!sameLocation(uploadLocation, targetLocation)) {
    await copyStorageObject({
      source: uploadLocation,
      destination: targetLocation,
      fileName: cleanText(session.file_name, 255),
      mimeType: expectedMimeType,
      metadata: {
        "storage-object-id": cleanText(session.storage_object_id, 64),
        purpose: cleanText(session.purpose, 40),
      },
    });
    finalHead = await headStorageObject(targetLocation);
    if (
      finalHead.contentLength !== expectedSize ||
      finalHead.contentType !== expectedMimeType
    ) {
      await deleteStorageObject(targetLocation).catch(() => undefined);
      await quarantineUpload(session, "promotion_mismatch");
      throw new StorageApiError(
        "The uploaded asset could not be promoted safely.",
        422,
        "storage_verification_failed",
      );
    }
  }

  const rows = await database().query(
    `WITH updated_object AS (
       UPDATE storage_objects
       SET bucket_name = $1, object_key = $2, public_url = NULLIF($3, ''),
           visibility = $4, status = 'ready', scan_status = 'validated',
           etag = $5, checksum_sha256 = NULLIF($6, ''),
           metadata = metadata || jsonb_build_object(
             'validationMethod', 'allowlist_and_magic_bytes',
             'malwareScanner', 'not_configured'
           ),
           verified_at = NOW(),
           updated_at = NOW()
       WHERE id = $7 AND status = 'pending'
       RETURNING *
     ),
     updated_session AS (
       UPDATE storage_upload_sessions
       SET status = 'completed', completed_at = NOW()
       WHERE storage_object_id = $7 AND status = 'processing'
       RETURNING storage_object_id
     )
     SELECT * FROM updated_object`,
    [
      targetLocation.bucket,
      targetLocation.key,
      targetLocation.publicUrl || "",
      targetLocation.visibility,
      finalHead.etag,
      finalHead.checksumSha256,
      String(session.storage_object_id),
    ],
  );
  const object = rows[0] as DatabaseRow | undefined;
  if (!object) {
    throw new StorageApiError(
      "This upload was already completed.",
      409,
      "upload_already_completed",
    );
  }
  if (!sameLocation(uploadLocation, targetLocation)) {
    const stagingDeleted = await deleteStorageObject(uploadLocation)
      .then(() => true)
      .catch(() => false);
    if (stagingDeleted) {
      await database()
        .query(
          `UPDATE storage_upload_sessions
           SET staging_deleted_at = NOW()
           WHERE storage_object_id = $1`,
          [String(object.id)],
        )
        .catch(() => undefined);
    }
  }
  if (
    cleanText(object.purpose, 40) === "crm_attachment" &&
    isUuid(cleanText(object.source_id, 64))
  ) {
    await database().query(
      `INSERT INTO crm_attachments (
         user_id, contact_id, storage_object_id, created_at
       )
       SELECT object.user_id, object.source_id, object.id, NOW()
       FROM storage_objects object
       JOIN contacts contact
         ON contact.id = object.source_id
        AND contact.created_by = object.user_id
       WHERE object.id = $1
       ON CONFLICT (storage_object_id) DO NOTHING`,
      [String(object.id)],
    );
  }
  await auditStorageEvent({
    actorUserId: cleanText(object.user_id, 64),
    storageObjectId: cleanText(object.id, 64),
    action: "upload_complete",
    metadata: {
      purpose: cleanText(object.purpose, 40),
      visibility: cleanText(object.visibility, 20),
      sizeBytes: Number(object.size_bytes || 0),
    },
  });
  return { object: publicObject(object) };
}

async function abortUpload(input: RecordValue) {
  const session = await uploadSessionByToken(input.completionToken);
  if (cleanText(session.status, 30) !== "pending") {
    throw new StorageApiError(
      "This upload is already being verified and cannot be aborted.",
      409,
      "upload_processing",
    );
  }
  const location = uploadLocationForSession(session);
  const uploadId = cleanText(session.multipart_upload_id, 2_000);
  if (uploadId) {
    await abortStorageMultipartUpload({ location, uploadId }).catch(
      () => undefined,
    );
  } else {
    await deleteStorageObject(location).catch(() => undefined);
  }
  await database().query(
    `WITH removed_object AS (
       UPDATE storage_objects
       SET status = 'deleted', deleted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status = 'pending'
     )
     UPDATE storage_upload_sessions
     SET status = 'aborted', completed_at = NOW()
     WHERE storage_object_id = $1 AND status = 'pending'`,
    [String(session.storage_object_id)],
  );
  return { aborted: true };
}

async function ownedReadyObject(userId: string, objectIdValue: unknown) {
  const objectId = cleanText(objectIdValue, 64);
  if (!isUuid(objectId)) {
    throw new StorageApiError("Choose a valid stored file.");
  }
  const rows = await database().query(
    `SELECT *
     FROM storage_objects
     WHERE id = $1 AND user_id = $2
       AND status = 'ready' AND scan_status = 'validated'
       AND deleted_at IS NULL
     LIMIT 1`,
    [objectId, userId],
  );
  const row = rows[0] as DatabaseRow | undefined;
  if (!row) {
    await auditStorageEvent({
      actorUserId: userId,
      storageObjectId: objectId,
      action: "download_authorize",
      outcome: "denied",
      reasonCode: "not_owned_or_not_ready",
    });
    throw new StorageApiError(
      "This stored file was not found.",
      404,
      "storage_object_not_found",
    );
  }
  return row;
}

const storageWorkspaceQuery: WorkspaceQuery = (query, parameters) =>
  database().query(query, parameters) as Promise<Record<string, unknown>[]>;

// A branded link keeps the app's domain in front of the user instead of a
// presigned provider URL. It needs the workspace short id and a public origin;
// without either we fall back to the presigned URL so access never breaks.
const brandedAccessContext = async (userId: string, origin: string) => {
  const appOrigin = String(origin || "").trim() || defaultAppOrigin();
  if (!appOrigin) return { origin: "", workspaceShortId: "" };
  return {
    origin: appOrigin,
    workspaceShortId: await ensureWorkspaceShortId(
      storageWorkspaceQuery,
      userId,
    ),
  };
};

const inlineByDefault = (mimeType: string) =>
  mimeType.startsWith("image/") ||
  mimeType === "application/pdf" ||
  mimeType.startsWith("text/");

async function accessObject(
  userId: string,
  input: RecordValue,
  origin = "",
) {
  const object = await ownedReadyObject(userId, input.objectId);
  const mimeType = cleanText(object.mime_type, 180);
  const inline =
    input.disposition !== "attachment" && inlineByDefault(mimeType);
  const context = await brandedAccessContext(userId, origin);
  const branded = createBrandedFileLink({
    origin: context.origin,
    workspaceShortId: context.workspaceShortId,
    storageObjectId: cleanText(object.id, 64),
    disposition: inline ? "inline" : "attachment",
  });
  const url =
    branded?.url ||
    (await createSignedStorageDownload({
      location: locationForRow(object),
      fileName: cleanText(object.file_name, 255),
      mimeType,
      inline,
    }));
  await auditStorageEvent({
    actorUserId: userId,
    storageObjectId: cleanText(object.id, 64),
    action: "download_authorize",
  });
  return {
    object: publicObject(object),
    url,
    expiresInSeconds: branded?.expiresInSeconds || 300,
  };
}

async function accessObjects(
  userId: string,
  input: RecordValue,
  origin = "",
) {
  const objectIds = Array.isArray(input.objectIds)
    ? Array.from(
        new Set(
          input.objectIds
            .map((value) => cleanText(value, 64))
            .filter((value) => isUuid(value)),
        ),
      )
    : [];
  if (objectIds.length === 0 || objectIds.length > 100) {
    throw new StorageApiError(
      "Choose between 1 and 100 stored files.",
      400,
      "storage_object_batch_invalid",
    );
  }
  const rows = await database().query(
    `SELECT *
     FROM storage_objects
     WHERE id = ANY($1::uuid[])
       AND user_id = $2
       AND status = 'ready'
       AND scan_status = 'validated'
       AND deleted_at IS NULL`,
    [objectIds, userId],
  );
  const context = await brandedAccessContext(userId, origin);
  const objects = await Promise.all(
    rows.map(async (row) => {
      const object = row as DatabaseRow;
      const mimeType = cleanText(object.mime_type, 180);
      const inline = inlineByDefault(mimeType);
      const branded = createBrandedFileLink({
        origin: context.origin,
        workspaceShortId: context.workspaceShortId,
        storageObjectId: cleanText(object.id, 64),
        disposition: inline ? "inline" : "attachment",
      });
      return {
        object: publicObject(object),
        url:
          branded?.url ||
          (await createSignedStorageDownload({
            location: locationForRow(object),
            fileName: cleanText(object.file_name, 255),
            mimeType,
            inline,
          })),
      };
    }),
  );
  await auditStorageEvent({
    actorUserId: userId,
    action: "download_authorize_batch",
    metadata: { count: objects.length },
  });
  return { objects, expiresInSeconds: 300 };
}

async function removeObject(userId: string, input: RecordValue) {
  const objectId = cleanText(input.objectId, 64);
  if (!isUuid(objectId)) {
    throw new StorageApiError("Choose a valid stored file.");
  }
  const rows = await database().query(
    `SELECT *
     FROM storage_objects
     WHERE id = $1 AND user_id = $2
       AND status IN ('ready', 'deleting', 'deleted')
     LIMIT 1`,
    [objectId, userId],
  );
  const object = rows[0] as DatabaseRow | undefined;
  if (!object) {
    await auditStorageEvent({
      actorUserId: userId,
      storageObjectId: objectId,
      action: "object_delete",
      outcome: "denied",
      reasonCode: "not_owned",
    });
    throw new StorageApiError(
      "This stored file was not found.",
      404,
      "storage_object_not_found",
    );
  }
  if (cleanText(object.status, 30) === "deleted") {
    return { deleted: true };
  }
  if (cleanText(object.visibility, 20) === "public") {
    throw new StorageApiError(
      "Remove this public asset from the feature using it. The storage cleanup job will delete the unreferenced asset safely.",
      409,
      "public_asset_still_managed",
    );
  }
  await database().query(
    `UPDATE storage_objects
     SET status = 'deleting', updated_at = NOW()
     WHERE id = $1 AND user_id = $2
       AND status IN ('ready', 'deleting')`,
    [objectId, userId],
  );
  try {
    await deleteStorageObject(locationForRow(object));
  } catch (error) {
    await auditStorageEvent({
      actorUserId: userId,
      storageObjectId: objectId,
      action: "object_delete",
      outcome: "failed",
      reasonCode: "provider_delete_failed",
    });
    throw error;
  }
  await database().query(
    `WITH removed_crm_reference AS (
       DELETE FROM crm_attachments
       WHERE storage_object_id = $1 AND user_id = $2
     ),
     removed_form_reference AS (
       DELETE FROM form_submission_files file
       USING forms form
       WHERE file.storage_object_id = $1
         AND file.form_id = form.id
         AND form.created_by = $2
     ),
     removed_workspace_reference AS (
       DELETE FROM workspace_files
       WHERE storage_object_id = $1 AND user_id = $2
     )
     UPDATE storage_objects
     SET status = 'deleted', deleted_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND user_id = $2 AND status = 'deleting'`,
    [objectId, userId],
  );
  await auditStorageEvent({
    actorUserId: userId,
    storageObjectId: objectId,
    action: "object_delete",
  });
  return { deleted: true };
}

export const getStoredObjectAccessBatchServer = (
  userId: string,
  objectIds: string[],
) => accessObjects(userId, { objectIds });

export const deleteStoredObjectServer = (
  userId: string,
  objectId: string,
) => removeObject(userId, { objectId });

export async function handleStorageApi(
  request: IncomingMessage,
  response: ServerResponse,
) {
  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.setHeader("Allow", "POST, OPTIONS");
    response.end();
    return;
  }
  if (request.method !== "POST") {
    json(response, 405, {
      code: "method_not_allowed",
      error: "This storage method is not available.",
    });
    return;
  }
  try {
    const url = new URL(request.url || "/", "http://localhost");
    const action = cleanText(url.searchParams.get("action"), 40);
    const body = await readBody(request);
    if (action === "intent") {
      json(response, 201, await createUploadIntent(request, body));
      return;
    }
    if (action === "parts") {
      json(response, 200, await signParts(body));
      return;
    }
    if (action === "complete") {
      json(response, 200, await completeUpload(body));
      return;
    }
    if (action === "abort") {
      json(response, 200, await abortUpload(body));
      return;
    }
    if (action === "access") {
      const userId = await authenticatedUserId(request);
      json(
        response,
        200,
        await accessObject(userId, body, requestOrigin(request)),
      );
      return;
    }
    if (action === "access-batch") {
      const userId = await authenticatedUserId(request);
      json(
        response,
        200,
        await accessObjects(userId, body, requestOrigin(request)),
      );
      return;
    }
    if (action === "delete") {
      const userId = await authenticatedUserId(request);
      json(response, 200, await removeObject(userId, body));
      return;
    }
    if (action === "health") {
      await authenticatedUserId(request);
      json(response, 200, {
        ok: true,
        ...(await checkStorageHealth()),
      });
      return;
    }
    json(response, 404, {
      code: "storage_action_not_found",
      error: "This storage action is not available.",
    });
  } catch (error) {
    if (error instanceof StorageApiError) {
      json(response, error.status, { code: error.code, error: error.message });
      return;
    }
    if (error instanceof StorageServiceError) {
      json(response, error.status, { code: error.code, error: error.message });
      return;
    }
    const code =
      error && typeof error === "object" && "code" in error
        ? cleanText((error as { code?: unknown }).code, 80)
        : "unknown";
    console.error("[storage-api] unexpected request failure", {
      code,
      type: error instanceof Error ? error.name : typeof error,
      message:
        error instanceof Error
          ? cleanText(error.message.replace(/https?:\/\/\S+/gi, "[redacted]"), 240)
          : "Unknown error",
    });
    json(response, 500, {
      code: "storage_unavailable",
      error: "Storage is temporarily unavailable. Please try again.",
    });
  }
}

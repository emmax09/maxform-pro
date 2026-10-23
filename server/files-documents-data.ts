import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isIP } from "node:net";

import { neon } from "@neondatabase/serverless";
import { jwtVerify } from "jose";

import { configuredAppUrl } from "./app-url";
import { sendEmailNow } from "./email-service";
import {
  createBrandedFileLink,
  ensureWorkspaceShortId,
  readBrandedFileToken,
  workspaceShortIdPattern,
  type WorkspaceQuery,
} from "./branded-file-links";
import {
  ExternalStorageError,
  copyWorkspaceFileToExternal,
  copyWorkspaceFilesToExternal,
  createExternalStorageFolder,
  getExternalStorageWorkspace,
  importExternalFileToMaxForm,
  linkExternalFile,
  listExternalStorageDrives,
  listExternalStorageItems,
  retryExternalStorageOperation,
  unlinkExternalFile,
} from "./external-storage";
import {
  createSignedStorageDownload,
  deleteStorageObject,
  getStorageObjectStream,
  normalizeMimeType,
  putStorageObject,
  resolveStorageLocation,
  sanitizeStorageFileName,
  type StorageObjectLocation,
} from "./storage-service";
import { workspaceScopeFor } from "./workspace-access";
import { dispatchWorkspaceWorkflowEvent } from "./workflows-data";

type DatabaseRow = Record<string, unknown>;
type RecordValue = Record<string, unknown>;

class WorkspaceContentError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "workspace_content_error",
  ) {
    super(message);
  }
}

const database = () => {
  const url = process.env.DATABASE_URL || "";
  if (!url) {
    throw new WorkspaceContentError(
      "Files and documents are temporarily unavailable.",
      503,
      "workspace_content_unavailable",
    );
  }
  return neon(url);
};

const signingSecret = () => {
  const secret = process.env.JWT_SECRET || "";
  if (secret.length < 32) {
    throw new WorkspaceContentError(
      "Files and documents are temporarily unavailable.",
      503,
      "workspace_content_unavailable",
    );
  }
  return new TextEncoder().encode(secret);
};

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

const isEmail = (value: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 320;

const cleanText = (value: unknown, maximum: number) =>
  String(value ?? "").trim().slice(0, maximum);

const jsonValue = <T>(value: unknown, fallback: T): T => {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return typeof value === "object" ? (value as T) : fallback;
};

const safeFileName = (value: unknown, fallback = "Untitled file") => {
  const withoutControlCharacters = Array.from(cleanText(value, 255))
    .map((character) => (character.charCodeAt(0) < 32 ? "-" : character))
    .join("");
  const name = withoutControlCharacters
    .replace(/[<>:"/\\|?*]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return name || fallback;
};

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

const authenticatedUserId = async (request: IncomingMessage) => {
  const authorization = cleanText(request.headers.authorization, 4_096);
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";
  if (!token) {
    throw new WorkspaceContentError(
      "Your session has expired. Sign in and try again.",
      401,
      "authentication_required",
    );
  }
  try {
    const { payload } = await jwtVerify(token, signingSecret(), {
      audience: "maxform-dashboard",
      issuer: "maxform",
    });
    const userId = cleanText(payload.userId, 64);
    if (!isUuid(userId)) throw new Error("Invalid user");
    // The workspace this request acts in. Identical to the signed-in id
    // for a workspace owner; an added member resolves to the workspace
    // they belong to, so every query below reads the same rows.
    return workspaceScopeFor(userId);
  } catch (error) {
    if (error instanceof WorkspaceContentError) throw error;
    throw new WorkspaceContentError(
      "Your session has expired. Sign in and try again.",
      401,
      "authentication_required",
    );
  }
};

const readBody = async (request: IncomingMessage) => {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 12_500_000) {
      throw new WorkspaceContentError(
        "This upload is too large. Choose a file smaller than 8 MB.",
        413,
        "upload_too_large",
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
    throw new WorkspaceContentError("This request could not be read.");
  }
};

const requestIp = (request: IncomingMessage) => {
  const forwarded = cleanText(request.headers["x-forwarded-for"], 200)
    .split(",")[0]
    .trim();
  const candidate = forwarded || request.socket.remoteAddress || "";
  return isIP(candidate) ? candidate : null;
};

const requestOrigin = (request: IncomingMessage) => {
  const configured = cleanText(configuredAppUrl(), 500);
  if (configured) return configured;
  const protocol =
    cleanText(request.headers["x-forwarded-proto"], 20).split(",")[0] ||
    "http";
  const host =
    cleanText(request.headers["x-forwarded-host"], 500).split(",")[0] ||
    cleanText(request.headers.host, 500) ||
    "localhost:8080";
  return `${protocol}://${host}`;
};

const workspaceQuery: WorkspaceQuery = (query, parameters) =>
  database().query(query, parameters) as Promise<
    Record<string, unknown>[]
  >;

// Short ids are assigned at signup and by migration 031. Accounts created
// before either ran are backfilled here so sharing never dead-ends on a
// missing public id.
const workspaceShortIdFor = async (userId: string) => {
  const shortId = await ensureWorkspaceShortId(workspaceQuery, userId);
  if (!workspaceShortIdPattern.test(shortId)) {
    throw new WorkspaceContentError(
      "This workspace could not be given a public sharing ID. Please try again.",
      409,
    );
  }
  return shortId;
};

const cleanSharedFileUrl = (
  origin: string,
  workspaceShortId: unknown,
  publicFileId: string,
) => {
  const workspaceId = cleanText(workspaceShortId, 6);
  if (!workspaceShortIdPattern.test(workspaceId)) {
    throw new WorkspaceContentError(
      "This workspace does not have a public sharing ID.",
      409,
    );
  }
  return `${origin}/${workspaceId}/content/${publicFileId}`;
};

const fileFor = (row: DatabaseRow) => ({
  id: cleanText(row.id, 64),
  storageObjectId: row.storage_object_id
    ? cleanText(row.storage_object_id, 64)
    : null,
  folderId: row.folder_id ? cleanText(row.folder_id, 64) : null,
  name: cleanText(row.name, 255),
  originalFileName: cleanText(row.original_file_name, 255) || cleanText(row.name, 255),
  fileExtension: cleanText(row.file_extension, 20),
  mimeType: cleanText(row.mime_type, 180) || "application/octet-stream",
  sizeBytes: Number(row.size_bytes || 0),
  sourceType: cleanText(row.source_type, 40),
  sourceId: row.source_id ? cleanText(row.source_id, 64) : null,
  sourceLabel: cleanText(row.source_label, 500),
  fileKind:
    cleanText(row.file_kind, 20) === "signature" ? "signature" : "file",
  submissionId: row.submission_id
    ? cleanText(row.submission_id, 64)
    : null,
  collectionType: (
    cleanText(row.collection_type, 20) === "event"
      ? "event"
      : cleanText(row.collection_type, 20) === "form"
        ? "form"
        : null
  ) as "event" | "form" | null,
  collectionId: row.collection_id
    ? cleanText(row.collection_id, 64)
    : null,
  collectionName: cleanText(row.collection_name, 255),
  clientName:
    cleanText(row.client_name, 255) ||
    (row.submission_id
      ? `Response ${cleanText(row.submission_id, 64).slice(0, 8)}`
      : ""),
  clientEmail: cleanText(row.client_email, 320),
  checksumSha256: cleanText(row.checksum_sha256, 128),
  tags: Array.isArray(row.tags)
    ? row.tags.map((tag) => cleanText(tag, 60)).filter(Boolean)
    : [],
  scanStatus: cleanText(row.scan_status, 30),
  deletedAt: row.deleted_at ? String(row.deleted_at) : null,
  purgeAfter: row.purge_after ? String(row.purge_after) : null,
  createdAt: String(row.created_at || ""),
  updatedAt: String(row.updated_at || ""),
  shared: Boolean(row.shared),
});

const folderFor = (row: DatabaseRow) => ({
  id: cleanText(row.id, 64),
  parentId: row.parent_id ? cleanText(row.parent_id, 64) : null,
  name: cleanText(row.name, 160),
  createdAt: String(row.created_at || ""),
});

const templateFor = (row: DatabaseRow) => ({
  id: cleanText(row.id, 64),
  name: cleanText(row.name, 180),
  description: cleanText(row.description, 2_000),
  sourceType: cleanText(row.source_type, 30),
  baseFileId: row.base_file_id ? cleanText(row.base_file_id, 64) : null,
  baseFileName: cleanText(row.base_file_name, 255),
  blocks: jsonValue<unknown[]>(row.blocks, []),
  fieldPositions: jsonValue<unknown[]>(row.field_positions, []),
  signerRoles: jsonValue<unknown[]>(row.signer_roles, []),
  defaultSigningOrder:
    cleanText(row.default_signing_order, 20) === "parallel"
      ? "parallel"
      : "sequential",
  createdAt: String(row.created_at || ""),
  updatedAt: String(row.updated_at || ""),
});

const documentFor = (row: DatabaseRow) => ({
  id: cleanText(row.id, 64),
  templateId: row.template_id ? cleanText(row.template_id, 64) : null,
  templateName: cleanText(row.template_name, 180),
  title: cleanText(row.title, 220),
  status: cleanText(row.status, 30),
  signingOrder:
    cleanText(row.signing_order, 20) === "parallel"
      ? "parallel"
      : "sequential",
  mergeValues: jsonValue<Record<string, unknown>>(row.merge_values, {}),
  signedFileId: row.signed_file_id
    ? cleanText(row.signed_file_id, 64)
    : null,
  certificateFileId: row.certificate_file_id
    ? cleanText(row.certificate_file_id, 64)
    : null,
  documentHash: cleanText(row.document_hash, 200),
  sentAt: row.sent_at ? String(row.sent_at) : null,
  viewedAt: row.viewed_at ? String(row.viewed_at) : null,
  completedAt: row.completed_at ? String(row.completed_at) : null,
  createdAt: String(row.created_at || ""),
  updatedAt: String(row.updated_at || ""),
  signers: jsonValue<unknown[]>(row.signers, []),
  events: jsonValue<unknown[]>(row.events, []),
});

const settingsFor = (row: DatabaseRow) => ({
  defaultSigningOrder:
    cleanText(row.default_signing_order, 20) === "parallel"
      ? "parallel"
      : "sequential",
  reminderDays: Number(row.reminder_days || 3),
  expiryDays: Number(row.expiry_days || 30),
  identityVerification: Boolean(row.identity_verification),
  includeWorkspaceBranding: Boolean(row.include_workspace_branding),
  disclosureText: cleanText(row.disclosure_text, 2_000),
});

const fileSettingsFor = (row: DatabaseRow) => ({
  defaultView: cleanText(row.default_view, 20) === "list" ? "list" : "grid",
  retentionDays: Number(row.retention_days || 30),
  shareExpiryDays: Number(row.share_expiry_days || 7),
  groupBySource: row.group_by_source !== false,
});

const storageLocationFor = (row: DatabaseRow): StorageObjectLocation => ({
  bucket: cleanText(row.bucket_name, 255),
  key: cleanText(row.object_key, 1_024),
  publicUrl: cleanText(row.public_url, 2_000) || null,
  visibility:
    cleanText(row.visibility, 20) === "public" ? "public" : "private",
});

const previewableInline = (mimeType: string) =>
  mimeType.startsWith("image/") ||
  mimeType === "application/pdf" ||
  mimeType.startsWith("text/");

// Markup can execute script when a browser renders it as a document, so these
// types are served from the app's own origin under a sandbox policy.
const activeMarkupTypes = new Set([
  "text/html",
  "text/xml",
  "application/xhtml+xml",
  "application/xml",
  "image/svg+xml",
]);

const contentDispositionHeader = (fileName: string, inline: boolean) => {
  const safeName = sanitizeStorageFileName(fileName).replace(/["\r\n]/g, "-");
  return `${inline ? "inline" : "attachment"}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(
    safeName,
  )}`;
};

const requireOwnedFolder = async (
  userId: string,
  folderId: unknown,
) => {
  const id = cleanText(folderId, 64);
  if (!id) return null;
  if (!isUuid(id)) throw new WorkspaceContentError("Choose a valid folder.");
  const rows = await database().query(
    `SELECT id FROM workspace_folders WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [id, userId],
  );
  if (!rows[0]) {
    throw new WorkspaceContentError("This folder was not found.", 404);
  }
  return id;
};

const fileSourceJoins = `
  LEFT JOIN form_submission_files source_upload
    ON source_upload.storage_object_id = file.storage_object_id
    OR (
      file.storage_object_id IS NULL
      AND file.storage_key = 'forms/' || source_upload.id::text
    )
  LEFT JOIN form_submissions source_submission
    ON file.source_type IN ('form_upload', 'event_upload')
   AND source_submission.id = file.source_id
  LEFT JOIN forms source_form
    ON source_form.id = source_submission.form_id
  LEFT JOIN LATERAL (
    SELECT event.id, event.title
    FROM events event
    WHERE event.registration_form_id = source_submission.form_id
      AND event.created_by = file.user_id
    ORDER BY event.created_at DESC, event.id DESC
    LIMIT 1
  ) source_event ON TRUE
  LEFT JOIN LATERAL (
    SELECT attendee.full_name, attendee.email
    FROM event_attendees attendee
    WHERE attendee.registration_submission_id = source_submission.id
      AND attendee.event_id = source_event.id
    ORDER BY attendee.created_at DESC, attendee.id DESC
    LIMIT 1
  ) source_attendee ON TRUE
  LEFT JOIN LATERAL (
    SELECT answer.answer #>> '{}' AS value
    FROM form_submission_answers answer
    JOIN form_fields field
      ON field.form_id = source_submission.form_id
     AND field.field_id = answer.field_id
    WHERE answer.submission_id = source_submission.id
      AND answer.answer #>> '{}' <> ''
      AND (
        field.label ~* '(full[[:space:]_-]*name|client[[:space:]_-]*name|customer[[:space:]_-]*name|attendee[[:space:]_-]*name|your[[:space:]_-]*name)'
        OR (
          field.field_type = 'shortText'
          AND field.label ~* '(^|[[:space:]_-])name($|[[:space:]_-])'
        )
      )
    ORDER BY
      CASE
        WHEN field.label ~* 'full[[:space:]_-]*name' THEN 0
        WHEN field.label ~* '(client|customer|attendee)[[:space:]_-]*name' THEN 1
        ELSE 2
      END,
      field.position
    LIMIT 1
  ) source_name ON TRUE
  LEFT JOIN LATERAL (
    SELECT answer.answer #>> '{}' AS value
    FROM form_submission_answers answer
    JOIN form_fields field
      ON field.form_id = source_submission.form_id
     AND field.field_id = answer.field_id
    WHERE answer.submission_id = source_submission.id
      AND field.field_type = 'email'
      AND answer.answer #>> '{}' <> ''
    ORDER BY field.position
    LIMIT 1
  ) source_email ON TRUE`;

const fileSourceColumns = `
  source_upload.file_kind,
  source_submission.id AS submission_id,
  CASE
    WHEN source_event.id IS NOT NULL THEN 'event'
    WHEN source_form.id IS NOT NULL THEN 'form'
    ELSE NULL
  END AS collection_type,
  COALESCE(source_event.id, source_form.id) AS collection_id,
  COALESCE(source_event.title, source_form.title, '') AS collection_name,
  COALESCE(source_attendee.full_name, source_name.value, source_email.value, '')
    AS client_name,
  COALESCE(source_attendee.email, source_email.value, '') AS client_email`;

const ensureFileSettings = async (userId: string) => {
  const rows = await database().query(
    `INSERT INTO workspace_file_settings (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
     RETURNING *`,
    [userId],
  );
  return rows[0] as DatabaseRow;
};

const collectionsFor = (rows: DatabaseRow[]) => {
  const collections = new Map<
    string,
    {
      id: string;
      sourceType: "form" | "event";
      sourceId: string;
      name: string;
      fileCount: number;
      sizeBytes: number;
      submissionIds: Set<string>;
      clients: Set<string>;
      latestAt: string;
      files: ReturnType<typeof fileFor>[];
    }
  >();
  for (const row of rows) {
    const file = fileFor(row);
    if (!file.collectionType || !file.collectionId) continue;
    const id = `${file.collectionType}:${file.collectionId}`;
    const existing = collections.get(id) || {
      id,
      sourceType: file.collectionType,
      sourceId: file.collectionId,
      name:
        file.collectionName ||
        (file.collectionType === "event" ? "Untitled event" : "Untitled form"),
      fileCount: 0,
      sizeBytes: 0,
      submissionIds: new Set<string>(),
      clients: new Set<string>(),
      latestAt: file.createdAt,
      files: [] as ReturnType<typeof fileFor>[],
    };
    existing.fileCount += 1;
    existing.sizeBytes += file.sizeBytes;
    if (file.submissionId) existing.submissionIds.add(file.submissionId);
    if (file.clientName) existing.clients.add(file.clientName);
    if (file.createdAt > existing.latestAt) existing.latestAt = file.createdAt;
    existing.files.push(file);
    collections.set(id, existing);
  }
  return Array.from(collections.values())
    .map((collection) => ({
      id: collection.id,
      sourceType: collection.sourceType,
      sourceId: collection.sourceId,
      name: collection.name,
      fileCount: collection.fileCount,
      sizeBytes: collection.sizeBytes,
      submissionCount: collection.submissionIds.size,
      clients: Array.from(collection.clients).slice(0, 8),
      latestAt: collection.latestAt,
      files: collection.files,
    }))
    .sort((left, right) => right.latestAt.localeCompare(left.latestAt));
};

export async function getFilesWorkspace(
  userId: string,
  filters: {
    view?: string;
    folderId?: string;
    search?: string;
    type?: string;
    source?: string;
    projectId?: string;
  } = {},
) {
  const sql = database();
  const view = ["all", "shared", "trash"].includes(filters.view || "")
    ? filters.view!
    : "all";
  const search = cleanText(filters.search, 160);
  const type = [
    "signature",
    "image",
    "pdf",
    "document",
    "video",
    "other",
  ].includes(filters.type || "")
    ? filters.type!
    : "";
  const source = [
    "form_upload",
    "event_upload",
    "document",
    "manual",
    "import",
  ].includes(filters.source || "")
    ? filters.source!
    : "";
  const folderId =
    filters.folderId && isUuid(filters.folderId) ? filters.folderId : null;

  const conditions = ["file.user_id = $1"];
  const parameters: unknown[] = [userId];
  if (view === "trash") {
    conditions.push("file.deleted_at IS NOT NULL");
  } else {
    conditions.push("file.deleted_at IS NULL");
  }
  if (view === "shared") {
    conditions.push(
      `EXISTS (
        SELECT 1 FROM workspace_file_share_links share
        WHERE share.file_id = file.id
          AND (share.expires_at IS NULL OR share.expires_at > NOW())
      )`,
    );
  }
  if (search) {
    parameters.push(`%${search}%`);
    conditions.push(
      `(file.name ILIKE $${parameters.length} OR
        file.source_label ILIKE $${parameters.length} OR
        array_to_string(file.tags, ' ') ILIKE $${parameters.length})`,
    );
  } else if (view === "all") {
    if (folderId) {
      parameters.push(folderId);
      conditions.push(`file.folder_id = $${parameters.length}`);
    } else {
      conditions.push("file.folder_id IS NULL");
    }
  }
  if (source) {
    parameters.push(source);
    conditions.push(`file.source_type = $${parameters.length}`);
  }
  // Viewing this module through a project. A file belongs to a project when
  // the form that collected it does, when it came through an event's
  // registration form, or when it is a document produced by an order from
  // either. Kept identical to the Projects module's own file query.
  if (filters.projectId && isUuid(filters.projectId)) {
    parameters.push(filters.projectId);
    const project = `$${parameters.length}`;
    conditions.push(
      `(
        EXISTS (
          SELECT 1
          FROM form_submissions project_submission
          JOIN forms project_form ON project_form.id = project_submission.form_id
          WHERE project_submission.id = file.source_id
            AND file.source_type IN ('form_upload', 'event_upload')
            AND (
              project_form.project_id = ${project}
              OR EXISTS (
                SELECT 1 FROM events project_event
                WHERE project_event.registration_form_id = project_form.id
                  AND project_event.project_id = ${project}
              )
            )
        )
        OR EXISTS (
          SELECT 1
          FROM workspace_documents project_document
          JOIN payment_orders project_order
            ON project_order.id = project_document.order_id
          WHERE project_document.id = file.source_id
            AND file.source_type = 'document'
            AND (
              (
                project_order.source_type = 'form'
                AND EXISTS (
                  SELECT 1 FROM forms owned_form
                  WHERE owned_form.id = project_order.source_id
                    AND owned_form.project_id = ${project}
                )
              )
              OR (
                project_order.source_type = 'event'
                AND EXISTS (
                  SELECT 1 FROM events owned_event
                  WHERE owned_event.id = project_order.source_id
                    AND owned_event.project_id = ${project}
                )
              )
            )
        )
      )`,
    );
  }
  if (type === "signature") {
    conditions.push("source_upload.file_kind = 'signature'");
  }
  if (type === "image") {
    conditions.push(
      "file.mime_type LIKE 'image/%' AND COALESCE(source_upload.file_kind, 'file') <> 'signature'",
    );
  }
  if (type === "pdf") conditions.push("file.mime_type = 'application/pdf'");
  if (type === "video") conditions.push("file.mime_type LIKE 'video/%'");
  if (type === "document") {
    conditions.push(
      `(file.mime_type LIKE 'text/%' OR
        file.mime_type IN (
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        ))`,
    );
  }
  if (type === "other") {
    conditions.push(
      `(file.mime_type NOT LIKE 'image/%' AND
        file.mime_type NOT LIKE 'video/%' AND
        file.mime_type NOT LIKE 'text/%' AND
        file.mime_type <> 'application/pdf' AND
        file.mime_type NOT IN (
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        ))`,
    );
  }

  const [folders, files, collectionRows, usageRows, sourceRows, countRows, settings] =
    await Promise.all([
    sql.query(
      `SELECT id, parent_id, name, created_at
       FROM workspace_folders
       WHERE user_id = $1
       ORDER BY LOWER(name)`,
      [userId],
    ),
    sql.query(
      `SELECT file.id, file.folder_id, file.name, file.original_file_name,
              file.file_extension, file.mime_type, file.checksum_sha256,
              file.size_bytes, file.source_type, file.source_id,
              file.source_label, file.tags, file.scan_status,
              file.deleted_at, file.purge_after, file.created_at,
              file.updated_at,
              EXISTS (
                SELECT 1 FROM workspace_file_share_links share
                WHERE share.file_id = file.id
                  AND (share.expires_at IS NULL OR share.expires_at > NOW())
              ) AS shared,
              ${fileSourceColumns}
       FROM workspace_files file
       ${fileSourceJoins}
       WHERE ${conditions.join("\n AND ")}
       ORDER BY file.created_at DESC, file.id DESC
       LIMIT 250`,
      parameters,
    ),
    sql.query(
      `SELECT file.id, file.folder_id, file.name, file.original_file_name,
              file.file_extension, file.mime_type, file.checksum_sha256,
              file.size_bytes, file.source_type, file.source_id,
              file.source_label, file.tags, file.scan_status,
              file.deleted_at, file.purge_after, file.created_at,
              file.updated_at,
              EXISTS (
                SELECT 1 FROM workspace_file_share_links share
                WHERE share.file_id = file.id
                  AND (share.expires_at IS NULL OR share.expires_at > NOW())
              ) AS shared,
              ${fileSourceColumns}
       FROM workspace_files file
       ${fileSourceJoins}
       WHERE file.user_id = $1
         AND file.deleted_at IS NULL
         AND file.source_type IN ('form_upload', 'event_upload')
       ORDER BY file.created_at DESC, file.id DESC
       LIMIT 1000`,
      [userId],
    ),
    sql.query(
      `SELECT COALESCE(SUM(size_bytes), 0)::bigint AS used_bytes,
              COUNT(*)::int AS file_count
       FROM workspace_files
       WHERE user_id = $1`,
      [userId],
    ),
    sql.query(
      `SELECT source_type, COALESCE(SUM(size_bytes), 0)::bigint AS bytes,
              COUNT(*)::int AS count
       FROM workspace_files
       WHERE user_id = $1
       GROUP BY source_type
       ORDER BY bytes DESC`,
      [userId],
    ),
    sql.query(
      `SELECT
         COUNT(*) FILTER (WHERE deleted_at IS NULL)::int AS active,
         COUNT(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS trash,
         COUNT(*) FILTER (
           WHERE deleted_at IS NULL AND EXISTS (
             SELECT 1 FROM workspace_file_share_links share
             WHERE share.file_id = workspace_files.id
               AND (share.expires_at IS NULL OR share.expires_at > NOW())
           )
         )::int AS shared
       FROM workspace_files
       WHERE user_id = $1`,
      [userId],
    ),
    ensureFileSettings(userId),
  ]);

  const usage = (usageRows[0] || {}) as DatabaseRow;
  const counts = (countRows[0] || {}) as DatabaseRow;
  return {
    folders: folders.map((row) => folderFor(row as DatabaseRow)),
    files: files.map((row) => fileFor(row as DatabaseRow)),
    collections: collectionsFor(collectionRows as DatabaseRow[]),
    settings: fileSettingsFor(settings),
    counts: {
      active: Number(counts.active || 0),
      shared: Number(counts.shared || 0),
      trash: Number(counts.trash || 0),
    },
    usage: {
      usedBytes: Number(usage.used_bytes || 0),
      quotaBytes: 10 * 1024 * 1024 * 1024,
      fileCount: Number(usage.file_count || 0),
      sources: sourceRows.map((row) => ({
        sourceType: cleanText((row as DatabaseRow).source_type, 40),
        bytes: Number((row as DatabaseRow).bytes || 0),
        count: Number((row as DatabaseRow).count || 0),
      })),
    },
  };
}

export async function createWorkspaceFolder(
  userId: string,
  input: RecordValue,
) {
  const name = cleanText(input.name, 160);
  if (!name) throw new WorkspaceContentError("Enter a folder name.");
  const parentId = await requireOwnedFolder(userId, input.parentId);
  try {
    const rows = await database().query(
      `INSERT INTO workspace_folders (user_id, parent_id, name)
       VALUES ($1, $2, $3)
       RETURNING id, parent_id, name, created_at`,
      [userId, parentId, name],
    );
    return folderFor(rows[0] as DatabaseRow);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      String((error as { code?: unknown }).code) === "23505"
    ) {
      throw new WorkspaceContentError(
        "A folder with this name already exists here.",
        409,
        "folder_exists",
      );
    }
    throw error;
  }
}

export async function uploadWorkspaceFile(
  userId: string,
  input: RecordValue,
) {
  const storageObjectId = cleanText(input.storageObjectId, 64);
  if (!isUuid(storageObjectId)) {
    throw new WorkspaceContentError(
      "Upload the file to secure storage before adding it.",
      400,
      "storage_object_required",
    );
  }
  const folderId = await requireOwnedFolder(userId, input.folderId);
  const rows = await database().query(
    `INSERT INTO workspace_files (
       user_id, folder_id, name, mime_type, size_bytes, storage_key,
       storage_object_id, storage_provider, file_url, etag,
       checksum_sha256, source_type, source_label, uploaded_by, scan_status
     )
     SELECT object.user_id, $2, object.file_name, object.mime_type,
            object.size_bytes, object.object_key, object.id, object.provider,
            object.public_url, object.etag, object.checksum_sha256, 'manual',
            'Uploaded manually', $1, object.scan_status
     FROM storage_objects object
     WHERE object.id = $3
       AND object.user_id = $1
       AND object.status = 'ready'
       AND object.scan_status = 'validated'
       AND object.deleted_at IS NULL
       AND object.purpose IN (
         'workspace_file', 'document_template', 'crm_attachment'
       )
     RETURNING id, folder_id, name, mime_type, size_bytes, source_type,
               source_id, source_label, tags, scan_status,
               storage_object_id, deleted_at, purge_after, created_at,
               updated_at, FALSE AS shared`,
    [userId, folderId, storageObjectId],
  );
  if (!rows[0]) {
    throw new WorkspaceContentError(
      "The uploaded file was not found or is not ready.",
      404,
      "storage_object_not_found",
    );
  }
  await Promise.allSettled([
    dispatchWorkspaceWorkflowEvent(userId, "file_created", {
      id: String((rows[0] as DatabaseRow).id || ""),
      name: cleanText((rows[0] as DatabaseRow).name, 220),
      mimeType: cleanText((rows[0] as DatabaseRow).mime_type, 120),
      sizeBytes: Number((rows[0] as DatabaseRow).size_bytes || 0),
    }, `file_created:${String((rows[0] as DatabaseRow).id || "")}`),
  ]);
  return fileFor(rows[0] as DatabaseRow);
}

const requireOwnedFile = async (
  userId: string,
  value: unknown,
  includeDeleted = false,
) => {
  const id = cleanText(value, 64);
  if (!isUuid(id)) throw new WorkspaceContentError("Choose a valid file.");
  const rows = await database().query(
    `SELECT * FROM workspace_files
     WHERE id = $1 AND user_id = $2
       ${includeDeleted ? "" : "AND deleted_at IS NULL"}
     LIMIT 1`,
    [id, userId],
  );
  if (!rows[0]) throw new WorkspaceContentError("This file was not found.", 404);
  return rows[0] as DatabaseRow;
};

export async function getWorkspaceFileContent(
  userId: string,
  fileId: unknown,
  origin = "",
) {
  const file = await requireOwnedFile(userId, fileId);
  if (cleanText(file.scan_status, 30) !== "validated") {
    throw new WorkspaceContentError(
      "This file is not available until its safety check is complete.",
      409,
    );
  }
  const storageObjectId = cleanText(file.storage_object_id, 64);
  if (!isUuid(storageObjectId)) {
    throw new WorkspaceContentError(
      "This file has not been migrated to object storage yet.",
      409,
      "storage_migration_pending",
    );
  }
  const rows = await database().query(
    `SELECT *
     FROM storage_objects
     WHERE id = $1 AND user_id = $2
       AND status = 'ready' AND scan_status = 'validated'
       AND deleted_at IS NULL
     LIMIT 1`,
    [storageObjectId, userId],
  );
  const object = rows[0] as DatabaseRow | undefined;
  if (!object) {
    throw new WorkspaceContentError(
      "This stored file is unavailable.",
      404,
      "storage_object_not_found",
    );
  }
  const mimeType = cleanText(object.mime_type, 180);
  const inline = previewableInline(mimeType);
  // Branded links keep the app's own domain in front of the user. The
  // presigned provider URL is only used when the workspace has no short id and
  // no public origin is configured.
  const workspaceShortId = origin
    ? await ensureWorkspaceShortId(workspaceQuery, userId)
    : "";
  const branded = createBrandedFileLink({
    origin,
    workspaceShortId,
    storageObjectId,
    disposition: inline ? "inline" : "attachment",
  });
  const brandedDownload = createBrandedFileLink({
    origin,
    workspaceShortId,
    storageObjectId,
    disposition: "attachment",
  });
  const url =
    branded?.url ||
    (await createSignedStorageDownload({
      location: storageLocationFor(object),
      fileName: cleanText(object.file_name, 255),
      mimeType,
      inline,
    }));
  const downloadUrl =
    brandedDownload?.url ||
    (await createSignedStorageDownload({
      location: storageLocationFor(object),
      fileName: cleanText(object.file_name, 255),
      mimeType,
      inline: false,
    }));
  return { contentData: "", url, downloadUrl, file: fileFor(file) };
}

export async function renameWorkspaceFile(
  userId: string,
  input: RecordValue,
) {
  const id = cleanText(input.id, 64);
  if (!isUuid(id)) throw new WorkspaceContentError("Choose a valid file.");
  const name = safeFileName(input.name, "");
  if (!name) throw new WorkspaceContentError("Enter a file name.");
  const rows = await database().query(
    `UPDATE workspace_files
     SET name = $1, updated_at = NOW()
     WHERE id = $2 AND user_id = $3 AND deleted_at IS NULL
     RETURNING id`,
    [name, id, userId],
  );
  if (!rows[0]) throw new WorkspaceContentError("This file was not found.", 404);
  return { updated: true };
}

export async function moveWorkspaceFile(
  userId: string,
  input: RecordValue,
) {
  const id = cleanText(input.id, 64);
  if (!isUuid(id)) throw new WorkspaceContentError("Choose a valid file.");
  const folderId = await requireOwnedFolder(userId, input.folderId);
  const rows = await database().query(
    `UPDATE workspace_files
     SET folder_id = $1, updated_at = NOW()
     WHERE id = $2 AND user_id = $3 AND deleted_at IS NULL
     RETURNING id`,
    [folderId, id, userId],
  );
  if (!rows[0]) throw new WorkspaceContentError("This file was not found.", 404);
  return { updated: true };
}

export async function trashWorkspaceFile(userId: string, fileId: unknown) {
  const id = cleanText(fileId, 64);
  if (!isUuid(id)) throw new WorkspaceContentError("Choose a valid file.");
  const settings = await ensureFileSettings(userId);
  const retentionDays = Number(settings.retention_days || 30);
  const rows = await database().query(
    `UPDATE workspace_files
     SET deleted_at = NOW(),
         purge_after = NOW() + ($3::int * INTERVAL '1 day'),
         updated_at = NOW()
     WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
     RETURNING id`,
    [id, userId, retentionDays],
  );
  if (!rows[0]) throw new WorkspaceContentError("This file was not found.", 404);
  return { deleted: true };
}

export async function restoreWorkspaceFile(userId: string, fileId: unknown) {
  const id = cleanText(fileId, 64);
  if (!isUuid(id)) throw new WorkspaceContentError("Choose a valid file.");
  const rows = await database().query(
    `UPDATE workspace_files
     SET deleted_at = NULL, purge_after = NULL, updated_at = NOW()
     WHERE id = $1 AND user_id = $2 AND deleted_at IS NOT NULL
     RETURNING id`,
    [id, userId],
  );
  if (!rows[0]) throw new WorkspaceContentError("This file was not found.", 404);
  return { restored: true };
}

const bulkFileIds = (value: unknown) => {
  if (!Array.isArray(value)) {
    throw new WorkspaceContentError("Select at least one file.");
  }
  const ids = Array.from(
    new Set(value.map((item) => cleanText(item, 64))),
  ).filter(isUuid);
  if (!ids.length || ids.length !== value.length) {
    throw new WorkspaceContentError("One or more selected files are invalid.");
  }
  if (ids.length > 1_000) {
    throw new WorkspaceContentError(
      "Choose no more than 1,000 files at once.",
      413,
    );
  }
  return ids;
};

export async function bulkUpdateWorkspaceFiles(
  userId: string,
  input: RecordValue,
) {
  const ids = bulkFileIds(input.ids);
  const operation = cleanText(input.operation, 20);
  const sql = database();
  if (operation === "move") {
    const folderId = await requireOwnedFolder(userId, input.folderId);
    const rows = await sql.query(
      `UPDATE workspace_files
       SET folder_id = $1, updated_at = NOW()
       WHERE user_id = $2
         AND id = ANY($3::uuid[])
         AND deleted_at IS NULL
       RETURNING id`,
      [folderId, userId, ids],
    );
    return { affected: rows.length, operation };
  }
  if (operation === "trash") {
    const settings = await ensureFileSettings(userId);
    const retentionDays = Number(settings.retention_days || 30);
    const rows = await sql.query(
      `UPDATE workspace_files
       SET deleted_at = NOW(),
           purge_after = NOW() + ($3::int * INTERVAL '1 day'),
           updated_at = NOW()
       WHERE user_id = $1
         AND id = ANY($2::uuid[])
         AND deleted_at IS NULL
       RETURNING id`,
      [userId, ids, retentionDays],
    );
    return { affected: rows.length, operation };
  }
  if (operation === "restore") {
    const rows = await sql.query(
      `UPDATE workspace_files
       SET deleted_at = NULL, purge_after = NULL, updated_at = NOW()
       WHERE user_id = $1
         AND id = ANY($2::uuid[])
         AND deleted_at IS NOT NULL
       RETURNING id`,
      [userId, ids],
    );
    return { affected: rows.length, operation };
  }
  throw new WorkspaceContentError("Choose an available bulk action.");
}

export async function shareWorkspaceFile(
  userId: string,
  input: RecordValue,
  origin: string,
) {
  const file = await requireOwnedFile(userId, input.id);
  if (cleanText(file.scan_status, 30) !== "validated") {
    throw new WorkspaceContentError(
      "Only files that passed their safety check can be shared.",
      409,
    );
  }
  const settings = await ensureFileSettings(userId);
  const requestedExpiry = Number(input.expiryDays);
  const expiryDays = Math.max(
    1,
    Math.min(
      365,
      Number.isFinite(requestedExpiry) && requestedExpiry > 0
        ? requestedExpiry
        : Number(settings.share_expiry_days || 7),
    ),
  );
  const token = randomBytes(16).toString("base64url");
  // The short id is resolved first: a workspace without one is backfilled, and
  // a hard failure there must not leave an orphaned share row behind.
  const workspaceShortId = await workspaceShortIdFor(userId);
  await database().query(
    `INSERT INTO workspace_file_share_links (
       file_id, user_id, token, expires_at
     )
     VALUES ($1, $2, $3, NOW() + ($4::int * INTERVAL '1 day'))`,
    [String(file.id), userId, token, expiryDays],
  );
  return {
    url: cleanSharedFileUrl(origin, workspaceShortId, token),
    expiresInDays: expiryDays,
  };
}

export async function saveFileSettings(
  userId: string,
  input: RecordValue,
) {
  const defaultView =
    cleanText(input.defaultView, 20) === "list" ? "list" : "grid";
  const retentionDays = Math.max(
    1,
    Math.min(90, Number(input.retentionDays || 30) || 30),
  );
  const shareExpiryDays = Math.max(
    1,
    Math.min(365, Number(input.shareExpiryDays || 7) || 7),
  );
  const rows = await database().query(
    `INSERT INTO workspace_file_settings (
       user_id, default_view, retention_days, share_expiry_days,
       group_by_source, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       default_view = EXCLUDED.default_view,
       retention_days = EXCLUDED.retention_days,
       share_expiry_days = EXCLUDED.share_expiry_days,
       group_by_source = EXCLUDED.group_by_source,
       updated_at = NOW()
     RETURNING *`,
    [
      userId,
      defaultView,
      retentionDays,
      shareExpiryDays,
      input.groupBySource !== false,
    ],
  );
  return fileSettingsFor(rows[0] as DatabaseRow);
}

export async function clearWorkspaceStorage(
  userId: string,
  input: RecordValue,
) {
  const scope = cleanText(input.scope, 20);
  if (!["trash", "manual", "all"].includes(scope)) {
    throw new WorkspaceContentError("Choose what you want to clear.");
  }
  const sql = database();
  if (scope === "trash") {
    const objectRows = (await sql.query(
      `SELECT DISTINCT object.id, object.bucket_name, object.object_key,
              object.public_url, object.visibility
       FROM workspace_files file
       JOIN storage_objects object ON object.id = file.storage_object_id
       WHERE file.user_id = $1
         AND file.deleted_at IS NOT NULL
         AND file.source_type NOT IN ('form_upload', 'event_upload')
         AND object.status = 'ready'
         AND object.deleted_at IS NULL`,
      [userId],
    )) as DatabaseRow[];
    // R2 deletion happens before metadata deletion. A provider failure leaves
    // the recoverable database row intact so the cleanup can be retried.
    for (let index = 0; index < objectRows.length; index += 10) {
      const batch = objectRows.slice(index, index + 10);
      await Promise.all(
        batch.map((row) => deleteStorageObject(storageLocationFor(row))),
      );
    }
    if (objectRows.length) {
      await sql.query(
        `UPDATE storage_objects
         SET status = 'deleted', deleted_at = NOW(), updated_at = NOW()
         WHERE user_id = $1 AND id = ANY($2::uuid[])`,
        [userId, objectRows.map((row) => String(row.id))],
      );
    }
    const rows = await sql.query(
      `WITH doomed AS (
         SELECT id, storage_key, source_type
         FROM workspace_files
         WHERE user_id = $1 AND deleted_at IS NOT NULL
       ),
       ignored AS (
         INSERT INTO workspace_file_sync_exclusions (user_id, storage_key)
         SELECT $1, doomed.storage_key
         FROM doomed
         WHERE doomed.source_type IN ('form_upload', 'event_upload')
         ON CONFLICT (user_id, storage_key) DO NOTHING
         RETURNING storage_key
       ),
       removed AS (
         DELETE FROM workspace_files file
         USING doomed
         WHERE file.id = doomed.id
         RETURNING file.size_bytes
       )
       SELECT COUNT(*)::int AS affected,
              COALESCE(SUM(size_bytes), 0)::bigint AS bytes
       FROM removed`,
      [userId],
    );
    const result = (rows[0] || {}) as DatabaseRow;
    return {
      affected: Number(result.affected || 0),
      bytes: Number(result.bytes || 0),
      permanent: true,
    };
  }

  const settings = await ensureFileSettings(userId);
  const retentionDays = Number(settings.retention_days || 30);
  const sourceCondition =
    scope === "manual" ? "AND source_type = 'manual'" : "";
  const rows = await sql.query(
    `WITH moved AS (
       UPDATE workspace_files
       SET deleted_at = NOW(),
           purge_after = NOW() + ($2::int * INTERVAL '1 day'),
           updated_at = NOW()
       WHERE user_id = $1
         AND deleted_at IS NULL
         ${sourceCondition}
       RETURNING size_bytes
     )
     SELECT COUNT(*)::int AS affected,
            COALESCE(SUM(size_bytes), 0)::bigint AS bytes
     FROM moved`,
    [userId, retentionDays],
  );
  const result = (rows[0] || {}) as DatabaseRow;
  return {
    affected: Number(result.affected || 0),
    bytes: Number(result.bytes || 0),
    permanent: false,
  };
}

/**
 * Streams a stored object through the app's own origin so the branded URL is
 * what stays in the address bar. Redirecting to the provider would swap it for
 * a presigned URL that leaks the bucket layout.
 */
const streamStoredObject = async (
  request: IncomingMessage,
  response: ServerResponse,
  input: {
    location: StorageObjectLocation;
    fileName: string;
    mimeType: string;
    inline: boolean;
    cacheSeconds: number;
  },
) => {
  const mimeType = normalizeMimeType(input.mimeType);
  const markup = activeMarkupTypes.has(mimeType);
  const stored = await getStorageObjectStream(input.location, {
    range: cleanText(request.headers.range, 200) || undefined,
  });
  const partial = Boolean(stored.contentRange);
  response.statusCode = partial ? 206 : 200;
  response.setHeader("Content-Type", mimeType);
  response.setHeader(
    "Content-Disposition",
    contentDispositionHeader(input.fileName, input.inline),
  );
  if (stored.contentLength > 0) {
    response.setHeader("Content-Length", String(stored.contentLength));
  }
  if (partial) response.setHeader("Content-Range", stored.contentRange);
  response.setHeader("Accept-Ranges", "bytes");
  if (stored.etag) response.setHeader("ETag", `"${stored.etag}"`);
  response.setHeader(
    "Cache-Control",
    `private, max-age=${Math.max(0, Math.floor(input.cacheSeconds))}`,
  );
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Frame-Options", "SAMEORIGIN");
  if (markup) {
    // `sandbox` (no allow-scripts) makes uploaded markup inert and gives it an
    // opaque origin, so it can never touch the dashboard session.
    response.setHeader(
      "Content-Security-Policy",
      "sandbox; default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'",
    );
  }
  for await (const chunk of stored.body) {
    await writeResponseChunk(response, Buffer.from(chunk));
  }
  response.end();
};

const sendSharedFile = async (
  request: IncomingMessage,
  response: ServerResponse,
  tokenValue: unknown,
  workspaceShortIdValue?: unknown,
) => {
  const token = cleanText(tokenValue, 100);
  if (
    !/^[0-9a-f]{48}$/i.test(token) &&
    !/^[A-Za-z0-9_-]{22}$/.test(token)
  ) {
    throw new WorkspaceContentError("This share link is invalid.", 404);
  }
  const workspaceShortId = cleanText(workspaceShortIdValue, 6);
  if (workspaceShortId && !workspaceShortIdPattern.test(workspaceShortId)) {
    throw new WorkspaceContentError("This share link is invalid.", 404);
  }
  const rows = await database().query(
    `SELECT file.name, file.mime_type,
            object.bucket_name, object.object_key, object.public_url,
            object.visibility, object.status AS storage_status,
            object.scan_status AS storage_scan_status
     FROM workspace_file_share_links share
     JOIN workspace_files file ON file.id = share.file_id
     JOIN users owner ON owner.id = share.user_id
     LEFT JOIN storage_objects object ON object.id = file.storage_object_id
     WHERE share.token = $1
       AND ($2 = '' OR owner.short_id = $2)
       AND file.deleted_at IS NULL
       AND file.scan_status = 'validated'
       AND (share.expires_at IS NULL OR share.expires_at > NOW())
     LIMIT 1`,
    [token, workspaceShortId],
  );
  const row = rows[0] as DatabaseRow | undefined;
  if (!row) {
    throw new WorkspaceContentError(
      "This share link has expired or is unavailable.",
      404,
    );
  }
  if (
    cleanText(row.storage_status, 20) !== "ready" ||
    cleanText(row.storage_scan_status, 20) !== "validated" ||
    !cleanText(row.object_key, 1_024)
  ) {
    throw new WorkspaceContentError(
      "This shared file is temporarily unavailable.",
      409,
    );
  }
  const mimeType = cleanText(row.mime_type, 180);
  await streamStoredObject(request, response, {
    location: storageLocationFor(row),
    fileName: cleanText(row.name, 255),
    mimeType,
    inline: previewableInline(mimeType),
    cacheSeconds: 0,
  });
};

/**
 * Serves `/{workspaceShortId}/file/{token}` — the branded replacement for a
 * presigned provider URL. The token is signed and short-lived, and the
 * workspace segment must match the owning account.
 */
const sendBrandedFile = async (
  request: IncomingMessage,
  response: ServerResponse,
  workspaceShortIdValue: unknown,
  tokenValue: unknown,
) => {
  const workspaceShortId = cleanText(workspaceShortIdValue, 6);
  const link = readBrandedFileToken(cleanText(tokenValue, 100));
  if (!link || !workspaceShortIdPattern.test(workspaceShortId)) {
    throw new WorkspaceContentError(
      "This file link has expired or is invalid.",
      404,
    );
  }
  const rows = await database().query(
    `SELECT object.bucket_name, object.object_key, object.public_url,
            object.visibility, object.mime_type, object.file_name,
            object.status AS storage_status,
            object.scan_status AS storage_scan_status
     FROM storage_objects object
     JOIN users owner ON owner.id = object.user_id
     WHERE object.id = $1
       AND owner.short_id = $2
       AND object.deleted_at IS NULL
     LIMIT 1`,
    [link.storageObjectId, workspaceShortId],
  );
  const object = rows[0] as DatabaseRow | undefined;
  if (!object) {
    throw new WorkspaceContentError(
      "This file link has expired or is invalid.",
      404,
    );
  }
  if (
    cleanText(object.storage_status, 20) !== "ready" ||
    cleanText(object.storage_scan_status, 20) !== "validated" ||
    !cleanText(object.object_key, 1_024)
  ) {
    throw new WorkspaceContentError(
      "This file is temporarily unavailable.",
      409,
    );
  }
  const mimeType = cleanText(object.mime_type, 180);
  await streamStoredObject(request, response, {
    location: storageLocationFor(object),
    fileName: cleanText(object.file_name, 255),
    mimeType,
    inline:
      link.disposition === "inline" && previewableInline(mimeType),
    // Kept under the token lifetime so a revoked link cannot outlive its cache.
    cacheSeconds: Math.min(
      300,
      Math.max(0, link.expiresAt - Math.floor(Date.now() / 1_000)),
    ),
  });
};

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value =
      value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

const updateCrc32 = (current: number, content: Buffer) => {
  let value = current;
  for (const byte of content) {
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return value;
};

const zipDateTime = (input: Date) => {
  const year = Math.max(1980, input.getFullYear());
  const date =
    ((year - 1980) << 9) |
    ((input.getMonth() + 1) << 5) |
    input.getDate();
  const time =
    (input.getHours() << 11) |
    (input.getMinutes() << 5) |
    Math.floor(input.getSeconds() / 2);
  return { date, time };
};

const localZipHeader = (
  name: Buffer,
  modifiedAt: Date,
) => {
  const stamp = zipDateTime(modifiedAt);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  // UTF-8 file name + data descriptor. Sizes and CRC are written after the
  // streamed object so an R2 download never needs to be buffered in memory.
  header.writeUInt16LE(0x0808, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(stamp.time, 10);
  header.writeUInt16LE(stamp.date, 12);
  header.writeUInt32LE(0, 14);
  header.writeUInt32LE(0, 18);
  header.writeUInt32LE(0, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, name]);
};

const centralZipHeader = (
  name: Buffer,
  checksum: number,
  size: number,
  modifiedAt: Date,
  offset: number,
) => {
  const stamp = zipDateTime(modifiedAt);
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0808, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(stamp.time, 12);
  header.writeUInt16LE(stamp.date, 14);
  header.writeUInt32LE(checksum, 16);
  header.writeUInt32LE(size, 20);
  header.writeUInt32LE(size, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(offset, 42);
  return Buffer.concat([header, name]);
};

const zipDataDescriptor = (checksum: number, size: number) => {
  const descriptor = Buffer.alloc(16);
  descriptor.writeUInt32LE(0x08074b50, 0);
  descriptor.writeUInt32LE(checksum, 4);
  descriptor.writeUInt32LE(size, 8);
  descriptor.writeUInt32LE(size, 12);
  return descriptor;
};

const zipEndRecord = (
  entries: number,
  centralSize: number,
  centralOffset: number,
) => {
  const record = Buffer.alloc(22);
  record.writeUInt32LE(0x06054b50, 0);
  record.writeUInt16LE(0, 4);
  record.writeUInt16LE(0, 6);
  record.writeUInt16LE(entries, 8);
  record.writeUInt16LE(entries, 10);
  record.writeUInt32LE(centralSize, 12);
  record.writeUInt32LE(centralOffset, 16);
  record.writeUInt16LE(0, 20);
  return record;
};

const writeResponseChunk = async (
  response: ServerResponse,
  content: Buffer,
) => {
  if (!response.write(content)) await once(response, "drain");
};

const sendWorkspaceFileArchive = async (
  response: ServerResponse,
  rows: DatabaseRow[],
  archiveNameValue: string,
) => {
  if (!rows.length) {
    throw new WorkspaceContentError(
      "No files are available for this export.",
      404,
    );
  }
  if (
    rows.some(
      (row) =>
        row.has_content !== true ||
        cleanText(row.scan_status, 30) !== "validated",
    )
  ) {
    throw new WorkspaceContentError(
      "One or more files are not ready to export yet.",
      409,
    );
  }
  const totalBytes = rows.reduce(
    (sum, row) => sum + Number(row.size_bytes || 0),
    0,
  );
  if (rows.length > 65_535 || totalBytes > 2_000_000_000) {
    throw new WorkspaceContentError(
      "This export is too large to create at once.",
      413,
      "file_export_too_large",
    );
  }

  const archiveName = `${safeFileName(archiveNameValue, "MaxForm-files").replace(/\.zip$/i, "")}.zip`;
  response.statusCode = 200;
  response.setHeader("Content-Type", "application/zip");
  response.setHeader("Cache-Control", "private, no-store, max-age=0");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader(
    "Content-Disposition",
    `attachment; filename="${archiveName}"; filename*=UTF-8''${encodeURIComponent(archiveName)}`,
  );

  const centralHeaders: Buffer[] = [];
  const usedNames = new Map<string, number>();
  let offset = 0;
  for (const row of rows) {
    const submissionId = cleanText(row.submission_id, 64);
    const clientName =
      cleanText(row.client_name, 255) ||
      (submissionId ? `Response ${submissionId.slice(0, 8)}` : "");
    const basePath = clientName
      ? `${safeFileName(clientName, "Response")}/${safeFileName(row.name)}`
      : safeFileName(row.name);
    const duplicate = usedNames.get(basePath) || 0;
    usedNames.set(basePath, duplicate + 1);
    const path =
      duplicate === 0
        ? basePath
        : basePath.replace(/(\.[^./]+)?$/, `-${duplicate + 1}$1`);
    const encodedName = Buffer.from(path, "utf8");
    const parsedModifiedAt = new Date(String(row.created_at || Date.now()));
    const modifiedAt = Number.isNaN(parsedModifiedAt.getTime())
      ? new Date()
      : parsedModifiedAt;
    const localHeader = localZipHeader(encodedName, modifiedAt);
    await writeResponseChunk(response, localHeader);
    let crc = 0xffffffff;
    let contentLength = 0;
    const stored = await getStorageObjectStream(storageLocationFor(row));
    for await (const chunk of stored.body) {
      const content = Buffer.from(chunk);
      contentLength += content.length;
      if (contentLength > 0xffffffff) {
        response.destroy(
          new Error("A stored file is too large for this ZIP export."),
        );
        return;
      }
      crc = updateCrc32(crc, content);
      await writeResponseChunk(response, content);
    }
    const checksum = (crc ^ 0xffffffff) >>> 0;
    const descriptor = zipDataDescriptor(checksum, contentLength);
    await writeResponseChunk(response, descriptor);
    centralHeaders.push(
      centralZipHeader(
        encodedName,
        checksum,
        contentLength,
        modifiedAt,
        offset,
      ),
    );
    offset += localHeader.length + contentLength + descriptor.length;
  }
  const centralOffset = offset;
  let centralSize = 0;
  for (const header of centralHeaders) {
    await writeResponseChunk(response, header);
    centralSize += header.length;
  }
  response.end(zipEndRecord(rows.length, centralSize, centralOffset));
};

export async function sendWorkspaceCollectionExport(
  response: ServerResponse,
  userId: string,
  sourceTypeValue: unknown,
  sourceIdValue: unknown,
) {
  const sourceType = cleanText(sourceTypeValue, 20);
  const sourceId = cleanText(sourceIdValue, 64);
  if (!["form", "event"].includes(sourceType) || !isUuid(sourceId)) {
    throw new WorkspaceContentError("Choose a valid form or event to export.");
  }
  const rows = (await database().query(
    `SELECT file.id, file.name, file.size_bytes, file.created_at,
             object.id IS NOT NULL AS has_content,
            file.scan_status,
            object.bucket_name, object.object_key, object.public_url,
            object.visibility,
            ${fileSourceColumns}
     FROM workspace_files file
     ${fileSourceJoins}
     LEFT JOIN storage_objects object
       ON object.id = file.storage_object_id
      AND object.status = 'ready'
      AND object.scan_status = 'validated'
      AND object.deleted_at IS NULL
     WHERE file.user_id = $1
       AND file.deleted_at IS NULL
       AND file.source_type IN ('form_upload', 'event_upload')
       AND (
         ($2 = 'event' AND source_event.id = $3::uuid)
         OR
         ($2 = 'form' AND source_event.id IS NULL AND source_form.id = $3::uuid)
       )
     ORDER BY file.created_at ASC, file.id ASC`,
    [userId, sourceType, sourceId],
  )) as DatabaseRow[];
  const collectionName =
    cleanText(rows[0]?.collection_name, 255) ||
    (sourceType === "event" ? "Event files" : "Form files");
  await sendWorkspaceFileArchive(
    response,
    rows,
    `${collectionName}-files.zip`,
  );
}

export async function sendWorkspaceSelectionExport(
  response: ServerResponse,
  userId: string,
  input: RecordValue,
) {
  const ids = bulkFileIds(input.ids);
  const rows = (await database().query(
    `SELECT file.id, file.name, file.size_bytes, file.created_at,
             object.id IS NOT NULL AS has_content,
            file.scan_status,
            object.bucket_name, object.object_key, object.public_url,
            object.visibility,
            ${fileSourceColumns}
     FROM workspace_files file
     ${fileSourceJoins}
     LEFT JOIN storage_objects object
       ON object.id = file.storage_object_id
      AND object.status = 'ready'
      AND object.scan_status = 'validated'
      AND object.deleted_at IS NULL
     WHERE file.user_id = $1
       AND file.id = ANY($2::uuid[])
       AND file.deleted_at IS NULL
     ORDER BY file.created_at ASC, file.id ASC`,
    [userId, ids],
  )) as DatabaseRow[];
  if (rows.length !== ids.length) {
    throw new WorkspaceContentError(
      "One or more selected files are no longer available.",
      409,
    );
  }
  await sendWorkspaceFileArchive(
    response,
    rows,
    `MaxForm-${rows.length}-selected-files.zip`,
  );
}

const ensureDocumentSettings = async (userId: string) => {
  const rows = await database().query(
    `INSERT INTO document_settings (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
     RETURNING *`,
    [userId],
  );
  return rows[0] as DatabaseRow;
};

export async function getDocumentsWorkspace(userId: string) {
  const sql = database();
  const [settings, templates, documents] = await Promise.all([
    ensureDocumentSettings(userId),
    sql.query(
      `SELECT template.*, file.name AS base_file_name
       FROM document_templates template
       LEFT JOIN workspace_files file ON file.id = template.base_file_id
       WHERE template.user_id = $1
       ORDER BY template.updated_at DESC
       LIMIT 150`,
      [userId],
    ),
    sql.query(
      `SELECT document.*, template.name AS template_name,
         COALESCE((
           SELECT jsonb_agg(
             jsonb_build_object(
               'id', signer.id,
               'role', signer.role,
               'name', signer.name,
               'email', signer.email,
               'orderIndex', signer.order_index,
               'status', signer.status,
               'signedAt', signer.signed_at,
               'viewedAt', signer.viewed_at
             )
             ORDER BY signer.order_index, signer.created_at
           )
           FROM document_signers signer
           WHERE signer.document_id = document.id
         ), '[]'::jsonb) AS signers,
         COALESCE((
           SELECT jsonb_agg(
             jsonb_build_object(
               'id', event.id,
               'eventType', event.event_type,
               'actorName', event.actor_name,
               'actorEmail', event.actor_email,
               'createdAt', event.created_at
             )
             ORDER BY event.created_at
           )
           FROM document_events event
           WHERE event.document_id = document.id
         ), '[]'::jsonb) AS events
       FROM workspace_documents document
       LEFT JOIN document_templates template ON template.id = document.template_id
       WHERE document.user_id = $1
       ORDER BY document.updated_at DESC
       LIMIT 150`,
      [userId],
    ),
  ]);
  const counts = documents.reduce(
    (result, row) => {
      const status = cleanText((row as DatabaseRow).status, 30);
      result.total += 1;
      if (status === "completed") result.completed += 1;
      if (
        status === "sent" ||
        status === "viewed" ||
        status === "partially_signed"
      ) {
        result.awaiting += 1;
      }
      return result;
    },
    { total: 0, awaiting: 0, completed: 0 },
  );
  return {
    settings: settingsFor(settings),
    templates: templates.map((row) => templateFor(row as DatabaseRow)),
    documents: documents.map((row) => documentFor(row as DatabaseRow)),
    counts,
  };
}

export async function saveDocumentTemplate(
  userId: string,
  input: RecordValue,
) {
  const name = cleanText(input.name, 180);
  if (!name) throw new WorkspaceContentError("Enter a template name.");
  const sourceType =
    cleanText(input.sourceType, 30) === "uploaded_pdf"
      ? "uploaded_pdf"
      : "block_built";
  const description = cleanText(input.description, 2_000);
  const signingOrder =
    cleanText(input.defaultSigningOrder, 20) === "parallel"
      ? "parallel"
      : "sequential";
  const blocks = Array.isArray(input.blocks) ? input.blocks.slice(0, 100) : [];
  const fieldPositions = Array.isArray(input.fieldPositions)
    ? input.fieldPositions.slice(0, 200)
    : [];
  const roles = Array.isArray(input.signerRoles)
    ? input.signerRoles
        .slice(0, 12)
        .map((value, index) => {
          const role = jsonValue<RecordValue>(value, {});
          const roleName = ["signer", "approver", "cc"].includes(
            cleanText(role.role, 20),
          )
            ? cleanText(role.role, 20)
            : "signer";
          return { role: roleName, order: index + 1 };
        })
    : [{ role: "signer", order: 1 }];
  if (!roles.length) roles.push({ role: "signer", order: 1 });
  if (!roles.some((role) => role.role !== "cc")) {
    throw new WorkspaceContentError(
      "Add at least one signer or approver role.",
    );
  }
  let baseFileId: string | null = null;
  if (sourceType === "uploaded_pdf") {
    const file = await requireOwnedFile(userId, input.baseFileId);
    if (cleanText(file.mime_type, 180) !== "application/pdf") {
      throw new WorkspaceContentError(
        "Upload a PDF when creating a PDF template.",
      );
    }
    baseFileId = String(file.id);
  }
  const id = cleanText(input.id, 64);
  const sql = database();
  const rows = isUuid(id)
    ? await sql.query(
        `UPDATE document_templates
         SET name = $1, description = $2, source_type = $3,
             base_file_id = $4, blocks = $5::jsonb,
             field_positions = $6::jsonb, signer_roles = $7::jsonb,
             default_signing_order = $8, updated_at = NOW()
         WHERE id = $9 AND user_id = $10
         RETURNING *`,
        [
          name,
          description,
          sourceType,
          baseFileId,
          JSON.stringify(blocks),
          JSON.stringify(fieldPositions),
          JSON.stringify(roles),
          signingOrder,
          id,
          userId,
        ],
      )
    : await sql.query(
        `INSERT INTO document_templates (
           user_id, name, description, source_type, base_file_id,
           blocks, field_positions, signer_roles, default_signing_order
         )
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9)
         RETURNING *`,
        [
          userId,
          name,
          description,
          sourceType,
          baseFileId,
          JSON.stringify(blocks),
          JSON.stringify(fieldPositions),
          JSON.stringify(roles),
          signingOrder,
        ],
      );
  if (!rows[0]) {
    throw new WorkspaceContentError("This template was not found.", 404);
  }
  return templateFor(rows[0] as DatabaseRow);
}

type SignerInput = {
  role: "signer" | "approver" | "cc";
  name: string;
  email: string;
  orderIndex: number;
};

const signerInputs = (value: unknown): SignerInput[] => {
  if (!Array.isArray(value) || !value.length || value.length > 12) {
    throw new WorkspaceContentError(
      "Add between one and twelve recipients.",
    );
  }
  const signers = value.map((item, index) => {
    const input = jsonValue<RecordValue>(item, {});
    const roleValue = cleanText(input.role, 20);
    const role = (["signer", "approver", "cc"].includes(roleValue)
      ? roleValue
      : "signer") as SignerInput["role"];
    const name = cleanText(input.name, 160);
    const email = cleanText(input.email, 320).toLowerCase();
    if (!name || !isEmail(email)) {
      throw new WorkspaceContentError(
        `Enter a valid name and email for recipient ${index + 1}.`,
      );
    }
    return { role, name, email, orderIndex: index + 1 };
  });
  if (!signers.some((signer) => signer.role !== "cc")) {
    throw new WorkspaceContentError(
      "Add at least one signer or approver.",
    );
  }
  return signers;
};

export async function createWorkspaceDocument(
  userId: string,
  input: RecordValue,
) {
  const templateId = cleanText(input.templateId, 64);
  if (!isUuid(templateId)) {
    throw new WorkspaceContentError("Choose a document template.");
  }
  const templates = await database().query(
    `SELECT * FROM document_templates
     WHERE id = $1 AND user_id = $2
     LIMIT 1`,
    [templateId, userId],
  );
  const template = templates[0] as DatabaseRow | undefined;
  if (!template) {
    throw new WorkspaceContentError("This template was not found.", 404);
  }
  const title =
    cleanText(input.title, 220) ||
    `${cleanText(template.name, 180)} document`;
  const signers = signerInputs(input.signers);
  const signingOrder =
    cleanText(input.signingOrder, 20) === "parallel"
      ? "parallel"
      : cleanText(template.default_signing_order, 20) === "parallel"
        ? "parallel"
        : "sequential";
  const mergeValues =
    input.mergeValues &&
    typeof input.mergeValues === "object" &&
    !Array.isArray(input.mergeValues)
      ? input.mergeValues
      : {};
  const settings = await ensureDocumentSettings(userId);
  const expiryDays = Number(settings.expiry_days || 30);
  const sql = database();
  const documents = await sql.query(
    `INSERT INTO workspace_documents (
       user_id, template_id, title, signing_order, merge_values
     )
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING id`,
    [userId, templateId, title, signingOrder, JSON.stringify(mergeValues)],
  );
  const documentId = String(documents[0].id);
  try {
    for (const signer of signers) {
      await sql.query(
        `INSERT INTO document_signers (
           document_id, role, name, email, order_index,
           signing_token, token_expires_at
         )
         VALUES (
           $1, $2, $3, $4, $5, $6,
           NOW() + ($7::int * INTERVAL '1 day')
         )`,
        [
          documentId,
          signer.role,
          signer.name,
          signer.email,
          signer.orderIndex,
          randomBytes(24).toString("hex"),
          expiryDays,
        ],
      );
    }
    await sql.query(
      `INSERT INTO document_events (
         document_id, event_type, actor_name, metadata
       )
       VALUES ($1, 'created', 'Workspace owner', $2::jsonb)`,
      [documentId, JSON.stringify({ title })],
    );
  } catch (error) {
    await sql.query(
      `DELETE FROM workspace_documents WHERE id = $1 AND user_id = $2`,
      [documentId, userId],
    );
    throw error;
  }
  await Promise.allSettled([
    dispatchWorkspaceWorkflowEvent(userId, "document_created", {
      id: documentId,
      title,
      templateId,
      signerCount: signers.length,
    }, `document_created:${documentId}`),
  ]);
  return { id: documentId };
}

const eligiblePendingSigners = async (documentId: string) => {
  const sql = database();
  const documents = await sql.query(
    `SELECT user_id, signing_order, title, status
     FROM workspace_documents
     WHERE id = $1
     LIMIT 1`,
    [documentId],
  );
  const document = documents[0] as DatabaseRow | undefined;
  if (!document) {
    throw new WorkspaceContentError("This document was not found.", 404);
  }
  const signingOrder = cleanText(document.signing_order, 20);
  const signers =
    signingOrder === "parallel"
      ? await sql.query(
          `SELECT * FROM document_signers
           WHERE document_id = $1
             AND role IN ('signer', 'approver')
             AND status IN ('pending', 'viewed')
           ORDER BY order_index`,
          [documentId],
        )
      : await sql.query(
          `SELECT * FROM document_signers
           WHERE document_id = $1
             AND role IN ('signer', 'approver')
             AND status IN ('pending', 'viewed')
             AND order_index = (
               SELECT MIN(order_index)
               FROM document_signers
               WHERE document_id = $1
                 AND role IN ('signer', 'approver')
                 AND status IN ('pending', 'viewed')
             )
           ORDER BY order_index`,
          [documentId],
        );
  return { document, signers: signers as DatabaseRow[] };
};

const sendEligibleSignatureRequestsNow = async (
  documentId: string,
  origin: string,
  reminder = false,
) => {
  const { document, signers } = await eligiblePendingSigners(documentId);
  const userId = cleanText(document.user_id, 64);
  const deliveries = await Promise.allSettled(
    signers.map((signer) =>
      sendEmailNow({
        userId,
        templateKey: reminder
          ? "document_signature_reminder"
          : "document_signature_request",
        to: cleanText(signer.email, 320),
        sourceEventId: documentId,
        idempotencyKey: reminder
          ? `${documentId}:reminder:${String(signer.id)}:${new Date()
              .toISOString()
              .slice(0, 10)}`
          : `${documentId}:request:${String(signer.id)}`,
        variables: {
          action: {
            url: `${origin}/sign/${cleanText(signer.signing_token, 100)}`,
          },
          contact: { name: cleanText(signer.name, 160) },
          document: { title: cleanText(document.title, 220) },
        },
      }),
    ),
  );
  const delivered = deliveries.filter((delivery) => delivery.status === "fulfilled").length;
  return {
    attempted: deliveries.length,
    delivered,
    failed: deliveries.length - delivered,
  };
};

export async function sendWorkspaceDocument(
  userId: string,
  documentIdValue: unknown,
  origin: string,
) {
  const documentId = cleanText(documentIdValue, 64);
  if (!isUuid(documentId)) {
    throw new WorkspaceContentError("Choose a valid document.");
  }
  const rows = await database().query(
    `UPDATE workspace_documents
     SET status = 'sent', sent_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND user_id = $2 AND status = 'draft'
     RETURNING id, title`,
    [documentId, userId],
  );
  if (!rows[0]) {
    throw new WorkspaceContentError(
      "Only a draft document can be sent.",
      409,
    );
  }
  await database().query(
    `INSERT INTO document_events (
       document_id, event_type, actor_name
     )
     VALUES ($1, 'sent', 'Workspace owner')`,
    [documentId],
  );
  const delivery = await sendEligibleSignatureRequestsNow(documentId, origin);
  return { sent: true, ...delivery };
}

export async function remindWorkspaceDocument(
  userId: string,
  documentIdValue: unknown,
  origin: string,
) {
  const documentId = cleanText(documentIdValue, 64);
  if (!isUuid(documentId)) {
    throw new WorkspaceContentError("Choose a valid document.");
  }
  const rows = await database().query(
    `SELECT id FROM workspace_documents
     WHERE id = $1 AND user_id = $2
       AND status IN ('sent', 'viewed', 'partially_signed')
     LIMIT 1`,
    [documentId, userId],
  );
  if (!rows[0]) {
    throw new WorkspaceContentError(
      "Reminders can only be sent for an active document.",
      409,
    );
  }
  const delivery = await sendEligibleSignatureRequestsNow(
    documentId,
    origin,
    true,
  );
  await database().query(
    `INSERT INTO document_events (
       document_id, event_type, actor_name, metadata
     )
     VALUES ($1, 'reminded', 'Workspace owner', $2::jsonb)`,
    [documentId, JSON.stringify(delivery)],
  );
  return { reminded: true, ...delivery };
}

export async function voidWorkspaceDocument(
  userId: string,
  documentIdValue: unknown,
) {
  const documentId = cleanText(documentIdValue, 64);
  if (!isUuid(documentId)) {
    throw new WorkspaceContentError("Choose a valid document.");
  }
  const rows = await database().query(
    `UPDATE workspace_documents
     SET status = 'voided', updated_at = NOW()
     WHERE id = $1 AND user_id = $2
       AND status NOT IN ('completed', 'voided', 'declined', 'expired')
     RETURNING id`,
    [documentId, userId],
  );
  if (!rows[0]) {
    throw new WorkspaceContentError(
      "This document cannot be voided.",
      409,
    );
  }
  await database().query(
    `INSERT INTO document_events (
       document_id, event_type, actor_name
     )
     VALUES ($1, 'voided', 'Workspace owner')`,
    [documentId],
  );
  return { voided: true };
}

export async function saveDocumentSettings(
  userId: string,
  input: RecordValue,
) {
  const signingOrder =
    cleanText(input.defaultSigningOrder, 20) === "parallel"
      ? "parallel"
      : "sequential";
  const reminderDays = Math.max(
    1,
    Math.min(30, Number(input.reminderDays || 3) || 3),
  );
  const expiryDays = Math.max(
    1,
    Math.min(365, Number(input.expiryDays || 30) || 30),
  );
  const disclosure =
    cleanText(input.disclosureText, 2_000) ||
    "I consent to use electronic records and signatures for this document.";
  const rows = await database().query(
    `INSERT INTO document_settings (
       user_id, default_signing_order, reminder_days, expiry_days,
       identity_verification, include_workspace_branding,
       disclosure_text, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       default_signing_order = EXCLUDED.default_signing_order,
       reminder_days = EXCLUDED.reminder_days,
       expiry_days = EXCLUDED.expiry_days,
       identity_verification = EXCLUDED.identity_verification,
       include_workspace_branding = EXCLUDED.include_workspace_branding,
       disclosure_text = EXCLUDED.disclosure_text,
       updated_at = NOW()
     RETURNING *`,
    [
      userId,
      signingOrder,
      reminderDays,
      expiryDays,
      input.identityVerification === true,
      input.includeWorkspaceBranding !== false,
      disclosure,
    ],
  );
  return settingsFor(rows[0] as DatabaseRow);
}

const assertSigningOrder = async (
  documentId: string,
  signer: DatabaseRow,
) => {
  const rows = await database().query(
    `SELECT signing_order FROM workspace_documents WHERE id = $1 LIMIT 1`,
    [documentId],
  );
  if (cleanText((rows[0] as DatabaseRow | undefined)?.signing_order, 20) !== "sequential") {
    return;
  }
  const earlier = await database().query(
    `SELECT id FROM document_signers
     WHERE document_id = $1
       AND role IN ('signer', 'approver')
       AND order_index < $2
       AND status NOT IN ('signed', 'approved')
     LIMIT 1`,
    [documentId, Number(signer.order_index || 1)],
  );
  if (earlier[0]) {
    throw new WorkspaceContentError(
      "This document is waiting for an earlier signer.",
      409,
      "signing_order_pending",
    );
  }
};

export async function getPublicSigningSession(
  tokenValue: unknown,
  ipAddress: string | null,
) {
  const token = cleanText(tokenValue, 100);
  if (!/^[0-9a-f]{48}$/i.test(token)) {
    throw new WorkspaceContentError("This signing link is invalid.", 404);
  }
  const sql = database();
  const rows = await sql.query(
    `SELECT signer.*, document.user_id, document.title,
            document.status AS document_status, document.signing_order,
             template.name AS template_name, template.description,
             template.source_type, template.blocks, template.base_file_id,
             file.name AS base_file_name, file.mime_type AS base_file_mime_type,
             object.bucket_name AS base_file_bucket_name,
            object.object_key AS base_file_object_key,
            object.public_url AS base_file_public_url,
            object.visibility AS base_file_visibility,
            object.status AS base_file_storage_status,
            object.scan_status AS base_file_scan_status,
            settings.disclosure_text, settings.include_workspace_branding
     FROM document_signers signer
     JOIN workspace_documents document ON document.id = signer.document_id
     LEFT JOIN document_templates template ON template.id = document.template_id
     LEFT JOIN workspace_files file ON file.id = template.base_file_id
     LEFT JOIN storage_objects object ON object.id = file.storage_object_id
     LEFT JOIN document_settings settings ON settings.user_id = document.user_id
     WHERE signer.signing_token = $1
       AND signer.token_expires_at > NOW()
       AND document.status IN ('sent', 'viewed', 'partially_signed')
     LIMIT 1`,
    [token],
  );
  const signer = rows[0] as DatabaseRow | undefined;
  if (!signer) {
    throw new WorkspaceContentError(
      "This signing link has expired or is no longer available.",
      404,
    );
  }
  if (cleanText(signer.role, 20) === "cc") {
    throw new WorkspaceContentError(
      "This recipient does not need to sign.",
      409,
    );
  }
  if (["signed", "approved"].includes(cleanText(signer.status, 20))) {
    return {
      completed: true,
      signer: {
        name: cleanText(signer.name, 160),
        role: cleanText(signer.role, 20),
      },
      document: { title: cleanText(signer.title, 220) },
    };
  }
  await assertSigningOrder(cleanText(signer.document_id, 64), signer);
  if (cleanText(signer.status, 20) === "pending") {
    await Promise.all([
      sql.query(
        `UPDATE document_signers
         SET status = 'viewed', viewed_at = NOW()
         WHERE id = $1 AND status = 'pending'`,
        [String(signer.id)],
      ),
      sql.query(
        `UPDATE workspace_documents
         SET status = CASE WHEN status = 'sent' THEN 'viewed' ELSE status END,
             viewed_at = COALESCE(viewed_at, NOW()),
             updated_at = NOW()
         WHERE id = $1`,
        [String(signer.document_id)],
      ),
      sql.query(
        `INSERT INTO document_events (
           document_id, signer_id, event_type, actor_name,
           actor_email, ip_address
         )
         VALUES ($1, $2, 'viewed', $3, $4, $5::inet)`,
        [
          String(signer.document_id),
          String(signer.id),
          cleanText(signer.name, 160),
          cleanText(signer.email, 320),
          ipAddress,
        ],
      ),
    ]);
  }
  let baseFile: {
    name: string;
    mimeType: string;
    url: string;
  } | null = null;
  if (
    cleanText(signer.base_file_storage_status, 20) === "ready" &&
    cleanText(signer.base_file_scan_status, 20) === "validated" &&
    cleanText(signer.base_file_object_key, 1_024)
  ) {
    baseFile = {
      name: cleanText(signer.base_file_name, 255),
      mimeType: cleanText(signer.base_file_mime_type, 180),
      url: await createSignedStorageDownload({
        location: {
          bucket: cleanText(signer.base_file_bucket_name, 255),
          key: cleanText(signer.base_file_object_key, 1_024),
          publicUrl:
            cleanText(signer.base_file_public_url, 2_000) || null,
          visibility:
            cleanText(signer.base_file_visibility, 20) === "public"
              ? "public"
              : "private",
        },
        fileName: cleanText(signer.base_file_name, 255),
        mimeType: cleanText(signer.base_file_mime_type, 180),
        inline: true,
        expiresInSeconds: 900,
      }),
    };
  }
  return {
    completed: false,
    signer: {
      name: cleanText(signer.name, 160),
      email: cleanText(signer.email, 320),
      role: cleanText(signer.role, 20),
    },
    document: {
      title: cleanText(signer.title, 220),
      templateName: cleanText(signer.template_name, 180),
      description: cleanText(signer.description, 2_000),
      sourceType: cleanText(signer.source_type, 30),
      blocks: jsonValue<unknown[]>(signer.blocks, []),
      baseFile,
    },
    disclosure:
      cleanText(signer.disclosure_text, 2_000) ||
      "I consent to use electronic records and signatures for this document.",
    includeWorkspaceBranding: Boolean(signer.include_workspace_branding),
  };
}

const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

const saveGeneratedWorkspaceFile = async (input: {
  userId: string;
  sourceId: string;
  sourceLabel: string;
  key: string;
  name: string;
  mimeType: string;
  content: Buffer;
}) => {
  const location = resolveStorageLocation("private", input.key);
  const uploaded = await putStorageObject({
    location,
    fileName: input.name,
    mimeType: input.mimeType,
    body: input.content,
    sizeBytes: input.content.length,
    metadata: {
      purpose: "generated_document",
      "source-id": input.sourceId,
    },
  });
  const rows = await database().query(
    `WITH saved_object AS (
       INSERT INTO storage_objects (
         id, user_id, provider, bucket_name, object_key, file_name,
         mime_type, size_bytes, visibility, purpose, source_id, etag,
         checksum_sha256, status, scan_status, verified_at,
         created_at, updated_at
       )
       VALUES (
         gen_random_uuid(), $1, 'r2', $2, $3, $4, $5, $6, 'private',
         'generated_document', $7, NULLIF($8, ''), NULLIF($9, ''),
         'ready', 'validated', NOW(), NOW(), NOW()
       )
       ON CONFLICT (bucket_name, object_key) DO UPDATE SET
         file_name = EXCLUDED.file_name,
         mime_type = EXCLUDED.mime_type,
         size_bytes = EXCLUDED.size_bytes,
         etag = EXCLUDED.etag,
         checksum_sha256 = EXCLUDED.checksum_sha256,
         status = 'ready',
         scan_status = 'validated',
         verified_at = NOW(),
         deleted_at = NULL,
         updated_at = NOW()
       RETURNING id
     )
     INSERT INTO workspace_files (
       user_id, name, mime_type, size_bytes, storage_key,
       storage_object_id, storage_provider, etag, checksum_sha256,
       source_type, source_id, source_label, uploaded_by, scan_status
     )
     SELECT $1, $4, $5, $6, $3, saved_object.id, 'r2',
            NULLIF($8, ''), NULLIF($9, ''), 'document', $7, $10, $1,
            'validated'
     FROM saved_object
     ON CONFLICT (user_id, storage_key) DO UPDATE SET
       name = EXCLUDED.name,
       mime_type = EXCLUDED.mime_type,
       size_bytes = EXCLUDED.size_bytes,
       storage_object_id = EXCLUDED.storage_object_id,
       storage_provider = EXCLUDED.storage_provider,
       etag = EXCLUDED.etag,
       checksum_sha256 = EXCLUDED.checksum_sha256,
       scan_status = 'validated',
       updated_at = NOW()
     RETURNING id`,
    [
      input.userId,
      location.bucket,
      location.key,
      input.name,
      input.mimeType,
      input.content.length,
      input.sourceId,
      uploaded.etag,
      uploaded.checksumSha256,
      input.sourceLabel,
    ],
  );
  return cleanText((rows[0] as DatabaseRow | undefined)?.id, 64);
};

const completeSignedDocument = async (
  documentId: string,
  origin: string,
) => {
  const sql = database();
  const rows = await sql.query(
    `SELECT document.*, template.blocks, template.description,
            owner.short_id AS workspace_short_id
     FROM workspace_documents document
     LEFT JOIN document_templates template ON template.id = document.template_id
     JOIN users owner ON owner.id = document.user_id
     WHERE document.id = $1
     LIMIT 1`,
    [documentId],
  );
  const document = rows[0] as DatabaseRow;
  const signers = (await sql.query(
    `SELECT * FROM document_signers
     WHERE document_id = $1
     ORDER BY order_index, created_at`,
    [documentId],
  )) as DatabaseRow[];
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        documentId,
        title: document.title,
        signers: signers.map((signer) => ({
          id: signer.id,
          email: signer.email,
          role: signer.role,
          status: signer.status,
          signedAt: signer.signed_at,
          signature: signer.signature_value,
        })),
      }),
    )
    .digest("hex");
  const blocks = jsonValue<Array<RecordValue>>(document.blocks, []);
  const body = blocks
    .map((block) => {
      const type = cleanText(block.type, 30);
      const content = escapeHtml(block.content);
      if (type === "heading") return `<h2>${content}</h2>`;
      if (type === "signature") return "";
      return `<p>${content}</p>`;
    })
    .join("");
  const signatureMarkup = signers
    .filter((signer) => cleanText(signer.role, 20) !== "cc")
    .map(
      (signer) =>
        `<div class="signature"><strong>${escapeHtml(
          signer.signature_value || signer.name,
        )}</strong><br><span>${escapeHtml(signer.name)} · ${escapeHtml(
          signer.email,
        )}</span><br><small>${escapeHtml(signer.role)} · ${escapeHtml(
          signer.signed_at,
        )}</small></div>`,
    )
    .join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(
    document.title,
  )}</title><style>body{max-width:760px;margin:48px auto;padding:0 24px;font-family:Inter,Arial,sans-serif;color:#182033;line-height:1.65}h1{font-size:30px}h2{margin-top:28px}.signature{margin-top:28px;padding:18px;border:1px solid #d8dee9;border-radius:10px}.hash{margin-top:40px;padding:14px;background:#f3f5f8;border-radius:8px;font:11px ui-monospace,monospace;word-break:break-all}</style></head><body><h1>${escapeHtml(
    document.title,
  )}</h1>${body || `<p>${escapeHtml(document.description)}</p>`}<h2>Signatures</h2>${signatureMarkup}<div class="hash">SHA-256: ${hash}</div></body></html>`;
  const certificate = [
    "MAXFORM CERTIFICATE OF COMPLETION",
    `Document: ${cleanText(document.title, 220)}`,
    `Completed: ${new Date().toISOString()}`,
    "",
    ...signers.map(
      (signer) =>
        `${cleanText(signer.role, 20).toUpperCase()}: ${cleanText(
          signer.name,
          160,
        )} <${cleanText(signer.email, 320)}> | ${cleanText(
          signer.status,
          20,
        )} | ${String(signer.signed_at || "copy recipient")}`,
    ),
    "",
    `SHA-256: ${hash}`,
  ].join("\n");
  const titleBase = safeFileName(document.title, "Signed document").replace(
    /\.[^.]+$/,
    "",
  );
  const signedBuffer = Buffer.from(html, "utf8");
  const certificateBuffer = Buffer.from(certificate, "utf8");
  const signedKey =
    `tenants/${document.user_id}/generated-documents/${documentId}/signed.html`;
  const certificateKey =
    `tenants/${document.user_id}/generated-documents/${documentId}/certificate.txt`;
  const sourceLabel = `From: Documents / ${cleanText(document.title, 220)}`;
  const [signedFileId, certificateFileId] = await Promise.all([
    saveGeneratedWorkspaceFile({
      userId: String(document.user_id),
      sourceId: documentId,
      sourceLabel,
      key: signedKey,
      name: `${titleBase} - signed.html`,
      mimeType: "text/html",
      content: signedBuffer,
    }),
    saveGeneratedWorkspaceFile({
      userId: String(document.user_id),
      sourceId: documentId,
      sourceLabel,
      key: certificateKey,
      name: `${titleBase} - certificate.txt`,
      mimeType: "text/plain",
      content: certificateBuffer,
    }),
  ]);
  if (!signedFileId || !certificateFileId) {
    throw new WorkspaceContentError(
      "The completed document files could not be catalogued.",
      503,
    );
  }
  const shareToken = randomBytes(16).toString("base64url");
  await Promise.all([
    sql.query(
      `UPDATE workspace_documents
      SET status = 'completed', completed_at = NOW(), updated_at = NOW(),
           signed_file_id = $1, certificate_file_id = $2, document_hash = $3
       WHERE id = $4`,
      [signedFileId, certificateFileId, hash, documentId],
    ),
    sql.query(
      `INSERT INTO document_events (
         document_id, event_type, actor_name, metadata
       )
       VALUES ($1, 'completed', 'MaxForm', $2::jsonb)`,
      [documentId, JSON.stringify({ hash })],
    ),
    sql.query(
      `INSERT INTO workspace_file_share_links (
         file_id, user_id, token, expires_at
       )
       VALUES ($1, $2, $3, NOW() + INTERVAL '30 days')`,
      [signedFileId, String(document.user_id), shareToken],
    ),
  ]);
  const finalUrl = cleanSharedFileUrl(
    origin,
    cleanText(document.workspace_short_id, 6) ||
      (await workspaceShortIdFor(String(document.user_id))),
    shareToken,
  );
  await Promise.allSettled(
    signers.map((signer) =>
      sendEmailNow({
        userId: String(document.user_id),
        templateKey: "document_signed",
        to: cleanText(signer.email, 320),
        sourceEventId: documentId,
        idempotencyKey: `${documentId}:completed:${String(signer.id)}`,
        variables: {
          action: { url: finalUrl },
          contact: { name: cleanText(signer.name, 160) },
          document: { title: cleanText(document.title, 220) },
        },
      }),
    ),
  );
  await Promise.allSettled([
    dispatchWorkspaceWorkflowEvent(String(document.user_id), "document_signed", {
      id: documentId,
      title: cleanText(document.title, 220),
      signedFileId,
      certificateFileId,
    }, `document_signed:${documentId}`),
  ]);
  return { hash, signedFileId };
};

export async function completePublicSignature(
  tokenValue: unknown,
  input: RecordValue,
  ipAddress: string | null,
  origin: string,
) {
  const token = cleanText(tokenValue, 100);
  if (!/^[0-9a-f]{48}$/i.test(token)) {
    throw new WorkspaceContentError("This signing link is invalid.", 404);
  }
  if (input.consent !== true) {
    throw new WorkspaceContentError(
      "Consent is required before completing this document.",
    );
  }
  const signature = cleanText(input.signature, 160);
  if (signature.length < 2) {
    throw new WorkspaceContentError("Enter your full signature.");
  }
  const sql = database();
  const rows = await sql.query(
    `SELECT signer.*, document.status AS document_status
     FROM document_signers signer
     JOIN workspace_documents document ON document.id = signer.document_id
     WHERE signer.signing_token = $1
       AND signer.token_expires_at > NOW()
       AND signer.status IN ('pending', 'viewed')
       AND document.status IN ('sent', 'viewed', 'partially_signed')
     LIMIT 1`,
    [token],
  );
  const signer = rows[0] as DatabaseRow | undefined;
  if (!signer) {
    throw new WorkspaceContentError(
      "This signing link has expired or was already completed.",
      409,
    );
  }
  await assertSigningOrder(cleanText(signer.document_id, 64), signer);
  const role = cleanText(signer.role, 20);
  const status = role === "approver" ? "approved" : "signed";
  const updated = await sql.query(
    `UPDATE document_signers
     SET status = $1, signature_value = $2, signed_at = NOW(),
         consent_given = TRUE, ip_address = $3::inet
     WHERE id = $4 AND status IN ('pending', 'viewed')
     RETURNING id`,
    [status, signature, ipAddress, String(signer.id)],
  );
  if (!updated[0]) {
    throw new WorkspaceContentError(
      "This signing action was already completed.",
      409,
    );
  }
  await sql.query(
    `INSERT INTO document_events (
       document_id, signer_id, event_type, actor_name,
       actor_email, ip_address
     )
     VALUES ($1, $2, $3, $4, $5, $6::inet)`,
    [
      String(signer.document_id),
      String(signer.id),
      role === "approver" ? "approved" : "signed",
      cleanText(signer.name, 160),
      cleanText(signer.email, 320),
      ipAddress,
    ],
  );
  const pending = await sql.query(
    `SELECT id FROM document_signers
     WHERE document_id = $1
       AND role IN ('signer', 'approver')
       AND status NOT IN ('signed', 'approved')
     LIMIT 1`,
    [String(signer.document_id)],
  );
  if (pending[0]) {
    await sql.query(
      `UPDATE workspace_documents
       SET status = 'partially_signed', updated_at = NOW()
       WHERE id = $1`,
      [String(signer.document_id)],
    );
    await sendEligibleSignatureRequestsNow(String(signer.document_id), origin);
    return { completed: false };
  }
  await completeSignedDocument(String(signer.document_id), origin);
  return { completed: true };
}

export async function handleFilesDocumentsData(
  request: IncomingMessage,
  response: ServerResponse,
) {
  try {
    const url = new URL(request.url || "/", "http://localhost");
    const module = url.searchParams.get("module") || "";
    const action = url.searchParams.get("action") || "workspace";
    const origin = requestOrigin(request);

    if (
      request.method === "GET" &&
      module === "files" &&
      (action === "shared-content" || action === "clean-shared-content")
    ) {
      await sendSharedFile(
        request,
        response,
        action === "clean-shared-content"
          ? url.searchParams.get("fileId")
          : url.searchParams.get("token"),
        action === "clean-shared-content"
          ? url.searchParams.get("workspaceId")
          : "",
      );
      return;
    }
    if (
      request.method === "GET" &&
      module === "files" &&
      action === "branded-file"
    ) {
      await sendBrandedFile(
        request,
        response,
        url.searchParams.get("workspaceId"),
        url.searchParams.get("fileToken"),
      );
      return;
    }
    if (
      request.method === "GET" &&
      module === "documents" &&
      action === "signing"
    ) {
      json(
        response,
        200,
        await getPublicSigningSession(
          url.searchParams.get("token"),
          requestIp(request),
        ),
      );
      return;
    }
    if (
      request.method === "POST" &&
      module === "documents" &&
      action === "sign"
    ) {
      const body = await readBody(request);
      json(
        response,
        200,
        await completePublicSignature(
          url.searchParams.get("token"),
          body,
          requestIp(request),
          origin,
        ),
      );
      return;
    }

    const userId = await authenticatedUserId(request);
    if (request.method === "GET" && module === "files") {
      if (action === "external-workspace") {
        json(response, 200, await getExternalStorageWorkspace(userId));
        return;
      }
      if (action === "external-items") {
        json(
          response,
          200,
          await listExternalStorageItems(userId, {
            connectionId: url.searchParams.get("connectionId") || "",
            provider: url.searchParams.get("provider") || "",
            parentId: url.searchParams.get("parentId") || "",
            driveId: url.searchParams.get("driveId") || "",
            search: url.searchParams.get("search") || "",
            foldersOnly: url.searchParams.get("foldersOnly") === "true",
          }),
        );
        return;
      }
      if (action === "external-drives") {
        json(
          response,
          200,
          await listExternalStorageDrives(userId, {
            connectionId: url.searchParams.get("connectionId") || "",
            provider: url.searchParams.get("provider") || "",
          }),
        );
        return;
      }
      if (action === "export-source") {
        await sendWorkspaceCollectionExport(
          response,
          userId,
          url.searchParams.get("sourceType"),
          url.searchParams.get("sourceId"),
        );
        return;
      }
      if (action === "workspace") {
        json(
          response,
          200,
          await getFilesWorkspace(userId, {
            view: url.searchParams.get("view") || "",
            folderId: url.searchParams.get("folderId") || "",
            search: url.searchParams.get("search") || "",
            type: url.searchParams.get("type") || "",
            source: url.searchParams.get("source") || "",
            projectId: url.searchParams.get("projectId") || "",
          }),
        );
        return;
      }
      if (action === "content") {
        json(
          response,
          200,
          await getWorkspaceFileContent(
            userId,
            url.searchParams.get("id"),
            origin,
          ),
        );
        return;
      }
    }
    if (request.method === "GET" && module === "documents") {
      if (action === "workspace") {
        json(response, 200, await getDocumentsWorkspace(userId));
        return;
      }
    }
    if (request.method === "POST") {
      const body = await readBody(request);
      if (module === "files") {
        if (action === "external-folder") {
          json(response, 201, {
            folder: await createExternalStorageFolder(userId, body),
          });
          return;
        }
        if (action === "external-copy") {
          json(
            response,
            200,
            await copyWorkspaceFileToExternal(userId, body),
          );
          return;
        }
        if (action === "external-copy-all") {
          json(
            response,
            200,
            await copyWorkspaceFilesToExternal(userId, body),
          );
          return;
        }
        if (action === "external-import") {
          json(
            response,
            200,
            await importExternalFileToMaxForm(userId, body),
          );
          return;
        }
        if (action === "external-link") {
          json(response, 201, await linkExternalFile(userId, body));
          return;
        }
        if (action === "external-unlink") {
          json(response, 200, await unlinkExternalFile(userId, body.linkId));
          return;
        }
        if (action === "external-retry") {
          json(
            response,
            200,
            await retryExternalStorageOperation(userId, body.operationId, body.connectionId),
          );
          return;
        }
        if (action === "export-selection") {
          await sendWorkspaceSelectionExport(response, userId, body);
          return;
        }
        if (action === "folder") {
          json(response, 201, {
            folder: await createWorkspaceFolder(userId, body),
          });
          return;
        }
        if (action === "upload") {
          json(response, 201, {
            file: await uploadWorkspaceFile(userId, body),
          });
          return;
        }
        if (action === "rename") {
          json(response, 200, await renameWorkspaceFile(userId, body));
          return;
        }
        if (action === "move") {
          json(response, 200, await moveWorkspaceFile(userId, body));
          return;
        }
        if (action === "bulk") {
          json(
            response,
            200,
            await bulkUpdateWorkspaceFiles(userId, body),
          );
          return;
        }
        if (action === "trash") {
          json(
            response,
            200,
            await trashWorkspaceFile(userId, body.id),
          );
          return;
        }
        if (action === "restore") {
          json(
            response,
            200,
            await restoreWorkspaceFile(userId, body.id),
          );
          return;
        }
        if (action === "share") {
          json(
            response,
            201,
            await shareWorkspaceFile(userId, body, origin),
          );
          return;
        }
        if (action === "clear-storage") {
          json(
            response,
            200,
            await clearWorkspaceStorage(userId, body),
          );
          return;
        }
        if (action === "settings") {
          json(response, 200, {
            settings: await saveFileSettings(userId, body),
          });
          return;
        }
      }
      if (module === "documents") {
        if (action === "template") {
          json(response, 200, {
            template: await saveDocumentTemplate(userId, body),
          });
          return;
        }
        if (action === "create") {
          json(response, 201, {
            document: await createWorkspaceDocument(userId, body),
          });
          return;
        }
        if (action === "send") {
          json(
            response,
            202,
            await sendWorkspaceDocument(userId, body.id, origin),
          );
          return;
        }
        if (action === "remind") {
          json(
            response,
            202,
            await remindWorkspaceDocument(userId, body.id, origin),
          );
          return;
        }
        if (action === "void") {
          json(
            response,
            200,
            await voidWorkspaceDocument(userId, body.id),
          );
          return;
        }
        if (action === "settings") {
          json(response, 200, {
            settings: await saveDocumentSettings(userId, body),
          });
          return;
        }
      }
    }
    json(response, 404, {
      code: "workspace_content_action_not_found",
      error: "This Files or Documents action is not available.",
    });
  } catch (error) {
    if (response.headersSent) {
      if (!response.writableEnded) response.destroy();
      return;
    }
    if (error instanceof WorkspaceContentError || error instanceof ExternalStorageError) {
      json(response, error.status, {
        code: error.code,
        error: error.message,
      });
      return;
    }
    const databaseCode =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code || "")
        : "";
    console.error("[files-documents-data] unexpected request failure", {
      code: databaseCode || "unknown",
      type: error instanceof Error ? error.name : typeof error,
    });
    json(response, 500, {
      code: "workspace_content_unavailable",
      error: "Files and documents could not be updated. Please try again.",
    });
  }
}

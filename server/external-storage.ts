import { createHash } from "node:crypto";

import { neon } from "@neondatabase/serverless";

import {
  decryptIntegrationCredentials,
  encryptIntegrationCredentials,
  refreshIntegrationCredentials,
  type IntegrationTokenCredentials,
} from "./integration-oauth";
import {
  authorizeIntegrationAction,
  type IntegrationCapability,
} from "./integrations-data";
import {
  createStorageObjectKey,
  getStorageObjectStream,
  normalizeMimeType,
  putStorageObject,
  resolveStorageLocation,
  sanitizeStorageFileName,
  sha256Hex,
  validateStorageUpload,
  type StorageObjectLocation,
} from "./storage-service";

type DatabaseRow = Record<string, unknown>;
type RecordValue = Record<string, unknown>;

export type ExternalStorageProvider = "google_drive" | "dropbox";
export type ExternalRelationshipMode =
  | "copied_to_external"
  | "imported_to_maxform"
  | "linked_external"
  | "synchronized";

export type ExternalFile = {
  id: string;
  provider: ExternalStorageProvider;
  name: string;
  mimeType: string;
  sizeBytes: number;
  modifiedAt: string | null;
  parentId: string;
  path: string;
  url: string;
  isFolder: boolean;
  downloadable: boolean;
};

export type ExternalStorageConnection = {
  id: string;
  provider: ExternalStorageProvider;
  providerKey: "google_workspace" | "dropbox";
  providerName: string;
  accountLabel: string;
  status: string;
  reconnectRequired: boolean;
};

export type ExternalStorageLink = {
  id: string;
  fileId: string | null;
  fileName: string;
  connectionId: string | null;
  provider: ExternalStorageProvider;
  externalFileId: string;
  externalFolderId: string;
  externalFileName: string;
  externalUrl: string;
  externalPath: string;
  externalRevision: string;
  relationshipMode: ExternalRelationshipMode;
  syncStatus: string;
  lastSyncAt: string | null;
  lastSuccessfulOperation: string;
  lastError: string;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
};

export type ExternalStorageOperation = {
  id: string;
  fileId: string | null;
  linkId: string | null;
  connectionId: string | null;
  provider: ExternalStorageProvider;
  operationType: string;
  status: string;
  requestMetadata: Record<string, unknown>;
  resultMetadata: Record<string, unknown>;
  errorCode: string;
  errorMessage: string;
  retryCount: number;
  maxRetries: number;
  nextAttemptAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export class ExternalStorageError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "external_storage_error",
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const database = () => {
  const url = process.env.DATABASE_URL || "";
  if (!url) {
    throw new ExternalStorageError(
      "External storage is temporarily unavailable.",
      503,
      "external_storage_unavailable",
    );
  }
  return neon(url);
};

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );

const text = (value: unknown, maximum: number) =>
  String(value ?? "").trim().slice(0, maximum);

const numberValue = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const jsonObject = (value: unknown): Record<string, unknown> => {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return jsonObject(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
};

const safeExternalUrl = (value: unknown) => {
  const candidate = text(value, 2_000);
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
};

const externalProviderForKey = (
  value: unknown,
): ExternalStorageProvider | "" => {
  const key = text(value, 60);
  if (key === "google_workspace") return "google_drive";
  if (key === "dropbox") return "dropbox";
  return "";
};

const providerLabel = (provider: ExternalStorageProvider) =>
  provider === "google_drive" ? "Google Drive" : "Dropbox";

const providerFromInput = (value: unknown): ExternalStorageProvider => {
  const provider = text(value, 40);
  if (provider === "google_drive" || provider === "dropbox") return provider;
  throw new ExternalStorageError("Choose Google Drive or Dropbox.", 422, "provider_invalid");
};

const connectionIdFromInput = (value: unknown) => {
  const id = text(value, 64);
  if (!isUuid(id)) {
    throw new ExternalStorageError(
      "Choose a connected external storage account.",
      422,
      "connection_required",
    );
  }
  return id;
};

const authorizeExternalAction = async (
  userId: string,
  connectionId: string,
  capability: IntegrationCapability,
  actionKey: string,
  requestMetadata: Record<string, unknown> = {},
) => {
  try {
    await authorizeIntegrationAction({
      workspaceId: userId,
      connectionId,
      moduleKey: "files",
      capability,
      actionKey,
      requestMetadata,
    });
  } catch (error) {
    const status =
      error && typeof error === "object" && "status" in error
        ? Number((error as { status?: unknown }).status)
        : 403;
    const code =
      error && typeof error === "object" && "code" in error
        ? text((error as { code?: unknown }).code, 100)
        : "integration_access_denied";
    throw new ExternalStorageError(
      error instanceof Error
        ? error.message
        : "This module is not allowed to use that connection capability.",
      Number.isFinite(status) && status >= 400 && status < 600 ? status : 403,
      code || "integration_access_denied",
    );
  }
};

const abortableFetch = async (
  url: string,
  init: RequestInit,
  timeoutMs = 30_000,
) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ExternalStorageError(
        "The external provider timed out. You can retry this operation.",
        504,
        "provider_timeout",
      );
    }
    throw new ExternalStorageError(
      "The external provider could not be reached. You can retry this operation.",
      502,
      "provider_unreachable",
    );
  } finally {
    clearTimeout(timer);
  }
};

const responsePayload = async (response: Response) => {
  const raw = await response.text();
  if (!raw) return {} as Record<string, unknown>;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { message: raw.slice(0, 500) };
  }
};

const providerError = async (response: Response, provider: ExternalStorageProvider) => {
  const value = await responsePayload(response);
  const rawMessage = text(value.error || value.error_summary || value.message, 500);
  const authFailure = response.status === 401 || response.status === 403;
  return new ExternalStorageError(
    authFailure
      ? `${providerLabel(provider)} needs to be reconnected or granted file access.`
      : rawMessage || `${providerLabel(provider)} rejected the request.`,
    authFailure ? 409 : response.status >= 500 ? 503 : 502,
    authFailure ? "provider_reconnect_required" : "provider_request_failed",
    { providerStatus: response.status },
  );
};

const jsonRequest = async (
  url: string,
  init: RequestInit,
  provider: ExternalStorageProvider,
) => {
  const response = await abortableFetch(url, init);
  if (!response.ok) throw await providerError(response, provider);
  return responsePayload(response);
};

const binaryRequest = async (
  url: string,
  init: RequestInit,
  provider: ExternalStorageProvider,
) => {
  const response = await abortableFetch(url, init, 120_000);
  if (!response.ok) throw await providerError(response, provider);
  return {
    body: Buffer.from(await response.arrayBuffer()),
    headers: response.headers,
  };
};

type ProviderConnectionRow = DatabaseRow & {
  provider_key?: unknown;
};

const connectionFor = async (
  userId: string,
  connectionIdValue: unknown,
  providerValue?: unknown,
) => {
  const connectionId = connectionIdFromInput(connectionIdValue);
  const requestedProvider = providerValue ? providerFromInput(providerValue) : "";
  const rows = await database().query(
    `SELECT connection.id, connection.workspace_id, connection.provider_key,
            connection.status, connection.reconnect_required,
            connection.credentials_encrypted, connection.token_expires_at,
            connection.legacy_source, connection.metadata,
            connection.external_account_name, connection.external_account_email,
            provider.name AS provider_name
     FROM integration_connections connection
     JOIN integration_providers provider ON provider.key = connection.provider_key
     WHERE connection.id = $1
       AND connection.workspace_id = $2
       AND connection.provider_key IN ('google_workspace', 'dropbox')
     LIMIT 1`,
    [connectionId, userId],
  );
  const row = rows[0] as ProviderConnectionRow | undefined;
  const provider = externalProviderForKey(row?.provider_key);
  if (!row || !provider || (requestedProvider && provider !== requestedProvider)) {
    throw new ExternalStorageError(
      "That external storage connection is not available in this workspace.",
      404,
      "connection_not_found",
    );
  }
  if (text(row.status, 40) !== "connected" || row.reconnect_required === true) {
    throw new ExternalStorageError(
      `Reconnect ${providerLabel(provider)} before using external storage.`,
      409,
      "provider_reconnect_required",
    );
  }
  if (!text(row.credentials_encrypted, 10)) {
    throw new ExternalStorageError(
      `Reconnect ${providerLabel(provider)} before using external storage.`,
      409,
      "provider_reconnect_required",
    );
  }
  return { row, provider, connectionId };
};

const markConnectionNeedsReconnect = async (
  row: ProviderConnectionRow,
  message = "Reconnect this external storage account.",
) => {
  await database()
    .query(
      `UPDATE integration_connections
       SET status = 'reconnect_required', reconnect_required = TRUE,
           last_error = $1, updated_at = NOW()
       WHERE id = $2`,
      [message, text(row.id, 64)],
    )
    .catch(() => undefined);
};

const accessTokenFor = async (
  row: ProviderConnectionRow,
  provider: ExternalStorageProvider,
) => {
  let credentials: IntegrationTokenCredentials;
  try {
    credentials = decryptIntegrationCredentials(text(row.credentials_encrypted, 10_000));
  } catch {
    await markConnectionNeedsReconnect(row);
    throw new ExternalStorageError(
      `Reconnect ${providerLabel(provider)} before using external storage.`,
      409,
      "provider_reconnect_required",
    );
  }
  const expiresAt = Date.parse(credentials.expiresAt || text(row.token_expires_at, 80));
  if (!Number.isFinite(expiresAt) || expiresAt > Date.now() + 60_000) {
    return credentials.accessToken;
  }
  try {
    const refreshed = await refreshIntegrationCredentials(
      provider === "google_drive" ? "google_sheets" : "dropbox",
      credentials,
    );
    const encrypted = encryptIntegrationCredentials(refreshed);
    await database().query(
      `UPDATE integration_connections
       SET credentials_encrypted = $1, token_expires_at = $2,
           status = 'connected', reconnect_required = FALSE,
           last_error = '', last_success_at = NOW(), updated_at = NOW()
       WHERE id = $3`,
      [encrypted, refreshed.expiresAt || null, text(row.id, 64)],
    );
    const legacySource = text(row.legacy_source, 40);
    if (legacySource === "automation") {
      await database()
        .query(
          `UPDATE automation_connections
           SET credentials_encrypted = $1, token_expires_at = $2,
               status = 'connected', last_error = NULL, updated_at = NOW()
           WHERE id = $3 AND user_id = $4`,
          [encrypted, refreshed.expiresAt || null, text(row.id, 64), text(row.workspace_id, 64)],
        )
        .catch(() => undefined);
    }
    if (legacySource === "scheduling") {
      await database()
        .query(
          `UPDATE scheduling_tool_connections
           SET credentials_encrypted = $1::jsonb, token_expires_at = $2,
               status = 'connected', health_ok = TRUE, last_error = '', updated_at = NOW()
           WHERE id = $3 AND user_id = $4`,
          [JSON.stringify({ cipher: encrypted }), refreshed.expiresAt || null, text(row.id, 64), text(row.workspace_id, 64)],
        )
        .catch(() => undefined);
    }
    return refreshed.accessToken;
  } catch {
    await markConnectionNeedsReconnect(row);
    throw new ExternalStorageError(
      `${providerLabel(provider)} needs to be reconnected.`,
      409,
      "provider_reconnect_required",
    );
  }
};

const providerCall = async <T>(
  row: ProviderConnectionRow,
  action: () => Promise<T>,
) => {
  try {
    return await action();
  } catch (error) {
    if (
      error instanceof ExternalStorageError &&
      error.code === "provider_reconnect_required"
    ) {
      await markConnectionNeedsReconnect(row, error.message);
    }
    throw error;
  }
};

const googleHeaders = (token: string, json = false) => ({
  Authorization: `Bearer ${token}`,
  ...(json ? { "Content-Type": "application/json" } : {}),
});

const escapeDriveQuery = (value: string) => value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

const dropboxHeaders = (token: string, json = false) => ({
  Authorization: `Bearer ${token}`,
  ...(json ? { "Content-Type": "application/json" } : {}),
});

const externalUrlFor = (
  provider: ExternalStorageProvider,
  input: { id: string; path?: string; webViewLink?: string },
) => {
  if (provider === "google_drive") {
    return safeExternalUrl(input.webViewLink) || `https://drive.google.com/open?id=${encodeURIComponent(input.id)}`;
  }
  const path = input.path || "";
  return path ? `https://www.dropbox.com/home${path.startsWith("/") ? path : `/${path}`}` : "https://www.dropbox.com/home";
};

const mapGoogleFile = (value: unknown): ExternalFile => {
  const item = jsonObject(value);
  const mimeType = normalizeMimeType(item.mimeType) || "application/octet-stream";
  const isFolder = mimeType === "application/vnd.google-apps.folder";
  return {
    id: text(item.id, 300),
    provider: "google_drive",
    name: text(item.name, 255) || "Untitled file",
    mimeType,
    sizeBytes: numberValue(item.size),
    modifiedAt: item.modifiedTime ? String(item.modifiedTime) : null,
    parentId: Array.isArray(item.parents) ? text(item.parents[0], 300) : "",
    path: "",
    url: externalUrlFor("google_drive", {
      id: text(item.id, 300),
      webViewLink: text(item.webViewLink, 2_000),
    }),
    isFolder,
    downloadable: !isFolder,
  };
};

const mapDropboxEntry = (value: unknown): ExternalFile => {
  const item = jsonObject(value);
  const tag = text(item[".tag"], 30);
  const isFolder = tag === "folder";
  const path = text(item.path_display || item.path_lower, 2_000);
  return {
    id: text(item.id || path, 2_000),
    provider: "dropbox",
    name: text(item.name, 255) || "Untitled file",
    mimeType: normalizeMimeType(item.media_info && jsonObject(item.media_info).mime_type) || "application/octet-stream",
    sizeBytes: numberValue(item.size),
    modifiedAt: item.server_modified ? String(item.server_modified) : null,
    parentId: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) || "" : "",
    path,
    url: safeExternalUrl(externalUrlFor("dropbox", { id: text(item.id || path, 2_000), path })),
    isFolder,
    downloadable: !isFolder && tag !== "paper",
  };
};

const googleList = async (token: string, input: { parentId?: string; driveId?: string; search?: string; foldersOnly?: boolean }) => {
  const clauses = ["trashed = false"];
  if (input.parentId || !input.search) clauses.push(`'${escapeDriveQuery(input.parentId || "root")}' in parents`);
  if (input.search) clauses.push(`name contains '${escapeDriveQuery(input.search.slice(0, 120))}'`);
  if (input.foldersOnly) clauses.push("mimeType = 'application/vnd.google-apps.folder'");
  const params = new URLSearchParams({
    q: clauses.join(" and "),
    fields: "nextPageToken,files(id,name,mimeType,size,parents,modifiedTime,webViewLink,trashed)",
    pageSize: "100",
    orderBy: "folder,name",
    includeItemsFromAllDrives: "true",
    supportsAllDrives: "true",
    spaces: "drive",
  });
  if (input.driveId) {
    params.set("corpora", "drive");
    params.set("driveId", input.driveId);
  }
  const data = await jsonRequest(
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
    { headers: googleHeaders(token) },
    "google_drive",
  );
  return {
    files: (Array.isArray(data.files) ? data.files : []).map(mapGoogleFile).filter((file) => file.id),
    nextCursor: text(data.nextPageToken, 500) || null,
  };
};

const googleDrives = async (token: string) => {
  const data = await jsonRequest(
    "https://www.googleapis.com/drive/v3/drives?pageSize=100&fields=drives(id,name,createdTime,hidden)",
    { headers: googleHeaders(token) },
    "google_drive",
  );
  return (Array.isArray(data.drives) ? data.drives : [])
    .map((drive) => {
      const item = jsonObject(drive);
      return {
        id: text(item.id, 300),
        name: text(item.name, 255) || "Shared drive",
        hidden: itemBoolean(item.hidden),
      };
    })
    .filter((drive) => drive.id && !drive.hidden)
    .map(({ hidden: _hidden, ...drive }) => drive);
};

const itemBoolean = (value: unknown) => value === true || value === "true";

const googleFile = async (token: string, fileId: string) => {
  const params = new URLSearchParams({
    fields: "id,name,mimeType,size,parents,modifiedTime,webViewLink,md5Checksum,trashed",
    supportsAllDrives: "true",
  });
  const data = await jsonRequest(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?${params.toString()}`,
    { headers: googleHeaders(token) },
    "google_drive",
  );
  const file = mapGoogleFile(data);
  if (!file.id || file.isFolder || itemBoolean(data.trashed)) {
    throw new ExternalStorageError("That external file is no longer available.", 404, "external_file_not_found");
  }
  return { ...file, revision: text(data.md5Checksum, 300) };
};

const googleExport = (mimeType: string) => {
  if (mimeType === "application/vnd.google-apps.document") return { mimeType: "application/pdf", extension: ".pdf" };
  if (mimeType === "application/vnd.google-apps.spreadsheet") return { mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", extension: ".xlsx" };
  if (mimeType === "application/vnd.google-apps.presentation") return { mimeType: "application/pdf", extension: ".pdf" };
  if (mimeType === "application/vnd.google-apps.drawing") return { mimeType: "application/pdf", extension: ".pdf" };
  return null;
};

const googleDownload = async (token: string, file: ExternalFile) => {
  const exportFormat = googleExport(file.mimeType);
  const url = exportFormat
    ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}/export?mimeType=${encodeURIComponent(exportFormat.mimeType)}`
    : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true`;
  const result = await binaryRequest(url, { headers: googleHeaders(token) }, "google_drive");
  return {
    body: result.body,
    mimeType: exportFormat?.mimeType || file.mimeType,
    fileName: exportFormat && !file.name.toLowerCase().endsWith(exportFormat.extension)
      ? `${file.name}${exportFormat.extension}`
      : file.name,
  };
};

const googleCreateFolder = async (token: string, name: string, parentId: string) => {
  const data = await jsonRequest(
    "https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name,mimeType,parents,webViewLink",
    {
      method: "POST",
      headers: googleHeaders(token, true),
      body: JSON.stringify({
        name: sanitizeStorageFileName(name, "MaxForm"),
        mimeType: "application/vnd.google-apps.folder",
        ...(parentId ? { parents: [parentId] } : {}),
      }),
    },
    "google_drive",
  );
  return mapGoogleFile(data);
};

const googleUpload = async (
  token: string,
  input: { name: string; mimeType: string; body: Buffer; parentId: string; operationId: string },
) => {
  // A provider response can be lost after Drive has accepted the upload. Look
  // up the deterministic operation marker before retrying so a retry never
  // creates a second external file.
  const existingQuery = [
    "trashed = false",
    `appProperties has { key = 'maxformOperationId' and value = '${escapeDriveQuery(input.operationId)}' }`,
    ...(input.parentId ? [`'${escapeDriveQuery(input.parentId)}' in parents`] : []),
  ].join(" and ");
  const existing = await jsonRequest(
    `https://www.googleapis.com/drive/v3/files?${new URLSearchParams({
      q: existingQuery,
      fields: "files(id,name,mimeType,size,parents,modifiedTime,webViewLink,md5Checksum)",
      pageSize: "1",
      includeItemsFromAllDrives: "true",
      supportsAllDrives: "true",
      spaces: "drive",
    }).toString()}`,
    { headers: googleHeaders(token) },
    "google_drive",
  );
  const existingFile = Array.isArray(existing.files) ? existing.files[0] : null;
  if (existingFile) {
    const file = mapGoogleFile(existingFile);
    return { file, revision: text(jsonObject(existingFile).md5Checksum, 300) };
  }
  const boundary = `maxform-${createHash("sha256").update(input.operationId).digest("hex").slice(0, 20)}`;
  const metadata = JSON.stringify({
    name: sanitizeStorageFileName(input.name),
    ...(input.parentId ? { parents: [input.parentId] } : {}),
    appProperties: { maxformOperationId: input.operationId },
  });
  const prefix = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${normalizeMimeType(input.mimeType)}\r\n\r\n`,
  );
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([prefix, input.body, suffix]);
  const data = await jsonRequest(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,mimeType,size,parents,modifiedTime,webViewLink,md5Checksum",
    {
      method: "POST",
      headers: {
        ...googleHeaders(token),
        "Content-Type": `multipart/related; boundary=${boundary}`,
        "Content-Length": String(body.length),
      },
      body: body as unknown as BodyInit,
    },
    "google_drive",
  );
  return { file: mapGoogleFile(data), revision: text(data.md5Checksum, 300) };
};

const dropboxList = async (token: string, input: { parentId?: string; search?: string; foldersOnly?: boolean }) => {
  if (input.search) {
    const data = await jsonRequest(
      "https://api.dropboxapi.com/2/files/search_v2",
      {
        method: "POST",
        headers: dropboxHeaders(token, true),
        body: JSON.stringify({
          query: input.search.slice(0, 120),
          options: { path: input.parentId || "", max_results: 100, order_by: { field: "relevance" } },
        }),
      },
      "dropbox",
    );
    const matches = Array.isArray(data.matches) ? data.matches : [];
    const files = matches
      .map((match) => mapDropboxEntry(jsonObject(match).metadata))
      .filter((file) => file.id && (!input.foldersOnly || file.isFolder));
    return { files, nextCursor: null };
  }
  const data = await jsonRequest(
    "https://api.dropboxapi.com/2/files/list_folder",
    {
      method: "POST",
      headers: dropboxHeaders(token, true),
      body: JSON.stringify({
        path: input.parentId || "",
        recursive: false,
        include_deleted: false,
        include_non_downloadable_files: true,
        limit: 2000,
      }),
    },
    "dropbox",
  );
  const files = (Array.isArray(data.entries) ? data.entries : [])
    .map(mapDropboxEntry)
    .filter((file) => !input.foldersOnly || file.isFolder);
  return { files, nextCursor: text(data.has_more, 20) === "true" ? text(data.cursor, 500) : null };
};

const dropboxFile = async (token: string, fileId: string) => {
  const data = await jsonRequest(
    "https://api.dropboxapi.com/2/files/get_metadata",
    {
      method: "POST",
      headers: dropboxHeaders(token, true),
      body: JSON.stringify({ path: fileId, include_media_info: true }),
    },
    "dropbox",
  );
  const file = mapDropboxEntry(data);
  if (!file.id || file.isFolder) {
    throw new ExternalStorageError("That external file is no longer available.", 404, "external_file_not_found");
  }
  return { ...file, revision: text(data.rev, 300) };
};

const dropboxDownload = async (token: string, file: ExternalFile) => {
  const result = await binaryRequest(
    "https://content.dropboxapi.com/2/files/download",
    {
      method: "POST",
      headers: {
        ...dropboxHeaders(token),
        "Dropbox-API-Arg": JSON.stringify({ path: file.id }),
      },
    },
    "dropbox",
  );
  let metadata: Record<string, unknown> = {};
  try {
    metadata = JSON.parse(result.headers.get("dropbox-api-result") || "{}");
  } catch {
    metadata = {};
  }
  return {
    body: result.body,
    mimeType: normalizeMimeType(metadata.media_info && jsonObject(metadata.media_info).mime_type) || file.mimeType,
    fileName: sanitizeStorageFileName(text(metadata.name, 255) || file.name),
  };
};

const dropboxCreateFolder = async (token: string, name: string, parentId: string) => {
  const parent = parentId || "";
  const path = `${parent.replace(/\/$/, "")}/${sanitizeStorageFileName(name, "MaxForm")}`;
  const data = await jsonRequest(
    "https://api.dropboxapi.com/2/files/create_folder_v2",
    {
      method: "POST",
      headers: dropboxHeaders(token, true),
      body: JSON.stringify({ path, autorename: false }),
    },
    "dropbox",
  );
  const metadata = jsonObject(data.metadata);
  return mapDropboxEntry(metadata);
};

const dropboxUpload = async (
  token: string,
  input: { name: string; body: Buffer; parentId: string },
) => {
  const parent = input.parentId || "";
  const path = `${parent.replace(/\/$/, "")}/${sanitizeStorageFileName(input.name)}`;
  const data = await jsonRequest(
    "https://content.dropboxapi.com/2/files/upload",
    {
      method: "POST",
      headers: {
        ...dropboxHeaders(token),
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": JSON.stringify({ path, mode: "overwrite", autorename: false, mute: true, strict_conflict: false }),
        "Content-Length": String(input.body.length),
      },
      body: input.body as unknown as BodyInit,
    },
    "dropbox",
  );
  const file = mapDropboxEntry(data);
  return { file, revision: text(data.rev, 300) };
};

const remoteList = async (
  provider: ExternalStorageProvider,
  token: string,
  input: { parentId?: string; driveId?: string; search?: string; foldersOnly?: boolean },
) => provider === "google_drive" ? googleList(token, input) : dropboxList(token, input);

const remoteFile = async (provider: ExternalStorageProvider, token: string, fileId: string) =>
  provider === "google_drive" ? googleFile(token, fileId) : dropboxFile(token, fileId);

const remoteDownload = async (provider: ExternalStorageProvider, token: string, file: ExternalFile) =>
  provider === "google_drive" ? googleDownload(token, file) : dropboxDownload(token, file);

const remoteCreateFolder = async (provider: ExternalStorageProvider, token: string, name: string, parentId: string) =>
  provider === "google_drive" ? googleCreateFolder(token, name, parentId) : dropboxCreateFolder(token, name, parentId);

const remoteUpload = async (
  provider: ExternalStorageProvider,
  token: string,
  input: { name: string; mimeType: string; body: Buffer; parentId: string; operationId: string },
) => provider === "google_drive"
  ? googleUpload(token, input)
  : dropboxUpload(token, input);

const storageLocationFor = (row: DatabaseRow): StorageObjectLocation => ({
  bucket: text(row.bucket_name, 255),
  key: text(row.object_key, 1_024),
  publicUrl: text(row.public_url, 2_000) || null,
  visibility: text(row.visibility, 20) === "public" ? "public" : "private",
});

const readInternalFile = async (row: DatabaseRow) => {
  const sizeBytes = numberValue(row.size_bytes);
  if (sizeBytes > 100 * 1024 * 1024) {
    throw new ExternalStorageError("Files larger than 100 MB cannot be copied through this operation.", 413, "file_too_large");
  }
  const stored = await getStorageObjectStream(storageLocationFor(row));
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stored.body) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 100 * 1024 * 1024) {
      throw new ExternalStorageError("Files larger than 100 MB cannot be copied through this operation.", 413, "file_too_large");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
};

const internalFileFor = async (userId: string, fileIdValue: unknown) => {
  const fileId = text(fileIdValue, 64);
  if (!isUuid(fileId)) throw new ExternalStorageError("Choose a valid MaxForm file.", 422, "file_invalid");
  const rows = await database().query(
    `SELECT file.id, file.name, file.original_file_name, file.mime_type,
            file.size_bytes, file.folder_id, file.source_type, file.source_label,
            file.updated_at, file.scan_status, object.bucket_name,
            object.object_key, object.public_url, object.visibility,
            object.status AS storage_status, object.scan_status AS storage_scan_status,
            COALESCE(file.checksum_sha256, object.checksum_sha256) AS checksum_sha256
     FROM workspace_files file
     JOIN storage_objects object ON object.id = file.storage_object_id
     WHERE file.id = $1 AND file.user_id = $2 AND file.deleted_at IS NULL
       AND file.scan_status = 'validated'
       AND object.status = 'ready' AND object.scan_status = 'validated'
       AND object.deleted_at IS NULL
     LIMIT 1`,
    [fileId, userId],
  );
  const row = rows[0] as DatabaseRow | undefined;
  if (!row) throw new ExternalStorageError("This MaxForm file is not ready.", 404, "file_not_found");
  return row;
};

const mapLink = (row: DatabaseRow): ExternalStorageLink => ({
  id: text(row.id, 64),
  fileId: text(row.file_id, 64) || null,
  fileName: text(row.file_name, 255),
  connectionId: text(row.connection_id, 64) || null,
  provider: providerFromInput(row.provider),
  externalFileId: text(row.external_file_id, 2_000),
  externalFolderId: text(row.external_folder_id, 2_000),
  externalFileName: text(row.external_file_name, 255),
  externalUrl: safeExternalUrl(row.external_url),
  externalPath: text(row.external_path, 2_000),
  externalRevision: text(row.external_revision, 300),
  relationshipMode: text(row.relationship_mode, 40) as ExternalRelationshipMode,
  syncStatus: text(row.sync_status, 40),
  lastSyncAt: row.last_sync_at ? String(row.last_sync_at) : null,
  lastSuccessfulOperation: text(row.last_successful_operation, 100),
  lastError: text(row.last_error, 500),
  retryCount: numberValue(row.retry_count),
  createdAt: String(row.created_at || ""),
  updatedAt: String(row.updated_at || ""),
});

const mapOperation = (row: DatabaseRow): ExternalStorageOperation => ({
  id: text(row.id, 64),
  fileId: text(row.file_id, 64) || null,
  linkId: text(row.link_id, 64) || null,
  connectionId: text(row.connection_id, 64) || null,
  provider: providerFromInput(row.provider),
  operationType: text(row.operation_type, 60),
  status: text(row.status, 30),
  requestMetadata: jsonObject(row.request_metadata),
  resultMetadata: jsonObject(row.result_metadata),
  errorCode: text(row.error_code, 100),
  errorMessage: text(row.error_message, 500),
  retryCount: numberValue(row.retry_count),
  maxRetries: numberValue(row.max_retries),
  nextAttemptAt: row.next_attempt_at ? String(row.next_attempt_at) : null,
  createdAt: String(row.created_at || ""),
  updatedAt: String(row.updated_at || ""),
});

export async function getExternalStorageWorkspace(userId: string) {
  const [connections, links, operations, folders] = await Promise.all([
    database().query(
      `SELECT connection.id, connection.provider_key, connection.status,
              connection.reconnect_required, connection.external_account_name,
              connection.external_account_email, provider.name AS provider_name
       FROM integration_connections connection
       JOIN integration_providers provider ON provider.key = connection.provider_key
       WHERE connection.workspace_id = $1
         AND connection.provider_key IN ('google_workspace', 'dropbox')
       ORDER BY provider.sort_order, connection.updated_at DESC`,
      [userId],
    ),
    database().query(
      `SELECT link.*, file.name AS file_name
       FROM external_storage_links link
       LEFT JOIN workspace_files file ON file.id = link.file_id
       WHERE link.workspace_id = $1
       ORDER BY link.updated_at DESC
       LIMIT 250`,
      [userId],
    ),
    database().query(
      `SELECT * FROM external_storage_operations
       WHERE workspace_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [userId],
    ),
    database().query(
      `SELECT * FROM external_storage_folders
       WHERE workspace_id = $1
       ORDER BY updated_at DESC
       LIMIT 250`,
      [userId],
    ),
  ]);
  // Copy requests are durable database rows. If the process restarted after
  // the request returned, resume queued work when the Files view is opened;
  // claimOperation still makes this safe when several browser tabs poll at
  // the same time.
  const queuedCopyOperations = (operations as DatabaseRow[]).filter(
    (row) =>
      text(row.operation_type, 60) === "copy_to_external" &&
      text(row.status, 30) === "queued" &&
      (!row.next_attempt_at || Date.parse(String(row.next_attempt_at)) <= Date.now()),
  );
  if (queuedCopyOperations.length) {
    runCopyOperationsInBackground(userId, queuedCopyOperations.slice(0, 20));
  }
  return {
    connections: connections.map((row) => {
      const provider = externalProviderForKey((row as DatabaseRow).provider_key);
      return {
        id: text((row as DatabaseRow).id, 64),
        provider: provider || "dropbox",
        providerKey: text((row as DatabaseRow).provider_key, 40) as "google_workspace" | "dropbox",
        providerName: text((row as DatabaseRow).provider_name, 120) || (provider ? providerLabel(provider) : "External storage"),
        accountLabel: text((row as DatabaseRow).external_account_name, 255) || text((row as DatabaseRow).external_account_email, 320) || "Connected account",
        status: text((row as DatabaseRow).status, 40),
        reconnectRequired: (row as DatabaseRow).reconnect_required === true,
      } satisfies ExternalStorageConnection;
    }).filter((connection) => connection.providerKey === "google_workspace" || connection.providerKey === "dropbox"),
    links: links.map((row) => mapLink(row as DatabaseRow)),
    operations: operations.map((row) => mapOperation(row as DatabaseRow)),
    folders: folders.map((row) => ({
      id: text((row as DatabaseRow).id, 64),
      workspaceFolderId: text((row as DatabaseRow).workspace_folder_id, 64) || null,
      connectionId: text((row as DatabaseRow).connection_id, 64) || null,
      provider: providerFromInput((row as DatabaseRow).provider),
      externalParentFolderId: text((row as DatabaseRow).external_parent_folder_id, 2_000),
      externalFolderId: text((row as DatabaseRow).external_folder_id, 2_000),
      externalFolderName: text((row as DatabaseRow).external_folder_name, 255),
      externalPath: text((row as DatabaseRow).external_path, 2_000),
      externalUrl: safeExternalUrl((row as DatabaseRow).external_url),
    })),
  };
}

export async function listExternalStorageItems(
  userId: string,
  input: { connectionId: unknown; provider: unknown; parentId?: unknown; driveId?: unknown; search?: unknown; foldersOnly?: unknown },
) {
  const provider = providerFromInput(input.provider);
  const { row, connectionId } = await connectionFor(userId, input.connectionId, provider);
  await authorizeExternalAction(
    userId,
    connectionId,
    "file.read",
    "external_storage.list",
    { provider, foldersOnly: input.foldersOnly === true },
  );
  const token = await accessTokenFor(row, provider);
  const result = await providerCall(row, () => remoteList(provider, token, {
    parentId: text(input.parentId, 2_000),
    driveId: provider === "google_drive" ? text(input.driveId, 300) : "",
    search: text(input.search, 120),
    foldersOnly: input.foldersOnly === true,
  }));
  return { provider, connectionId, items: result.files, nextCursor: result.nextCursor };
}

export async function listExternalStorageDrives(
  userId: string,
  input: { connectionId: unknown; provider: unknown },
) {
  const provider = providerFromInput(input.provider);
  const { row, connectionId } = await connectionFor(userId, input.connectionId, provider);
  if (provider !== "google_drive") return { provider, drives: [] };
  await authorizeExternalAction(userId, connectionId, "folder.read", "external_storage.list_drives", { provider });
  const token = await accessTokenFor(row, provider);
  return { provider, drives: await providerCall(row, () => googleDrives(token)) };
}

const createExternalFolderMapping = async (
  userId: string,
  input: { connectionId: string; provider: ExternalStorageProvider; workspaceFolderId: string | null; name: string; parentId: string },
) => {
  const existing = input.workspaceFolderId
    ? await database().query(
        `SELECT * FROM external_storage_folders
         WHERE workspace_id = $1 AND connection_id = $2 AND provider = $3
           AND workspace_folder_id = $4
           AND external_parent_folder_id = $5
         LIMIT 1`,
        [userId, input.connectionId, input.provider, input.workspaceFolderId, input.parentId],
      )
    : [];
  if (existing[0]) return existing[0] as DatabaseRow;
  const { row } = await connectionFor(userId, input.connectionId, input.provider);
  await authorizeExternalAction(
    userId,
    input.connectionId,
    "folder.create",
    "external_storage.create_folder",
    { provider: input.provider, workspaceFolderId: input.workspaceFolderId },
  );
  const token = await accessTokenFor(row, input.provider);
  const remote = await providerCall(row, () => remoteCreateFolder(input.provider, token, input.name, input.parentId));
  const rows = await database().query(
    `INSERT INTO external_storage_folders (
       workspace_id, workspace_folder_id, connection_id, provider,
       external_parent_folder_id, external_folder_id, external_folder_name,
       external_path, external_url,
       created_at, updated_at
     ) VALUES ($1, NULLIF($2, '')::uuid, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
     ON CONFLICT (workspace_id, connection_id, provider, external_folder_id)
     DO UPDATE SET external_folder_name = EXCLUDED.external_folder_name,
                   external_path = EXCLUDED.external_path,
                   external_url = EXCLUDED.external_url,
                   updated_at = NOW()
     RETURNING *`,
    [
      userId,
      input.workspaceFolderId || "",
      input.connectionId,
      input.provider,
      input.parentId,
      remote.id,
      remote.name,
      remote.path,
      remote.url,
    ],
  );
  return (rows[0] || remote) as DatabaseRow;
};

// The `input` shapes below are optional throughout on purpose: these are
// reached straight from a request body, every field arrives as `unknown`, and
// each function's own validators are what decide whether a value is usable.
// Declaring the keys as required only made the body type-incompatible without
// adding a single guarantee.
export async function createExternalStorageFolder(
  userId: string,
  input: { connectionId?: unknown; provider?: unknown; name?: unknown; parentId?: unknown },
) {
  const provider = providerFromInput(input.provider);
  const connectionId = connectionIdFromInput(input.connectionId);
  const name = sanitizeStorageFileName(text(input.name, 160), "MaxForm");
  const { row } = await connectionFor(userId, connectionId, provider);
  await authorizeExternalAction(userId, connectionId, "folder.create", "external_storage.create_folder", { provider });
  const token = await accessTokenFor(row, provider);
  const folder = await providerCall(row, () => remoteCreateFolder(provider, token, name, text(input.parentId, 2_000)));
  await database().query(
    `INSERT INTO external_storage_folders (
       workspace_id, connection_id, provider, external_folder_id,
       external_folder_name, external_path, external_url, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
     ON CONFLICT (workspace_id, connection_id, provider, external_folder_id)
     DO UPDATE SET external_folder_name = EXCLUDED.external_folder_name,
                   external_path = EXCLUDED.external_path,
                   external_url = EXCLUDED.external_url,
                   updated_at = NOW()`,
    [userId, connectionId, provider, folder.id, folder.name, folder.path, folder.url],
  );
  return { folder };
}

const operationMetadata = (value: unknown) => jsonObject(value);

const operationFor = async (
  userId: string,
  input: {
    idempotencyKey: string;
    fileId?: string | null;
    connectionId: string;
    provider: ExternalStorageProvider;
    operationType: string;
    requestMetadata: Record<string, unknown>;
  },
) => {
  const key = text(input.idempotencyKey, 500);
  const rows = await database().query(
    `INSERT INTO external_storage_operations (
       workspace_id, file_id, connection_id, provider, operation_type,
       status, idempotency_key, request_metadata, next_attempt_at,
       created_at, updated_at
     ) VALUES ($1, NULLIF($2, '')::uuid, $3, $4, $5, 'queued', $6, $7::jsonb, NOW(), NOW(), NOW())
     ON CONFLICT (workspace_id, idempotency_key)
     DO UPDATE SET updated_at = external_storage_operations.updated_at
     RETURNING *`,
    [
      userId,
      input.fileId || "",
      input.connectionId,
      input.provider,
      input.operationType,
      key,
      JSON.stringify(input.requestMetadata),
    ],
  );
  return rows[0] as DatabaseRow;
};

const claimOperation = async (userId: string, operationId: string) => {
  const rows = await database().query(
    `UPDATE external_storage_operations
     SET status = 'running', retry_count = retry_count + 1,
         started_at = NOW(), updated_at = NOW(), error_code = '', error_message = ''
     WHERE id = $1 AND workspace_id = $2
       AND status IN ('queued', 'failed')
       AND (status = 'queued' OR retry_count < max_retries)
     RETURNING *`,
    [operationId, userId],
  );
  return rows[0] as DatabaseRow | undefined;
};

const finishOperation = async (
  userId: string,
  operationId: string,
  result: { linkId?: string; resultMetadata?: Record<string, unknown> },
) => {
  const rows = await database().query(
    `UPDATE external_storage_operations
     SET status = 'succeeded', link_id = COALESCE(NULLIF($3, '')::uuid, link_id),
         result_metadata = $4::jsonb, completed_at = NOW(), next_attempt_at = NULL,
         updated_at = NOW()
     WHERE id = $1 AND workspace_id = $2
     RETURNING *`,
    [operationId, userId, result.linkId || "", JSON.stringify(result.resultMetadata || {})],
  );
  return rows[0] as DatabaseRow;
};

const failOperation = async (
  userId: string,
  operationId: string,
  error: unknown,
) => {
  const message = error instanceof ExternalStorageError ? error.message : "The external operation failed. You can retry it.";
  const code = error instanceof ExternalStorageError ? error.code : "provider_request_failed";
  const rows = await database().query(
    `UPDATE external_storage_operations
     SET status = 'failed', error_code = $3, error_message = $4,
         next_attempt_at = NOW() + LEAST(60, GREATEST(1, retry_count * 2)) * INTERVAL '1 minute',
         updated_at = NOW()
     WHERE id = $1 AND workspace_id = $2
     RETURNING *`,
    [operationId, userId, code, message],
  );
  return rows[0] as DatabaseRow;
};

const linkForRemote = async (
  userId: string,
  input: {
    fileId: string | null;
    connectionId: string;
    provider: ExternalStorageProvider;
    remote: ExternalFile;
    revision?: string;
    mode: ExternalRelationshipMode;
    operation: string;
    error?: string;
  },
) => {
  const rows = await database().query(
    `INSERT INTO external_storage_links (
       workspace_id, file_id, connection_id, provider, external_file_id,
       external_folder_id, external_file_name, external_url, external_path,
       external_revision, relationship_mode, sync_status, last_sync_at,
       last_successful_operation, last_error, retry_count, updated_at
     ) VALUES ($1, NULLIF($2, '')::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11,
               $12, NOW(), $13, $14, 0, NOW())
     ON CONFLICT (workspace_id, connection_id, provider, external_file_id)
     DO UPDATE SET file_id = COALESCE(EXCLUDED.file_id, external_storage_links.file_id),
                   external_folder_id = EXCLUDED.external_folder_id,
                   external_file_name = EXCLUDED.external_file_name,
                   external_url = EXCLUDED.external_url,
                   external_path = EXCLUDED.external_path,
                   external_revision = EXCLUDED.external_revision,
                   relationship_mode = EXCLUDED.relationship_mode,
                   sync_status = EXCLUDED.sync_status,
                   last_sync_at = EXCLUDED.last_sync_at,
                   last_successful_operation = EXCLUDED.last_successful_operation,
                   last_error = EXCLUDED.last_error,
                   updated_at = NOW()
     RETURNING *`,
    [
      userId,
      input.fileId || "",
      input.connectionId,
      input.provider,
      input.remote.id,
      input.remote.parentId,
      input.remote.name,
      input.remote.url,
      input.remote.path,
      text(input.revision, 300),
      input.mode,
      input.error ? "failed" : "active",
      input.operation,
      text(input.error, 500),
    ],
  );
  return rows[0] as DatabaseRow;
};

const copyOperationRequest = (row: DatabaseRow) => operationMetadata(row.request_metadata);

const executeCopyOperation = async (userId: string, operation: DatabaseRow) => {
  const request = copyOperationRequest(operation);
  const provider = providerFromInput(operation.provider);
  const file = await internalFileFor(userId, text(operation.file_id, 64));
  const connectionId = text(operation.connection_id, 64);
  const { row } = await connectionFor(userId, connectionId, provider);
  await authorizeExternalAction(userId, connectionId, "file.export", "external_storage.copy_file", { provider, fileId: text(file.id, 64), retry: true });
  const token = await accessTokenFor(row, provider);
  const body = await readInternalFile(file);
  const uploaded = await providerCall(row, () => remoteUpload(provider, token, {
    name: text(file.original_file_name, 255) || text(file.name, 255),
    mimeType: normalizeMimeType(file.mime_type),
    body,
    parentId: text(request.targetFolderId, 2_000),
    operationId: text(operation.id, 64),
  }));
  const link = await linkForRemote(userId, {
    fileId: text(file.id, 64),
    connectionId: text(operation.connection_id, 64),
    provider,
    remote: uploaded.file,
    revision: uploaded.revision,
    mode: "copied_to_external",
    operation: "copy_to_external",
  });
  return { link, remote: uploaded.file, revision: uploaded.revision };
};

const runCopyOperation = async (userId: string, operation: DatabaseRow) => {
  const claimed = await claimOperation(userId, text(operation.id, 64));
  if (!claimed) return operation;
  try {
    const result = await executeCopyOperation(userId, claimed);
    return finishOperation(userId, text(claimed.id, 64), {
      linkId: text(result.link.id, 64),
      resultMetadata: {
        externalFileId: result.remote.id,
        externalUrl: result.remote.url,
        externalFileName: result.remote.name,
      },
    });
  } catch (error) {
    return failOperation(userId, text(claimed.id, 64), error);
  }
};

const runCopyOperationsInBackground = (
  userId: string,
  operations: DatabaseRow[],
) => {
  queueMicrotask(() => {
    void (async () => {
      for (const operation of operations) {
        await runCopyOperation(userId, operation);
      }
    })().catch(() => undefined);
  });
};

export async function copyWorkspaceFileToExternal(
  userId: string,
  input: { fileId?: unknown; connectionId?: unknown; provider?: unknown; targetFolderId?: unknown },
) {
  const provider = providerFromInput(input.provider);
  const connectionId = connectionIdFromInput(input.connectionId);
  await connectionFor(userId, connectionId, provider);
  await authorizeExternalAction(userId, connectionId, "file.export", "external_storage.copy_file", { provider, fileId: text(input.fileId, 64) });
  const file = await internalFileFor(userId, input.fileId);
  const targetFolderId = text(input.targetFolderId, 2_000);
  const checksum = text(file.checksum_sha256, 300) || text(file.updated_at, 80);
  const operation = await operationFor(userId, {
    idempotencyKey: `copy:${connectionId}:${provider}:${text(file.id, 64)}:${targetFolderId}:${checksum}`,
    fileId: text(file.id, 64),
    connectionId,
    provider,
    operationType: "copy_to_external",
    requestMetadata: { targetFolderId },
  });
  const result = await runCopyOperation(userId, operation);
  return { operation: mapOperation(result), link: result.link_id ? mapLink((await database().query("SELECT link.*, file.name AS file_name FROM external_storage_links link LEFT JOIN workspace_files file ON file.id = link.file_id WHERE link.id = $1 LIMIT 1", [String(result.link_id)]))[0] as DatabaseRow) : null };
}

const folderDepth = (folder: DatabaseRow, all: DatabaseRow[]) => {
  let depth = 0;
  let parent = text(folder.parent_id, 64);
  const visited = new Set<string>();
  while (parent && !visited.has(parent) && depth < 100) {
    visited.add(parent);
    const item = all.find((candidate) => text(candidate.id, 64) === parent);
    if (!item) break;
    depth += 1;
    parent = text(item.parent_id, 64);
  }
  return depth;
};

const externalFolderMapping = async (
  userId: string,
  connectionId: string,
  provider: ExternalStorageProvider,
  targetFolderId: string,
) => {
  const folders = (await database().query(
    `SELECT id, parent_id, name FROM workspace_folders WHERE user_id = $1 ORDER BY name`,
    [userId],
  )) as DatabaseRow[];
  const mapping = new Map<string, string>();
  for (const folder of [...folders].sort((a, b) => folderDepth(a, folders) - folderDepth(b, folders))) {
    const parentId = text(folder.parent_id, 64);
    const externalParent = parentId ? mapping.get(parentId) || targetFolderId : targetFolderId;
    const saved = await createExternalFolderMapping(userId, {
      connectionId,
      provider,
      workspaceFolderId: text(folder.id, 64),
      name: text(folder.name, 160) || "Folder",
      parentId: externalParent,
    });
    mapping.set(text(folder.id, 64), text(saved.external_folder_id || saved.id, 2_000));
  }
  return mapping;
};

export async function copyWorkspaceFilesToExternal(
  userId: string,
  input: { fileIds?: unknown; connectionId?: unknown; provider?: unknown; targetFolderId?: unknown; preserveFolders?: unknown },
) {
  const provider = providerFromInput(input.provider);
  const connectionId = connectionIdFromInput(input.connectionId);
  await connectionFor(userId, connectionId, provider);
  await authorizeExternalAction(userId, connectionId, "file.export", "external_storage.copy_library", { provider });
  const requestedIds = Array.isArray(input.fileIds)
    ? Array.from(new Set(input.fileIds.map((value) => text(value, 64)).filter(isUuid)))
    : [];
  if (Array.isArray(input.fileIds) && requestedIds.length !== input.fileIds.length) {
    throw new ExternalStorageError("One or more selected files are invalid.", 422, "files_invalid");
  }
  if (requestedIds.length > 10_000) throw new ExternalStorageError("Select no more than 10,000 files at a time.", 413, "too_many_files");
  const files = await database().query(
    `SELECT file.id, file.folder_id, file.updated_at,
            COALESCE(file.checksum_sha256, object.checksum_sha256) AS checksum_sha256
     FROM workspace_files file
     JOIN storage_objects object ON object.id = file.storage_object_id
     WHERE file.user_id = $1 AND file.deleted_at IS NULL
       AND object.deleted_at IS NULL
       ${requestedIds.length ? "AND file.id = ANY($2::uuid[])" : ""}
     ORDER BY file.created_at, file.id`,
    requestedIds.length ? [userId, requestedIds] : [userId],
  );
  const preserveFolders = input.preserveFolders === true;
  const targetFolderId = text(input.targetFolderId, 2_000);
  const mapping = preserveFolders ? await externalFolderMapping(userId, connectionId, provider, targetFolderId) : new Map<string, string>();
  const results: ExternalStorageOperation[] = [];
  const entries = files as DatabaseRow[];
  if (requestedIds.length && entries.length !== requestedIds.length) {
    throw new ExternalStorageError("One or more selected files are no longer available.", 404, "files_not_found");
  }
  const queuedOperations: DatabaseRow[] = [];
  for (const file of entries) {
    const fileId = text(file.id, 64);
    const destination = preserveFolders ? mapping.get(text(file.folder_id, 64)) || targetFolderId : targetFolderId;
    const operation = await operationFor(userId, {
      idempotencyKey: `copy:${connectionId}:${provider}:${fileId}:${destination}:${text(file.checksum_sha256, 300) || text(file.updated_at, 80)}`,
      fileId,
      connectionId,
      provider,
      operationType: "copy_to_external",
      requestMetadata: { targetFolderId: destination },
    });
    results.push(mapOperation(operation));
    if (text(operation.status, 30) !== "succeeded") queuedOperations.push(operation);
  }
  runCopyOperationsInBackground(userId, queuedOperations);
  return {
    provider,
    connectionId,
    total: entries.length,
    succeeded: results.filter((operation) => operation.status === "succeeded").length,
    failed: results.filter((operation) => operation.status === "failed").length,
    queued: queuedOperations.length,
    operationCount: results.length,
    operations: results.slice(0, 100),
    foldersPreserved: preserveFolders,
  };
}

export async function importExternalFileToMaxForm(
  userId: string,
  input: { externalFileId?: unknown; connectionId?: unknown; provider?: unknown },
) {
  const provider = providerFromInput(input.provider);
  const connectionId = connectionIdFromInput(input.connectionId);
  const externalFileId = text(input.externalFileId, 2_000);
  if (!externalFileId) throw new ExternalStorageError("Choose an external file.", 422, "external_file_required");
  await connectionFor(userId, connectionId, provider);
  await authorizeExternalAction(userId, connectionId, "file.import", "external_storage.import_file", { provider, externalFileId });
  const operation = await operationFor(userId, {
    idempotencyKey: `import:${connectionId}:${provider}:${externalFileId}`,
    connectionId,
    provider,
    operationType: "import_to_maxform",
    requestMetadata: { externalFileId },
  });
  const status = text(operation.status, 30);
  if (status === "succeeded" && text(operation.result_metadata, 1)) {
    return { operation: mapOperation(operation), fileId: text(jsonObject(operation.result_metadata).fileId, 64) };
  }
  const claimed = await claimOperation(userId, text(operation.id, 64));
  if (!claimed) return { operation: mapOperation(operation), fileId: text(jsonObject(operation.result_metadata).fileId, 64) || null };
  try {
    const { row } = await connectionFor(userId, connectionId, provider);
    const token = await accessTokenFor(row, provider);
    const remote = await providerCall(row, () => remoteFile(provider, token, externalFileId));
    const downloaded = await providerCall(row, () => remoteDownload(provider, token, remote));
    const safeName = sanitizeStorageFileName(downloaded.fileName || remote.name, "Imported file");
    const mimeType = normalizeMimeType(downloaded.mimeType || remote.mimeType);
    validateStorageUpload({ purpose: "workspace_file", visibility: "private", mimeType, sizeBytes: downloaded.body.length });
    const checksum = sha256Hex(downloaded.body);
    const key = createStorageObjectKey({ userId, purpose: "workspace_file", sourceId: null, fileName: safeName });
    const location = resolveStorageLocation("private", key);
    const uploaded = await putStorageObject({
      location,
      fileName: safeName,
      mimeType,
      body: downloaded.body,
      sizeBytes: downloaded.body.length,
      metadata: { purpose: "workspace_file", externalProvider: provider, externalFileId },
    });
    const rows = await database().query(
      `WITH object AS (
         INSERT INTO storage_objects (
           id, user_id, provider, bucket_name, object_key, file_name, mime_type,
           size_bytes, visibility, purpose, etag, checksum_sha256, status,
           scan_status, metadata, verified_at, created_at, updated_at
         ) VALUES (gen_random_uuid(), $1, 'r2', $2, $3, $4, $5, $6, 'private',
                   'workspace_file', NULLIF($7, ''), $8, 'ready', 'validated',
                   $9::jsonb, NOW(), NOW(), NOW())
         RETURNING id
       )
       INSERT INTO workspace_files (
         user_id, name, original_file_name, file_extension, mime_type, size_bytes,
         storage_key, storage_object_id, storage_provider, etag, checksum_sha256,
         source_type, source_label, uploaded_by, scan_status
       )
       SELECT $1, $4, $4, CASE WHEN POSITION('.' IN reverse($4)) > 0
                              THEN lower(right($4, POSITION('.' IN reverse($4)) - 1))
                              ELSE '' END,
              $5, $6, $3, object.id, 'r2', NULLIF($7, ''), $8,
              'import', $10, $1, 'validated'
       FROM object
       RETURNING id`,
      [
        userId,
        location.bucket,
        location.key,
        safeName,
        mimeType,
        downloaded.body.length,
        uploaded.etag,
        checksum,
        JSON.stringify({ externalProvider: provider, externalFileId, externalRevision: text((remote as ExternalFile & { revision?: string }).revision, 300) }),
        `Imported from ${providerLabel(provider)}`,
      ],
    );
    const fileId = text((rows[0] as DatabaseRow | undefined)?.id, 64);
    const link = await linkForRemote(userId, {
      fileId,
      connectionId,
      provider,
      remote,
      revision: text((remote as ExternalFile & { revision?: string }).revision, 300),
      mode: "imported_to_maxform",
      operation: "import_to_maxform",
    });
    const finished = await finishOperation(userId, text(claimed.id, 64), {
      linkId: text(link.id, 64),
      resultMetadata: { fileId, externalFileId, externalUrl: remote.url },
    });
    return { operation: mapOperation(finished), fileId };
  } catch (error) {
    const failed = await failOperation(userId, text(claimed.id, 64), error);
    return { operation: mapOperation(failed), fileId: null };
  }
}

export async function linkExternalFile(
  userId: string,
  input: { externalFileId?: unknown; connectionId?: unknown; provider?: unknown; fileId?: unknown },
) {
  const provider = providerFromInput(input.provider);
  const connectionId = connectionIdFromInput(input.connectionId);
  const externalFileId = text(input.externalFileId, 2_000);
  if (!externalFileId) throw new ExternalStorageError("Choose an external file.", 422, "external_file_required");
  const { row } = await connectionFor(userId, connectionId, provider);
  await authorizeExternalAction(userId, connectionId, "file.read", "external_storage.link_file", { provider, externalFileId });
  const token = await accessTokenFor(row, provider);
  const remote = await providerCall(row, () => remoteFile(provider, token, externalFileId));
  const fileId = text(input.fileId, 64);
  if (fileId) await internalFileFor(userId, fileId);
  const link = await linkForRemote(userId, {
    fileId: fileId || null,
    connectionId,
    provider,
    remote,
    revision: text((remote as ExternalFile & { revision?: string }).revision, 300),
    mode: "linked_external",
    operation: "link_external",
  });
  return { link: mapLink({ ...link, file_name: fileId ? text((await internalFileFor(userId, fileId)).name, 255) : "" }) };
}

export async function unlinkExternalFile(userId: string, linkIdValue: unknown) {
  const linkId = text(linkIdValue, 64);
  if (!isUuid(linkId)) throw new ExternalStorageError("Choose a valid external link.", 422, "link_invalid");
  const rows = await database().query(
    `DELETE FROM external_storage_links WHERE id = $1 AND workspace_id = $2 RETURNING id`,
    [linkId, userId],
  );
  if (!rows[0]) throw new ExternalStorageError("That external link was not found.", 404, "link_not_found");
  return { unlinked: true };
}

export async function retryExternalStorageOperation(
  userId: string,
  operationIdValue: unknown,
  replacementConnectionIdValue?: unknown,
) {
  const operationId = text(operationIdValue, 64);
  if (!isUuid(operationId)) throw new ExternalStorageError("Choose a valid external operation.", 422, "operation_invalid");
  const rows = await database().query(
    `SELECT * FROM external_storage_operations WHERE id = $1 AND workspace_id = $2 LIMIT 1`,
    [operationId, userId],
  );
  const operation = rows[0] as DatabaseRow | undefined;
  if (!operation) throw new ExternalStorageError("That operation was not found.", 404, "operation_not_found");
  if (text(operation.operation_type, 60) !== "copy_to_external") {
    throw new ExternalStorageError("This operation cannot be retried from Files yet.", 409, "operation_not_retryable");
  }
  const replacementConnectionId = text(replacementConnectionIdValue, 64);
  if (replacementConnectionId) {
    const provider = providerFromInput(operation.provider);
    await connectionFor(userId, replacementConnectionId, provider);
    await authorizeExternalAction(userId, replacementConnectionId, "file.export", "external_storage.copy_file_retry", { provider, operationId });
    await database().query(
      `UPDATE external_storage_operations
       SET connection_id = $1, updated_at = NOW()
       WHERE id = $2 AND workspace_id = $3`,
      [replacementConnectionId, operationId, userId],
    );
    operation.connection_id = replacementConnectionId;
  }
  if (!text(operation.connection_id, 64)) {
    throw new ExternalStorageError("Reconnect the provider before retrying this operation.", 409, "provider_reconnect_required");
  }
  const result = await runCopyOperation(userId, operation);
  return { operation: mapOperation(result) };
}

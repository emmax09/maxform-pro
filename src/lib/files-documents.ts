import { dataUrlToBlob, uploadFileToStorage } from "@/lib/storage";

export type FilesView =
  | "all"
  | "shared"
  | "trash"
  | "storage"
  | "external"
  | "settings";
export type FileTypeFilter =
  | ""
  | "signature"
  | "image"
  | "pdf"
  | "document"
  | "video"
  | "other";
export type FileSource =
  | "form_upload"
  | "event_upload"
  | "document"
  | "manual"
  | "import";

export type WorkspaceFolder = {
  id: string;
  parentId: string | null;
  name: string;
  createdAt: string;
};

export type WorkspaceFile = {
  id: string;
  storageObjectId: string | null;
  folderId: string | null;
  name: string;
  originalFileName?: string;
  fileExtension?: string;
  mimeType: string;
  sizeBytes: number;
  sourceType: FileSource;
  sourceId: string | null;
  sourceLabel: string;
  fileKind: "file" | "signature";
  submissionId: string | null;
  collectionType: "form" | "event" | null;
  collectionId: string | null;
  collectionName: string;
  clientName: string;
  clientEmail: string;
  checksumSha256?: string;
  tags: string[];
  scanStatus: "pending" | "validated" | "quarantined";
  deletedAt: string | null;
  purgeAfter: string | null;
  createdAt: string;
  updatedAt: string;
  shared: boolean;
};

export type ExternalStorageProvider = "google_drive" | "dropbox";

export type ExternalStorageConnection = {
  id: string;
  provider: ExternalStorageProvider;
  providerKey: "google_workspace" | "dropbox";
  providerName: string;
  accountLabel: string;
  status: string;
  reconnectRequired: boolean;
};

export type ExternalStorageItem = {
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
  relationshipMode:
    | "copied_to_external"
    | "imported_to_maxform"
    | "linked_external"
    | "synchronized";
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

export type ExternalStorageFolderMapping = {
  id: string;
  workspaceFolderId: string | null;
  connectionId: string | null;
  provider: ExternalStorageProvider;
  externalParentFolderId: string;
  externalFolderId: string;
  externalFolderName: string;
  externalPath: string;
  externalUrl: string;
};

export type ExternalStorageWorkspace = {
  connections: ExternalStorageConnection[];
  links: ExternalStorageLink[];
  operations: ExternalStorageOperation[];
  folders: ExternalStorageFolderMapping[];
};

export type WorkspaceFileCollection = {
  id: string;
  sourceType: "form" | "event";
  sourceId: string;
  name: string;
  fileCount: number;
  sizeBytes: number;
  submissionCount: number;
  clients: string[];
  latestAt: string;
  files: WorkspaceFile[];
};

export type FileSettings = {
  defaultView: "grid" | "list";
  retentionDays: number;
  shareExpiryDays: number;
  groupBySource: boolean;
};

export type FilesWorkspace = {
  folders: WorkspaceFolder[];
  files: WorkspaceFile[];
  collections: WorkspaceFileCollection[];
  settings: FileSettings;
  counts: { active: number; shared: number; trash: number };
  usage: {
    usedBytes: number;
    quotaBytes: number;
    fileCount: number;
    sources: Array<{
      sourceType: FileSource;
      bytes: number;
      count: number;
    }>;
  };
};

export type DocumentTemplate = {
  id: string;
  name: string;
  description: string;
  sourceType: "uploaded_pdf" | "block_built";
  baseFileId: string | null;
  baseFileName: string;
  blocks: Array<Record<string, unknown>>;
  fieldPositions: Array<Record<string, unknown>>;
  signerRoles: Array<{ role: "signer" | "approver" | "cc"; order: number }>;
  defaultSigningOrder: "sequential" | "parallel";
  createdAt: string;
  updatedAt: string;
};

export type DocumentSigner = {
  id: string;
  role: "signer" | "approver" | "cc";
  name: string;
  email: string;
  orderIndex: number;
  status: "pending" | "viewed" | "signed" | "approved" | "declined";
  signedAt: string | null;
  viewedAt: string | null;
};

export type DocumentEvent = {
  id: string;
  eventType:
    | "created"
    | "sent"
    | "viewed"
    | "signed"
    | "approved"
    | "declined"
    | "reminded"
    | "completed"
    | "voided";
  actorName: string;
  actorEmail: string;
  createdAt: string;
};

export type WorkspaceDocument = {
  id: string;
  templateId: string | null;
  templateName: string;
  title: string;
  status:
    | "draft"
    | "sent"
    | "viewed"
    | "partially_signed"
    | "completed"
    | "declined"
    | "voided"
    | "expired";
  signingOrder: "sequential" | "parallel";
  mergeValues: Record<string, unknown>;
  signedFileId: string | null;
  certificateFileId: string | null;
  documentHash: string;
  sentAt: string | null;
  viewedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  signers: DocumentSigner[];
  events: DocumentEvent[];
};

export type DocumentSettings = {
  defaultSigningOrder: "sequential" | "parallel";
  reminderDays: number;
  expiryDays: number;
  identityVerification: boolean;
  includeWorkspaceBranding: boolean;
  disclosureText: string;
};

export type DocumentsWorkspace = {
  templates: DocumentTemplate[];
  documents: WorkspaceDocument[];
  settings: DocumentSettings;
  counts: { total: number; awaiting: number; completed: number };
};

export type SigningSession =
  | {
      completed: true;
      signer: { name: string; role: string };
      document: { title: string };
    }
  | {
      completed: false;
      signer: { name: string; email: string; role: string };
      document: {
        title: string;
        templateName: string;
        description: string;
        sourceType: "uploaded_pdf" | "block_built";
        blocks: Array<Record<string, unknown>>;
        baseFile: {
          name: string;
          mimeType: string;
          url: string;
        } | null;
      };
      disclosure: string;
      includeWorkspaceBranding: boolean;
    };

const token = () => localStorage.getItem("access_token") || "";

const request = async <T>(
  module: "files" | "documents",
  action: string,
  options: {
    body?: Record<string, unknown>;
    query?: Record<string, string>;
    authenticated?: boolean;
  } = {},
) => {
  const params = new URLSearchParams({
    module,
    action,
    ...(options.query || {}),
  });
  const authenticated = options.authenticated !== false;
  const accessToken = authenticated ? token() : "";
  if (authenticated && !accessToken) {
    throw new Error("Sign in again to continue.");
  }
  const response = await fetch(`/api/workspace/content?${params.toString()}`, {
    method: options.body ? "POST" : "GET",
    headers: {
      Accept: "application/json",
      ...(authenticated ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const value = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok) {
    throw new Error(
      value.error || "Files and documents are temporarily unavailable.",
    );
  }
  return value;
};

export const getFilesWorkspace = (
  filters: {
    view?: FilesView;
    folderId?: string | null;
    search?: string;
    type?: FileTypeFilter;
    source?: FileSource | "";
    /** Narrows the workspace to one project's files. */
    projectId?: string | null;
  } = {},
) =>
  request<FilesWorkspace>("files", "workspace", {
    query: {
      view: filters.view || "all",
      folderId: filters.folderId || "",
      search: filters.search || "",
      type: filters.type || "",
      source: filters.source || "",
      projectId: filters.projectId || "",
    },
  });

export const getExternalStorageWorkspace = () =>
  request<ExternalStorageWorkspace>("files", "external-workspace");

export const listExternalStorageItems = (input: {
  connectionId: string;
  provider: ExternalStorageProvider;
  parentId?: string | null;
  driveId?: string | null;
  search?: string;
  foldersOnly?: boolean;
}) =>
  request<{
      provider: ExternalStorageProvider;
      connectionId: string;
      items: ExternalStorageItem[];
      nextCursor: string | null;
  }>("files", "external-items", {
    query: {
      connectionId: input.connectionId,
      provider: input.provider,
      parentId: input.parentId || "",
      driveId: input.driveId || "",
      search: input.search || "",
      foldersOnly: input.foldersOnly ? "true" : "false",
    },
  });

export const listExternalStorageDrives = (input: {
  connectionId: string;
  provider: ExternalStorageProvider;
}) =>
  request<{
    provider: ExternalStorageProvider;
    drives: Array<{ id: string; name: string }>;
  }>(
    "files",
    "external-drives",
    { query: input },
  );

export const createExternalStorageFolder = (input: {
  connectionId: string;
  provider: ExternalStorageProvider;
  name: string;
  parentId?: string | null;
}) =>
  request<{ folder: ExternalStorageItem }>("files", "external-folder", {
    body: input,
  });

export const copyWorkspaceFileToExternal = (input: {
  fileId: string;
  connectionId: string;
  provider: ExternalStorageProvider;
  targetFolderId?: string | null;
}) =>
  request<{
    operation: ExternalStorageOperation;
    link: ExternalStorageLink | null;
  }>("files", "external-copy", { body: input });

export const copyWorkspaceFilesToExternal = (input: {
  fileIds?: string[];
  connectionId: string;
  provider: ExternalStorageProvider;
  targetFolderId?: string | null;
  preserveFolders?: boolean;
}) =>
  request<{
    provider: ExternalStorageProvider;
    connectionId: string;
    total: number;
    succeeded: number;
    failed: number;
    queued: number;
    operationCount: number;
    foldersPreserved: boolean;
    operations: ExternalStorageOperation[];
  }>("files", "external-copy-all", { body: input });

export const importExternalFileToMaxForm = (input: {
  externalFileId: string;
  connectionId: string;
  provider: ExternalStorageProvider;
}) =>
  request<{ operation: ExternalStorageOperation; fileId: string | null }>(
    "files",
    "external-import",
    { body: input },
  );

export const linkExternalFile = (input: {
  externalFileId: string;
  connectionId: string;
  provider: ExternalStorageProvider;
  fileId?: string | null;
}) =>
  request<{ link: ExternalStorageLink }>("files", "external-link", {
    body: input,
  });

export const unlinkExternalFile = (linkId: string) =>
  request<{ unlinked: true }>("files", "external-unlink", {
    body: { linkId },
  });

export const retryExternalStorageOperation = (input: {
  operationId: string;
  connectionId?: string | null;
}) =>
  request<{ operation: ExternalStorageOperation }>("files", "external-retry", {
    body: input,
  });

export const createWorkspaceFolder = (input: {
  name: string;
  parentId?: string | null;
}) =>
  request<{ folder: WorkspaceFolder }>("files", "folder", {
    body: input,
  });

export const uploadWorkspaceFile = async (
  file: File,
  folderId?: string | null,
  options: {
    purpose?: "workspace_file" | "document_template" | "crm_attachment";
    sourceId?: string | null;
    onProgress?: (percent: number) => void;
  } = {},
) => {
  const stored = await uploadFileToStorage(file, {
    purpose: options.purpose || "workspace_file",
    sourceId: options.sourceId,
    visibility: "private",
    onProgress: options.onProgress,
  });
  return request<{ file: WorkspaceFile }>("files", "upload", {
    body: {
      folderId: folderId || null,
      storageObjectId: stored.id,
    },
  });
};

export type WorkspaceFileContent = {
  contentData: string;
  /** Branded, short-lived URL on the app's own domain for inline preview. */
  url: string;
  /** Same link with an attachment disposition, for saving the file. */
  downloadUrl: string;
  file: WorkspaceFile;
};

export const getWorkspaceFileContent = (id: string) =>
  request<WorkspaceFileContent>("files", "content", {
    query: { id },
  });

export const renameWorkspaceFile = (id: string, name: string) =>
  request<{ updated: true }>("files", "rename", {
    body: { id, name },
  });

export const moveWorkspaceFile = (
  id: string,
  folderId: string | null,
) =>
  request<{ updated: true }>("files", "move", {
    body: { id, folderId },
  });

export const bulkUpdateWorkspaceFiles = (input: {
  ids: string[];
  operation: "move" | "trash" | "restore";
  folderId?: string | null;
}) =>
  request<{ affected: number; operation: "move" | "trash" | "restore" }>(
    "files",
    "bulk",
    { body: input },
  );

export const trashWorkspaceFile = (id: string) =>
  request<{ deleted: true }>("files", "trash", { body: { id } });

export const restoreWorkspaceFile = (id: string) =>
  request<{ restored: true }>("files", "restore", { body: { id } });

export const shareWorkspaceFile = (id: string, expiryDays?: number) =>
  request<{ url: string; expiresInDays: number }>("files", "share", {
    body: {
      id,
      ...(expiryDays ? { expiryDays } : {}),
    },
  });

export const clearWorkspaceStorage = (
  scope: "trash" | "manual" | "all",
) =>
  request<{ affected: number; bytes: number; permanent: boolean }>(
    "files",
    "clear-storage",
    { body: { scope } },
  );

export const saveFileSettings = (settings: FileSettings) =>
  request<{ settings: FileSettings }>("files", "settings", {
    body: settings,
  });

const saveBlob = (blob: Blob, fileName: string) => {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoked on the next frame so Safari has time to start the save.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
};

/**
 * Saves a stored file to disk. The bytes are pulled down first so the browser
 * always writes a file instead of navigating to (or opening a tab for) the
 * storage URL, which is what happens when an `download` anchor points at a
 * cross-origin or `Content-Disposition: inline` response.
 */
export const downloadStoredFile = async (
  url: string,
  fileName: string,
) => {
  if (!url) throw new Error("This file is not ready to download yet.");
  if (url.startsWith("data:")) {
    saveBlob(dataUrlToBlob(url), fileName);
    return;
  }
  const response = await fetch(url, { credentials: "omit" });
  if (!response.ok) {
    throw new Error("This file could not be downloaded.");
  }
  saveBlob(await response.blob(), fileName);
};

const downloadFileResponse = async (
  response: Response,
  fallbackName: string,
) => {
  if (!response.ok) {
    const value = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(value.error || "This export could not be created.");
  }
  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") || "";
  const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plainName = disposition.match(/filename="([^"]+)"/i)?.[1];
  const fileName =
    (encodedName ? decodeURIComponent(encodedName) : plainName) ||
    fallbackName;
  saveBlob(blob, fileName);
};

export const exportWorkspaceCollection = async (
  sourceType: "form" | "event",
  sourceId: string,
  fallbackName: string,
) => {
  const accessToken = token();
  if (!accessToken) throw new Error("Sign in again to continue.");
  const params = new URLSearchParams({
    module: "files",
    action: "export-source",
    sourceType,
    sourceId,
  });
  const response = await fetch(`/api/workspace/content?${params.toString()}`, {
    headers: {
      Accept: "application/zip",
      Authorization: `Bearer ${accessToken}`,
    },
  });
  await downloadFileResponse(response, `${fallbackName}-files.zip`);
  return { exported: true as const };
};

export const exportWorkspaceFileSelection = async (
  ids: string[],
) => {
  const accessToken = token();
  if (!accessToken) throw new Error("Sign in again to continue.");
  const params = new URLSearchParams({
    module: "files",
    action: "export-selection",
  });
  const response = await fetch(`/api/workspace/content?${params.toString()}`, {
    method: "POST",
    headers: {
      Accept: "application/zip",
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ids }),
  });
  await downloadFileResponse(response, "MaxForm-selected-files.zip");
  return { exported: true as const };
};

export const getDocumentsWorkspace = () =>
  request<DocumentsWorkspace>("documents", "workspace");

export const saveDocumentTemplate = (
  input: Partial<DocumentTemplate> & {
    name: string;
    sourceType: "uploaded_pdf" | "block_built";
  },
) =>
  request<{ template: DocumentTemplate }>("documents", "template", {
    body: input as Record<string, unknown>,
  });

export const createWorkspaceDocument = (input: {
  templateId: string;
  title: string;
  signingOrder: "sequential" | "parallel";
  signers: Array<{
    role: "signer" | "approver" | "cc";
    name: string;
    email: string;
  }>;
  mergeValues?: Record<string, unknown>;
}) =>
  request<{ document: { id: string } }>("documents", "create", {
    body: input,
  });

export const sendWorkspaceDocument = (id: string) =>
  request<{ sent: true; attempted: number; delivered: number; failed: number }>("documents", "send", {
    body: { id },
  });

export const remindWorkspaceDocument = (id: string) =>
  request<{ reminded: true; attempted: number; delivered: number; failed: number }>("documents", "remind", {
    body: { id },
  });

export const voidWorkspaceDocument = (id: string) =>
  request<{ voided: true }>("documents", "void", { body: { id } });

export const saveDocumentSettings = (settings: DocumentSettings) =>
  request<{ settings: DocumentSettings }>("documents", "settings", {
    body: settings,
  });

export const getPublicSigningSession = (signingToken: string) =>
  request<SigningSession>("documents", "signing", {
    authenticated: false,
    query: { token: signingToken },
  });

export const completePublicSignature = (
  signingToken: string,
  input: { signature: string; consent: boolean },
) =>
  request<{ completed: boolean }>("documents", "sign", {
    authenticated: false,
    query: { token: signingToken },
    body: input,
  });

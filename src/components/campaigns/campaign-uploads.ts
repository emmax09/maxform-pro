/**
 * Upload rules for campaign assets.
 *
 * One place, because the browser and the server have to agree: the client
 * checks so the user finds out immediately, the server checks because a client
 * check is a courtesy rather than a control.
 *
 * The rejected extensions are the ones that are dangerous to serve back —
 * executables and anything a browser would run — so they are refused by
 * extension as well as by MIME type, since a MIME type is supplied by the
 * uploader and can simply be wrong.
 */

export type CampaignAssetKind = "image" | "video" | "document" | "audio";

export const campaignAssetRules: Record<
  CampaignAssetKind,
  { maxBytes: number; label: string; extensions: string[]; mimePrefix: string }
> = {
  image: {
    maxBytes: 10 * 1024 * 1024,
    label: "10 MB",
    extensions: ["jpg", "jpeg", "png", "webp", "gif", "svg"],
    mimePrefix: "image/",
  },
  video: {
    maxBytes: 250 * 1024 * 1024,
    label: "250 MB",
    extensions: ["mp4", "webm", "mov"],
    mimePrefix: "video/",
  },
  document: {
    maxBytes: 25 * 1024 * 1024,
    label: "25 MB",
    extensions: ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "csv", "txt"],
    mimePrefix: "application/",
  },
  audio: {
    maxBytes: 50 * 1024 * 1024,
    label: "50 MB",
    extensions: ["mp3", "wav", "ogg", "m4a", "aac"],
    mimePrefix: "audio/",
  },
};

export const MAX_FILES_PER_UPLOAD = 10;

/** Total campaign assets one workspace may hold. */
export const MAX_WORKSPACE_ASSET_BYTES = 500 * 1024 * 1024;

/**
 * Never accepted, whatever the declared type. Executables and anything a
 * browser or mail client might run, plus archives that can smuggle them.
 */
export const REJECTED_EXTENSIONS = [
  "exe",
  "js",
  "mjs",
  "cjs",
  "html",
  "htm",
  "zip",
  "bat",
  "cmd",
  "com",
  "scr",
  "msi",
  "sh",
  "jar",
  "vbs",
  "ps1",
];

/**
 * The extension, or "" when the name has none. Splitting alone is not enough:
 * "README" has no dot, and `split(".").pop()` would hand back the whole name
 * as though it were an extension.
 */
export const fileExtension = (name: string) => {
  const trimmed = String(name || "").trim();
  const dot = trimmed.lastIndexOf(".");
  if (dot <= 0 || dot === trimmed.length - 1) return "";
  return trimmed.slice(dot + 1).toLowerCase();
};

/** The accept attribute for a file input of this kind. */
export const acceptAttribute = (kind: CampaignAssetKind) =>
  campaignAssetRules[kind].extensions.map((ext) => `.${ext}`).join(",");

/**
 * Validates one file. Returns an error message, or null when acceptable.
 * Extension is checked before size so an .exe is refused on what it is rather
 * than on how big it happens to be.
 */
export function validateCampaignAsset(
  file: { name: string; size: number; type?: string },
  kind: CampaignAssetKind,
): string | null {
  const extension = fileExtension(file.name);
  if (!extension) return "That file has no extension, so it cannot be checked.";
  if (REJECTED_EXTENSIONS.includes(extension)) {
    return `.${extension} files are not allowed.`;
  }
  const rule = campaignAssetRules[kind];
  if (!rule.extensions.includes(extension)) {
    return `Choose a ${kind} file: ${rule.extensions.join(", ")}.`;
  }
  if (file.size > rule.maxBytes) {
    return `${kind[0].toUpperCase()}${kind.slice(1)}s have to be ${rule.label} or smaller.`;
  }
  if (file.size <= 0) return "That file is empty.";
  return null;
}

/** Human-readable size, for messages and usage meters. */
export const formatBytes = (bytes: number) => {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  if (value < 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  }
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

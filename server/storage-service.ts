import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
  type CompletedPart,
  type GetObjectCommandOutput,
  type PutObjectCommandInput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createHash, randomUUID } from "node:crypto";
import type { Readable } from "node:stream";

export type StorageVisibility = "private" | "public";
export type StoragePurpose =
  | "workspace_file"
  | "form_response"
  | "form_asset"
  | "event_asset"
  | "ticket_asset"
  | "email_image"
  | "profile_avatar"
  | "product_image"
  | "crm_attachment"
  | "document_template"
  | "generated_document"
  | "export";

export type StoragePolicy = {
  allowedMimeTypes?: ReadonlySet<string>;
  allowedMimePrefixes?: readonly string[];
  maxBytes: number;
  visibility: StorageVisibility | "either";
};

export type StorageObjectLocation = {
  bucket: string;
  key: string;
  publicUrl: string | null;
  visibility: StorageVisibility;
};

export type StorageUploadDescriptor =
  | {
      mode: "single";
      uploadUrl: string;
      expiresInSeconds: number;
    }
  | {
      mode: "multipart";
      uploadId: string;
      partSize: number;
      expiresInSeconds: number;
    };

export type StoredObjectHead = {
  contentLength: number;
  contentType: string;
  etag: string;
  checksumSha256: string;
  lastModified: Date | null;
};

export class StorageServiceError extends Error {
  constructor(
    message: string,
    readonly code = "storage_error",
    readonly status = 500,
  ) {
    super(message);
  }
}

const IMAGE_MIME_TYPES = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const DOCUMENT_MIME_TYPES = new Set([
  "application/json",
  "application/msword",
  "application/pdf",
  "application/rtf",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/zip",
  "text/csv",
  "text/plain",
  "text/rtf",
]);

const GENERAL_FILE_MIME_TYPES = new Set([
  ...DOCUMENT_MIME_TYPES,
  ...IMAGE_MIME_TYPES,
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);

const MiB = 1024 * 1024;

export const storagePolicies: Record<StoragePurpose, StoragePolicy> = {
  workspace_file: {
    allowedMimeTypes: GENERAL_FILE_MIME_TYPES,
    maxBytes: 100 * MiB,
    visibility: "private",
  },
  form_response: {
    allowedMimeTypes: GENERAL_FILE_MIME_TYPES,
    maxBytes: 25 * MiB,
    visibility: "private",
  },
  form_asset: {
    allowedMimeTypes: IMAGE_MIME_TYPES,
    maxBytes: 10 * MiB,
    visibility: "public",
  },
  event_asset: {
    allowedMimeTypes: IMAGE_MIME_TYPES,
    maxBytes: 10 * MiB,
    visibility: "public",
  },
  ticket_asset: {
    allowedMimeTypes: IMAGE_MIME_TYPES,
    maxBytes: 10 * MiB,
    visibility: "public",
  },
  email_image: {
    allowedMimeTypes: IMAGE_MIME_TYPES,
    maxBytes: 5 * MiB,
    visibility: "public",
  },
  profile_avatar: {
    allowedMimeTypes: IMAGE_MIME_TYPES,
    maxBytes: 5 * MiB,
    visibility: "public",
  },
  product_image: {
    allowedMimeTypes: IMAGE_MIME_TYPES,
    maxBytes: 10 * MiB,
    visibility: "public",
  },
  crm_attachment: {
    allowedMimeTypes: GENERAL_FILE_MIME_TYPES,
    maxBytes: 100 * MiB,
    visibility: "private",
  },
  document_template: {
    allowedMimeTypes: new Set(["application/pdf"]),
    maxBytes: 100 * MiB,
    visibility: "private",
  },
  generated_document: {
    allowedMimeTypes: new Set([
      "application/pdf",
      "text/html",
      "text/plain",
    ]),
    maxBytes: 250 * MiB,
    visibility: "private",
  },
  export: {
    allowedMimeTypes: new Set([
      "application/json",
      "application/pdf",
      "application/zip",
      "text/csv",
    ]),
    maxBytes: 2_000_000_000,
    visibility: "private",
  },
};

type StorageConfiguration = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
  privateBucket: string;
  publicBucket: string;
  publicUrl: string;
  signedUrlTtlSeconds: number;
  uploadUrlTtlSeconds: number;
  multipartThresholdBytes: number;
  multipartPartBytes: number;
  maxAttempts: number;
};

let cachedConfiguration: StorageConfiguration | null = null;
let cachedClient: S3Client | null = null;

const requiredEnvironment = (name: string) => {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new StorageServiceError(
      `Object storage is not configured (${name}).`,
      "storage_not_configured",
      503,
    );
  }
  return value;
};

const boundedInteger = (
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
) => {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(minimum, Math.min(maximum, Math.floor(parsed)))
    : fallback;
};

const validBucketName = (value: string) =>
  /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/.test(value);

const validatedStorageEndpoint = (accountId: string, value: string) => {
  const endpoint =
    value.trim().replace(/\/+$/, "") ||
    `https://${accountId}.r2.cloudflarestorage.com`;
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new StorageServiceError(
      "Object storage has an invalid R2 endpoint.",
      "storage_configuration_invalid",
      503,
    );
  }
  const escapedAccountId = accountId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expectedHost = new RegExp(
    `^${escapedAccountId}(?:\\.(?:eu|fedramp))?\\.r2\\.cloudflarestorage\\.com$`,
    "i",
  );
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    !expectedHost.test(parsed.hostname)
  ) {
    throw new StorageServiceError(
      "Object storage must use this account's HTTPS Cloudflare R2 endpoint.",
      "storage_configuration_invalid",
      503,
    );
  }
  return endpoint;
};

const validatedPublicUrl = (value: string) => {
  const normalized = value.trim().replace(/\/+$/, "");
  if (!normalized) return "";
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new StorageServiceError(
      "Public object storage has an invalid delivery URL.",
      "storage_configuration_invalid",
      503,
    );
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new StorageServiceError(
      "Public object storage must use an HTTPS delivery URL.",
      "storage_configuration_invalid",
      503,
    );
  }
  return normalized;
};

const assertServerOnlyCredentials = () => {
  const exposed = [
    "VITE_R2_ACCOUNT_ID",
    "VITE_R2_ACCESS_KEY_ID",
    "VITE_R2_SECRET_ACCESS_KEY",
    "VITE_R2_ENDPOINT",
  ].find((name) => String(process.env[name] || "").trim());
  if (exposed) {
    throw new StorageServiceError(
      `${exposed} is unsafe. R2 credentials must only use server environment variables.`,
      "storage_configuration_invalid",
      503,
    );
  }
};

export const storageConfiguration = (): StorageConfiguration => {
  if (cachedConfiguration) return cachedConfiguration;
  assertServerOnlyCredentials();
  const accountId = requiredEnvironment("R2_ACCOUNT_ID");
  if (!/^[a-f0-9]{32}$/i.test(accountId)) {
    throw new StorageServiceError(
      "Object storage has an invalid Cloudflare account ID.",
      "storage_configuration_invalid",
      503,
    );
  }
  const privateBucket = requiredEnvironment("R2_BUCKET_NAME");
  const publicBucket = String(process.env.R2_PUBLIC_BUCKET_NAME || "").trim();
  if (
    !validBucketName(privateBucket) ||
    (publicBucket && !validBucketName(publicBucket)) ||
    (publicBucket && publicBucket === privateBucket)
  ) {
    throw new StorageServiceError(
      "Object storage bucket names are invalid or not separated.",
      "storage_configuration_invalid",
      503,
    );
  }
  const publicUrl = validatedPublicUrl(
    String(process.env.R2_PUBLIC_URL || ""),
  );
  if (Boolean(publicBucket) !== Boolean(publicUrl)) {
    throw new StorageServiceError(
      "The public R2 bucket and delivery URL must be configured together.",
      "storage_configuration_invalid",
      503,
    );
  }
  cachedConfiguration = {
    accountId,
    accessKeyId: requiredEnvironment("R2_ACCESS_KEY_ID"),
    secretAccessKey: requiredEnvironment("R2_SECRET_ACCESS_KEY"),
    endpoint: validatedStorageEndpoint(
      accountId,
      String(process.env.R2_ENDPOINT || ""),
    ),
    privateBucket,
    publicBucket,
    publicUrl,
    signedUrlTtlSeconds: boundedInteger(
      process.env.R2_SIGNED_URL_TTL_SECONDS,
      300,
      30,
      3_600,
    ),
    uploadUrlTtlSeconds: boundedInteger(
      process.env.R2_UPLOAD_URL_TTL_SECONDS,
      300,
      60,
      3_600,
    ),
    multipartThresholdBytes: boundedInteger(
      process.env.R2_MULTIPART_THRESHOLD_BYTES,
      25 * MiB,
      5 * MiB,
      5 * 1024 * MiB,
    ),
    multipartPartBytes: boundedInteger(
      process.env.R2_MULTIPART_PART_BYTES,
      10 * MiB,
      5 * MiB,
      5 * 1024 * MiB,
    ),
    maxAttempts: boundedInteger(process.env.R2_MAX_ATTEMPTS, 3, 1, 8),
  };
  return cachedConfiguration;
};

const storageClient = () => {
  if (cachedClient) return cachedClient;
  const configuration = storageConfiguration();
  cachedClient = new S3Client({
    region: "auto",
    endpoint: configuration.endpoint,
    credentials: {
      accessKeyId: configuration.accessKeyId,
      secretAccessKey: configuration.secretAccessKey,
    },
    maxAttempts: configuration.maxAttempts,
    // R2 accepts S3 checksums, but SDK-generated optional CRC32 query
    // parameters can make browser presigned PUT signatures diverge. Request
    // checksums only for operations where the protocol requires them.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return cachedClient;
};

export const resetStorageConfigurationForTests = () => {
  cachedConfiguration = null;
  cachedClient?.destroy();
  cachedClient = null;
};

const logStorageFailure = (
  operation: string,
  error: unknown,
  details: Record<string, unknown>,
) => {
  const safeDetails = Object.fromEntries(
    Object.entries(details).map(([key, value]) => {
      if (key === "key" || key === "bucket" || key === "uploadId") {
        return [
          `${key}Fingerprint`,
          createHash("sha256")
            .update(String(value || ""))
            .digest("hex")
            .slice(0, 12),
        ];
      }
      return [key, value];
    }),
  );
  console.error("[storage]", {
    operation,
    code:
      error && typeof error === "object" && "name" in error
        ? String((error as { name?: unknown }).name || "unknown")
        : "unknown",
    ...safeDetails,
  });
};

const withStorageFailure = async <T>(
  operation: string,
  details: Record<string, unknown>,
  task: () => Promise<T>,
) => {
  try {
    return await task();
  } catch (error) {
    if (error instanceof StorageServiceError) throw error;
    logStorageFailure(operation, error, details);
    throw new StorageServiceError(
      "Object storage is temporarily unavailable. Please try again.",
      "storage_provider_error",
      503,
    );
  }
};

export const normalizeMimeType = (value: unknown) =>
  String(value || "application/octet-stream")
    .split(";")[0]
    .trim()
    .toLowerCase()
    .slice(0, 180);

export const sanitizeStorageFileName = (
  value: unknown,
  fallback = "upload",
) => {
  const leaf = String(value || "")
    .split(/[\\/]/)
    .pop()
    ?.slice(0, 255);
  const cleaned = Array.from(leaf || "")
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? "-" : character;
    })
    .join("")
    .replace(/[<>:"/\\|?*]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || fallback;
};

const extensionFor = (fileName: string) => {
  const match = fileName.toLowerCase().match(/(\.[a-z0-9]{1,12})$/);
  return match?.[1] || "";
};

const purposePrefix: Record<StoragePurpose, string> = {
  workspace_file: "workspace-files",
  form_response: "form-responses",
  form_asset: "form-assets",
  event_asset: "event-assets",
  ticket_asset: "ticket-assets",
  email_image: "email-images",
  profile_avatar: "profile-avatars",
  product_image: "product-images",
  crm_attachment: "crm-attachments",
  document_template: "document-templates",
  generated_document: "generated-documents",
  export: "exports",
};

export const createStorageObjectKey = (input: {
  userId: string;
  purpose: StoragePurpose;
  fileName: string;
  sourceId?: string | null;
}) => {
  const safeName = sanitizeStorageFileName(input.fileName);
  const extension = extensionFor(safeName);
  const source = String(input.sourceId || "")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 64);
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "/");
  return [
    "tenants",
    input.userId,
    purposePrefix[input.purpose],
    ...(source ? [source] : []),
    date,
    `${randomUUID()}${extension}`,
  ].join("/");
};

export const validateStorageUpload = (input: {
  purpose: StoragePurpose;
  visibility: StorageVisibility;
  mimeType: string;
  sizeBytes: number;
  maximumBytes?: number;
}) => {
  const policy = storagePolicies[input.purpose];
  if (!policy) {
    throw new StorageServiceError(
      "This upload destination is not available.",
      "storage_purpose_invalid",
      400,
    );
  }
  if (
    policy.visibility !== "either" &&
    policy.visibility !== input.visibility
  ) {
    throw new StorageServiceError(
      "This file cannot use the requested visibility.",
      "storage_visibility_invalid",
      400,
    );
  }
  const size = Math.floor(Number(input.sizeBytes));
  const maximum = Math.min(
    policy.maxBytes,
    input.maximumBytes || policy.maxBytes,
  );
  if (!Number.isFinite(size) || size < 1 || size > maximum) {
    throw new StorageServiceError(
      `Choose a file between 1 byte and ${Math.ceil(maximum / MiB)} MB.`,
      "storage_size_invalid",
      413,
    );
  }
  const mimeType = normalizeMimeType(input.mimeType);
  const allowed =
    policy.allowedMimeTypes?.has(mimeType) ||
    policy.allowedMimePrefixes?.some((prefix) =>
      mimeType.startsWith(prefix),
    );
  if (!allowed) {
    throw new StorageServiceError(
      "This file type is not allowed.",
      "storage_type_invalid",
      415,
    );
  }
  return { mimeType, sizeBytes: size, maximumBytes: maximum };
};

export const resolveStorageLocation = (
  visibility: StorageVisibility,
  key: string,
): StorageObjectLocation => {
  const configuration = storageConfiguration();
  if (visibility === "public") {
    if (!configuration.publicBucket || !configuration.publicUrl) {
      throw new StorageServiceError(
        "Public object storage is not configured.",
        "public_storage_not_configured",
        503,
      );
    }
    return {
      bucket: configuration.publicBucket,
      key,
      publicUrl: `${configuration.publicUrl}/${key
        .split("/")
        .map(encodeURIComponent)
        .join("/")}`,
      visibility,
    };
  }
  return {
    bucket: configuration.privateBucket,
    key,
    publicUrl: null,
    visibility,
  };
};

const objectMetadata = (metadata: Record<string, string | undefined>) =>
  Object.fromEntries(
    Object.entries(metadata)
      .filter(([, value]) => Boolean(value))
      .map(([key, value]) => [
        key.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 64),
        String(value).slice(0, 512),
      ]),
  );

const contentDisposition = (fileName: string, inline = false) => {
  const safeName = sanitizeStorageFileName(fileName).replace(/["\r\n]/g, "-");
  return `${inline ? "inline" : "attachment"}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(
    safeName,
  )}`;
};

export async function beginStorageUpload(input: {
  location: StorageObjectLocation;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  metadata?: Record<string, string | undefined>;
}): Promise<StorageUploadDescriptor> {
  const configuration = storageConfiguration();
  const inline = input.mimeType.startsWith("image/");
  if (input.sizeBytes >= configuration.multipartThresholdBytes) {
    const result = await withStorageFailure(
      "create_multipart_upload",
      { bucket: input.location.bucket, key: input.location.key },
      () =>
        storageClient().send(
          new CreateMultipartUploadCommand({
            Bucket: input.location.bucket,
            Key: input.location.key,
            ContentType: input.mimeType,
            ContentDisposition: contentDisposition(input.fileName, inline),
            CacheControl:
              input.location.visibility === "public"
                ? "public, max-age=31536000, immutable"
                : "private, no-store",
            Metadata: objectMetadata(input.metadata || {}),
          }),
        ),
    );
    if (!result.UploadId) {
      throw new StorageServiceError(
        "The multipart upload could not be started.",
        "multipart_upload_failed",
        503,
      );
    }
    return {
      mode: "multipart",
      uploadId: result.UploadId,
      partSize: configuration.multipartPartBytes,
      expiresInSeconds: configuration.uploadUrlTtlSeconds,
    };
  }

  const command = new PutObjectCommand({
    Bucket: input.location.bucket,
    Key: input.location.key,
    ContentType: input.mimeType,
  });
  const uploadUrl = await withStorageFailure(
    "sign_put",
    { bucket: input.location.bucket, key: input.location.key },
    () =>
      getSignedUrl(storageClient(), command, {
        expiresIn: configuration.uploadUrlTtlSeconds,
      }),
  );
  return {
    mode: "single",
    uploadUrl,
    expiresInSeconds: configuration.uploadUrlTtlSeconds,
  };
}

export async function signStorageUploadParts(input: {
  location: StorageObjectLocation;
  uploadId: string;
  partNumbers: number[];
}) {
  const configuration = storageConfiguration();
  return Promise.all(
    input.partNumbers.map(async (partNumber) => {
      if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) {
        throw new StorageServiceError(
          "One or more multipart upload parts are invalid.",
          "multipart_part_invalid",
          400,
        );
      }
      const url = await withStorageFailure(
        "sign_upload_part",
        {
          bucket: input.location.bucket,
          key: input.location.key,
          partNumber,
        },
        () =>
          getSignedUrl(
            storageClient(),
            new UploadPartCommand({
              Bucket: input.location.bucket,
              Key: input.location.key,
              UploadId: input.uploadId,
              PartNumber: partNumber,
            }),
            { expiresIn: configuration.uploadUrlTtlSeconds },
          ),
      );
      return { partNumber, url };
    }),
  );
}

export async function completeStorageMultipartUpload(input: {
  location: StorageObjectLocation;
  uploadId: string;
  parts: Array<{ partNumber: number; etag: string }>;
}) {
  const parts: CompletedPart[] = input.parts
    .map((part) => ({
      ETag: String(part.etag || "").trim(),
      PartNumber: Math.floor(Number(part.partNumber)),
    }))
    .sort((left, right) => Number(left.PartNumber) - Number(right.PartNumber));
  if (
    !parts.length ||
    parts.some(
      (part, index) =>
        !part.ETag ||
        !Number.isInteger(part.PartNumber) ||
        Number(part.PartNumber) !== index + 1,
    )
  ) {
    throw new StorageServiceError(
      "The multipart upload is incomplete.",
      "multipart_upload_incomplete",
      400,
    );
  }
  await withStorageFailure(
    "complete_multipart_upload",
    { bucket: input.location.bucket, key: input.location.key },
    () =>
      storageClient().send(
        new CompleteMultipartUploadCommand({
          Bucket: input.location.bucket,
          Key: input.location.key,
          UploadId: input.uploadId,
          MultipartUpload: { Parts: parts },
        }),
      ),
  );
}

export async function abortStorageMultipartUpload(input: {
  location: StorageObjectLocation;
  uploadId: string;
}) {
  await withStorageFailure(
    "abort_multipart_upload",
    { bucket: input.location.bucket, key: input.location.key },
    () =>
      storageClient().send(
        new AbortMultipartUploadCommand({
          Bucket: input.location.bucket,
          Key: input.location.key,
          UploadId: input.uploadId,
        }),
      ),
  );
}

export async function headStorageObject(
  location: StorageObjectLocation,
): Promise<StoredObjectHead> {
  const result = await withStorageFailure(
    "head_object",
    { bucket: location.bucket, key: location.key },
    () =>
      storageClient().send(
        new HeadObjectCommand({
          Bucket: location.bucket,
          Key: location.key,
        }),
      ),
  );
  return {
    contentLength: Number(result.ContentLength || 0),
    contentType: normalizeMimeType(result.ContentType),
    etag: String(result.ETag || "").replace(/^"|"$/g, ""),
    checksumSha256: String(result.ChecksumSHA256 || ""),
    lastModified: result.LastModified || null,
  };
}

const bodyToBuffer = async (
  body: GetObjectCommandOutput["Body"],
  maximumBytes = 16 * 1024,
) => {
  if (!body) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > maximumBytes) {
      throw new StorageServiceError(
        "The object validation sample was too large.",
        "storage_validation_failed",
        422,
      );
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
};

export async function readStorageObjectPrefix(
  location: StorageObjectLocation,
  bytes = 8_192,
) {
  const result = await withStorageFailure(
    "get_object_prefix",
    { bucket: location.bucket, key: location.key },
    () =>
      storageClient().send(
        new GetObjectCommand({
          Bucket: location.bucket,
          Key: location.key,
          Range: `bytes=0-${Math.max(0, bytes - 1)}`,
        }),
      ),
  );
  return bodyToBuffer(result.Body, bytes);
}

const beginsWith = (content: Buffer, values: number[]) =>
  values.every((value, index) => content[index] === value);

const looksLikeText = (content: Buffer) => {
  if (!content.length || content.includes(0)) return false;
  const sample = content.toString("utf8");
  const replacementCharacters = (sample.match(/\uFFFD/g) || []).length;
  return replacementCharacters <= Math.max(1, sample.length * 0.01);
};

export const validateObjectSignature = (
  mimeTypeValue: string,
  content: Buffer,
) => {
  const mimeType = normalizeMimeType(mimeTypeValue);
  if (mimeType === "image/png") {
    return beginsWith(content, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
  if (mimeType === "image/jpeg") {
    return beginsWith(content, [0xff, 0xd8, 0xff]);
  }
  if (mimeType === "image/gif") {
    return ["GIF87a", "GIF89a"].includes(content.subarray(0, 6).toString("ascii"));
  }
  if (mimeType === "image/webp") {
    return (
      content.subarray(0, 4).toString("ascii") === "RIFF" &&
      content.subarray(8, 12).toString("ascii") === "WEBP"
    );
  }
  if (mimeType === "image/avif") {
    return content.subarray(4, 12).toString("ascii").includes("ftyp");
  }
  if (mimeType === "application/pdf") {
    return content.subarray(0, 5).toString("ascii") === "%PDF-";
  }
  if (
    mimeType === "application/zip" ||
    mimeType.startsWith("application/vnd.openxmlformats-officedocument")
  ) {
    return beginsWith(content, [0x50, 0x4b, 0x03, 0x04]);
  }
  if (mimeType === "video/mp4" || mimeType === "video/quicktime") {
    return content.subarray(4, 12).toString("ascii").includes("ftyp");
  }
  if (mimeType === "video/webm" || mimeType === "audio/ogg") {
    return (
      beginsWith(content, [0x1a, 0x45, 0xdf, 0xa3]) ||
      content.subarray(0, 4).toString("ascii") === "OggS"
    );
  }
  if (mimeType === "audio/mpeg") {
    return (
      content.subarray(0, 3).toString("ascii") === "ID3" ||
      (content[0] === 0xff && (content[1] & 0xe0) === 0xe0)
    );
  }
  if (mimeType === "audio/wav") {
    return (
      content.subarray(0, 4).toString("ascii") === "RIFF" &&
      content.subarray(8, 12).toString("ascii") === "WAVE"
    );
  }
  if (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/rtf"
  ) {
    return looksLikeText(content);
  }
  // Legacy Microsoft formats have compound-file signatures.
  if (
    mimeType === "application/msword" ||
    mimeType === "application/vnd.ms-excel" ||
    mimeType === "application/vnd.ms-powerpoint"
  ) {
    return beginsWith(content, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  }
  return false;
};

export async function createSignedStorageDownload(input: {
  location: StorageObjectLocation;
  fileName: string;
  mimeType: string;
  inline?: boolean;
  expiresInSeconds?: number;
}) {
  if (input.location.visibility === "public" && input.location.publicUrl) {
    return input.location.publicUrl;
  }
  const configuration = storageConfiguration();
  const expiresIn = Math.max(
    30,
    Math.min(
      3_600,
      input.expiresInSeconds || configuration.signedUrlTtlSeconds,
    ),
  );
  return withStorageFailure(
    "sign_get",
    { bucket: input.location.bucket, key: input.location.key },
    () =>
      getSignedUrl(
        storageClient(),
        new GetObjectCommand({
          Bucket: input.location.bucket,
          Key: input.location.key,
          ResponseContentType: normalizeMimeType(input.mimeType),
          ResponseContentDisposition: contentDisposition(
            input.fileName,
            input.inline,
          ),
        }),
        { expiresIn },
      ),
  );
}

export async function getStorageObjectStream(
  location: StorageObjectLocation,
  options: { range?: string } = {},
) {
  // Only a single byte range is forwarded; multi-range requests fall back to
  // the full object so callers never have to assemble a multipart body.
  const range = /^bytes=\d*-\d*$/.test(String(options.range || "").trim())
    ? String(options.range).trim()
    : undefined;
  const result = await withStorageFailure(
    "get_object",
    { bucket: location.bucket, key: location.key },
    () =>
      storageClient().send(
        new GetObjectCommand({
          Bucket: location.bucket,
          Key: location.key,
          Range: range,
        }),
      ),
  );
  if (!result.Body) {
    throw new StorageServiceError(
      "The stored object has no readable body.",
      "storage_object_empty",
      404,
    );
  }
  return {
    body: result.Body as Readable & AsyncIterable<Uint8Array>,
    contentLength: Number(result.ContentLength || 0),
    contentType: normalizeMimeType(result.ContentType),
    contentRange: String(result.ContentRange || ""),
    etag: String(result.ETag || "").replace(/^"|"$/g, ""),
  };
}

export async function putStorageObject(input: {
  location: StorageObjectLocation;
  fileName: string;
  mimeType: string;
  body: PutObjectCommandInput["Body"];
  sizeBytes?: number;
  metadata?: Record<string, string | undefined>;
}) {
  const inline = input.mimeType.startsWith("image/");
  const result = await withStorageFailure(
    "put_object",
    { bucket: input.location.bucket, key: input.location.key },
    () =>
      storageClient().send(
        new PutObjectCommand({
          Bucket: input.location.bucket,
          Key: input.location.key,
          Body: input.body,
          ContentLength: input.sizeBytes,
          ContentType: normalizeMimeType(input.mimeType),
          ContentDisposition: contentDisposition(input.fileName, inline),
          CacheControl:
            input.location.visibility === "public"
              ? "public, max-age=31536000, immutable"
              : "private, no-store",
          Metadata: objectMetadata(input.metadata || {}),
        }),
      ),
  );
  return {
    etag: String(result.ETag || "").replace(/^"|"$/g, ""),
    checksumSha256: String(result.ChecksumSHA256 || ""),
  };
}

export async function copyStorageObject(input: {
  source: StorageObjectLocation;
  destination: StorageObjectLocation;
  fileName: string;
  mimeType: string;
  metadata?: Record<string, string | undefined>;
}) {
  const inline = input.mimeType.startsWith("image/");
  const encodedSource = [
    encodeURIComponent(input.source.bucket),
    ...input.source.key.split("/").map(encodeURIComponent),
  ].join("/");
  const result = await withStorageFailure(
    "copy_object",
    {
      bucket: input.destination.bucket,
      key: input.destination.key,
    },
    () =>
      storageClient().send(
        new CopyObjectCommand({
          Bucket: input.destination.bucket,
          Key: input.destination.key,
          CopySource: encodedSource,
          MetadataDirective: "REPLACE",
          ContentType: normalizeMimeType(input.mimeType),
          ContentDisposition: contentDisposition(input.fileName, inline),
          CacheControl:
            input.destination.visibility === "public"
              ? "public, max-age=31536000, immutable"
              : "private, no-store",
          Metadata: objectMetadata(input.metadata || {}),
        }),
      ),
  );
  return {
    etag: String(result.CopyObjectResult?.ETag || "").replace(/^"|"$/g, ""),
  };
}

export async function deleteStorageObject(location: StorageObjectLocation) {
  await withStorageFailure(
    "delete_object",
    { bucket: location.bucket, key: location.key },
    () =>
      storageClient().send(
        new DeleteObjectCommand({
          Bucket: location.bucket,
          Key: location.key,
        }),
      ),
  );
}

export async function checkStorageHealth() {
  const configuration = storageConfiguration();
  const buckets = Array.from(
    new Set(
      [configuration.privateBucket, configuration.publicBucket].filter(Boolean),
    ),
  );
  await Promise.all(
    buckets.map((bucket) =>
      withStorageFailure("head_bucket", { bucket }, () =>
        storageClient().send(new HeadBucketCommand({ Bucket: bucket })),
      ),
    ),
  );
  return { buckets: buckets.length, provider: "r2" as const };
}

export const sha256Hex = (content: Buffer | string) =>
  createHash("sha256").update(content).digest("hex");

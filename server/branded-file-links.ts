import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { cacheGet, cacheKey, cacheSet } from "./cache";
import { configuredAppUrl } from "./app-url";

// Branded file links keep stored content behind a short URL on the app's own
// domain (`https://app.example/AbC12/file/<token>`) instead of handing out a
// ~700 character presigned R2 URL. The token is stateless: it carries the
// storage object id, an expiry and the disposition, signed with JWT_SECRET, so
// serving one costs a signature check instead of a share-link table row.

const PAYLOAD_BYTES = 21; // 16 uuid + 4 expiry + 1 flags
const SIGNATURE_BYTES = 12;
const TOKEN_BYTES = PAYLOAD_BYTES + SIGNATURE_BYTES;
const ATTACHMENT_FLAG = 1;

export const brandedFileTokenPattern = /^[A-Za-z0-9_-]{44}$/;
export const workspaceShortIdPattern = /^[A-Za-z0-9]{4,6}$/;

// Excludes visually ambiguous characters (0/O, 1/l/I), matching the charset
// used by account signup and migration 031.
const shortIdCharset =
  "23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ";

export type BrandedFileDisposition = "inline" | "attachment";

export type WorkspaceQuery = (
  query: string,
  parameters: unknown[],
) => Promise<Record<string, unknown>[]>;

const linkSecret = () => {
  const secret = String(process.env.JWT_SECRET || "");
  return secret.length >= 32 ? secret : "";
};

const uuidToBytes = (value: string) => {
  const hex = String(value || "").replace(/-/g, "");
  return /^[0-9a-f]{32}$/i.test(hex) ? Buffer.from(hex, "hex") : null;
};

const uuidFromBytes = (bytes: Buffer) => {
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
};

const sign = (secret: string, payload: Buffer) =>
  createHmac("sha256", secret)
    .update(payload)
    .digest()
    .subarray(0, SIGNATURE_BYTES);

export const brandedFileTtlSeconds = () => {
  const configured = Number(process.env.BRANDED_FILE_URL_TTL_SECONDS);
  if (!Number.isFinite(configured) || configured <= 0) return 900;
  return Math.max(60, Math.min(3_600, Math.floor(configured)));
};

export function createBrandedFileToken(input: {
  storageObjectId: string;
  disposition?: BrandedFileDisposition;
  expiresInSeconds?: number;
}) {
  const secret = linkSecret();
  const objectId = uuidToBytes(input.storageObjectId);
  if (!secret || !objectId) return null;
  const expiresInSeconds = Math.max(
    60,
    Math.min(3_600, input.expiresInSeconds || brandedFileTtlSeconds()),
  );
  const payload = Buffer.alloc(PAYLOAD_BYTES);
  objectId.copy(payload, 0);
  payload.writeUInt32BE(
    Math.floor(Date.now() / 1_000) + expiresInSeconds,
    16,
  );
  payload[20] = input.disposition === "attachment" ? ATTACHMENT_FLAG : 0;
  return {
    token: Buffer.concat([payload, sign(secret, payload)]).toString(
      "base64url",
    ),
    expiresInSeconds,
  };
}

export function readBrandedFileToken(value: unknown) {
  const token = String(value ?? "");
  const secret = linkSecret();
  if (!secret || !brandedFileTokenPattern.test(token)) return null;
  const raw = Buffer.from(token, "base64url");
  if (raw.length !== TOKEN_BYTES) return null;
  const payload = raw.subarray(0, PAYLOAD_BYTES);
  const signature = raw.subarray(PAYLOAD_BYTES);
  const expected = sign(secret, payload);
  if (
    signature.length !== expected.length ||
    !timingSafeEqual(signature, expected)
  ) {
    return null;
  }
  const expiresAt = payload.readUInt32BE(16);
  if (expiresAt * 1_000 <= Date.now()) return null;
  return {
    storageObjectId: uuidFromBytes(payload.subarray(0, 16)),
    disposition: (payload[20] & ATTACHMENT_FLAG
      ? "attachment"
      : "inline") as BrandedFileDisposition,
    expiresAt,
  };
}

export const brandedFileUrl = (
  origin: string,
  workspaceShortId: string,
  token: string,
) => `${String(origin).replace(/\/$/, "")}/${workspaceShortId}/file/${token}`;

/**
 * Builds the branded URL for a stored object, or returns "" when the workspace
 * or signing secret cannot produce one so callers can fall back to a presigned
 * provider URL.
 */
export function createBrandedFileLink(input: {
  origin: string;
  workspaceShortId: string;
  storageObjectId: string;
  disposition?: BrandedFileDisposition;
  expiresInSeconds?: number;
}) {
  const origin = String(input.origin || "").replace(/\/$/, "");
  const workspaceShortId = String(input.workspaceShortId || "").trim();
  if (!origin || !workspaceShortIdPattern.test(workspaceShortId)) return null;
  const signed = createBrandedFileToken(input);
  if (!signed) return null;
  return {
    url: brandedFileUrl(origin, workspaceShortId, signed.token),
    expiresInSeconds: signed.expiresInSeconds,
  };
}

export const defaultAppOrigin = () =>
  configuredAppUrl();

const generateShortId = () => {
  const bytes = randomBytes(5);
  let id = "";
  for (let index = 0; index < 5; index += 1) {
    id += shortIdCharset[bytes[index] % shortIdCharset.length];
  }
  return id;
};

// A short id never changes once assigned, and a file grid asks for one link
// per thumbnail, so resolved values are held briefly to keep those renders
// from turning into one database round trip each.
const shortIdCache = new Map<string, { shortId: string; expiresAt: number }>();
const SHORT_ID_CACHE_MS = 5 * 60_000;

export const resetWorkspaceShortIdCacheForTests = () => shortIdCache.clear();

const SHORT_ID_REDIS_TTL_SECONDS = 86_400;

const rememberShortId = (userId: string, shortId: string) => {
  if (!shortId) return shortId;
  if (shortIdCache.size > 5_000) shortIdCache.clear();
  shortIdCache.set(userId, {
    shortId,
    expiresAt: Date.now() + SHORT_ID_CACHE_MS,
  });
  return shortId;
};

// Redis holds the value for a day and shares it with every other instance.
// The write is awaited because a serverless instance can be frozen the moment
// it responds, which would drop a fire-and-forget write and leave the key cold
// forever.
const publishShortId = async (userId: string, shortId: string) => {
  if (!shortId) return shortId;
  await cacheSet(
    cacheKey("workspace-short-id", userId),
    shortId,
    SHORT_ID_REDIS_TTL_SECONDS,
  );
  return rememberShortId(userId, shortId);
};

/**
 * Returns the workspace's public short id, backfilling one when the account
 * predates migration 031 or was created without it. Returns "" only when the
 * account row is gone.
 */
export async function ensureWorkspaceShortId(
  query: WorkspaceQuery,
  userId: string,
) {
  const local = shortIdCache.get(userId);
  if (local && local.expiresAt > Date.now()) return local.shortId;
  shortIdCache.delete(userId);

  const shared = await cacheGet<string>(
    cacheKey("workspace-short-id", userId),
  );
  if (shared) return rememberShortId(userId, shared);

  const existing = await query(
    `SELECT short_id FROM users WHERE id = $1 LIMIT 1`,
    [userId],
  );
  if (!existing[0]) return "";
  const current = String(existing[0].short_id ?? "").trim();
  if (current) return publishShortId(userId, current);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = generateShortId();
    const updated = await query(
      `UPDATE users
       SET short_id = $2, updated_at = NOW()
       WHERE id = $1
         AND (short_id IS NULL OR short_id = '')
         AND NOT EXISTS (
           SELECT 1 FROM users other WHERE other.short_id = $2
         )
       RETURNING short_id`,
      [userId, candidate],
    );
    const saved = String(updated[0]?.short_id ?? "").trim();
    if (saved) return publishShortId(userId, saved);
    // Either the candidate collided or a concurrent request already assigned
    // one. Re-read before trying again so we never hand out a stale value.
    const reread = await query(
      `SELECT short_id FROM users WHERE id = $1 LIMIT 1`,
      [userId],
    );
    if (!reread[0]) return "";
    const assigned = String(reread[0].short_id ?? "").trim();
    if (assigned) return publishShortId(userId, assigned);
  }
  return "";
}

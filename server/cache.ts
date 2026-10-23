import { withRedis } from "./redis";

// A read-through cache over Upstash. Every helper is fail-open: a Redis miss,
// outage or misconfiguration falls through to the loader, so a cached endpoint
// behaves exactly like an uncached one when Redis is unavailable.

export type CacheNamespace =
  | "workspace-short-id"
  | "analytics"
  | "public-form"
  | "public-event"
  | "storage-object"
  | "files-workspace";

// Values are wrapped so that strings, nulls and objects all round-trip
// identically through Upstash's automatic JSON handling.
type Envelope<T> = { d: T };

const isEnvelope = <T>(value: unknown): value is Envelope<T> =>
  Boolean(value) && typeof value === "object" && "d" in (value as object);

const cacheVersion = () =>
  String(process.env.CACHE_VERSION || "1").replace(/[^A-Za-z0-9_.-]/g, "") ||
  "1";

/** Builds the namespaced key actually stored in Redis. */
export const cacheKey = (
  namespace: CacheNamespace,
  ...parts: Array<string | number | null | undefined>
) =>
  [
    "mf",
    `v${cacheVersion()}`,
    namespace,
    ...parts.map((part) =>
      String(part ?? "")
        .replace(/\s+/g, "_")
        .slice(0, 160),
    ),
  ].join(":");

export async function cacheGet<T>(key: string): Promise<T | null> {
  const stored = await withRedis<unknown>(
    "get",
    (redis) => redis.get(key),
    null,
  );
  if (stored === null || stored === undefined) return null;
  return isEnvelope<T>(stored) ? stored.d : null;
}

export async function cacheSet<T>(
  key: string,
  value: T,
  ttlSeconds: number,
) {
  const ttl = Math.max(1, Math.floor(ttlSeconds));
  await withRedis(
    "set",
    (redis) => redis.set(key, { d: value } satisfies Envelope<T>, { ex: ttl }),
    null,
  );
}

export async function cacheDelete(...keys: string[]) {
  const wanted = keys.filter(Boolean);
  if (!wanted.length) return;
  await withRedis("del", (redis) => redis.del(...wanted), 0);
}

// Concurrent misses on the same warm instance share one loader call so a cold
// key cannot fan out into duplicate expensive queries.
const inFlight = new Map<string, Promise<unknown>>();

export const resetCacheStateForTests = () => inFlight.clear();

/**
 * Returns the cached value for `key`, otherwise runs `loader` and stores the
 * result. A loader that throws is never cached and the error propagates.
 */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>,
): Promise<T> {
  const hit = await cacheGet<T>(key);
  if (hit !== null) return hit;

  const pending = inFlight.get(key);
  if (pending) return pending as Promise<T>;

  const load = (async () => {
    const value = await loader();
    // `undefined` has no JSON representation, so it is left uncached.
    if (value !== undefined) await cacheSet(key, value, ttlSeconds);
    return value;
  })();
  inFlight.set(key, load);
  try {
    return await load;
  } finally {
    inFlight.delete(key);
  }
}

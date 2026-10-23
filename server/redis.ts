import { Redis } from "@upstash/redis";

// Upstash speaks HTTP, so a single client is safe to share across the
// serverless invocations that reuse a warm instance. Every caller must treat
// Redis as optional: when it is unconfigured or unreachable the feature it
// backs falls back to the database rather than failing the request.

let cachedClient: Redis | null = null;
let cachedFingerprint = "";
let disabledUntil = 0;

const CIRCUIT_OPEN_MS = 10_000;

const credentials = () => ({
  url: String(process.env.UPSTASH_REDIS_REST_URL || "").trim(),
  token: String(process.env.UPSTASH_REDIS_REST_TOKEN || "").trim(),
});

export const redisConfigured = () => {
  const { url, token } = credentials();
  return Boolean(url && token);
};

export const redisClient = () => {
  const { url, token } = credentials();
  if (!url || !token) return null;
  const fingerprint = `${url}|${token.slice(0, 8)}`;
  if (cachedClient && cachedFingerprint === fingerprint) return cachedClient;
  cachedClient = new Redis({
    url,
    token,
    // The caller always has a database fallback, so a slow Redis should lose
    // the race quickly instead of adding latency to every request.
    retry: { retries: 1, backoff: (attempt) => attempt * 50 },
  });
  cachedFingerprint = fingerprint;
  return cachedClient;
};

export const resetRedisForTests = () => {
  cachedClient = null;
  cachedFingerprint = "";
  disabledUntil = 0;
};

let lastFailureLoggedAt = 0;

const noteFailure = (operation: string, error: unknown) => {
  // One failing call usually means the whole endpoint is down, so the circuit
  // opens briefly instead of letting every request pay the timeout.
  disabledUntil = Date.now() + CIRCUIT_OPEN_MS;
  const now = Date.now();
  if (now - lastFailureLoggedAt < 30_000) return;
  lastFailureLoggedAt = now;
  console.error("[redis] falling back to the database", {
    operation,
    type: error instanceof Error ? error.name : typeof error,
  });
};

/**
 * Runs a Redis command, returning `fallback` when Redis is unconfigured, in a
 * cooldown after a recent failure, or errors. Never throws.
 */
export async function withRedis<T>(
  operation: string,
  task: (redis: Redis) => Promise<T>,
  fallback: T,
): Promise<T> {
  if (Date.now() < disabledUntil) return fallback;
  const redis = redisClient();
  if (!redis) return fallback;
  try {
    return await task(redis);
  } catch (error) {
    noteFailure(operation, error);
    return fallback;
  }
}

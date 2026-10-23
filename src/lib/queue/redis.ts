import IORedis, { type RedisOptions } from "ioredis";

/**
 * The queue transport deliberately uses Redis over TLS/TCP. Upstash's REST
 * client is still used by the browser-facing cache/rate-limit helpers, but it
 * cannot provide the blocking connection semantics BullMQ needs.
 */

let connection: IORedis | null = null;
let connectionFingerprint = "";

const readConfig = () => {
  const urlValue = String(process.env.REDIS_URL || "").trim();
  if (urlValue) {
    try {
      const parsed = new URL(urlValue);
      if (!["redis:", "rediss:"].includes(parsed.protocol)) throw new Error("Unsupported Redis protocol");
      return {
        host: parsed.hostname,
        port: Number(parsed.port || 6379),
        username: decodeURIComponent(parsed.username || ""),
        password: decodeURIComponent(parsed.password || ""),
        tls: parsed.protocol === "rediss:",
      };
    } catch {
      // Fall through to the split Upstash variables so a malformed optional
      // REDIS_URL cannot hide an otherwise valid deployment configuration.
    }
  }
  return {
    host: String(process.env.UPSTASH_REDIS_HOST || "").trim(),
    port: Number(process.env.UPSTASH_REDIS_PORT || 6379),
    username: String(process.env.UPSTASH_REDIS_USERNAME || "").trim(),
    password: String(process.env.UPSTASH_REDIS_PASSWORD || "").trim(),
    tls: true,
  };
};

export const queueRedisConfigured = () => {
  const config = readConfig();
  return Boolean(
    config.host &&
      config.password &&
      Number.isInteger(config.port) &&
      config.port > 0,
  );
};

export const getQueueRedis = () => {
  const config = readConfig();
  if (
    !config.host ||
    !config.password ||
    !Number.isInteger(config.port) ||
    config.port <= 0
  ) {
    return null;
  }

  const fingerprint = `${config.username}@${config.host}:${config.port}:${config.password.slice(0, 8)}:${config.tls}`;
  if (connection && connectionFingerprint === fingerprint) return connection;

  const options: RedisOptions = {
    host: config.host,
    port: config.port,
    ...(config.username ? { username: config.username } : {}),
    password: config.password,
    ...(config.tls ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: false,
    connectTimeout: Math.max(
      2_000,
      Math.min(15_000, Number(process.env.QUEUE_REDIS_CONNECT_TIMEOUT_MS || 8_000)),
    ),
  };
  connection = new IORedis(options);
  connectionFingerprint = fingerprint;
  return connection;
};

export const closeQueueRedis = async () => {
  const active = connection;
  connection = null;
  connectionFingerprint = "";
  if (!active) return;
  await active.quit().catch(() => active.disconnect());
};

export const resetQueueRedisForTests = () => {
  if (connection) connection.disconnect();
  connection = null;
  connectionFingerprint = "";
};

const releaseLockScript = `
  if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
  end
  return 0
`;

/** A short-lived distributed lock for a campaign recipient or batch. */
export const acquireQueueLock = async (
  key: string,
  token: string,
  ttlMs: number,
) => {
  const redis = getQueueRedis();
  // PostgreSQL's queued -> processing claim remains the local/dev safety net
  // when TCP Redis has not been configured yet.
  if (!redis) return true;
  const result = await redis.set(key, token, "PX", Math.max(1_000, ttlMs), "NX");
  return result === "OK";
};

export const releaseQueueLock = async (key: string, token: string) => {
  const redis = getQueueRedis();
  if (!redis) return false;
  const result = await redis.eval(releaseLockScript, 1, key, token);
  return Number(result) === 1;
};

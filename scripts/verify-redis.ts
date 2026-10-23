import {
  cacheDelete,
  cacheGet,
  cacheKey,
  cacheSet,
  cached,
} from "../server/cache";
import { consumeRateLimit, rateLimitIdentifier } from "../server/rate-limit";
import { redisConfigured, withRedis } from "../server/redis";

// Checks that Upstash is reachable and that the cache and rate limiter behave
// as the application expects. Safe to run against any environment: every key
// it writes is unique to the run and deleted afterwards.

let checks = 0;
const failures: string[] = [];

const check = (condition: unknown, description: string) => {
  checks += 1;
  if (!condition) failures.push(description);
  console.log(`${condition ? "ok  " : "FAIL"} ${description}`);
};

const runId = `verify-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
const key = cacheKey("analytics", runId);
const written: string[] = [];

const track = (value: string) => {
  written.push(value);
  return value;
};

try {
  if (!redisConfigured()) {
    console.log(
      "UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not set.\n" +
        "Caching and rate limiting fall back to the database; nothing to verify.",
    );
    process.exit(0);
  }

  const started = Date.now();
  const pong = await withRedis("ping", (redis) => redis.ping(), "");
  const latency = Date.now() - started;
  check(pong === "PONG", `Upstash answered PING in ${latency}ms`);

  await cacheSet(track(key), { hello: "world", n: 42 }, 60);
  const object = await cacheGet<{ hello: string; n: number }>(key);
  check(
    object?.hello === "world" && object?.n === 42,
    "an object round-trips through the cache",
  );

  const stringKey = track(`${key}:string`);
  await cacheSet(stringKey, "plain-string", 60);
  check(
    (await cacheGet<string>(stringKey)) === "plain-string",
    "a bare string round-trips without being re-parsed",
  );

  const nullKey = track(`${key}:null`);
  await cacheSet(nullKey, null, 60);
  check(
    (await cacheGet(nullKey)) === null,
    "a null value round-trips without breaking the envelope",
  );

  check(
    (await cacheGet(`${key}:never-written`)) === null,
    "a missing key reads back as null",
  );

  let loads = 0;
  const readThroughKey = track(`${key}:read-through`);
  const loader = async () => {
    loads += 1;
    return { loaded: loads };
  };
  const miss = await cached(readThroughKey, 60, loader);
  const hit = await cached(readThroughKey, 60, loader);
  check(miss.loaded === 1 && hit.loaded === 1, "a warm key skips the loader");
  check(loads === 1, `the loader ran once, not ${loads} times`);

  let concurrentLoads = 0;
  const singleFlightKey = track(`${key}:single-flight`);
  const slowLoader = async () => {
    concurrentLoads += 1;
    await new Promise((resolve) => setTimeout(resolve, 50));
    return concurrentLoads;
  };
  await Promise.all([
    cached(singleFlightKey, 60, slowLoader),
    cached(singleFlightKey, 60, slowLoader),
    cached(singleFlightKey, 60, slowLoader),
  ]);
  check(
    concurrentLoads === 1,
    `concurrent misses share one loader call (ran ${concurrentLoads})`,
  );

  await cacheDelete(key);
  check((await cacheGet(key)) === null, "a deleted key reads back as null");

  const identifier = `${runId}-limit`;
  const decisions = [];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    decisions.push(
      await consumeRateLimit({
        action: `verify:${runId}`,
        identifier,
        limit: 3,
        windowSeconds: 60,
      }),
    );
  }
  check(decisions[0].supported, "the rate limiter is using Redis");
  check(
    decisions.slice(0, 3).every((decision) => decision.allowed),
    "the first three requests are inside the limit",
  );
  check(!decisions[3].allowed, "the fourth request is refused");
  check(
    decisions[2].remaining === 0,
    `the limiter reports the remaining budget (${decisions[2].remaining})`,
  );

  const limitKey = `mf:rl:verify:${runId}:${rateLimitIdentifier(identifier)}`;
  const ttl = await withRedis("ttl", (redis) => redis.ttl(limitKey), -2);
  written.push(limitKey);
  check(ttl > 0 && ttl <= 60, `the rate limit window expires on its own (ttl ${ttl}s)`);

  console.log(`\nRedis verification: ${checks - failures.length}/${checks} checks passed.`);
  if (failures.length) {
    throw new Error(`Failed checks:\n- ${failures.join("\n- ")}`);
  }
} finally {
  await cacheDelete(...written);
}

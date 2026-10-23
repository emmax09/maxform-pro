import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  cacheDelete,
  cacheGet,
  cacheKey,
  cacheSet,
  cached,
  resetCacheStateForTests,
} from "./cache";
import { consumeRateLimit, rateLimitIdentifier } from "./rate-limit";
import { redisConfigured, resetRedisForTests } from "./redis";

const originalEnvironment = { ...process.env };

// These tests run with Redis deliberately unconfigured. Live behaviour is
// covered by scripts/verify-redis.ts, which runs against a real database.
describe("cache keys", () => {
  beforeEach(() => {
    process.env.CACHE_VERSION = "3";
  });

  afterEach(() => {
    process.env = { ...originalEnvironment };
  });

  it("namespaces and versions every key", () => {
    expect(cacheKey("analytics", "user-1", 30)).toBe(
      "mf:v3:analytics:user-1:30",
    );
  });

  it("changes every key when the cache version is bumped", () => {
    const before = cacheKey("public-form", "abc");
    process.env.CACHE_VERSION = "4";
    expect(cacheKey("public-form", "abc")).not.toBe(before);
  });

  it("keeps whitespace out of keys", () => {
    expect(cacheKey("public-form", "my form slug")).toBe(
      "mf:v3:public-form:my_form_slug",
    );
  });

  it("strips the separator from the version so a key cannot be forged", () => {
    process.env.CACHE_VERSION = "1:mf:v1:analytics";
    const key = cacheKey("public-form", "abc");
    expect(key.split(":")).toHaveLength(4);
    expect(key).toBe("mf:v1mfv1analytics:public-form:abc");
  });

  it("truncates an oversized part instead of growing the key", () => {
    const key = cacheKey("public-form", "s".repeat(400));
    expect(key.endsWith("s".repeat(160))).toBe(true);
    expect(key.length).toBeLessThan(200);
  });

  it("treats a missing part as empty rather than the string undefined", () => {
    expect(cacheKey("public-form", undefined, "slug")).toBe(
      "mf:v3:public-form::slug",
    );
  });
});

describe("cache without Redis configured", () => {
  beforeEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    resetRedisForTests();
    resetCacheStateForTests();
  });

  afterEach(() => {
    process.env = { ...originalEnvironment };
    resetRedisForTests();
  });

  it("reports that Redis is not configured", () => {
    expect(redisConfigured()).toBe(false);
  });

  it("reads back nothing and never throws", async () => {
    await expect(cacheGet("mf:v1:analytics:missing")).resolves.toBeNull();
    await expect(cacheSet("mf:v1:analytics:x", 1, 60)).resolves.toBeUndefined();
    await expect(cacheDelete("mf:v1:analytics:x")).resolves.toBeUndefined();
  });

  it("falls through to the loader on every call", async () => {
    let loads = 0;
    const loader = async () => {
      loads += 1;
      return loads;
    };

    expect(await cached("mf:v1:analytics:fallthrough", 60, loader)).toBe(1);
    expect(await cached("mf:v1:analytics:fallthrough", 60, loader)).toBe(2);
  });

  it("still collapses concurrent misses into one loader call", async () => {
    let loads = 0;
    const loader = async () => {
      loads += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return loads;
    };

    const results = await Promise.all([
      cached("mf:v1:analytics:flight", 60, loader),
      cached("mf:v1:analytics:flight", 60, loader),
      cached("mf:v1:analytics:flight", 60, loader),
    ]);

    expect(loads).toBe(1);
    expect(results).toEqual([1, 1, 1]);
  });

  it("propagates a loader failure instead of caching it", async () => {
    await expect(
      cached("mf:v1:analytics:boom", 60, async () => {
        throw new Error("query failed");
      }),
    ).rejects.toThrow("query failed");

    // The failed key must not stay pinned in the single-flight map.
    await expect(
      cached("mf:v1:analytics:boom", 60, async () => "recovered"),
    ).resolves.toBe("recovered");
  });

  it("lets the caller fall back when the rate limiter has no Redis", async () => {
    const result = await consumeRateLimit({
      action: "auth:signin",
      identifier: "203.0.113.9",
      limit: 5,
      windowSeconds: 900,
    });

    expect(result.supported).toBe(false);
    expect(result.allowed).toBe(true);
  });
});

describe("rate limit identifiers", () => {
  it("hashes the client identifier so raw IPs never reach Redis", () => {
    const hashed = rateLimitIdentifier("203.0.113.9");
    expect(hashed).toMatch(/^[0-9a-f]{32}$/);
    expect(hashed).not.toContain("203.0.113.9");
  });

  it("is stable for the same identifier and distinct across identifiers", () => {
    expect(rateLimitIdentifier("a@example.test")).toBe(
      rateLimitIdentifier("a@example.test"),
    );
    expect(rateLimitIdentifier("a@example.test")).not.toBe(
      rateLimitIdentifier("b@example.test"),
    );
  });
});

import { randomUUID } from "node:crypto";

import { neon } from "@neondatabase/serverless";
import { hash } from "bcrypt-ts";

import { cacheKey } from "../server/cache";
import { rateLimitIdentifier } from "../server/rate-limit";
import { redisConfigured, withRedis } from "../server/redis";

type JsonValue = Record<string, unknown>;

const databaseUrl = process.env.DATABASE_URL || "";
const baseUrl = (process.env.SMOKE_BASE_URL || "http://127.0.0.1:8080").replace(
  /\/$/,
  "",
);
if (!databaseUrl) throw new Error("Redis smoke test requires DATABASE_URL.");
if (!redisConfigured()) {
  throw new Error("Redis smoke test requires the Upstash environment.");
}

const sql = neon(databaseUrl);
const runId = randomUUID().replace(/-/g, "").slice(0, 12);
const ownerId = randomUUID();
const ownerEmail = `redis-owner-${runId}@example.test`;
const ownerShortId = `r${runId.slice(0, 4)}`;
const formId = randomUUID();
const formSlug = `redis-smoke-${runId}`;
// A distinct IP per run keeps the rate limit window from colliding with reruns.
const smokeIp = `198.51.100.${(parseInt(runId.slice(0, 2), 16) % 250) + 1}`;

let assertions = 0;

const assert = (condition: unknown, message: string) => {
  assertions += 1;
  if (!condition) throw new Error(message);
  console.log(`ok   ${message}`);
};

const request = async (
  path: string,
  options: { body?: JsonValue; token?: string; ip?: string } = {},
) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.body ? "POST" : "GET",
    headers: {
      Accept: "application/json",
      ...(options.ip ? { "X-Forwarded-For": options.ip } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let body: JsonValue = {};
  try {
    body = text ? (JSON.parse(text) as JsonValue) : {};
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  return { response, body };
};

const redisKeyExists = async (key: string) =>
  (await withRedis("exists", (redis) => redis.exists(key), 0)) === 1;

const cleanup = async () => {
  await sql.query(`DELETE FROM form_submissions WHERE form_id = $1`, [formId]);
  await sql.query(`DELETE FROM forms WHERE created_by = $1`, [ownerId]);
  await sql.query(`DELETE FROM activity_log WHERE user_id = $1`, [ownerId]);
  await sql.query(`DELETE FROM users WHERE id = $1`, [ownerId]);
  await withRedis(
    "cleanup",
    (redis) =>
      redis.del(
        cacheKey("workspace-short-id", ownerId),
        cacheKey("analytics", ownerId, 30),
        cacheKey("public-form", "-", formSlug),
        cacheKey("public-form", ownerShortId, formSlug),
        cacheKey("public-form", "-", formId),
        cacheKey("public-form", ownerShortId, formId),
        `mf:rl:auth:signin:${rateLimitIdentifier(smokeIp)}`,
      ),
    0,
  );
};

try {
  const password = `Secure-${runId}-Redis`;
  await sql.query(
    `INSERT INTO users (id, email, password_hash, full_name, short_id)
     VALUES ($1, $2, $3, 'Redis Smoke Owner', $4)`,
    [ownerId, ownerEmail, await hash(password, 10), ownerShortId],
  );
  await sql.query(
    `INSERT INTO forms (id, slug, title, description, status, created_by, fields, settings)
     VALUES ($1, $2, 'Redis smoke form', 'Original description', 'published', $3,
             '[]'::jsonb, '{}'::jsonb)`,
    [formId, formSlug, ownerId],
  );

  const signIn = await request("/api/auth?action=sign-in", {
    body: { email: ownerEmail, password },
    ip: smokeIp,
  });
  assert(signIn.response.ok, "the fixture account signed in");
  const token = String(signIn.body.access_token || "");

  // 1. Analytics is served from Redis on the second call.
  const analyticsKey = cacheKey("analytics", ownerId, 30);
  await withRedis("del", (redis) => redis.del(analyticsKey), 0);
  const firstAnalytics = await request("/api/analytics/data?range=30", {
    token,
  });
  assert(firstAnalytics.response.ok, "analytics loaded");
  assert(
    await redisKeyExists(analyticsKey),
    "analytics stored its payload in Redis",
  );
  const secondAnalytics = await request("/api/analytics/data?range=30", {
    token,
  });
  // generatedAt is stamped per computation, so an identical value proves the
  // second response was served from the cache rather than recomputed.
  assert(
    String(secondAnalytics.body.generatedAt) ===
      String(firstAnalytics.body.generatedAt) &&
      Boolean(firstAnalytics.body.generatedAt),
    "the second analytics call was served from cache, not recomputed",
  );

  // 2. The public form is cached, and publishing a change invalidates it.
  const publicFormKey = cacheKey("public-form", "-", formSlug);
  await withRedis("del", (redis) => redis.del(publicFormKey), 0);
  const firstForm = await request("/api/forms/data?action=rpc", {
    body: { operation: "getPublicForm", args: { formId: formSlug } },
  });
  assert(firstForm.response.ok, "the public form loaded without a session");
  const loaded = firstForm.body.value as JsonValue;
  assert(
    String(loaded?.title) === "Redis smoke form",
    "the public form returned its title",
  );
  assert(
    await redisKeyExists(publicFormKey),
    "the public form was stored in Redis",
  );

  const renamed = { ...loaded, title: "Redis smoke form renamed" };
  const saved = await request("/api/forms/data?action=rpc", {
    body: { operation: "saveWorkspaceForm", args: { form: renamed } },
    token,
  });
  assert(saved.response.ok, `the form was saved: ${String(saved.body.error || "")}`);
  assert(
    !(await redisKeyExists(publicFormKey)),
    "saving the form dropped its cached copy",
  );

  const afterSave = await request("/api/forms/data?action=rpc", {
    body: { operation: "getPublicForm", args: { formId: formSlug } },
  });
  assert(
    String((afterSave.body.value as JsonValue)?.title) ===
      "Redis smoke form renamed",
    "the public form serves the new title immediately after publishing",
  );

  // 3. Auth rate limiting counts in Redis, not in a per-instance map.
  const limitKey = `mf:rl:auth:signin:${rateLimitIdentifier(smokeIp)}`;
  await withRedis("del", (redis) => redis.del(limitKey), 0);
  let refusedAt = 0;
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const bad = await request("/api/auth?action=sign-in", {
      body: { email: ownerEmail, password: "wrong-password-value" },
      ip: smokeIp,
    });
    if (bad.response.status === 429) {
      refusedAt = attempt;
      break;
    }
  }
  assert(
    refusedAt === 11,
    `sign-in was refused on attempt 11, got ${refusedAt || "never"}`,
  );
  assert(
    await redisKeyExists(limitKey),
    "the sign-in counter lives in Redis, so it is shared across instances",
  );
  const ttl = await withRedis("ttl", (redis) => redis.ttl(limitKey), -2);
  assert(
    ttl > 0 && ttl <= 900,
    `the sign-in window expires on its own (ttl ${ttl}s)`,
  );

  // 4. The workspace short id is resolved from Redis after the first lookup.
  const shortIdKey = cacheKey("workspace-short-id", ownerId);
  await withRedis("del", (redis) => redis.del(shortIdKey), 0);
  await request("/api/storage?action=access-batch", {
    body: { objectIds: [randomUUID()] },
    token,
  });
  assert(
    await redisKeyExists(shortIdKey),
    "the workspace short id was cached in Redis",
  );
  assert(
    (await withRedis<unknown>("get", (redis) => redis.get(shortIdKey), null)) !==
      null,
    "the cached short id has a readable value",
  );

  console.log(`\nRedis smoke test passed (${assertions} assertions).`);
} finally {
  await cleanup();
}

import { neon } from "@neondatabase/serverless";

import { cacheDelete, cacheGet, cacheKey, cacheSet } from "../server/cache";
import { redisConfigured, withRedis } from "../server/redis";

// Compares a warm Redis read against the database it is standing in front of.
// Caching only pays off when the round trip to Upstash is meaningfully cheaper
// than the query, which depends on where both are hosted relative to the app.

const databaseUrl = process.env.DATABASE_URL || "";
if (!databaseUrl) throw new Error("The benchmark requires DATABASE_URL.");
if (!redisConfigured()) {
  throw new Error(
    "The benchmark requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.",
  );
}

const sql = neon(databaseUrl);
const runs = Number(process.env.BENCHMARK_RUNS || 15);

const percentile = (values: number[], fraction: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))
  ];
};

const measure = async (label: string, task: () => Promise<unknown>) => {
  await task(); // warm the connection so the handshake is not counted
  const timings: number[] = [];
  for (let run = 0; run < runs; run += 1) {
    const started = performance.now();
    await task();
    timings.push(performance.now() - started);
  }
  const mean = timings.reduce((total, value) => total + value, 0) / runs;
  console.log(
    `${label.padEnd(34)} mean ${mean.toFixed(1).padStart(7)}ms   ` +
      `p50 ${percentile(timings, 0.5).toFixed(1).padStart(7)}ms   ` +
      `p95 ${percentile(timings, 0.95).toFixed(1).padStart(7)}ms`,
  );
  return mean;
};

const key = cacheKey("analytics", `benchmark-${Date.now()}`);
// Roughly the shape and size of a cached analytics payload.
const payload = {
  generatedAt: new Date().toISOString(),
  daily: Array.from({ length: 30 }, (_, day) => ({
    day,
    responses: day * 7,
    revenue: day * 125.5,
    visitors: day * 31,
  })),
  topForms: Array.from({ length: 6 }, (_, index) => ({
    id: `form-${index}`,
    title: `Form number ${index}`,
    responses: index * 12,
  })),
};

try {
  console.log(`Each figure is the average of ${runs} runs.\n`);

  await cacheSet(key, payload, 300);
  const redisMean = await measure("Redis GET (warm, ~2KB)", () =>
    cacheGet(key),
  );

  const pingMean = await measure("Redis PING (round trip floor)", () =>
    withRedis("ping", (redis) => redis.ping(), ""),
  );

  const trivialMean = await measure("Postgres SELECT 1", () =>
    sql.query(`SELECT 1 AS ok`, []),
  );

  const aggregateMean = await measure(
    "Postgres analytics-style aggregate",
    () =>
      sql.query(
        `SELECT COUNT(*)::int AS forms,
                COUNT(DISTINCT created_by)::int AS owners,
                MAX(created_at) AS newest
         FROM forms`,
        [],
      ),
  );

  console.log("");
  console.log(
    `Redis round trip floor: ${pingMean.toFixed(1)}ms — a cached read cannot beat this.`,
  );
  const verdict =
    redisMean < trivialMean
      ? "Redis is closer to this machine than Postgres: caching helps everywhere."
      : redisMean < aggregateMean
        ? "Redis beats the aggregate query but not a trivial one: cache expensive reads only."
        : "Redis is slower than the database from here. Check that the Upstash region matches where the app is deployed.";
  console.log(verdict);
} finally {
  await cacheDelete(key);
}

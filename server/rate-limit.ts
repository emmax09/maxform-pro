import { createHash } from "node:crypto";

import { withRedis } from "./redis";

// Fixed-window rate limiting in Redis. Counters are shared across every
// serverless instance, which an in-process map cannot do, and cost one round
// trip instead of a database write.

export type RateLimitResult = {
  /** False when Redis is unavailable, so the caller can fall back. */
  supported: boolean;
  allowed: boolean;
  remaining: number;
};

const unsupported: RateLimitResult = {
  supported: false,
  allowed: true,
  remaining: Number.POSITIVE_INFINITY,
};

/** Client identifiers are hashed so raw IPs and emails never reach Redis. */
export const rateLimitIdentifier = (value: string) =>
  createHash("sha256").update(String(value || "unknown")).digest("hex").slice(0, 32);

export async function consumeRateLimit(input: {
  action: string;
  identifier: string;
  limit: number;
  windowSeconds: number;
}): Promise<RateLimitResult> {
  const limit = Math.max(1, Math.floor(input.limit));
  const windowSeconds = Math.max(1, Math.floor(input.windowSeconds));
  const key = `mf:rl:${input.action}:${rateLimitIdentifier(input.identifier)}`;

  const count = await withRedis<number | null>(
    "rate-limit",
    async (redis) => {
      // SET NX anchors the expiry to the start of the window so sustained
      // traffic cannot keep pushing the reset time forward; INCR then counts
      // this request. Both travel in one pipeline, so this is one round trip.
      const pipeline = redis.pipeline();
      pipeline.set(key, 0, { ex: windowSeconds, nx: true });
      pipeline.incr(key);
      const results = (await pipeline.exec()) as unknown[];
      const counted = Number(results[results.length - 1]);
      return Number.isFinite(counted) ? counted : null;
    },
    null,
  );

  if (count === null) return unsupported;
  return {
    supported: true,
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
  };
}

import { createHash } from "node:crypto";

import { getQueueRedis } from "../src/lib/queue/redis";

const windowMs = 60_000;

const reserveScript = `
  local amount = tonumber(ARGV[1])
  for index, key in ipairs(KEYS) do
    local current = tonumber(redis.call('GET', key) or '0')
    local limit = tonumber(ARGV[index + 1])
    if current + amount > limit then
      local ttl = redis.call('PTTL', key)
      if ttl < 0 then ttl = 60000 end
      return { 0, ttl }
    end
  end
  for index, key in ipairs(KEYS) do
    local value = redis.call('INCRBY', key, amount)
    if value == amount then redis.call('PEXPIRE', key, 60000) end
  end
  return { 1, 0 }
`;

const hash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 32);

export type CampaignRateLimitInput = {
  workspaceId: string;
  campaignId: string;
  provider: string;
  domain?: string;
  amount: number;
  workspacePerMinute?: number;
  domainPerMinute?: number;
  campaignPerMinute?: number;
  providerPerMinute?: number;
};

export type CampaignRateLimitResult = {
  allowed: boolean;
  retryAfterMs: number;
  redisBacked: boolean;
  scopes: string[];
};

const positive = (value: unknown, fallback: number) => {
  const numberValue = Math.floor(Number(value));
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : fallback;
};

export const campaignRateLimitKeys = (input: CampaignRateLimitInput) => {
  const domain = String(input.domain || "").trim().toLowerCase();
  return [
    [`workspace:${input.workspaceId}:send_rate`, positive(input.workspacePerMinute, 50), "workspace"],
    [`domain:${hash(domain || "unknown")}:send_rate`, positive(input.domainPerMinute, 100), "domain"],
    [`campaign:${input.campaignId}:send_rate`, positive(input.campaignPerMinute, 500), "campaign"],
    [`provider:${input.provider}:send_rate`, positive(input.providerPerMinute, 500), "provider"],
  ] as const;
};

/**
 * Reserves capacity for a whole batch atomically across all four scopes. A
 * failed reservation does not partially consume one of the other limits.
 */
export const consumeCampaignRateLimits = async (
  input: CampaignRateLimitInput,
): Promise<CampaignRateLimitResult> => {
  const amount = Math.max(1, Math.floor(Number(input.amount) || 0));
  const entries = campaignRateLimitKeys(input);
  const redis = getQueueRedis();
  if (!redis) {
    // The database claim and provider pacing remain the safe compatibility path
    // for local development. Production queue startup fails closed without TCP
    // Redis, so this branch cannot silently disable distributed limits there.
    return {
      allowed: true,
      retryAfterMs: 0,
      redisBacked: false,
      scopes: entries.map(([, , scope]) => scope),
    };
  }
  const result = (await redis.eval(
    reserveScript,
    entries.length,
    ...entries.map(([key]) => key),
    amount,
    ...entries.map(([, limit]) => limit),
  )) as [number, number];
  const allowed = Number(result?.[0]) === 1;
  return {
    allowed,
    retryAfterMs: allowed
      ? 0
      : Math.max(1_000, Math.min(windowMs, Number(result?.[1]) || windowMs)),
    redisBacked: true,
    scopes: entries.map(([, , scope]) => scope),
  };
};


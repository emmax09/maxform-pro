import { afterEach, describe, expect, it, vi } from "vitest";

import {
  campaignRateLimitKeys,
  consumeCampaignRateLimits,
} from "./campaign-rate-limit";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("campaign rate limiting", () => {
  it("creates workspace, domain, campaign, and provider scopes", () => {
    const keys = campaignRateLimitKeys({
      workspaceId: "workspace-1",
      campaignId: "campaign-1",
      provider: "resend",
      domain: "Mail.Example.com",
      amount: 20,
      workspacePerMinute: 50,
      domainPerMinute: 100,
      campaignPerMinute: 500,
      providerPerMinute: 300,
    });
    expect(keys.map(([, , scope]) => scope)).toEqual([
      "workspace",
      "domain",
      "campaign",
      "provider",
    ]);
    expect(keys[0]).toEqual(["workspace:workspace-1:send_rate", 50, "workspace"]);
    expect(keys[2]).toEqual(["campaign:campaign-1:send_rate", 500, "campaign"]);
  });

  it("keeps local development safe when TCP Redis is not configured", async () => {
    vi.stubEnv("UPSTASH_REDIS_HOST", "");
    vi.stubEnv("UPSTASH_REDIS_PASSWORD", "");
    const result = await consumeCampaignRateLimits({
      workspaceId: "workspace-1",
      campaignId: "campaign-1",
      provider: "resend",
      amount: 20,
    });
    expect(result).toMatchObject({ allowed: true, redisBacked: false });
  });
});


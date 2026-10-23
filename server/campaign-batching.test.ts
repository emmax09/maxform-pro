import { describe, expect, it } from "vitest";

import {
  campaignBulkThreshold,
  campaignDeliveryMode,
  describeSendDuration,
  fallbackRateLimit,
  planCampaignBatches,
  providerSendIntervalMs,
  sustainedRatePerSecond,
  type ProviderRateLimit,
} from "./campaign-batching";

describe("campaign delivery routing", () => {
  it("sends small campaigns directly and reserves the queue for bulk", () => {
    expect(campaignDeliveryMode(1)).toBe("direct");
    expect(campaignDeliveryMode(100)).toBe("direct");
    expect(campaignDeliveryMode(101)).toBe("bulk");
  });

  it("supports a bounded operator-defined bulk threshold", () => {
    expect(campaignBulkThreshold("25")).toBe(25);
    expect(campaignDeliveryMode(25, 25)).toBe("direct");
    expect(campaignDeliveryMode(26, 25)).toBe("bulk");
    expect(campaignBulkThreshold("invalid")).toBe(100);
  });
});

const resend: ProviderRateLimit = {
  provider: "resend",
  maxPerSecond: 2,
  maxPerHour: 3_000,
};
const ses: ProviderRateLimit = {
  provider: "ses",
  maxPerSecond: 14,
  maxPerHour: 50_000,
};

describe("sustained send rate", () => {
  it("lets the hourly ceiling bind when it is stricter than the per-second cap", () => {
    // 3000/hour is 0.83/second, well under the 2/second request cap.
    expect(sustainedRatePerSecond(resend)).toBeCloseTo(0.833, 2);
  });

  it("uses the same sustained rate for live dispatch pacing", () => {
    expect(providerSendIntervalMs(resend)).toBe(1_200);
    expect(providerSendIntervalMs(ses)).toBe(72);
  });

  it("lets the per-second cap bind when the hourly ceiling is generous", () => {
    expect(sustainedRatePerSecond(ses)).toBeCloseTo(13.889, 2);
  });

  it("falls back to the most conservative limit for nonsense input", () => {
    expect(
      sustainedRatePerSecond({
        provider: "broken",
        maxPerSecond: 0,
        maxPerHour: -5,
      }),
    ).toBe(sustainedRatePerSecond(fallbackRateLimit));
  });
});

describe("batch planning", () => {
  it.each([
    [20, 20, 1],
    [100, 50, 2],
    [10_000, 500, 20],
  ])("plans %i recipients through the same durable batching path", (recipientCount, batchSize, expectedBatches) => {
    const plan = planCampaignBatches({
      recipientCount,
      limit: { provider: "fixture", maxPerSecond: 1_000, maxPerHour: 60_000 },
      overrides: { batchSize },
    });
    expect(plan.batchCount).toBe(expectedBatches);
    expect(plan.batchSize).toBe(batchSize);
  });

  it("keeps a campaign inside the provider's hourly ceiling", () => {
    const plan = planCampaignBatches({ recipientCount: 5_000, limit: resend });
    const perHour = (plan.batchSize / plan.batchDelaySeconds) * 3_600;
    expect(perHour).toBeLessThanOrEqual(resend.maxPerHour);
  });

  it("never plans a wave larger than a few hundred, however fast the provider", () => {
    const plan = planCampaignBatches({
      recipientCount: 100_000,
      limit: { provider: "huge", maxPerSecond: 500, maxPerHour: 5_000_000 },
    });
    expect(plan.batchSize).toBe(500);
  });

  it("covers every recipient across its waves", () => {
    const plan = planCampaignBatches({ recipientCount: 5_000, limit: resend });
    expect(plan.batchCount * plan.batchSize).toBeGreaterThanOrEqual(5_000);
    expect((plan.batchCount - 1) * plan.batchSize).toBeLessThan(5_000);
  });

  it("plans a single wave for a list that fits in one", () => {
    const plan = planCampaignBatches({ recipientCount: 12, limit: ses });
    expect(plan.batchCount).toBe(1);
    // A lone wave has no inter-batch pause to wait through.
    expect(plan.estimatedDurationSeconds).toBeLessThan(
      plan.batchDelaySeconds,
    );
  });

  it("plans nothing for an empty audience", () => {
    const plan = planCampaignBatches({ recipientCount: 0, limit: ses });
    expect(plan.batchCount).toBe(0);
    expect(plan.estimatedDurationSeconds).toBe(0);
  });

  it("uses the most conservative limit when no provider is connected", () => {
    const plan = planCampaignBatches({ recipientCount: 1_000, limit: null });
    const perHour = (plan.batchSize / plan.batchDelaySeconds) * 3_600;
    expect(perHour).toBeLessThanOrEqual(fallbackRateLimit.maxPerHour);
  });

  it("treats an absent override as absent, not as a zero-second delay", () => {
    // Number(null) is 0, which would otherwise read as "send waves instantly".
    const explicit = planCampaignBatches({
      recipientCount: 1_000,
      limit: fallbackRateLimit,
      overrides: { batchSize: null, batchDelaySeconds: null },
    });
    const omitted = planCampaignBatches({
      recipientCount: 1_000,
      limit: fallbackRateLimit,
    });
    expect(explicit).toEqual(omitted);
    expect(explicit.batchDelaySeconds).toBe(60);
  });

  it("honours a workspace override that stays within the provider's rate", () => {
    const plan = planCampaignBatches({
      recipientCount: 1_000,
      limit: ses,
      overrides: { batchSize: 100, batchDelaySeconds: 120 },
    });
    expect(plan.batchSize).toBe(100);
    expect(plan.batchDelaySeconds).toBe(120);
  });

  it("stretches the delay when an override would outrun the provider", () => {
    // 500 every 10s is 50/second — far past what Resend accepts.
    const plan = planCampaignBatches({
      recipientCount: 5_000,
      limit: resend,
      overrides: { batchSize: 500, batchDelaySeconds: 10 },
    });
    expect(plan.batchSize).toBe(500);
    expect(plan.batchDelaySeconds).toBeGreaterThan(10);
    const perSecond = plan.batchSize / plan.batchDelaySeconds;
    expect(perSecond).toBeLessThanOrEqual(sustainedRatePerSecond(resend) + 0.01);
  });

  it("estimates a longer send for a bigger list on the same provider", () => {
    const small = planCampaignBatches({ recipientCount: 500, limit: resend });
    const large = planCampaignBatches({ recipientCount: 5_000, limit: resend });
    expect(large.estimatedDurationSeconds).toBeGreaterThan(
      small.estimatedDurationSeconds,
    );
  });

  it("estimates a faster send on a provider that allows more throughput", () => {
    const slow = planCampaignBatches({ recipientCount: 10_000, limit: resend });
    const fast = planCampaignBatches({ recipientCount: 10_000, limit: ses });
    expect(fast.estimatedDurationSeconds).toBeLessThan(
      slow.estimatedDurationSeconds,
    );
  });
});

describe("duration wording", () => {
  it("describes each magnitude the way a person would say it", () => {
    expect(describeSendDuration(0)).toBe("less than a minute");
    expect(describeSendDuration(45)).toBe("less than a minute");
    expect(describeSendDuration(60)).toBe("about 1 minute");
    expect(describeSendDuration(12 * 60)).toBe("about 12 minutes");
    expect(describeSendDuration(3_600)).toBe("about 1 hour");
    expect(describeSendDuration(3_600 + 25 * 60)).toBe("about 1h 25m");
    expect(describeSendDuration(2 * 3_600)).toBe("about 2 hours");
  });
});

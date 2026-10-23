/**
 * Batch pacing for campaign sends.
 *
 * Bulk campaigns never go out in one blast. Providers enforce their own
 * per-second caps, and a sudden spike from an address that normally sends a
 * trickle reads as spam behaviour to receiving servers. The plan below spaces
 * a bulk send into waves that stay under both the provider's hard per-second
 * limit and its per-hour ceiling. Small campaigns use the direct path and are
 * accepted by the provider in the initiating request.
 *
 * Everything here is pure so the pacing a user is promised in the wizard is the
 * same arithmetic the dispatcher actually runs.
 */

export type ProviderRateLimit = {
  provider: string;
  maxPerSecond: number;
  maxPerHour: number;
  maxBatchSize?: number;
};

export type BatchPlan = {
  batchSize: number;
  batchDelaySeconds: number;
  batchCount: number;
  estimatedDurationSeconds: number;
};

export type CampaignDeliveryMode = "direct" | "bulk";

// A campaign at or below this size bypasses BullMQ and starts provider
// delivery in the request that initiated it. Operators can lower or raise the
// boundary with CAMPAIGN_BULK_THRESHOLD without changing delivery code.
export const DEFAULT_BULK_CAMPAIGN_THRESHOLD = 100;

export const campaignBulkThreshold = (value: unknown) => {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(5_000, parsed)
    : DEFAULT_BULK_CAMPAIGN_THRESHOLD;
};

export const campaignDeliveryMode = (
  recipientCount: number,
  threshold = DEFAULT_BULK_CAMPAIGN_THRESHOLD,
): CampaignDeliveryMode =>
  Math.max(0, Math.floor(Number(recipientCount) || 0)) >
  campaignBulkThreshold(threshold)
    ? "bulk"
    : "direct";

// The dispatcher is driven by a once-a-minute cron tick. Keep the work inside
// each invocation to roughly 30 seconds so a serverless worker has room for
// database/provider latency; the next wave is still released on the next
// minute boundary.
const DEFAULT_WINDOW_SECONDS = 60;
const DEFAULT_DISPATCH_WINDOW_SECONDS = 30;

// "A few hundred at a time" — big enough that a large list finishes in a
// sensible number of waves, small enough to stay unremarkable to a receiving
// server even on a provider that would allow far more.
const MAX_BATCH_SIZE = 500;

// The most conservative provider in the table. Used when a workspace has no
// connected provider yet, so an unknown setup is never paced optimistically.
export const fallbackRateLimit: ProviderRateLimit = {
  provider: "smtp",
  maxPerSecond: 3,
  maxPerHour: 1_000,
};

const positiveInteger = (value: unknown, fallback: number) => {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * The sustained send rate that satisfies both published limits. The per-hour
 * ceiling usually binds first: a provider that allows 2/second but only
 * 3000/hour really means 0.83/second sustained.
 */
export const sustainedRatePerSecond = (limit: ProviderRateLimit) => {
  const perSecond = positiveInteger(
    limit.maxPerSecond,
    fallbackRateLimit.maxPerSecond,
  );
  const perHour = positiveInteger(
    limit.maxPerHour,
    fallbackRateLimit.maxPerHour,
  );
  return Math.min(perSecond, perHour / 3_600);
};

/**
 * Minimum gap between provider requests when a batch is being delivered.
 * Planning uses the same sustained rate, so a batch cannot be planned safely
 * and then burst out faster at dispatch time.
 */
export const providerSendIntervalMs = (limit: ProviderRateLimit) =>
  Math.max(1, Math.ceil(1_000 / sustainedRatePerSecond(limit)));

export function planCampaignBatches(input: {
  recipientCount: number;
  limit?: ProviderRateLimit | null;
  overrides?: {
    batchSize?: number | null;
    batchDelaySeconds?: number | null;
  } | null;
}): BatchPlan {
  const limit = input.limit || fallbackRateLimit;
  const recipientCount = Math.max(0, Math.floor(Number(input.recipientCount) || 0));
  const sustained = sustainedRatePerSecond(limit);

  const defaultBatchSize = Math.max(
    1,
    Math.min(
      MAX_BATCH_SIZE,
      positiveInteger(limit.maxBatchSize, MAX_BATCH_SIZE),
      Math.floor(sustained * DEFAULT_DISPATCH_WINDOW_SECONDS),
    ),
  );

  // An absent override must not collapse to 0: Number(null) is 0, and a zero
  // delay would read as "send every wave immediately".
  const rawSize = input.overrides?.batchSize;
  const rawDelay = input.overrides?.batchDelaySeconds;
  const requestedSize = rawSize == null ? Number.NaN : Number(rawSize);
  const requestedDelay = rawDelay == null ? Number.NaN : Number(rawDelay);
  const hasSizeOverride = Number.isFinite(requestedSize) && requestedSize > 0;
  const hasDelayOverride =
    Number.isFinite(requestedDelay) && requestedDelay >= 0;

  const batchSize = hasSizeOverride
    ? Math.max(1, Math.min(5_000, positiveInteger(limit.maxBatchSize, 5_000), Math.floor(requestedSize)))
    : defaultBatchSize;

  const requestedDelaySeconds = hasDelayOverride
    ? Math.max(0, Math.min(3_600, Math.floor(requestedDelay)))
    : DEFAULT_WINDOW_SECONDS;

  // An override can pick the wave size and the spacing, but not a combination
  // that exceeds the provider's own sustained rate: going over does not send
  // faster, it gets the requests rejected. The delay is stretched to fit.
  const minimumDelayForRate = Math.ceil(batchSize / sustained);
  const batchDelaySeconds = Math.max(
    requestedDelaySeconds,
    Math.min(3_600, minimumDelayForRate),
  );

  const batchCount = Math.ceil(recipientCount / batchSize) || 0;
  // Waves are spaced by the delay; the final wave still needs the time to push
  // its own messages out at the same sustained rate used by the dispatcher.
  const finalWaveSeconds = batchCount ? Math.ceil(batchSize / sustained) : 0;
  const estimatedDurationSeconds = batchCount
    ? (batchCount - 1) * batchDelaySeconds + finalWaveSeconds
    : 0;

  return {
    batchSize,
    batchDelaySeconds,
    batchCount,
    estimatedDurationSeconds,
  };
}

/**
 * Plain-language duration for the wizard: users are told how long a send takes
 * before they commit to it, rather than watching an unexplained progress bar.
 */
export function describeSendDuration(seconds: number) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  if (total < 60) return "less than a minute";
  const minutes = Math.round(total / 60);
  if (minutes < 60) {
    return `about ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }
  const hours = Math.floor(total / 3_600);
  const remainingMinutes = Math.round((total % 3_600) / 60);
  if (!remainingMinutes) {
    return `about ${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  return `about ${hours}h ${remainingMinutes}m`;
}

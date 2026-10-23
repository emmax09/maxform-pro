import { createCampaignDatabase } from "./campaign-database";

type DatabaseRow = Record<string, unknown>;

const database = () => {
  const url = String(process.env.DATABASE_URL || "").trim();
  if (!url) throw new Error("Campaign reputation database is unavailable.");
  return createCampaignDatabase(url);
};

const number = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const text = (value: unknown, max = 500) => String(value ?? "").trim().slice(0, max);

const ratio = (value: number, total: number) => (total > 0 ? value / total : 0);

const threshold = (name: string, fallback: number) => {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

export type CampaignReputationResult = {
  campaignId: string;
  workspaceId: string;
  provider: string;
  attempted: number;
  accepted: number;
  delivered: number;
  hardBounces: number;
  temporaryFailures: number;
  complaints: number;
  unsubscribes: number;
  bounceRate: number;
  complaintRate: number;
  temporaryFailureRate: number;
  slowed: boolean;
  paused: boolean;
  pauseReason: string;
};

/**
 * Rebuilds the small reputation read model after a delivery wave. Thresholds
 * are intentionally conservative and configurable through environment values.
 */
export const evaluateCampaignReputation = async (
  campaignId: string,
): Promise<CampaignReputationResult | null> => {
  const sql = database();
  const rows = (await sql.query(
    `SELECT campaign.id, campaign.user_id, campaign.status,
            COALESCE(NULLIF(MAX(log.provider), ''), '') AS provider,
            COUNT(DISTINCT message.id) FILTER (
              WHERE message.status NOT IN ('queued', 'processing', 'sending', 'skipped', 'cancelled')
                 OR (
                   message.attempt_count > 0
                   AND message.status NOT IN ('skipped', 'cancelled')
                 )
            )::int AS attempted,
            COUNT(DISTINCT message.id) FILTER (
              WHERE message.status IN ('sent', 'delivered', 'opened', 'clicked')
            )::int AS accepted,
            COUNT(DISTINCT message.id) FILTER (WHERE message.delivered_at IS NOT NULL)::int AS delivered,
            COUNT(DISTINCT message.id) FILTER (
              WHERE message.status = 'hard_bounce' OR message.failure_kind = 'hard_bounce'
            )::int AS hard_bounces,
            COUNT(DISTINCT message.id) FILTER (
              WHERE message.failure_kind = 'temporary'
                 OR message.status = 'failed' AND message.failure_kind <> 'permanent'
            )::int AS temporary_failures,
            COUNT(DISTINCT message.id) FILTER (WHERE message.status = 'complained')::int AS complaints,
            COUNT(DISTINCT message.id) FILTER (WHERE message.status = 'unsubscribed')::int AS unsubscribes
     FROM contact_campaigns campaign
     LEFT JOIN contact_campaign_messages message ON message.campaign_id = campaign.id
     LEFT JOIN email_logs log
       ON log.source_event_id = campaign.id
      AND log.recipient = message.recipient
     WHERE campaign.id = $1::uuid
     GROUP BY campaign.id, campaign.user_id, campaign.status
     LIMIT 1`,
    [campaignId],
  )) as DatabaseRow[];
  const row = rows[0];
  if (!row) return null;

  const attempted = number(row.attempted);
  const hardBounces = number(row.hard_bounces);
  const temporaryFailures = number(row.temporary_failures);
  const complaints = number(row.complaints);
  const bounceRate = ratio(hardBounces, attempted);
  const complaintRate = ratio(complaints, attempted);
  const temporaryFailureRate = ratio(temporaryFailures, attempted);
  const hardBounceThreshold = threshold("CAMPAIGN_HARD_BOUNCE_PAUSE_RATE", 0.04);
  const complaintThreshold = threshold("CAMPAIGN_COMPLAINT_PAUSE_RATE", 0.001);
  const temporaryPauseThreshold = threshold("CAMPAIGN_TEMPORARY_FAILURE_PAUSE_RATE", 0.2);
  const temporarySlowThreshold = threshold("CAMPAIGN_TEMPORARY_FAILURE_SLOW_RATE", 0.1);
  const pauseReason =
    bounceRate > hardBounceThreshold
      ? `Hard bounce rate exceeded ${(hardBounceThreshold * 100).toFixed(2)}%.`
      : complaintRate > complaintThreshold
        ? `Complaint rate exceeded ${(complaintThreshold * 100).toFixed(3)}%.`
        : temporaryFailureRate > temporaryPauseThreshold
          ? `Temporary failure rate exceeded ${(temporaryPauseThreshold * 100).toFixed(0)}%.`
          : "";
  const paused = Boolean(pauseReason);
  const slowed = !paused && temporaryFailureRate > temporarySlowThreshold;
  const provider = text(row.provider, 32);
  const workspaceId = text(row.user_id, 64);

  await sql.query(
    `INSERT INTO campaign_reputation_snapshots (
       workspace_id, campaign_id, provider, attempted_count, accepted_count,
       delivered_count, hard_bounce_count, temporary_failure_count,
       complaint_count, unsubscribe_count, bounce_rate, complaint_rate,
       temporary_failure_rate, paused, pause_reason, updated_at
     ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10,
               $11, $12, $13, $14, $15, NOW())
     ON CONFLICT (workspace_id, campaign_id) DO UPDATE SET
       provider = EXCLUDED.provider,
       attempted_count = EXCLUDED.attempted_count,
       accepted_count = EXCLUDED.accepted_count,
       delivered_count = EXCLUDED.delivered_count,
       hard_bounce_count = EXCLUDED.hard_bounce_count,
       temporary_failure_count = EXCLUDED.temporary_failure_count,
       complaint_count = EXCLUDED.complaint_count,
       unsubscribe_count = EXCLUDED.unsubscribe_count,
       bounce_rate = EXCLUDED.bounce_rate,
       complaint_rate = EXCLUDED.complaint_rate,
       temporary_failure_rate = EXCLUDED.temporary_failure_rate,
       paused = EXCLUDED.paused,
       pause_reason = EXCLUDED.pause_reason,
       updated_at = NOW()`,
    [
      workspaceId,
      campaignId,
      provider,
      attempted,
      number(row.accepted),
      number(row.delivered),
      hardBounces,
      temporaryFailures,
      complaints,
      number(row.unsubscribes),
      bounceRate,
      complaintRate,
      temporaryFailureRate,
      paused,
      pauseReason,
    ],
  );

  if (paused) {
    await sql.query(
      `UPDATE contact_campaigns
       SET status = 'paused', updated_at = NOW()
       WHERE id = $1::uuid AND status IN ('scheduled', 'queued', 'sending')`,
      [campaignId],
    );
    await sql.query(
      `UPDATE campaign_send_batches
       SET status = 'paused', last_error = $2, updated_at = NOW()
       WHERE campaign_id = $1::uuid AND status IN ('pending', 'queued')`,
      [campaignId, pauseReason],
    );
    await sql.query(
      `UPDATE contact_campaign_messages
       SET status = 'skipped', failure_kind = 'permanent',
           failure_reason = $2, suppression_reason = 'reputation_pause',
           skipped_at = NOW(), updated_at = NOW()
       WHERE campaign_id = $1::uuid AND status IN ('queued', 'processing')`,
      [campaignId, pauseReason],
    );
    if (provider) {
      await sql.query(
        `INSERT INTO campaign_provider_queue_state (
           workspace_id, provider, paused, pause_reason, paused_at, updated_at
         ) VALUES ($1::uuid, $2, TRUE, $3, NOW(), NOW())
         ON CONFLICT (workspace_id, provider) DO UPDATE SET
           paused = TRUE, pause_reason = EXCLUDED.pause_reason,
           paused_at = NOW(), updated_at = NOW()`,
        [workspaceId, provider, pauseReason],
      );
    }
  }

  return {
    campaignId,
    workspaceId,
    provider,
    attempted,
    accepted: number(row.accepted),
    delivered: number(row.delivered),
    hardBounces,
    temporaryFailures,
    complaints,
    unsubscribes: number(row.unsubscribes),
    bounceRate,
    complaintRate,
    temporaryFailureRate,
    slowed,
    paused,
    pauseReason,
  };
};

export const providerQueueIsPaused = async (workspaceId: string, provider: string) => {
  const rows = (await database().query(
    `SELECT paused FROM campaign_provider_queue_state
     WHERE workspace_id = $1::uuid AND provider = $2 LIMIT 1`,
    [workspaceId, provider],
  )) as DatabaseRow[];
  return rows[0]?.paused === true;
};

export const clearProviderQueuePause = async (workspaceId: string, provider: string) => {
  await database().query(
    `UPDATE campaign_provider_queue_state
     SET paused = FALSE, pause_reason = '', updated_at = NOW()
     WHERE workspace_id = $1::uuid AND provider = $2`,
    [workspaceId, provider],
  );
};

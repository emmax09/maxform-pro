/**
 * End-to-end check of the batch dispatcher against a real database.
 *
 * Proves the parts a unit test cannot: that recipients are split into durable
 * waves, that pausing stops the ones still waiting, that resuming picks up
 * where it stopped, and that a recipient already sent to is never queued again.
 *
 * No mail leaves the workspace: the campaign's messages are inspected directly
 * rather than dispatched through a provider.
 */
import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";

import {
  dispatchDueCampaignBatches,
  pauseCampaignBatches,
  planCampaignSend,
  previewCampaignPacing,
  resumeCampaignBatches,
  getCampaignSendProgress,
} from "../server/campaign-dispatch";
import {
  getCampaignAnalytics,
  getCampaignClickMap,
  pauseContactCampaign,
  resumeContactCampaign,
} from "../server/contacts-data";
import { recordCampaignMessageEvent } from "../server/campaign-tracking";
import { processCampaignAnalyticsEvents } from "../server/campaign-analytics-engine";
import { closeQueueRedis } from "../src/lib/queue/redis";
import { closeQueues } from "../src/lib/queue/queues";

const databaseUrl = process.env.DATABASE_URL || "";
if (!databaseUrl) throw new Error("Dispatch smoke test requires DATABASE_URL.");

const sql = neon(databaseUrl);
const suffix = randomUUID().replaceAll("-", "");

let assertions = 0;
const check = (condition: unknown, message: string) => {
  if (!condition) throw new Error(`Dispatch smoke check failed: ${message}`);
  assertions += 1;
};

const eventually = async (
  predicate: () => Promise<boolean>,
  message: string,
  attempts = 24,
) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Dispatch smoke check failed: ${message}`);
};

const users = await sql.query(
  `INSERT INTO users (email, password_hash, full_name, short_id)
   VALUES ($1, 'non-login-smoke-account', 'Dispatch Smoke', $2)
   RETURNING id`,
  [`dispatch-smoke-${suffix}@example.test`, suffix.slice(0, 5)],
);
const userId = String(users[0].id);

const cleanup = async () => {
  await sql.query(`DELETE FROM company_settings WHERE user_id = $1`, [userId]);
  await sql.query(`DELETE FROM email_logs WHERE user_id = $1`, [userId]);
  await sql.query(`DELETE FROM email_settings WHERE user_id = $1`, [userId]);
  await sql.query(`DELETE FROM contact_campaigns WHERE user_id = $1`, [userId]);
  await sql.query(`DELETE FROM contacts WHERE created_by = $1`, [userId]);
  await sql.query(`DELETE FROM contact_lists WHERE user_id = $1`, [userId]);
  await sql.query(`DELETE FROM users WHERE id = $1`, [userId]);
};

try {
  const lists = await sql.query(
    `INSERT INTO contact_lists (user_id, created_by, name, list_type)
     VALUES ($1, $1, 'Dispatch smoke list', 'static')
     RETURNING id`,
    [userId],
  );
  const listId = String(lists[0].id);

  await sql.query(
    `INSERT INTO company_settings (user_id, company_name, address)
     VALUES ($1, 'Dispatch Smoke', '1 Smoke Street, Lagos, Nigeria')`,
    [userId],
  );

  const campaigns = await sql.query(
    `INSERT INTO contact_campaigns (
       user_id, name, list_id, subject, preview_text, html_body, status
     )
     VALUES ($1, 'Dispatch smoke', $2, 'Subject', 'Preheader',
             '<p>Body</p>', 'sending')
     RETURNING id`,
    [userId, listId],
  );
  const campaignId = String(campaigns[0].id);

  // 100 queued recipients, exactly as the wizard would leave them.
  const recipientCount = 100;
  // Keep the smoke test representative without turning setup into 200 serial
  // Neon round trips. The production queue is also written in set-based SQL.
  await sql.query(
    `WITH created_contacts AS (
       INSERT INTO contacts (created_by, full_name, email)
       SELECT $1,
              'Dispatch ' || sequence::text,
              'dispatch-' || sequence::text || '-' || $2 || '@example.test'
       FROM generate_series(0, $3::int - 1) AS sequence
       RETURNING id, email
     )
     INSERT INTO contact_campaign_messages (
       campaign_id, contact_id, recipient, status, scheduled_for
     )
     SELECT $4, id, email, 'queued', NOW()
     FROM created_contacts`,
    [userId, suffix, recipientCount, campaignId],
  );

  // The pacing quoted to the user is the pacing that gets planned.
  const quoted = await previewCampaignPacing(userId, campaignId, recipientCount);
  const plan = await planCampaignSend(userId, campaignId);
  check(
    plan.batchSize === quoted.batchSize &&
      plan.batchDelaySeconds === quoted.batchDelaySeconds &&
      plan.batchCount === quoted.batchCount,
    "the wizard's quoted pacing matches what the dispatcher plans",
  );

  const batches = (await sql.query(
    `SELECT batch_number, recipient_count, status, scheduled_for
     FROM campaign_send_batches WHERE campaign_id = $1
     ORDER BY batch_number`,
    [campaignId],
  )) as Array<Record<string, unknown>>;
  check(batches.length === plan.batchCount, "every planned wave is persisted");
  check(
    batches.reduce((total, row) => total + Number(row.recipient_count), 0) ===
      recipientCount,
    "the waves together cover every recipient exactly once",
  );

  // Wave N is spaced from wave N-1 by the plan's delay.
  if (batches.length > 1) {
    const first = new Date(String(batches[0].scheduled_for)).getTime();
    const second = new Date(String(batches[1].scheduled_for)).getTime();
    check(
      Math.round((second - first) / 1_000) === plan.batchDelaySeconds,
      "waves are spaced by the planned delay",
    );
  }

  const assigned = (await sql.query(
    `SELECT COUNT(*)::int AS count FROM contact_campaign_messages
     WHERE campaign_id = $1 AND batch_id IS NOT NULL`,
    [campaignId],
  )) as Array<Record<string, unknown>>;
  check(
    Number(assigned[0].count) === recipientCount,
    "every recipient is assigned to a wave",
  );

  // Simulate the first wave having gone out.
  const firstBatch = (await sql.query(
    `SELECT id FROM campaign_send_batches
     WHERE campaign_id = $1 ORDER BY batch_number LIMIT 1`,
    [campaignId],
  )) as Array<Record<string, unknown>>;
  const firstBatchId = String(firstBatch[0].id);
  await sql.query(
    `UPDATE contact_campaign_messages
     SET status = 'sent', sent_at = NOW() WHERE batch_id = $1`,
    [firstBatchId],
  );
  await sql.query(
    `UPDATE campaign_send_batches
     SET status = 'sent', sent_count = recipient_count, completed_at = NOW()
     WHERE id = $1`,
    [firstBatchId],
  );

  const midProgress = await getCampaignSendProgress(userId, campaignId);
  check(
    midProgress.sent === plan.batchSize &&
      midProgress.totalRecipients === recipientCount,
    "progress reports real delivered counts, not a spinner",
  );
  check(midProgress.batchesSent === 1, "progress counts completed waves");

  // Pausing stops what has not gone out, and leaves what has alone.
  const paused = await pauseCampaignBatches(campaignId);
  check(paused === plan.batchCount - 1, "pausing halts every pending wave");
  const stillSent = (await sql.query(
    `SELECT COUNT(*)::int AS count FROM contact_campaign_messages
     WHERE campaign_id = $1 AND status = 'sent'`,
    [campaignId],
  )) as Array<Record<string, unknown>>;
  check(
    Number(stillSent[0].count) === plan.batchSize,
    "recipients already sent to keep their sent status through a pause",
  );

  // Resuming re-times the remainder from now and never revisits wave one.
  const resumeAt = new Date();
  const resumed = await resumeCampaignBatches(campaignId, resumeAt);
  check(resumed === plan.batchCount - 1, "resuming restores every paused wave");
  const afterResume = (await sql.query(
    `SELECT status, scheduled_for FROM campaign_send_batches
     WHERE campaign_id = $1 ORDER BY batch_number`,
    [campaignId],
  )) as Array<Record<string, unknown>>;
  check(
    String(afterResume[0].status) === "sent",
    "the wave that already went out is untouched by a resume",
  );
  check(
    afterResume.slice(1).every((row) => String(row.status) === "pending"),
    "the remaining waves are pending again",
  );
  check(
    new Date(String(afterResume[1].scheduled_for)).getTime() >=
      resumeAt.getTime() - 1_000,
    "the remainder is re-timed from the resume, not the original schedule",
  );

  // Re-planning after a resume must not hand an already-sent recipient a
  // second wave.
  const replanned = await planCampaignSend(userId, campaignId);
  check(
    replanned.batchCount === 0,
    "re-planning finds nothing left to assign, so nobody is queued twice",
  );
  // Keep the earlier campaign's resumed waves out of the scheduler assertion
  // below; otherwise they can legitimately win the due-batch ordering race.
  await pauseCampaignBatches(campaignId);

  // A workspace with no connected provider must not report a delivered send.
  // This is the check that would have caught "it says sent but nothing arrived".
  const providers = (await sql.query(
    `SELECT COUNT(*)::int AS count FROM email_provider_connections
     WHERE user_id = $1 AND status = 'connected'`,
    [userId],
  )) as Array<Record<string, unknown>>;
  check(
    Number(providers[0]?.count || 0) === 0,
    "this smoke workspace genuinely has no provider connected",
  );

  // A scheduled campaign must become claimable at its due instant. This is
  // deliberately run without a provider, so the smoke test proves the
  // scheduler transitions the campaign and records the delivery failure
  // without sending anything externally.
  const scheduledCampaign = (await sql.query(
    `INSERT INTO contact_campaigns (
       user_id, name, list_id, subject, html_body, status, scheduled_at
     )
     VALUES ($1, 'Due schedule smoke', $2, 'Subject', '<p>Body</p>',
             'scheduled', NOW() - INTERVAL '1 minute')
     RETURNING id`,
    [userId, listId],
  )) as Array<Record<string, unknown>>;
  const scheduledCampaignId = String(scheduledCampaign[0].id);
  const scheduledContact = (await sql.query(
    `INSERT INTO contacts (created_by, full_name, email)
     VALUES ($1, 'Due Schedule', $2) RETURNING id`,
    [userId, `due-schedule-${suffix}@example.test`],
  )) as Array<Record<string, unknown>>;
  const scheduledBatch = (await sql.query(
    `INSERT INTO campaign_send_batches (
       campaign_id, batch_number, recipient_count, status,
       scheduled_for
     )
     VALUES ($1, 1, 1, 'pending', NOW() - INTERVAL '1 minute')
     RETURNING id`,
    [scheduledCampaignId],
  )) as Array<Record<string, unknown>>;
  await sql.query(
    `INSERT INTO contact_campaign_messages (
       campaign_id, contact_id, recipient, status, scheduled_for, batch_id
     )
     VALUES ($1, $2, $3, 'queued', NOW() - INTERVAL '1 minute', $4)`,
    [
      scheduledCampaignId,
      String(scheduledContact[0].id),
      `due-schedule-${suffix}@example.test`,
      String(scheduledBatch[0].id),
    ],
  );
  const due = await dispatchDueCampaignBatches(1, userId);
  check(due.batchCount === 1, "a due scheduled campaign is claimed by the worker");
  const dueState = (await sql.query(
    `SELECT status FROM contact_campaigns WHERE id = $1`,
    [scheduledCampaignId],
  )) as Array<Record<string, unknown>>;
  check(
    String(dueState[0]?.status) !== "scheduled",
    "a due campaign does not remain stuck in scheduled status",
  );

  // A paused campaign that has not dispatched a wave keeps its original
  // schedule when it is resumed, and accepts a replacement future time.
  const preSendCampaign = (await sql.query(
    `INSERT INTO contact_campaigns (
       user_id, name, list_id, subject, html_body, status, scheduled_at
     )
     VALUES ($1, 'Pre-send pause smoke', $2, 'Subject', '<p>Body</p>',
             'scheduled', NOW() + INTERVAL '2 hours')
     RETURNING id, scheduled_at`,
    [userId, listId],
  )) as Array<Record<string, unknown>>;
  const preSendCampaignId = String(preSendCampaign[0].id);
  const preSendContact = (await sql.query(
    `INSERT INTO contacts (created_by, full_name, email)
     VALUES ($1, 'Pre-send Pause', $2) RETURNING id`,
    [userId, `pre-send-${suffix}@example.test`],
  )) as Array<Record<string, unknown>>;
  await sql.query(
    `INSERT INTO contact_list_members (list_id, contact_id)
     VALUES ($1, $2)`,
    [listId, String(preSendContact[0].id)],
  );
  const preSendBatch = (await sql.query(
    `INSERT INTO campaign_send_batches (
       campaign_id, batch_number, recipient_count, status,
       scheduled_for
     )
     VALUES ($1, 1, 1, 'pending', NOW() + INTERVAL '2 hours')
     RETURNING id`,
    [preSendCampaignId],
  )) as Array<Record<string, unknown>>;
  await sql.query(
    `INSERT INTO contact_campaign_messages (
       campaign_id, contact_id, recipient, status, scheduled_for, batch_id
     )
     VALUES ($1, $2, $3, 'queued', NOW() + INTERVAL '2 hours', $4)`,
    [
      preSendCampaignId,
      String(preSendContact[0].id),
      `pre-send-${suffix}@example.test`,
      String(preSendBatch[0].id),
    ],
  );
  const cancelled = await pauseContactCampaign(userId, preSendCampaignId);
  check(cancelled === 1, "pausing a scheduled campaign cancels its queued message");
  const pausedState = (await sql.query(
    `SELECT campaign.status, batch.status AS batch_status,
            message.status AS message_status
     FROM contact_campaigns campaign
     JOIN campaign_send_batches batch ON batch.campaign_id = campaign.id
     JOIN contact_campaign_messages message ON message.campaign_id = campaign.id
     WHERE campaign.id = $1`,
    [preSendCampaignId],
  )) as Array<Record<string, unknown>>;
  check(
    String(pausedState[0]?.status) === "paused" &&
      String(pausedState[0]?.batch_status) === "paused" &&
      String(pausedState[0]?.message_status) === "cancelled",
    "a pre-send pause stops its batch and records the message as cancelled",
  );
  const replacementTime = new Date(Date.now() + 3 * 60 * 60 * 1_000);
  const resumedPreSend = await resumeContactCampaign(
    userId,
    preSendCampaignId,
    replacementTime.toISOString(),
  );
  check(resumedPreSend === 1, "a pre-send campaign resumes with one queued message");
  const resumedState = (await sql.query(
    `SELECT campaign.status, campaign.scheduled_at,
            batch.status AS batch_status, message.status AS message_status
     FROM contact_campaigns campaign
     JOIN campaign_send_batches batch ON batch.campaign_id = campaign.id
     JOIN contact_campaign_messages message ON message.campaign_id = campaign.id
     WHERE campaign.id = $1`,
    [preSendCampaignId],
  )) as Array<Record<string, unknown>>;
  check(
    String(resumedState[0]?.status) === "scheduled" &&
      String(resumedState[0]?.batch_status) === "pending" &&
      String(resumedState[0]?.message_status) === "queued" &&
      Math.abs(
        new Date(String(resumedState[0]?.scheduled_at)).getTime() -
          replacementTime.getTime(),
      ) < 2_000,
    "resume rebuilds the unsent queue at the requested future time",
  );

  // Provider webhooks use the provider message id rather than our internal
  // message id. Some providers wrap that id in angle brackets; analytics must
  // still land on the exact campaign message and refresh its stored totals.
  const trackingCampaign = (await sql.query(
    `INSERT INTO contact_campaigns (
       user_id, name, list_id, subject, html_body, status
     )
     VALUES ($1, 'Tracking smoke', $2, 'Subject', '<p>Body</p>', 'sent')
     RETURNING id`,
    [userId, listId],
  )) as Array<Record<string, unknown>>;
  const trackingCampaignId = String(trackingCampaign[0].id);
  const trackingContact = (await sql.query(
    `INSERT INTO contacts (created_by, full_name, email)
     VALUES ($1, 'Tracking Check', $2) RETURNING id`,
    [userId, `tracking-${suffix}@example.test`],
  )) as Array<Record<string, unknown>>;
  const trackingMessage = (await sql.query(
    `INSERT INTO contact_campaign_messages (
       campaign_id, contact_id, recipient, status, sent_at,
       provider_message_id
     )
     VALUES ($1, $2, $3, 'sent', NOW(), $4)
     RETURNING id`,
    [
      trackingCampaignId,
      String(trackingContact[0].id),
      `tracking-${suffix}@example.test`,
      `<tracking-provider-${suffix}>`,
    ],
  )) as Array<Record<string, unknown>>;
  const tracked = await recordCampaignMessageEvent({
    providerMessageId: `tracking-provider-${suffix}`,
    status: "opened",
    userId,
  });
  await processCampaignAnalyticsEvents({ campaignId: trackingCampaignId, limit: 100 });
  check(
    tracked.matched && tracked.campaignId === trackingCampaignId,
    "a provider open event matches the campaign message id",
  );
  let trackingState: Array<Record<string, unknown>> = [];
  await eventually(async () => {
    trackingState = (await sql.query(
      `SELECT status, opened_at, open_count
       FROM contact_campaign_messages WHERE id = $1`,
      [String(trackingMessage[0].id)],
    )) as Array<Record<string, unknown>>;
    return (
      String(trackingState[0]?.status) === "opened" &&
      Boolean(trackingState[0]?.opened_at) &&
      Number(trackingState[0]?.open_count) === 1
    );
  }, "the open event is persisted once on the campaign message");
  let trackingStats: Array<Record<string, unknown>> = [];
  await eventually(async () => {
    trackingStats = (await sql.query(
      `SELECT stats->>'opened' AS opened FROM contact_campaigns WHERE id = $1`,
      [trackingCampaignId],
    )) as Array<Record<string, unknown>>;
    return Number(trackingStats[0]?.opened || 0) === 1;
  }, "campaign stored analytics totals refresh after an open");

  const duplicateProviderOpen = await recordCampaignMessageEvent({
    providerMessageId: `tracking-provider-${suffix}`,
    status: "opened",
    userId,
  });
  const dedupedProviderState = (await sql.query(
    `SELECT open_count FROM contact_campaign_messages WHERE id = $1`,
    [String(trackingMessage[0].id)],
  )) as Array<Record<string, unknown>>;
  check(
    duplicateProviderOpen.matched && duplicateProviderOpen.counted === false &&
      Number(dedupedProviderState[0]?.open_count) === 1,
    "a retried provider open webhook is counted only once",
  );

  const trackingUrl = `https://example.test/tracked-${suffix}`;
  await sql.query(
    `INSERT INTO contact_campaign_links (campaign_id, block_id, label, url)
     VALUES ($1, 'tracking-smoke-link', 'Smoke link', $2)`,
    [trackingCampaignId, trackingUrl],
  );
  // Provider engagement is a fallback. Once first-party tracking arrives, the
  // analytics view uses the first-party ledger and does not double-count the
  // provider's copy of the same click/open.
  await recordCampaignMessageEvent({
    providerMessageId: `tracking-provider-${suffix}`,
    status: "clicked",
    userId,
    provider: "resend",
    destination: trackingUrl,
  });
  await recordCampaignMessageEvent({
    messageId: String(trackingMessage[0].id),
    status: "opened",
    source: "first_party",
    metadata: { device: "mobile", client: "gmail" },
  });
  await recordCampaignMessageEvent({
    messageId: String(trackingMessage[0].id),
    status: "opened",
    source: "first_party",
    metadata: { device: "mobile", client: "gmail" },
  });
  await recordCampaignMessageEvent({
    messageId: String(trackingMessage[0].id),
    status: "clicked",
    source: "first_party",
    destination: trackingUrl,
  });
  await recordCampaignMessageEvent({
    messageId: String(trackingMessage[0].id),
    status: "clicked",
    source: "first_party",
    destination: trackingUrl,
  });
  await processCampaignAnalyticsEvents({ campaignId: trackingCampaignId, limit: 100 });
  let trackingAnalytics = await getCampaignAnalytics(userId, trackingCampaignId);
  await eventually(async () => {
    trackingAnalytics = await getCampaignAnalytics(userId, trackingCampaignId);
    return (
      trackingAnalytics.totals.uniqueOpens === 1 &&
      trackingAnalytics.totals.totalOpens === 2 &&
      trackingAnalytics.totals.uniqueClicks === 1 &&
      trackingAnalytics.totals.totalClicks === 2
    );
  }, "analytics separates unique engagement from accurate first-party totals");
  check(
    trackingAnalytics.totals.uniqueOpens === 1 &&
      trackingAnalytics.totals.totalOpens === 2 &&
      trackingAnalytics.totals.uniqueClicks === 1 &&
      trackingAnalytics.totals.totalClicks === 2,
    "analytics separates unique engagement from accurate first-party totals",
  );
  let trackingClickMap = await getCampaignClickMap(
    userId,
    trackingCampaignId,
  );
  await eventually(async () => {
    trackingClickMap = await getCampaignClickMap(userId, trackingCampaignId);
    return (
      trackingClickMap[0]?.clickCount === 2 &&
      trackingClickMap[0]?.uniqueClickCount === 1
    );
  }, "the link aggregate refreshes after a click");
  check(
    trackingClickMap[0]?.clickCount === 2 &&
      trackingClickMap[0]?.uniqueClickCount === 1,
    "the click map excludes the duplicate provider click",
  );

  const { dispatchFirstCampaignBatch } = await import(
    "../server/campaign-dispatch"
  );
  const freshCampaign = (await sql.query(
    `INSERT INTO contact_campaigns (
       user_id, name, list_id, subject, html_body, status
     )
     VALUES ($1, 'Honesty check', $2, 'Subject', '<p>Body</p>', 'sending')
     RETURNING id`,
    [userId, listId],
  )) as Array<Record<string, unknown>>;
  const honestyId = String(freshCampaign[0].id);
  const honestContact = (await sql.query(
    `INSERT INTO contacts (created_by, full_name, email)
     VALUES ($1, 'Honesty Check', $2) RETURNING id`,
    [userId, `honesty-${suffix}@example.test`],
  )) as Array<Record<string, unknown>>;
  await sql.query(
    `INSERT INTO contact_campaign_messages (
       campaign_id, contact_id, recipient, status, scheduled_for
     )
     VALUES ($1, $2, $3, 'queued', NOW())`,
    [honestyId, String(honestContact[0].id), `honesty-${suffix}@example.test`],
  );
  await planCampaignSend(userId, honestyId);
  const attempt = await dispatchFirstCampaignBatch(honestyId);

  check(
    attempt.sent === 0,
    "nothing is counted as sent when no provider can deliver it",
  );

  let honestyRows: Array<Record<string, unknown>> = [];
  await eventually(async () => {
    honestyRows = (await sql.query(
      `SELECT status, failure_reason FROM contact_campaign_messages
       WHERE campaign_id = $1`,
      [honestyId],
    )) as Array<Record<string, unknown>>;
    return String(honestyRows[0]?.status) === "failed";
  }, "the message is recorded as failed rather than sent");
  check(
    String(honestyRows[0]?.failure_reason || "").length > 0,
    "the failure carries a reason the sender can act on",
  );

  const honestyProgress = await getCampaignSendProgress(userId, honestyId);
  check(
    honestyProgress.sent === 0 && honestyProgress.failed === 1,
    "progress reports the failure rather than a phantom delivery",
  );

  console.log(`Campaign dispatch smoke passed: ${assertions} checks.`);
} finally {
  await cleanup();
  await closeQueues();
  await closeQueueRedis();
}

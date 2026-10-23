/**
 * Disposable large-campaign analytics simulation.
 *
 * It creates 10,000 recipients and a realistic mix of delivery, failure,
 * open, and click events in set-based SQL, then drains the real worker. No
 * provider is called. The fixture is deleted in the finally block.
 */
import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";

import {
  getCampaignMetricSnapshot,
  processCampaignAnalyticsEvents,
} from "../server/campaign-analytics-engine";

const databaseUrl = process.env.DATABASE_URL || "";
if (!databaseUrl) throw new Error("Analytics load smoke requires DATABASE_URL.");

const sql = neon(databaseUrl);
const suffix = randomUUID().replaceAll("-", "");
const recipientCount = 10_000;
const openCount = 1_000;
const clickCount = 500;
const failedCount = 10;
let assertions = 0;

const check = (condition: unknown, message: string) => {
  if (!condition) throw new Error(`Analytics load check failed: ${message}`);
  assertions += 1;
};

const retryDatabaseCleanup = async (operation: () => Promise<unknown>) => {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await operation();
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
  }
  throw lastError;
};

const removeFixture = async (fixtureId: string) => {
  await retryDatabaseCleanup(() =>
    sql.query(`DELETE FROM contact_campaigns WHERE user_id = $1`, [fixtureId]),
  );
  await retryDatabaseCleanup(() =>
    sql.query(`DELETE FROM contacts WHERE created_by = $1`, [fixtureId]),
  );
  await retryDatabaseCleanup(() =>
    sql.query(`DELETE FROM contact_lists WHERE user_id = $1`, [fixtureId]),
  );
  await retryDatabaseCleanup(() =>
    sql.query(`DELETE FROM users WHERE id = $1`, [fixtureId]),
  );
};

// A terminated audit must not leave a large synthetic workspace behind. Only
// reap accounts carrying both the reserved smoke-test address and password
// marker, so real users can never match this cleanup.
const staleFixtures = await sql.query(
  `SELECT id
   FROM users
   WHERE email LIKE 'analytics-load-%@example.test'
     AND password_hash = 'non-login-load-account'`,
);
for (const fixture of staleFixtures) {
  await removeFixture(String(fixture.id));
}

const users = await sql.query(
  `INSERT INTO users (email, password_hash, full_name, short_id)
   VALUES ($1, 'non-login-load-account', 'Analytics Load Smoke', $2)
   RETURNING id`,
  [`analytics-load-${suffix}@example.test`, suffix.slice(0, 5)],
);
const userId = String(users[0].id);

const cleanup = async () => {
  await removeFixture(userId);
};

try {
  const startedAt = Date.now();
  const lists = await sql.query(
    `INSERT INTO contact_lists (user_id, created_by, name, list_type)
     VALUES ($1, $1, 'Analytics load list', 'static')
     RETURNING id`,
    [userId],
  );
  const listId = String(lists[0].id);
  const campaigns = await sql.query(
    `INSERT INTO contact_campaigns (
       user_id, name, list_id, subject, html_body, status
     )
     VALUES ($1, 'Analytics load campaign', $2, 'Load smoke', '<p>Load</p>', 'sent')
     RETURNING id`,
    [userId, listId],
  );
  const campaignId = String(campaigns[0].id);

  await sql.query(
    `WITH created_contacts AS (
       INSERT INTO contacts (created_by, full_name, email)
       SELECT $1,
              'Load contact ' || sequence::text,
              'analytics-load-' || sequence::text || '-' || $2 || '@example.test'
       FROM generate_series(1, $3::int) AS sequence
       RETURNING id
     )
     INSERT INTO contact_list_members (list_id, contact_id, source_type)
     SELECT $4, id, 'manual'
     FROM created_contacts`,
    [userId, suffix, recipientCount, listId],
  );

  await sql.query(
    `INSERT INTO contact_campaign_messages (
       campaign_id, contact_id, recipient, status, sent_at, scheduled_for
     )
     SELECT $1, contact.id, contact.email, 'sent', NOW(), NOW()
     FROM contact_list_members member
     JOIN contacts contact ON contact.id = member.contact_id
     WHERE member.list_id = $2
     ORDER BY contact.id`,
    [campaignId, listId],
  );
  await sql.query(
    `INSERT INTO contact_campaign_links (campaign_id, block_id, label, url)
     VALUES ($1, 'load-link', 'Load link', 'https://example.test/load')`,
    [campaignId],
  );

  // A single set-based insert keeps the simulation focused on analytics
  // throughput rather than spending minutes on client-side row-by-row setup.
  await sql.query(
    `WITH numbered AS (
       SELECT message.id, message.contact_id,
              ROW_NUMBER() OVER (ORDER BY message.id)::int AS sequence
       FROM contact_campaign_messages message
       WHERE message.campaign_id = $1
     ), events AS (
       SELECT id, contact_id, 'email_sent'::text AS event_type,
              'load:sent:' || id::text AS event_key,
              '{}'::jsonb AS metadata
       FROM numbered
       UNION ALL
       SELECT id, contact_id, 'email_delivered', 'load:delivered:' || id::text,
              '{}'::jsonb
       FROM numbered
       WHERE sequence > $2::int
       UNION ALL
       SELECT id, contact_id, 'email_failed', 'load:failed:' || id::text,
              jsonb_build_object('error', 'synthetic load failure')
       FROM numbered
       WHERE sequence <= $2::int
       UNION ALL
       SELECT id, contact_id, 'email_opened', 'load:opened:' || id::text,
              jsonb_build_object('device', 'desktop', 'client', 'chrome', 'isMachine', false)
       FROM numbered
       WHERE sequence <= $3::int
       UNION ALL
       SELECT id, contact_id, 'email_clicked', 'load:clicked:' || id::text,
              jsonb_build_object('device', 'mobile', 'client', 'chrome', 'destination', 'https://example.test/load')
       FROM numbered
       WHERE sequence <= $4::int
     )
     INSERT INTO campaign_events (
       workspace_id, campaign_id, recipient_id, contact_id, message_id,
       event_type, source, event_key, metadata, occurred_at, created_at
     )
     SELECT $5, $1, events.id, events.contact_id, events.id,
            events.event_type, 'system', events.event_key, events.metadata,
            NOW(), NOW()
     FROM events`,
    [campaignId, failedCount, openCount, clickCount, userId],
  );

  let pending = recipientCount + (recipientCount - failedCount) + failedCount + openCount + clickCount;
  let workerRuns = 0;
  while (pending > 0 && workerRuns < 100) {
    const result = await processCampaignAnalyticsEvents({
      limit: 25_000,
      campaignId,
    });
    workerRuns += 1;
    const pendingRows = await sql.query(
      `SELECT COUNT(*)::int AS count
       FROM campaign_events
       WHERE campaign_id = $1 AND processed_at IS NULL`,
      [campaignId],
    );
    pending = Number(pendingRows[0]?.count || 0);
    if (!result.processed && !result.deadLettered && !result.retryable && pending > 0) {
      throw new Error("The analytics worker stopped making progress.");
    }
  }

  check(pending === 0, "the worker drained every large-batch event");
  check(workerRuns === 1, "one bounded recovery drain handles the full backlog");
  const snapshot = await getCampaignMetricSnapshot(userId, campaignId);
  check(Boolean(snapshot), "the campaign aggregate exists");
  check(snapshot?.metrics.recipients === recipientCount, "all recipients are represented");
  check(snapshot?.metrics.delivered === recipientCount - failedCount, "delivery totals are accurate");
  check(snapshot?.metrics.failed === failedCount, "failure totals are accurate");
  check(snapshot?.metrics.total_opens === openCount && snapshot.metrics.unique_opens === openCount, "open totals stay accurate at load");
  check(snapshot?.metrics.total_clicks === clickCount && snapshot.metrics.unique_clicks === clickCount, "click totals stay accurate at load");
  console.log(
    `Campaign analytics load smoke passed: ${assertions} checks, ${recipientCount.toLocaleString()} recipients, ${workerRuns} worker batches, ${Date.now() - startedAt}ms.`,
  );
} finally {
  await cleanup();
}

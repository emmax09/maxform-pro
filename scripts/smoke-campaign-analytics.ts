/**
 * End-to-end analytics engine smoke test.
 *
 * Creates one disposable workspace and proves the real event ledger, worker,
 * aggregate read models, first-party duplicate handling, provider idempotency,
 * CRM activity projection, and workspace isolation. No external email is sent.
 */
import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";

import {
  campaignBelongsToWorkspace,
  getCampaignMetricSnapshot,
  processCampaignAnalyticsEvents,
} from "../server/campaign-analytics-engine";
import { getCampaignClickMap } from "../server/contacts-data";
import { recordCampaignMessageEvent } from "../server/campaign-tracking";
import { closeQueueRedis } from "../src/lib/queue/redis";
import { closeQueues } from "../src/lib/queue/queues";

const databaseUrl = process.env.DATABASE_URL || "";
if (!databaseUrl) throw new Error("Campaign analytics smoke requires DATABASE_URL.");

const sql = neon(databaseUrl);
const suffix = randomUUID().replaceAll("-", "");
let assertions = 0;
const check = (condition: unknown, message: string) => {
  if (!condition) throw new Error(`Campaign analytics smoke failed: ${message}`);
  assertions += 1;
};

const userRows = await sql`
  INSERT INTO users (email, password_hash, full_name, short_id)
  VALUES (${`analytics-smoke-${suffix}@example.test`}, 'analytics-smoke', 'Analytics Smoke', ${suffix.slice(0, 5)})
  RETURNING id
`;
const userId = String(userRows[0].id);

const cleanup = async () => {
  await sql`DELETE FROM contact_campaigns WHERE user_id = ${userId}`;
  await sql`DELETE FROM contact_activity WHERE user_id = ${userId}`;
  await sql`DELETE FROM contacts WHERE created_by = ${userId}`;
  await sql`DELETE FROM contact_lists WHERE user_id = ${userId}`;
  await sql`DELETE FROM users WHERE id = ${userId}`;
};

try {
  const listRows = await sql`
    INSERT INTO contact_lists (user_id, created_by, name, list_type)
    VALUES (${userId}, ${userId}, 'Analytics smoke list', 'static')
    RETURNING id
  `;
  const listId = String(listRows[0].id);
  const contactRows = await sql`
    INSERT INTO contacts (created_by, full_name, email)
    VALUES (${userId}, 'Analytics Smoke Contact', ${`analytics-contact-${suffix}@example.test`})
    RETURNING id
  `;
  const contactId = String(contactRows[0].id);
  const campaignRows = await sql`
    INSERT INTO contact_campaigns (
      user_id, name, list_id, subject, html_body, status
    )
    VALUES (${userId}, 'Analytics smoke campaign', ${listId}, 'Smoke', '<p>Smoke</p>', 'sent')
    RETURNING id
  `;
  const campaignId = String(campaignRows[0].id);
  const messageRows = await sql`
    INSERT INTO contact_campaign_messages (
      campaign_id, contact_id, recipient, status, sent_at, scheduled_for
    )
    VALUES (${campaignId}, ${contactId}, ${`analytics-contact-${suffix}@example.test`}, 'sent', NOW(), NOW())
    RETURNING id
  `;
  const messageId = String(messageRows[0].id);
  await sql`
    INSERT INTO contact_campaign_links (campaign_id, block_id, label, url)
    VALUES (${campaignId}, 'smoke-link', 'Smoke link', 'https://example.test/smoke')
  `;

  const firstOpen = await recordCampaignMessageEvent({
    messageId,
    status: "opened",
    source: "first_party",
    metadata: { device: "desktop", client: "chrome", isMachine: false },
  });
  const machineOpen = await recordCampaignMessageEvent({
    messageId,
    status: "opened",
    source: "first_party",
    metadata: { device: "desktop", client: "gmail", isMachine: true },
  });
  const firstClick = await recordCampaignMessageEvent({
    messageId,
    status: "clicked",
    source: "first_party",
    destination: "https://example.test/smoke",
    metadata: { device: "mobile", client: "chrome" },
  });
  const secondClick = await recordCampaignMessageEvent({
    messageId,
    status: "clicked",
    source: "first_party",
    destination: "https://example.test/smoke",
    metadata: { device: "mobile", client: "chrome" },
  });
  check(firstOpen.eventRecorded && machineOpen.eventRecorded, "first-party opens append immutable events");
  check(firstClick.eventRecorded && secondClick.eventRecorded, "repeated clicks remain total events");

  const providerOne = await recordCampaignMessageEvent({
    messageId,
    status: "opened",
    source: "provider",
    provider: "resend",
    providerEventId: `provider-${suffix}`,
  });
  const providerDuplicate = await recordCampaignMessageEvent({
    messageId,
    status: "opened",
    source: "provider",
    provider: "resend",
    providerEventId: `provider-${suffix}`,
  });
  check(providerOne.eventRecorded, "provider event is accepted once");
  check(!providerDuplicate.eventRecorded, "provider event id is idempotent");

  for (let attempt = 0; attempt < 12; attempt += 1) {
    await processCampaignAnalyticsEvents({ limit: 1000, campaignId });
    const pending = await sql`
      SELECT COUNT(*)::int AS count
      FROM campaign_events
      WHERE campaign_id = ${campaignId} AND processed_at IS NULL
    `;
    if (Number(pending[0]?.count || 0) === 0) break;
  }

  const snapshot = await getCampaignMetricSnapshot(userId, campaignId);
  check(Boolean(snapshot), "worker materializes campaign metrics");
  check(snapshot?.metrics.recipients === 1, "recipient count is materialized");
  check(snapshot?.metrics.total_opens === 2, "total opens preserve repeated opens");
  check(snapshot?.metrics.unique_opens === 1, "unique opens collapse by message");
  check(snapshot?.metrics.machine_opens === 1 && snapshot.metrics.human_opens === 1, "machine and human opens are separated");
  check(snapshot?.metrics.total_clicks === 2 && snapshot.metrics.unique_clicks === 1, "click totals and unique clicks are separate");

  const clickMap = await getCampaignClickMap(userId, campaignId);
  check(
    clickMap[0]?.clickCount === 2 && clickMap[0]?.uniqueClickCount === 1,
    "link aggregates preserve total and unique clicks",
  );

  const activityRows = await sql`
    SELECT COUNT(*)::int AS count
    FROM contact_activity
    WHERE source_event_id IN (
      SELECT id FROM campaign_events WHERE campaign_id = ${campaignId}
    )
  `;
  check(Number(activityRows[0]?.count || 0) === 5, "campaign events project into CRM activity once each");
  check(await campaignBelongsToWorkspace(userId, campaignId), "owner can access the campaign");
  check(!(await campaignBelongsToWorkspace(randomUUID(), campaignId)), "another workspace cannot access the campaign");
  check(!(await getCampaignMetricSnapshot(randomUUID(), campaignId)), "another workspace cannot read aggregate metrics");
} finally {
  await cleanup();
  await closeQueues();
  await closeQueueRedis();
}

console.log(`Campaign analytics smoke passed (${assertions} checks).`);

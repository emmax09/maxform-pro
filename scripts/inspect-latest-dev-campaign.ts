import { neon } from "@neondatabase/serverless";

import {
  getCampaignAnalytics,
  getContactCampaignSendProgress,
} from "../server/contacts-data";

const databaseUrl = process.env.DATABASE_URL || "";
const userId = String(process.env.LIVE_CAMPAIGN_USER_ID || "").trim();
if (!databaseUrl || !userId) throw new Error("DATABASE_URL and LIVE_CAMPAIGN_USER_ID are required.");

const sql = neon(databaseUrl);
const campaigns = await sql.query(
  `SELECT id, name, subject, status, sent_at, html_body
   FROM contact_campaigns
   WHERE user_id = $1 AND name LIKE 'MaxForm dev campaign smoke %'
   ORDER BY created_at DESC
   LIMIT 1`,
  [userId],
);
const campaign = campaigns[0] as { id?: unknown; name?: unknown; subject?: unknown; status?: unknown; sent_at?: unknown; html_body?: unknown } | undefined;
if (!campaign?.id) throw new Error("No development campaign smoke was found.");

const messages = await sql.query(
  `SELECT message.recipient, message.status, log.provider,
          message.provider_message_id, message.last_error,
          message.sent_at, message.delivered_at, message.opened_at,
          message.clicked_at
   FROM contact_campaign_messages message
   LEFT JOIN email_logs log ON log.provider_message_id = message.provider_message_id
   WHERE message.campaign_id = $1
   ORDER BY message.recipient`,
  [String(campaign.id)],
);
const deliveryLogs = await sql.query(
  `SELECT recipient, provider, LENGTH(html_body)::int AS html_length,
          POSITION('Unsubscribe' IN html_body) > 0 AS has_unsubscribe,
          POSITION('651 N Broad Street Middletown' IN html_body) > 0 AS has_address,
          POSITION('/api/campaigns/track' IN html_body) > 0 AS has_tracking,
          custom_headers
   FROM email_logs
   WHERE source_event_id = $1
   ORDER BY recipient`,
  [String(campaign.id)],
);

console.log(JSON.stringify({
  campaign: {
    id: campaign.id,
    name: campaign.name,
    subject: campaign.subject,
    status: campaign.status,
    sentAt: campaign.sent_at,
    hasDesignedContent: String(campaign.html_body || "").length > 500,
  },
  progress: await getContactCampaignSendProgress(userId, String(campaign.id)),
  analytics: (await getCampaignAnalytics(userId, String(campaign.id))).totals,
  messages,
  deliveryLogs,
}, null, 2));

import { neon } from "@neondatabase/serverless";

import { refreshCampaignStats } from "../server/campaign-tracking";

const databaseUrl = process.env.DATABASE_URL || "";
const userId = String(process.env.LIVE_CAMPAIGN_USER_ID || "").trim();
const campaignId = String(process.env.CAMPAIGN_ID || "").trim();
if (!databaseUrl || !userId || !campaignId) {
  throw new Error("DATABASE_URL, LIVE_CAMPAIGN_USER_ID, and CAMPAIGN_ID are required.");
}

const sql = neon(databaseUrl);
const owned = await sql.query(
  `SELECT id FROM contact_campaigns WHERE id = $1 AND user_id = $2 LIMIT 1`,
  [campaignId, userId],
);
if (!owned[0]) throw new Error("The campaign is not owned by this workspace.");

await refreshCampaignStats(sql, campaignId);
const rows = await sql.query(
  `SELECT stats FROM contact_campaigns WHERE id = $1 AND user_id = $2 LIMIT 1`,
  [campaignId, userId],
);
console.log(JSON.stringify({ campaignId, stats: rows[0]?.stats || {} }, null, 2));

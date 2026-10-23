/**
 * Sends one deliberately controlled, fully populated campaign to a workspace
 * list. This is for local development only; the caller must opt in through
 * ALLOW_DEV_CAMPAIGN_SEND=true and provide the workspace owner id.
 */
import { neon } from "@neondatabase/serverless";

import {
  getCampaignAnalytics,
  getCampaignSettings,
  getContactCampaignSendProgress,
  saveContactCampaign,
  sendContactCampaignNow,
} from "../server/contacts-data";

const databaseUrl = process.env.DATABASE_URL || "";
const userId = String(process.env.LIVE_CAMPAIGN_USER_ID || "").trim();
const listName = String(process.env.LIVE_CAMPAIGN_LIST_NAME || "test").trim();
const destination = String(
  process.env.LIVE_CAMPAIGN_DESTINATION ||
    "https://example.com/?utm_source=maxform&utm_medium=dev_campaign_smoke",
).trim();

if (!databaseUrl) throw new Error("A DATABASE_URL is required.");
if (!userId) throw new Error("Set LIVE_CAMPAIGN_USER_ID before running this script.");
if (process.env.ALLOW_DEV_CAMPAIGN_SEND !== "true") {
  throw new Error("Set ALLOW_DEV_CAMPAIGN_SEND=true for this development-only send.");
}

const sql = neon(databaseUrl);
const lists = await sql.query(
  `SELECT id, name
   FROM contact_lists
   WHERE user_id = $1 AND LOWER(name) = LOWER($2)
   LIMIT 1`,
  [userId, listName],
);
const list = lists[0] as { id?: unknown; name?: unknown } | undefined;
if (!list?.id) throw new Error(`The ${listName} list was not found in this workspace.`);

const settings = await getCampaignSettings(userId);
const now = new Date().toISOString();
const campaignName = `MaxForm dev campaign smoke ${now}`;
const subject = "A polished MaxForm update for your workspace";
const htmlBody = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${subject}</title>
  </head>
  <body style="margin:0;background:#f4f6f8;color:#172033;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      A complete development smoke test for MaxForm campaign delivery, rendering, tracking, and unsubscribe handling.
    </div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f6f8;">
      <tr><td align="center" style="padding:28px 14px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:640px;background:#ffffff;border:1px solid #e5e7eb;border-radius:18px;overflow:hidden;">
          <tr><td style="padding:24px 30px;background:#151922;color:#ffffff;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
              <td style="font-size:20px;font-weight:700;letter-spacing:-.02em;">MaxForm</td>
              <td align="right" style="font-size:11px;color:#cbd5e1;text-transform:uppercase;letter-spacing:.12em;">Dev preview</td>
            </tr></table>
          </td></tr>
          <tr><td style="padding:42px 30px 24px;">
            <p style="margin:0 0 12px;color:#F93D0A;font-size:12px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;">Workspace update</p>
            <h1 style="margin:0;color:#111827;font-size:34px;line-height:1.12;letter-spacing:-.04em;">A clearer way to move work forward.</h1>
            <p style="margin:18px 0 0;color:#526071;font-size:16px;line-height:1.7;">Hi {{contact.name}}, this is a complete MaxForm campaign smoke test. It verifies that a well-designed message can travel through the live provider, render cleanly, and report engagement correctly.</p>
            <p style="margin:18px 0 0;color:#526071;font-size:15px;line-height:1.7;">Your forms, events, payments, files, CRM, and automations stay connected in one workspace so the next action is always close at hand.</p>
          </td></tr>
          <tr><td style="padding:0 30px 10px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr>
              <td width="32%" style="padding:18px 14px;background:#fff7f3;border:1px solid #fed7c7;border-radius:12px;vertical-align:top;"><p style="margin:0;color:#F93D0A;font-size:24px;font-weight:700;">01</p><p style="margin:8px 0 0;color:#172033;font-size:13px;font-weight:700;">Capture</p><p style="margin:7px 0 0;color:#64748b;font-size:12px;line-height:1.5;">Collect better responses with polished forms.</p></td>
              <td width="2%"></td>
              <td width="32%" style="padding:18px 14px;background:#f4f8ff;border:1px solid #dbeafe;border-radius:12px;vertical-align:top;"><p style="margin:0;color:#2563eb;font-size:24px;font-weight:700;">02</p><p style="margin:8px 0 0;color:#172033;font-size:13px;font-weight:700;">Connect</p><p style="margin:7px 0 0;color:#64748b;font-size:12px;line-height:1.5;">Keep contacts, payments, and events in sync.</p></td>
              <td width="2%"></td>
              <td width="32%" style="padding:18px 14px;background:#f1fbf7;border:1px solid #ccefe0;border-radius:12px;vertical-align:top;"><p style="margin:0;color:#0f766e;font-size:24px;font-weight:700;">03</p><p style="margin:8px 0 0;color:#172033;font-size:13px;font-weight:700;">Act</p><p style="margin:7px 0 0;color:#64748b;font-size:12px;line-height:1.5;">Turn every response into the next useful step.</p></td>
            </tr></table>
          </td></tr>
          <tr><td style="padding:26px 30px 34px;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="border-radius:10px;background:#F93D0A;">
              <a href="${destination}" style="display:inline-block;padding:14px 22px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">Explore the MaxForm test link&nbsp; →</a>
            </td></tr></table>
            <p style="margin:18px 0 0;color:#64748b;font-size:12px;line-height:1.6;">This message is part of a controlled development test. No action is required, but the button is intentionally included so click tracking can be verified.</p>
          </td></tr>
          <tr><td style="padding:22px 30px;background:#f8fafc;border-top:1px solid #e5e7eb;text-align:center;">
            <p style="margin:0;color:#64748b;font-size:12px;line-height:1.6;">You are receiving this development message from {{workspace.name}}.</p>
            <p style="margin:8px 0 0;font-size:12px;line-height:1.6;"><a href="{{unsubscribe.url}}" style="color:#64748b;text-decoration:underline;">Unsubscribe from campaign mail</a></p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

const blocks = [
  { id: "dev-hero", type: "hero", eyebrow: "Workspace update", title: "A clearer way to move work forward." },
  { id: "dev-intro", type: "text", content: "A complete MaxForm campaign smoke test with a real CTA and recipient-safe footer." },
  { id: "dev-capture", type: "feature", content: "Capture", description: "Collect better responses with polished forms." },
  { id: "dev-connect", type: "feature", content: "Connect", description: "Keep contacts, payments, and events in sync." },
  { id: "dev-act", type: "feature", content: "Act", description: "Turn every response into the next useful step." },
  { id: "dev-cta", type: "button", content: "Explore the MaxForm test link", href: destination },
  { id: "dev-footer", type: "compliance_footer", mailingAddress: settings.mailingAddress, unsubscribeLabel: "Unsubscribe from campaign mail" },
];

const campaignId = await saveContactCampaign(userId, {
  name: campaignName,
  listId: String(list.id),
  subject,
  previewText: "A complete development smoke test for MaxForm delivery and engagement tracking.",
  htmlBody,
  blocks,
  category: "newsletter",
  identityId: settings.identityId,
});

const queued = await sendContactCampaignNow(userId, campaignId);
const progress = await getContactCampaignSendProgress(userId, campaignId);
const analytics = await getCampaignAnalytics(userId, campaignId);
const messages = await sql.query(
  `SELECT message.recipient, message.status, log.provider,
          message.provider_message_id, message.last_error
   FROM contact_campaign_messages message
   LEFT JOIN email_logs log ON log.provider_message_id = message.provider_message_id
   WHERE message.campaign_id = $1
   ORDER BY recipient`,
  [campaignId],
);

console.log(JSON.stringify({
  campaignId,
  campaignName,
  list: list.name,
  queued,
  progress,
  analytics: analytics.totals,
  messages,
}, null, 2));

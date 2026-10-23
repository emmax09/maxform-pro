/**
 * Round-trips a campaign design through the builder's save path.
 *
 * Answers the question a UI bug report cannot: did the edit fail to persist, or
 * did it persist and fail to be re-read? Saves blocks with design and advanced
 * overrides, reads them straight back, and checks every field survived.
 */
import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";

import {
  listContactCampaigns,
  saveCampaignBuilderState,
} from "../server/contacts-data";

const databaseUrl = process.env.DATABASE_URL || "";
if (!databaseUrl) throw new Error("Persistence smoke requires DATABASE_URL.");

const sql = neon(databaseUrl);
const suffix = randomUUID().replaceAll("-", "");

let assertions = 0;
const check = (condition: unknown, message: string) => {
  if (!condition) throw new Error(`Persistence check failed: ${message}`);
  assertions += 1;
};

const users = await sql.query(
  `INSERT INTO users (email, password_hash, full_name, short_id)
   VALUES ($1, 'non-login-smoke-account', 'Persistence Smoke', $2)
   RETURNING id`,
  [`persistence-smoke-${suffix}@example.test`, suffix.slice(0, 5)],
);
const userId = String(users[0].id);

const cleanup = async () => {
  await sql.query(`DELETE FROM contact_campaigns WHERE user_id = $1`, [userId]);
  await sql.query(`DELETE FROM contact_lists WHERE user_id = $1`, [userId]);
  await sql.query(`DELETE FROM user_onboarding WHERE user_id = $1`, [userId]);
  await sql.query(`DELETE FROM users WHERE id = $1`, [userId]);
};

try {
  const lists = await sql.query(
    `INSERT INTO contact_lists (user_id, created_by, name, list_type)
     VALUES ($1, $1, 'Persistence list', 'static') RETURNING id`,
    [userId],
  );
  const campaigns = await sql.query(
    `INSERT INTO contact_campaigns (
       user_id, name, list_id, subject, html_body, status
     )
     VALUES ($1, 'Before edit', $2, 'Old subject', '<p>old</p>', 'draft')
     RETURNING id`,
    [userId, String(lists[0].id)],
  );
  const campaignId = String(campaigns[0].id);

  // Exactly what the builder sends: a campaign_design envelope carrying the
  // blocks, including the Design and Advanced overrides.
  const envelope = {
    type: "campaign_design",
    version: 1,
    authoringMode: "builder",
    accent: "#DB2777",
    pageBackground: "#F5F7FB",
    cardBackground: "#FFFFFF",
    footerText: "Sent by Persistence Smoke",
    container: {
      headerTitle: "Acme Events",
      headerIcon: "🎉",
      headerBackground: "#111827",
      headerTextColor: "#FFFFFF",
      cornerRadius: 20,
      stripeHeight: 0,
      contentPadding: 40,
      width: 640,
    },
    blocks: [
      {
        id: "block-heading-1",
        type: "heading",
        content: "Edited headline",
        align: "center",
        size: "large",
        design: {
          textColor: "#112233",
          fontSize: 30,
          fontWeight: 700,
          padding: { top: 8, right: 12, bottom: 16, left: 20 },
          margin: { top: 1, right: 2, bottom: 3, left: 4 },
          borderRadius: 10,
        },
        advanced: { htmlId: "hero-heading", hideOnMobile: true },
      },
      {
        id: "block-coupon-1",
        type: "coupon",
        couponCode: "PERSIST20",
        content: "Use this at checkout",
        align: "center",
      },
      {
        id: "block-button-1",
        type: "button",
        content: "Book now",
        href: "https://example.test",
        align: "justify",
        // The two surfaces must round-trip independently: the button's own
        // fill and the band behind it.
        design: { elementBackground: "#16A34A", backgroundColor: "#F1F5F9" },
      },
    ],
  };

  await saveCampaignBuilderState(userId, campaignId, {
    name: "After edit",
    subject: "New subject",
    previewText: "New preheader",
    htmlBody: "<p>new</p>",
    blocks: [envelope],
  });

  const reloaded = await listContactCampaigns(userId);
  const campaign = reloaded.find((entry) => entry.id === campaignId);
  check(campaign, "the edited campaign comes back in the list");
  check(campaign!.name === "After edit", "the new name persisted");
  check(campaign!.subject === "New subject", "the new subject persisted");
  check(
    campaign!.previewText === "New preheader",
    "the new preheader persisted",
  );

  const storedEnvelope = (campaign!.blocks as Array<Record<string, unknown>>)
    .find((block) => block?.type === "campaign_design");
  check(storedEnvelope, "the design envelope round-trips");
  check(
    storedEnvelope?.accent === "#DB2777",
    "campaign-level colours round-trip",
  );
  check(
    storedEnvelope?.authoringMode === "builder",
    "the original authoring mode round-trips",
  );

  const storedContainer = (storedEnvelope?.container || {}) as Record<
    string,
    unknown
  >;
  check(
    storedContainer.headerTitle === "Acme Events" &&
      storedContainer.headerIcon === "🎉",
    "the container header and icon round-trip",
  );
  check(
    storedContainer.cornerRadius === 20 && storedContainer.width === 640,
    "container geometry round-trips",
  );
  check(
    storedContainer.stripeHeight === 0,
    "a zeroed container value round-trips rather than reverting to its default",
  );

  const storedBlocks = (storedEnvelope?.blocks || []) as Array<
    Record<string, unknown>
  >;
  check(storedBlocks.length === 3, "every block round-trips");

  const button = storedBlocks.find((block) => block.type === "button");
  const buttonDesign = (button?.design || {}) as Record<string, unknown>;
  check(
    buttonDesign.elementBackground === "#16A34A" &&
      buttonDesign.backgroundColor === "#F1F5F9",
    "element fill and block background persist as separate values",
  );
  check(button?.align === "justify", "the four-way alignment round-trips");

  const heading = storedBlocks.find((block) => block.type === "heading");
  check(heading?.content === "Edited headline", "block content round-trips");
  const design = (heading?.design || {}) as Record<string, unknown>;
  check(design.textColor === "#112233", "block text colour round-trips");
  check(design.fontSize === 30, "block font size round-trips");
  const padding = (design.padding || {}) as Record<string, number>;
  check(
    padding.top === 8 && padding.right === 12 &&
      padding.bottom === 16 && padding.left === 20,
    "per-side padding round-trips",
  );
  const advanced = (heading?.advanced || {}) as Record<string, unknown>;
  check(advanced.htmlId === "hero-heading", "advanced identifiers round-trip");
  check(advanced.hideOnMobile === true, "advanced visibility round-trips");

  const coupon = storedBlocks.find((block) => block.type === "coupon");
  check(coupon?.couponCode === "PERSIST20", "a new block type round-trips");

  // A later save that omits blocks must not wipe the ones already stored.
  await saveCampaignBuilderState(userId, campaignId, { name: "Renamed only" });
  const afterRename = (await listContactCampaigns(userId)).find(
    (entry) => entry.id === campaignId,
  );
  check(afterRename?.name === "Renamed only", "a partial save applies");
  check(
    ((afterRename!.blocks as Array<Record<string, unknown>>).find(
      (block) => block?.type === "campaign_design",
    )?.blocks as unknown[])?.length === 3,
    "a partial save leaves existing blocks intact",
  );

  console.log(`Campaign persistence smoke passed: ${assertions} checks.`);
} finally {
  await cleanup();
}

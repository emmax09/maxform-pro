/**
 * Campaign template gallery.
 *
 * These are marketing categories rather than the transactional ones the Email
 * Templates gallery uses, but a campaign template is the same thing underneath:
 * a name, a subject, and a block design. Cards show a real miniature render of
 * the design itself, so nothing in the gallery is a placeholder thumbnail.
 */
import {
  createCampaignBlock,
  emptyCampaignDesign,
  type CampaignBlock,
  type CampaignBlockType,
  type CampaignDesign,
} from "./campaign-blocks";

export type CampaignCategory =
  | "newsletter"
  | "promotional"
  | "announcement"
  | "event"
  | "welcome"
  | "winback"
  | "survey"
  | "seasonal";

export const campaignCategoryLabels: Record<CampaignCategory, string> = {
  newsletter: "Newsletter",
  promotional: "Promotional / Sale",
  announcement: "Product announcement",
  event: "Event invitation",
  welcome: "Welcome series",
  winback: "Re-engagement / Win-back",
  survey: "Survey / Feedback request",
  seasonal: "Seasonal / Holiday",
};

export const campaignCategoryOrder: CampaignCategory[] = [
  "newsletter",
  "promotional",
  "announcement",
  "event",
  "welcome",
  "winback",
  "survey",
  "seasonal",
];

export type CampaignTemplate = {
  id: string;
  name: string;
  category: CampaignCategory;
  description: string;
  subject: string;
  previewText: string;
  accent: string;
  blocks: Array<{ type: CampaignBlockType; patch?: Partial<CampaignBlock> }>;
};

const complianceBlock = {
  type: "compliance_footer" as CampaignBlockType,
  patch: { unsubscribeLabel: "Unsubscribe from campaigns" },
};

export const campaignTemplates: CampaignTemplate[] = [
  {
    id: "monthly-newsletter",
    name: "Monthly newsletter",
    category: "newsletter",
    description:
      "Three-story layout with a lead article, supporting links, and a sign-off.",
    subject: "{{workspace.name}} in review: what shipped this month",
    previewText: "Three things worth two minutes of your time.",
    accent: "#F93D0A",
    blocks: [
      { type: "label", patch: { content: "Monthly roundup" } },
      { type: "heading", patch: { content: "What we shipped this month" } },
      {
        type: "text",
        patch: {
          content:
            "Hi {{contact.name}}, here is the short version of what changed, why it matters, and where to look first.",
        },
      },
      { type: "divider" },
      {
        type: "heading",
        patch: { content: "The headline change", size: "medium" },
      },
      {
        type: "text",
        patch: {
          content:
            "Lead with the single most useful thing. Two or three sentences is plenty — the button does the rest.",
        },
      },
      { type: "button", patch: { content: "Read the full note" } },
      { type: "divider" },
      { type: "testimonial" },
      complianceBlock,
    ],
  },
  {
    id: "flash-sale",
    name: "Flash sale",
    category: "promotional",
    description:
      "Hero banner, live countdown, and a product grid pulled from your catalog.",
    subject: "48 hours: 20% off everything",
    previewText: "Your discount is already applied at checkout.",
    accent: "#DB2777",
    blocks: [
      {
        type: "hero",
        patch: {
          content: "48 hours only",
          subtext: "20% off the entire catalog. No code needed.",
          buttonLabel: "Shop the sale",
        },
      },
      { type: "countdown", patch: { content: "Sale ends in" } },
      { type: "product_grid", patch: { columns: 2 } },
      {
        type: "text",
        patch: {
          content:
            "Discount applies automatically at checkout. Ends Friday at midnight.",
          align: "center",
        },
      },
      complianceBlock,
    ],
  },
  {
    id: "product-launch",
    name: "Product announcement",
    category: "announcement",
    description: "Single-focus launch note with a screenshot and one CTA.",
    subject: "Introducing something we think you will actually use",
    previewText: "One new thing, and the reason we built it.",
    accent: "#7C3AED",
    blocks: [
      { type: "label", patch: { content: "New" } },
      { type: "heading", patch: { content: "Say hello to the new release" } },
      {
        type: "text",
        patch: {
          content:
            "Explain the problem first, then the change. People forward an email that made something make sense.",
        },
      },
      { type: "image", patch: { alt: "Screenshot of the new release" } },
      { type: "button", patch: { content: "See what changed" } },
      complianceBlock,
    ],
  },
  {
    id: "event-invitation",
    name: "Event invitation",
    category: "event",
    description:
      "Invitation with the practical details up front and ticket types below.",
    subject: "You are invited: {{workspace.name}} live",
    previewText: "Thursday, 45 minutes, and a recording if you cannot make it.",
    accent: "#0F766E",
    blocks: [
      {
        type: "hero",
        patch: {
          content: "You are invited",
          subtext: "Thursday at 2pm · 45 minutes · Recording sent after",
          buttonLabel: "Save my seat",
        },
      },
      {
        type: "text",
        patch: {
          content:
            "Lead with when, how long, and what the attendee walks away with. Everything else is optional.",
        },
      },
      { type: "product_grid", patch: { sourceType: "tickets", columns: 2 } },
      { type: "countdown", patch: { content: "Registration closes in" } },
      complianceBlock,
    ],
  },
  {
    id: "welcome-one",
    name: "Welcome, part one",
    category: "welcome",
    description: "First message after signup: orient, then one clear next step.",
    subject: "Welcome — here is where to start",
    previewText: "One step, then you are set up.",
    accent: "#D97706",
    blocks: [
      { type: "label", patch: { content: "Welcome" } },
      {
        type: "heading",
        patch: { content: "Glad you are here, {{contact.name}}" },
      },
      {
        type: "text",
        patch: {
          content:
            "Give exactly one next step. A welcome email with five links gets none of them clicked.",
        },
      },
      { type: "button", patch: { content: "Finish setting up" } },
      { type: "spacer" },
      { type: "social" },
      complianceBlock,
    ],
  },
  {
    id: "winback",
    name: "Win-back",
    category: "winback",
    description:
      "For contacts who have gone quiet: acknowledge it, give one reason to return.",
    subject: "Still useful to you?",
    previewText: "A straight question, and an easy way out either way.",
    accent: "#475569",
    blocks: [
      { type: "heading", patch: { content: "Still want these emails?" } },
      {
        type: "text",
        patch: {
          content:
            "It has been a while. Here is what changed since you last looked — and if it is not for you, the unsubscribe link below is genuinely fine to use.",
        },
      },
      { type: "button", patch: { content: "See what is new" } },
      { type: "divider" },
      {
        type: "text",
        patch: {
          content: "Prefer fewer emails? Update your preferences instead.",
          align: "center",
        },
      },
      complianceBlock,
    ],
  },
  {
    id: "feedback-request",
    name: "Feedback request",
    category: "survey",
    description: "Short survey ask with the time cost stated honestly.",
    subject: "Two questions, about ninety seconds",
    previewText: "No login, no scoring, just two questions.",
    accent: "#F93D0A",
    blocks: [
      { type: "label", patch: { content: "Your turn" } },
      { type: "heading", patch: { content: "Two questions, ninety seconds" } },
      {
        type: "text",
        patch: {
          content:
            "State the real time cost. Overstating how short a survey is the fastest way to lose the second one.",
        },
      },
      { type: "button", patch: { content: "Answer two questions" } },
      { type: "testimonial" },
      complianceBlock,
    ],
  },
  {
    id: "holiday-offer",
    name: "Holiday offer",
    category: "seasonal",
    description: "Seasonal hero, gift-oriented product grid, and a deadline.",
    subject: "Ordering in time for the holidays",
    previewText: "Last order dates, and a few things worth wrapping.",
    accent: "#B91C1C",
    blocks: [
      {
        type: "hero",
        patch: {
          content: "In time for the holidays",
          subtext: "Order by the 18th for delivery before the 24th.",
          buttonLabel: "Browse gifts",
        },
      },
      { type: "product_grid", patch: { columns: 3 } },
      { type: "countdown", patch: { content: "Last order date in" } },
      complianceBlock,
    ],
  },
];

export const designFromTemplate = (
  template: CampaignTemplate,
): CampaignDesign => ({
  ...emptyCampaignDesign(),
  accent: template.accent,
  blocks: template.blocks.map((entry) => ({
    ...createCampaignBlock(entry.type),
    ...(entry.patch || {}),
  })),
});

export const campaignCategoryOf = (value: string): CampaignCategory =>
  (campaignCategoryOrder as string[]).includes(value)
    ? (value as CampaignCategory)
    : "newsletter";

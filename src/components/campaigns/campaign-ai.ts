/**
 * AI Campaign Creator.
 *
 * Follows the same approach as the AI form generator: explainable local
 * heuristics over the workspace's own data, not an opaque model call. Every
 * suggestion carries the reason it was made, and nothing here sends anything —
 * the output lands in the Builder, Audience, and Scheduling tabs as an editable
 * draft for a human to approve.
 */
import {
  createCampaignBlock,
  type CampaignBlock,
  type CampaignDesign,
} from "./campaign-blocks";
import {
  campaignTemplates,
  designFromTemplate,
  type CampaignCategory,
  type CampaignTemplate,
} from "./campaign-templates";
import type { ContactListRecord } from "@/lib/contacts";

export type BrandVoice = "friendly" | "direct" | "playful" | "formal";

export type SubjectQuality = "Strong" | "Good" | "Weak";

export type SubjectSuggestion = {
  text: string;
  quality: SubjectQuality;
  reasons: string[];
};

export type SegmentSuggestion = {
  listId: string;
  listName: string;
  reason: string;
} | null;

export type SendTimeSuggestion =
  | { basis: "history"; hour: number; opens: number; sampleSize: number }
  | { basis: "insufficient"; sampleSize: number };

export type CampaignDraft = {
  name: string;
  category: CampaignCategory;
  templateId: string;
  templateName: string;
  subjects: SubjectSuggestion[];
  previewText: string;
  design: CampaignDesign;
  segment: SegmentSuggestion;
  sendTime: SendTimeSuggestion;
  notes: string[];
};

type Intent = {
  category: CampaignCategory;
  templateId: string;
  keywords: string[];
  /** Words that identify a list or segment fit for this kind of campaign. */
  audienceKeywords: string[];
};

const intents: Intent[] = [
  {
    category: "promotional",
    templateId: "flash-sale",
    keywords: [
      "sale",
      "discount",
      "% off",
      "percent off",
      "promo",
      "deal",
      "offer",
      "black friday",
      "clearance",
      "coupon",
    ],
    audienceKeywords: ["customer", "buyer", "subscriber", "vip"],
  },
  {
    category: "announcement",
    templateId: "product-launch",
    keywords: [
      "launch",
      "announce",
      "introducing",
      "new feature",
      "new product",
      "release",
      "now available",
      "update",
    ],
    audienceKeywords: ["customer", "user", "active", "subscriber"],
  },
  {
    category: "event",
    templateId: "event-invitation",
    keywords: [
      "event",
      "webinar",
      "invite",
      "invitation",
      "conference",
      "workshop",
      "meetup",
      "rsvp",
      "live session",
      "ticket",
    ],
    audienceKeywords: ["attendee", "registrant", "subscriber", "lead"],
  },
  {
    category: "welcome",
    templateId: "welcome-one",
    keywords: [
      "welcome",
      "onboarding",
      "getting started",
      "new signup",
      "new subscriber",
      "first steps",
    ],
    audienceKeywords: ["new", "signup", "lead", "trial"],
  },
  {
    category: "winback",
    templateId: "winback",
    keywords: [
      "win back",
      "winback",
      "re-engage",
      "reengage",
      "inactive",
      "lapsed",
      "dormant",
      "haven't opened",
      "come back",
      "past customer",
    ],
    audienceKeywords: ["past", "inactive", "lapsed", "churn", "dormant", "cold"],
  },
  {
    category: "survey",
    templateId: "feedback-request",
    keywords: [
      "survey",
      "feedback",
      "nps",
      "review",
      "questionnaire",
      "how are we doing",
      "rate",
    ],
    audienceKeywords: ["customer", "active", "recent"],
  },
  {
    category: "seasonal",
    templateId: "holiday-offer",
    keywords: [
      "holiday",
      "christmas",
      "thanksgiving",
      "new year",
      "easter",
      "seasonal",
      "summer",
      "back to school",
      "valentine",
    ],
    audienceKeywords: ["customer", "buyer", "subscriber"],
  },
  {
    category: "newsletter",
    templateId: "monthly-newsletter",
    keywords: [
      "newsletter",
      "monthly",
      "weekly",
      "roundup",
      "digest",
      "recap",
      "what's new",
    ],
    audienceKeywords: ["subscriber", "newsletter", "all"],
  },
];

const detectIntent = (prompt: string) => {
  const haystack = prompt.toLowerCase();
  let best: { intent: Intent; hits: number } | null = null;
  for (const intent of intents) {
    const hits = intent.keywords.filter((keyword) =>
      haystack.includes(keyword),
    ).length;
    if (hits && (!best || hits > best.hits)) best = { intent, hits };
  }
  return best?.intent || intents[intents.length - 1];
};

const titleCase = (value: string) =>
  value.replace(/\b\w/g, (letter) => letter.toUpperCase());

/** Pulls the concrete details a subject line can legitimately promise. */
const extractOffer = (prompt: string) => {
  const discount = /(\d{1,2})\s*%/.exec(prompt);
  const amount = /\b(?:save|off)\s*\$?(\d+)/i.exec(prompt);
  const weekday =
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.exec(
      prompt,
    );
  const hours = /\b(\d{1,3})\s*(?:hour|hr)s?\b/i.exec(prompt);
  const days = /\b(\d{1,3})\s*days?\b/i.exec(prompt);
  const endsSoon =
    /\b(ends?|expires?|last chance|closing|deadline|until|today only|tonight)\b/i.test(
      prompt,
    );
  return {
    discount: discount ? `${discount[1]}%` : "",
    amount: amount ? `$${amount[1]}` : "",
    deadline: weekday
      ? titleCase(weekday[1].toLowerCase())
      : hours
        ? `${hours[1]} hours`
        : days
          ? `${days[1]} days`
          : "",
    urgent: endsSoon || Boolean(hours) || Boolean(weekday),
  };
};

/**
 * Scores a subject line on length, urgency framing, and personalization. This
 * is a best-practice signal, not a predicted open rate: nothing here can see
 * sender reputation or how this audience has behaved before.
 */
export const rateSubjectLine = (subject: string): SubjectSuggestion => {
  const text = subject.trim();
  const reasons: string[] = [];
  let score = 0;

  const length = text.length;
  if (length >= 28 && length <= 55) {
    score += 2;
    reasons.push(`${length} characters, which survives mobile truncation`);
  } else if (length > 55 && length <= 70) {
    score += 1;
    reasons.push(`${length} characters, likely clipped on narrow screens`);
  } else if (length > 70) {
    reasons.push(`${length} characters, so most inboxes will cut it off`);
  } else if (length < 15) {
    reasons.push("Very short, so it carries little information");
  } else {
    score += 1;
    reasons.push(`${length} characters`);
  }

  if (/\{\{contact\./.test(text)) {
    score += 1;
    reasons.push("Uses the recipient's own details");
  }
  if (
    /\b(today|tonight|ends|closing|last chance|hours|until|final|deadline)\b/i.test(
      text,
    ) ||
    /\d{1,3}\s*(hour|day)/i.test(text)
  ) {
    score += 1;
    reasons.push("States a real deadline rather than implying one");
  }
  if (/\d/.test(text)) {
    score += 1;
    reasons.push("Contains a specific number");
  }

  const letters = text.replace(/[^A-Za-z]/g, "");
  const capitals = text.replace(/[^A-Z]/g, "");
  if (letters.length >= 6 && capitals.length / letters.length > 0.5) {
    score -= 2;
    reasons.push("Mostly capitals, which reads as shouting to filters");
  }
  if ((text.match(/[!?]/g) || []).length > 1) {
    score -= 1;
    reasons.push("More than one exclamation or question mark");
  }

  return {
    text,
    quality: score >= 4 ? "Strong" : score >= 2 ? "Good" : "Weak",
    reasons,
  };
};

const voiceCopy = (
  voice: BrandVoice,
  parts: { subject: string; offer: ReturnType<typeof extractOffer> },
) => {
  const { offer } = parts;
  const deadline = offer.deadline ? ` It ends ${offer.deadline}.` : "";
  const saving = offer.discount || offer.amount;
  if (voice === "direct") {
    return `${parts.subject}.${saving ? ` ${saving} off, applied at checkout.` : ""}${deadline} The button below takes you straight there.`;
  }
  if (voice === "playful") {
    return `Right then — ${parts.subject.toLowerCase()}.${saving ? ` That is ${saving} off, no code to remember.` : ""}${deadline} Go on, have a look.`;
  }
  if (voice === "formal") {
    return `We are writing to let you know that ${parts.subject.toLowerCase()}.${saving ? ` A ${saving} reduction is applied automatically at checkout.` : ""}${deadline} Further details are available via the link below.`;
  }
  return `Hi {{contact.name}} — ${parts.subject.toLowerCase()}.${saving ? ` That is ${saving} off, applied automatically at checkout.` : ""}${deadline} Here is the quickest way in.`;
};

const subjectOptions = (
  prompt: string,
  intent: Intent,
  offer: ReturnType<typeof extractOffer>,
) => {
  const topic = prompt
    .replace(/^(announce|promote|send|write|create|draft|tell them about)\s+/i, "")
    .replace(/[.!]+$/, "")
    .trim();
  const short = topic.length > 46 ? `${topic.slice(0, 43).trim()}…` : topic;
  const saving = offer.discount || offer.amount;
  const candidates = new Set<string>();

  if (saving && offer.deadline) {
    candidates.add(`${saving} off — ends ${offer.deadline}`);
  }
  if (saving) candidates.add(`Your ${saving} off is live`);
  if (offer.deadline) candidates.add(`Last call: ends ${offer.deadline}`);

  if (intent.category === "winback") {
    candidates.add("Still want these emails?");
    candidates.add(`{{contact.name}}, here is what you missed`);
  }
  if (intent.category === "event") {
    candidates.add(`You are invited: ${short}`);
    candidates.add(`45 minutes on ${short}`);
  }
  if (intent.category === "survey") {
    candidates.add("Two questions, about ninety seconds");
  }
  if (intent.category === "welcome") {
    candidates.add(`Welcome, {{contact.name}} — start here`);
  }
  if (intent.category === "announcement") {
    candidates.add(`New: ${short}`);
  }
  if (intent.category === "newsletter") {
    candidates.add(`${short} — the short version`);
  }

  candidates.add(titleCase(short.slice(0, 1)) + short.slice(1));
  candidates.add(`{{contact.name}}, ${short.toLowerCase()}`);

  return Array.from(candidates)
    .filter((text) => text.trim().length > 6)
    .slice(0, 5)
    .map(rateSubjectLine)
    .sort((first, second) => {
      const order = { Strong: 0, Good: 1, Weak: 2 };
      return order[first.quality] - order[second.quality];
    });
};

const applyPromptToDesign = (
  design: CampaignDesign,
  input: {
    prompt: string;
    subject: string;
    voice: BrandVoice;
    offer: ReturnType<typeof extractOffer>;
    mailingAddress: string;
  },
): CampaignDesign => {
  const body = voiceCopy(input.voice, {
    subject: input.subject.replace(/\{\{[^}]+\}\}/g, "").trim() || input.prompt,
    offer: input.offer,
  });
  let headingUsed = false;
  let textUsed = false;
  const blocks: CampaignBlock[] = design.blocks.map((block) => {
    if (block.type === "heading" && !headingUsed) {
      headingUsed = true;
      return { ...block, content: input.subject.slice(0, 90) };
    }
    if (block.type === "hero") {
      return {
        ...block,
        content: input.subject.slice(0, 60),
        subtext:
          [input.offer.discount || input.offer.amount, input.offer.deadline]
            .filter(Boolean)
            .join(" · ") || block.subtext,
      };
    }
    if (block.type === "text" && !textUsed) {
      textUsed = true;
      return { ...block, content: body };
    }
    if (block.type === "countdown" && input.offer.deadline) {
      return { ...block, content: `Ends ${input.offer.deadline}` };
    }
    if (block.type === "compliance_footer") {
      return { ...block, mailingAddress: input.mailingAddress };
    }
    return block;
  });
  if (!headingUsed) {
    blocks.unshift({
      ...createCampaignBlock("heading"),
      content: input.subject.slice(0, 90),
    });
  }
  return { ...design, blocks };
};

const suggestSegment = (
  intent: Intent,
  lists: ContactListRecord[],
): SegmentSuggestion => {
  const scored = lists
    .map((list) => {
      const haystack = `${list.name} ${list.description} ${list.filterDefinition
        .map((rule) => `${rule.field} ${rule.value}`)
        .join(" ")}`.toLowerCase();
      const hits = intent.audienceKeywords.filter((keyword) =>
        haystack.includes(keyword),
      );
      return { list, hits };
    })
    .filter((entry) => entry.hits.length)
    .sort(
      (first, second) =>
        second.hits.length - first.hits.length ||
        second.list.memberCount - first.list.memberCount,
    );
  const best = scored[0];
  if (best) {
    return {
      listId: best.list.id,
      listName: best.list.name,
      reason: `Matches "${best.hits.join('", "')}" for a ${intent.category.replace(
        /_/g,
        " ",
      )} campaign, with ${best.list.memberCount.toLocaleString()} contacts.`,
    };
  }
  // No list reads as a fit. Saying so is more useful than silently defaulting
  // to the biggest list and calling it a recommendation.
  return null;
};

export const suggestSendTime = (
  openHours: Array<{ hour: number; opens: number }>,
): SendTimeSuggestion => {
  const sampleSize = openHours.reduce((total, entry) => total + entry.opens, 0);
  const best = [...openHours].sort((first, second) => second.opens - first.opens)[0];
  if (!best || sampleSize < 25) return { basis: "insufficient", sampleSize };
  return {
    basis: "history",
    hour: best.hour,
    opens: best.opens,
    sampleSize,
  };
};

export const draftCampaign = (input: {
  prompt: string;
  lists: ContactListRecord[];
  openHours: Array<{ hour: number; opens: number }>;
  brandVoice: BrandVoice;
  mailingAddress: string;
}): CampaignDraft => {
  const prompt = input.prompt.trim();
  const intent = detectIntent(prompt);
  const template =
    campaignTemplates.find(
      (candidate: CampaignTemplate) => candidate.id === intent.templateId,
    ) || campaignTemplates[0];
  const offer = extractOffer(prompt);
  const subjects = subjectOptions(prompt, intent, offer);
  const leadSubject = subjects[0]?.text || template.subject;
  const design = applyPromptToDesign(designFromTemplate(template), {
    prompt,
    subject: leadSubject,
    voice: input.brandVoice,
    offer,
    mailingAddress: input.mailingAddress,
  });
  const sendTime = suggestSendTime(input.openHours);

  const notes: string[] = [
    `Started from the "${template.name}" layout because the brief reads as a ${intent.category.replace(/_/g, " ")} campaign.`,
    `Body copy is written in your ${input.brandVoice} brand voice from Campaigns settings.`,
  ];
  if (!input.mailingAddress.trim()) {
    notes.push(
      "No mailing address is saved yet, so the compliance footer is still empty and the campaign cannot send until you add one in Settings.",
    );
  }
  if (sendTime.basis === "insufficient") {
    notes.push(
      `Not enough send history to suggest a send time yet (${sendTime.sampleSize} recorded opens). Pick one yourself in Scheduling — the suggestion appears once this workspace has more data.`,
    );
  }

  return {
    name: prompt.length > 60 ? `${prompt.slice(0, 57).trim()}…` : prompt,
    category: intent.category,
    templateId: template.id,
    templateName: template.name,
    subjects,
    previewText:
      [offer.discount || offer.amount, offer.deadline]
        .filter(Boolean)
        .join(" · ") || template.previewText,
    design,
    segment: suggestSegment(intent, input.lists),
    sendTime,
    notes,
  };
};

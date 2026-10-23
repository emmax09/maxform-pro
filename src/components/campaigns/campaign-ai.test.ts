import { describe, expect, it } from "vitest";

import type { ContactListRecord } from "@/lib/contacts";

import { draftCampaign, rateSubjectLine, suggestSendTime } from "./campaign-ai";

const list = (
  overrides: Partial<ContactListRecord> & { id: string; name: string },
): ContactListRecord => ({
  description: "",
  filterDefinition: [],
  listType: "static",
  memberCount: 100,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const baseInput = {
  lists: [] as ContactListRecord[],
  openHours: [] as Array<{ hour: number; opens: number }>,
  brandVoice: "friendly" as const,
  mailingAddress: "1 Example Street",
};

describe("subject line rating", () => {
  it("rates a specific, well-sized, deadline-bearing subject as strong", () => {
    const rated = rateSubjectLine("20% off ends Friday, {{contact.name}}");

    expect(rated.quality).toBe("Strong");
    expect(rated.reasons.join(" ")).toContain("recipient's own details");
  });

  it("penalises a shouting subject", () => {
    const rated = rateSubjectLine("FREE MONEY GUARANTEED FOR YOU TODAY");

    expect(rated.quality).toBe("Weak");
    expect(rated.reasons.join(" ")).toContain("Mostly capitals");
  });

  it("calls out a subject that inboxes will clip", () => {
    const rated = rateSubjectLine(
      "This subject line goes on for such a long time that no inbox anywhere will show all of it",
    );

    expect(rated.reasons.join(" ")).toContain("cut it off");
  });

  it("explains every judgement it makes", () => {
    const rated = rateSubjectLine("A perfectly ordinary subject line here");
    expect(rated.reasons.length).toBeGreaterThan(0);
  });
});

describe("send time suggestion", () => {
  it("refuses to invent a time without enough history", () => {
    const suggestion = suggestSendTime([{ hour: 9, opens: 4 }]);

    expect(suggestion).toEqual({ basis: "insufficient", sampleSize: 4 });
  });

  it("picks the workspace's own best hour once there is data", () => {
    const suggestion = suggestSendTime([
      { hour: 9, opens: 10 },
      { hour: 14, opens: 30 },
      { hour: 20, opens: 5 },
    ]);

    expect(suggestion).toEqual({
      basis: "history",
      hour: 14,
      opens: 30,
      sampleSize: 45,
    });
  });
});

describe("campaign drafting", () => {
  it("reads a sale brief as a promotional campaign and keeps the real numbers", () => {
    const draft = draftCampaign({
      ...baseInput,
      prompt: "Announce our summer sale, 20% off, ends Friday",
    });

    expect(draft.category).toBe("promotional");
    expect(draft.templateId).toBe("flash-sale");
    expect(draft.subjects.some((option) => option.text.includes("20%"))).toBe(
      true,
    );
    expect(draft.previewText).toContain("20%");
    expect(draft.previewText).toContain("Friday");
  });

  it("reads a lapsed-customer brief as a win-back campaign", () => {
    const draft = draftCampaign({
      ...baseInput,
      prompt: "Win back customers who have not ordered in 60 days",
    });

    expect(draft.category).toBe("winback");
    expect(draft.templateId).toBe("winback");
  });

  it("writes the mailing address into the compliance footer", () => {
    const draft = draftCampaign({
      ...baseInput,
      prompt: "Monthly newsletter recapping what shipped",
    });

    const footer = draft.design.blocks.find(
      (block) => block.type === "compliance_footer",
    );
    expect(footer?.mailingAddress).toBe("1 Example Street");
  });

  it("warns instead of drafting a sendable campaign with no address", () => {
    const draft = draftCampaign({
      ...baseInput,
      mailingAddress: "",
      prompt: "Announce our spring sale",
    });

    expect(draft.notes.join(" ")).toContain("cannot send");
  });

  it("suggests a matching segment and says why", () => {
    const draft = draftCampaign({
      ...baseInput,
      prompt: "Win back lapsed buyers from last year",
      lists: [
        list({ id: "l1", name: "All subscribers", memberCount: 900 }),
        list({
          id: "l2",
          name: "Past customers",
          description: "inactive 60+ days",
          memberCount: 120,
        }),
      ],
    });

    expect(draft.segment?.listId).toBe("l2");
    expect(draft.segment?.reason).toContain("120");
  });

  it("suggests nothing rather than defaulting to the biggest list", () => {
    const draft = draftCampaign({
      ...baseInput,
      prompt: "Win back lapsed buyers from last year",
      lists: [list({ id: "l1", name: "Zzz", memberCount: 9000 })],
    });

    expect(draft.segment).toBeNull();
  });

  it("reflects the brand voice in the body copy", () => {
    const formal = draftCampaign({
      ...baseInput,
      brandVoice: "formal",
      prompt: "Announce our summer sale, 20% off",
    });
    const playful = draftCampaign({
      ...baseInput,
      brandVoice: "playful",
      prompt: "Announce our summer sale, 20% off",
    });

    const bodyOf = (draft: typeof formal) =>
      draft.design.blocks
        .filter((block) => block.type === "text")
        .map((block) => block.content)
        .join(" ");

    expect(bodyOf(formal)).toContain("We are writing to let you know");
    expect(bodyOf(playful)).toContain("Right then");
  });

  it("ranks stronger subject lines first", () => {
    const draft = draftCampaign({
      ...baseInput,
      prompt: "Announce our summer sale, 20% off, ends Friday",
    });

    const order = { Strong: 0, Good: 1, Weak: 2 } as const;
    const ranks = draft.subjects.map((option) => order[option.quality]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it("never returns more than five subject options", () => {
    const draft = draftCampaign({
      ...baseInput,
      prompt:
        "Announce our summer sale, 20% off, ends Friday, for past customers, with a webinar invite",
    });

    expect(draft.subjects.length).toBeGreaterThan(0);
    expect(draft.subjects.length).toBeLessThanOrEqual(5);
  });
});

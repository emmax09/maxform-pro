import { describe, expect, it } from "vitest";

import type { ContactCampaign } from "@/lib/contacts";

import { campaignIsDue, isEditable } from "./campaign-format";

const scheduledCampaign = (scheduledAt: string) =>
  ({
    status: "scheduled",
    scheduledAt,
    sendStartedAt: null,
    sentAt: null,
    stats: {},
  }) as ContactCampaign;

describe("campaign timing locks", () => {
  it("locks editing at the due instant", () => {
    const dueAt = new Date(Date.now() - 1_000).toISOString();
    const campaign = scheduledCampaign(dueAt);

    expect(campaignIsDue(campaign, Date.now())).toBe(true);
    expect(isEditable(campaign)).toBe(false);
  });

  it("keeps a future scheduled campaign editable", () => {
    const futureAt = new Date(Date.now() + 60_000).toISOString();
    const campaign = scheduledCampaign(futureAt);

    expect(campaignIsDue(campaign, Date.now())).toBe(false);
    expect(isEditable(campaign)).toBe(true);
  });
});

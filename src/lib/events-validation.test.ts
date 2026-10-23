import { describe, expect, it } from "vitest";

import type {
  EventDiscountRule,
  EventRecord,
} from "@/components/events/event-types";
import {
  defaultEventPricing,
  getEventDiscountRuleIssue,
  getEventPublishRequirements,
} from "@/lib/events";

const publishableEvent = (overrides: Partial<EventRecord> = {}) =>
  ({
    id: "event-1",
    title: "Modern Product Summit",
    description:
      "A complete event description with enough detail for attendees.",
    slug: "modern-product-summit",
    scheduleType: "date_range",
    eventDate: "",
    rangeStartDate: "2026-09-01",
    rangeEndDate: "2026-09-02",
    rangeScheduleMode: "continuous",
    startTime: "09:00",
    endTime: "17:00",
    dailySchedule: [],
    startsAt: "2026-09-01T09:00:00.000Z",
    endsAt: "2026-09-02T17:00:00.000Z",
    locationType: "physical",
    venueName: "Harbour Point",
    address: "12 Marina Road, Lagos",
    onlineUrl: "",
    publicSections: ["about"],
    registrationFormId: "form-1",
    ticketingEnabled: false,
    ticketPrefix: "MPS-",
    ticketPrefixConfigured: false,
    ticketTypeCount: 0,
    accessControl: "public",
    accessPassword: "",
    accessPasswordSet: false,
    inviteToken: "a1b2c3d4e5f60718293a4b5c",
    inviteMessage: "",
    pricing: defaultEventPricing("NGN"),
    discountRules: [],
    ...overrides,
  }) as EventRecord;

const discountRule = (
  overrides: Partial<EventDiscountRule> = {},
): EventDiscountRule => ({
  id: "discount-1",
  eventId: "event-1",
  name: "Early access",
  mode: "first_n",
  valueType: "percentage",
  value: 10,
  firstN: 10,
  minQuantity: 2,
  code: "",
  startsAt: "",
  endsAt: "",
  redemptionLimit: null,
  active: false,
  sortOrder: 0,
  ...overrides,
});

describe("event publishing requirements", () => {
  it("accepts a complete free-registration event", () => {
    const missing = getEventPublishRequirements(publishableEvent()).filter(
      (requirement) => !requirement.complete,
    );

    expect(missing).toEqual([]);
  });

  it("requires event-scoped ticket setup for ticketed events", () => {
    const missingIds = getEventPublishRequirements(
      publishableEvent({
        ticketingEnabled: true,
        ticketPrefixConfigured: false,
      }),
      0,
    )
      .filter((requirement) => !requirement.complete)
      .map((requirement) => requirement.id);

    expect(missingIds).toContain("ticket-prefix");
    expect(missingIds).toContain("ticket-types");
  });

  it("requires a positive workspace-currency price when pricing is enabled", () => {
    const missingIds = getEventPublishRequirements(
      publishableEvent({
        pricing: {
          ...defaultEventPricing("NGN"),
          enabled: true,
          amount: 0,
        },
      }),
    )
      .filter((requirement) => !requirement.complete)
      .map((requirement) => requirement.id);

    expect(missingIds).toContain("registration-price");
  });

  it("accepts a single-day event without range timestamps", () => {
    const missingIds = getEventPublishRequirements(
      publishableEvent({
        scheduleType: "single_day",
        eventDate: "2026-09-01",
        startTime: "09:00",
        endTime: "",
        startsAt: "",
        endsAt: "",
      }),
    )
      .filter((requirement) => !requirement.complete)
      .map((requirement) => requirement.id);

    expect(missingIds).not.toContain("schedule");
  });

  it("validates a different time window for every day in a date range", () => {
    const missingIds = getEventPublishRequirements(
      publishableEvent({
        rangeScheduleMode: "daily",
        dailySchedule: [
          { date: "2026-09-01", startTime: "09:00", endTime: "17:00" },
          { date: "2026-09-02", startTime: "11:00", endTime: "15:00" },
        ],
      }),
    )
      .filter((requirement) => !requirement.complete)
      .map((requirement) => requirement.id);

    expect(missingIds).not.toContain("schedule");
  });

  it("requires both a venue name and address for physical events", () => {
    const missingIds = getEventPublishRequirements(
      publishableEvent({ venueName: "" }),
    )
      .filter((requirement) => !requirement.complete)
      .map((requirement) => requirement.id);

    expect(missingIds).toContain("location");
  });

  it("requires a new or previously saved password for protected events", () => {
    const missingIds = getEventPublishRequirements(
      publishableEvent({
        accessControl: "password",
        accessPassword: "",
        accessPasswordSet: false,
      }),
    )
      .filter((requirement) => !requirement.complete)
      .map((requirement) => requirement.id);

    expect(missingIds).toContain("access-password");
    expect(
      getEventPublishRequirements(
        publishableEvent({
          accessControl: "password",
          accessPasswordSet: true,
        }),
      ).every((requirement) => requirement.complete),
    ).toBe(true);
  });
});

describe("event discount rules", () => {
  it("accepts a configured first-registration discount", () => {
    expect(getEventDiscountRuleIssue(discountRule())).toBe("");
  });

  it("rejects invalid percentages and incomplete promo codes", () => {
    expect(
      getEventDiscountRuleIssue(discountRule({ value: 120 })),
    ).toContain("100%");
    expect(
      getEventDiscountRuleIssue(
        discountRule({ mode: "promo_code", code: "" }),
      ),
    ).toContain("promo code");
  });
});

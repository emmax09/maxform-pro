import { describe, expect, it } from "vitest";

import { matchRoutingRule, resolveRoute } from "./routing";

const rules = [
  { id: "r1", field: "need", operator: "equals" as const, value: "Sales question", bookingPageId: "page-sales" },
  { id: "r2", field: "need", operator: "contains" as const, value: "support", bookingPageId: "page-support" },
  { id: "r3", field: "seats", operator: "not_equals" as const, value: "1", bookingPageId: "page-enterprise" },
];

describe("routing forms", () => {
  it("sends an answer to the booking page its rule names", () => {
    expect(resolveRoute(rules, { need: "Sales question" }, "page-default").bookingPageId).toBe("page-sales");
  });

  it("matches on a substring so wording does not have to be exact", () => {
    expect(resolveRoute(rules, { need: "Technical support please" }, "page-default").bookingPageId).toBe("page-support");
  });

  it("takes the first matching rule, so editor order is priority order", () => {
    // "Sales question" also satisfies r3 (seats is absent, so not_equals "1").
    expect(resolveRoute(rules, { need: "Sales question", seats: "4" }, "page-default").matchedRuleId).toBe("r1");
  });

  it("falls back rather than stranding a visitor with nowhere to book", () => {
    const route = resolveRoute(
      [rules[0]],
      { need: "Something else entirely" },
      "page-default",
    );
    expect(route.bookingPageId).toBe("page-default");
    expect(route.matchedRuleId).toBe("");
  });

  it("is case-insensitive, because answers are typed by people", () => {
    expect(matchRoutingRule(rules[0], { need: "SALES QUESTION" })).toBe(true);
  });

  it("treats a missing answer as unmatched for equals", () => {
    expect(matchRoutingRule(rules[0], {})).toBe(false);
  });
});

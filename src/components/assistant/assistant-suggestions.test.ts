import { describe, expect, it } from "vitest";

import { suggestionsFor } from "@/components/assistant/assistant-suggestions";

describe("home screen suggestions", () => {
  it("offers openers for the screen the person is on", () => {
    const payments = suggestionsFor({ module: "payments" });
    expect(payments).toHaveLength(3);
    expect(payments.join(" ")).toMatch(/payment/i);

    expect(suggestionsFor({ module: "crm" }).join(" ")).toMatch(/contact|lead/i);
  });

  it("leads with the open record when there is one", () => {
    const suggestions = suggestionsFor({
      module: "orders",
      recordType: "order",
      recordId: "o-1",
    });
    expect(suggestions[0]).toBe("Explain this order");
    expect(suggestions).toHaveLength(3);
  });

  it("falls back rather than showing nothing on an unknown screen", () => {
    const suggestions = suggestionsFor({ module: "something-new" });
    expect(suggestions).toHaveLength(3);
    expect(suggestions).toEqual(suggestionsFor({}));
  });

  it("never offers more than the panel has room for", () => {
    for (const module of ["payments", "crm", "orders", "home", "ai", ""]) {
      expect(suggestionsFor({ module }).length).toBeLessThanOrEqual(3);
    }
  });
});

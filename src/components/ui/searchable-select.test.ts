import { describe, expect, it } from "vitest";

import { searchableSelectFilter } from "@/lib/searchable-select-filter";

describe("searchableSelectFilter", () => {
  it("keeps currency phrase searches strict", () => {
    const ngn = "NGN NGN · Nigerian Naira ₦ Nigerian Naira Nigeria";
    const usd = "USD USD · US Dollar $ US Dollar United States";

    expect(searchableSelectFilter(ngn, "Nigerian naira")).toBeGreaterThan(0);
    expect(searchableSelectFilter(usd, "Nigerian naira")).toBe(0);
    expect(searchableSelectFilter(usd, "United States")).toBeGreaterThan(0);
  });

  it("ranks exact currency codes above partial matches", () => {
    const exact = searchableSelectFilter(
      "USD USD · US Dollar United States",
      "USD",
    );
    const partial = searchableSelectFilter(
      "BUSD Example currency",
      "USD",
    );
    expect(exact).toBeGreaterThan(partial);
  });
});

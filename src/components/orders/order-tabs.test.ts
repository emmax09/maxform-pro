import { describe, expect, it } from "vitest";

import { isOrdersTab, ORDER_TABS } from "./order-tabs";

describe("order tabs", () => {
  it("keeps Store orders discoverable beside the main order ledger", () => {
    expect(ORDER_TABS).toEqual([
      "overview",
      "all",
      "store_orders",
      "forms",
      "events",
      "invoices",
      "subscriptions",
      "items",
    ]);
    expect(isOrdersTab("store_orders")).toBe(true);
  });
});

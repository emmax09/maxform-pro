/**
 * The Orders module's on-screen tabs, kept in their own file so Dashboard can
 * validate a `?section=` deep link without pulling in the whole module.
 */
export const ORDER_TABS = [
  "overview",
  "all",
  "store_orders",
  "forms",
  "events",
  "invoices",
  "subscriptions",
  "items",
] as const;

export type OrdersTab = (typeof ORDER_TABS)[number];

export const DEFAULT_ORDERS_TAB: OrdersTab = "overview";

/**
 * Tabs that are a filtered view of the same ledger. The tab is the filter, so
 * there is one list implementation rather than five near-copies.
 */
export const ORDER_TAB_SOURCE: Partial<Record<OrdersTab, string>> = {
  forms: "form",
  events: "event",
  invoices: "invoice",
  subscriptions: "subscription",
};

export const isOrdersTab = (value: unknown): value is OrdersTab =>
  typeof value === "string" && (ORDER_TABS as readonly string[]).includes(value);

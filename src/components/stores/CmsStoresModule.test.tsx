import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import { CmsStoresModule } from "./CmsStoresModule";
import type { CmsWorkspace } from "@/lib/cms-stores";

const workspace: CmsWorkspace = {
  summary: {
    connectedSites: 1,
    healthySites: 1,
    products: 1,
    categories: 1,
    orders: 1,
    revenue: 125,
    currency: "USD",
  },
  connections: [{
    id: "11111111-1111-4111-8111-111111111111",
    platform: "shopify",
    platformName: "Shopify",
    name: "Main Shopify",
    storeUrl: "https://main.myshopify.com",
    externalStoreId: "main.myshopify.com",
    status: "healthy",
    webhookRegistered: true,
    lastError: "",
    lastSyncedAt: new Date().toISOString(),
    lastReconciliationAt: new Date().toISOString(),
    counts: { products: 1, categories: 1, orders: 1 },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }],
  products: [{
    id: "22222222-2222-4222-8222-222222222222",
    connectionId: "11111111-1111-4111-8111-111111111111",
    platform: "shopify",
    storeName: "Main Shopify",
    externalId: "gid://shopify/Product/1",
    title: "Starter kit",
    description: "",
    shortDescription: "",
    status: "active",
    sku: "STARTER",
    price: 125,
    compareAtPrice: null,
    salePrice: null,
    currency: "USD",
    inventoryQuantity: 7,
    inventoryManaged: true,
    featured: false,
    productType: "Kit",
    vendor: "MaxForm",
    tags: [],
    imageUrl: "",
    images: [],
    variants: [],
    externalUpdatedAt: null,
    lastPulledAt: new Date().toISOString(),
  }],
  categories: [{
    id: "33333333-3333-4333-8333-333333333333",
    connectionId: "11111111-1111-4111-8111-111111111111",
    platform: "shopify",
    storeName: "Main Shopify",
    externalId: "gid://shopify/Collection/1",
    name: "Featured",
    parentId: null,
    type: "collection",
    productCount: 1,
    lastPulledAt: new Date().toISOString(),
  }],
  orders: [{
    id: "44444444-4444-4444-8444-444444444444",
    connectionId: "11111111-1111-4111-8111-111111111111",
    platform: "shopify",
    storeName: "Main Shopify",
    externalId: "gid://shopify/Order/1",
    orderNumber: "#1001",
    status: "paid",
    fulfillmentStatus: "fulfilled",
    total: 125,
    currency: "USD",
    customerName: "Test buyer",
    customerEmail: "buyer@example.com",
    paymentGateway: "Shopify Payments",
    trackingNumber: "",
    lineItems: [{ name: "Starter kit", quantity: 1, total: 125 }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }],
  syncEvents: [],
  limits: { maxPerPlatform: 2, shopifyUsed: 1, woocommerceUsed: 0, bigcommerceUsed: 0, wixUsed: 0 },
};

const wooWorkspace: CmsWorkspace = {
  ...workspace,
  summary: { ...workspace.summary, connectedSites: 1, healthySites: 1 },
  connections: [{ ...workspace.connections[0], platform: "woocommerce", platformName: "WooCommerce", name: "Main WooCommerce", storeUrl: "https://shop.example.com" }],
  products: [{ ...workspace.products[0], platform: "woocommerce", storeName: "Main WooCommerce", productType: "variable", title: "Variable shirt", categoryIds: ["12"], attributes: [{ id: 4, name: "Color", slug: "color", options: ["Black", "White"], visible: true, variation: true, position: 0 }], customFields: [{ id: 80, key: "_price_label", value: "Featured", valueType: "string" }], variants: [{ id: "variant-row", externalId: "21", title: "Black shirt", status: "publish", sku: "SHIRT-BLK", price: 25, compareAtPrice: 30, inventoryQuantity: 9, inventoryManaged: true, imageUrl: "https://cdn.example.com/black.jpg", attributes: { Color: "Black" }, customFields: [{ id: 81, key: "_variation_note", value: "Fast ship", valueType: "string" }] }] }],
  categories: [{ ...workspace.categories[0], platform: "woocommerce", storeName: "Main WooCommerce", externalId: "12", name: "Clothing", type: "category" }],
  limits: { ...workspace.limits, shopifyUsed: 0, woocommerceUsed: 1 },
};

describe("CmsStoresModule", () => {
  beforeEach(() => {
    localStorage.setItem("access_token", "test-token");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ value: workspace }) })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("loads the overview and exposes every store workspace tab", async () => {
    render(<CmsStoresModule onOpenConnector={vi.fn()} />);

    expect(await screen.findByRole("heading", { name: "Connected stores" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Store orders/i })).toHaveAttribute(
      "href",
      "/dashboard?tab=orders&section=store_orders",
    );
    for (const label of ["Overview", "Analytics", "Connected sites", "Products", "Categories", "Sync activity", "Settings"]) {
      expect(screen.getByRole("tab", { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByRole("tab", { name: "Orders" })).not.toBeInTheDocument();
  });

  it("switches tabs without another data request", async () => {
    const fetchMock = vi.mocked(fetch);
    render(<CmsStoresModule onOpenConnector={vi.fn()} />);
    await screen.findByText("Main Shopify");

    const productsTab = screen.getByRole("tab", { name: "Products" });
    fireEvent.pointerDown(productsTab, { button: 0, ctrlKey: false });
    fireEvent.mouseDown(productsTab, { button: 0 });
    fireEvent.click(productsTab);
    expect(await screen.findByRole("heading", { name: "Products" })).toBeInTheDocument();
    expect(screen.getByText("Starter kit")).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("routes connection entry points to Store connector", async () => {
    const onOpenConnector = vi.fn();
    render(<CmsStoresModule onOpenConnector={onOpenConnector} />);
    await screen.findByText("Main Shopify");
    fireEvent.click(screen.getByRole("button", { name: /Connect store/i }));
    fireEvent.click(screen.getByRole("tab", { name: "Connected sites" }));
    expect(await screen.findByRole("heading", { name: "Connected sites" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View orders/i })).toHaveAttribute(
      "href",
      `/dashboard?tab=orders&section=store_orders&site=${workspace.connections[0].id}`,
    );
    fireEvent.click(screen.getByRole("button", { name: /Manage connection/i }));

    expect(onOpenConnector).toHaveBeenNthCalledWith(1, "providers");
    expect(onOpenConnector).toHaveBeenNthCalledWith(2, "connections");
    expect(screen.queryByRole("heading", { name: "Connect a store" })).not.toBeInTheDocument();
  });

  it("opens a WooCommerce variable product with variation and custom-field controls", async () => {
    vi.mocked(fetch).mockImplementation(async () => ({ ok: true, json: async () => ({ value: wooWorkspace }) }) as Response);
    render(<CmsStoresModule initialTab="products" onOpenConnector={vi.fn()} />);

    expect(await screen.findByText("Variable shirt")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit Variable shirt" }));

    expect(await screen.findByLabelText("WooCommerce product type")).toHaveValue("variable");
    expect(screen.getByText("Variations")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Color=Black")).toBeInTheDocument();
    expect(screen.getByDisplayValue("_price_label")).toBeInTheDocument();
    expect(screen.getByDisplayValue("_variation_note")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Add variation/i }));
    expect(screen.getByText("Variation 2 · New")).toBeInTheDocument();
  });
});

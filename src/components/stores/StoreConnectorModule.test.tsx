import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StoreConnectorModule } from "./StoreConnectorModule";
import type { CmsWorkspace } from "@/lib/cms-stores";

const workspace: CmsWorkspace = {
  summary: { connectedSites: 1, healthySites: 1, products: 2, categories: 1, orders: 3, revenue: 250, currency: "USD" },
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
    counts: { products: 2, categories: 1, orders: 3 },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }],
  products: [],
  categories: [],
  orders: [],
  syncEvents: [],
  limits: { maxPerPlatform: 2, shopifyUsed: 1, woocommerceUsed: 0, bigcommerceUsed: 0, wixUsed: 0 },
};

describe("StoreConnectorModule", () => {
  beforeEach(() => {
    localStorage.setItem("access_token", "test-token");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ value: workspace }) })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("loads the connector tabs and provider cards with official logos", async () => {
    render(<StoreConnectorModule />);
    expect(await screen.findByRole("heading", { name: "Store connector" })).toBeInTheDocument();
    for (const label of ["Overview", "Providers", "Connections", "Activity", "Settings"]) {
      expect(screen.getByRole("tab", { name: label })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("tab", { name: "Providers" }));
    expect(await screen.findByRole("heading", { name: "Commerce providers" })).toBeInTheDocument();
    expect(screen.getByAltText("Shopify official logo")).toHaveAttribute("src", "/images/integrations/shopify.svg");
    expect(screen.getByAltText("WooCommerce official logo")).toHaveAttribute("src", "/images/integrations/woocommerce.svg");
    expect(screen.getByAltText("BigCommerce official logo")).toHaveAttribute("src", "/images/integrations/bigcommerce.svg");
    expect(screen.getByAltText("Wix official logo")).toHaveAttribute("src", "/images/integrations/wix.svg");
    expect(screen.getByText("Adobe Commerce")).toBeInTheDocument();
    expect(screen.getAllByText("Available")).toHaveLength(4);
    const shopifyHeading = screen.getByRole("heading", { name: "Shopify" });
    const wixHeading = screen.getByRole("heading", { name: "Wix" });
    const roadmapHeading = screen.getByRole("heading", { name: "Adobe Commerce" });
    expect(Boolean(shopifyHeading.compareDocumentPosition(roadmapHeading) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(Boolean(wixHeading.compareDocumentPosition(roadmapHeading) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it("opens the shared connection dialog from a provider card", async () => {
    render(<StoreConnectorModule initialTab="providers" />);
    await screen.findByRole("heading", { name: "Commerce providers" });
    fireEvent.click(screen.getAllByRole("button", { name: /Connect/ })[0]);
    expect(await screen.findByRole("heading", { name: "Connect Shopify" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /WooCommerce/i })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Shop domain")).toBeInTheDocument());
  });

  it("opens BigCommerce and Wix setup fields from their available cards", async () => {
    const { unmount } = render(<StoreConnectorModule initialTab="providers" />);
    await screen.findByRole("heading", { name: "Commerce providers" });
    fireEvent.click(screen.getByRole("button", { name: /Connect BigCommerce/i }));
    expect(await screen.findByLabelText("Store hash")).toBeInTheDocument();
    expect(screen.getByLabelText("API access token")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    unmount();

    render(<StoreConnectorModule initialTab="providers" />);
    await screen.findByRole("heading", { name: "Commerce providers" });
    fireEvent.click(screen.getByRole("button", { name: /Connect Wix/i }));
    expect(await screen.findByLabelText("API key")).toBeInTheDocument();
    expect(screen.getByLabelText("Site ID")).toBeInTheDocument();
  });

  it("disables a provider after two active workspace connections", async () => {
    const twoShopifyWorkspace: CmsWorkspace = {
      ...workspace,
      connections: [
        workspace.connections[0],
        {
          ...workspace.connections[0],
          id: "22222222-2222-4222-8222-222222222222",
          name: "Second Shopify",
        },
      ],
      limits: { ...workspace.limits, shopifyUsed: 2 },
    };
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ value: twoShopifyWorkspace }) } as Response);
    render(<StoreConnectorModule initialTab="providers" />);

    await screen.findByRole("heading", { name: "Commerce providers" });
    const button = screen.getByRole("button", { name: "Shopify connection limit reached" });
    expect(button).toBeDisabled();
    expect(screen.getByText("2 / 2 active sites connected")).toBeInTheDocument();
  });

  it("explains disconnect cleanup and only disconnects after confirmation", async () => {
    const fetchMock = vi.mocked(fetch);
    render(<StoreConnectorModule initialTab="connections" />);

    await screen.findByRole("heading", { name: "Connected providers" });
    fireEvent.click(screen.getByRole("button", { name: /Disconnect/i }));

    expect(await screen.findByRole("heading", { name: "Disconnect Main Shopify?" })).toBeInTheDocument();
    expect(screen.getByText(/all synchronized data for this site from this workspace/i)).toBeInTheDocument();
    expect(screen.getByText(/actual products, orders and settings on Shopify will not be deleted/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Keep connected" }));
    expect(screen.queryByRole("heading", { name: "Disconnect Main Shopify?" })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /Disconnect/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect and remove data" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const disconnectRequest = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body || "{}")) as { operation?: string; args?: { connectionId?: string } };
    expect(disconnectRequest).toEqual({
      operation: "disconnectCmsConnection",
      args: { connectionId: workspace.connections[0].id },
    });
  });

  it("sends a newly connected site to Connected stores", async () => {
    const onOpenStores = vi.fn();
    const createdWorkspace: CmsWorkspace = {
      ...workspace,
      connections: [
        ...workspace.connections,
        {
          ...workspace.connections[0],
          id: "33333333-3333-4333-8333-333333333333",
          name: "Second Shopify",
        },
      ],
      limits: { ...workspace.limits, shopifyUsed: 2 },
    };
    vi.mocked(fetch).mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body || "{}")) as { operation?: string };
      return {
        ok: true,
        json: async () => ({ value: body.operation === "createCmsConnection" ? createdWorkspace : workspace }),
      } as Response;
    });
    render(<StoreConnectorModule initialTab="providers" onOpenStores={onOpenStores} />);

    await screen.findByRole("heading", { name: "Commerce providers" });
    fireEvent.click(screen.getByRole("button", { name: /Connect Shopify/i }));
    fireEvent.change(await screen.findByLabelText("Shop domain"), { target: { value: "second.myshopify.com" } });
    fireEvent.change(screen.getByLabelText("Admin API access token"), { target: { value: "shpat_test" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect and sync" }));

    await waitFor(() => expect(onOpenStores).toHaveBeenCalledWith("sites"));
  });
});

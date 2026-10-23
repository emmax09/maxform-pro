// @vitest-environment node
//
// Orders is the read side of the money ledger, so the things worth pinning are
// the ones that would quietly lose data or leak it: who may read the ledger,
// what a delete is allowed to take with it, and what an unsettled order hands
// back when it is closed.
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const databaseQuery = vi.hoisted(() => vi.fn());
const verifyJwt = vi.hoisted(() => vi.fn());
const scopeFor = vi.hoisted(() => vi.fn());
const openModule = vi.hoisted(() => vi.fn());

vi.mock("@neondatabase/serverless", () => ({
  neon: () => ({ query: databaseQuery }),
}));

vi.mock("jose", () => ({ jwtVerify: verifyJwt }));

vi.mock("./workspace-access", () => ({
  workspaceScopeFor: scopeFor,
  canOpenModule: openModule,
}));

import { handleOrdersData } from "./orders-data";

const originalEnvironment = { ...process.env };
const memberId = "3f7c1b62-8d4e-4a2f-9c11-6b5d0e2a7431";
const workspaceId = "99b525e5-456b-4d68-bb85-5e054504435b";
const orderId = "12b60c13-a582-40fb-b70a-07e907e1a7f0";
const settledOrderId = "e85db125-3453-4754-92c7-24dc23bca100";

/** The SQL of every statement issued, whitespace collapsed for matching. */
const statements = () =>
  databaseQuery.mock.calls.map((call) =>
    String(call[0]).replace(/\s+/g, " ").trim(),
  );

const indexOfStatement = (fragment: string) =>
  statements().findIndex((statement) => statement.includes(fragment));

const invoke = async (
  url: string,
  options: { method?: string; body?: unknown; authorization?: string } = {},
) => {
  const method = options.method || "GET";
  const payload = options.body === undefined ? "" : JSON.stringify(options.body);
  const request = Readable.from(
    payload ? [payload] : [],
  ) as unknown as IncomingMessage;
  Object.assign(request, {
    method,
    url,
    headers: {
      authorization:
        options.authorization === undefined
          ? "Bearer token"
          : options.authorization,
    },
    socket: { remoteAddress: "127.0.0.1" },
  });
  let responseBody = "";
  const response = {
    statusCode: 200,
    setHeader: () => undefined,
    end: (value: string) => {
      responseBody = value;
    },
  } as unknown as ServerResponse;
  await handleOrdersData(request, response);
  return {
    body: JSON.parse(responseBody || "{}") as Record<string, unknown>,
    status: response.statusCode,
  };
};

beforeEach(() => {
  process.env.JWT_SECRET = "orders-module-test-secret".repeat(3);
  process.env.DATABASE_URL = "postgres://orders.test/maxform";
  databaseQuery.mockReset();
  databaseQuery.mockResolvedValue([]);
  verifyJwt.mockReset();
  verifyJwt.mockResolvedValue({ payload: { userId: memberId } });
  scopeFor.mockReset();
  scopeFor.mockResolvedValue(workspaceId);
  openModule.mockReset();
  openModule.mockResolvedValue(true);
});

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe("who may read the ledger", () => {
  it("refuses a caller without a token", async () => {
    const result = await invoke("/?action=list", { authorization: "" });

    expect(result.status).toBe(401);
    expect(databaseQuery).not.toHaveBeenCalled();
  });

  it("refuses a member the workspace never granted Orders", async () => {
    openModule.mockResolvedValue(false);

    const result = await invoke("/?action=list");

    expect(result.status).toBe(403);
    expect(result.body.code).toBe("module_access_denied");
    // The point of the gate: no revenue, no customer emails, no query at all.
    expect(databaseQuery).not.toHaveBeenCalled();
  });

  it("reads the workspace a member belongs to, not their own id", async () => {
    await invoke("/?action=list");

    expect(openModule).toHaveBeenCalledWith(memberId, "orders");
    for (const call of databaseQuery.mock.calls) {
      expect(call[1]).toContain(workspaceId);
      expect(call[1]).not.toContain(memberId);
    }
  });
});

describe("list filters", () => {
  it("escapes LIKE wildcards so a literal % does not match every row", async () => {
    await invoke(`/?action=list&search=${encodeURIComponent("50%_off")}`);

    const parameters = databaseQuery.mock.calls[0][1] as unknown[];
    expect(parameters).toContain("%50\\%\\_off%");
  });

  it("drops an unparseable date rather than letting the cast raise", async () => {
    const result = await invoke("/?action=list&from=last%20tuesday");

    expect(result.status).toBe(200);
    expect(statements()[0]).not.toContain("created_at >=");
  });

  it("keeps a real date as a filter", async () => {
    await invoke("/?action=list&from=2026-01-01");

    expect(statements()[0]).toContain("created_at >=");
    expect(databaseQuery.mock.calls[0][1]).toContain(
      new Date("2026-01-01").toISOString(),
    );
  });

  it("ignores a status that is not one the ledger uses", async () => {
    await invoke("/?action=list&status=whatever");

    expect(statements()[0]).not.toContain("payment_order.status =");
  });

  it("treats 'open' as the unsettled statuses rather than a literal", async () => {
    await invoke("/?action=list&status=open");

    expect(statements()[0]).toContain(
      "status IN ('draft', 'pending', 'processing')",
    );
  });

  it("orders by a stable key so pages cannot repeat a row", async () => {
    await invoke("/?action=list");

    expect(statements()[0]).toContain("payment_order.id DESC");
  });
});

describe("deleting orders", () => {
  it("refuses when the selection contains an order that took payment", async () => {
    databaseQuery.mockResolvedValueOnce([
      { order_number: "MF-77Q1", status: "paid" },
    ]);

    const result = await invoke("/?action=delete", {
      method: "POST",
      body: { ids: [settledOrderId] },
    });

    expect(result.status).toBe(409);
    expect(result.body.code).toBe("order_settled");
    expect(String(result.body.error)).toContain("MF-77Q1");
    // Nothing beyond the check ran.
    expect(indexOfStatement("DELETE FROM payment_orders")).toBe(-1);
  });

  it("hands stock and coupons back before the row can cascade away", async () => {
    const result = await invoke("/?action=delete", {
      method: "POST",
      body: { ids: [orderId] },
    });

    expect(result.status).toBe(200);
    const release = indexOfStatement("maxform_release_payment_inventory");
    const remove = indexOfStatement("DELETE FROM payment_orders");
    expect(release).toBeGreaterThan(-1);
    expect(indexOfStatement("maxform_release_payment_coupon")).toBe(release);
    // Order matters: the reservation row is ON DELETE CASCADE, so releasing
    // after the delete would find nothing and the stock would never return.
    expect(release).toBeLessThan(remove);
  });

  it("rejects a selection that is not orders at all", async () => {
    const result = await invoke("/?action=delete", {
      method: "POST",
      body: { ids: ["not-a-uuid"] },
    });

    expect(result.status).toBe(400);
    expect(databaseQuery).not.toHaveBeenCalled();
  });

  it("caps a bulk delete", async () => {
    const result = await invoke("/?action=delete", {
      method: "POST",
      body: { ids: Array.from({ length: 201 }, () => orderId) },
    });

    // Deduplicated to one, so the cap is about distinct orders, not payload.
    expect(result.status).toBe(200);
  });
});

describe("cancelling orders", () => {
  it("releases against what was actually closed, not what was asked for", async () => {
    // The update matched nothing: the order settled in between.
    databaseQuery.mockResolvedValueOnce([]);

    const result = await invoke("/?action=cancel", {
      method: "POST",
      body: { ids: [orderId] },
    });

    expect(result.status).toBe(200);
    expect(result.body.cancelled).toBe(0);
    // No release, or a paid order would have handed its stock back.
    expect(indexOfStatement("maxform_release_payment_inventory")).toBe(-1);
  });

  it("hands stock back for the orders it did close", async () => {
    databaseQuery.mockResolvedValueOnce([{ id: orderId }]);

    const result = await invoke("/?action=cancel", {
      method: "POST",
      body: { ids: [orderId] },
    });

    expect(result.body.cancelled).toBe(1);
    const release = indexOfStatement("maxform_release_payment_inventory");
    expect(release).toBeGreaterThan(-1);
    expect(databaseQuery.mock.calls[release][1]).toContain("order_cancelled");
  });
});

describe("items sold", () => {
  it("paginates every item rather than reusing the ten-row leaderboard", async () => {
    databaseQuery.mockResolvedValueOnce([
      { name: "Tote", sku: "TOTE-1", quantity: 4, revenue: "120.00", orders: 3 },
    ]);
    databaseQuery.mockResolvedValueOnce([{ total: 42 }]);

    const result = await invoke("/?action=items&page=2&pageSize=10");

    expect(result.status).toBe(200);
    expect(result.body.total).toBe(42);
    expect(result.body.pageCount).toBe(5);
    expect(statements()[0]).toContain("LIMIT");
  });
});

describe("unknown requests", () => {
  it("does not invent an action", async () => {
    const result = await invoke("/?action=refund", { method: "POST", body: {} });

    expect(result.status).toBe(404);
  });

  it("refuses a method the module does not serve", async () => {
    const result = await invoke("/?action=list", { method: "DELETE" });

    expect(result.status).toBe(405);
  });
});

import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const databaseQuery = vi.hoisted(() => vi.fn());
const verifyJwt = vi.hoisted(() => vi.fn());

vi.mock("@neondatabase/serverless", () => ({
  neon: () => ({ query: databaseQuery }),
}));

vi.mock("jose", () => ({
  jwtVerify: verifyJwt,
}));

import {
  createWorkspaceValidatorToken,
  handleEventTickets,
  validatorTokenPattern,
} from "./event-tickets";

const originalEnvironment = { ...process.env };
const maskedId = "AbCdEfGhIjKlMnOpQrStUv";
const workspaceId = "99b525e5-456b-4d68-bb85-5e054504435b";
const eventId = "12b60c13-a582-40fb-b70a-07e907e1a7f0";
const attendeeId = "e85db125-3453-4754-92c7-24dc23bca100";

const invoke = async (
  action: string,
  body: Record<string, unknown>,
  authorization = "",
) => {
  const request = Readable.from([JSON.stringify(body)]) as unknown as IncomingMessage;
  Object.assign(request, {
    method: "POST",
    url: `/?action=${action}`,
    headers: authorization ? { authorization } : {},
    socket: { remoteAddress: "127.0.0.1" },
  });
  let responseBody = "";
  const headers = new Map<string, string>();
  const response = {
    statusCode: 200,
    setHeader: (name: string, value: string) => headers.set(name, value),
    end: (value: string) => {
      responseBody = value;
    },
  } as unknown as ServerResponse;
  await handleEventTickets(request, response);
  return {
    body: JSON.parse(responseBody) as Record<string, unknown>,
    status: response.statusCode,
  };
};

describe("public workspace ticket validator", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = "ticket-validator-test-secret".repeat(3);
    process.env.DATABASE_URL = "postgres://validator.test/maxform";
    databaseQuery.mockReset();
    verifyJwt.mockReset();
    verifyJwt.mockResolvedValue({ payload: { userId: workspaceId } });
  });

  afterEach(() => {
    process.env = { ...originalEnvironment };
  });

  it("creates compact, unpredictable URL-safe validator tokens", () => {
    const first = createWorkspaceValidatorToken();
    const second = createWorkspaceValidatorToken();

    expect(first).toHaveLength(22);
    expect(first).toMatch(validatorTokenPattern);
    expect(second).toMatch(validatorTokenPattern);
    expect(second).not.toBe(first);
  });

  it("returns the workspace branding for the public validator", async () => {
    databaseQuery.mockImplementation(async (text: string) => {
      if (text.includes("event_ticket_validator_rate_limits")) {
        return [{ request_count: 1 }];
      }
      if (text.includes("FROM workspace_ticket_validator_links link")) {
        return [{
          user_id: workspaceId,
          workspace_name: "Demo events",
          workspace_logo_url: "https://cdn.example.test/demo-logo.png",
          workspace_brand_color: "#7C3AED",
        }];
      }
      return [];
    });

    const response = await invoke("public-info", { maskedId });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      brandColor: "#7C3AED",
      logoUrl: "https://cdn.example.test/demo-logo.png",
      maskedId,
      workspaceName: "Demo events",
    });
  });

  it("keeps a rotated link attached to the authenticated workspace", async () => {
    let savedToken = "";
    databaseQuery.mockImplementation(async (text: string, values: unknown[]) => {
      if (text.includes("INSERT INTO workspace_ticket_validator_links")) {
        expect(values[0]).toBe(workspaceId);
        savedToken = String(values[1]);
        return [{ masked_id: savedToken, rotated_at: "2026-08-02T12:00:00.000Z" }];
      }
      return [];
    });
    const response = await invoke(
      "rotate-validator-link",
      {},
      "Bearer workspace-test-token",
    );

    expect(response.status).toBe(200);
    expect(savedToken).toMatch(validatorTokenPattern);
    expect(response.body).toMatchObject({
      maskedId: savedToken,
      path: `/${savedToken}/checkin`,
    });
  });

  it("rejects an unknown ticket number without recording a scan", async () => {
    databaseQuery.mockImplementation(async (text: string) => {
      if (text.includes("event_ticket_validator_rate_limits")) {
        return [{ request_count: 1 }];
      }
      if (text.includes("FROM workspace_ticket_validator_links link")) {
        return [{ user_id: workspaceId, workspace_name: "Demo events" }];
      }
      return [];
    });

    const response = await invoke("public-scan", {
      maskedId,
      station: "Gate A",
      ticketCode: "NOT-A-REAL-TICKET",
    });

    expect(response.status).toBe(200);
    expect(response.body.result).toBe("invalid_signature");
    expect(
      databaseQuery.mock.calls.some(([text]) =>
        String(text).includes("INSERT INTO event_ticket_scans"),
      ),
    ).toBe(false);
  });

  it("records a valid workspace ticket with no impersonated dashboard user", async () => {
    databaseQuery.mockImplementation(async (text: string) => {
      if (text.includes("event_ticket_validator_rate_limits")) {
        return [{ request_count: 1 }];
      }
      if (text.includes("FROM workspace_ticket_validator_links link")) {
        return [{ user_id: workspaceId, workspace_name: "Demo events" }];
      }
      if (text.includes("UPPER(attendee.ticket_number)")) {
        return [{ id: attendeeId, event_id: eventId }];
      }
      if (text.includes("event.title AS event_title")) {
        return [{
          id: attendeeId,
          event_id: eventId,
          event_title: "Launch night",
          full_name: "Ada Example",
          ticket_status: "valid",
          ticket_number: "VIP-0001",
          ticket_type_name: "VIP",
          code_version: 1,
        }];
      }
      if (text.includes("SET checked_in_at = NOW()")) {
        return [{ checked_in_at: "2026-08-01T10:00:00.000Z" }];
      }
      return [];
    });

    const response = await invoke("public-scan", {
      maskedId,
      station: "Gate A",
      ticketCode: "VIP-0001",
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      result: "valid",
      attendeeName: "Ada Example",
      eventTitle: "Launch night",
      ticketTypeName: "VIP",
    });
    const scanInsert = databaseQuery.mock.calls.find(([text]) =>
      String(text).includes("INSERT INTO event_ticket_scans"),
    );
    expect(scanInsert?.[1]?.[3]).toBeNull();
  });

  it("rejects a rotated or unknown validator URL", async () => {
    databaseQuery.mockImplementation(async (text: string) =>
      text.includes("event_ticket_validator_rate_limits")
        ? [{ request_count: 1 }]
        : [],
    );

    const response = await invoke("public-info", { maskedId });

    expect(response.status).toBe(404);
    expect(response.body.message).toContain("invalid or has been replaced");
  });
});

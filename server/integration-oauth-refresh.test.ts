// @vitest-environment node
//
// Closes the "publishing was never tested against a live provider" gap as far
// as it can be closed without real credentials.
//
// Real OAuth credentials are not what breaks in production — expiry is. A
// connection works for an hour, the access token lapses, and every workflow
// depending on it starts failing at 3am. That refresh path is pure HTTP plus
// branching on provider quirks, so it can be driven against a fake token
// endpoint and asserted exactly. What is left for a staging smoke test is only
// the part that genuinely needs a real account: the consent screen.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { refreshIntegrationCredentials } from "./integration-oauth";

type Call = { url: string; init: RequestInit };

let calls: Call[] = [];
let respond: () => { status: number; body: unknown };

const originalFetch = globalThis.fetch;

beforeEach(() => {
  calls = [];
  respond = () => ({
    status: 200,
    body: { access_token: "fresh-token", expires_in: 3600, token_type: "Bearer" },
  });
  process.env.GOOGLE_CLIENT_ID = "test-google-id";
  process.env.GOOGLE_CLIENT_SECRET = "test-google-secret";
  process.env.NOTION_CLIENT_ID = "test-notion-id";
  process.env.NOTION_CLIENT_SECRET = "test-notion-secret";
  globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init || {} });
    const { status, body } = respond();
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** The form-encoded body the refresh request actually sent. */
const sentParams = () => new URLSearchParams(String(calls[0]?.init.body ?? ""));

describe("refreshing an expiring provider token", () => {
  it("exchanges the refresh token at the provider's token endpoint", async () => {
    const result = await refreshIntegrationCredentials("google_sheets", {
      accessToken: "stale-token",
      refreshToken: "refresh-abc",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://oauth2.googleapis.com/token");
    expect(calls[0].init.method).toBe("POST");
    expect(sentParams().get("grant_type")).toBe("refresh_token");
    expect(sentParams().get("refresh_token")).toBe("refresh-abc");
    expect(result.accessToken).toBe("fresh-token");
  });

  it("keeps the existing refresh token when the provider does not reissue one", async () => {
    // Google returns no refresh_token on refresh. Overwriting with undefined
    // here would silently make the connection unrefreshable next time — the
    // failure would surface an hour later, far from the cause.
    const result = await refreshIntegrationCredentials("google_sheets", {
      accessToken: "stale-token",
      refreshToken: "refresh-abc",
    });

    expect(result.refreshToken).toBe("refresh-abc");
  });

  it("adopts a rotated refresh token when the provider does reissue one", async () => {
    respond = () => ({
      status: 200,
      body: { access_token: "fresh-token", refresh_token: "refresh-rotated", expires_in: 3600 },
    });

    const result = await refreshIntegrationCredentials("google_sheets", {
      accessToken: "stale-token",
      refreshToken: "refresh-abc",
    });

    expect(result.refreshToken).toBe("refresh-rotated");
  });

  it("derives an absolute expiry so the next run knows when to refresh again", async () => {
    const before = Date.now();
    const result = await refreshIntegrationCredentials("google_sheets", {
      accessToken: "stale-token",
      refreshToken: "refresh-abc",
    });

    const expiresAt = Date.parse(String(result.expiresAt));
    expect(expiresAt).toBeGreaterThanOrEqual(before + 3_600_000 - 5_000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 3_600_000 + 5_000);
  });

  it("sends client credentials in the body for providers that expect them there", async () => {
    await refreshIntegrationCredentials("google_sheets", {
      accessToken: "stale",
      refreshToken: "refresh-abc",
    });

    expect(sentParams().get("client_id")).toBe("test-google-id");
    expect(sentParams().get("client_secret")).toBe("test-google-secret");
    expect(calls[0].init.headers).not.toHaveProperty("Authorization");
  });

  it("sends Basic auth for providers that reject credentials in the body", async () => {
    // Notion and Airtable authenticate the refresh request itself. Getting this
    // branch wrong fails only for those providers, which is exactly the kind of
    // gap a single happy-path test misses.
    await refreshIntegrationCredentials("notion", {
      accessToken: "stale",
      refreshToken: "refresh-abc",
    });

    const headers = calls[0].init.headers as Record<string, string>;
    const expected = Buffer.from("test-notion-id:test-notion-secret").toString("base64");
    expect(headers.Authorization).toBe(`Basic ${expected}`);
    expect(sentParams().get("client_secret")).toBeNull();
  });
});

describe("when refreshing cannot succeed", () => {
  it("asks the user to reconnect when there is no refresh token to spend", async () => {
    await expect(
      refreshIntegrationCredentials("google_sheets", { accessToken: "stale" }),
    ).rejects.toThrow(/reconnect/i);
    // No point calling the provider without one.
    expect(calls).toHaveLength(0);
  });

  it("fails loudly when the provider answers without an access token", async () => {
    // A revoked grant returns 200 with an error body on some providers. Treating
    // that as success would store an empty token and fail on the next action
    // with a meaningless error.
    respond = () => ({ status: 200, body: { error: "invalid_grant" } });

    await expect(
      refreshIntegrationCredentials("google_sheets", {
        accessToken: "stale",
        refreshToken: "revoked",
      }),
    ).rejects.toThrow(/did not refresh/i);
  });

  it("surfaces a provider outage rather than silently continuing", async () => {
    respond = () => ({ status: 503, body: { error: "unavailable" } });

    await expect(
      refreshIntegrationCredentials("google_sheets", {
        accessToken: "stale",
        refreshToken: "refresh-abc",
      }),
    ).rejects.toThrow();
  });
});

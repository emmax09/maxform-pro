import { createServer } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  campaignAttributionCookie,
  campaignAttributionMessageId,
  campaignClickUrl,
  campaignListUnsubscribeHeaders,
  campaignOpenUrl,
  campaignPublicOrigin,
  campaignSendAllowed,
  campaignUnsubscribeUrl,
  decorateCampaignEmail,
  handleCampaignUnsubscribe,
} from "./campaign-tracking";

const originalEnvironment = { ...process.env };

beforeEach(() => {
  process.env.CAMPAIGN_TRACKING_SECRET = "campaign-tracking-test-secret-123456789";
  process.env.PUBLIC_APP_URL = "https://app.maxform.test";
  delete process.env.APP_BASE_URL;
  delete process.env.PAYMENT_PROVIDER_BASE_URL;
  delete process.env.AUTH_OAUTH_BASE_URL;
  delete process.env.INTEGRATION_OAUTH_BASE_URL;
  delete process.env.VERCEL_URL;
});

afterEach(() => {
  process.env = { ...originalEnvironment };
});

describe("campaign engagement tracking", () => {
  it("creates signed first-party URLs and deliverability headers", () => {
    const messageId = "f0425db7-0a28-4d5d-8b80-78e32836a6c6";
    const unsubscribe = campaignUnsubscribeUrl(messageId);

    expect(campaignPublicOrigin()).toBe("https://app.maxform.test");
    expect(campaignOpenUrl(messageId)).toMatch(/^https:\/\/app\.maxform\.test\/api\/campaigns\/track\?token=/);
    expect(campaignClickUrl(messageId, "https://example.com/offer")).toMatch(/\/api\/campaigns\/track\?token=/);
    expect(campaignListUnsubscribeHeaders(unsubscribe)).toEqual({
      "List-Unsubscribe": `<${unsubscribe}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  it("adds a recipient-safe compliance footer, pixel, and click redirect", () => {
    const html = decorateCampaignEmail(
      '<html><body><p>Hello</p><a href="https://example.com/offer">Open offer</a></body></html>',
      "f0425db7-0a28-4d5d-8b80-78e32836a6c6",
      "651 N Broad Street Middletown\nArivaca Junction, Arizona\n197098\nUnited States",
    );

    expect(html).toContain("Unsubscribe");
    expect(html).toContain("651 N Broad Street Middletown");
    expect(html).toContain('role="separator"');
    expect(html).toContain("border-top:1px solid #E2E8F0");
    expect(html).toContain("/api/campaigns/track?token=");
    expect(html).toContain("width=\"1\"");
  });

  it("only permits a local tracking origin behind the explicit dev flag", () => {
    delete process.env.PUBLIC_APP_URL;
    delete process.env.APP_BASE_URL;
    delete process.env.PAYMENT_PROVIDER_BASE_URL;
    delete process.env.AUTH_OAUTH_BASE_URL;
    delete process.env.INTEGRATION_OAUTH_BASE_URL;
    process.env.ALLOW_DEV_CAMPAIGN_SEND = "true";
    process.env.PUBLIC_APP_URL = "http://localhost:8080";
    process.env.NODE_ENV = "development";

    expect(campaignPublicOrigin()).toBe("http://localhost:8080");
    expect(campaignSendAllowed()).toBe(true);

    process.env.VERCEL_ENV = "production";
    expect(campaignPublicOrigin()).toBe("");
    expect(campaignSendAllowed()).toBe(false);
  });

  it("refuses campaign delivery when development sending is not explicitly enabled", () => {
    process.env.NODE_ENV = "development";
    process.env.PUBLIC_APP_URL = "https://app.maxform.test";
    process.env.ALLOW_DEV_CAMPAIGN_SEND = "false";

    expect(campaignSendAllowed()).toBe(false);

    process.env.ALLOW_DEV_CAMPAIGN_SEND = "true";
    expect(campaignSendAllowed()).toBe(true);
  });

  it("rejects temporary origins from deployed campaign delivery", () => {
    process.env.NODE_ENV = "production";
    process.env.PUBLIC_APP_URL = "https://preview.ngrok-free.dev";
    process.env.ALLOW_DEV_CAMPAIGN_SEND = "true";

    expect(campaignPublicOrigin()).toBe("");
    expect(campaignSendAllowed()).toBe(false);
  });

  it("keeps campaign attribution signed and out of public checkout data", () => {
    const messageId = "f0425db7-0a28-4d5d-8b80-78e32836a6c6";
    const cookie = campaignAttributionCookie(messageId, false);
    const request = {
      headers: { cookie },
    } as never;

    expect(campaignAttributionMessageId(request)).toBe(messageId);
    expect(campaignAttributionMessageId({
      headers: { cookie: cookie.replace(/\.[^;]+/, ".tampered") },
    } as never)).toBe("");
  });

  it("shows a human confirmation page before applying an unsubscribe", async () => {
    const tokenUrl = new URL(
      campaignUnsubscribeUrl("11111111-1111-4111-8111-111111111111"),
    );
    const server = createServer((request, response) => {
      void handleCampaignUnsubscribe(request, response);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Server did not start");
    const endpoint = `http://127.0.0.1:${address.port}${tokenUrl.pathname}${tokenUrl.search}`;

    try {
      const response = await fetch(endpoint);
      const body = await response.text();
      expect(response.status).toBe(200);
      expect(body).toContain("Before you go");
      expect(body).toContain("Confirm unsubscribe");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("does not mutate on a form POST until a reason is selected", async () => {
    const tokenUrl = new URL(
      campaignUnsubscribeUrl("11111111-1111-4111-8111-111111111111"),
    );
    const server = createServer((request, response) => {
      void handleCampaignUnsubscribe(request, response);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Server did not start");
    const endpoint = `http://127.0.0.1:${address.port}${tokenUrl.pathname}${tokenUrl.search}`;

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "reason_detail=I%20changed%20my%20mind",
      });
      const body = await response.text();
      expect(response.status).toBe(400);
      expect(body).toContain("Choose a reason to continue");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});

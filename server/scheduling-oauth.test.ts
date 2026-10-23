import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getSchedulingProviderStatus,
  schedulingCallbackUrl,
} from "./scheduling-oauth";

const KEYS = [
  "INTEGRATION_ENCRYPTION_KEY",
  "PUBLIC_APP_URL",
  "DATABASE_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "MICROSOFT_CLIENT_ID",
  "MICROSOFT_CLIENT_SECRET",
  "ZOOM_CLIENT_ID",
  "ZOOM_CLIENT_SECRET",
  "ZOOM_SCOPES",
  "CALENDLY_CLIENT_ID",
  "CALENDLY_CLIENT_SECRET",
  "GOOGLE_CALENDAR_SCOPES",
];

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
  for (const key of KEYS) delete process.env[key];
  process.env.INTEGRATION_ENCRYPTION_KEY = "a".repeat(48);
  process.env.DATABASE_URL = "postgresql://test/test";
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key] as string;
  }
});

describe("scheduling provider availability", () => {
  it("reports an OAuth provider as unavailable until its app is registered", () => {
    const status = getSchedulingProviderStatus();
    expect(status.google_calendar.configured).toBe(false);
    expect(status.zoom.configured).toBe(false);
    expect(status.outlook.configured).toBe(false);
  });

  it("turns a provider on once both halves of the credential are present", () => {
    process.env.GOOGLE_CLIENT_ID = "client-id";
    expect(getSchedulingProviderStatus().google_calendar.configured).toBe(false);
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";
    expect(getSchedulingProviderStatus().google_calendar.configured).toBe(true);
  });

  it("shares one Google app between Calendar and Meet", () => {
    process.env.GOOGLE_CLIENT_ID = "client-id";
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";
    const status = getSchedulingProviderStatus();
    expect(status.google_calendar.configured).toBe(true);
    expect(status.google_meet.configured).toBe(true);
    // Meet only needs to write events, so it must not inherit the read scope.
    expect(status.google_calendar.scopes).toContain(
      "https://www.googleapis.com/auth/calendar.readonly",
    );
    expect(status.google_meet.scopes).not.toContain(
      "https://www.googleapis.com/auth/calendar.readonly",
    );
  });

  it("shares one Microsoft app between Outlook and Teams", () => {
    process.env.MICROSOFT_CLIENT_ID = "client-id";
    process.env.MICROSOFT_CLIENT_SECRET = "client-secret";
    const status = getSchedulingProviderStatus();
    expect(status.outlook.configured).toBe(true);
    expect(status.teams.configured).toBe(true);
    // Without offline_access Microsoft returns no refresh token and the
    // connection would die an hour later.
    expect(status.outlook.scopes).toContain("offline_access");
    expect(status.teams.scopes).toContain("offline_access");
  });

  it("keeps Cal.com available without client credentials", () => {
    // It has no self-serve OAuth app, so the user's own API key is the credential.
    const status = getSchedulingProviderStatus();
    expect(status.cal_com.configured).toBe(true);
    expect(status.cal_com.authType).toBe("api_key");
  });

  it("stops offering anything when tokens could not be stored safely", () => {
    process.env.GOOGLE_CLIENT_ID = "client-id";
    process.env.GOOGLE_CLIENT_SECRET = "client-secret";
    delete process.env.INTEGRATION_ENCRYPTION_KEY;
    const status = getSchedulingProviderStatus();
    expect(status.google_calendar.configured).toBe(false);
    expect(status.cal_com.configured).toBe(false);
  });
});

describe("scope overrides", () => {
  it("uses the built-in scopes by default", () => {
    expect(getSchedulingProviderStatus().zoom.scopes).toEqual([
      "meeting:write:meeting",
      "user:read:user",
    ]);
  });

  it("lets an operator supply the scope names an older app expects", () => {
    process.env.ZOOM_SCOPES = "meeting:write user:read";
    expect(getSchedulingProviderStatus().zoom.scopes).toEqual([
      "meeting:write",
      "user:read",
    ]);
  });

  it("accepts a comma separated override", () => {
    process.env.GOOGLE_CALENDAR_SCOPES = "openid, email";
    expect(getSchedulingProviderStatus().google_calendar.scopes).toEqual([
      "openid",
      "email",
    ]);
  });

  it("ignores a blank override rather than requesting no scopes", () => {
    process.env.ZOOM_SCOPES = "   ";
    expect(getSchedulingProviderStatus().zoom.scopes).toEqual([
      "meeting:write:meeting",
      "user:read:user",
    ]);
  });
});

describe("callback url", () => {
  it("prefers the configured origin so it matches what was registered", () => {
    process.env.PUBLIC_APP_URL = "https://app.example.com";
    expect(schedulingCallbackUrl(null)).toBe(
      "https://app.example.com/api/appointments/integrations?action=callback",
    );
  });

  it("tolerates a trailing slash, which providers would reject as a mismatch", () => {
    process.env.PUBLIC_APP_URL = "https://app.example.com/";
    expect(schedulingCallbackUrl(null)).toBe(
      "https://app.example.com/api/appointments/integrations?action=callback",
    );
  });

  it("falls back to the request origin in development", () => {
    const request = {
      headers: { host: "localhost:8080" },
      socket: {},
    } as unknown as Parameters<typeof schedulingCallbackUrl>[0];
    expect(schedulingCallbackUrl(request)).toBe(
      "http://localhost:8080/api/appointments/integrations?action=callback",
    );
  });
});

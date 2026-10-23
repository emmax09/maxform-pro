import { describe, expect, it } from "vitest";

import type { EmailConnection } from "@/lib/email";
import {
  activeEmailProviderChoiceValue,
  buildEmailProviderChoices,
  parseEmailProviderChoiceValue,
} from "@/lib/email-provider-state";

const connection = (
  overrides: Partial<EmailConnection> = {},
): EmailConnection => ({
  id: "connection-1",
  provider: "resend",
  mode: "custom",
  credentialHint: "key_…1234",
  role: "none",
  isActive: false,
  status: "connected",
  healthOk: true,
  validationMode: "api",
  accessMode: "send",
  lastHealthCheckAt: null,
  lastVerifiedAt: null,
  lastError: "",
  createdAt: null,
  inboundEnabled: false,
  eventsEnabled: false,
  ...overrides,
});

describe("email provider selector state", () => {
  it("exposes connected managed Resend as a distinct selector choice", () => {
    const choices = buildEmailProviderChoices(
      connection({ id: "managed-resend", mode: "managed", isActive: true, role: "primary" }),
      [],
      { resend: "Resend" },
    );

    expect(choices).toEqual([expect.objectContaining({
      value: "managed:resend",
      label: "Resend — Managed by MaxForm",
      isActive: true,
    })]);
    expect(activeEmailProviderChoiceValue({ provider: "resend", mode: "managed" })).toBe("managed:resend");
  });

  it("does not offer managed Resend for activation before it is connected", () => {
    const choices = buildEmailProviderChoices(
      connection({ id: "managed-resend", mode: "managed", status: "disconnected", healthOk: false }),
      [],
      { resend: "Resend" },
    );

    expect(choices).toEqual([]);
  });

  it("keeps a connected managed provider inactive until it is explicitly selected", () => {
    const choices = buildEmailProviderChoices(
      connection({ id: "managed-resend", mode: "managed", isActive: false, role: "none" }),
      [],
      { resend: "Resend" },
    );

    expect(choices[0]).toEqual(expect.objectContaining({
      value: "managed:resend",
      healthy: true,
      isActive: false,
    }));
    expect(activeEmailProviderChoiceValue(null)).toBe("none");
  });

  it("does not collide managed and custom Resend values", () => {
    const choices = buildEmailProviderChoices(
      connection({ id: "managed-resend", mode: "managed" }),
      [connection({ id: "custom-resend", isActive: true, role: "primary" })],
      { resend: "Resend" },
    );

    expect(choices.map((choice) => choice.value)).toEqual(["managed:resend", "custom:resend"]);
    expect(choices[1].label).toBe("Resend — Custom account");
  });

  it("parses only supported provider and mode combinations", () => {
    expect(parseEmailProviderChoiceValue("managed:resend")).toEqual({ provider: "resend", mode: "managed" });
    expect(parseEmailProviderChoiceValue("custom:smtp")).toEqual({ provider: "smtp", mode: "custom" });
    expect(parseEmailProviderChoiceValue("managed:smtp")).toBeNull();
    expect(parseEmailProviderChoiceValue("custom:unknown")).toBeNull();
    expect(parseEmailProviderChoiceValue("none")).toBeNull();
  });

  it("omits disconnected custom accounts without hiding managed Resend", () => {
    const choices = buildEmailProviderChoices(
      connection({ id: "managed-resend", mode: "managed" }),
      [connection({ id: "custom-resend", status: "disconnected", healthOk: false })],
      { resend: "Resend" },
    );

    expect(choices.map((choice) => choice.value)).toEqual(["managed:resend"]);
  });
});

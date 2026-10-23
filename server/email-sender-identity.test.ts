import { describe, expect, it } from "vitest";

import {
  managedSenderEmail,
  managedSenderPrefixError,
  normalizeManagedSenderPrefix,
  resolveStoredCustomSenderEmail,
} from "./email-sender-identity";

describe("managed sender identity", () => {
  it("generates the requested workspace-name defaults", () => {
    expect(normalizeManagedSenderPrefix("Test Space")).toBe("testspace");
    expect(normalizeManagedSenderPrefix("ABC Events")).toBe("abcevents");
    expect(normalizeManagedSenderPrefix("John's Bakery")).toBe("johns-bakery");
  });

  it("validates editable prefixes and reserved system names", () => {
    expect(managedSenderPrefixError("hello")).toBe("");
    expect(managedSenderPrefixError("test-space")).toBe("");
    expect(managedSenderPrefixError("events2026")).toBe("");
    expect(managedSenderPrefixError("Hello")).toContain("lowercase");
    expect(managedSenderPrefixError("hello world")).toContain("spaces");
    expect(managedSenderPrefixError("support")).toContain("reserved");
    expect(managedSenderPrefixError("hello+team")).toContain("lowercase letters");
  });

  it("keeps the managed domain separate from the generated local part", () => {
    expect(managedSenderEmail("testspace", "send.maxform.com")).toBe("testspace@send.maxform.com");
    expect(managedSenderEmail("hello", "mail.example.com")).toBe("hello@mail.example.com");
  });

  it("does not carry a managed address into custom-provider identity fields", () => {
    expect(resolveStoredCustomSenderEmail(
      "",
      "testspace@send.example.com",
      ["testspace@send.example.com"],
    )).toBe("");
    expect(resolveStoredCustomSenderEmail(
      "hello@company.com",
      "testspace@send.example.com",
      ["testspace@send.example.com"],
    )).toBe("hello@company.com");
    expect(resolveStoredCustomSenderEmail(
      "",
      "legacy@company.com",
      ["testspace@send.example.com"],
    )).toBe("legacy@company.com");
  });
});

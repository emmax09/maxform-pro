/**
 * Sign-in and password-reset accept an email address *or* a username.
 *
 * A member provisioned by a workspace owner is given both, and the credentials
 * mail shows both, so whichever one they type has to work — at sign-in and at
 * "Forgot password?" alike. This pins the parsing that both paths share.
 */
import { describe, expect, it } from "vitest";

import { signInIdentifier } from "./auth";

describe("signInIdentifier", () => {
  it("accepts an email address and normalises its case", () => {
    expect(signInIdentifier("Ada@Example.com")).toBe("ada@example.com");
  });

  it("accepts a username in the shape the members screen issues", () => {
    for (const value of [
      "ada",
      "ada.lovelace",
      "ada_1",
      "ada-1",
      "ui.member.9e4cb6",
    ]) {
      expect(signInIdentifier(value)).toBe(value);
    }
  });

  it("normalises a typed username to lower case", () => {
    expect(signInIdentifier("Ada.Lovelace")).toBe("ada.lovelace");
  });

  it("trims incidental whitespace", () => {
    expect(signInIdentifier("  ada.lovelace  ")).toBe("ada.lovelace");
  });

  it("refuses an empty identifier", () => {
    expect(() => signInIdentifier("")).toThrow();
    expect(() => signInIdentifier("   ")).toThrow();
    expect(() => signInIdentifier(undefined)).toThrow();
  });

  it("refuses a malformed email rather than treating it as a username", () => {
    // Anything containing @ is judged as an address, so a typo cannot silently
    // fall through to a username lookup that would never match.
    expect(() => signInIdentifier("ada@")).toThrow();
    expect(() => signInIdentifier("ada@example")).toThrow();
    expect(() => signInIdentifier("@example.com")).toThrow();
  });

  it("refuses a username with characters the members screen never issues", () => {
    for (const value of ["ab", "ada lovelace", "ada!", "a".repeat(61)]) {
      expect(() => signInIdentifier(value)).toThrow();
    }
  });
});

import { describe, expect, it } from "vitest";

import {
  generateMemberPassword,
  MembersError,
  normalizeChosenUsername,
  validateChosenPassword,
} from "./workspace-members";

describe("generateMemberPassword", () => {
  it("is long enough to survive being emailed and typed once", () => {
    expect(generateMemberPassword()).toHaveLength(16);
  });

  it("always carries a lower, upper, digit and symbol", () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const password = generateMemberPassword();
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[0-9]/);
      expect(password).toMatch(/[!@#$%*?-]/);
    }
  });

  it("omits characters that are misread off a screen", () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      expect(generateMemberPassword()).not.toMatch(/[O0lI1]/);
    }
  });

  it("does not put the guaranteed classes in fixed positions", () => {
    // A naive implementation leaves the four seeded characters at the front,
    // which would make the first four positions perfectly predictable.
    const firstCharacterClasses = new Set(
      Array.from({ length: 200 }, () => {
        const first = generateMemberPassword()[0];
        if (/[a-z]/.test(first)) return "lower";
        if (/[A-Z]/.test(first)) return "upper";
        if (/[0-9]/.test(first)) return "digit";
        return "symbol";
      }),
    );
    expect(firstCharacterClasses.size).toBeGreaterThan(1);
  });

  it("does not repeat itself", () => {
    const seen = new Set(
      Array.from({ length: 500 }, () => generateMemberPassword()),
    );
    expect(seen.size).toBe(500);
  });
});

describe("normalizeChosenUsername", () => {
  it("treats blank as 'generate one for me'", () => {
    expect(normalizeChosenUsername("")).toBe("");
    expect(normalizeChosenUsername("   ")).toBe("");
    expect(normalizeChosenUsername(undefined)).toBe("");
  });

  it("lowercases what the owner typed", () => {
    expect(normalizeChosenUsername("Ada.Lovelace")).toBe("ada.lovelace");
  });

  it("accepts letters, digits, dots, dashes and underscores", () => {
    for (const value of ["ada", "ada.lovelace", "ada_1", "ada-1", "a1b2c3"]) {
      expect(normalizeChosenUsername(value)).toBe(value);
    }
  });

  it("refuses anything that could be mistaken for an email", () => {
    expect(() => normalizeChosenUsername("ada@example.com")).toThrow(
      MembersError,
    );
  });

  it("refuses handles that are too short, spaced, or oddly anchored", () => {
    for (const value of ["ab", "ada lovelace", ".ada", "ada!", "a".repeat(61)]) {
      expect(() => normalizeChosenUsername(value)).toThrow(MembersError);
    }
  });
});

describe("validateChosenPassword", () => {
  it("treats blank as 'generate one for me'", () => {
    expect(validateChosenPassword("")).toBe("");
    expect(validateChosenPassword(undefined)).toBe("");
  });

  it("accepts a password with at least three character classes", () => {
    expect(validateChosenPassword("Harbour-Lane-42")).toBe("Harbour-Lane-42");
    expect(validateChosenPassword("lowerUPPER1234")).toBe("lowerUPPER1234");
  });

  it("refuses one that is too short", () => {
    expect(() => validateChosenPassword("Sh0rt!")).toThrow(MembersError);
  });

  it("refuses one that is too narrow, however long", () => {
    expect(() => validateChosenPassword("allloweralphabet")).toThrow(
      MembersError,
    );
    expect(() => validateChosenPassword("alllowerandsomedigits123")).toThrow(
      MembersError,
    );
  });

  it("refuses one beyond the bcrypt-safe length", () => {
    expect(() => validateChosenPassword(`Aa1!${"x".repeat(140)}`)).toThrow(
      MembersError,
    );
  });
});

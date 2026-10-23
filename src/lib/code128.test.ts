import { describe, expect, it } from "vitest";

import {
  CODE128_PATTERNS,
  code128Bars,
  encodeCode128,
  sanitizeCode128,
} from "@/lib/code128";

const widths = (pattern: string) =>
  pattern.split("").map((character) => Number(character));

describe("code 128 pattern table", () => {
  it("has one pattern for every value plus the stop symbol", () => {
    expect(CODE128_PATTERNS).toHaveLength(107);
  });

  it("keeps every data symbol at six modules summing to 11", () => {
    CODE128_PATTERNS.slice(0, 106).forEach((pattern, value) => {
      const parts = widths(pattern);
      expect({ value, length: parts.length }).toEqual({ value, length: 6 });
      expect({
        value,
        sum: parts.reduce((total, part) => total + part, 0),
      }).toEqual({ value, sum: 11 });
    });
  });

  it("keeps the stop symbol at seven modules summing to 13", () => {
    const parts = widths(CODE128_PATTERNS[106]);
    expect(parts).toHaveLength(7);
    expect(parts.reduce((total, part) => total + part, 0)).toBe(13);
  });

  it("keeps bar modules even in every symbol", () => {
    // The even-parity rule: bars in a valid Code 128 symbol total an even
    // number of modules, so an odd total means the pattern was mistyped.
    CODE128_PATTERNS.forEach((pattern, value) => {
      const barModules = widths(pattern)
        .filter((_, index) => index % 2 === 0)
        .reduce((total, part) => total + part, 0);
      expect({ value, even: barModules % 2 === 0 }).toEqual({
        value,
        even: true,
      });
    });
  });

  it("has no duplicate patterns", () => {
    expect(new Set(CODE128_PATTERNS).size).toBe(CODE128_PATTERNS.length);
  });
});

describe("code 128 encoding", () => {
  it("frames the payload with a start symbol, checksum, and stop symbol", () => {
    const modules = encodeCode128("A");
    // start (6) + one character (6) + checksum (6) + stop (7)
    expect(modules).toHaveLength(25);
    expect(modules.slice(0, 6)).toEqual(widths(CODE128_PATTERNS[104]));
    expect(modules.slice(-7)).toEqual(widths(CODE128_PATTERNS[106]));
  });

  it("computes the modulo 103 checksum from the weighted values", () => {
    // Start B (104) + 'A' (33) at weight 1 => 137 % 103 = 34.
    const modules = encodeCode128("A");
    expect(modules.slice(12, 18)).toEqual(widths(CODE128_PATTERNS[34]));
  });

  it("drops characters subset B cannot represent", () => {
    expect(sanitizeCode128("MF26-VIP—A12\n")).toBe("MF26-VIPA12");
    expect(encodeCode128("")).toEqual([]);
    expect(code128Bars("").bars).toEqual([]);
  });

  it("reports bars that stay inside the reported total width", () => {
    const { bars, total } = code128Bars("MF26-VIP-A12-03");
    expect(bars.length).toBeGreaterThan(10);
    bars.forEach((bar) => {
      expect(bar.x + bar.width).toBeLessThanOrEqual(total);
    });
  });
});

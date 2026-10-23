import { describe, expect, it } from "vitest";

import { timestampedCsvFilename } from "@/lib/csv";

describe("timestampedCsvFilename", () => {
  it("includes the list name, local date, and local time", () => {
    const date = new Date(2026, 6, 29, 16, 5, 9);

    expect(timestampedCsvFilename("Newsletter Mailing List", date)).toBe(
      "Newsletter-Mailing-List_2026-07-29_16-05-09.csv",
    );
  });

  it("removes characters that are unsafe in downloaded filenames", () => {
    const date = new Date(2026, 0, 2, 3, 4, 5);

    expect(timestampedCsvFilename('Sales: "West/EMEA"', date)).toBe(
      "Sales-West-EMEA_2026-01-02_03-04-05.csv",
    );
  });
});

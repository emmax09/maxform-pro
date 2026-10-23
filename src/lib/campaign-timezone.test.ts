import { describe, expect, it } from "vitest";

import {
  formatWorkspaceDateTime,
  toWorkspaceDateTimeValue,
  workspaceDateTimeToUtc,
} from "./campaign-timezone";

describe("campaign workspace timezone conversion", () => {
  it("interprets the schedule input in the workspace timezone", () => {
    const instant = workspaceDateTimeToUtc(
      "2026-08-03T09:30",
      "Africa/Lagos",
    );

    expect(instant?.toISOString()).toBe("2026-08-03T08:30:00.000Z");
    expect(toWorkspaceDateTimeValue(instant!, "Africa/Lagos")).toBe(
      "2026-08-03T09:30",
    );
  });

  it("handles daylight-saving time when converting a zoned value", () => {
    const instant = workspaceDateTimeToUtc(
      "2026-07-03T09:30",
      "America/New_York",
    );

    expect(instant?.toISOString()).toBe("2026-07-03T13:30:00.000Z");
  });

  it("rejects a nonexistent wall-clock time during a DST jump", () => {
    expect(
      workspaceDateTimeToUtc("2026-03-08T02:30", "America/New_York"),
    ).toBeNull();
  });

  it("formats stored instants in the workspace zone", () => {
    expect(
      formatWorkspaceDateTime("2026-08-03T08:30:00.000Z", "Africa/Lagos"),
    ).toMatch(/9:30/);
  });
});

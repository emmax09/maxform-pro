import { describe, expect, it } from "vitest";

import {
  DEFAULT_WORKSPACE_ACCENT,
  LEGACY_FORM_ACCENTS,
  inferAccentColorMode,
  resolveAccentColor,
  workspaceAccentColor,
} from "./workspace-branding";
import { normalizeFormTheme } from "./forms";

describe("workspace accent inheritance", () => {
  it("normalizes the workspace fallback", () => {
    expect(workspaceAccentColor("#e11d48")).toBe("#E11D48");
    expect(workspaceAccentColor("")).toBe(DEFAULT_WORKSPACE_ACCENT);
  });

  it("uses the workspace accent for legacy defaults", () => {
    expect(
      resolveAccentColor(
        "#2563EB",
        "#E11D48",
        undefined,
        LEGACY_FORM_ACCENTS,
      ),
    ).toBe("#E11D48");
  });

  it("preserves explicit custom colours, including legacy palette colours", () => {
    expect(
      resolveAccentColor(
        "#2563EB",
        "#E11D48",
        "custom",
        LEGACY_FORM_ACCENTS,
      ),
    ).toBe("#2563EB");
    expect(inferAccentColorMode("#04060B", "#E11D48", LEGACY_FORM_ACCENTS)).toBe(
      "custom",
    );
    expect(normalizeFormTheme({ accentColor: "#2563EB" }, "#E11D48")).toMatchObject({
      accentColor: "#E11D48",
      accentColorMode: "workspace",
    });
    expect(
      normalizeFormTheme(
        { accentColor: "#2563EB", accentColorMode: "custom" },
        "#E11D48",
      ),
    ).toMatchObject({
      accentColor: "#2563EB",
      accentColorMode: "custom",
    });
  });
});

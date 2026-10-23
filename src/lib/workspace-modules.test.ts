import { describe, expect, it } from "vitest";

import {
  ALWAYS_GRANTED_MODULES,
  ASSIGNABLE_MODULE_KEYS,
  describeModuleAccess,
  isWorkspaceModuleKey,
  moduleAccessAllows,
  normalizeModuleAccess,
  WORKSPACE_STANDARD_MODULE_KEYS,
  WORKSPACE_TOOL_MODULE_KEYS,
  WORKSPACE_MODULE_KEYS,
  WORKSPACE_MODULE_LABELS,
} from "./workspace-modules";

describe("normalizeModuleAccess", () => {
  it("always grants home and settings, whatever was ticked", () => {
    expect(normalizeModuleAccess(["forms"])).toEqual([
      "home",
      "forms",
      "settings",
    ]);
    expect(normalizeModuleAccess([])).toEqual(ALWAYS_GRANTED_MODULES);
  });

  it("drops keys that are not modules", () => {
    expect(normalizeModuleAccess(["forms", "billing", "", null, 7])).toEqual([
      "home",
      "forms",
      "settings",
    ]);
  });

  it("removes duplicates and returns rail order", () => {
    expect(normalizeModuleAccess(["payments", "crm", "crm", "analytics"])).toEqual(
      ["home", "analytics", "crm", "payments", "settings"],
    );
  });

  it("treats a non-array grant as no grant rather than throwing", () => {
    expect(normalizeModuleAccess(undefined)).toEqual(ALWAYS_GRANTED_MODULES);
    expect(normalizeModuleAccess("forms")).toEqual(ALWAYS_GRANTED_MODULES);
  });
});

describe("moduleAccessAllows", () => {
  it("lets an unrestricted account open anything", () => {
    for (const key of WORKSPACE_MODULE_KEYS) {
      expect(moduleAccessAllows(null, key)).toBe(true);
      expect(moduleAccessAllows(undefined, key)).toBe(true);
    }
  });

  it("restricts a member to their granted modules", () => {
    const granted = normalizeModuleAccess(["forms", "events"]);
    expect(moduleAccessAllows(granted, "forms")).toBe(true);
    expect(moduleAccessAllows(granted, "events")).toBe(true);
    expect(moduleAccessAllows(granted, "payments")).toBe(false);
    expect(moduleAccessAllows(granted, "crm")).toBe(false);
  });

  it("keeps home and settings reachable even for an empty grant", () => {
    expect(moduleAccessAllows([], "home")).toBe(true);
    expect(moduleAccessAllows([], "settings")).toBe(true);
    expect(moduleAccessAllows([], "forms")).toBe(false);
  });

  it("keeps workspace tools behind explicit member exceptions", () => {
    const granted = normalizeModuleAccess(["stores"]);
    expect(moduleAccessAllows(granted, "stores")).toBe(true);
    expect(moduleAccessAllows(granted, "store_connector")).toBe(false);
    expect(moduleAccessAllows(normalizeModuleAccess(["store_connector"]), "store_connector")).toBe(true);
  });
});

describe("describeModuleAccess", () => {
  it("names the unrestricted case", () => {
    expect(describeModuleAccess(null)).toBe("Every module");
    expect(
      describeModuleAccess(normalizeModuleAccess([...ASSIGNABLE_MODULE_KEYS])),
    ).toBe("Every module");
  });

  it("counts a partial grant", () => {
    expect(describeModuleAccess(normalizeModuleAccess(["forms", "crm"]))).toBe(
      `2 of ${ASSIGNABLE_MODULE_KEYS.length} modules`,
    );
  });

  it("says so when nothing but the basics is granted", () => {
    expect(describeModuleAccess(normalizeModuleAccess([]))).toBe(
      "Home and personal settings only",
    );
  });
});

describe("module catalogue", () => {
  it("labels every key, so the picker can never render a blank row", () => {
    for (const key of WORKSPACE_MODULE_KEYS) {
      expect(WORKSPACE_MODULE_LABELS[key]).toBeTruthy();
    }
  });

  it("recognises only real module keys", () => {
    expect(isWorkspaceModuleKey("forms")).toBe(true);
    expect(isWorkspaceModuleKey("Forms")).toBe(false);
    expect(isWorkspaceModuleKey("billing")).toBe(false);
  });

  it("keeps the Workspace tools group inside the shared catalogue", () => {
    expect(WORKSPACE_TOOL_MODULE_KEYS).toEqual([
      "ai",
      "emails",
      "integrations",
      "store_connector",
    ]);
    expect(WORKSPACE_STANDARD_MODULE_KEYS).not.toContain("ai");
    for (const key of WORKSPACE_TOOL_MODULE_KEYS) {
      expect(WORKSPACE_MODULE_KEYS).toContain(key);
    }
  });
});

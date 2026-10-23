import {
  DEFAULT_BRAND_COLOR,
  normalizeBrandColor,
} from "./brand-color";

/** The database fallback when a workspace has not chosen a colour yet. */
export const DEFAULT_WORKSPACE_ACCENT = DEFAULT_BRAND_COLOR;

export type AccentColorMode = "workspace" | "custom";

/** Colours used by older form/event defaults before workspace inheritance. */
export const LEGACY_FORM_ACCENTS = [
  "#236BFE",
  "#2563EB",
  DEFAULT_BRAND_COLOR,
] as const;

export const LEGACY_EVENT_ACCENTS = [
  ...LEGACY_FORM_ACCENTS,
  "#DC2626",
  "#A16207",
  "#059669",
  "#0891B2",
] as const;

export const workspaceAccentColor = (value: unknown) => {
  const raw = typeof value === "string" ? value.trim() : "";
  return normalizeBrandColor(raw || DEFAULT_WORKSPACE_ACCENT);
};

const normalizedLegacySet = (values: readonly string[]) =>
  new Set(values.map((value) => normalizeBrandColor(value)));

export const isLegacyAccent = (
  value: unknown,
  values: readonly string[],
) => {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return true;
  return normalizedLegacySet(values).has(normalizeBrandColor(raw));
};

export const inferAccentColorMode = (
  value: unknown,
  workspaceAccent: unknown,
  legacyValues: readonly string[],
): AccentColorMode => {
  if (isLegacyAccent(value, legacyValues)) return "workspace";
  const normalized = normalizeBrandColor(value);
  return normalized === workspaceAccentColor(workspaceAccent)
    ? "workspace"
    : "custom";
};

/** Resolve an inherited accent without touching explicit custom themes. */
export const resolveAccentColor = (
  value: unknown,
  workspaceAccent: unknown,
  mode: unknown,
  legacyValues: readonly string[],
) => {
  const workspace = workspaceAccentColor(workspaceAccent);
  const raw = typeof value === "string" ? value.trim() : "";
  const normalized = normalizeBrandColor(raw || workspace);
  if (mode === "custom") return normalized;
  if (mode === "workspace" || isLegacyAccent(raw, legacyValues)) {
    return workspace;
  }
  // A non-legacy theme created before the mode field existed is an explicit
  // user choice and must remain untouched.
  return normalized;
};

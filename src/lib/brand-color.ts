export const DEFAULT_BRAND_COLOR = "#65758B";

export const BRAND_COLOR_PRESETS = [
  "#65758B",
  "#2563EB",
  "#4F46E5",
  "#059669",
  "#0D9488",
  "#E11D48",
  "#D97706",
  "#7C3AED",
] as const;

const legacyColors: Record<string, string> = {
  blue: "#2563EB",
  emerald: "#059669",
  rose: "#E11D48",
  slate: DEFAULT_BRAND_COLOR,
};

export function normalizeBrandColor(value: unknown) {
  if (typeof value !== "string") return DEFAULT_BRAND_COLOR;

  const legacyColor = legacyColors[value.toLowerCase()];
  if (legacyColor) return legacyColor;

  const trimmed = value.trim();
  const expanded =
    /^#[0-9a-f]{3}$/i.test(trimmed)
      ? `#${trimmed
          .slice(1)
          .split("")
          .map((character) => `${character}${character}`)
          .join("")}`
      : trimmed;

  return /^#[0-9a-f]{6}$/i.test(expanded)
    ? expanded.toUpperCase()
    : DEFAULT_BRAND_COLOR;
}

export function brandColorToHsl(value: unknown, dark: boolean) {
  const hex = normalizeBrandColor(value).slice(1);
  const red = Number.parseInt(hex.slice(0, 2), 16) / 255;
  const green = Number.parseInt(hex.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;

  let hue = 0;
  if (delta !== 0) {
    if (max === red) hue = ((green - blue) / delta) % 6;
    else if (max === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
  }
  hue = Math.round(hue * 60);
  if (hue < 0) hue += 360;

  const sourceLightness = (max + min) / 2;
  const sourceSaturation =
    delta === 0
      ? 0
      : delta / (1 - Math.abs(2 * sourceLightness - 1));
  const saturation = Math.round(
    Math.min(82, Math.max(sourceSaturation * 100, dark ? 18 : 0)),
  );
  const lightness = Math.round(
    dark
      ? Math.min(68, Math.max(sourceLightness * 100 + 10, 58))
      : Math.min(52, Math.max(sourceLightness * 100, 40)),
  );

  return `${hue} ${saturation}% ${lightness}%`;
}

/**
 * The exact colour the workspace picked, as published by UserPreferencesSync.
 *
 * Use this where the brand has to be reproduced faithfully — a solid fill, an
 * email accent. For interactive text and borders prefer `--primary`, which is
 * the same colour adjusted so it stays legible on either theme.
 */
export function readBrandColor(fallback = DEFAULT_BRAND_COLOR) {
  if (typeof window === "undefined" || !document.documentElement) return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--brand")
    .trim();
  return value ? normalizeBrandColor(value) : normalizeBrandColor(fallback);
}

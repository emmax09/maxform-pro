import type { CSSProperties } from "react";

type Rgb = {
  b: number;
  g: number;
  r: number;
};

const clamp = (value: number, min = 0, max = 255) =>
  Math.min(max, Math.max(min, value));

const parseHexColor = (color: string | undefined): Rgb | null => {
  const normalized = color?.trim().replace(/^#/, "");
  if (!normalized) return null;
  const hex =
    normalized.length === 3
      ? normalized
          .split("")
          .map((part) => `${part}${part}`)
          .join("")
      : normalized;
  if (!/^[\da-f]{6}$/i.test(hex)) return null;
  const value = Number.parseInt(hex, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
};

export const colorToHslChannels = (
  color: string | undefined,
  fallback = "#FFFFFF",
) => {
  const rgb = parseHexColor(color) || parseHexColor(fallback);
  if (!rgb) return "0 0% 100%";
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  const delta = max - min;

  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1));
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    if (max === g) h = 60 * ((b - r) / delta + 2);
    if (max === b) h = 60 * ((r - g) / delta + 4);
  }

  return `${Math.round(h < 0 ? h + 360 : h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
};

export const readableColorOn = (
  background: string | undefined,
  light = "#FFFFFF",
  dark = "#17181A",
) => {
  const rgb = parseHexColor(background);
  if (!rgb) return light;
  const channels = [rgb.r, rgb.g, rgb.b].map((channel) => {
    const value = clamp(channel) / 255;
    return value <= 0.03928
      ? value / 12.92
      : Math.pow((value + 0.055) / 1.055, 2.4);
  });
  const luminance =
    0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  return luminance > 0.55 ? dark : light;
};

export const publicThemeVariables = ({
  accent,
  background,
  border,
  foreground,
  muted,
  radius,
  surface,
}: {
  accent: string;
  background: string;
  border: string;
  foreground: string;
  muted: string;
  radius?: string;
  surface?: string;
}) => {
  const surfaceColor = surface || background;
  const accentForeground = readableColorOn(accent);
  const subtleSurface = surface || "#F4F4F5";
  return {
    "--accent": colorToHslChannels(subtleSurface, "#F4F4F5"),
    "--accent-foreground": colorToHslChannels(foreground, "#17181A"),
    "--background": colorToHslChannels(background, "#FFFFFF"),
    "--border": colorToHslChannels(border, "#E0E2E7"),
    "--card": colorToHslChannels(surfaceColor, background),
    "--card-foreground": colorToHslChannels(foreground, "#17181A"),
    "--foreground": colorToHslChannels(foreground, "#17181A"),
    "--input": colorToHslChannels(border, "#E0E2E7"),
    "--muted": colorToHslChannels(subtleSurface, "#F4F4F5"),
    "--muted-foreground": colorToHslChannels(muted, "#666A73"),
    "--popover": colorToHslChannels(surfaceColor, background),
    "--popover-foreground": colorToHslChannels(foreground, "#17181A"),
    "--primary": colorToHslChannels(accent, "#2563EB"),
    "--primary-foreground": colorToHslChannels(accentForeground, "#FFFFFF"),
    "--ring": colorToHslChannels(accent, "#2563EB"),
    ...(radius ? { "--radius": radius } : {}),
  } as CSSProperties;
};

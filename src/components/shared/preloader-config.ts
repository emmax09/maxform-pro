export type PreloaderIcon =
  | "spinner"
  | "circle"
  | "orbit"
  | "refresh"
  | "dots";

export type PreloaderSettings = {
  enabled: boolean;
  durationSeconds: number;
  imageUrl: string;
  title: string;
  description: string;
  icon: PreloaderIcon;
  iconColor: string;
  iconSize: number;
  titleColor: string;
  titleFontSize: number;
  descriptionColor: string;
  descriptionFontSize: number;
  backgroundColor: string;
  cardBackgroundColor: string;
  cardBorderColor: string;
  borderWidth: number;
  borderRadius: number;
  padding: number;
  imageSize: number;
};

export const defaultPreloaderSettings = (): PreloaderSettings => ({
  enabled: false,
  durationSeconds: 0,
  imageUrl: "",
  title: "Getting things ready",
  description: "Please wait a moment.",
  icon: "spinner",
  iconColor: "#2563EB",
  iconSize: 34,
  titleColor: "#101828",
  titleFontSize: 20,
  descriptionColor: "#667085",
  descriptionFontSize: 14,
  backgroundColor: "#F8FAFC",
  cardBackgroundColor: "#FFFFFF",
  cardBorderColor: "#E4E7EC",
  borderWidth: 1,
  borderRadius: 16,
  padding: 32,
  imageSize: 72,
});

const finiteNumber = (value: unknown, fallback: number, min: number, max: number) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

export const normalizePreloaderSettings = (value: unknown): PreloaderSettings => {
  const defaults = defaultPreloaderSettings();
  const source =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Partial<PreloaderSettings>)
      : {};
  const icon: PreloaderIcon = ["spinner", "circle", "orbit", "refresh", "dots"].includes(
    source.icon || "",
  )
    ? (source.icon as PreloaderIcon)
    : defaults.icon;

  return {
    ...defaults,
    ...source,
    enabled: source.enabled === true,
    durationSeconds: finiteNumber(source.durationSeconds, defaults.durationSeconds, 0, 30),
    icon,
    iconSize: finiteNumber(source.iconSize, defaults.iconSize, 16, 112),
    titleFontSize: finiteNumber(source.titleFontSize, defaults.titleFontSize, 12, 42),
    descriptionFontSize: finiteNumber(
      source.descriptionFontSize,
      defaults.descriptionFontSize,
      10,
      28,
    ),
    borderWidth: finiteNumber(source.borderWidth, defaults.borderWidth, 0, 12),
    borderRadius: finiteNumber(source.borderRadius, defaults.borderRadius, 0, 48),
    padding: finiteNumber(source.padding, defaults.padding, 16, 72),
    imageSize: finiteNumber(source.imageSize, defaults.imageSize, 24, 180),
  };
};

export type SpacingSide = "Top" | "Right" | "Bottom" | "Left";

/** Falls back when a stored value is not a color an <input type="color"> accepts. */
export const colorInputValue = (
  value: string | undefined,
  fallback: string,
) => (/^#[0-9a-f]{6}$/i.test(value || "") ? value || fallback : fallback);

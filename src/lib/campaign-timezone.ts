const pad = (value: number) => String(value).padStart(2, "0");

type DateTimeParts = {
  day: number;
  hour: number;
  minute: number;
  month: number;
  second: number;
  year: number;
};

const partsFor = (date: Date, timeZone: string): DateTimeParts => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  ) as Record<string, number>;
  return {
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    month: values.month,
    second: values.second,
    year: values.year,
  };
};

const validateTimezone = (timeZone: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
    return true;
  } catch {
    return false;
  }
};

/** Converts an instant into the value expected by an HTML datetime-local input. */
export const toWorkspaceDateTimeValue = (
  date: Date,
  timeZone = "UTC",
) => {
  if (Number.isNaN(date.getTime()) || !validateTimezone(timeZone)) return "";
  const parts = partsFor(date, timeZone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
};

/**
 * Converts a timezone-less datetime-local value into an absolute instant.
 * The value is interpreted as a wall-clock time in the supplied IANA zone,
 * not in the browser's timezone.
 */
export const workspaceDateTimeToUtc = (
  value: string,
  timeZone = "UTC",
): Date | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    value,
  );
  if (!match || !validateTimezone(timeZone)) return null;

  const [, year, month, day, hour, minute, second = "0"] = match;
  const localAsUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  if (!Number.isFinite(localAsUtc)) return null;

  // Solve UTC = wall-clock time - zone offset. Four passes handle DST
  // transitions while keeping the calculation dependency-free in the browser.
  let guess = localAsUtc;
  for (let index = 0; index < 4; index += 1) {
    const parts = partsFor(new Date(guess), timeZone);
    const zoneClockAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    guess = localAsUtc - (zoneClockAsUtc - guess);
  }

  const result = new Date(guess);
  return toWorkspaceDateTimeValue(result, timeZone) === value.slice(0, 16)
    ? result
    : null;
};

export const formatWorkspaceDateTime = (
  value: string | Date | null | undefined,
  timeZone = "UTC",
) => {
  if (!value || !validateTimezone(timeZone)) return "Not scheduled";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(date);
};

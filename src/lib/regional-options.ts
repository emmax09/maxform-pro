import {
  getAllCountries,
  getAllTimezones,
  getCountry,
  getTimezone,
} from "countries-and-timezones";
import countries from "world-countries";

export type CurrencyOption = {
  code: string;
  countries: string[];
  name: string;
  symbol: string;
};

export type CountryCurrencyOption = {
  countryCode: string;
  countryName: string;
  currencyCode: string;
  currencyName: string;
  flag: string;
  keywords: string;
  symbol: string;
  value: string;
};

export type TimezoneOption = {
  countries: string[];
  label: string;
  offset: string;
  value: string;
};

export type RegionalDefaults = {
  countryCode: string | null;
  currency: string;
  timezone: string;
};

const currencyDisplayNames =
  typeof Intl !== "undefined" && "DisplayNames" in Intl
    ? new Intl.DisplayNames(["en"], { type: "currency" })
    : null;

const countryRecords = countries.filter(
  (country) => country.status === "officially-assigned",
);

const countryByCode = new Map(
  countryRecords.flatMap((country) => [
    [country.cca2.toLowerCase(), country],
    [country.cca3.toLowerCase(), country],
  ]),
);

const countryByName = new Map(
  countryRecords.flatMap((country) =>
    [
      country.name.common,
      country.name.official,
      ...country.altSpellings,
    ].map((name) => [name.toLowerCase(), country] as const),
  ),
);

const currencyMap = new Map<string, CurrencyOption>();

countryRecords.forEach((country) => {
  Object.entries(country.currencies).forEach(([code, currency]) => {
    const existing = currencyMap.get(code);
    const countryName = country.name.common;
    if (existing) {
      if (!existing.countries.includes(countryName)) {
        existing.countries.push(countryName);
      }
      return;
    }
    currencyMap.set(code, {
      code,
      countries: [countryName],
      name: currencyDisplayNames?.of(code) || currency.name || code,
      symbol: currency.symbol || code,
    });
  });
});

export const currencyOptions = Array.from(currencyMap.values()).sort(
  (a, b) => a.code.localeCompare(b.code),
);

export const countryCurrencyOptions: CountryCurrencyOption[] = countryRecords
  .flatMap((country) =>
    Object.entries(country.currencies).map(([currencyCode, currency]) => ({
      countryCode: country.cca2,
      countryName: country.name.common,
      currencyCode,
      currencyName:
        currencyDisplayNames?.of(currencyCode) || currency.name || currencyCode,
      flag: country.flag || "",
      keywords: [
        country.name.common,
        country.name.official,
        ...country.altSpellings,
        currencyCode,
        currency.name,
        currency.symbol,
      ]
        .filter(Boolean)
        .join(" "),
      symbol: currency.symbol || currencyCode,
      value: `${country.cca2}:${currencyCode}`,
    })),
  )
  .sort(
    (a, b) =>
      a.countryName.localeCompare(b.countryName) ||
      a.currencyCode.localeCompare(b.currencyCode),
  );

const countryCurrencyValues = new Set(
  countryCurrencyOptions.map(
    (option) => `${option.countryCode}:${option.currencyCode}`,
  ),
);

const timezoneCountries = getAllCountries();

export const timezoneOptions: TimezoneOption[] = Object.values(
  getAllTimezones(),
)
  .filter((timezone) => !timezone.deprecated && !timezone.aliasOf)
  .map((timezone) => {
    const names = timezone.countries
      .map((countryCode) => timezoneCountries[countryCode]?.name)
      .filter(Boolean);
    return {
      countries: names,
      label: timezone.name.replace(/_/g, " "),
      offset: `GMT${timezone.utcOffsetStr}`,
      value: timezone.name,
    };
  })
  .sort((a, b) => a.value.localeCompare(b.value));

if (!timezoneOptions.some((option) => option.value === "UTC")) {
  timezoneOptions.unshift({
    countries: [],
    label: "UTC",
    offset: "GMT+00:00",
    value: "UTC",
  });
}

const timezoneValues = new Set(timezoneOptions.map((option) => option.value));

const preferredCountryTimezones: Record<string, string> = {
  AU: "Australia/Sydney",
  BR: "America/Sao_Paulo",
  CA: "America/Toronto",
  CD: "Africa/Kinshasa",
  CL: "America/Santiago",
  EC: "America/Guayaquil",
  ES: "Europe/Madrid",
  ID: "Asia/Jakarta",
  KI: "Pacific/Tarawa",
  KZ: "Asia/Almaty",
  MX: "America/Mexico_City",
  NZ: "Pacific/Auckland",
  PF: "Pacific/Tahiti",
  PG: "Pacific/Port_Moresby",
  PT: "Europe/Lisbon",
  RU: "Europe/Moscow",
  UA: "Europe/Kyiv",
  US: "America/New_York",
};

export function countryCodeForRegionalValue(value?: string | null) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  return (
    countryByCode.get(normalized)?.cca2 ||
    countryByName.get(normalized)?.cca2 ||
    null
  );
}

export function regionalDefaultsForCountry(
  countryValue?: string | null,
): RegionalDefaults {
  const countryCode = countryCodeForRegionalValue(countryValue);
  const country = countryCode
    ? countryByCode.get(countryCode.toLowerCase())
    : null;
  const currency = country
    ? Object.keys(country.currencies)[0] || "USD"
    : "USD";
  const browserTimezone =
    typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : "";
  const browserTimezoneCountryCodes = browserTimezone
    ? getTimezone(browserTimezone)?.countries || []
    : [];
  const countryTimezones = countryCode
    ? getCountry(countryCode)?.timezones || []
    : [];
  const timezone =
    (countryCode &&
    browserTimezoneCountryCodes.map(String).includes(countryCode)
      ? browserTimezone
      : "") ||
    (countryCode ? preferredCountryTimezones[countryCode] : "") ||
    countryTimezones[0] ||
    browserTimezone ||
    "UTC";

  return { countryCode, currency, timezone };
}

export function currencyOption(code: string) {
  return currencyMap.get(code.toUpperCase()) || null;
}

export function countryCurrencyOption(
  countryCode: string | null | undefined,
  currencyCode: string,
) {
  const normalizedCountry = String(countryCode || "").trim().toUpperCase();
  const normalizedCurrency = currencyCode.trim().toUpperCase();
  if (!normalizedCountry || !normalizedCurrency) return null;
  return (
    countryCurrencyOptions.find(
      (option) =>
        option.countryCode === normalizedCountry &&
        option.currencyCode === normalizedCurrency,
    ) || null
  );
}

export function isSupportedCountryCurrency(
  countryCode: string | null | undefined,
  currencyCode: string,
) {
  if (!countryCode) return Boolean(currencyOption(currencyCode));
  return countryCurrencyValues.has(
    `${countryCode.trim().toUpperCase()}:${currencyCode.trim().toUpperCase()}`,
  );
}

export function isSupportedTimezone(value: string) {
  return timezoneValues.has(value);
}

export function formatCurrency(
  amount: number,
  currency: string,
  options: Intl.NumberFormatOptions = {},
) {
  const displayOptions: Intl.NumberFormatOptions = {
    ...options,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  };
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      ...displayOptions,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString(undefined, displayOptions)}`;
  }
}

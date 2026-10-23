import { describe, expect, it } from "vitest";

import {
  countryCurrencyOption,
  countryCurrencyOptions,
  currencyOption,
  currencyOptions,
  formatCurrency,
  isSupportedTimezone,
  regionalDefaultsForCountry,
  timezoneOptions,
} from "./regional-options";

describe("workspace regional defaults", () => {
  it("derives currency and timezone from a country name", () => {
    expect(regionalDefaultsForCountry("Nigeria")).toMatchObject({
      countryCode: "NG",
      currency: "NGN",
      timezone: "Africa/Lagos",
    });
    expect(regionalDefaultsForCountry("United Kingdom")).toMatchObject({
      countryCode: "GB",
      currency: "GBP",
      timezone: "Europe/London",
    });
  });

  it("provides comprehensive searchable regional options", () => {
    expect(currencyOptions.length).toBeGreaterThan(140);
    expect(currencyOption("USD")?.name).toMatch(/dollar/i);
    expect(currencyOption("EUR")?.code).toBe("EUR");
    expect(currencyOption("NGN")?.code).toBe("NGN");
    expect(countryCurrencyOptions.length).toBeGreaterThan(240);
    expect(countryCurrencyOption("NG", "NGN")?.countryName).toBe("Nigeria");
    expect(countryCurrencyOption("US", "USD")?.value).toBe("US:USD");
    expect(countryCurrencyOption("EC", "USD")?.value).toBe("EC:USD");
    expect(
      countryCurrencyOptions.filter(
        (option) => option.currencyCode === "USD",
      ).length,
    ).toBeGreaterThan(10);
    expect(timezoneOptions.length).toBeGreaterThan(300);
    expect(isSupportedTimezone("Africa/Lagos")).toBe(true);
    expect(isSupportedTimezone("Pacific/Auckland")).toBe(true);
    expect(isSupportedTimezone("Not/A_Timezone")).toBe(false);
  });

  it("always renders monetary amounts with exactly two decimal places", () => {
    expect(formatCurrency(25, "USD", { currencyDisplay: "code" })).toMatch(
      /USD\s*25\.00/,
    );
    expect(formatCurrency(25.5, "JPY", { currencyDisplay: "code" })).toMatch(
      /JPY\s*25\.50/,
    );
    expect(
      formatCurrency(1200, "USD", {
        currencyDisplay: "code",
        maximumFractionDigits: 0,
      }),
    ).toMatch(/USD\s*1,200\.00/);
  });
});

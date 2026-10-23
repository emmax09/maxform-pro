// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  calculateShipping,
  shippingCountryAllowed,
} from "./payment-checkout";

const metrics = (overrides: Partial<{
  subtotal: number;
  quantity: number;
  weightGrams: number;
}> = {}) => ({
  subtotal: 50,
  quantity: 2,
  weightGrams: 1_500,
  ...overrides,
});

describe("shipping rate engine", () => {
  it("keeps legacy flat rates and free-shipping thresholds working", () => {
    const payment = {
      shippingMode: "flat",
      shippingAmount: 12,
      freeShippingThreshold: 100,
      shippingHandlingFee: 0,
    };

    expect(
      calculateShipping(payment, { country: "NG" }, metrics()).amount,
    ).toBe(12);
    expect(
      calculateShipping(payment, { country: "NG" }, metrics({ subtotal: 100 })).amount,
    ).toBe(0);
  });

  it("calculates weight rates with package weight and handling", () => {
    const result = calculateShipping(
      {
        shippingMode: "weight",
        shippingAmount: 0,
        shippingPerWeightUnitAmount: 8,
        shippingWeightUnit: "kg",
        shippingPackageWeightGrams: 500,
        shippingHandlingFee: 2,
      },
      { country: "US" },
      metrics({ weightGrams: 1_500 }),
    );

    expect(result.amount).toBe(18);
    expect(result.label).toBe("Weight-based shipping");
  });

  it("uses the most specific matching worldwide rule and supports postal wildcards", () => {
    const result = calculateShipping(
      {
        shippingMode: "advanced",
        shippingAmount: 40,
        shippingRules: [
          {
            name: "United States",
            countries: ["US"],
            country: "US",
            region: "",
            amount: 18,
            freeShippingThreshold: 0,
          },
          {
            name: "New York express",
            countries: ["US"],
            country: "US",
            region: "NY",
            postalCode: "100*",
            amount: 25,
            freeShippingThreshold: 0,
            deliveryEstimate: "1–2 business days",
          },
        ],
      },
      { country: "US", region: "NY", postalCode: "10001" },
      metrics(),
    );

    expect(result).toMatchObject({
      amount: 25,
      deliveryEstimate: "1–2 business days",
      label: "New York express",
    });
  });

  it("supports country allowlists and blocklists", () => {
    expect(
      shippingCountryAllowed(
        { shippingCountryPolicy: "allowlist", shippingCountries: ["NG", "GB"] },
        { country: "NG" },
      ),
    ).toBe(true);
    expect(
      shippingCountryAllowed(
        { shippingCountryPolicy: "allowlist", shippingCountries: ["NG", "GB"] },
        { country: "US" },
      ),
    ).toBe(false);
    expect(
      shippingCountryAllowed(
        { shippingCountryPolicy: "blocklist", shippingCountries: ["US"] },
        { country: "US" },
      ),
    ).toBe(false);
  });
});

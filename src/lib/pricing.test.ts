import { describe, expect, it } from "vitest";

import {
  AI_CREDIT_PACKS,
  EMAIL_PACKS,
  PAID_PLANS,
  PLANS,
  STORAGE_PACKS,
  effectiveMonthlyPrice,
  formatAllowance,
  formatBytes,
  formatPlanPrice,
  formatPrice,
  planById,
  yearlyPrice,
  remainingAllowance,
  usagePercent,
} from "@/lib/pricing";

describe("plan catalogue", () => {
  it("prices the paid tiers in ascending order", () => {
    const prices = PAID_PLANS.map((plan) => plan.monthlyPrice ?? 0);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    expect(prices).toEqual([5.99, 12.99, 24.99]);
  });

  it("raises every metered allowance as the tier goes up", () => {
    const metered = ["storageBytes", "aiCredits", "emails"] as const;
    for (const key of metered) {
      const values = PAID_PLANS.map((plan) => plan.limits[key] ?? Infinity);
      expect({ key, values }).toEqual({
        key,
        values: [...values].sort((a, b) => a - b),
      });
    }
  });

  it("never caps responses, contacts, or documents on any plan", () => {
    for (const plan of PLANS) {
      // The only form-related limit is how many forms exist, never how many
      // responses they may collect.
      expect(Object.keys(plan.limits)).toEqual([
        "storageBytes",
        "aiCredits",
        "emails",
        "forms",
        "users",
      ]);
    }
  });

  it("caps form count only on Starter", () => {
    expect(planById("starter").limits.forms).toBe(5);
    expect(planById("pro").limits.forms).toBeNull();
    expect(planById("business").limits.forms).toBeNull();
    expect(planById("trial").limits.forms).toBeNull();
  });

  it("leaves every enterprise allowance unlimited", () => {
    const enterprise = planById("enterprise");
    expect(Object.values(enterprise.limits)).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it("falls back to the trial for an unknown plan id", () => {
    expect(planById("nope").id).toBe("trial");
    expect(planById("").id).toBe("trial");
  });

  it("marks exactly one plan as featured", () => {
    expect(PLANS.filter((plan) => plan.featured)).toHaveLength(1);
  });
});

describe("billing cycle", () => {
  it("bills ten months when paying yearly", () => {
    expect(yearlyPrice(planById("starter"))).toBe(59.9);
    expect(yearlyPrice(planById("pro"))).toBe(129.9);
    expect(yearlyPrice(planById("business"))).toBe(249.9);
  });

  it("keeps the free and custom tiers unchanged", () => {
    expect(yearlyPrice(planById("trial"))).toBe(0);
    expect(yearlyPrice(planById("enterprise"))).toBeNull();
    expect(effectiveMonthlyPrice(planById("enterprise"), "yearly")).toBeNull();
  });

  it("shows a lower effective monthly rate on the yearly cycle", () => {
    for (const plan of PAID_PLANS) {
      const monthly = effectiveMonthlyPrice(plan, "monthly") ?? 0;
      const yearly = effectiveMonthlyPrice(plan, "yearly") ?? 0;
      expect(yearly).toBeLessThan(monthly);
      // Ten months spread over twelve.
      expect(yearly).toBeCloseTo((monthly * 10) / 12, 2);
    }
  });

  it("never leaves a floating point tail in a price", () => {
    for (const plan of PAID_PLANS) {
      for (const cycle of ["monthly", "yearly"] as const) {
        const value = effectiveMonthlyPrice(plan, cycle) ?? 0;
        expect(Number(value.toFixed(2))).toBe(value);
      }
      expect(formatPrice(yearlyPrice(plan))).toMatch(/^\$\d+\.\d{2}$/);
    }
  });
});

describe("add-on packs", () => {
  it("gets cheaper per unit as the pack gets bigger", () => {
    for (const packs of [AI_CREDIT_PACKS, STORAGE_PACKS, EMAIL_PACKS]) {
      const perUnit = packs.map((pack) => pack.price / pack.units);
      expect(perUnit).toEqual([...perUnit].sort((a, b) => b - a));
    }
  });

  it("bills storage monthly and credits as one-off packs", () => {
    expect(STORAGE_PACKS.every((pack) => pack.recurring)).toBe(true);
    expect(AI_CREDIT_PACKS.every((pack) => pack.recurring)).toBe(false);
    expect(EMAIL_PACKS.every((pack) => pack.recurring)).toBe(false);
  });
});

describe("formatting", () => {
  it("formats prices, including the custom tier", () => {
    expect(formatPlanPrice(planById("starter"))).toBe("$5.99");
    expect(formatPlanPrice(planById("trial"))).toBe("$0.00");
    expect(formatPlanPrice(planById("enterprise"))).toBe("Custom");
  });

  it("formats byte allowances at a readable scale", () => {
    expect(formatBytes(10 * 1024 ** 3)).toBe("10 GB");
    expect(formatBytes(2 * 1024 ** 3)).toBe("2 GB");
    expect(formatBytes(512 * 1024 * 1024)).toBe("512 MB");
    expect(formatBytes(0)).toBe("0 GB");
    expect(formatBytes(Number.NaN)).toBe("0 GB");
  });

  it("reads an unlimited allowance as unlimited", () => {
    expect(formatAllowance(null, "bytes")).toBe("Unlimited");
    expect(formatAllowance(null, "count")).toBe("Unlimited");
    expect(formatAllowance(25000, "count")).toBe("25,000");
  });
});

describe("usage maths", () => {
  it("caps a meter at 100 percent", () => {
    expect(usagePercent(500, 1000)).toBe(50);
    expect(usagePercent(4000, 1000)).toBe(100);
    expect(usagePercent(-5, 1000)).toBe(0);
  });

  it("treats an unlimited allowance as an empty meter", () => {
    expect(usagePercent(9999, null)).toBe(0);
    expect(remainingAllowance(9999, null)).toBeNull();
  });

  it("never reports negative remaining allowance", () => {
    expect(remainingAllowance(1200, 1000)).toBe(0);
    expect(remainingAllowance(200, 1000)).toBe(800);
  });
});

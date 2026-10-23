import type { RoutingRule } from "@/lib/appointments";

/**
 * Routing form logic.
 *
 * A routing form is a form whose submit action is "show this booking page"
 * rather than "save a response", so this is the whole engine: match answers
 * against rules in order, first match wins, otherwise fall back.
 *
 * It lives in its own module so the client can preview a route while the form
 * is being edited without a round trip, and so the rules are testable on their
 * own. The server evaluates the same way for a real submission — that is the
 * authoritative path, since a visitor must not be able to route themselves.
 */
const normalise = (value: unknown) => String(value ?? "").trim().toLowerCase();

export const matchRoutingRule = (
  rule: Pick<RoutingRule, "field" | "operator" | "value">,
  answers: Record<string, unknown>,
) => {
  const actual = normalise(answers[rule.field]);
  const expected = normalise(rule.value);
  if (rule.operator === "contains") {
    // An empty answer contains nothing, rather than matching everything.
    return Boolean(actual) && actual.includes(expected);
  }
  if (rule.operator === "not_equals") return actual !== expected;
  return actual === expected;
};

export type ResolvedRoute = { bookingPageId: string | null; matchedRuleId: string };

export const resolveRoute = (
  rules: RoutingRule[],
  answers: Record<string, unknown>,
  fallbackBookingPageId: string | null,
): ResolvedRoute => {
  for (const rule of rules) {
    if (rule.bookingPageId && matchRoutingRule(rule, answers)) {
      return { bookingPageId: rule.bookingPageId, matchedRuleId: rule.id };
    }
  }
  return { bookingPageId: fallbackBookingPageId, matchedRuleId: "" };
};

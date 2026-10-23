import type { FormField } from "../components/forms/form-types";

const formulaToken = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]/g, "");

function evaluateMathExpression(expression: string) {
  const compact = expression.replace(/\s+/g, "");
  const tokens = compact.match(/\d+(?:\.\d+)?|[()+\-*/%]/g) || [];
  if (!compact || tokens.join("") !== compact) return null;
  let cursor = 0;

  const parseFactor = (): number | null => {
    const token = tokens[cursor];
    if (token === "+" || token === "-") {
      cursor += 1;
      const value = parseFactor();
      return value == null ? null : token === "-" ? -value : value;
    }
    if (token === "(") {
      cursor += 1;
      const value = parseExpression();
      if (tokens[cursor] !== ")") return null;
      cursor += 1;
      return value;
    }
    if (!token || !/^\d+(?:\.\d+)?$/.test(token)) return null;
    cursor += 1;
    return Number(token);
  };

  const parseTerm = (): number | null => {
    let value = parseFactor();
    if (value == null) return null;
    while (["*", "/", "%"].includes(tokens[cursor])) {
      const operator = tokens[cursor];
      cursor += 1;
      const right = parseFactor();
      if (
        right == null ||
        ((operator === "/" || operator === "%") && right === 0)
      ) {
        return null;
      }
      if (operator === "*") value *= right;
      if (operator === "/") value /= right;
      if (operator === "%") value %= right;
    }
    return value;
  };

  const parseExpression = (): number | null => {
    let value = parseTerm();
    if (value == null) return null;
    while (tokens[cursor] === "+" || tokens[cursor] === "-") {
      const operator = tokens[cursor];
      cursor += 1;
      const right = parseTerm();
      if (right == null) return null;
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  };

  const result = parseExpression();
  if (result == null || cursor !== tokens.length || !Number.isFinite(result)) {
    return null;
  }
  return Number(result.toFixed(6));
}

export function resolveCalculatedAnswer(
  field: FormField,
  fields: FormField[],
  answers: Record<string, unknown>,
) {
  if (!field.formula?.trim()) return "";
  const expression = field.formula.replace(
    /\{([^}]+)\}/g,
    (_, reference: string) => {
      const normalized = formulaToken(reference);
      const source = fields.find(
        (candidate) =>
          candidate.id === reference ||
          formulaToken(candidate.id) === normalized ||
          formulaToken(candidate.label) === normalized,
      );
      const answer = source ? answers[source.id] : undefined;
      const numeric = typeof answer === "number" ? answer : Number(answer);
      return Number.isFinite(numeric) ? String(numeric) : "0";
    },
  );
  return evaluateMathExpression(expression) ?? "";
}

import { Fragment, type ReactNode } from "react";

import { cn } from "@/lib/utils";
import { VARIABLE_PATTERN, variableLabel } from "@/lib/template-variables";

/**
 * Renders `value` with each variable as a token. The token carries the raw
 * path in `title` so the underlying syntax stays discoverable on hover.
 */
export function VariableText({
  value,
  className,
  tokenClassName,
}: {
  value: string;
  className?: string;
  tokenClassName?: string;
}) {
  const source = String(value || "");
  const parts: ReactNode[] = [];
  let cursor = 0;
  let index = 0;

  VARIABLE_PATTERN.lastIndex = 0;
  for (let match = VARIABLE_PATTERN.exec(source); match; match = VARIABLE_PATTERN.exec(source)) {
    if (match.index > cursor) parts.push(source.slice(cursor, match.index));
    parts.push(
      <span
        key={`v${index}`}
        title={match[0]}
        className={cn(
          "mx-px inline-flex items-center rounded-[4px] bg-primary/10 px-1 py-px align-baseline text-[0.92em] font-medium text-primary ring-1 ring-inset ring-primary/15",
          tokenClassName,
        )}
      >
        {variableLabel(match[1])}
      </span>,
    );
    cursor = match.index + match[0].length;
    index += 1;
  }
  if (cursor < source.length) parts.push(source.slice(cursor));

  return (
    <span className={className}>
      {parts.map((part, position) => (
        <Fragment key={position}>{part}</Fragment>
      ))}
    </span>
  );
}

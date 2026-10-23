import type { ReactNode } from "react";

/** The title block every appointments tab opens with. */
export function SectionHeading({
  action,
  description,
  title,
}: {
  action?: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h2 className="text-[18px] font-semibold">{title}</h2>
        <p className="mt-1 max-w-2xl text-[12px] text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

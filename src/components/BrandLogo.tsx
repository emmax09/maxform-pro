import { cn } from "@/lib/utils";
import { StackedLogo } from "./StackedLogo";

interface BrandLogoProps {
  className?: string;
  markSize?: number;
  showWordmark?: boolean;
  wordmarkClassName?: string;
}

export function BrandLogo({
  className,
  markSize = 16,
  showWordmark = true,
  wordmarkClassName,
}: BrandLogoProps) {
  return (
    <span
      className={cn("inline-flex items-center gap-2", className)}
      data-brand-logo
    >
      <span
        className="inline-flex shrink-0 text-primary dark:text-white"
        data-brand-mark
      >
        <StackedLogo size={markSize} color="currentColor" />
      </span>
      {showWordmark && (
        <span
          className={cn(
            "font-bold uppercase tracking-[0.08em] text-foreground",
            wordmarkClassName,
          )}
        >
          MaxForm
        </span>
      )}
    </span>
  );
}

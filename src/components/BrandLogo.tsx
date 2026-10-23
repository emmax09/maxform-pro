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
      className={cn("inline-flex items-center gap-2.5", className)}
      data-brand-logo
    >
      <span
        className="inline-flex shrink-0 items-center justify-center rounded-[9px] bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.22)]"
        data-brand-mark
        style={{ width: markSize * 1.55, height: markSize * 1.55 }}
      >
        <StackedLogo size={markSize * 0.94} color="currentColor" />
      </span>
      {showWordmark && (
        <span
          className={cn(
            "font-semibold tracking-[-0.035em] text-foreground",
            wordmarkClassName,
          )}
        >
          MaxForm
        </span>
      )}
    </span>
  );
}

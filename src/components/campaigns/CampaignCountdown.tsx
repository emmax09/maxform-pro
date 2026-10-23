import { useEffect, useRef, useState } from "react";
import { Timer } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatCampaignCountdown } from "./campaign-countdown";

const secondsUntil = (scheduledAt: string) => {
  const target = new Date(scheduledAt).getTime();
  if (!Number.isFinite(target)) return null;
  return Math.max(0, Math.ceil((target - Date.now()) / 1_000));
};

export function CampaignCountdown({
  className,
  onDue,
  scheduledAt,
}: {
  className?: string;
  onDue?: () => void;
  scheduledAt: string;
}) {
  const [remaining, setRemaining] = useState(() => secondsUntil(scheduledAt));
  const onDueRef = useRef(onDue);
  onDueRef.current = onDue;

  useEffect(() => {
    let dueNotified = false;
    const update = () => {
      const next = secondsUntil(scheduledAt);
      setRemaining(next);
      if (next === 0 && !dueNotified) {
        dueNotified = true;
        onDueRef.current?.();
      }
    };
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [scheduledAt]);

  if (remaining === null) return null;

  const due = remaining === 0;
  return (
    <div
      role="timer"
      aria-label={due ? "Campaign is due now" : "Campaign send countdown"}
      className={cn(
        "mt-2 inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5",
        due
          ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
          : "border-primary/20 bg-primary/5 text-primary",
        className,
      )}
    >
      <Timer className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block font-mono text-[12px] font-semibold tabular-nums tracking-[.04em]">
          {formatCampaignCountdown(remaining)}
        </span>
        <span className="block text-[8px] font-medium uppercase tracking-[.08em] opacity-75">
          {due ? "Due now" : "Starts in"}
        </span>
      </span>
    </div>
  );
}

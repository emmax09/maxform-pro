/**
 * Live batch progress for a campaign that is currently sending.
 *
 * A campaign goes out in paced waves, which means "sending" is a state that
 * lasts minutes or hours. Showing the real counts — how many are delivered, how
 * many waves are left, when the next one goes — is the difference between a
 * tool that is working and a spinner that might be stuck.
 */
import { Loader2, PauseCircle, PlayCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CampaignSendProgress } from "@/lib/contacts";
import { cn } from "@/lib/utils";

const relativeTime = (value: string | null) => {
  if (!value) return "";
  const target = new Date(value).getTime();
  if (!Number.isFinite(target)) return "";
  const seconds = Math.round((target - Date.now()) / 1_000);
  if (seconds <= 0) return "any moment";
  if (seconds < 60) return `in ${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `in ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.round(minutes / 60);
  return `in ${hours} ${hours === 1 ? "hour" : "hours"}`;
};

/** Compact live progress used inside campaign list cards. */
export function CampaignProgressMeter({
  total,
  sent,
  failed,
  status,
  compact = false,
}: {
  total: number;
  sent: number;
  failed: number;
  status: string;
  compact?: boolean;
}) {
  const safeTotal = Math.max(0, total);
  const safeSent = Math.max(0, sent);
  const safeFailed = Math.max(0, failed);
  const completed = Math.min(safeTotal, safeSent + safeFailed);
  const percent = safeTotal
    ? Math.min(100, Math.round((completed / safeTotal) * 100))
    : 0;
  const remaining = Math.max(0, safeTotal - completed);
  const sending = status === "sending";
  const paused = status === "paused";

  return (
    <div
      className={cn(
        "rounded-lg bg-muted/35",
        compact ? "px-2.5 py-2" : "px-3 py-2.5",
      )}
      data-testid="campaign-progress-meter"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {sending ? (
            <Loader2
              className="h-3 w-3 shrink-0 animate-spin text-primary"
              aria-hidden="true"
            />
          ) : (
            <PauseCircle
              className={cn(
                "h-3 w-3 shrink-0",
                paused ? "text-amber-600" : "text-muted-foreground",
              )}
              aria-hidden="true"
            />
          )}
          <span className="truncate text-[9.5px] font-medium text-muted-foreground">
            {sending ? "Sending" : paused ? "Paused" : "Send progress"}
          </span>
        </div>
        <span className="shrink-0 text-[10px] font-semibold tabular-nums text-foreground">
          {completed.toLocaleString()} / {safeTotal.toLocaleString()}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${percent}% sent`}
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-background/80"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500",
            paused ? "bg-amber-500" : "bg-primary",
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 text-[8.5px] text-muted-foreground">
        <span className="tabular-nums">
          {safeSent.toLocaleString()} sent
          {safeFailed ? ` · ${safeFailed.toLocaleString()} failed` : ""}
        </span>
        <span className="tabular-nums">
          {remaining ? `${remaining.toLocaleString()} remaining` : "Complete"}
        </span>
      </div>
    </div>
  );
}

export function CampaignSendProgressCard({
  campaignName,
  progress,
  loading,
  working,
  onPause,
  onResume,
}: {
  campaignName: string;
  progress?: CampaignSendProgress;
  loading: boolean;
  working: boolean;
  onPause: () => void;
  onResume: () => void;
}) {
  if (loading && !progress) {
    return (
      <section className="flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <p className="text-[11.5px] text-muted-foreground">
          Loading send progress…
        </p>
      </section>
    );
  }
  if (!progress) return null;

  const total = progress.totalRecipients || 0;
  const sending = progress.status === "sending";
  const paused = progress.status === "paused";

  return (
    <section
      aria-label={`Send progress for ${campaignName}`}
      className="space-y-3 rounded-xl border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-[13px] font-semibold">{campaignName}</p>
            <Badge
              variant="outline"
              className={cn(
                "text-[9px] capitalize",
                sending && "border-primary/40 text-primary",
                paused && "border-amber-500/40 text-amber-600",
              )}
            >
              {progress.status}
            </Badge>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground tabular-nums">
              {Math.min(total, progress.sent + progress.failed).toLocaleString()}
            </span>{" "}
            of{" "}
            <span className="tabular-nums">{total.toLocaleString()}</span>{" "}
            recipients resolved
            {progress.failed > 0 ? (
              <>
                {" · "}
                <span className="text-destructive tabular-nums">
                  {progress.failed.toLocaleString()} failed
                </span>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex gap-2">
          {sending ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onPause}
              disabled={working}
            >
              <PauseCircle className="h-3.5 w-3.5" />
              Pause
            </Button>
          ) : null}
          {paused ? (
            <Button
              type="button"
              size="sm"
              onClick={onResume}
              disabled={working}
            >
              <PlayCircle className="h-3.5 w-3.5" />
              Resume
            </Button>
          ) : null}
        </div>
      </div>

      <CampaignProgressMeter
        total={total}
        sent={progress.sent}
        failed={progress.failed}
        status={progress.status}
      />

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10.5px] text-muted-foreground">
        <span>
          Wave {Math.min(progress.batchesSent + (sending ? 1 : 0), progress.batchesTotal) || 0}{" "}
          of {progress.batchesTotal}
        </span>
        <span>
          {progress.batchSize.toLocaleString()} per wave, {progress.batchDelaySeconds}s
          apart
        </span>
        {progress.nextBatchAt && progress.status !== "sent" ? (
          <span>Next wave {relativeTime(progress.nextBatchAt)}</span>
        ) : null}
        {progress.status === "sent" ? (
          <span>Finished</span>
        ) : (
          <span>Full send takes {progress.estimatedDurationSummary}</span>
        )}
      </div>

      {/* Resuming never re-sends: each recipient carries a stable key, so a
          wave that already went out cannot go out twice. */}
      {paused ? (
        <p className="text-[10.5px] leading-4 text-muted-foreground">
          Paused after {progress.sent.toLocaleString()} sent. Resuming continues
          from the next wave — nobody receives this twice.
        </p>
      ) : null}
    </section>
  );
}

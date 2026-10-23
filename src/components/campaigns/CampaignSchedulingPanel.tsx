/**
 * Scheduling tab: when the campaign goes out, whether it repeats, and whether
 * it splits into an A/B test first. Anything scheduled or in progress can be
 * paused right up until it has actually gone out.
 */
import {
  CalendarClock,
  Globe,
  Loader2,
  PauseCircle,
  Repeat,
  Send,
  Split,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { CampaignVariant, ContactCampaign } from "@/lib/contacts";
import { cn } from "@/lib/utils";

import {
  formatCampaignDate,
  isEditable,
  toLocalDateTimeValue,
  sendStrategyLabels,
} from "./campaign-format";

export type SchedulingState = {
  strategy: "immediate" | "scheduled" | "timezone_optimized" | "recurring";
  scheduledAt: string;
  recurrence: "weekly" | "monthly";
  requiresReview: boolean;
  abEnabled: boolean;
  abSubject: string;
  abPercentage: number;
  abMetric: "open" | "click";
  abHours: number;
};

const strategyOptions = [
  {
    value: "immediate" as const,
    icon: Send,
    label: "Send now",
    detail: "Queue every recipient immediately.",
  },
  {
    value: "scheduled" as const,
    icon: CalendarClock,
    label: "Schedule",
    detail: "One instant, the same for everyone.",
  },
  {
    value: "timezone_optimized" as const,
    icon: Globe,
    label: "Recipient timezone",
    detail: "Same local hour for each contact.",
  },
  {
    value: "recurring" as const,
    icon: Repeat,
    label: "Recurring",
    detail: "Repeats on a schedule you set.",
  },
];

export function CampaignSchedulingPanel({
  campaign,
  deliverable,
  hasDraft,
  onPause,
  onSaveAbTest,
  onSchedule,
  onSendNow,
  onStateChange,
  state,
  subject,
  variants,
  workspaceTimezone,
  working,
}: {
  /** Null while the open draft has not been saved yet. */
  campaign: ContactCampaign | null;
  deliverable: number;
  hasDraft: boolean;
  onPause: () => void;
  onSaveAbTest: () => void;
  onSchedule: () => void;
  onSendNow: () => void;
  onStateChange: (patch: Partial<SchedulingState>) => void;
  state: SchedulingState;
  subject: string;
  variants: CampaignVariant[];
  workspaceTimezone?: string;
  working: boolean;
}) {
  // An unsaved draft can still be scheduled: the send actions save it first.
  if (!campaign && !hasDraft) {
    return (
      <p className="rounded-xl border border-dashed border-border py-14 text-center text-[11px] text-muted-foreground">
        Open a campaign from All campaigns, or create one, to schedule it.
      </p>
    );
  }

  const scheduledTime = state.scheduledAt
    ? new Date(state.scheduledAt).getTime()
    : 0;
  const scheduleValid =
    Number.isFinite(scheduledTime) && scheduledTime > Date.now();
  const locked = campaign ? !isEditable(campaign) : false;
  const testGroup = Math.round((deliverable * state.abPercentage) / 100);

  return (
    <div className="space-y-5">
      {locked && campaign ? (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-500/30 bg-blue-500/6 px-4 py-3">
          <div>
            <p className="text-[12px] font-semibold capitalize">
              This campaign is {campaign.status}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {sendStrategyLabels[campaign.sendStrategy] ||
                campaign.sendStrategy}{" "}
              · {formatCampaignDate(
                campaign.scheduledAt || campaign.sentAt,
                workspaceTimezone,
              )}
            </p>
          </div>
          {campaign.status === "scheduled" || campaign.status === "sending" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={working}
              onClick={onPause}
            >
              {working ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <PauseCircle className="h-3.5 w-3.5" />
              )}
              Pause this send
            </Button>
          ) : null}
        </section>
      ) : null}

      <section className="space-y-4 rounded-xl border border-border bg-card p-5">
        <div>
          <h3 className="text-[14px] font-semibold">Send timing</h3>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {deliverable.toLocaleString()} contact
            {deliverable === 1 ? "" : "s"} will receive this, based on the
            Audience tab.
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {strategyOptions.map((option) => {
            const Icon = option.icon;
            const active = state.strategy === option.value;
            return (
              <button
                key={option.value}
                type="button"
                disabled={locked}
                onClick={() => onStateChange({ strategy: option.value })}
                className={cn(
                  "rounded-lg border p-3 text-left transition-colors disabled:opacity-60",
                  active
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/40",
                )}
              >
                <span className="flex items-center gap-2 text-[12px] font-medium">
                  <Icon
                    className={cn(
                      "h-3.5 w-3.5",
                      active ? "text-primary" : "text-muted-foreground",
                    )}
                  />
                  {option.label}
                </span>
                <span className="mt-1 block text-[10px] leading-4 text-muted-foreground">
                  {option.detail}
                </span>
              </button>
            );
          })}
        </div>

        {state.strategy !== "immediate" ? (
          <div className="space-y-1.5">
            <Label htmlFor="campaign-schedule-at">
              {state.strategy === "timezone_optimized"
                ? "Local send time for each recipient"
                : "Send date and time"}
            </Label>
            <Input
              id="campaign-schedule-at"
              type="datetime-local"
              disabled={locked}
              min={toLocalDateTimeValue(
                new Date(Date.now() + 60_000),
                workspaceTimezone,
              )}
              value={state.scheduledAt}
              onChange={(event) =>
                onStateChange({ scheduledAt: event.target.value })
              }
            />
            {state.scheduledAt && !scheduleValid ? (
              <p className="text-[10px] text-destructive" role="alert">
                Choose a future date and time.
              </p>
            ) : null}
            {state.strategy === "timezone_optimized" ? (
              <p className="text-[10px] leading-4 text-muted-foreground">
                Delivery is staggered so each contact gets it at this hour in
                their own timezone. A contact with no timezone on file receives it
                at this hour in your timezone rather than being skipped.
              </p>
            ) : null}
          </div>
        ) : null}

        {state.strategy === "recurring" ? (
          <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-4">
            <div className="space-y-1.5">
              <Label>Repeats</Label>
              <Select
                value={state.recurrence}
                disabled={locked}
                onValueChange={(value) =>
                  onStateChange({ recurrence: value as "weekly" | "monthly" })
                }
              >
                <SelectTrigger aria-label="Recurrence interval">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="weekly">Every week</SelectItem>
                  <SelectItem value="monthly">Every month</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-start gap-3">
              <Switch
                checked={state.requiresReview}
                disabled={locked}
                onCheckedChange={(checked) =>
                  onStateChange({ requiresReview: checked })
                }
                aria-label="Require a content review each cycle"
              />
              <span>
                <span className="block text-[12px] font-medium">
                  Require a content review each cycle
                </span>
                <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">
                  Recommended. Without it, a campaign that says "20% off, ends
                  Friday" will keep resending that same copy for months.
                </span>
              </span>
            </label>
          </div>
        ) : null}

        {!locked ? (
          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            {state.strategy === "immediate" ? (
              <Button
                type="button"
                disabled={working || !deliverable}
                onClick={onSendNow}
              >
                {working ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Send to {deliverable.toLocaleString()} contact
                {deliverable === 1 ? "" : "s"}
              </Button>
            ) : (
              <Button
                type="button"
                disabled={working || !scheduleValid || !deliverable}
                onClick={onSchedule}
              >
                {working ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CalendarClock className="h-4 w-4" />
                )}
                Schedule this campaign
              </Button>
            )}
            {!deliverable ? (
              <p className="self-center text-[10px] text-muted-foreground">
                No contact in this audience can currently receive email.
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="space-y-4 rounded-xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Split className="h-4 w-4 text-primary" />
              <h3 className="text-[14px] font-semibold">A/B test</h3>
            </div>
            <p className="mt-1 max-w-2xl text-[11px] leading-5 text-muted-foreground">
              Send two subject lines to a slice of the audience, then send the
              better performer to everyone else once the test window closes.
            </p>
          </div>
          <Switch
            checked={state.abEnabled}
            disabled={locked}
            onCheckedChange={(checked) => onStateChange({ abEnabled: checked })}
            aria-label="Enable A/B testing"
          />
        </div>

        {state.abEnabled ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Variant A subject (current)</Label>
                <Input value={subject} readOnly disabled />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="campaign-ab-subject">Variant B subject</Label>
                <Input
                  id="campaign-ab-subject"
                  disabled={locked}
                  value={state.abSubject}
                  onChange={(event) =>
                    onStateChange({ abSubject: event.target.value })
                  }
                  placeholder="An alternative angle on the same message"
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="campaign-ab-percentage">
                  Test group · {state.abPercentage}%
                </Label>
                <input
                  id="campaign-ab-percentage"
                  type="range"
                  min={5}
                  max={50}
                  step={5}
                  disabled={locked}
                  value={state.abPercentage}
                  onChange={(event) =>
                    onStateChange({ abPercentage: Number(event.target.value) })
                  }
                  className="w-full accent-primary"
                />
                <p className="text-[10px] text-muted-foreground">
                  About {testGroup.toLocaleString()} contacts, split evenly.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Winner decided by</Label>
                <Select
                  value={state.abMetric}
                  disabled={locked}
                  onValueChange={(value) =>
                    onStateChange({ abMetric: value as "open" | "click" })
                  }
                >
                  <SelectTrigger aria-label="A/B decision metric">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Open rate</SelectItem>
                    <SelectItem value="click">Click rate</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="campaign-ab-hours">Test window (hours)</Label>
                <Input
                  id="campaign-ab-hours"
                  type="number"
                  min={1}
                  max={168}
                  disabled={locked}
                  value={state.abHours}
                  onChange={(event) =>
                    onStateChange({ abHours: Number(event.target.value) || 4 })
                  }
                />
              </div>
            </div>

            <p className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 text-[10px] leading-4 text-muted-foreground">
              Plan: test on {state.abPercentage}% for {state.abHours} hour
              {state.abHours === 1 ? "" : "s"}, then send the higher{" "}
              {state.abMetric} rate variant to the remaining{" "}
              {100 - state.abPercentage}%.
            </p>

            {!locked ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={working || !state.abSubject.trim()}
                onClick={onSaveAbTest}
              >
                {working ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Split className="h-3.5 w-3.5" />
                )}
                Save A/B configuration
              </Button>
            ) : null}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Off. The whole audience receives the same subject line.
          </p>
        )}

        {variants.length ? (
          <div className="dashboard-scroll overflow-x-auto border-t border-border pt-4">
            <table className="w-full min-w-[520px] text-left">
              <thead className="text-[10px] uppercase tracking-[.08em] text-muted-foreground">
                <tr>
                  <th className="pb-2 font-medium">Variant</th>
                  <th className="pb-2 font-medium">Subject</th>
                  <th className="pb-2 text-right font-medium">Sent</th>
                  <th className="pb-2 text-right font-medium">Opened</th>
                  <th className="pb-2 text-right font-medium">Clicked</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {variants.map((variant) => (
                  <tr key={variant.id} className="text-[11px]">
                    <td className="py-2.5 font-medium">
                      {variant.label}
                      {variant.winner ? (
                        <Badge
                          variant="outline"
                          className="ml-2 text-[8px] uppercase"
                        >
                          Winner
                        </Badge>
                      ) : null}
                    </td>
                    <td className="max-w-[240px] truncate py-2.5 text-muted-foreground">
                      {variant.subject}
                    </td>
                    <td className="py-2.5 text-right font-mono">
                      {variant.sentCount.toLocaleString()}
                    </td>
                    <td className="py-2.5 text-right font-mono">
                      {variant.openedCount.toLocaleString()}
                    </td>
                    <td className="py-2.5 text-right font-mono">
                      {variant.clickedCount.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}

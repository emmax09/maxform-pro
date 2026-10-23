import type { ContactCampaign, ContactCampaignStatus } from "@/lib/contacts";
import {
  formatWorkspaceDateTime,
  toWorkspaceDateTimeValue,
} from "@/lib/campaign-timezone";

const browserTimeZone = () =>
  typeof Intl !== "undefined"
    ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
    : "UTC";

export const formatCampaignDate = (
  value: string | null,
  timeZone?: string,
) => formatWorkspaceDateTime(value, timeZone || browserTimeZone());

export const formatDayLabel = (value: string) => {
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        day: "numeric",
        month: "short",
      }).format(date);
};

export const formatHourLabel = (hour: number) => {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  return new Intl.DateTimeFormat(undefined, { hour: "numeric" }).format(date);
};

export const formatMoney = (amount: number, currency: string) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 2,
  }).format(amount);

export const toLocalDateTimeValue = (date: Date, timeZone?: string) =>
  toWorkspaceDateTimeValue(date, timeZone || browserTimeZone());

/** Percentage of a base, returned as a number so callers can format it. */
export const rate = (part: number, base: number) =>
  base > 0 ? (part / base) * 100 : 0;

/**
 * A rate with nothing to divide by is 0%, not unknown.
 *
 * A campaign that has not sent yet has genuinely had no opens, and a row of
 * dashes across every card reads as broken data rather than as a new campaign.
 */
export const formatRate = (part: number, base: number) =>
  base > 0 ? `${rate(part, base).toFixed(1)}%` : "0%";

export const campaignStatusClass = (status: ContactCampaignStatus) => {
  if (status === "sent") {
    return "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  }
  if (status === "scheduled" || status === "queued" || status === "sending") {
    return "border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300";
  }
  if (status === "paused") {
    return "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  }
  if (status === "cancelled") {
    return "border-destructive/25 bg-destructive/5 text-destructive";
  }
  return "border-border bg-muted/50 text-muted-foreground";
};

export const campaignStatusDot = (status: ContactCampaignStatus) => {
  if (status === "sent") return "bg-emerald-500";
  if (status === "scheduled" || status === "queued" || status === "sending") return "bg-blue-500";
  if (status === "paused") return "bg-amber-500";
  if (status === "cancelled") return "bg-destructive";
  return "bg-muted-foreground/50";
};

export const campaignStat = (campaign: ContactCampaign, key: string) =>
  Number(campaign.stats?.[key] || 0);

/** Campaigns that have left the workspace, or are on their way out. */
export const hasSent = (campaign: ContactCampaign) =>
  ["queued", "sending", "sent", "completed", "archived"].includes(campaign.status);

export const campaignHasStarted = (campaign: ContactCampaign) =>
  hasSent(campaign) ||
  Boolean(campaign.sendStartedAt || campaign.sentAt) ||
  Number(campaign.stats?.sent || 0) > 0;

/** A scheduled send is no longer safe to edit once its worker window opens. */
export const campaignIsDue = (
  campaign: ContactCampaign,
  now = Date.now(),
) => {
  if (campaign.status !== "scheduled" || !campaign.scheduledAt) return false;
  const scheduled = new Date(campaign.scheduledAt).getTime();
  return Number.isFinite(scheduled) && scheduled <= now;
};

export const isEditable = (campaign: ContactCampaign) =>
  campaign.status === "draft" ||
  ((campaign.status === "scheduled" || campaign.status === "paused") &&
    !campaignHasStarted(campaign) &&
    !campaignIsDue(campaign));

export const sendStrategyLabels: Record<string, string> = {
  immediate: "Send now",
  scheduled: "Scheduled",
  timezone_optimized: "Recipient timezone",
  recurring: "Recurring",
};

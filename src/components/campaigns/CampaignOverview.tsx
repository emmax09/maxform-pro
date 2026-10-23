/**
 * Overview tab: how the last 90 days of sending went, what is queued next, and
 * a way into any campaign's own analytics.
 */
import {
  BarChart3,
  CalendarClock,
  Eye,
  FileEdit,
  MousePointerClick,
  PauseCircle,
  PlayCircle,
  Radio,
  Send,
  Trophy,
  UserMinus,
  Users,
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type {
  CampaignOverviewRange,
  CampaignSendProgress,
  ContactCampaign,
} from "@/lib/contacts";
import { cn } from "@/lib/utils";
import { VariableText } from "@/components/ui/variable-text";

import {
  campaignStatusClass,
  formatCampaignDate,
  formatDayLabel,
  formatRate,
  hasSent,
  sendStrategyLabels,
} from "./campaign-format";
import { CampaignCountdown } from "./CampaignCountdown";
import { CampaignProgressMeter } from "./CampaignSendProgress";

type Overview = {
  range?: CampaignOverviewRange;
  rangeDays?: number;
  unsubscribes?: number;
  trend: Array<{ date: string; sent: number; opened: number; clicked: number }>;
  subjects: Array<{
    campaignId: string;
    name: string;
    subject: string;
    sent: number;
    opened: number;
    clicked: number;
  }>;
  openHours: Array<{ hour: number; opens: number }>;
  upcoming: ContactCampaign[];
};

const trendConfig = {
  sent: { label: "Sent", color: "#94A3B8" },
  opened: { label: "Opened", color: "#635BFF" },
  clicked: { label: "Clicked", color: "#0F766E" },
} satisfies ChartConfig;

const overviewRangeLabels: Record<CampaignOverviewRange, string> = {
  "7d": "7 days",
  "1w": "1 week",
  "1m": "1 month",
  "3m": "3 months",
  "6m": "6 months",
  "1y": "1 year",
};

const overviewRangeDays: Record<CampaignOverviewRange, number> = {
  "7d": 7,
  "1w": 7,
  "1m": 30,
  "3m": 90,
  "6m": 180,
  "1y": 365,
};

export function CampaignOverview({
  campaigns,
  onOpenAnalytics,
  onPause,
  onResume,
  onRangeChange,
  overview,
  range,
  sendProgress,
  workspaceTimezone,
  working,
}: {
  campaigns: ContactCampaign[];
  onOpenAnalytics: (campaign: ContactCampaign) => void;
  onPause: (campaign: ContactCampaign) => void;
  onRangeChange: (range: CampaignOverviewRange) => void;
  onResume: (campaign: ContactCampaign) => void;
  overview?: Overview;
  range: CampaignOverviewRange;
  sendProgress?: CampaignSendProgress;
  workspaceTimezone?: string;
  working: boolean;
}) {
  const rangeLabel = overviewRangeLabels[range];
  const periodStart =
    Date.now() - overviewRangeDays[range] * 24 * 60 * 60 * 1_000;
  const periodCampaigns = campaigns.filter(
    (campaign) =>
      hasSent(campaign) &&
      new Date(
        campaign.sentAt || campaign.scheduledAt || campaign.updatedAt || 0,
      ).getTime() >= periodStart,
  );
  const totals = (overview?.trend || []).reduce(
    (accumulator, day) => ({
      sent: accumulator.sent + day.sent,
      opened: accumulator.opened + day.opened,
      clicked: accumulator.clicked + day.clicked,
    }),
    { sent: 0, opened: 0, clicked: 0 },
  );
  const unsubscribes =
    overview?.unsubscribes ??
    periodCampaigns.reduce(
      (sum, campaign) => sum + Number(campaign.stats?.unsubscribed || 0),
      0,
    );

  // Every figure below is derived from records already on screen, so a card can
  // never disagree with the table under it.
  const drafts = campaigns.filter((campaign) => campaign.status === "draft");
  const scheduled = campaigns.filter(
    (campaign) => campaign.status === "scheduled",
  );
  const inFlight = campaigns.filter(
    (campaign) =>
      campaign.status === "sending" || campaign.status === "paused",
  );
  const delivered = periodCampaigns.reduce(
    (sum, campaign) => sum + Number(campaign.stats?.sent || 0),
    0,
  );
  const nextScheduled = scheduled
    .slice()
    .sort(
      (first, second) =>
        new Date(first.scheduledAt || 0).getTime() -
        new Date(second.scheduledAt || 0).getTime(),
    )[0];
  const bestSend = periodCampaigns
    .filter((campaign) => Number(campaign.stats?.sent || 0) >= 20)
    .map((campaign) => ({
      campaign,
      rate:
        Number(campaign.stats?.opened || 0) /
        Math.max(1, Number(campaign.stats?.sent || 0)),
    }))
    .sort((first, second) => second.rate - first.rate)[0];

  const metrics = [
    {
      icon: Send,
      label: "Campaigns sent",
      value: periodCampaigns.length.toLocaleString(),
      detail: `${totals.sent.toLocaleString()} emails in ${rangeLabel}`,
    },
    {
      icon: Eye,
      label: "Average open rate",
      value: formatRate(totals.opened, totals.sent),
      detail: `${totals.opened.toLocaleString()} opens over ${rangeLabel}`,
    },
    {
      icon: MousePointerClick,
      label: "Average click rate",
      value: formatRate(totals.clicked, totals.sent),
      detail: `${totals.clicked.toLocaleString()} clicks over ${rangeLabel}`,
    },
    {
      icon: Users,
      label: "Emails delivered",
      value: delivered.toLocaleString(),
      detail: `Across ${rangeLabel}`,
    },
    {
      icon: UserMinus,
      label: "Unsubscribes",
      value: unsubscribes.toLocaleString(),
      detail: `Across ${rangeLabel}`,
    },
    {
      icon: FileEdit,
      label: "Drafts",
      value: drafts.length.toLocaleString(),
      detail: drafts.length
        ? "Waiting to be finished"
        : "Nothing half-written",
    },
    {
      icon: CalendarClock,
      label: "Scheduled",
      value: scheduled.length.toLocaleString(),
      detail: nextScheduled
        ? `Next: ${formatCampaignDate(
            nextScheduled.scheduledAt,
            workspaceTimezone,
          )}`
        : "Nothing queued",
    },
    {
      icon: Radio,
      label: "Sending now",
      value: inFlight.length.toLocaleString(),
      detail: inFlight.length
        ? inFlight.map((campaign) => campaign.name).join(", ").slice(0, 40)
        : "No campaign in flight",
    },
    {
      icon: Trophy,
      label: "Best open rate",
      // No qualifying send yet is a real zero, not missing data.
      value: bestSend
        ? formatRate(
            Number(bestSend.campaign.stats?.opened || 0),
            Number(bestSend.campaign.stats?.sent || 0),
          )
        : "0%",
      // Only counted once a send is large enough for the rate to mean anything.
      detail: bestSend
        ? bestSend.campaign.name
        : "Needs a send of 20 or more",
    },
  ];

  const recent = periodCampaigns.slice(0, 6);

  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[12px] font-semibold">Overview stats</p>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Filter campaign performance and engagement by a rolling time range.
          </p>
        </div>
        <div className="w-full sm:w-44">
          <Select
            value={range}
            onValueChange={(value) =>
              onRangeChange(value as CampaignOverviewRange)
            }
          >
            <SelectTrigger
              className="h-9 text-[11px]"
              aria-label="Filter overview stats"
            >
              <SelectValue placeholder="Choose a time range" />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(overviewRangeLabels) as CampaignOverviewRange[]).map(
                (value) => (
                  <SelectItem key={value} value={value}>
                    {overviewRangeLabels[value]}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <section
              key={metric.label}
              className="rounded-xl border border-border bg-card p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="text-[10px] font-medium text-muted-foreground">
                  {metric.label}
                </p>
                <Icon className="h-4 w-4 shrink-0 text-primary" />
              </div>
              <p className="mt-4 text-[22px] font-semibold tracking-tight tabular-nums">
                {metric.value}
              </p>
              <p className="mt-1 text-[9px] leading-4 text-muted-foreground">
                {metric.detail}
              </p>
            </section>
          );
        })}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,.6fr)]">
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            <h3 className="text-[14px] font-semibold">Engagement over time</h3>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Sends, opens, and clicks across the last {rangeLabel}.
          </p>
          {overview?.trend?.length ? (
            <ChartContainer
              config={trendConfig}
              className="mt-5 h-[280px] w-full"
            >
              <AreaChart
                data={overview.trend}
                margin={{ left: -22, right: 8, top: 8, bottom: 0 }}
              >
                <defs>
                  <linearGradient
                    id="campaign-opened-fill"
                    x1="0"
                    x2="0"
                    y1="0"
                    y2="1"
                  >
                    <stop
                      offset="5%"
                      stopColor="var(--color-opened)"
                      stopOpacity={0.25}
                    />
                    <stop
                      offset="95%"
                      stopColor="var(--color-opened)"
                      stopOpacity={0}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={28}
                  tickFormatter={formatDayLabel}
                />
                <YAxis
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      indicator="line"
                      labelFormatter={(value) => formatDayLabel(String(value))}
                    />
                  }
                />
                <Area
                  dataKey="sent"
                  type="monotone"
                  stroke="var(--color-sent)"
                  strokeWidth={2}
                  fill="none"
                />
                <Area
                  dataKey="opened"
                  type="monotone"
                  stroke="var(--color-opened)"
                  strokeWidth={2.5}
                  fill="url(#campaign-opened-fill)"
                />
                <Area
                  dataKey="clicked"
                  type="monotone"
                  stroke="var(--color-clicked)"
                  strokeWidth={2}
                  fill="none"
                />
              </AreaChart>
            </ChartContainer>
          ) : (
            <p className="mt-6 rounded-lg border border-dashed border-border py-12 text-center text-[11px] text-muted-foreground">
              Engagement appears here after your first campaign sends.
            </p>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-primary" />
            <h3 className="text-[14px] font-semibold">Upcoming sends</h3>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Anything not yet gone out can be paused, resumed, or edited safely.
          </p>
          {overview?.upcoming.length ? (
            <ul className="mt-4 space-y-3">
              {overview.upcoming.map((campaign) => {
                const liveProgress =
                  sendProgress?.campaignId === campaign.id
                    ? sendProgress
                    : undefined;
                const progressTotal =
                  liveProgress?.totalRecipients ||
                  Number(campaign.stats?.recipients || 0);
                const progressSent =
                  liveProgress?.sent ?? Number(campaign.stats?.sent || 0);
                const progressFailed =
                  liveProgress?.failed ?? Number(campaign.stats?.failed || 0);
                const showProgress =
                  (campaign.status === "sending" ||
                    campaign.status === "paused") &&
                  progressTotal > 0;
                return (
                  <li
                    key={campaign.id}
                    className="rounded-lg border border-border p-3"
                  >
                    {showProgress ? (
                      <div className="mb-2.5">
                        <CampaignProgressMeter
                          total={progressTotal}
                          sent={progressSent}
                          failed={progressFailed}
                          status={liveProgress?.status || campaign.status}
                          compact
                        />
                      </div>
                    ) : null}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-[12px] font-semibold">
                        {campaign.name}
                      </p>
                      <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                        {campaign.audienceMode === "custom"
                          ? `Custom emails (${(campaign.customRecipients?.length ?? 0).toLocaleString()})`
                          : campaign.listName} ·{" "}
                        {sendStrategyLabels[campaign.sendStrategy] ||
                          campaign.sendStrategy}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn(
                        "shrink-0 rounded-full text-[9px] capitalize",
                        campaignStatusClass(campaign.status),
                      )}
                    >
                      {campaign.status}
                    </Badge>
                  </div>
                  <div className="mt-2.5 flex items-center justify-between gap-2">
                    <div>
                      <span className="text-[10px] text-muted-foreground">
                        {formatCampaignDate(
                          campaign.scheduledAt,
                          workspaceTimezone,
                        )}
                      </span>
                      {campaign.scheduledAt ? (
                        <CampaignCountdown scheduledAt={campaign.scheduledAt} />
                      ) : null}
                    </div>
                    {campaign.status === "paused" ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-[10px]"
                        disabled={working}
                        onClick={() => onResume(campaign)}
                      >
                        <PlayCircle className="h-3.5 w-3.5" />
                        Resume
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-[10px]"
                        disabled={working}
                        onClick={() => onPause(campaign)}
                      >
                        <PauseCircle className="h-3.5 w-3.5" />
                        Pause
                      </Button>
                    )}
                  </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-4 rounded-lg border border-dashed border-border py-10 text-center text-[11px] text-muted-foreground">
              Nothing scheduled right now.
            </p>
          )}
        </section>
      </div>

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="border-b border-border px-5 py-4">
          <h3 className="text-[14px] font-semibold">Recent campaigns</h3>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Open any of them for the full click-map and engagement analytics.
          </p>
        </div>
        {recent.length ? (
          <div className="dashboard-scroll overflow-x-auto">
            <table className="w-full min-w-[640px] text-left">
              <thead className="border-b border-border text-[10px] uppercase tracking-[.08em] text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-medium">Campaign</th>
                  <th className="px-3 py-3 font-medium">Sent</th>
                  <th className="px-3 py-3 text-right font-medium">Open rate</th>
                  <th className="px-3 py-3 text-right font-medium">
                    Click rate
                  </th>
                  <th className="px-5 py-3 text-right font-medium">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recent.map((campaign) => {
                  const sent = Number(campaign.stats?.sent || 0);
                  return (
                    <tr key={campaign.id} className="text-[11px]">
                      <td className="max-w-[260px] px-5 py-3">
                        <p className="truncate font-medium">{campaign.name}</p>
                        <VariableText
                          value={campaign.subject}
                          className="mt-0.5 block truncate text-[10px] text-muted-foreground"
                        />
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {sent.toLocaleString()}
                      </td>
                      <td className="px-3 py-3 text-right font-mono">
                        {formatRate(Number(campaign.stats?.opened || 0), sent)}
                      </td>
                      <td className="px-3 py-3 text-right font-mono">
                        {formatRate(Number(campaign.stats?.clicked || 0), sent)}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 text-[10px]"
                          onClick={() => onOpenAnalytics(campaign)}
                        >
                          Analytics
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="py-12 text-center text-[11px] text-muted-foreground">
            No campaign has sent yet.
          </p>
        )}
      </section>
    </div>
  );
}

/**
 * Analytics tab.
 *
 * The analytics are scoped to one campaign id: engagement, delivery,
 * deliverability, click-map, variants and attributed revenue all come from the
 * same campaign's stored messages and orders.
 */
import {
  BarChart3,
  DollarSign,
  Eye,
  MailCheck,
  MousePointerClick,
  Send,
  Smartphone,
  TrendingUp,
  UserMinus,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  CampaignClickMapEntry,
  CampaignVariant,
  ContactCampaign,
} from "@/lib/contacts";
import { cn } from "@/lib/utils";

import { formatMoney, formatRate, rate } from "./campaign-format";

export type CampaignAnalyticsData = {
  campaign: ContactCampaign;
  totals: {
    recipients: number;
    sent: number;
    delivered: number;
    uniqueOpens: number;
    totalOpens: number;
    uniqueClicks: number;
    totalClicks: number;
    bounced: number;
    complained: number;
    failed: number;
    queued: number;
    unsubscribed: number;
  };
  devices: Array<{ name: string; count: number }>;
  clients: Array<{ name: string; count: number }>;
  revenue: { orders: number; amount: number; currency: string };
  variants: CampaignVariant[];
};

const deviceLabel = (name: string) =>
  name === "unknown"
    ? "Not reported"
    : name.replace(/\b\w/g, (letter) => letter.toUpperCase());

export function CampaignAnalyticsPanel({
  analytics,
  clickMap,
  loading,
}: {
  analytics?: CampaignAnalyticsData;
  clickMap: CampaignClickMapEntry[];
  loading: boolean;
}) {
  if (loading && !analytics) {
    return (
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-28 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-[360px] rounded-xl" />
      </div>
    );
  }

  if (!analytics) {
    return (
      <p className="rounded-xl border border-dashed border-border py-14 text-center text-[11px] text-muted-foreground">
        Open a campaign that has sent to see its analytics.
      </p>
    );
  }

  const { totals, revenue } = analytics;
  const topClicks = Math.max(...clickMap.map((entry) => entry.clickCount), 1);
  const deviceTotal = analytics.devices.reduce(
    (sum, entry) => sum + entry.count,
    0,
  );
  // Some providers report acceptance immediately but deliverability later via
  // webhook. Until that event arrives, sent is the honest denominator for
  // engagement rates so a real open cannot be hidden behind "0 delivered".
  const engagementBase = totals.delivered || totals.sent;
  const deliveryRate = totals.sent
    ? totals.delivered
      ? formatRate(totals.delivered, totals.sent)
      : "Awaiting"
    : "0%";

  const metrics = [
    {
      icon: Send,
      label: "Sent",
      value: totals.sent.toLocaleString(),
      detail: `${totals.sent.toLocaleString()} sent · ${formatRate(totals.delivered, totals.sent)} delivery rate`,
    },
    {
      icon: MailCheck,
      label: "Delivered",
      value: totals.delivered.toLocaleString(),
      detail: totals.delivered
        ? `${formatRate(totals.delivered, totals.sent)} of sent messages`
        : totals.sent
          ? "Waiting for provider delivery events"
          : "No delivery events yet",
    },
    {
      icon: Eye,
      label: "Open rate",
      value: formatRate(totals.uniqueOpens, engagementBase),
      detail: `${formatRate(totals.uniqueOpens, totals.delivered)} of delivered · ${totals.totalOpens.toLocaleString()} total`,
    },
    {
      icon: MousePointerClick,
      label: "Click rate",
      value: formatRate(totals.uniqueClicks, engagementBase),
      detail: `${formatRate(totals.uniqueClicks, totals.delivered)} of delivered · ${totals.totalClicks.toLocaleString()} total`,
    },
    {
      icon: TrendingUp,
      label: "Click-to-open",
      value: formatRate(totals.uniqueClicks, totals.uniqueOpens),
      detail: "Clicks among unique openers",
    },
    {
      icon: DollarSign,
      label: "Revenue attributed",
      value: formatMoney(revenue.amount, revenue.currency),
      detail: `${revenue.orders.toLocaleString()} order${revenue.orders === 1 ? "" : "s"} traced to this send`,
    },
  ];

  const displayMetrics = metrics.map((metric) => {
    if (metric.label === "Sent") {
      return {
        ...metric,
        detail: `${totals.recipients.toLocaleString()} recipients queued for this campaign`,
      };
    }
    if (metric.label === "Open rate") {
      return {
        ...metric,
        detail: `${totals.uniqueOpens.toLocaleString()} unique opens · ${totals.totalOpens.toLocaleString()} total`,
      };
    }
    if (metric.label === "Click rate") {
      return {
        ...metric,
        detail: `${totals.uniqueClicks.toLocaleString()} unique clicks · ${totals.totalClicks.toLocaleString()} total`,
      };
    }
    return metric;
  });

  const health = [
    {
      label: "Bounced",
      value: rate(totals.bounced, totals.sent),
      detail: `${totals.bounced.toLocaleString()} messages`,
    },
    {
      label: "Complaints",
      value: rate(totals.complained, totals.sent),
      detail: `${totals.complained.toLocaleString()} marked as spam`,
    },
    {
      label: "Unsubscribed",
      value: rate(totals.unsubscribed, engagementBase),
      detail: `${totals.unsubscribed.toLocaleString()} opted out`,
    },
    {
      label: "Failed",
      value: rate(totals.failed, totals.sent),
      detail: `${totals.failed.toLocaleString()} never left`,
    },
  ];

  return (
    <div className="space-y-5">
      <section className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-card px-5 py-4">
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-[.08em] text-muted-foreground">
            Campaign analytics
          </p>
          <h2 className="mt-1 truncate text-[16px] font-semibold">
            {analytics.campaign.name}
          </h2>
          <p className="mt-1 truncate text-[11px] text-muted-foreground">
            {analytics.campaign.subject}
          </p>
        </div>
        <Badge variant="outline" className="capitalize">
          {analytics.campaign.status}
        </Badge>
      </section>

      <section className="rounded-xl border border-primary/20 bg-primary/[0.035] px-4 py-3">
        <p className="text-[11px] leading-5 text-muted-foreground">
          <strong className="text-foreground">Where these come from:</strong>{" "}
          every real campaign send receives secure open, click, and unsubscribe
          tracking at dispatch time. Provider events add delivery, bounce, and
          complaint detail when available. This view refreshes automatically
          while it is open. Bounces and complaints feed the workspace-wide
          suppression list shared with Contacts and Email, so an opt-out here
          applies everywhere. When testing a local build on a phone, the
          tracking origin must be reachable from that phone; `localhost` only
          points back to the phone itself.
        </p>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {displayMetrics.map((metric) => {
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

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-[14px] font-semibold">Engagement funnel</h3>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
              See how recipients move from send to click. Delivery expands as
              provider events arrive.
            </p>
          </div>
          <Badge variant="outline" className="text-[9px]">
            {deliveryRate} delivery rate
          </Badge>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-4">
          {[
            { label: "Sent", count: totals.sent, color: "bg-slate-400" },
            { label: "Delivered", count: totals.delivered, color: "bg-blue-500" },
            { label: "Opened", count: totals.uniqueOpens, color: "bg-violet-500" },
            { label: "Clicked", count: totals.uniqueClicks, color: "bg-emerald-500" },
          ].map((stage) => (
            <div key={stage.label}>
              <div className="flex items-center justify-between gap-3 text-[11px]">
                <span className="font-medium">{stage.label}</span>
                <span className="font-mono tabular-nums text-muted-foreground">
                  {stage.count.toLocaleString()}
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full", stage.color)}
                  style={{
                    width: `${Math.min(100, (stage.count / Math.max(totals.sent, 1)) * 100)}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-5">
        <section className="rounded-xl border border-border bg-card">
          <div className="border-b border-border p-5">
            <div className="flex items-center gap-2">
              <MousePointerClick className="h-4 w-4 text-primary" />
              <h3 className="text-[14px] font-semibold">Click map</h3>
            </div>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
              Which specific link earned the clicks in this campaign.
            </p>
          </div>
          {clickMap.length ? (
            <ul className="divide-y divide-border">
              {clickMap.map((entry) => {
                const blockLabel = "Tracked link";
                return (
                  <li key={`${entry.blockId}-${entry.url}`} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-[12px] font-medium">
                          {entry.label || entry.url}
                        </p>
                        <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                          {blockLabel} · {entry.url}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-mono text-[13px] font-semibold tabular-nums">
                          {entry.clickCount.toLocaleString()}
                        </p>
                        <p className="text-[9px] text-muted-foreground">
                          {entry.uniqueClickCount.toLocaleString()} unique
                        </p>
                      </div>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{
                          width: `${(entry.clickCount / topClicks) * 100}%`,
                        }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="p-6 text-center text-[11px] text-muted-foreground">
              No link clicks recorded yet. Every https link in the body is
              registered against its block, so the map fills in as clicks arrive.
            </p>
          )}
        </section>

      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <Smartphone className="h-4 w-4 text-primary" />
            <h3 className="text-[13px] font-semibold">Device</h3>
          </div>
          {analytics.devices.length ? (
            <div className="mt-4 space-y-3">
              {analytics.devices.map((entry) => (
                <div key={entry.name}>
                  <div className="flex items-center justify-between gap-3 text-[11px]">
                    <span className="font-medium">
                      {deviceLabel(entry.name)}
                    </span>
                    <span className="font-mono text-muted-foreground">
                      {formatRate(entry.count, deviceTotal)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{
                        width: `${rate(entry.count, deviceTotal)}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-[11px] text-muted-foreground">
              Device data appears when your provider includes it with open
              events.
            </p>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            <h3 className="text-[13px] font-semibold">Email client</h3>
          </div>
          {analytics.clients.length ? (
            <ul className="mt-4 space-y-2">
              {analytics.clients.map((entry) => (
                <li
                  key={entry.name}
                  className="flex items-center justify-between gap-3 text-[11px]"
                >
                  <span>{deviceLabel(entry.name)}</span>
                  <span className="font-mono text-muted-foreground">
                    {entry.count.toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-[11px] text-muted-foreground">
              Client share appears alongside device data.
            </p>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <UserMinus className="h-4 w-4 text-primary" />
            <h3 className="text-[13px] font-semibold">Deliverability</h3>
          </div>
          <div className="mt-4 space-y-3">
            {health.map((item) => (
              <div key={item.label}>
                <div className="flex items-center justify-between gap-3 text-[11px]">
                  <span className="font-medium">{item.label}</span>
                  <span className="font-mono text-muted-foreground">
                    {item.value.toFixed(1)}%
                  </span>
                </div>
                <p className="mt-0.5 text-[9px] text-muted-foreground">
                  {item.detail}
                </p>
              </div>
            ))}
          </div>
        </section>
      </div>

      {analytics.variants.length ? (
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            <h3 className="text-[13px] font-semibold">A/B result</h3>
          </div>
          <div className="dashboard-scroll mt-4 overflow-x-auto">
            <table className="w-full min-w-[520px] text-left">
              <thead className="border-b border-border text-[10px] uppercase tracking-[.08em] text-muted-foreground">
                <tr>
                  <th className="pb-2 font-medium">Variant</th>
                  <th className="pb-2 font-medium">Subject</th>
                  <th className="pb-2 text-right font-medium">Sent</th>
                  <th className="pb-2 text-right font-medium">Open rate</th>
                  <th className="pb-2 text-right font-medium">Click rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {analytics.variants.map((variant) => (
                  <tr
                    key={variant.id}
                    className={cn(
                      "text-[11px]",
                      variant.winner && "bg-emerald-500/[0.06]",
                    )}
                  >
                    <td className="py-2.5 font-medium">
                      {variant.label}
                      {variant.winner ? (
                        <Badge
                          variant="outline"
                          className="ml-2 border-emerald-500/30 text-[8px] uppercase text-emerald-700 dark:text-emerald-300"
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
                      {formatRate(variant.openedCount, variant.sentCount)}
                    </td>
                    <td className="py-2.5 text-right font-mono">
                      {formatRate(variant.clickedCount, variant.sentCount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}

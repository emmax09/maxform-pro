import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  BriefcaseBusiness,
  CheckCircle2,
  CircleAlert,
  CircleDollarSign,
  ContactRound,
  Flame,
  Gauge,
  Lightbulb,
  Search,
  ShieldAlert,
  TrendingUp,
  UserRoundSearch,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  searchCrm,
  type CrmCommandCenter,
  type CrmSearchResult,
  type CrmWorkspaceData,
} from "@/lib/crm";
import { formatCurrency } from "@/lib/regional-options";
import type { CrmTab } from "@/components/crm/CrmModule";
import { cn } from "@/lib/utils";

type CommandCenterPanelProps = {
  data: CrmWorkspaceData;
  userId: string;
  onNavigate: (tab: CrmTab) => void;
};

const formatDate = (value: string | null) => {
  if (!value) return "No due date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No due date";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
};

const titleCase = (value: string) =>
  value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

const priorityClass = (priority: string) => {
  if (priority === "urgent") return "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300";
  if (priority === "high") return "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  return "border-primary/20 bg-primary/10 text-primary";
};

const insightClass = (type: string) => {
  if (type === "risk") return "border-rose-500/20 bg-rose-500/[0.04]";
  if (type === "momentum") return "border-emerald-500/20 bg-emerald-500/[0.04]";
  return "border-primary/20 bg-primary/[0.04]";
};

const resultIcon = (resultType: CrmSearchResult["resultType"]) => {
  if (resultType === "deal") return BriefcaseBusiness;
  if (resultType === "lead") return UserRoundSearch;
  if (resultType === "company") return Gauge;
  return ContactRound;
};

const resultTab = (resultType: CrmSearchResult["resultType"]): CrmTab => {
  if (resultType === "contact") return "customer360";
  if (resultType === "company") return "companies";
  if (resultType === "lead") return "leads";
  return "deals";
};

const fallbackCommandCenter = (data: CrmWorkspaceData): CrmCommandCenter => ({
  nextActions: (data.attention || []).slice(0, 12).map((item) => ({
    id: `next:${item.id}`,
    title: item.title,
    reason: item.reason,
    actionLabel: item.action,
    entityType: item.entityType,
    entityId: item.entityId,
    contactId: item.entityType === "contact" ? item.entityId : null,
    priority: item.severity,
    dueAt: null,
    evidence: [item.reason],
    createdAt: item.createdAt,
  })),
  insights: [],
  metrics: {
    trackedRelationships: data.contacts.length,
    atRiskRelationships: (data.attention || []).filter(
      (item) => item.entityType === "contact",
    ).length,
    openNextActions: (data.attention || []).length,
    pipelineAtRiskCents: 0,
    recentRevenue: data.revenue.slice(-2).reduce((sum, point) => sum + point.revenue, 0),
    highIntentLeads: data.leads.filter(
      (lead) => !["converted", "unqualified", "archived"].includes(lead.status) && lead.score >= 70,
    ).length,
  },
});

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Gauge;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[9px] uppercase tracking-[0.08em] text-muted-foreground">
          {label}
        </p>
        <Icon className="h-3.5 w-3.5 text-primary" />
      </div>
      <p className="mt-2 truncate text-[18px] font-semibold">{value}</p>
      <p className="mt-1 truncate text-[10px] text-muted-foreground">{detail}</p>
    </div>
  );
}

export function CommandCenterPanel({
  data,
  userId,
  onNavigate,
}: CommandCenterPanelProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const commandCenter = data.commandCenter || fallbackCommandCenter(data);
  const normalizedSearch = searchTerm.trim();
  const searchQuery = useQuery({
    enabled: Boolean(userId && normalizedSearch.length >= 2),
    queryKey: ["crm-global-search", userId, normalizedSearch],
    queryFn: () => searchCrm(userId, normalizedSearch, 12),
    staleTime: 10_000,
  });
  const searchVisible = normalizedSearch.length >= 2;
  const metrics = commandCenter.metrics;
  const actionCountLabel = `${metrics.openNextActions} open signal${metrics.openNextActions === 1 ? "" : "s"}`;
  const searchResults = searchQuery.data || [];
  const insightCount = commandCenter.insights.length;

  const groupedSearchResults = useMemo(
    () =>
      (searchQuery.data || []).reduce((groups, result) => {
        const current = groups.get(result.resultType) || [];
        current.push(result);
        groups.set(result.resultType, current);
        return groups;
      }, new Map<string, CrmSearchResult[]>()),
    [searchQuery.data],
  );

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/[0.08] via-card to-card p-5 sm:p-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-primary">
              <Gauge className="h-4 w-4" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em]">
                Relationship command center
              </span>
            </div>
            <h2 className="mt-3 text-[22px] font-semibold tracking-[-0.02em]">
              Know who needs you next.
            </h2>
            <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
              One operating view for relationship health, revenue momentum, and the next action. Every signal below is backed by records in your workspace.
            </p>
          </div>
          <div className="relative w-full xl:w-[360px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search contacts, companies, leads, deals"
              aria-label="Search all CRM records"
              className="h-10 border-primary/20 bg-background/75 pl-9 text-[11px]"
            />
            {searchVisible ? (
              <div className="absolute inset-x-0 top-12 z-20 rounded-xl border border-border bg-popover p-2 shadow-xl">
                {searchQuery.isLoading ? (
                  <p className="px-3 py-4 text-[10px] text-muted-foreground">Searching live CRM records…</p>
                ) : searchResults.length ? (
                  <div className="max-h-72 space-y-1 overflow-y-auto">
                    {Array.from(groupedSearchResults.entries()).map(([type, results]) => (
                      <div key={type}>
                        <p className="px-3 pb-1 pt-2 text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                          {titleCase(type)}
                        </p>
                        {results.map((result) => {
                          const Icon = resultIcon(result.resultType);
                          return (
                            <button
                              type="button"
                              key={`${result.resultType}:${result.id}`}
                              onClick={() => {
                                onNavigate(resultTab(result.resultType));
                                setSearchTerm("");
                              }}
                              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-muted/60"
                            >
                              <Icon className="h-3.5 w-3.5 shrink-0 text-primary" />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[10px] font-medium">{result.title}</span>
                                <span className="mt-0.5 block truncate text-[9px] text-muted-foreground">{result.subtitle}</span>
                              </span>
                              <Badge variant="outline" className="shrink-0 text-[8px]">{titleCase(result.status)}</Badge>
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="px-3 py-4 text-[10px] text-muted-foreground">No CRM records match that search.</p>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <MetricCard label="Tracked relationships" value={metrics.trackedRelationships.toLocaleString()} detail="Workspace contacts" icon={BriefcaseBusiness} />
        <MetricCard label="At-risk relationships" value={metrics.atRiskRelationships.toLocaleString()} detail="Explainable risk signals" icon={ShieldAlert} />
        <MetricCard label="Next actions" value={metrics.openNextActions.toLocaleString()} detail={actionCountLabel} icon={CheckCircle2} />
        <MetricCard label="Pipeline at risk" value={formatCurrency(metrics.pipelineAtRiskCents / 100, data.currency)} detail="Open deals with attention signals" icon={CircleDollarSign} />
        <MetricCard label="Recent revenue" value={formatCurrency(metrics.recentRevenue, data.currency)} detail="Confirmed payment revenue · 60d" icon={TrendingUp} />
        <MetricCard label="High-intent leads" value={metrics.highIntentLeads.toLocaleString()} detail="Score 70 or higher" icon={Flame} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,.9fr)]">
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <CircleAlert className="h-4 w-4 text-amber-500" />
                <h3 className="text-[14px] font-semibold">Next best actions</h3>
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Prioritized from ownership gaps, ageing, close dates, and payment state.
              </p>
            </div>
            <Badge variant="outline" className="text-[9px]">{actionCountLabel}</Badge>
          </div>
          <div className="mt-4 divide-y divide-border border-y border-border">
            {commandCenter.nextActions.length ? commandCenter.nextActions.map((action) => (
              <div key={action.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[11px] font-semibold">{action.title}</p>
                    <Badge variant="outline" className={cn("text-[8px]", priorityClass(action.priority))}>
                      {titleCase(action.priority)}
                    </Badge>
                  </div>
                  <p className="mt-1 text-[10px] leading-5 text-muted-foreground">{action.reason}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {action.evidence.map((evidence) => (
                      <span key={evidence} className="rounded-full bg-muted px-2 py-1 text-[8px] text-muted-foreground">{evidence}</span>
                    ))}
                  </div>
                  {action.dueAt ? <p className="mt-2 text-[9px] text-muted-foreground">Due or expected: {formatDate(action.dueAt)}</p> : null}
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0 text-[10px]"
                  onClick={() => {
                    if (action.entityType === "contact") onNavigate("customer360");
                    else if (action.entityType === "lead") onNavigate("leads");
                    else if (action.entityType === "deal") onNavigate("deals");
                    else if (action.entityType === "task") onNavigate("tasks");
                    else onNavigate("reports");
                  }}
                >
                  {action.actionLabel}
                  <ArrowRight className="h-3 w-3" />
                </Button>
              </div>
            )) : (
              <div className="py-12 text-center">
                <CheckCircle2 className="mx-auto h-5 w-5 text-emerald-500" />
                <p className="mt-3 text-[11px] font-medium">Your relationship queue is clear.</p>
                <p className="mt-1 text-[10px] text-muted-foreground">New signals will appear here as workspace records change.</p>
              </div>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-primary" />
                <h3 className="text-[14px] font-semibold">Relationship insights</h3>
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">Momentum, opportunity, and risk from live CRM signals.</p>
            </div>
            <Badge variant="outline" className="text-[9px]">{insightCount} live</Badge>
          </div>
          <div className="mt-4 space-y-3">
            {commandCenter.insights.length ? commandCenter.insights.map((insight) => (
              <div key={insight.id} className={cn("rounded-xl border p-4", insightClass(insight.type))}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="text-[8px]">{titleCase(insight.type)}</Badge>
                      <span className="text-[9px] font-medium text-muted-foreground">{insight.score}/100 signal strength</span>
                    </div>
                    <p className="mt-2 text-[11px] font-semibold">{insight.title}</p>
                    <p className="mt-1 text-[10px] leading-5 text-muted-foreground">{insight.detail}</p>
                  </div>
                  {insight.type === "risk" ? <ShieldAlert className="h-4 w-4 shrink-0 text-rose-500" /> : insight.type === "momentum" ? <TrendingUp className="h-4 w-4 shrink-0 text-emerald-500" /> : <Lightbulb className="h-4 w-4 shrink-0 text-primary" />}
                </div>
                <div className="mt-3 space-y-1">
                  {insight.evidence.map((evidence) => <p key={evidence} className="text-[9px] text-muted-foreground">• {evidence}</p>)}
                </div>
                {insight.contactId ? (
                  <Button type="button" variant="ghost" size="sm" className="mt-2 h-7 px-0 text-[9px] text-primary hover:bg-transparent" onClick={() => onNavigate("customer360")}>
                    Inspect relationship <ArrowRight className="h-3 w-3" />
                  </Button>
                ) : null}
              </div>
            )) : (
              <div className="rounded-xl border border-dashed border-border p-8 text-center">
                <Lightbulb className="mx-auto h-5 w-5 text-muted-foreground" />
                <p className="mt-3 text-[11px] font-medium">More insight appears with more activity.</p>
                <p className="mt-1 text-[10px] leading-5 text-muted-foreground">Connect forms, payments, events, and conversations to build a richer relationship picture.</p>
              </div>
            )}
          </div>
        </section>
      </div>

      <section className="rounded-xl border border-border bg-muted/15 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <Gauge className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div>
            <p className="text-[11px] font-semibold">Evidence-first operating layer</p>
            <p className="mt-1 max-w-3xl text-[10px] leading-5 text-muted-foreground">
              Signals are deterministic and traceable to CRM records: lead score, deal stage, task due date, last activity, and payment status. The command center helps your team decide faster while keeping the underlying record as the source of truth.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

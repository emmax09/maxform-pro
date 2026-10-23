import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  BarChart3,
  Bot,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Check,
  CircleDollarSign,
  Clock3,
  Columns3,
  ContactRound,
  Download,
  FileDown,
  Gauge,
  GitBranch,
  Handshake,
  Import,
  LayoutDashboard,
  List,
  ListTodo,
  Loader2,
  Mail,
  MoreHorizontal,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Settings2,
  SlidersHorizontal,
  Target,
  Trash2,
  TrendingUp,
  Trophy,
  UserRoundSearch,
  Users,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  ContactsModule,
  type ContactsTab,
} from "@/components/contacts/ContactsModule";
import { Customer360Panel } from "@/components/crm/Customer360Panel";
import { CommandCenterPanel } from "@/components/crm/CommandCenterPanel";
import {
  TableBulkActions,
  TableFilterBar,
  TableFilterSelect,
  TablePagination,
  TableRowSelect,
  TableSearchField,
  TableSelectionBar,
} from "@/components/shared/TableFilters";
import { PaginatedCardGrid } from "@/components/shared/CardGrid";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  convertCrmLead,
  createCrmCompany,
  createCrmDeal,
  createCrmLead,
  createCrmPipeline,
  createCrmPipelineStage,
  createCrmTask,
  deleteCrmPipeline,
  deleteCrmPipelineStage,
  getCrmWorkspace,
  reorderCrmPipelineStage,
  updateCrmDealStage,
  updateCrmLeadStatus,
  updateCrmPipeline,
  updateCrmPipelineStage,
  updateCrmTaskStatus,
  type CrmActivity,
  type CrmCompany,
  type CrmDeal,
  type CrmLead,
  type CrmLeadStatus,
  type CrmPipeline,
  type CrmPipelineStage,
  type CrmTask,
  type CrmTaskStatus,
  type CrmWorkspaceData,
} from "@/lib/crm";
import { downloadCsvFile } from "@/lib/csv";
import { formatCurrency } from "@/lib/regional-options";
import { useTablePagination } from "@/hooks/use-table-pagination";
import { useTableSelection } from "@/hooks/use-table-selection";
import { cn } from "@/lib/utils";

export type CrmTab =
  | "overview"
  | "contacts"
  | "customer360"
  | "command-center"
  | "companies"
  | "leads"
  | "deals"
  | "pipelines"
  | "activities"
  | "tasks"
  | "calendar"
  | "reports"
  | "import"
  | "ai"
  | "settings";

type CrmModuleProps = {
  userId?: string;
  initialTab?: CrmTab;
  onTabChange?: (tab: CrmTab) => void;
};

type CreateKind =
  | "company"
  | "lead"
  | "deal"
  | "task"
  | "pipeline";

const primaryTabs: Array<{
  key: CrmTab;
  label: string;
  icon: LucideIcon;
}> = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "contacts", label: "Contacts", icon: ContactRound },
  { key: "customer360", label: "Customer 360", icon: ContactRound },
  { key: "command-center", label: "Command center", icon: Gauge },
  { key: "companies", label: "Companies", icon: Building2 },
  { key: "leads", label: "Leads", icon: UserRoundSearch },
  { key: "deals", label: "Deals", icon: Handshake },
  { key: "pipelines", label: "Pipelines", icon: GitBranch },
  { key: "ai", label: "CRM intelligence", icon: Bot },
];

const adaptiveTabs: Array<{
  key: CrmTab;
  label: string;
  icon: LucideIcon;
}> = [
  { key: "activities", label: "Activities", icon: Activity },
  { key: "tasks", label: "Tasks", icon: ListTodo },
  { key: "calendar", label: "Calendar", icon: CalendarDays },
  { key: "reports", label: "Reports", icon: BarChart3 },
];

const settingsTab = {
  key: "settings" as const,
  label: "Settings",
  icon: Settings2,
};
const importExportTab = {
  key: "import" as const,
  label: "Import & export",
  icon: Import,
};
const allTabs = [
  ...primaryTabs,
  ...adaptiveTabs,
  importExportTab,
  settingsTab,
];
const crmTabButtonClass =
  "relative flex h-12 shrink-0 items-center gap-2 px-3 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground sm:px-4 sm:text-[12px]";

function CrmSectionNav({
  activeTab,
  onSelect,
}: {
  activeTab: CrmTab;
  onSelect: (tab: CrmTab) => void;
}) {
  const renderTab = (
    tab: (typeof allTabs)[number],
  ) => {
    const Icon = tab.icon;
    return (
      <button
        key={tab.key}
        type="button"
        onClick={() => onSelect(tab.key)}
        className={cn(
          crmTabButtonClass,
          activeTab === tab.key && "text-foreground",
        )}
      >
        <Icon className="h-3.5 w-3.5" />
        {tab.label}
        {activeTab === tab.key ? (
          <span className="absolute inset-x-2 bottom-0 h-0.5 bg-primary" />
        ) : null}
      </button>
    );
  };

  return (
    <>
      <nav
        className="mt-7 flex w-full flex-wrap items-end gap-x-1 gap-y-0 border-b border-border"
        aria-label="CRM sections"
      >
        {allTabs.map((tab) => renderTab(tab))}
      </nav>
    </>
  );
}

const formatMoney = (cents: number, currency = "USD") =>
  formatCurrency(cents / 100, currency);

const formatRevenue = (value: number, currency = "USD") =>
  formatCurrency(value, currency);

const formatDate = (value: string | null, includeTime = false) => {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    ...(includeTime ? { timeStyle: "short" as const } : {}),
  }).format(date);
};

const titleCase = (value: string) =>
  value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const sameDay = (left: Date, right: Date) =>
  left.getFullYear() === right.getFullYear() &&
  left.getMonth() === right.getMonth() &&
  left.getDate() === right.getDate();

function EmptyPanel({
  action,
  description,
  icon: Icon,
  title,
}: {
  action?: React.ReactNode;
  description: string;
  icon: LucideIcon;
  title: string;
}) {
  return (
    <div className="flex min-h-[300px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-muted/15 px-6 py-14 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </span>
      <h3 className="mt-4 text-[15px] font-semibold">{title}</h3>
      <p className="mt-2 max-w-md text-[12px] leading-5 text-muted-foreground">
        {description}
      </p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
  onClick,
  tone = "primary",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  onClick: () => void;
  tone?: "primary" | "success" | "warning" | "danger";
}) {
  const toneClass = {
    primary: "bg-primary/10 text-primary",
    success:
      "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    warning: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    danger: "bg-rose-500/10 text-rose-700 dark:text-rose-400",
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className="group min-w-0 rounded-xl border border-border bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <span
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-lg",
            toneClass,
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      <p className="mt-5 truncate text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-[23px] font-semibold tracking-tight">{value}</p>
      <p className="mt-1 truncate text-[10px] text-muted-foreground">
        {detail}
      </p>
    </button>
  );
}

function CrmOverview({
  data,
  onNavigate,
}: {
  data: CrmWorkspaceData;
  onNavigate: (tab: CrmTab) => void;
}) {
  const today = new Date();
  const openLeads = data.leads.filter(
    (lead) => !["unqualified", "archived"].includes(lead.status),
  );
  const activeDeals = data.deals.filter((deal) => !deal.isWon && !deal.isLost);
  const wonDeals = data.deals.filter((deal) => deal.isWon);
  const lostDeals = data.deals.filter((deal) => deal.isLost);
  const upcomingTasks = data.tasks.filter(
    (task) => task.status !== "completed" && task.status !== "cancelled",
  );
  const todayMeetings = data.events.filter((event) =>
    sameDay(new Date(event.startsAt), today),
  );
  const revenue = data.revenue.reduce((sum, point) => sum + point.revenue, 0);
  const recentActivity = data.activities.filter(
    (activity) =>
      new Date(activity.createdAt).getTime() >=
      today.getTime() - 7 * 24 * 60 * 60 * 1000,
  );
  const stages = data.pipelines[0]?.stages || [];
  const maxStageCount = Math.max(
    1,
    ...stages.map(
      (stage) =>
        data.deals.filter((deal) => deal.stageId === stage.id).length,
    ),
  );
  const sourceCounts = Array.from(
    data.leads.reduce((map, lead) => {
      const source = lead.sourceLabel || titleCase(lead.sourceType);
      map.set(source, (map.get(source) || 0) + 1);
      return map;
    }, new Map<string, number>()),
  )
    .sort((left, right) => right[1] - left[1])
    .slice(0, 5);
  const maxRevenue = Math.max(
    1,
    ...data.revenue.map((point) => point.revenue),
  );
  const conversionRate = data.leads.length
    ? Math.round(
        (data.leads.filter((lead) => lead.convertedContactId).length /
          data.leads.length) *
          100,
      )
    : 0;

  const metrics = [
    {
      label: "Total contacts",
      value: data.contacts.length.toLocaleString(),
      detail: "Shared across every MaxForm module",
      icon: ContactRound,
      tab: "contacts" as CrmTab,
      tone: "primary" as const,
    },
    {
      label: "Companies",
      value: data.companies.length.toLocaleString(),
      detail: "Account-level relationship rollups",
      icon: Building2,
      tab: "companies" as CrmTab,
      tone: "primary" as const,
    },
    {
      label: "Open leads",
      value: openLeads.length.toLocaleString(),
      detail: `${conversionRate}% converted`,
      icon: UserRoundSearch,
      tab: "leads" as CrmTab,
      tone: "warning" as const,
    },
    {
      label: "Active deals",
      value: activeDeals.length.toLocaleString(),
      detail: formatMoney(
        activeDeals.reduce((sum, deal) => sum + deal.valueCents, 0),
      ),
      icon: Handshake,
      tab: "deals" as CrmTab,
      tone: "primary" as const,
    },
    {
      label: "Won deals",
      value: wonDeals.length.toLocaleString(),
      detail: formatMoney(
        wonDeals.reduce((sum, deal) => sum + deal.valueCents, 0),
      ),
      icon: Trophy,
      tab: "deals" as CrmTab,
      tone: "success" as const,
    },
    {
      label: "Lost deals",
      value: lostDeals.length.toLocaleString(),
      detail: "Visible reasons improve forecasting",
      icon: XCircle,
      tab: "deals" as CrmTab,
      tone: "danger" as const,
    },
    {
      label: "Revenue",
      value: formatRevenue(revenue, data.currency),
      detail: "Confirmed payment orders",
      icon: CircleDollarSign,
      tab: "reports" as CrmTab,
      tone: "success" as const,
    },
    {
      label: "Upcoming tasks",
      value: upcomingTasks.length.toLocaleString(),
      detail: `${upcomingTasks.filter((task) => task.priority === "urgent").length} urgent`,
      icon: ListTodo,
      tab: "tasks" as CrmTab,
      tone: "warning" as const,
    },
    {
      label: "Today's meetings",
      value: todayMeetings.length.toLocaleString(),
      detail: "Events and meetings due today",
      icon: CalendarDays,
      tab: "calendar" as CrmTab,
      tone: "primary" as const,
    },
    {
      label: "Recent activity",
      value: recentActivity.length.toLocaleString(),
      detail: "Last seven days",
      icon: Activity,
      tab: "activities" as CrmTab,
      tone: "primary" as const,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {metrics.map((metric) => (
          <MetricCard
            key={metric.label}
            {...metric}
            onClick={() => onNavigate(metric.tab)}
          />
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,.85fr)]">
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-[15px] font-semibold">Sales pipeline</h2>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Live deal volume and value by stage.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onNavigate("deals")}
            >
              Open deals
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
          {stages.length ? (
            <div className="mt-6 space-y-4">
              {stages.map((stage) => {
                const deals = data.deals.filter(
                  (deal) => deal.stageId === stage.id,
                );
                return (
                  <button
                    type="button"
                    key={stage.id}
                    onClick={() => onNavigate("deals")}
                    className="group block w-full text-left"
                  >
                    <div className="flex items-center justify-between gap-4 text-[11px]">
                      <span className="flex items-center gap-2 font-medium">
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: stage.color }}
                        />
                        {stage.name}
                      </span>
                      <span className="text-muted-foreground">
                        {deals.length} ·{" "}
                        {formatMoney(
                          deals.reduce(
                            (sum, deal) => sum + deal.valueCents,
                            0,
                          ),
                        )}
                      </span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full transition-all group-hover:brightness-110"
                        style={{
                          backgroundColor: stage.color,
                          width: `${Math.max(
                            deals.length ? 8 : 0,
                            (deals.length / maxStageCount) * 100,
                          )}%`,
                        }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <EmptyPanel
              icon={GitBranch}
              title="No pipeline stages"
              description="Create a pipeline to begin tracking opportunities."
            />
          )}
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <div>
            <h2 className="text-[15px] font-semibold">Revenue over time</h2>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Confirmed payments, not manually-entered estimates.
            </p>
          </div>
          {data.revenue.length ? (
            <div className="mt-6 flex h-[215px] items-end gap-2">
              {data.revenue.map((point) => (
                <div
                  key={point.period}
                  className="flex min-w-0 flex-1 flex-col items-center justify-end gap-2"
                >
                  <span className="text-[9px] font-medium text-muted-foreground">
                    {formatRevenue(point.revenue, data.currency)}
                  </span>
                  <div
                    className="w-full min-w-3 rounded-t-md bg-primary/80 transition-colors hover:bg-primary"
                    style={{
                      height: `${Math.max(
                        8,
                        (point.revenue / maxRevenue) * 150,
                      )}px`,
                    }}
                    title={`${point.period}: ${formatRevenue(
                      point.revenue,
                      data.currency,
                    )}`}
                  />
                  <span className="truncate text-[9px] text-muted-foreground">
                    {new Date(`${point.period}-01`).toLocaleDateString(
                      undefined,
                      { month: "short" },
                    )}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyPanel
              icon={CircleDollarSign}
              title="No confirmed revenue yet"
              description="Paid orders will appear here automatically."
            />
          )}
        </section>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-[15px] font-semibold">Lead sources</h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Attribution comes from the originating record.
          </p>
          {sourceCounts.length ? (
            <div className="mt-5 space-y-3">
              {sourceCounts.map(([source, count]) => (
                <div
                  key={source}
                  className="flex items-center justify-between gap-4 border-b border-border pb-3 last:border-0"
                >
                  <span className="text-[12px] font-medium">{source}</span>
                  <span className="rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground">
                    {count} lead{count === 1 ? "" : "s"}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-8 text-[12px] text-muted-foreground">
              Sources appear after the first lead is captured.
            </p>
          )}
        </section>
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-[15px] font-semibold">Conversion health</h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Lead → contact → deal → won, from the same records.
          </p>
          <div className="mt-6 grid grid-cols-4 gap-2">
            {[
              ["Leads", data.leads.length],
              [
                "Converted",
                data.leads.filter((lead) => lead.convertedContactId).length,
              ],
              ["Deals", data.deals.length],
              ["Won", wonDeals.length],
            ].map(([label, value], index) => (
              <div key={String(label)} className="relative text-center">
                <span className="flex h-16 items-center justify-center rounded-lg bg-muted/50 text-[20px] font-semibold">
                  {value}
                </span>
                <p className="mt-2 text-[9px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  {label}
                </p>
                {index < 3 ? (
                  <ArrowRight className="absolute -right-2.5 top-6 z-10 h-3 w-3 text-muted-foreground" />
                ) : null}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function CompaniesPanel({
  companies,
  onCreate,
  onFollowUp,
  onOpen,
}: {
  companies: CrmCompany[];
  onCreate: () => void;
  onFollowUp: (companies: CrmCompany[]) => void;
  onOpen: (company: CrmCompany) => void;
}) {
  const [search, setSearch] = useState("");
  const [industry, setIndustry] = useState("all");
  const industries = Array.from(
    new Set(companies.map((company) => company.industry).filter(Boolean)),
  ).sort();
  const visible = companies.filter(
    (company) =>
      (industry === "all" || company.industry === industry) &&
      `${company.name} ${company.industry} ${company.website}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const selection = useTableSelection(visible.map((company) => company.id));
  const selected = visible.filter((company) =>
    selection.selectedVisibleIds.includes(company.id),
  );
  const pagination = useTablePagination(
    visible,
    10,
    `${search}:${industry}`,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <TableFilterBar className="min-w-0 flex-1">
          <TableSearchField
            value={search}
            onValueChange={setSearch}
            placeholder="Search companies"
            aria-label="Search companies"
          />
          <TableFilterSelect
            value={industry}
            onValueChange={setIndustry}
            label="Filter companies by industry"
            options={[
              { value: "all", label: "All industries" },
              ...industries.map((value) => ({ value, label: value })),
            ]}
          />
        </TableFilterBar>
        <Button type="button" onClick={onCreate}>
          <Plus className="h-4 w-4" />
          New company
        </Button>
      </div>
      <TableSelectionBar
        totalCount={visible.length}
        selectedCount={selection.selectedVisibleIds.length}
        allSelected={selection.allSelected}
        partiallySelected={selection.partiallySelected}
        onToggleAll={selection.toggleAll}
        onClear={selection.clearSelection}
        itemLabel="companies"
      >
        <TableBulkActions
          actions={[
            {
              key: "follow-up",
              label: "Create follow-up tasks",
              icon: <ListTodo className="h-3.5 w-3.5" />,
              onSelect: () => onFollowUp(selected),
            },
            {
              key: "export",
              label: "Export selected",
              icon: <Download className="h-3.5 w-3.5" />,
              separatorBefore: true,
              onSelect: () =>
                downloadCsvFile(
                  "maxform-crm-companies.csv",
                  [
                    "Company",
                    "Industry",
                    "Website",
                    "Contacts",
                    "Deals",
                    "Pipeline value",
                  ],
                  selected.map((company) => [
                    company.name,
                    company.industry,
                    company.website,
                    company.contactCount,
                    company.dealCount,
                    company.activeDealValueCents / 100,
                  ]),
                ),
            },
          ]}
        />
      </TableSelectionBar>
      {visible.length ? (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="hidden grid-cols-[40px_minmax(220px,1.5fr)_minmax(130px,.8fr)_90px_90px_140px_36px] items-center gap-3 border-b border-border bg-muted/30 px-4 py-3 text-[9px] font-semibold uppercase tracking-[0.08em] text-muted-foreground md:grid">
            <span />
            <span>Company</span>
            <span>Industry</span>
            <span>Contacts</span>
            <span>Deals</span>
            <span>Pipeline value</span>
            <span />
          </div>
          <div className="divide-y divide-border">
            {pagination.pageItems.map((company) => (
              <div
                key={company.id}
                className="grid grid-cols-[40px_minmax(0,1fr)_36px] items-center gap-3 px-4 py-4 hover:bg-muted/25 md:grid-cols-[40px_minmax(220px,1.5fr)_minmax(130px,.8fr)_90px_90px_140px_36px]"
              >
                <TableRowSelect
                  checked={selection.isSelected(company.id)}
                  onCheckedChange={(checked) =>
                    selection.toggle(company.id, checked)
                  }
                  label={`Select ${company.name}`}
                  className="-ml-2"
                />
                <button
                  type="button"
                  onClick={() => onOpen(company)}
                  className="min-w-0 text-left"
                >
                  <span className="block truncate text-[13px] font-semibold">
                    {company.name}
                  </span>
                  <span className="mt-1 block truncate text-[10px] text-muted-foreground">
                    {company.website || "No website"}
                  </span>
                </button>
                <span className="hidden truncate text-[11px] text-muted-foreground md:block">
                  {company.industry || "Not set"}
                </span>
                <span className="hidden text-[12px] font-medium md:block">
                  {company.contactCount}
                </span>
                <span className="hidden text-[12px] font-medium md:block">
                  {company.dealCount}
                </span>
                <span className="hidden text-[12px] font-semibold md:block">
                  {formatMoney(company.activeDealValueCents)}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => onOpen(company)}
                  aria-label={`Open ${company.name}`}
                >
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <EmptyPanel
          icon={Building2}
          title={companies.length ? "No matching companies" : "No companies yet"}
          description={
            companies.length
              ? "Change the search or industry filter."
              : "Create an account record to roll up its contacts, deals, activity, documents, and files."
          }
          action={
            companies.length ? undefined : (
              <Button type="button" onClick={onCreate}>
                <Plus className="h-4 w-4" />
                Create company
              </Button>
            )
          }
        />
      )}
      <TablePagination
        page={pagination.page}
        pageCount={pagination.pageCount}
        pageSize={pagination.pageSize}
        totalCount={pagination.totalCount}
        onPageChange={pagination.setPage}
        itemLabel="companies"
      />
    </div>
  );
}

function LeadCard({
  lead,
  onConvert,
  onStatus,
}: {
  lead: CrmLead;
  onConvert: (lead: CrmLead, target: "contact" | "company" | "deal") => void;
  onStatus: (lead: CrmLead, status: CrmLeadStatus) => void;
}) {
  return (
    <article
      draggable
      onDragStart={(event) => event.dataTransfer.setData("lead-id", lead.id)}
      className="rounded-xl border border-border bg-card p-3 shadow-xs transition-shadow hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[12px] font-semibold">
            {lead.name || lead.email || "Unnamed lead"}
          </p>
          <p className="mt-1 truncate text-[10px] text-muted-foreground">
            {lead.companyName || lead.sourceLabel || titleCase(lead.sourceType)}
          </p>
          {lead.companyName ? (
            <p className="mt-1 truncate text-[9px] text-muted-foreground">
              Source: {lead.sourceLabel || titleCase(lead.sourceType)}
            </p>
          ) : null}
        </div>
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
            lead.score >= 70
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : lead.score >= 40
                ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                : "bg-muted text-muted-foreground",
          )}
          title={lead.scoreReasons.join(" · ")}
        >
          {lead.score}
        </span>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
        <span className="text-[9px] text-muted-foreground">
          {lead.budgetCents ? formatMoney(lead.budgetCents) : "Budget unknown"}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" size="icon" variant="ghost" className="h-7 w-7">
              <MoreHorizontal className="h-3.5 w-3.5" />
              <span className="sr-only">Lead actions</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {(["new", "contacted", "qualified", "unqualified"] as const).map(
              (status) => (
                <DropdownMenuItem
                  key={status}
                  onClick={() => onStatus(lead, status)}
                >
                  Mark {titleCase(status)}
                </DropdownMenuItem>
              ),
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onConvert(lead, "contact")}>
              Convert to contact
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onConvert(lead, "company")}>
              Convert to company
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onConvert(lead, "deal")}>
              Convert to deal
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </article>
  );
}

function LeadsPanel({
  leads,
  onBulkStatus,
  onCreate,
  onConvert,
  onStatus,
}: {
  leads: CrmLead[];
  onBulkStatus: (leads: CrmLead[], status: CrmLeadStatus) => void;
  onCreate: () => void;
  onConvert: (lead: CrmLead, target: "contact" | "company" | "deal") => void;
  onStatus: (lead: CrmLead, status: CrmLeadStatus) => void;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [view, setView] = useState<"board" | "table">("board");
  const visible = leads.filter(
    (lead) =>
      (status === "all" || lead.status === status) &&
      `${lead.name} ${lead.email} ${lead.companyName} ${lead.sourceLabel}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const selection = useTableSelection(visible.map((lead) => lead.id));
  const selected = visible.filter((lead) =>
    selection.selectedVisibleIds.includes(lead.id),
  );
  const statuses: CrmLeadStatus[] = [
    "new",
    "contacted",
    "qualified",
    "unqualified",
  ];
  const pagination = useTablePagination(
    visible,
    10,
    `${search}:${status}`,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
        <TableFilterBar className="min-w-0 flex-1">
          <TableSearchField
            value={search}
            onValueChange={setSearch}
            placeholder="Search leads"
            aria-label="Search leads"
          />
          <TableFilterSelect
            value={status}
            onValueChange={setStatus}
            label="Filter leads by status"
            options={[
              { value: "all", label: "All statuses" },
              ...statuses.map((value) => ({
                value,
                label: titleCase(value),
              })),
              { value: "archived", label: "Archived" },
            ]}
          />
        </TableFilterBar>
        <div className="flex items-center gap-2">
          <div className="flex h-10 rounded-lg border border-border bg-card p-1">
            <Button
              type="button"
              size="icon"
              variant={view === "board" ? "secondary" : "ghost"}
              className="h-8 w-8"
              onClick={() => setView("board")}
              aria-label="Lead board view"
            >
              <Columns3 className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant={view === "table" ? "secondary" : "ghost"}
              className="h-8 w-8"
              onClick={() => setView("table")}
              aria-label="Lead table view"
            >
              <List className="h-3.5 w-3.5" />
            </Button>
          </div>
          <Button type="button" onClick={onCreate}>
            <Plus className="h-4 w-4" />
            New lead
          </Button>
        </div>
      </div>
      {view === "table" ? (
        <TableSelectionBar
          totalCount={visible.length}
          selectedCount={selection.selectedVisibleIds.length}
          allSelected={selection.allSelected}
          partiallySelected={selection.partiallySelected}
          onToggleAll={selection.toggleAll}
          onClear={selection.clearSelection}
          itemLabel="leads"
        >
          <TableBulkActions
            actions={[
              {
                key: "contacted",
                label: "Mark as contacted",
                icon: <Check className="h-3.5 w-3.5" />,
                onSelect: () => onBulkStatus(selected, "contacted"),
              },
              {
                key: "qualified",
                label: "Mark as qualified",
                icon: <Trophy className="h-3.5 w-3.5" />,
                onSelect: () => onBulkStatus(selected, "qualified"),
              },
              {
                key: "archive",
                label: "Archive leads",
                icon: <XCircle className="h-3.5 w-3.5" />,
                onSelect: () => onBulkStatus(selected, "archived"),
              },
              {
                key: "export",
                label: "Export selected",
                icon: <Download className="h-3.5 w-3.5" />,
                separatorBefore: true,
                onSelect: () =>
                  downloadCsvFile(
                    "maxform-crm-leads.csv",
                    ["Name", "Email", "Source", "Status", "Score", "Budget"],
                    selected.map((lead) => [
                      lead.name,
                      lead.email,
                      lead.sourceLabel || lead.sourceType,
                      lead.status,
                      lead.score,
                      lead.budgetCents / 100,
                    ]),
                  ),
              },
            ]}
          />
        </TableSelectionBar>
      ) : null}
      {visible.length ? (
        view === "board" ? (
          <div className="dashboard-scroll dashboard-scroll-x grid min-w-0 gap-3 overflow-x-auto pb-3 md:grid-cols-2 xl:grid-cols-4">
            {statuses.map((columnStatus) => {
              const column = visible.filter(
                (lead) => lead.status === columnStatus,
              );
              return (
                <section
                  key={columnStatus}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    const lead = leads.find(
                      (item) =>
                        item.id === event.dataTransfer.getData("lead-id"),
                    );
                    if (lead && lead.status !== columnStatus) {
                      onStatus(lead, columnStatus);
                    }
                  }}
                  className="min-w-[250px] rounded-xl border border-border bg-muted/20 p-3"
                >
                  <div className="flex items-center justify-between gap-3 px-1">
                    <h3 className="text-[11px] font-semibold">
                      {titleCase(columnStatus)}
                    </h3>
                    <span className="rounded-full bg-background px-2 py-0.5 text-[9px] text-muted-foreground">
                      {column.length}
                    </span>
                  </div>
                  <div className="mt-3 space-y-2">
                    {column.map((lead) => (
                      <LeadCard
                        key={lead.id}
                        lead={lead}
                        onConvert={onConvert}
                        onStatus={onStatus}
                      />
                    ))}
                    {!column.length ? (
                      <div className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-[10px] text-muted-foreground">
                        Drop a lead here
                      </div>
                    ) : null}
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="divide-y divide-border">
              {pagination.pageItems.map((lead) => (
                <div
                  key={lead.id}
                  className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-4 hover:bg-muted/25 md:grid-cols-[40px_minmax(180px,1fr)_minmax(150px,.8fr)_100px_80px_120px_40px]"
                >
                  <TableRowSelect
                    checked={selection.isSelected(lead.id)}
                    onCheckedChange={(checked) =>
                      selection.toggle(lead.id, checked)
                    }
                    label={`Select ${lead.name || lead.email}`}
                    className="-ml-2"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-[12px] font-semibold">
                      {lead.name || "Unnamed lead"}
                    </p>
                    <p className="mt-1 truncate text-[10px] text-muted-foreground">
                      {lead.email || lead.phone || "No contact details"}
                    </p>
                  </div>
                  <span className="hidden truncate text-[10px] text-muted-foreground md:block">
                    {lead.sourceLabel || titleCase(lead.sourceType)}
                  </span>
                  <Badge
                    variant="outline"
                    className="hidden w-fit text-[9px] capitalize md:inline-flex"
                  >
                    {titleCase(lead.status)}
                  </Badge>
                  <span className="hidden text-[12px] font-semibold md:block">
                    {lead.score}
                  </span>
                  <span className="hidden text-[11px] text-muted-foreground md:block">
                    {lead.budgetCents
                      ? formatMoney(lead.budgetCents)
                      : "Not set"}
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label="Lead actions"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => onConvert(lead, "contact")}
                      >
                        Convert to contact
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => onConvert(lead, "deal")}
                      >
                        Convert to deal
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
          </div>
        )
      ) : (
        <EmptyPanel
          icon={UserRoundSearch}
          title={leads.length ? "No matching leads" : "No leads yet"}
          description={
            leads.length
              ? "Change the search or status filter."
              : "Create a lead manually. Form, event, and campaign sources retain their real attribution when they create leads."
          }
          action={
            leads.length ? undefined : (
              <Button type="button" onClick={onCreate}>
                <Plus className="h-4 w-4" />
                Create lead
              </Button>
            )
          }
        />
      )}
      {view === "table" ? (
        <TablePagination
          page={pagination.page}
          pageCount={pagination.pageCount}
          pageSize={pagination.pageSize}
          totalCount={pagination.totalCount}
          onPageChange={pagination.setPage}
          itemLabel="leads"
        />
      ) : null}
    </div>
  );
}

function DealCard({
  deal,
  onOpen,
  stage,
}: {
  deal: CrmDeal;
  onOpen: (deal: CrmDeal) => void;
  stage: CrmPipelineStage;
}) {
  const enteredAt = new Date(deal.stageEnteredAt).getTime();
  const isStalled =
    Boolean(stage.staleAfterDays) &&
    Number.isFinite(enteredAt) &&
    Date.now() - enteredAt >
      Number(stage.staleAfterDays) * 24 * 60 * 60 * 1000;
  return (
    <button
      type="button"
      draggable
      onDragStart={(event) => event.dataTransfer.setData("deal-id", deal.id)}
      onClick={() => onOpen(deal)}
      className="block w-full rounded-xl border border-border bg-card p-3 text-left shadow-xs transition-all hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="line-clamp-2 text-[12px] font-semibold">{deal.name}</p>
        <span className="shrink-0 text-[12px] font-semibold">
          {formatMoney(deal.valueCents, deal.currency)}
        </span>
      </div>
      <p className="mt-2 truncate text-[10px] text-muted-foreground">
        {deal.companyName || deal.contactName || "No relationship linked"}
      </p>
      {isStalled ? (
        <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-1 text-[9px] font-medium text-amber-700 dark:text-amber-300">
          <Clock3 className="h-3 w-3" />
          Needs attention
        </span>
      ) : null}
      <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-[9px] text-muted-foreground">
        <span>
          {deal.probability}% probability
          {deal.probabilityPinned ? " · pinned" : ""}
        </span>
        <span>{formatDate(deal.expectedCloseDate)}</span>
      </div>
    </button>
  );
}

function DealsPanel({
  deals,
  onBulkStageChange,
  pipelines,
  onCreate,
  onOpen,
  onStageChange,
}: {
  deals: CrmDeal[];
  onBulkStageChange: (
    deals: CrmDeal[],
    stage: CrmPipelineStage,
  ) => void;
  pipelines: CrmPipeline[];
  onCreate: () => void;
  onOpen: (deal: CrmDeal) => void;
  onStageChange: (deal: CrmDeal, stage: CrmPipelineStage) => void;
}) {
  const [search, setSearch] = useState("");
  const [pipelineId, setPipelineId] = useState(
    pipelines.find((pipeline) => pipeline.isDefault)?.id ||
      pipelines[0]?.id ||
      "",
  );
  const [view, setView] = useState<"board" | "list" | "calendar">("board");
  useEffect(() => {
    if (!pipelineId && pipelines[0]) setPipelineId(pipelines[0].id);
  }, [pipelineId, pipelines]);
  const pipeline =
    pipelines.find((item) => item.id === pipelineId) || pipelines[0];
  const visible = deals.filter(
    (deal) =>
      (!pipeline?.id || deal.pipelineId === pipeline.id) &&
      `${deal.name} ${deal.contactName} ${deal.companyName}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const selection = useTableSelection(visible.map((deal) => deal.id));
  const selected = visible.filter((deal) =>
    selection.selectedVisibleIds.includes(deal.id),
  );
  const pagination = useTablePagination(
    visible,
    10,
    `${search}:${pipeline?.id || ""}`,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
        <TableFilterBar className="min-w-0 flex-1">
          <TableSearchField
            value={search}
            onValueChange={setSearch}
            placeholder="Search deals"
            aria-label="Search deals"
          />
          <TableFilterSelect
            value={pipeline?.id || ""}
            onValueChange={setPipelineId}
            label="Filter deals by pipeline"
            options={pipelines.map((item) => ({
              value: item.id,
              label: item.name,
            }))}
          />
        </TableFilterBar>
        <div className="flex items-center gap-2">
          <div className="flex h-10 rounded-lg border border-border bg-card p-1">
            {[
              ["board", Columns3],
              ["list", List],
              ["calendar", CalendarDays],
            ].map(([key, Icon]) => (
              <Button
                key={String(key)}
                type="button"
                size="icon"
                variant={view === key ? "secondary" : "ghost"}
                className="h-8 w-8"
                onClick={() =>
                  setView(key as "board" | "list" | "calendar")
                }
                aria-label={`Deal ${key} view`}
              >
                <Icon className="h-3.5 w-3.5" />
              </Button>
            ))}
          </div>
          <Button type="button" onClick={onCreate}>
            <Plus className="h-4 w-4" />
            New deal
          </Button>
        </div>
      </div>
      {view === "list" ? (
        <TableSelectionBar
          totalCount={visible.length}
          selectedCount={selection.selectedVisibleIds.length}
          allSelected={selection.allSelected}
          partiallySelected={selection.partiallySelected}
          onToggleAll={selection.toggleAll}
          onClear={selection.clearSelection}
          itemLabel="deals"
        >
          <TableBulkActions
            actions={[
              ...(pipeline?.stages || [])
                .filter((stage) => !stage.isLost)
                .map((stage) => ({
                  key: `stage-${stage.id}`,
                  label: `Move to ${stage.name}`,
                  icon: (
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: stage.color }}
                    />
                  ),
                  onSelect: () => onBulkStageChange(selected, stage),
                })),
              {
                key: "export",
                label: "Export selected",
                icon: <Download className="h-3.5 w-3.5" />,
                separatorBefore: true,
                onSelect: () =>
                  downloadCsvFile(
                    "maxform-crm-deals.csv",
                    [
                      "Deal",
                      "Contact",
                      "Company",
                      "Pipeline",
                      "Stage",
                      "Value",
                      "Probability",
                      "Expected close",
                    ],
                    selected.map((deal) => [
                      deal.name,
                      deal.contactName,
                      deal.companyName,
                      deal.pipelineName,
                      deal.stageName,
                      deal.valueCents / 100,
                      deal.probability,
                      deal.expectedCloseDate,
                    ]),
                  ),
              },
            ]}
          />
        </TableSelectionBar>
      ) : null}
      {!visible.length ? (
        <EmptyPanel
          icon={Handshake}
          title={deals.length ? "No matching deals" : "No deals yet"}
          description={
            deals.length
              ? "Change the search or pipeline."
              : "Create an opportunity or convert a qualified lead into a deal."
          }
          action={
            deals.length ? undefined : (
              <Button type="button" onClick={onCreate}>
                <Plus className="h-4 w-4" />
                Create deal
              </Button>
            )
          }
        />
      ) : view === "board" && pipeline ? (
        <div className="dashboard-scroll dashboard-scroll-x flex gap-3 overflow-x-auto pb-3">
          {pipeline.stages.map((stage) => {
            const stageDeals = visible.filter(
              (deal) => deal.stageId === stage.id,
            );
            return (
              <section
                key={stage.id}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  const deal = deals.find(
                    (item) =>
                      item.id === event.dataTransfer.getData("deal-id"),
                  );
                  if (deal && deal.stageId !== stage.id) {
                    onStageChange(deal, stage);
                  }
                }}
                className="w-[270px] shrink-0 rounded-xl border border-border bg-muted/20 p-3"
              >
                <div className="flex items-start justify-between gap-3 px-1">
                  <div>
                    <p className="flex items-center gap-2 text-[11px] font-semibold">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: stage.color }}
                      />
                      {stage.name}
                    </p>
                    <p className="mt-1 text-[9px] text-muted-foreground">
                      {formatMoney(
                        stageDeals.reduce(
                          (sum, deal) => sum + deal.valueCents,
                          0,
                        ),
                      )}
                    </p>
                  </div>
                  <span className="rounded-full bg-background px-2 py-0.5 text-[9px] text-muted-foreground">
                    {stageDeals.length}
                  </span>
                </div>
                <div className="mt-3 space-y-2">
                  {stageDeals.map((deal) => (
                    <DealCard
                      key={deal.id}
                      deal={deal}
                      onOpen={onOpen}
                      stage={stage}
                    />
                  ))}
                  {!stageDeals.length ? (
                    <div className="rounded-lg border border-dashed border-border py-8 text-center text-[10px] text-muted-foreground">
                      Drop a deal here
                    </div>
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>
      ) : view === "calendar" ? (
        <PaginatedCardGrid
          items={visible
            .filter((deal) => deal.expectedCloseDate)
            .sort((left, right) =>
              String(left.expectedCloseDate).localeCompare(
                String(right.expectedCloseDate),
              ),
            )}
          pageSize={12}
          itemLabel="deals"
          getKey={(deal) => deal.id}
          renderItem={(deal) => (
              <button
                type="button"
                onClick={() => onOpen(deal)}
                className="rounded-xl border border-border bg-card p-4 text-left hover:border-primary/30"
              >
                <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  {formatDate(deal.expectedCloseDate)}
                </p>
                <p className="mt-3 text-[13px] font-semibold">{deal.name}</p>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <Badge variant="outline" className="text-[9px]">
                    {deal.stageName}
                  </Badge>
                  <span className="text-[12px] font-semibold">
                    {formatMoney(deal.valueCents, deal.currency)}
                  </span>
                </div>
              </button>
            )}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="divide-y divide-border">
            {pagination.pageItems.map((deal) => (
              <div
                key={deal.id}
                className="grid grid-cols-[40px_minmax(0,1fr)_36px] items-center gap-3 px-4 py-4 hover:bg-muted/25 md:grid-cols-[40px_minmax(200px,1fr)_150px_120px_120px_120px_36px]"
              >
                <TableRowSelect
                  checked={selection.isSelected(deal.id)}
                  onCheckedChange={(checked) =>
                    selection.toggle(deal.id, checked)
                  }
                  label={`Select ${deal.name}`}
                  className="-ml-2"
                />
                <button
                  type="button"
                  onClick={() => onOpen(deal)}
                  className="min-w-0 text-left"
                >
                  <p className="truncate text-[12px] font-semibold">
                    {deal.name}
                  </p>
                  <p className="mt-1 truncate text-[10px] text-muted-foreground">
                    {deal.companyName || deal.contactName || "Unlinked"}
                  </p>
                </button>
                <span className="hidden text-[11px] text-muted-foreground md:block">
                  {deal.stageName}
                </span>
                <span className="hidden text-[12px] font-semibold md:block">
                  {formatMoney(deal.valueCents, deal.currency)}
                </span>
                <span className="hidden text-[11px] text-muted-foreground md:block">
                  {deal.probability}%
                </span>
                <span className="hidden text-[10px] text-muted-foreground md:block">
                  {formatDate(deal.expectedCloseDate)}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => onOpen(deal)}
                  aria-label={`Open ${deal.name}`}
                >
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
      {view === "list" ? (
        <TablePagination
          page={pagination.page}
          pageCount={pagination.pageCount}
          pageSize={pagination.pageSize}
          totalCount={pagination.totalCount}
          onPageChange={pagination.setPage}
          itemLabel="deals"
        />
      ) : null}
    </div>
  );
}

const stageRequiredFieldOptions = [
  { key: "value", label: "Deal value" },
  { key: "expected_close_date", label: "Expected close date" },
  { key: "contact", label: "Linked contact" },
  { key: "company", label: "Linked company" },
  { key: "order", label: "Linked order or invoice" },
  { key: "lost_reason", label: "Lost reason" },
];

type PipelineStageDraft = {
  name: string;
  probability: number;
  color: string;
  isWon: boolean;
  isLost: boolean;
  requiredFields: string[];
  staleAfterDays: number | null;
};

function PipelineEditorDialog({
  onOpenChange,
  onSave,
  open,
  pipeline,
  working,
}: {
  onOpenChange: (open: boolean) => void;
  onSave: (input: {
    name: string;
    description: string;
    color: string;
    makeDefault: boolean;
  }) => void;
  open: boolean;
  pipeline: CrmPipeline | null;
  working: boolean;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#635BFF");
  const [makeDefault, setMakeDefault] = useState(false);

  useEffect(() => {
    if (!open || !pipeline) return;
    setName(pipeline.name);
    setDescription(pipeline.description);
    setColor(pipeline.color);
    setMakeDefault(pipeline.isDefault);
  }, [open, pipeline]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit pipeline</DialogTitle>
          <DialogDescription>
            Update how this pipeline appears and which pipeline new
            opportunities use by default.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2 sm:grid-cols-2">
          <Field
            label="Pipeline name"
            value={name}
            onChange={setName}
            placeholder="Partnerships"
          />
          <div className="space-y-2">
            <Label htmlFor="crm-edit-pipeline-color">Pipeline color</Label>
            <div className="flex items-center gap-2">
              <Input
                id="crm-edit-pipeline-color"
                type="color"
                value={color}
                onChange={(event) => setColor(event.target.value)}
                className="h-10 w-14 cursor-pointer p-1"
              />
              <Input
                value={color}
                onChange={(event) => setColor(event.target.value)}
                aria-label="Edit pipeline color value"
              />
            </div>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="crm-edit-pipeline-description">Description</Label>
            <Textarea
              id="crm-edit-pipeline-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="How this relationship process works"
            />
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 sm:col-span-2">
            <Checkbox
              checked={makeDefault}
              disabled={pipeline?.isDefault}
              onCheckedChange={(checked) => setMakeDefault(checked === true)}
            />
            <span>
              <span className="block text-[11px] font-medium">
                Default pipeline
              </span>
              <span className="mt-1 block text-[10px] leading-4 text-muted-foreground">
                New deals and lead conversions start here unless another
                pipeline is chosen.
              </span>
            </span>
          </label>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={working || !name.trim()}
            onClick={() =>
              onSave({ name, description, color, makeDefault })
            }
          >
            {working ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            Save pipeline
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PipelineStageDialog({
  onOpenChange,
  onSave,
  open,
  pipeline,
  stage,
  working,
}: {
  onOpenChange: (open: boolean) => void;
  onSave: (input: PipelineStageDraft) => void;
  open: boolean;
  pipeline: CrmPipeline | null;
  stage: CrmPipelineStage | null;
  working: boolean;
}) {
  const [draft, setDraft] = useState<PipelineStageDraft>({
    name: "",
    probability: 25,
    color: "#2563EB",
    isWon: false,
    isLost: false,
    requiredFields: [],
    staleAfterDays: null,
  });

  useEffect(() => {
    if (!open) return;
    setDraft(
      stage
        ? {
            name: stage.name,
            probability: stage.probability,
            color: stage.color,
            isWon: stage.isWon,
            isLost: stage.isLost,
            requiredFields: stage.requiredFields,
            staleAfterDays: stage.staleAfterDays,
          }
        : {
            name: "",
            probability: 25,
            color: pipeline?.color || "#2563EB",
            isWon: false,
            isLost: false,
            requiredFields: [],
            staleAfterDays: null,
          },
    );
  }, [open, pipeline?.color, stage]);

  const stageType = draft.isWon ? "won" : draft.isLost ? "lost" : "open";
  const setRequired = (key: string, checked: boolean) => {
    setDraft((current) => ({
      ...current,
      requiredFields: checked
        ? Array.from(new Set([...current.requiredFields, key]))
        : current.requiredFields.filter((field) => field !== key),
    }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dashboard-scroll max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{stage ? "Edit stage" : "Add stage"}</DialogTitle>
          <DialogDescription>
            Configure forecasting, entry requirements, and stalled-deal
            detection for {pipeline?.name || "this pipeline"}.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2 sm:grid-cols-2">
          <Field
            label="Stage name"
            value={draft.name}
            onChange={(name) =>
              setDraft((current) => ({ ...current, name }))
            }
            placeholder="Technical review"
          />
          <Field
            label="Default probability"
            type="number"
            value={String(draft.probability)}
            onChange={(value) =>
              setDraft((current) => ({
                ...current,
                probability: Math.max(0, Math.min(100, Number(value))),
              }))
            }
            placeholder="25"
          />
          <div className="space-y-2">
            <Label>Stage type</Label>
            <Select
              value={stageType}
              onValueChange={(value) =>
                setDraft((current) => ({
                  ...current,
                  isWon: value === "won",
                  isLost: value === "lost",
                  probability:
                    value === "won"
                      ? 100
                      : value === "lost"
                        ? 0
                        : current.probability,
                  requiredFields:
                    value === "lost" &&
                    !current.requiredFields.includes("lost_reason")
                      ? [...current.requiredFields, "lost_reason"]
                      : current.requiredFields,
                }))
              }
            >
              <SelectTrigger aria-label="Stage type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open stage</SelectItem>
                <SelectItem value="won">Won stage</SelectItem>
                <SelectItem value="lost">Lost stage</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="crm-stage-color">Stage color</Label>
            <div className="flex items-center gap-2">
              <Input
                id="crm-stage-color"
                type="color"
                value={draft.color}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    color: event.target.value,
                  }))
                }
                className="h-10 w-14 cursor-pointer p-1"
              />
              <Input
                value={draft.color}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    color: event.target.value,
                  }))
                }
                aria-label="Stage color value"
              />
            </div>
          </div>
          <Field
            label="Stale after days"
            type="number"
            value={
              draft.staleAfterDays == null
                ? ""
                : String(draft.staleAfterDays)
            }
            onChange={(value) =>
              setDraft((current) => ({
                ...current,
                staleAfterDays: value
                  ? Math.max(1, Math.round(Number(value)))
                  : null,
              }))
            }
            placeholder="Adaptive"
          />
          <div className="space-y-3 sm:col-span-2">
            <div>
              <Label>Required before entering this stage</Label>
              <p className="mt-1 text-[10px] text-muted-foreground">
                A move is blocked with a clear message until every selected
                field is present.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {stageRequiredFieldOptions.map((option) => (
                <label
                  key={option.key}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2.5 text-[10px]"
                >
                  <Checkbox
                    checked={draft.requiredFields.includes(option.key)}
                    disabled={draft.isLost && option.key === "lost_reason"}
                    onCheckedChange={(checked) =>
                      setRequired(option.key, checked === true)
                    }
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={working || !draft.name.trim()}
            onClick={() => onSave(draft)}
          >
            {working ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : stage ? (
              <Check className="h-4 w-4" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            {stage ? "Save stage" : "Add stage"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeletePipelineDialog({
  dealCount,
  onConfirm,
  onOpenChange,
  open,
  pipeline,
  working,
}: {
  dealCount: number;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  pipeline: CrmPipeline | null;
  working: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete {pipeline?.name || "pipeline"}?</DialogTitle>
          <DialogDescription>
            {dealCount
              ? `This pipeline has ${dealCount} deal${dealCount === 1 ? "" : "s"}. It cannot be deleted until those deals are archived or closed elsewhere.`
              : "The pipeline and its empty stages will be permanently removed. CRM records outside this pipeline are not affected."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={working || dealCount > 0}
            onClick={onConfirm}
          >
            {working ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            Delete pipeline
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteStageDialog({
  dealCount,
  onConfirm,
  onOpenChange,
  open,
  pipeline,
  stage,
  working,
}: {
  dealCount: number;
  onConfirm: (reassignStageId?: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  pipeline: CrmPipeline | null;
  stage: CrmPipelineStage | null;
  working: boolean;
}) {
  const replacements = (pipeline?.stages || []).filter(
    (item) => item.id !== stage?.id && !item.isWon && !item.isLost,
  );
  const [replacementId, setReplacementId] = useState("");
  useEffect(() => {
    if (!open) return;
    setReplacementId(
      (pipeline?.stages || []).find(
        (item) => item.id !== stage?.id && !item.isWon && !item.isLost,
      )?.id || "",
    );
  }, [open, pipeline, stage?.id]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete {stage?.name || "stage"}?</DialogTitle>
          <DialogDescription>
            {dealCount
              ? `Reassign the ${dealCount} deal${dealCount === 1 ? "" : "s"} in this stage before it is removed. Stage history is preserved.`
              : "This empty stage will be removed. No deals or CRM records will be deleted."}
          </DialogDescription>
        </DialogHeader>
        {dealCount ? (
          <div className="space-y-2">
            <Label>Move deals to</Label>
            <Select value={replacementId} onValueChange={setReplacementId}>
              <SelectTrigger aria-label="Replacement stage">
                <SelectValue placeholder="Choose a stage" />
              </SelectTrigger>
              <SelectContent>
                {replacements.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!replacements.length ? (
              <p className="text-[10px] text-destructive">
                Add another stage before removing the only stage that contains
                deals.
              </p>
            ) : null}
          </div>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={
              working || (dealCount > 0 && (!replacementId || !replacements.length))
            }
            onClick={() => onConfirm(replacementId || undefined)}
          >
            {working ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            {dealCount ? "Reassign and delete" : "Delete stage"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PipelinesPanel({
  deals,
  pipelines,
  onCreate,
  onCreateStage,
  onDeletePipeline,
  onDeleteStage,
  onEditPipeline,
  onEditStage,
  onMoveStage,
}: {
  deals: CrmDeal[];
  pipelines: CrmPipeline[];
  onCreate: () => void;
  onCreateStage: (pipeline: CrmPipeline) => void;
  onDeletePipeline: (pipeline: CrmPipeline) => void;
  onDeleteStage: (pipeline: CrmPipeline, stage: CrmPipelineStage) => void;
  onEditPipeline: (pipeline: CrmPipeline) => void;
  onEditStage: (pipeline: CrmPipeline, stage: CrmPipelineStage) => void;
  onMoveStage: (
    pipeline: CrmPipeline,
    stage: CrmPipelineStage,
    direction: -1 | 1,
  ) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-[18px] font-semibold">Multiple pipelines</h2>
          <p className="mt-1 max-w-2xl text-[12px] text-muted-foreground">
            Sales, partnerships, sponsorships, recruiting, or any process your
            workspace needs, each with its own stages.
          </p>
        </div>
        <Button type="button" onClick={onCreate}>
          <Plus className="h-4 w-4" />
          New pipeline
        </Button>
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        {pipelines.map((pipeline) => {
          const pipelineDeals = deals.filter(
            (deal) => deal.pipelineId === pipeline.id,
          );
          return (
            <article
              key={pipeline.id}
              className="rounded-xl border border-border bg-card p-5"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: pipeline.color }}
                    />
                    <h3 className="text-[15px] font-semibold">
                      {pipeline.name}
                    </h3>
                    {pipeline.isDefault ? (
                      <Badge variant="outline" className="text-[9px]">
                        Default
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {pipeline.description || "Custom relationship pipeline"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => onCreateStage(pipeline)}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add stage
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={`Manage ${pipeline.name} pipeline`}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuItem
                        onClick={() => onEditPipeline(pipeline)}
                      >
                        <Pencil className="h-4 w-4" />
                        Edit pipeline
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => onDeletePipeline(pipeline)}
                      >
                        <Trash2 className="h-4 w-4" />
                        Delete pipeline
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
              <div className="mt-5 space-y-2">
                {pipeline.stages.map((stage) => {
                  const stageDeals = pipelineDeals.filter(
                    (deal) => deal.stageId === stage.id,
                  );
                  return (
                    <div
                      key={stage.id}
                      className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border/70 px-3 py-3"
                    >
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: stage.color }}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-[11px] font-medium">
                          {stage.name}
                        </p>
                        <p className="mt-0.5 text-[9px] text-muted-foreground">
                          {stage.probability}% default probability
                          {stage.isWon
                            ? " · Won"
                            : stage.isLost
                              ? " · Lost"
                              : ""}
                          {stage.requiredFields.length
                            ? ` · ${stage.requiredFields.length} required`
                            : ""}
                          {stage.staleAfterDays
                            ? ` · stale after ${stage.staleAfterDays}d`
                            : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="hidden text-right sm:block">
                          <p className="text-[10px] text-muted-foreground">
                            {stageDeals.length} deal
                            {stageDeals.length === 1 ? "" : "s"}
                          </p>
                          <p className="text-[11px] font-semibold">
                            {formatMoney(
                              stageDeals.reduce(
                                (sum, deal) => sum + deal.valueCents,
                                0,
                              ),
                            )}
                          </p>
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              aria-label={`Manage ${stage.name} stage`}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            <DropdownMenuItem
                              onClick={() => onEditStage(pipeline, stage)}
                            >
                              <Pencil className="h-4 w-4" />
                              Edit stage
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={stage.orderIndex === 0}
                              onClick={() =>
                                onMoveStage(pipeline, stage, -1)
                              }
                            >
                              <ArrowUp className="h-4 w-4" />
                              Move earlier
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={
                                stage.orderIndex ===
                                pipeline.stages.length - 1
                              }
                              onClick={() =>
                                onMoveStage(pipeline, stage, 1)
                              }
                            >
                              <ArrowDown className="h-4 w-4" />
                              Move later
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => onDeleteStage(pipeline, stage)}
                            >
                              <Trash2 className="h-4 w-4" />
                              Delete stage
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  );
                })}
                {!pipeline.stages.length ? (
                  <button
                    type="button"
                    onClick={() => onCreateStage(pipeline)}
                    className="flex w-full flex-col items-center justify-center rounded-lg border border-dashed border-border px-4 py-8 text-center transition-colors hover:border-primary/40 hover:bg-primary/2.5"
                  >
                    <Plus className="h-5 w-5 text-primary" />
                    <span className="mt-2 text-[11px] font-medium">
                      Add the first stage
                    </span>
                    <span className="mt-1 text-[9px] text-muted-foreground">
                      New pipelines stay empty until you define the process.
                    </span>
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function ActivitiesPanel({
  activities,
  onFollowUp,
}: {
  activities: CrmActivity[];
  onFollowUp: (activities: CrmActivity[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const types = Array.from(
    new Set(activities.map((activity) => activity.activityType)),
  ).sort();
  const visible = activities.filter(
    (activity) =>
      (type === "all" || activity.activityType === type) &&
      `${activity.title} ${activity.detail} ${activity.contactName} ${activity.companyName} ${activity.dealName}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const selection = useTableSelection(visible.map((activity) => activity.id));
  const selected = visible.filter((activity) =>
    selection.selectedVisibleIds.includes(activity.id),
  );
  const pagination = useTablePagination(visible, 10, `${search}:${type}`);
  return (
    <div className="space-y-4">
      <TableFilterBar>
        <TableSearchField
          value={search}
          onValueChange={setSearch}
          placeholder="Search the unified activity timeline"
          aria-label="Search CRM activities"
        />
        <TableFilterSelect
          value={type}
          onValueChange={setType}
          label="Filter CRM activities by type"
          options={[
            { value: "all", label: "All activity" },
            ...types.map((value) => ({
              value,
              label: titleCase(value),
            })),
          ]}
        />
      </TableFilterBar>
      <TableSelectionBar
        totalCount={visible.length}
        selectedCount={selection.selectedVisibleIds.length}
        allSelected={selection.allSelected}
        partiallySelected={selection.partiallySelected}
        onToggleAll={selection.toggleAll}
        onClear={selection.clearSelection}
        itemLabel="activities"
      >
        <TableBulkActions
          actions={[
            {
              key: "follow-up",
              label: "Create follow-up tasks",
              icon: <ListTodo className="h-3.5 w-3.5" />,
              onSelect: () => onFollowUp(selected),
            },
            {
              key: "export",
              label: "Export selected",
              icon: <Download className="h-3.5 w-3.5" />,
              separatorBefore: true,
              onSelect: () =>
                downloadCsvFile(
                  "maxform-crm-activities.csv",
                  ["Activity", "Detail", "Contact", "Company", "Deal", "Date"],
                  selected.map((activity) => [
                    activity.title,
                    activity.detail,
                    activity.contactName,
                    activity.companyName,
                    activity.dealName,
                    activity.createdAt,
                  ]),
                ),
            },
          ]}
        />
      </TableSelectionBar>
      {visible.length ? (
        <div className="rounded-xl border border-border bg-card px-4">
          {pagination.pageItems.map((activity) => (
            <div
              key={activity.id}
              className="grid grid-cols-[40px_32px_minmax(0,1fr)] gap-3 border-b border-border py-4 last:border-0 sm:grid-cols-[40px_32px_minmax(0,1fr)_auto]"
            >
              <TableRowSelect
                checked={selection.isSelected(activity.id)}
                onCheckedChange={(checked) =>
                  selection.toggle(activity.id, checked)
                }
                label={`Select ${activity.title}`}
                className="-ml-2"
              />
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Activity className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0">
                <p className="text-[12px] font-medium">{activity.title}</p>
                {activity.detail ? (
                  <p className="mt-1 text-[10px] leading-5 text-muted-foreground">
                    {activity.detail}
                  </p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-2 text-[9px] text-muted-foreground">
                  {activity.contactName ? (
                    <span>{activity.contactName}</span>
                  ) : null}
                  {activity.companyName ? (
                    <span>· {activity.companyName}</span>
                  ) : null}
                  {activity.dealName ? <span>· {activity.dealName}</span> : null}
                </div>
              </div>
              <span className="col-start-3 text-[9px] text-muted-foreground sm:col-start-auto">
                {formatDate(activity.createdAt, true)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <EmptyPanel
          icon={Activity}
          title={
            activities.length ? "No matching activity" : "No CRM activity yet"
          }
          description="Emails, calls, forms, events, documents, files, deal changes, and task completions appear in this one timeline."
        />
      )}
      <TablePagination
        page={pagination.page}
        pageCount={pagination.pageCount}
        pageSize={pagination.pageSize}
        totalCount={pagination.totalCount}
        onPageChange={pagination.setPage}
        itemLabel="activities"
      />
    </div>
  );
}

function TasksPanel({
  tasks,
  onBulkStatus,
  onCreate,
  onStatus,
}: {
  tasks: CrmTask[];
  onBulkStatus: (tasks: CrmTask[], status: CrmTaskStatus) => void;
  onCreate: () => void;
  onStatus: (task: CrmTask, status: CrmTaskStatus) => void;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [view, setView] = useState<"list" | "board" | "calendar">("list");
  const visible = tasks.filter(
    (task) =>
      (status === "all" || task.status === status) &&
      `${task.title} ${task.contactName} ${task.companyName} ${task.dealName}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const selection = useTableSelection(visible.map((task) => task.id));
  const selected = visible.filter((task) =>
    selection.selectedVisibleIds.includes(task.id),
  );
  const statuses: CrmTaskStatus[] = [
    "open",
    "in_progress",
    "completed",
    "cancelled",
  ];
  const pagination = useTablePagination(
    visible,
    10,
    `${search}:${status}`,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
        <TableFilterBar className="min-w-0 flex-1">
          <TableSearchField
            value={search}
            onValueChange={setSearch}
            placeholder="Search tasks and linked records"
            aria-label="Search CRM tasks"
          />
          <TableFilterSelect
            value={status}
            onValueChange={setStatus}
            label="Filter CRM tasks by status"
            options={[
              { value: "all", label: "All statuses" },
              ...statuses.map((value) => ({
                value,
                label: titleCase(value),
              })),
            ]}
          />
        </TableFilterBar>
        <div className="flex items-center gap-2">
          <div className="flex h-10 rounded-lg border border-border bg-card p-1">
            {[
              ["list", List],
              ["board", Columns3],
              ["calendar", CalendarDays],
            ].map(([key, Icon]) => (
              <Button
                key={String(key)}
                type="button"
                size="icon"
                variant={view === key ? "secondary" : "ghost"}
                className="h-8 w-8"
                onClick={() =>
                  setView(key as "list" | "board" | "calendar")
                }
                aria-label={`Task ${key} view`}
              >
                <Icon className="h-3.5 w-3.5" />
              </Button>
            ))}
          </div>
          <Button type="button" onClick={onCreate}>
            <Plus className="h-4 w-4" />
            New task
          </Button>
        </div>
      </div>
      {view === "list" ? (
        <TableSelectionBar
          totalCount={visible.length}
          selectedCount={selection.selectedVisibleIds.length}
          allSelected={selection.allSelected}
          partiallySelected={selection.partiallySelected}
          onToggleAll={selection.toggleAll}
          onClear={selection.clearSelection}
          itemLabel="tasks"
        >
          <TableBulkActions
            actions={[
              {
                key: "in-progress",
                label: "Mark in progress",
                icon: <Clock3 className="h-3.5 w-3.5" />,
                onSelect: () => onBulkStatus(selected, "in_progress"),
              },
              {
                key: "complete",
                label: "Mark completed",
                icon: <Check className="h-3.5 w-3.5" />,
                onSelect: () => onBulkStatus(selected, "completed"),
              },
              {
                key: "cancel",
                label: "Cancel selected",
                icon: <XCircle className="h-3.5 w-3.5" />,
                onSelect: () => onBulkStatus(selected, "cancelled"),
              },
              {
                key: "export",
                label: "Export selected",
                icon: <Download className="h-3.5 w-3.5" />,
                separatorBefore: true,
                onSelect: () =>
                  downloadCsvFile(
                    "maxform-crm-tasks.csv",
                    [
                      "Task",
                      "Status",
                      "Priority",
                      "Due date",
                      "Contact",
                      "Company",
                      "Deal",
                    ],
                    selected.map((task) => [
                      task.title,
                      task.status,
                      task.priority,
                      task.dueAt,
                      task.contactName,
                      task.companyName,
                      task.dealName,
                    ]),
                  ),
              },
            ]}
          />
        </TableSelectionBar>
      ) : null}
      {!visible.length ? (
        <EmptyPanel
          icon={ListTodo}
          title={tasks.length ? "No matching tasks" : "No tasks yet"}
          description="Tasks created from a contact, company, deal, or this screen are the same shared record."
          action={
            tasks.length ? undefined : (
              <Button type="button" onClick={onCreate}>
                <Plus className="h-4 w-4" />
                Create task
              </Button>
            )
          }
        />
      ) : view === "board" ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {statuses.map((columnStatus) => (
            <section
              key={columnStatus}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                const task = tasks.find(
                  (item) =>
                    item.id === event.dataTransfer.getData("task-id"),
                );
                if (task && task.status !== columnStatus) {
                  onStatus(task, columnStatus);
                }
              }}
              className="rounded-xl border border-border bg-muted/20 p-3"
            >
              <div className="flex items-center justify-between gap-3 px-1">
                <h3 className="text-[11px] font-semibold">
                  {titleCase(columnStatus)}
                </h3>
                <span className="text-[9px] text-muted-foreground">
                  {
                    visible.filter((task) => task.status === columnStatus)
                      .length
                  }
                </span>
              </div>
              <div className="mt-3 space-y-2">
                {visible
                  .filter((task) => task.status === columnStatus)
                  .map((task) => (
                    <article
                      key={task.id}
                      draggable
                      onDragStart={(event) =>
                        event.dataTransfer.setData("task-id", task.id)
                      }
                      className="rounded-lg border border-border bg-card p-3"
                    >
                      <p className="text-[11px] font-medium">{task.title}</p>
                      <p className="mt-2 truncate text-[9px] text-muted-foreground">
                        {task.dealName ||
                          task.contactName ||
                          task.companyName ||
                          "Standalone task"}
                      </p>
                      <div className="mt-3 flex items-center justify-between">
                        <Badge variant="outline" className="text-[8px]">
                          {titleCase(task.priority)}
                        </Badge>
                        <span className="text-[8px] text-muted-foreground">
                          {formatDate(task.dueAt)}
                        </span>
                      </div>
                    </article>
                  ))}
              </div>
            </section>
          ))}
        </div>
      ) : view === "calendar" ? (
        <PaginatedCardGrid
          items={visible
            .filter((task) => task.dueAt)
            .sort((left, right) =>
              String(left.dueAt).localeCompare(String(right.dueAt)),
            )}
          pageSize={12}
          itemLabel="tasks"
          getKey={(task) => task.id}
          renderItem={(task) => (
              <div
                className="rounded-xl border border-border bg-card p-4"
              >
                <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                  {formatDate(task.dueAt, true)}
                </p>
                <p className="mt-3 text-[12px] font-semibold">{task.title}</p>
                <p className="mt-2 text-[10px] text-muted-foreground">
                  {task.dealName || task.contactName || task.companyName}
                </p>
              </div>
            )}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="divide-y divide-border">
            {pagination.pageItems.map((task) => (
              <div
                key={task.id}
                className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-4 hover:bg-muted/25 md:grid-cols-[40px_minmax(220px,1fr)_130px_110px_150px_110px]"
              >
                <TableRowSelect
                  checked={selection.isSelected(task.id)}
                  onCheckedChange={(checked) =>
                    selection.toggle(task.id, checked)
                  }
                  label={`Select ${task.title}`}
                  className="-ml-2"
                />
                <div className="min-w-0">
                  <p
                    className={cn(
                      "truncate text-[12px] font-medium",
                      task.status === "completed" &&
                        "text-muted-foreground line-through",
                    )}
                  >
                    {task.title}
                  </p>
                  <p className="mt-1 truncate text-[10px] text-muted-foreground">
                    {task.dealName ||
                      task.contactName ||
                      task.companyName ||
                      "Standalone task"}
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className="hidden w-fit text-[9px] md:inline-flex"
                >
                  {titleCase(task.priority)}
                </Badge>
                <span className="hidden text-[10px] text-muted-foreground md:block">
                  {titleCase(task.status)}
                </span>
                <span className="hidden text-[10px] text-muted-foreground md:block">
                  {formatDate(task.dueAt, true)}
                </span>
                <Select
                  value={task.status}
                  onValueChange={(value) =>
                    onStatus(task, value as CrmTaskStatus)
                  }
                >
                  <SelectTrigger className="h-8 w-[110px] text-[10px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {statuses.map((value) => (
                      <SelectItem key={value} value={value}>
                        {titleCase(value)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        </div>
      )}
      {view === "list" ? (
        <TablePagination
          page={pagination.page}
          pageCount={pagination.pageCount}
          pageSize={pagination.pageSize}
          totalCount={pagination.totalCount}
          onPageChange={pagination.setPage}
          itemLabel="tasks"
        />
      ) : null}
    </div>
  );
}

function CalendarPanel({ data }: { data: CrmWorkspaceData }) {
  const [layers, setLayers] = useState({
    tasks: true,
    deals: true,
    events: true,
  });
  const items = [
    ...(layers.tasks
      ? data.tasks
          .filter((task) => task.dueAt && task.status !== "cancelled")
          .map((task) => ({
            id: `task-${task.id}`,
            date: task.dueAt!,
            title: task.title,
            detail: task.dealName || task.contactName || "CRM task",
            type: "Task",
            color: "bg-blue-500",
          }))
      : []),
    ...(layers.deals
      ? data.deals
          .filter((deal) => deal.expectedCloseDate && !deal.isLost)
          .map((deal) => ({
            id: `deal-${deal.id}`,
            date: deal.expectedCloseDate!,
            title: deal.name,
            detail: `${deal.stageName} · ${formatMoney(deal.valueCents, deal.currency)}`,
            type: "Deal close",
            color: "bg-violet-500",
          }))
      : []),
    ...(layers.events
      ? data.events.map((event) => ({
          id: `event-${event.id}`,
          date: event.startsAt,
          title: event.title,
          detail: titleCase(event.status),
          type: "Event",
          color: "bg-emerald-500",
        }))
      : []),
  ].sort((left, right) => left.date.localeCompare(right.date));
  const grouped = items.reduce((map, item) => {
    const key = new Date(item.date).toISOString().slice(0, 10);
    map.set(key, [...(map.get(key) || []), item]);
    return map;
  }, new Map<string, typeof items>());

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-[15px] font-semibold">Unified CRM calendar</h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            One chronological view for due work and relationship deadlines.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {[
            ["tasks", "Tasks", "bg-blue-500"],
            ["deals", "Deal closes", "bg-violet-500"],
            ["events", "Events", "bg-emerald-500"],
          ].map(([key, label, color]) => (
            <button
              key={key}
              type="button"
              onClick={() =>
                setLayers((current) => ({
                  ...current,
                  [key]: !current[key as keyof typeof current],
                }))
              }
              className={cn(
                "flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-medium transition-colors",
                layers[key as keyof typeof layers]
                  ? "border-foreground/20 bg-muted text-foreground"
                  : "border-border text-muted-foreground",
              )}
            >
              <span className={cn("h-2 w-2 rounded-full", color)} />
              {label}
            </button>
          ))}
        </div>
      </div>
      {grouped.size ? (
        <div className="space-y-4">
          {Array.from(grouped).map(([date, dateItems]) => (
            <section
              key={date}
              className="grid gap-3 rounded-xl border border-border bg-card p-4 md:grid-cols-[150px_minmax(0,1fr)]"
            >
              <div>
                <p className="text-[11px] font-semibold">
                  {new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
                    weekday: "long",
                  })}
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
              </div>
              <div className="space-y-2">
                {dateItems.map((item) => (
                  <div
                    key={item.id}
                    className="grid grid-cols-[8px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg bg-muted/35 px-3 py-3"
                  >
                    <span className={cn("h-8 w-1 rounded-full", item.color)} />
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-medium">
                        {item.title}
                      </p>
                      <p className="mt-1 truncate text-[9px] text-muted-foreground">
                        {item.detail}
                      </p>
                    </div>
                    <Badge variant="outline" className="text-[8px]">
                      {item.type}
                    </Badge>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <EmptyPanel
          icon={CalendarDays}
          title="Nothing scheduled"
          description="Tasks, expected deal closes, and workspace events appear here when they have dates."
        />
      )}
    </div>
  );
}

function ReportsPanel({
  data,
  onNavigate,
}: {
  data: CrmWorkspaceData;
  onNavigate: (tab: CrmTab) => void;
}) {
  const won = data.deals.filter((deal) => deal.isWon);
  const closed = data.deals.filter((deal) => deal.isWon || deal.isLost);
  const winRate = closed.length
    ? Math.round((won.length / closed.length) * 100)
    : 0;
  const averageDeal = won.length
    ? won.reduce((sum, deal) => sum + deal.valueCents, 0) / won.length
    : 0;
  const leadConversion = data.leads.length
    ? Math.round(
        (data.leads.filter((lead) => lead.convertedContactId).length /
          data.leads.length) *
          100,
      )
    : 0;
  const completedTasks = data.tasks.filter(
    (task) => task.status === "completed",
  ).length;
  const lifecycle = Array.from(
    data.contacts.reduce((map, contact) => {
      map.set(
        contact.lifecycleStage,
        (map.get(contact.lifecycleStage) || 0) + 1,
      );
      return map;
    }, new Map<string, number>()),
  ).sort((left, right) => right[1] - left[1]);
  const maxLifecycle = Math.max(1, ...lifecycle.map((item) => item[1]));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-[18px] font-semibold">CRM reports</h2>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Every report is calculated from the live records underneath it.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            downloadCsvFile(
              "maxform-crm-report.csv",
              ["Metric", "Value"],
              [
                ["Win rate", `${winRate}%`],
                ["Average won deal", averageDeal / 100],
                ["Lead conversion", `${leadConversion}%`],
                ["Completed tasks", completedTasks],
                [
                  "Confirmed revenue",
                  data.revenue.reduce((sum, point) => sum + point.revenue, 0),
                ],
              ],
            )
          }
        >
          <FileDown className="h-4 w-4" />
          Export report
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Win rate", value: `${winRate}%`, tab: "deals", icon: Trophy },
          {
            label: "Average won deal",
            value: formatMoney(averageDeal),
            tab: "deals",
            icon: Handshake,
          },
          {
            label: "Lead conversion",
            value: `${leadConversion}%`,
            tab: "leads",
            icon: Target,
          },
          {
            label: "Tasks completed",
            value: completedTasks.toLocaleString(),
            tab: "tasks",
            icon: Check,
          },
        ].map(({ label, value, tab, icon: Icon }) => (
          <button
            key={label}
            type="button"
            onClick={() => onNavigate(tab as CrmTab)}
            className="rounded-xl border border-border bg-card p-5 text-left hover:border-primary/30"
          >
            <Icon className="h-4 w-4 text-primary" />
            <p className="mt-5 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
              {label}
            </p>
            <p className="mt-1 text-[25px] font-semibold">{value}</p>
          </button>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-[14px] font-semibold">
            Contact lifecycle distribution
          </h3>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Click through to the shared contact directory.
          </p>
          <button
            type="button"
            onClick={() => onNavigate("contacts")}
            className="mt-5 block w-full space-y-3 text-left"
          >
            {lifecycle.map(([stage, count]) => (
              <div key={stage}>
                <div className="flex items-center justify-between text-[10px]">
                  <span className="font-medium">{titleCase(stage)}</span>
                  <span className="text-muted-foreground">{count}</span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${(count / maxLifecycle) * 100}%` }}
                  />
                </div>
              </div>
            ))}
            {!lifecycle.length ? (
              <p className="py-10 text-center text-[11px] text-muted-foreground">
                Lifecycle data appears after contacts are created.
              </p>
            ) : null}
          </button>
        </section>
        <section className="rounded-xl border border-border bg-card p-5">
          <h3 className="text-[14px] font-semibold">Sales outcomes</h3>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Won, lost, and still-active opportunity value.
          </p>
          <div className="mt-5 space-y-3">
            {[
              [
                "Won",
                data.deals.filter((deal) => deal.isWon),
                "bg-emerald-500",
              ],
              [
                "Active",
                data.deals.filter((deal) => !deal.isWon && !deal.isLost),
                "bg-primary",
              ],
              [
                "Lost",
                data.deals.filter((deal) => deal.isLost),
                "bg-rose-500",
              ],
            ].map(([label, deals, color]) => {
              const dealItems = deals as CrmDeal[];
              return (
                <button
                  key={String(label)}
                  type="button"
                  onClick={() => onNavigate("deals")}
                  className="grid w-full grid-cols-[8px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg bg-muted/35 px-3 py-3 text-left"
                >
                  <span
                    className={cn("h-8 w-1 rounded-full", String(color))}
                  />
                  <span className="text-[11px] font-medium">
                    {String(label)} · {dealItems.length}
                  </span>
                  <span className="text-[11px] font-semibold">
                    {formatMoney(
                      dealItems.reduce(
                        (sum, deal) => sum + deal.valueCents,
                        0,
                      ),
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

function IntelligencePanel({
  data,
  onNavigate,
}: {
  data: CrmWorkspaceData;
  onNavigate: (tab: CrmTab) => void;
}) {
  const now = Date.now();
  const stagesById = new Map(
    data.pipelines.flatMap((pipeline) =>
      pipeline.stages.map((stage) => [stage.id, stage] as const),
    ),
  );
  const overdueTasks = data.tasks.filter(
    (task) =>
      task.dueAt &&
      new Date(task.dueAt).getTime() < now &&
      !["completed", "cancelled"].includes(task.status),
  );
  const staleDeals = data.deals.filter(
    (deal) => {
      const stage = stagesById.get(deal.stageId);
      const threshold = stage?.staleAfterDays || 14;
      const enteredAt = new Date(
        deal.stageEnteredAt || deal.updatedAt,
      ).getTime();
      return (
        !deal.isWon &&
        !deal.isLost &&
        Number.isFinite(enteredAt) &&
        now - enteredAt > threshold * 24 * 60 * 60 * 1000
      );
    },
  );
  const hotLeads = data.leads.filter(
    (lead) =>
      lead.score >= 70 &&
      !["unqualified", "archived"].includes(lead.status),
  );
  const duplicateGroups = Array.from(
    data.contacts.reduce((map, contact) => {
      const key = contact.email.trim().toLowerCase();
      if (!key) return map;
      map.set(key, [...(map.get(key) || []), contact]);
      return map;
    }, new Map<string, typeof data.contacts>()),
  ).filter(([, contacts]) => contacts.length > 1);
  const signals = [
    {
      icon: UserRoundSearch,
      title: `${hotLeads.length} high-priority lead${hotLeads.length === 1 ? "" : "s"}`,
      detail:
        hotLeads.length > 0
          ? "These leads scored 70+ from visible source, profile, budget, and interest signals."
          : "No lead currently crosses the high-priority score threshold.",
      action: "Review leads",
      tab: "leads" as CrmTab,
    },
    {
      icon: Clock3,
      title: `${staleDeals.length} deal${staleDeals.length === 1 ? "" : "s"} need follow-up`,
      detail:
        staleDeals.length > 0
          ? "These active deals exceeded their stage attention threshold."
          : "No active deal has exceeded its stage attention threshold.",
      action: "Open deals",
      tab: "deals" as CrmTab,
    },
    {
      icon: ListTodo,
      title: `${overdueTasks.length} overdue task${overdueTasks.length === 1 ? "" : "s"}`,
      detail:
        overdueTasks.length > 0
          ? "Resolve overdue work before it becomes relationship risk."
          : "No open CRM task is past due.",
      action: "Review tasks",
      tab: "tasks" as CrmTab,
    },
    {
      icon: ContactRound,
      title: `${duplicateGroups.length} duplicate suggestion${duplicateGroups.length === 1 ? "" : "s"}`,
      detail:
        duplicateGroups.length > 0
          ? "Suggestions are explainable and never merged automatically."
          : "No duplicate email groups were detected.",
      action: "Open contacts",
      tab: "contacts" as CrmTab,
    },
  ];
  const attention = data.attention || [];
  const attentionTab = (entityType: string): CrmTab => {
    if (entityType === "lead") return "leads";
    if (entityType === "deal") return "deals";
    if (entityType === "task") return "tasks";
    if (entityType === "payment") return "reports";
    if (entityType === "contact") return "customer360";
    return "overview";
  };
  const attentionTone = (severity: string) =>
    severity === "urgent" || severity === "high"
      ? "border-rose-500/20 bg-rose-500/4"
      : severity === "medium"
        ? "border-amber-500/20 bg-amber-500/4"
        : "border-border bg-muted/15";

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Bot className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-[16px] font-semibold">CRM intelligence</h2>
            <p className="mt-1 max-w-2xl text-[11px] leading-5 text-muted-foreground">
              Explainable signals derived from your live CRM records. Scores
              and predictions are prioritization aids, not guaranteed outcomes.
            </p>
          </div>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {signals.map((signal) => (
            <button
              type="button"
              key={signal.title}
              onClick={() => onNavigate(signal.tab)}
              className="rounded-xl border border-border p-4 text-left transition-colors hover:border-primary/30 hover:bg-muted/25"
            >
              <signal.icon className="h-4 w-4 text-primary" />
              <p className="mt-4 text-[13px] font-semibold">{signal.title}</p>
              <p className="mt-2 min-h-10 text-[10px] leading-5 text-muted-foreground">
                {signal.detail}
              </p>
              <span className="mt-4 inline-flex items-center gap-2 text-[10px] font-medium text-primary">
                {signal.action}
                <ArrowRight className="h-3 w-3" />
              </span>
            </button>
          ))}
        </div>
        {attention.length ? (
          <div className="mt-6 border-t border-border pt-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-[13px] font-semibold">Needs attention</h3>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Explainable follow-up cues from live customer, pipeline, task, and payment data.
                </p>
              </div>
              <Badge variant="outline" className="text-[9px]">
                {attention.length} open
              </Badge>
            </div>
            <div className="mt-3 space-y-2">
              {attention.slice(0, 6).map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => onNavigate(attentionTab(item.entityType))}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors hover:border-primary/30",
                    attentionTone(item.severity),
                  )}
                >
                  <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-medium">{item.title}</span>
                    <span className="mt-1 block text-[10px] leading-5 text-muted-foreground">
                      {item.reason}
                    </span>
                  </span>
                  <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </section>
      <aside className="rounded-xl border border-primary/20 bg-primary/[0.035] p-5">
        <div className="flex items-center gap-2 text-primary">
          <SlidersHorizontal className="h-4 w-4" />
          <p className="text-[11px] font-semibold uppercase tracking-widest">
            Why this score?
          </p>
        </div>
        <h3 className="mt-4 text-[15px] font-semibold">
          Lead scoring stays visible
        </h3>
        <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
          Source quality, contactability, company match, stated budget, and
          documented interest are the current signals. The reasons appear on
          every lead card.
        </p>
        <div className="mt-5 space-y-3">
          {[
            ["First-party source", "30 points"],
            ["Email + phone", "25 points"],
            ["Company match", "15 points"],
            ["Budget fit", "Up to 20"],
            ["Interest documented", "10 points"],
          ].map(([label, value]) => (
            <div
              key={label}
              className="flex items-center justify-between border-b border-primary/10 pb-3 text-[10px] last:border-0"
            >
              <span>{label}</span>
              <span className="font-medium text-primary">{value}</span>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

type CreateValues = Record<string, string>;

function CreateRecordDialog({
  companies,
  contacts,
  deals,
  kind,
  onOpenChange,
  onSubmit,
  open,
  pipelines,
  working,
}: {
  companies: CrmCompany[];
  contacts: CrmWorkspaceData["contacts"];
  deals: CrmDeal[];
  kind: CreateKind | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: CreateValues) => void;
  open: boolean;
  pipelines: CrmPipeline[];
  working: boolean;
}) {
  const defaultPipeline =
    pipelines.find((pipeline) => pipeline.isDefault) ||
    pipelines[0];
  const [values, setValues] = useState<CreateValues>({});
  useEffect(() => {
    if (!open) return;
    const firstOpenStage = defaultPipeline?.stages.find(
      (stage) => !stage.isWon && !stage.isLost,
    );
    setValues({
      pipelineId: defaultPipeline?.id || "",
      stageId: firstOpenStage?.id || "",
      currency: "USD",
      priority: "normal",
      sourceType: "manual",
      probability: "25",
      color: "#635BFF",
    });
  }, [defaultPipeline?.id, defaultPipeline?.stages, open]);
  const pipeline =
    pipelines.find((item) => item.id === values.pipelineId) || defaultPipeline;
  const set = (key: string, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));
  const title = kind ? `New ${kind}` : "New CRM record";
  const required =
    kind === "company"
      ? values.name
      : kind === "lead"
        ? values.name || values.email
        : kind === "deal"
          ? values.name && values.pipelineId && values.stageId
          : kind === "task"
            ? values.title
            : kind === "pipeline"
              ? values.name
              : false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dashboard-scroll max-h-[90vh] max-w-[620px] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            This creates a real shared CRM record in the workspace.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2 sm:grid-cols-2">
          {kind === "company" ? (
            <>
              <Field
                label="Company name"
                value={values.name}
                onChange={(value) => set("name", value)}
                placeholder="Acme Studio"
              />
              <Field
                label="Industry"
                value={values.industry}
                onChange={(value) => set("industry", value)}
                placeholder="Professional services"
              />
              <Field
                label="Website"
                value={values.website}
                onChange={(value) => set("website", value)}
                placeholder="https://example.com"
              />
              <Field
                label="Employee count"
                type="number"
                value={values.employeeCount}
                onChange={(value) => set("employeeCount", value)}
                placeholder="25"
              />
              <div className="space-y-2 sm:col-span-2">
                <Label>Notes</Label>
                <Textarea
                  value={values.notes || ""}
                  onChange={(event) => set("notes", event.target.value)}
                  placeholder="Account context and relationship notes"
                />
              </div>
            </>
          ) : kind === "lead" ? (
            <>
              <Field
                label="Lead name"
                value={values.name}
                onChange={(value) => set("name", value)}
                placeholder="Ada Lovelace"
              />
              <Field
                label="Email"
                type="email"
                value={values.email}
                onChange={(value) => set("email", value)}
                placeholder="ada@example.com"
              />
              <Field
                label="Phone"
                value={values.phone}
                onChange={(value) => set("phone", value)}
                placeholder="+1 555 0100"
              />
              <div className="space-y-2">
                <Label>Company</Label>
                <Select
                  value={values.companyId || "none"}
                  onValueChange={(value) =>
                    set("companyId", value === "none" ? "" : value)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not known</SelectItem>
                    {companies.map((company) => (
                      <SelectItem key={company.id} value={company.id}>
                        {company.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Field
                label="Source label"
                value={values.sourceLabel}
                onChange={(value) => set("sourceLabel", value)}
                placeholder="Website demo form"
              />
              <Field
                label="Budget"
                type="number"
                value={values.budget}
                onChange={(value) => set("budget", value)}
                placeholder="5000"
              />
              <div className="space-y-2 sm:col-span-2">
                <Label>Interest and qualification notes</Label>
                <Textarea
                  value={values.notes || ""}
                  onChange={(event) => set("notes", event.target.value)}
                  placeholder="What are they interested in?"
                />
              </div>
            </>
          ) : kind === "deal" ? (
            <>
              <Field
                label="Deal name"
                value={values.name}
                onChange={(value) => set("name", value)}
                placeholder="Acme annual agreement"
              />
              <Field
                label="Value"
                type="number"
                value={values.value}
                onChange={(value) => set("value", value)}
                placeholder="12000"
              />
              <div className="space-y-2">
                <Label>Contact</Label>
                <Select
                  value={values.contactId || "none"}
                  onValueChange={(value) =>
                    set("contactId", value === "none" ? "" : value)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No contact</SelectItem>
                    {contacts.map((contact) => (
                      <SelectItem key={contact.id} value={contact.id}>
                        {contact.fullName || contact.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Company</Label>
                <Select
                  value={values.companyId || "none"}
                  onValueChange={(value) =>
                    set("companyId", value === "none" ? "" : value)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No company</SelectItem>
                    {companies.map((company) => (
                      <SelectItem key={company.id} value={company.id}>
                        {company.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Pipeline</Label>
                <Select
                  value={values.pipelineId}
                  onValueChange={(value) => {
                    const next = pipelines.find(
                      (pipeline) => pipeline.id === value,
                    );
                    setValues((current) => ({
                      ...current,
                      pipelineId: value,
                      stageId:
                        next?.stages.find(
                          (stage) => !stage.isWon && !stage.isLost,
                        )?.id || "",
                    }));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {pipelines.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Stage</Label>
                <Select
                  value={values.stageId}
                  onValueChange={(value) => set("stageId", value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(pipeline?.stages || [])
                      .filter((stage) => !stage.isWon && !stage.isLost)
                      .map((stage) => (
                        <SelectItem key={stage.id} value={stage.id}>
                          {stage.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                {pipeline &&
                !pipeline.stages.some(
                  (stage) => !stage.isWon && !stage.isLost,
                ) ? (
                  <p className="text-[10px] text-destructive">
                    Add an open stage to this pipeline before creating a deal.
                  </p>
                ) : null}
              </div>
              <Field
                label="Expected close date"
                type="date"
                value={values.closeDate}
                onChange={(value) => set("closeDate", value)}
              />
              <div className="space-y-2 sm:col-span-2">
                <Label>Notes</Label>
                <Textarea
                  value={values.notes || ""}
                  onChange={(event) => set("notes", event.target.value)}
                  placeholder="Decision process, requirements, and next step"
                />
              </div>
            </>
          ) : kind === "task" ? (
            <>
              <Field
                label="Task title"
                value={values.title}
                onChange={(value) => set("title", value)}
                placeholder="Follow up on proposal"
              />
              <Field
                label="Due date and time"
                type="datetime-local"
                value={values.dueAt}
                onChange={(value) => set("dueAt", value)}
              />
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select
                  value={values.priority}
                  onValueChange={(value) => set("priority", value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["low", "normal", "high", "urgent"].map((value) => (
                      <SelectItem key={value} value={value}>
                        {titleCase(value)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Linked contact</Label>
                <Select
                  value={values.contactId || "none"}
                  onValueChange={(value) =>
                    set("contactId", value === "none" ? "" : value)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No contact</SelectItem>
                    {contacts.map((contact) => (
                      <SelectItem key={contact.id} value={contact.id}>
                        {contact.fullName || contact.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Linked company</Label>
                <Select
                  value={values.companyId || "none"}
                  onValueChange={(value) =>
                    set("companyId", value === "none" ? "" : value)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No company</SelectItem>
                    {companies.map((company) => (
                      <SelectItem key={company.id} value={company.id}>
                        {company.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Linked deal</Label>
                <Select
                  value={values.dealId || "none"}
                  onValueChange={(value) =>
                    set("dealId", value === "none" ? "" : value)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No deal</SelectItem>
                    {deals.map((deal) => (
                      <SelectItem key={deal.id} value={deal.id}>
                        {deal.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Description</Label>
                <Textarea
                  value={values.description || ""}
                  onChange={(event) =>
                    set("description", event.target.value)
                  }
                  placeholder="What needs to happen?"
                />
              </div>
            </>
          ) : kind === "pipeline" ? (
            <>
              <Field
                label="Pipeline name"
                value={values.name}
                onChange={(value) => set("name", value)}
                placeholder="Partnerships"
              />
              <Field
                label="Description"
                value={values.description}
                onChange={(value) => set("description", value)}
                placeholder="How this relationship process works"
              />
              <div className="space-y-2">
                <Label htmlFor="crm-pipeline-color">Pipeline color</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="crm-pipeline-color"
                    type="color"
                    value={values.color || "#635BFF"}
                    onChange={(event) => set("color", event.target.value)}
                    className="h-10 w-14 cursor-pointer p-1"
                  />
                  <Input
                    value={values.color || "#635BFF"}
                    onChange={(event) => set("color", event.target.value)}
                    aria-label="Pipeline color value"
                    placeholder="#635BFF"
                  />
                </div>
              </div>
              <div className="sm:col-span-2 rounded-lg border border-primary/20 bg-primary/[0.035] p-3 text-[10px] leading-5 text-muted-foreground">
                This pipeline starts clean. Add only the stages that match your
                process after creating it.
              </div>
            </>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={working || !required}
            onClick={() => onSubmit(values)}
          >
            {working ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Create {kind}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  onChange,
  placeholder,
  type = "text",
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  value?: string;
}) {
  const id = useId();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value || ""}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

function CompanyDetailDialog({
  company,
  data,
  onOpenChange,
}: {
  company: CrmCompany | null;
  data: CrmWorkspaceData;
  onOpenChange: (open: boolean) => void;
}) {
  if (!company) return null;
  const contacts = data.contacts.filter(
    (contact) =>
      contact.companyId === company.id ||
      contact.company.toLowerCase() === company.name.toLowerCase(),
  );
  const deals = data.deals.filter((deal) => deal.companyId === company.id);
  const activities = data.activities.filter(
    (activity) =>
      activity.companyId === company.id ||
      contacts.some((contact) => contact.id === activity.contactId),
  );
  return (
    <Dialog open={Boolean(company)} onOpenChange={onOpenChange}>
      <DialogContent className="dashboard-scroll max-h-[90vh] max-w-[760px] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Building2 className="h-5 w-5" />
            </span>
            <div>
              <DialogTitle>{company.name}</DialogTitle>
              <DialogDescription className="mt-1">
                {company.industry || "Industry not set"}
                {company.website ? ` · ${company.website}` : ""}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
          {[
            ["Contacts", company.contactCount],
            ["Deals", company.dealCount],
            ["Pipeline", formatMoney(company.activeDealValueCents)],
            ["Employees", company.employeeCount ?? "Not set"],
          ].map(([label, value]) => (
            <div key={String(label)} className="bg-card p-4">
              <p className="text-[9px] uppercase tracking-[0.08em] text-muted-foreground">
                {label}
              </p>
              <p className="mt-2 text-[16px] font-semibold">{value}</p>
            </div>
          ))}
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <section>
            <h3 className="text-[12px] font-semibold">People</h3>
            <div className="mt-3 divide-y divide-border border-y border-border">
              {contacts.length ? (
                contacts.map((contact) => (
                  <div key={contact.id} className="py-3">
                    <p className="text-[11px] font-medium">
                      {contact.fullName || contact.email}
                    </p>
                    <p className="mt-1 text-[9px] text-muted-foreground">
                      {contact.email} · {titleCase(contact.lifecycleStage)}
                    </p>
                  </div>
                ))
              ) : (
                <p className="py-8 text-center text-[10px] text-muted-foreground">
                  No contacts linked yet.
                </p>
              )}
            </div>
          </section>
          <section>
            <h3 className="text-[12px] font-semibold">Deals</h3>
            <div className="mt-3 divide-y divide-border border-y border-border">
              {deals.length ? (
                deals.map((deal) => (
                  <div
                    key={deal.id}
                    className="flex items-center justify-between gap-3 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-medium">
                        {deal.name}
                      </p>
                      <p className="mt-1 text-[9px] text-muted-foreground">
                        {deal.stageName}
                      </p>
                    </div>
                    <span className="text-[11px] font-semibold">
                      {formatMoney(deal.valueCents, deal.currency)}
                    </span>
                  </div>
                ))
              ) : (
                <p className="py-8 text-center text-[10px] text-muted-foreground">
                  No deals linked yet.
                </p>
              )}
            </div>
          </section>
        </div>
        <section>
          <h3 className="text-[12px] font-semibold">Recent account activity</h3>
          <div className="mt-3 divide-y divide-border border-y border-border">
            {activities.slice(0, 6).map((activity) => (
              <div
                key={activity.id}
                className="flex items-start justify-between gap-4 py-3"
              >
                <div>
                  <p className="text-[11px] font-medium">{activity.title}</p>
                  <p className="mt-1 text-[9px] text-muted-foreground">
                    {activity.detail}
                  </p>
                </div>
                <span className="shrink-0 text-[9px] text-muted-foreground">
                  {formatDate(activity.createdAt)}
                </span>
              </div>
            ))}
            {!activities.length ? (
              <p className="py-8 text-center text-[10px] text-muted-foreground">
                Account activity will roll up here.
              </p>
            ) : null}
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}

function DealDetailDialog({
  deal,
  data,
  onOpenChange,
}: {
  deal: CrmDeal | null;
  data: CrmWorkspaceData;
  onOpenChange: (open: boolean) => void;
}) {
  if (!deal) return null;
  const tasks = data.tasks.filter((task) => task.dealId === deal.id);
  const activities = data.activities.filter(
    (activity) => activity.dealId === deal.id,
  );
  return (
    <Dialog open={Boolean(deal)} onOpenChange={onOpenChange}>
      <DialogContent className="dashboard-scroll max-h-[90vh] max-w-[760px] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{deal.name}</DialogTitle>
          <DialogDescription>
            {deal.pipelineName} · {deal.stageName}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
          {[
            ["Value", formatMoney(deal.valueCents, deal.currency)],
            ["Probability", `${deal.probability}%`],
            ["Expected close", formatDate(deal.expectedCloseDate)],
            ["Owner", deal.ownerName || "Workspace owner"],
          ].map(([label, value]) => (
            <div key={label} className="bg-card p-4">
              <p className="text-[9px] uppercase tracking-[0.08em] text-muted-foreground">
                {label}
              </p>
              <p className="mt-2 truncate text-[13px] font-semibold">{value}</p>
            </div>
          ))}
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          <section>
            <h3 className="text-[12px] font-semibold">Linked relationship</h3>
            <div className="mt-3 rounded-xl border border-border p-4">
              <p className="text-[11px] font-medium">
                {deal.companyName || "No company"}
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {deal.contactName || "No contact"}
              </p>
              {deal.notes ? (
                <p className="mt-4 border-t border-border pt-4 text-[10px] leading-5 text-muted-foreground">
                  {deal.notes}
                </p>
              ) : null}
            </div>
          </section>
          <section>
            <h3 className="text-[12px] font-semibold">Tasks</h3>
            <div className="mt-3 divide-y divide-border border-y border-border">
              {tasks.map((task) => (
                <div key={task.id} className="py-3">
                  <p className="text-[11px] font-medium">{task.title}</p>
                  <p className="mt-1 text-[9px] text-muted-foreground">
                    {titleCase(task.status)} · {formatDate(task.dueAt)}
                  </p>
                </div>
              ))}
              {!tasks.length ? (
                <p className="py-8 text-center text-[10px] text-muted-foreground">
                  No tasks linked to this deal.
                </p>
              ) : null}
            </div>
          </section>
        </div>
        <section>
          <h3 className="text-[12px] font-semibold">Deal timeline</h3>
          <div className="mt-3 divide-y divide-border border-y border-border">
            {activities.map((activity) => (
              <div
                key={activity.id}
                className="flex items-start justify-between gap-4 py-3"
              >
                <div>
                  <p className="text-[11px] font-medium">{activity.title}</p>
                  <p className="mt-1 text-[9px] text-muted-foreground">
                    {activity.detail}
                  </p>
                </div>
                <span className="shrink-0 text-[9px] text-muted-foreground">
                  {formatDate(activity.createdAt, true)}
                </span>
              </div>
            ))}
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}

export function CrmModule({
  userId,
  initialTab = "overview",
  onTabChange,
}: CrmModuleProps) {
  const queryClient = useQueryClient();
  const [localTab, setLocalTab] = useState<CrmTab>(initialTab);
  const [createKind, setCreateKind] = useState<CreateKind | null>(null);
  const [working, setWorking] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState<CrmCompany | null>(
    null,
  );
  const [selectedDeal, setSelectedDeal] = useState<CrmDeal | null>(null);
  const [pipelineEditor, setPipelineEditor] = useState<CrmPipeline | null>(
    null,
  );
  const [pipelineDelete, setPipelineDelete] = useState<CrmPipeline | null>(
    null,
  );
  const [stageEditor, setStageEditor] = useState<{
    pipeline: CrmPipeline;
    stage: CrmPipelineStage | null;
  } | null>(null);
  const [stageDelete, setStageDelete] = useState<{
    pipeline: CrmPipeline;
    stage: CrmPipelineStage;
  } | null>(null);
  const [lostChange, setLostChange] = useState<{
    deal: CrmDeal;
    stage: CrmPipelineStage;
  } | null>(null);
  const [lostReason, setLostReason] = useState("");
  const activeTab = onTabChange ? initialTab : localTab;
  const queryKey = ["crm-workspace", userId || "anonymous"];
  const workspaceQuery = useQuery({
    enabled: Boolean(userId),
    queryKey,
    queryFn: () => getCrmWorkspace(userId!),
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
  const data = workspaceQuery.data;

  useEffect(() => {
    setLocalTab(initialTab);
  }, [initialTab]);

  const selectTab = (tab: CrmTab) => {
    setLocalTab(tab);
    onTabChange?.(tab);
  };
  const refresh = () => queryClient.invalidateQueries({ queryKey });
  const run = async (
    action: () => Promise<unknown>,
    success: string,
    after?: () => void,
  ) => {
    setWorking(true);
    try {
      await action();
      toast.success(success);
      after?.();
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "CRM update failed.");
    } finally {
      setWorking(false);
    }
  };

  const submitCreate = (values: CreateValues) => {
    if (!userId || !createKind) return;
    const action =
      createKind === "company"
        ? () =>
            createCrmCompany(userId, {
              name: values.name,
              industry: values.industry,
              website: values.website,
              employeeCount: values.employeeCount
                ? Number(values.employeeCount)
                : null,
              notes: values.notes,
            })
        : createKind === "lead"
          ? () =>
              createCrmLead(userId, {
                name: values.name,
                email: values.email,
                phone: values.phone,
                sourceType: "manual",
                sourceLabel: values.sourceLabel,
                companyId: values.companyId || null,
                budgetCents: Math.round(Number(values.budget || 0) * 100),
                interestNotes: values.notes,
              })
          : createKind === "deal"
            ? () =>
                createCrmDeal(userId, {
                  name: values.name,
                  contactId: values.contactId || null,
                  companyId: values.companyId || null,
                  pipelineId: values.pipelineId,
                  stageId: values.stageId,
                  valueCents: Math.round(Number(values.value || 0) * 100),
                  currency: values.currency || "USD",
                  expectedCloseDate: values.closeDate || null,
                  notes: values.notes,
                })
            : createKind === "task"
              ? () =>
                  createCrmTask(userId, {
                    title: values.title,
                    description: values.description,
                    dueAt: values.dueAt
                      ? new Date(values.dueAt).toISOString()
                      : null,
                    priority: values.priority as
                      | "low"
                      | "normal"
                      | "high"
                      | "urgent",
                    contactId: values.contactId || null,
                    companyId: values.companyId || null,
                    dealId: values.dealId || null,
                  })
              : createKind === "pipeline"
                ? () =>
                    createCrmPipeline(userId, {
                      name: values.name,
                      description: values.description || "",
                      color: values.color,
                    })
                : async () => undefined;
    void run(action, `${titleCase(createKind)} created.`, () => {
      setCreateKind(null);
    });
  };

  const activeTitle =
    allTabs.find((tab) => tab.key === activeTab)?.label || "CRM";
  return (
    <div className="min-w-0 pb-12">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-primary">
            <BriefcaseBusiness className="h-4 w-4" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em]">
              CRM
            </p>
          </div>
          <h1 className="mt-2 text-[30px] font-semibold tracking-tight sm:text-[38px]">
            {activeTitle}
          </h1>
          <p className="mt-2 max-w-2xl text-[13px] leading-6 text-muted-foreground">
            Contacts, companies, leads, deals, and every relationship signal
            connected to the forms, events, payments, emails, and documents
            that created them.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="icon"
            variant="outline"
            onClick={() => void refresh()}
            disabled={workspaceQuery.isFetching}
            aria-label="Refresh CRM"
          >
            <RefreshCw
              className={cn(
                "h-4 w-4",
                workspaceQuery.isFetching && "animate-spin",
              )}
            />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button">
                <Plus className="h-4 w-4" />
                New CRM record
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {[
                { kind: "lead", icon: UserRoundSearch, label: "Lead" },
                { kind: "deal", icon: Handshake, label: "Deal" },
                { kind: "task", icon: ListTodo, label: "Task" },
                { kind: "company", icon: Building2, label: "Company" },
              ].map(({ kind, icon: Icon, label }) => (
                <DropdownMenuItem
                  key={kind}
                  onClick={() => setCreateKind(kind as CreateKind)}
                >
                  <Icon className="h-4 w-4" />
                  New {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <CrmSectionNav activeTab={activeTab} onSelect={selectTab} />

      <div className="mt-6">
        {!userId ? (
          <EmptyPanel
            icon={BriefcaseBusiness}
            title="Sign in to open CRM"
            description="CRM records are scoped to your authenticated workspace."
          />
        ) : workspaceQuery.isLoading ? (
          <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {Array.from({ length: 10 }, (_, index) => (
                <Skeleton key={index} className="h-36 rounded-xl" />
              ))}
            </div>
            <Skeleton className="h-[360px] rounded-xl" />
          </div>
        ) : workspaceQuery.isError ? (
          <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-6">
            <div className="flex items-start gap-3">
              <XCircle className="mt-0.5 h-5 w-5 text-destructive" />
              <div>
                <h2 className="text-[14px] font-semibold text-destructive">
                  CRM could not be loaded
                </h2>
                <p className="mt-2 max-w-2xl text-[11px] leading-5 text-muted-foreground">
                  {workspaceQuery.error instanceof Error
                    ? workspaceQuery.error.message
                    : "The CRM schema or workspace data is unavailable."}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-4"
                  onClick={() => void workspaceQuery.refetch()}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Try again
                </Button>
              </div>
            </div>
          </div>
        ) : data ? (
          activeTab === "overview" ? (
            <CrmOverview data={data} onNavigate={selectTab} />
          ) : activeTab === "contacts" ? (
            <ContactsModule
              embedded
              initialTab="contacts"
              showNavigation
              userId={userId}
            />
          ) : activeTab === "customer360" ? (
            <Customer360Panel
              userId={userId}
              contacts={data.contacts}
              currency={data.currency}
            />
          ) : activeTab === "command-center" ? (
            <CommandCenterPanel
              data={data}
              userId={userId}
              onNavigate={selectTab}
            />
          ) : activeTab === "companies" ? (
            <CompaniesPanel
              companies={data.companies}
              onCreate={() => setCreateKind("company")}
              onFollowUp={(companies) =>
                void run(
                  () =>
                    Promise.all(
                      companies.map((company) =>
                        createCrmTask(userId, {
                          title: `Follow up with ${company.name}`,
                          companyId: company.id,
                          priority: "normal",
                        }),
                      ),
                    ),
                  `${companies.length} follow-up task${companies.length === 1 ? "" : "s"} created.`,
                )
              }
              onOpen={setSelectedCompany}
            />
          ) : activeTab === "leads" ? (
            <LeadsPanel
              leads={data.leads}
              onBulkStatus={(leads, status) =>
                void run(
                  () =>
                    Promise.all(
                      leads.map((lead) =>
                        updateCrmLeadStatus(userId, lead.id, status),
                      ),
                    ),
                  `${leads.length} lead${leads.length === 1 ? "" : "s"} moved to ${titleCase(status)}.`,
                )
              }
              onCreate={() => setCreateKind("lead")}
              onConvert={(lead, target) =>
                void run(
                  () =>
                    convertCrmLead(userId, lead.id, target, {
                      pipelineId:
                        data.pipelines.find((pipeline) => pipeline.isDefault)
                          ?.id || data.pipelines[0]?.id,
                      stageId:
                        data.pipelines.find((pipeline) => pipeline.isDefault)
                          ?.stages.find(
                            (stage) => !stage.isWon && !stage.isLost,
                          )?.id ||
                        data.pipelines[0]?.stages.find(
                          (stage) => !stage.isWon && !stage.isLost,
                        )?.id,
                    }),
                  `Lead converted to ${target}.`,
                )
              }
              onStatus={(lead, status) =>
                void run(
                  () => updateCrmLeadStatus(userId, lead.id, status),
                  `Lead moved to ${titleCase(status)}.`,
                )
              }
            />
          ) : activeTab === "deals" ? (
            <DealsPanel
              deals={data.deals}
              onBulkStageChange={(deals, stage) =>
                void run(
                  () =>
                    Promise.all(
                      deals.map((deal) =>
                        updateCrmDealStage(userId, deal.id, stage.id),
                      ),
                    ),
                  `${deals.length} deal${deals.length === 1 ? "" : "s"} moved to ${stage.name}.`,
                )
              }
              pipelines={data.pipelines}
              onCreate={() => setCreateKind("deal")}
              onOpen={setSelectedDeal}
              onStageChange={(deal, stage) => {
                if (stage.isLost) {
                  setLostReason("");
                  setLostChange({ deal, stage });
                  return;
                }
                void run(
                  () => updateCrmDealStage(userId, deal.id, stage.id),
                  `${deal.name} moved to ${stage.name}.`,
                );
              }}
            />
          ) : activeTab === "pipelines" ? (
            <PipelinesPanel
              deals={data.deals}
              pipelines={data.pipelines}
              onCreate={() => setCreateKind("pipeline")}
              onDeletePipeline={setPipelineDelete}
              onDeleteStage={(pipeline, stage) =>
                setStageDelete({ pipeline, stage })
              }
              onCreateStage={(pipeline) => {
                setStageEditor({ pipeline, stage: null });
              }}
              onEditPipeline={setPipelineEditor}
              onEditStage={(pipeline, stage) =>
                setStageEditor({ pipeline, stage })
              }
              onMoveStage={(_pipeline, stage, direction) =>
                void run(
                  () =>
                    reorderCrmPipelineStage(userId, stage.id, direction),
                  `${stage.name} reordered.`,
                )
              }
            />
          ) : activeTab === "activities" ? (
            <ActivitiesPanel
              activities={data.activities}
              onFollowUp={(activities) =>
                void run(
                  () =>
                    Promise.all(
                      activities.map((activity) =>
                        createCrmTask(userId, {
                          title: `Follow up: ${activity.title}`,
                          contactId: activity.contactId,
                          companyId: activity.companyId,
                          dealId: activity.dealId,
                          priority: "normal",
                        }),
                      ),
                    ),
                  `${activities.length} follow-up task${activities.length === 1 ? "" : "s"} created.`,
                )
              }
            />
          ) : activeTab === "tasks" ? (
            <TasksPanel
              tasks={data.tasks}
              onBulkStatus={(tasks, status) =>
                void run(
                  () =>
                    Promise.all(
                      tasks.map((task) =>
                        updateCrmTaskStatus(userId, task.id, status),
                      ),
                    ),
                  `${tasks.length} task${tasks.length === 1 ? "" : "s"} updated.`,
                )
              }
              onCreate={() => setCreateKind("task")}
              onStatus={(task, status) =>
                void run(
                  () => updateCrmTaskStatus(userId, task.id, status),
                  status === "completed"
                    ? "Task completed."
                    : `Task moved to ${titleCase(status)}.`,
                )
              }
            />
          ) : activeTab === "calendar" ? (
            <CalendarPanel data={data} />
          ) : activeTab === "reports" ? (
            <ReportsPanel data={data} onNavigate={selectTab} />
          ) : activeTab === "import" ? (
            <ContactsModule
              key="crm-import"
              embedded
              initialTab={"import" as ContactsTab}
              showNavigation={false}
              userId={userId}
            />
          ) : activeTab === "ai" ? (
            <IntelligencePanel data={data} onNavigate={selectTab} />
          ) : (
            <div className="space-y-6">
              <section className="rounded-xl border border-primary/20 bg-primary/[0.035] p-5">
                <div className="flex items-start gap-3">
                  <Settings2 className="mt-0.5 h-4 w-4 text-primary" />
                  <div>
                    <h2 className="text-[14px] font-semibold">
                      CRM governance and scoring
                    </h2>
                    <p className="mt-1 max-w-3xl text-[11px] leading-5 text-muted-foreground">
                      Contact lifecycle, custom fields, and deduplication stay
                      on the shared Contacts foundation. Pipeline stages live
                      in Pipelines; workspace Team roles remain the authority
                      for ownership and access.
                    </p>
                  </div>
                </div>
              </section>
              <ContactsModule
                key="crm-settings"
                embedded
                initialTab={"settings" as ContactsTab}
                showNavigation={false}
                userId={userId}
              />
            </div>
          )
        ) : null}
      </div>

      {data ? (
        <>
          <CreateRecordDialog
            companies={data.companies}
            contacts={data.contacts}
            deals={data.deals}
            kind={createKind}
            onOpenChange={(open) => {
              if (!open) {
                setCreateKind(null);
              }
            }}
            onSubmit={submitCreate}
            open={Boolean(createKind)}
            pipelines={data.pipelines}
            working={working}
          />
          <PipelineEditorDialog
            open={Boolean(pipelineEditor)}
            pipeline={pipelineEditor}
            working={working}
            onOpenChange={(open) => {
              if (!open) setPipelineEditor(null);
            }}
            onSave={(input) => {
              if (!pipelineEditor) return;
              void run(
                () =>
                  updateCrmPipeline(userId, pipelineEditor.id, input),
                `${input.name.trim()} updated.`,
                () => setPipelineEditor(null),
              );
            }}
          />
          <PipelineStageDialog
            open={Boolean(stageEditor)}
            pipeline={stageEditor?.pipeline || null}
            stage={stageEditor?.stage || null}
            working={working}
            onOpenChange={(open) => {
              if (!open) setStageEditor(null);
            }}
            onSave={(input) => {
              if (!stageEditor) return;
              const action = stageEditor.stage
                ? () =>
                    updateCrmPipelineStage(
                      userId,
                      stageEditor.stage!.id,
                      input,
                    )
                : () =>
                    createCrmPipelineStage(
                      userId,
                      stageEditor.pipeline.id,
                      input,
                    );
              void run(
                action,
                stageEditor.stage
                  ? `${input.name.trim()} updated.`
                  : `${input.name.trim()} added.`,
                () => setStageEditor(null),
              );
            }}
          />
          <DeletePipelineDialog
            dealCount={
              pipelineDelete
                ? data.deals.filter(
                    (deal) => deal.pipelineId === pipelineDelete.id,
                  ).length
                : 0
            }
            open={Boolean(pipelineDelete)}
            pipeline={pipelineDelete}
            working={working}
            onOpenChange={(open) => {
              if (!open) setPipelineDelete(null);
            }}
            onConfirm={() => {
              if (!pipelineDelete) return;
              const name = pipelineDelete.name;
              void run(
                () => deleteCrmPipeline(userId, pipelineDelete.id),
                `${name} deleted.`,
                () => setPipelineDelete(null),
              );
            }}
          />
          <DeleteStageDialog
            dealCount={
              stageDelete
                ? data.deals.filter(
                    (deal) => deal.stageId === stageDelete.stage.id,
                  ).length
                : 0
            }
            open={Boolean(stageDelete)}
            pipeline={stageDelete?.pipeline || null}
            stage={stageDelete?.stage || null}
            working={working}
            onOpenChange={(open) => {
              if (!open) setStageDelete(null);
            }}
            onConfirm={(reassignStageId) => {
              if (!stageDelete) return;
              const name = stageDelete.stage.name;
              void run(
                () =>
                  deleteCrmPipelineStage(
                    userId,
                    stageDelete.stage.id,
                    reassignStageId,
                  ),
                `${name} deleted.`,
                () => setStageDelete(null),
              );
            }}
          />
          <CompanyDetailDialog
            company={selectedCompany}
            data={data}
            onOpenChange={(open) => {
              if (!open) setSelectedCompany(null);
            }}
          />
          <DealDetailDialog
            deal={selectedDeal}
            data={data}
            onOpenChange={(open) => {
              if (!open) setSelectedDeal(null);
            }}
          />
        </>
      ) : null}

      <Dialog
        open={Boolean(lostChange)}
        onOpenChange={(open) => {
          if (!open) setLostChange(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Why was this deal lost?</DialogTitle>
            <DialogDescription>
              A reason is required so loss reporting stays useful.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="crm-lost-reason">Lost reason</Label>
            <Textarea
              id="crm-lost-reason"
              value={lostReason}
              onChange={(event) => setLostReason(event.target.value)}
              placeholder="Budget, timing, competitor, no decision..."
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setLostChange(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={working || !lostReason.trim()}
              onClick={() => {
                if (!userId || !lostChange) return;
                void run(
                  () =>
                    updateCrmDealStage(
                      userId,
                      lostChange.deal.id,
                      lostChange.stage.id,
                      lostReason,
                    ),
                  `${lostChange.deal.name} marked lost.`,
                  () => setLostChange(null),
                );
              }}
            >
              {working ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <XCircle className="h-4 w-4" />
              )}
              Mark lost
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

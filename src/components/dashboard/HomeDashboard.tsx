import {
  type DragEvent,
  type KeyboardEvent,
  useEffect,
  useState,
} from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  Bot,
  BriefcaseBusiness,
  Building2,
  CalendarPlus,
  CheckCircle2,
  CircleDollarSign,
  ContactRound,
  FileText,
  GripVertical,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  getUsageStats,
  type UsageStats,
} from "@/lib/settings";
import { cn } from "@/lib/utils";

export type HomeDestination =
  | "forms"
  | "ai"
  | "form-ai"
  | "form-templates"
  | "events"
  | "appointments"
  | "workflows"
  | "crm"
  | "contacts"
  | "payments"
  | "analytics"
  | "settings";

type HomeDashboardProps = {
  fullName: string;
  userId?: string;
  workspaceLogo?: string | null;
  workspaceName: string;
  onNavigate: (destination: HomeDestination) => void;
  onNotice: (message: string) => void;
};

type QuickAction = {
  destination: HomeDestination;
  icon: LucideIcon;
  id: string;
  label: string;
  meta: string;
};

type NextStep = {
  destination: HomeDestination;
  icon: LucideIcon;
  label: string;
  description: string;
};

const quickActionCatalog: QuickAction[] = [
  {
    id: "create-form",
    label: "Create form",
    meta: "Start a new form",
    icon: FileText,
    destination: "form-templates",
  },
  {
    id: "ai-form",
    label: "Max Builder",
    meta: "Generate from a brief",
    icon: Bot,
    destination: "form-ai",
  },
  {
    id: "create-event",
    label: "Create event",
    meta: "Open registration",
    icon: CalendarPlus,
    destination: "events",
  },
  {
    id: "create-workflow",
    label: "Create workflow",
    meta: "Automate a response",
    icon: Workflow,
    destination: "workflows",
  },
  {
    id: "crm",
    label: "CRM",
    meta: "Manage customer relationships",
    icon: BriefcaseBusiness,
    destination: "crm",
  },
  {
    id: "payments",
    label: "Payments",
    meta: "Review transactions",
    icon: CircleDollarSign,
    destination: "payments",
  },
  {
    id: "analytics",
    label: "Analytics",
    meta: "Explore performance",
    icon: BarChart3,
    destination: "analytics",
  },
  {
    id: "settings",
    label: "Workspace settings",
    meta: "Manage your workspace",
    icon: Settings,
    destination: "settings",
  },
];

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function WorkspaceHero({
  error,
  fullName,
  loading,
  onNavigate,
  setupComplete,
  workspaceLogo,
}: {
  error: boolean;
  fullName: string;
  loading: boolean;
  onNavigate: (destination: HomeDestination) => void;
  setupComplete: boolean;
  workspaceLogo?: string | null;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const initials =
    fullName
      .split(" ")
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "MF";
  const date = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());
  const filteredActions = quickActionCatalog.filter((action) =>
    `${action.label} ${action.meta}`
      .toLowerCase()
      .includes(searchQuery.trim().toLowerCase()),
  );

  useEffect(() => {
    const openSearch = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      if (event.key === "/" && !isTyping) {
        event.preventDefault();
        setSearchOpen(true);
      }
    };

    window.addEventListener("keydown", openSearch);
    return () => window.removeEventListener("keydown", openSearch);
  }, []);

  return (
    <section className="border-b border-border pb-8">
      <div className="flex flex-col justify-between gap-7 xl:flex-row xl:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <Avatar className="h-10 w-10 border border-border">
              <AvatarImage src={workspaceLogo || ""} className="object-cover" />
              <AvatarFallback className="bg-primary/10 text-[12px] font-semibold text-primary">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="text-[14px] font-medium leading-5 text-foreground">
                {getGreeting()}, {fullName}
              </p>
            </div>
          </div>

          <h1 className="mt-6 max-w-[620px] text-[30px] font-semibold leading-[1.15] text-foreground sm:text-[36px]">
            Your workspace, at a glance.
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted-foreground">
            <span>{date}</span>
            <span className="hidden h-1 w-1 rounded-full bg-border sm:block" />
            <span
              className={cn(
                "inline-flex items-center gap-1.5",
                error && "text-rose-600 dark:text-rose-400",
              )}
            >
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  error
                    ? "bg-rose-500"
                    : loading
                      ? "bg-amber-500"
                      : setupComplete
                        ? "bg-emerald-500"
                        : "bg-amber-500",
                )}
              />
              {error
                ? "Sync unavailable"
                : loading
                  ? "Syncing workspace"
                  : setupComplete
                    ? "Workspace ready"
                    : "Setup in progress"}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 xl:shrink-0 xl:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => setSearchOpen(true)}
            className="w-[220px] justify-start sm:w-[260px]"
          >
            <Search className="h-4 w-4" />
            Search
            <kbd className="ml-auto hidden rounded border border-border px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground sm:inline">
              /
            </kbd>
          </Button>

          <div className="relative">
            <Button type="button" onClick={() => setCreateOpen((current) => !current)}>
              <Plus className="h-4 w-4" />
              Create
            </Button>
            {createOpen && (
              <div className="absolute right-0 top-12 z-30 w-[220px] rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-xl">
                {quickActionCatalog.slice(0, 4).map((action) => {
                  const Icon = action.icon;
                  return (
                    <button
                      key={action.id}
                      type="button"
                      onClick={() => {
                        setCreateOpen(false);
                        onNavigate(action.destination);
                      }}
                      className="flex w-full items-center gap-3 rounded px-3 py-2.5 text-left text-[13px] hover:bg-accent hover:text-accent-foreground"
                    >
                      <Icon className="h-4 w-4 text-primary" />
                      {action.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="max-w-[540px] gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b border-border px-5 py-4">
            <DialogTitle>Search workspace</DialogTitle>
            <DialogDescription>
              Jump directly to a MaxForm tool.
            </DialogDescription>
          </DialogHeader>
          <div className="p-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search workspace tools"
                className="pl-10"
              />
            </div>
            <div className="mt-3 max-h-[320px] overflow-y-auto">
              {filteredActions.map((action) => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => {
                      setSearchOpen(false);
                      onNavigate(action.destination);
                    }}
                    className="flex w-full items-center gap-3 rounded-md px-3 py-3 text-left hover:bg-accent"
                  >
                    <span className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-primary">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-medium text-foreground">
                        {action.label}
                      </span>
                      <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
                        {action.meta}
                      </span>
                    </span>
                  </button>
                );
              })}
              {filteredActions.length === 0 && (
                <p className="px-3 py-10 text-center text-[13px] text-muted-foreground">
                  No workspace tools found.
                </p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function WorkspaceOverview({
  error,
  loading,
  setupCompleted,
  usage,
}: {
  error: boolean;
  loading: boolean;
  setupCompleted: number;
  usage: UsageStats | null;
}) {
  const metrics = [
    { icon: FileText, label: "Forms", value: usage?.forms },
    { icon: ContactRound, label: "Responses", value: usage?.responses },
    { icon: Workflow, label: "Workflows", value: usage?.workflows },
    {
      icon: CheckCircle2,
      label: "Setup complete",
      value: error ? undefined : `${setupCompleted}/3`,
    },
  ];

  return (
    <section aria-label="Workspace overview">
      <div className="grid grid-cols-1 border-y border-border sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric, index) => {
          const Icon = metric.icon;
          return (
            <div
              key={metric.label}
              className={cn(
                "min-w-0 py-5 sm:px-5 xl:px-6",
                index > 0 && "border-t border-border sm:border-t-0",
                index > 1 && "sm:border-t",
                index > 0 && "xl:border-t-0",
                index % 2 === 1 && "sm:border-l",
                index === 2 && "xl:border-l",
              )}
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-primary">
                <Icon className="h-4 w-4" />
              </span>
              <p className="mt-4 text-[13px] text-muted-foreground">
                {metric.label}
              </p>
              {loading ? (
                <Skeleton className="mt-2 h-8 w-20" />
              ) : (
                <p className="mt-1 text-[28px] font-semibold leading-none text-foreground">
                  {metric.value ?? "--"}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function NextSteps({
  error,
  onNavigate,
  onRetry,
  steps,
}: {
  error: boolean;
  onNavigate: (destination: HomeDestination) => void;
  onRetry: () => void;
  steps: NextStep[];
}) {
  return (
    <section>
      <div>
        <h2 className="text-[20px] font-semibold text-foreground">
          What needs attention
        </h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Suggestions based only on your current workspace state.
        </p>
      </div>

      <div className="mt-5 border-y border-border">
        {error ? (
          <div className="flex flex-col gap-4 py-6 sm:flex-row sm:items-center">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-rose-500/10 text-rose-600 dark:text-rose-400">
              <AlertCircle className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-medium text-foreground">
                Workspace data could not be loaded
              </p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Check your connection and try syncing again.
              </p>
            </div>
            <Button type="button" variant="outline" onClick={onRetry}>
              <RefreshCw className="h-4 w-4" />
              Retry
            </Button>
          </div>
        ) : steps.length > 0 ? (
          steps.map((step) => {
            const Icon = step.icon;
            return (
              <button
                key={step.label}
                type="button"
                onClick={() => onNavigate(step.destination)}
                className="flex w-full items-center gap-4 border-b border-border py-5 text-left last:border-b-0 hover:text-primary"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-primary">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-medium text-foreground">
                    {step.label}
                  </span>
                  <span className="mt-1 block text-[12px] text-muted-foreground">
                    {step.description}
                  </span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            );
          })
        ) : (
          <div className="flex items-center gap-4 py-6">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4" />
            </span>
            <div>
              <p className="text-[14px] font-medium text-foreground">
                Nothing needs immediate attention
              </p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Your workspace setup is complete.
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function AnalyticsOverview({
  error,
  loading,
  setupCompleted,
  usage,
}: {
  error: boolean;
  loading: boolean;
  setupCompleted: number;
  usage: UsageStats | null;
}) {
  const totals = [
    { name: "Forms", value: usage?.forms || 0 },
    { name: "Responses", value: usage?.responses || 0 },
    { name: "Workflows", value: usage?.workflows || 0 },
  ];
  const hasActivity = totals.some((item) => item.value > 0);
  const setupPercent = Math.round((setupCompleted / 3) * 100);
  const setupData = [{ name: "Setup", value: setupPercent }];

  return (
    <section>
      <div>
        <h2 className="text-[20px] font-semibold text-foreground">
          Workspace analytics
        </h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Live totals and setup progress from your workspace.
        </p>
      </div>

      <div className="mt-5 grid border-y border-border md:grid-cols-[1.25fr_0.75fr]">
        <div className="min-w-0 py-6 md:pr-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-[14px] font-semibold text-foreground">
                Workspace totals
              </h3>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Forms, responses and workflows
              </p>
            </div>
            <BarChart3 className="h-4 w-4 text-primary" />
          </div>

          {loading ? (
            <div className="mt-6 space-y-5">
              <Skeleton className="h-8 w-3/4" />
              <Skeleton className="h-8 w-1/2" />
              <Skeleton className="h-8 w-2/3" />
            </div>
          ) : error ? (
            <div className="flex h-[220px] items-center justify-center text-center">
              <div>
                <AlertCircle className="mx-auto h-5 w-5 text-rose-500" />
                <p className="mt-3 text-[12px] text-muted-foreground">
                  Analytics are unavailable until the workspace syncs.
                </p>
              </div>
            </div>
          ) : hasActivity ? (
            <div className="mt-4 h-[220px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={totals}
                  layout="vertical"
                  margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
                >
                  <CartesianGrid
                    stroke="hsl(var(--border))"
                    strokeDasharray="3 3"
                    horizontal={false}
                  />
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    axisLine={false}
                    tickLine={false}
                    tick={{
                      fill: "hsl(var(--muted-foreground))",
                      fontSize: 11,
                    }}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    width={72}
                    tick={{
                      fill: "hsl(var(--muted-foreground))",
                      fontSize: 11,
                    }}
                  />
                  <ChartTooltip
                    cursor={{ fill: "hsl(var(--muted) / 0.5)" }}
                    contentStyle={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 6,
                      color: "hsl(var(--popover-foreground))",
                      fontSize: 12,
                    }}
                  />
                  <Bar
                    dataKey="value"
                    fill="hsl(var(--primary))"
                    radius={[0, 4, 4, 0]}
                    barSize={16}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex h-[220px] items-center justify-center text-center">
              <div className="max-w-[260px]">
                <BarChart3 className="mx-auto h-5 w-5 text-muted-foreground" />
                <p className="mt-3 text-[13px] font-medium text-foreground">
                  No activity yet
                </p>
                <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                  Your totals chart will appear after you create a form or
                  workflow.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-border py-6 md:border-l md:border-t-0 md:pl-8">
          <h3 className="text-[14px] font-semibold text-foreground">
            Setup progress
          </h3>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Workspace, forms and workflows
          </p>

          {loading ? (
            <div className="flex h-[220px] items-center justify-center">
              <Skeleton className="h-36 w-36 rounded-full" />
            </div>
          ) : (
            <div className="relative mx-auto h-[220px] w-full max-w-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <RadialBarChart
                  data={setupData}
                  innerRadius="72%"
                  outerRadius="92%"
                  startAngle={90}
                  endAngle={-270}
                  cx="50%"
                  cy="50%"
                >
                  <PolarAngleAxis
                    type="number"
                    domain={[0, 100]}
                    angleAxisId={0}
                    tick={false}
                  />
                  <RadialBar
                    dataKey="value"
                    background={{ fill: "hsl(var(--muted))" }}
                    fill="hsl(var(--primary))"
                    cornerRadius={6}
                  />
                </RadialBarChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-[26px] font-semibold text-foreground">
                  {error ? "--" : `${setupPercent}%`}
                </span>
                <span className="mt-1 text-[11px] text-muted-foreground">
                  {error ? "Unavailable" : `${setupCompleted} of 3 complete`}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function QuickActions({
  onNavigate,
  onNotice,
  userId,
}: {
  onNavigate: (destination: HomeDestination) => void;
  onNotice: (message: string) => void;
  userId?: string;
}) {
  const orderKey = `maxform-home-action-order:${userId || "guest"}`;
  const pinsKey = `maxform-home-action-pins:${userId || "guest"}`;
  const [order, setOrder] = useState<string[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(orderKey) || "[]");
      const valid = Array.isArray(stored)
        ? stored.filter((id) =>
            quickActionCatalog.some((action) => action.id === id),
          )
        : [];
      return [
        ...valid,
        ...quickActionCatalog
          .map((action) => action.id)
          .filter((id) => !valid.includes(id)),
      ];
    } catch {
      return quickActionCatalog.map((action) => action.id);
    }
  });
  const [pinned, setPinned] = useState<string[]>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(pinsKey) || "[]");
      return Array.isArray(stored) ? stored : [];
    } catch {
      return [];
    }
  });
  const [draggedId, setDraggedId] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem(orderKey, JSON.stringify(order));
  }, [order, orderKey]);

  useEffect(() => {
    localStorage.setItem(pinsKey, JSON.stringify(pinned));
  }, [pinned, pinsKey]);

  const actions = order
    .map((id) => quickActionCatalog.find((action) => action.id === id))
    .filter((action): action is QuickAction => Boolean(action));

  const moveAction = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    setOrder((current) => {
      const next = [...current];
      const sourceIndex = next.indexOf(sourceId);
      const targetIndex = next.indexOf(targetId);
      if (sourceIndex < 0 || targetIndex < 0) return current;
      next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, sourceId);
      return next;
    });
  };

  const handleKeyboardReorder = (
    event: KeyboardEvent<HTMLDivElement>,
    actionId: string,
  ) => {
    if (!event.altKey || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = order.indexOf(actionId);
    const targetId = order[currentIndex + (event.key === "ArrowLeft" ? -1 : 1)];
    if (targetId) moveAction(actionId, targetId);
  };

  const togglePin = (actionId: string) => {
    setPinned((current) => {
      const isPinned = current.includes(actionId);
      onNotice(isPinned ? "Quick action unpinned." : "Quick action pinned.");
      return isPinned
        ? current.filter((id) => id !== actionId)
        : [...current, actionId];
    });
  };

  return (
    <section className="rounded-lg border border-border bg-card p-5 sm:p-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-[20px] font-semibold text-foreground">
            Quick actions
          </h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Your workspace tools, arranged your way.
          </p>
        </div>
        <span className="hidden items-center gap-1.5 text-[11px] text-muted-foreground sm:flex">
          <GripVertical className="h-3.5 w-3.5" />
          Drag to reorder
        </span>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-2 xl:grid-cols-4">
        {actions.map((action) => {
          const Icon = action.icon;
          const isPinned = pinned.includes(action.id);
          return (
            <div
              key={action.id}
              draggable
              tabIndex={0}
              onDragStart={(event: DragEvent<HTMLDivElement>) => {
                setDraggedId(action.id);
                event.dataTransfer.effectAllowed = "move";
              }}
              onDragEnd={() => setDraggedId(null)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (draggedId) moveAction(draggedId, action.id);
                setDraggedId(null);
              }}
              onKeyDown={(event) => handleKeyboardReorder(event, action.id)}
              className={cn(
                "group relative min-w-0 bg-card p-4 outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                draggedId === action.id && "opacity-50",
              )}
            >
              <button
                type="button"
                onClick={() => onNavigate(action.destination)}
                className="flex w-full items-start gap-3 pr-8 text-left"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-primary">
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                <span className="min-w-0 pt-0.5">
                  <span className="block truncate text-[14px] font-medium text-card-foreground">
                    {action.label}
                  </span>
                  <span className="mt-1 block truncate text-[11px] text-muted-foreground">
                    {action.meta}
                  </span>
                </span>
              </button>

              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => togglePin(action.id)}
                      className={cn(
                        "absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground",
                        isPinned && "text-primary",
                      )}
                      aria-label={isPinned ? `Unpin ${action.label}` : `Pin ${action.label}`}
                    >
                      {isPinned ? (
                        <PinOff className="h-3.5 w-3.5" />
                      ) : (
                        <Pin className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {isPinned ? "Unpin action" : "Pin action"}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function HomeDashboard({
  fullName,
  onNavigate,
  onNotice,
  userId,
  workspaceLogo,
  workspaceName,
}: HomeDashboardProps) {
  const usageQuery = useQuery({
    enabled: Boolean(userId),
    queryKey: ["home-dashboard", "usage", userId || "anonymous"],
    queryFn: () => getUsageStats(userId!),
    staleTime: 15_000,
    retry: false,
  });
  const loading = Boolean(userId && usageQuery.isLoading);
  const error = usageQuery.isError;
  const usage = usageQuery.data || null;

  const setupCompleted =
    Number(Boolean(workspaceName.trim())) +
    Number(Boolean(usage?.forms)) +
    Number(Boolean(usage?.workflows));
  const nextSteps: NextStep[] = [];

  if (!error && !loading) {
    if (!workspaceName.trim()) {
      nextSteps.push({
        icon: Building2,
        label: "Complete workspace details",
        description: "Add your workspace name and identity.",
        destination: "settings",
      });
    }
    if (!usage?.forms) {
      nextSteps.push({
        icon: FileText,
        label: "Create your first form",
        description: "Start collecting useful responses.",
        destination: "form-templates",
      });
    } else if (!usage.responses) {
      nextSteps.push({
        icon: ContactRound,
        label: "Collect your first response",
        description: "Open Forms to publish and share your form.",
        destination: "forms",
      });
    }
    if (!usage?.workflows) {
      nextSteps.push({
        icon: Workflow,
        label: "Create your first workflow",
        description: "Automate what happens after a response.",
        destination: "workflows",
      });
    }
  }

  return (
    <div className="space-y-10 pb-12 sm:space-y-12">
      <WorkspaceHero
        error={error}
        fullName={fullName}
        loading={loading}
        workspaceLogo={workspaceLogo}
        onNavigate={onNavigate}
        setupComplete={setupCompleted === 3}
      />
      <AnalyticsOverview
        error={error}
        loading={loading}
        setupCompleted={setupCompleted}
        usage={usage}
      />
      <WorkspaceOverview
        error={error}
        loading={loading}
        setupCompleted={setupCompleted}
        usage={usage}
      />
      <NextSteps
        error={error}
        steps={nextSteps}
        onNavigate={onNavigate}
        onRetry={() => void usageQuery.refetch()}
      />
      <QuickActions
        userId={userId}
        onNavigate={onNavigate}
        onNotice={onNotice}
      />
    </div>
  );
}

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import {
  AtSign,
  CalendarClock,
  ChartLine,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileCheck2,
  FileSignature,
  FolderKanban,
  FolderOpen,
  KeyRound,
  LayoutDashboard,
  LayoutTemplate,
  Loader2,
  PlugZap,
  LogOut,
  Megaphone,
  MousePointer2,
  Moon,
  ArrowLeftToLine,
  ArrowRightToLine,
  Save,
  Settings,
  Settings2,
  BrainCircuit,
  ShieldAlert,
  ShoppingBag,
  Store,
  Sun,
  Ticket,
  Trash2,
  UsersRound,
  WalletCards,
  Workflow,
  type LucideIcon,
} from "lucide-react";

import { BrandLogo } from "@/components/BrandLogo";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { FloatingAssistant } from "@/components/assistant/FloatingAssistant";
import { AssistantControllerProvider } from "@/components/assistant/AssistantControllerProvider";
import type { AIWorkspaceTab } from "@/components/assistant/AIWorkspaceModule";
import type { AssistantScreenContext } from "@/lib/ai-assistant";
import { DashboardLiveSync } from "@/components/dashboard/DashboardLiveSync";
import { NotificationCenter } from "@/components/dashboard/NotificationCenter";
import type { HomeDestination } from "@/components/dashboard/HomeDashboard";
import type {
  FormDraftGuard,
  FormsTab,
} from "@/components/forms/FormsModule";
import {
  DEFAULT_FORMS_TAB,
  FORM_TAB_ORDER,
} from "@/components/forms/form-navigation";
import type { EventsTab } from "@/components/events/event-types";
import type { FilesTab } from "@/components/files/FilesModule";
import type { DocumentsTab } from "@/components/documents/DocumentsModule";
import type { CrmTab } from "@/components/crm/CrmModule";
import {
  PROJECT_TABS,
  type ProjectsTab,
} from "@/components/projects/project-tabs";
import type { AppointmentsTab } from "@/components/appointments/AppointmentsModule";
import type { EmailTab } from "@/components/email/EmailModule";
import type { CampaignTab } from "@/components/campaigns/CampaignsModule";
import type { IntegrationsTab } from "@/components/integrations/IntegrationsHub";
import type { CmsStoresTab, StoreConnectorTab } from "@/lib/cms-stores";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { OnboardingFlow } from "@/components/onboarding/OnboardingFlow";
import { useAuth } from "@/contexts/AuthContext";
import {
  completeOnboarding,
  getOnboardingState,
  saveOnboardingStep,
  skipOnboarding,
} from "@/lib/onboarding";
import { useWorkspaceIdentity } from "@/hooks/use-workspace-logo";
import { scrollDashboardToTop } from "@/lib/dashboard-scroll";
import { cn } from "@/lib/utils";
import { moduleAccessAllows } from "@/lib/workspace-modules";
import {
  DEFAULT_ORDERS_TAB,
  isOrdersTab,
  type OrdersTab,
} from "@/components/orders/order-tabs";

const loadCrmModule = () =>
  import("@/components/crm/CrmModule").then((module) => ({
    default: module.CrmModule,
  }));
const loadCampaignsModule = () =>
  import("@/components/campaigns/CampaignsModule").then((module) => ({
    default: module.CampaignsModule,
  }));
const loadEventsModule = () =>
  import("@/components/events/EventsModule").then((module) => ({
    default: module.EventsModule,
  }));
const loadFormsModule = () =>
  import("@/components/forms/FormsModule").then((module) => ({
    default: module.FormsModule,
  }));
const loadHomeDashboard = () =>
  import("@/components/dashboard/HomeDashboard").then((module) => ({
    default: module.HomeDashboard,
  }));
const loadPaymentsModule = () =>
  import("@/components/payments/PaymentsModule").then((module) => ({
    default: module.PaymentsModule,
  }));
const loadAnalyticsModule = () =>
  import("@/components/analytics/AnalyticsModule").then((module) => ({
    default: module.AnalyticsModule,
  }));
const loadEmailModule = () =>
  import("@/components/email/EmailModule").then((module) => ({
    default: module.EmailModule,
  }));
const loadFilesModule = () =>
  import("@/components/files/FilesModule").then((module) => ({
    default: module.FilesModule,
  }));
const loadDocumentsModule = () =>
  import("@/components/documents/DocumentsModule").then((module) => ({
    default: module.DocumentsModule,
  }));
const loadAppointmentsModule = () =>
  import("@/components/appointments/AppointmentsModule").then((module) => ({
    default: module.AppointmentsModule,
  }));
const loadIntegrationsModule = () =>
  import("@/components/integrations/IntegrationsHub").then((module) => ({
    default: module.IntegrationsHub,
  }));
const loadOrdersModule = () =>
  import("@/components/orders/OrdersModule").then((module) => ({
    default: module.OrdersModule,
  }));
const loadProjectsModule = () =>
  import("@/components/projects/ProjectsModule").then((module) => ({
    default: module.ProjectsModule,
  }));
const loadWorkflowsModule = () =>
  import("@/components/workflows/WorkflowsModule").then((module) => ({
    default: module.WorkflowsModule,
  }));
const loadSettingsContent = () =>
  import("@/pages/Settings").then((module) => ({
    default: module.SettingsContent,
  }));
const loadAiWorkspaceModule = () =>
  import("@/components/assistant/AIWorkspaceModule").then((module) => ({
    default: module.AIWorkspaceModule,
  }));
const loadCmsStoresModule = () =>
  import("@/components/stores/CmsStoresModule").then((module) => ({
    default: module.CmsStoresModule,
  }));
const loadStoreConnectorModule = () =>
  import("@/components/stores/StoreConnectorModule").then((module) => ({
    default: module.StoreConnectorModule,
  }));

const CrmModule = lazy(loadCrmModule);
const CampaignsModule = lazy(loadCampaignsModule);
const EventsModule = lazy(loadEventsModule);
const FormsModule = lazy(loadFormsModule);
const HomeDashboard = lazy(loadHomeDashboard);
const PaymentsModule = lazy(loadPaymentsModule);
const AnalyticsModule = lazy(loadAnalyticsModule);
const EmailModule = lazy(loadEmailModule);
const FilesModule = lazy(loadFilesModule);
const DocumentsModule = lazy(loadDocumentsModule);
const AppointmentsModule = lazy(loadAppointmentsModule);
const IntegrationsHub = lazy(loadIntegrationsModule);
const OrdersModule = lazy(loadOrdersModule);
const ProjectsModule = lazy(loadProjectsModule);
const WorkflowsModule = lazy(loadWorkflowsModule);
const SettingsContent = lazy(loadSettingsContent);
const AIWorkspaceModule = lazy(loadAiWorkspaceModule);
const CmsStoresModule = lazy(loadCmsStoresModule);
const StoreConnectorModule = lazy(loadStoreConnectorModule);

function DashboardModuleFallback() {
  return (
    <div className="animate-pulse" role="status" aria-label="Loading workspace">
      <div className="h-9 w-56 rounded bg-muted" />
      <div className="mt-3 h-4 w-80 max-w-full rounded bg-muted/70" />
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((item) => (
          <div key={item} className="h-28 rounded-md border border-border bg-card" />
        ))}
      </div>
      <div className="mt-7 h-[320px] rounded-md border border-border bg-card" />
    </div>
  );
}

type WorkspaceKey =
  | "home"
  | "projects"
  | "forms"
  | "events"
  | "workflows"
  | "payments"
  | "orders"
  | "stores"
  | "store_connector"
  | "crm"
  | "campaigns"
  | "appointments"
  | "files"
  | "analytics"
  | "ai"
  | "emails"
  | "documents"
  | "integrations"
  | "settings";

type WorkspaceModule = {
  key: WorkspaceKey;
  label: string;
  icon: LucideIcon;
  title: string;
  subtitle: string;
};

const primaryModules: WorkspaceModule[] = [
  {
    key: "home",
    label: "Home",
    icon: LayoutDashboard,
    title: "12 live forms, one clear view",
    subtitle: "Workspace overview",
  },
  {
    key: "analytics" as const,
    label: "Analytics",
    icon: ChartLine,
    title: "See where every response converts",
    subtitle: "68% average completion",
  },
  {
    key: "projects",
    label: "Projects",
    icon: FolderKanban,
    title: "Everything for your next launch",
    subtitle: "4 active projects",
  },
  {
    key: "crm",
    label: "CRM",
    icon: UsersRound,
    title: "Relationships, revenue, and follow-through",
    subtitle: "Connected CRM workspace",
  },
  {
    key: "campaigns",
    label: "Campaigns",
    icon: Megaphone,
    title: "Campaigns",
    subtitle: "Audience messaging workspace",
  },
  {
    key: "forms",
    label: "Forms",
    icon: ClipboardList,
    title: "Forms people enjoy finishing",
    subtitle: "12 published forms",
  },
  {
    key: "events",
    label: "Events",
    icon: Ticket,
    title: "Events, tickets, and arrivals",
    subtitle: "Event workspace",
  },
  {
    key: "appointments",
    label: "Appointments",
    icon: CalendarClock,
    title: "Bookings without the back-and-forth",
    subtitle: "18 bookings this week",
  },
  {
    key: "workflows",
    label: "Workflows",
    icon: Workflow,
    title: "Build workflows across your workspace",
    subtitle: "Cross-module automation engine",
  },
  {
    key: "files",
    label: "Files",
    icon: FolderOpen,
    title: "Every upload, neatly organized",
    subtitle: "2.4 GB of 10 GB",
  },
  {
    key: "documents",
    label: "Documents",
    icon: FileSignature,
    title: "Turn submissions into signed work",
    subtitle: "32 documents sent",
  },
  {
    key: "payments",
    label: "Payments",
    icon: WalletCards,
    title: "Payments",
    subtitle: "Commerce workspace",
  },
  {
    key: "orders",
    label: "Orders",
    icon: ShoppingBag,
    title: "Every sale, one ledger",
    subtitle: "Workspace orders",
  },
  {
    key: "stores",
    label: "Connected stores",
    icon: ShoppingBag,
    title: "Shopify, WooCommerce, and every store in one place",
    subtitle: "Products, orders, and live sync",
  },
];

const utilityModules: WorkspaceModule[] = [
  {
    key: "ai",
    label: "MaxAI",
    icon: BrainCircuit,
    title: "Build your next form with Max AI",
    subtitle: "24 generations this month",
  },
  {
    key: "emails",
    label: "Email settings",
    icon: AtSign,
    title: "Messages that arrive on cue",
    subtitle: "98.4% delivery rate",
  },
  {
    key: "integrations",
    label: "Integrations",
    icon: PlugZap,
    title: "One secure connection layer for every module",
    subtitle: "Workspace integration hub",
  },
  {
    key: "store_connector",
    label: "Store connector",
    icon: Store,
    title: "Connect commerce platforms once",
    subtitle: "Shared provider connection layer",
  },
  {
    key: "settings" as const,
    label: "Settings",
    icon: Settings2,
    title: "Make MaxForm unmistakably yours",
    subtitle: "Workspace settings",
  },
];

const allModules = [...primaryModules, ...utilityModules];

const SIDEBAR_COLLAPSED_KEY = "maxform.dashboard.sidebar-collapsed";

const readCollapsedPreference = () => {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
};

/** Label shown on hover once the sidebar is collapsed to an icon rail. */
function SidebarHint({
  label,
  show,
  children,
}: {
  label: string;
  show: boolean;
  children: React.ReactNode;
}) {
  if (!show) return <>{children}</>;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" sideOffset={10} className="px-2 py-1 text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

type WorkspaceModulePreloader = (userId?: string) => Promise<unknown>;

const workspaceModulePreloaders: Partial<
  Record<WorkspaceKey, WorkspaceModulePreloader>
> = {
  campaigns: loadCampaignsModule,
  crm: loadCrmModule,
  events: loadEventsModule,
  forms: loadFormsModule,
  home: loadHomeDashboard,
  payments: loadPaymentsModule,
  analytics: async (userId) => {
    const preloadData = userId
      ? import("@/lib/performance/analytics-module-preload").then((module) =>
          module.preloadAnalyticsModuleData(userId),
        )
      : Promise.resolve();
    await Promise.all([loadAnalyticsModule(), preloadData]);
  },
  emails: async (userId) => {
    const preloadData = userId
      ? import("@/lib/performance/email-module-preload").then((module) =>
          module.preloadEmailModuleData(userId),
        )
      : Promise.resolve();
    await Promise.all([loadEmailModule(), preloadData]);
  },
  files: loadFilesModule,
  documents: loadDocumentsModule,
  orders: loadOrdersModule,
  appointments: loadAppointmentsModule,
  integrations: loadIntegrationsModule,
  settings: loadSettingsContent,
  workflows: loadWorkflowsModule,
  stores: loadCmsStoresModule,
  store_connector: loadStoreConnectorModule,
  ai: loadAiWorkspaceModule,
};

const warmWorkspaceModule = (key: WorkspaceKey, userId?: string) =>
  workspaceModulePreloaders[key]?.(userId) || Promise.resolve();

const preloadWorkspaceModule = (key: WorkspaceKey, userId?: string) => {
  void warmWorkspaceModule(key, userId);
};

const dashboardWarmupBatches: WorkspaceKey[][] = [
  ["emails", "forms", "events"],
  ["crm", "campaigns", "payments", "analytics", "settings", "integrations", "store_connector"],
  ["files", "documents"],
];

type IdleWindow = Window & {
  requestIdleCallback?: (
    callback: () => void,
    options?: { timeout: number },
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
};

const topTabs = [
  { key: "overview", label: "overview", module: "home" as WorkspaceKey },
  { key: "responses", label: "responses", module: "forms" as WorkspaceKey },
  // This header shortcut stays attached to Forms so the existing form
  // automation builder remains available while the side-rail Workflows
  // surface becomes its own future engine.
  { key: "automations", label: "automations", module: "forms" as WorkspaceKey },
  { key: "analytics", label: "analytics", module: "analytics" as WorkspaceKey },
];

const formTabs: readonly FormsTab[] = FORM_TAB_ORDER;

const eventTabs: EventsTab[] = [
  "all",
  "templates",
  "email_templates",
  "tickets",
  "checkin",
  "pricing",
  "analytics",
  "settings",
];

const filesTabs: FilesTab[] = [
  "all",
  "shared",
  "trash",
  "storage",
  "external",
  "settings",
];
const documentsTabs: DocumentsTab[] = ["templates", "sent", "settings"];

type ViewMode = "form" | "list" | "flow" | "chart" | "editor";
type ContextView = "overview" | "work" | "goal";

type ViewRow = {
  label: string;
  value: string;
};

type WorkspaceView = {
  mode: ViewMode;
  featureLabel: string;
  featureMeta: string;
  progress: number;
  kicker: string;
  headline: string;
  panelTitle: string;
  panelDescription: string;
  action: string;
  nextTitle: string;
  nextAction: string;
  rows: ViewRow[];
  goalLabel: string;
  goalValue: string;
  goalTarget: string;
  goalPercent: number;
  message: string;
};

const workspaceViews: Record<WorkspaceKey, WorkspaceView> = {
  home: {
    mode: "form",
    featureLabel: "Customer feedback",
    featureMeta: "812 responses",
    progress: 78,
    kicker: "Customer pulse",
    headline: "Help us make your experience better.",
    panelTitle: "How likely are you to recommend MaxForm?",
    panelDescription: "Question 4 of 6",
    action: "Continue",
    nextTitle: "Next",
    nextAction: "View all forms",
    rows: [
      { label: "Client intake", value: "24 responses" },
      { label: "Product research", value: "41 responses" },
      { label: "Event RSVP", value: "18 responses" },
    ],
    goalLabel: "Response goal",
    goalValue: "812",
    goalTarget: "1,000",
    goalPercent: 81,
    message: "Great work. You are on track this month.",
  },
  projects: {
    mode: "list",
    featureLabel: "Product launch",
    featureMeta: "12 collaborators",
    progress: 74,
    kicker: "Project workspace",
    headline: "Launch every asset from one organized place.",
    panelTitle: "Launch readiness",
    panelDescription: "18 of 24 tasks complete",
    action: "Open project",
    nextTitle: "Active projects",
    nextAction: "View all projects",
    rows: [
      { label: "Product launch", value: "74% complete" },
      { label: "Client onboarding", value: "8 tasks left" },
      { label: "Summer event", value: "Ready to launch" },
    ],
    goalLabel: "Project goal",
    goalValue: "18",
    goalTarget: "24 tasks",
    goalPercent: 75,
    message: "The launch plan is on schedule for Friday.",
  },
  forms: {
    mode: "form",
    featureLabel: "Lead qualification",
    featureMeta: "486 responses",
    progress: 86,
    kicker: "Published form",
    headline: "Qualify every lead before your team follows up.",
    panelTitle: "What would you like help with?",
    panelDescription: "Question 3 of 5",
    action: "Open builder",
    nextTitle: "Recent forms",
    nextAction: "Manage forms",
    rows: [
      { label: "Client intake", value: "24 responses" },
      { label: "Product research", value: "41 responses" },
      { label: "Event RSVP", value: "18 responses" },
    ],
    goalLabel: "Completion rate",
    goalValue: "86%",
    goalTarget: "90%",
    goalPercent: 86,
    message: "Completion is up 12% after your last edit.",
  },
  events: {
    mode: "list",
    featureLabel: "Event workspace",
    featureMeta: "Tickets and check-in",
    progress: 0,
    kicker: "Events",
    headline: "Build event pages, tickets, and arrivals in one place.",
    panelTitle: "Event workspace",
    panelDescription: "No event selected",
    action: "Create event",
    nextTitle: "Events",
    nextAction: "View all events",
    rows: [
      { label: "Event Builder", value: "Brand and publish" },
      { label: "Ticket Studio", value: "Price and design" },
      { label: "Check-in", value: "Secure scanning" },
    ],
    goalLabel: "Attendance",
    goalValue: "0",
    goalTarget: "0",
    goalPercent: 0,
    message: "Create an event to start tracking attendance.",
  },
  workflows: {
    mode: "flow",
    featureLabel: "Standalone workflow engine",
    featureMeta: "Not available yet",
    progress: 0,
    kicker: "Workflows",
    headline: "Build cross-workspace automations in one place.",
    panelTitle: "Coming soon",
    panelDescription: "The new workflow engine is being prepared.",
    action: "Coming soon",
    nextTitle: "Workflow engine",
    nextAction: "Coming soon",
    rows: [],
    goalLabel: "Build status",
    goalValue: "Soon",
    goalTarget: "",
    goalPercent: 0,
    message: "Form automations remain available in Forms.",
  },
  payments: {
    mode: "chart",
    featureLabel: "Payment volume",
    featureMeta: "No processed payments",
    progress: 0,
    kicker: "Payments",
    headline: "Track every order, invoice, and recurring payment.",
    panelTitle: "$0.00",
    panelDescription: "Connect a provider to begin",
    action: "View orders",
    nextTitle: "Top products",
    nextAction: "Open payments",
    rows: [
      { label: "Products", value: "$0.00" },
      { label: "Event tickets", value: "$0.00" },
      { label: "Subscriptions", value: "$0.00" },
    ],
    goalLabel: "Revenue goal",
    goalValue: "$0.00",
    goalTarget: "$0.00",
    goalPercent: 0,
    message: "Revenue will appear after the first confirmed payment.",
  },
  crm: {
    mode: "list",
    featureLabel: "High-intent leads",
    featureMeta: "428 contacts",
    progress: 64,
    kicker: "Connected CRM",
    headline: "Turn every relationship signal into forward motion.",
    panelTitle: "Pipeline and relationships",
    panelDescription: "Updated 8 minutes ago",
    action: "Open segment",
    nextTitle: "CRM priorities",
    nextAction: "Open CRM",
    rows: [
      { label: "High-intent leads", value: "428 contacts" },
      { label: "New customers", value: "186 contacts" },
      { label: "Newsletter", value: "1,872 contacts" },
    ],
    goalLabel: "Profile coverage",
    goalValue: "84%",
    goalTarget: "100%",
    goalPercent: 84,
    message: "186 contact profiles were enriched this week.",
  },
  campaigns: {
    mode: "list",
    featureLabel: "Campaigns",
    featureMeta: "Audience messaging",
    progress: 0,
    kicker: "Campaigns",
    headline: "Create and schedule messages for every CRM audience.",
    panelTitle: "Campaign activity",
    panelDescription: "Live delivery reporting",
    action: "Create campaign",
    nextTitle: "Audiences",
    nextAction: "Open campaigns",
    rows: [],
    goalLabel: "Delivery goal",
    goalValue: "0",
    goalTarget: "0",
    goalPercent: 0,
    message: "Campaign performance appears after the first send.",
  },
  appointments: {
    mode: "list",
    featureLabel: "Team calendar",
    featureMeta: "18 bookings this week",
    progress: 72,
    kicker: "Appointments",
    headline: "Give every lead a clear path to the right meeting.",
    panelTitle: "Today's schedule",
    panelDescription: "4 meetings remaining",
    action: "Open calendar",
    nextTitle: "Booking types",
    nextAction: "Manage calendar",
    rows: [
      { label: "Discovery calls", value: "9 bookings" },
      { label: "Product demos", value: "6 bookings" },
      { label: "Consultations", value: "3 bookings" },
    ],
    goalLabel: "Booking goal",
    goalValue: "18",
    goalTarget: "25",
    goalPercent: 72,
    message: "Thursday still has three open booking slots.",
  },
  files: {
    mode: "chart",
    featureLabel: "Workspace storage",
    featureMeta: "2.4 GB of 10 GB",
    progress: 24,
    kicker: "File manager",
    headline: "Find every upload, agreement, and brand asset fast.",
    panelTitle: "2.4 GB used",
    panelDescription: "126 files across 8 folders",
    action: "Browse files",
    nextTitle: "Largest folders",
    nextAction: "Open file manager",
    rows: [
      { label: "Product uploads", value: "1.2 GB" },
      { label: "Signed agreements", value: "640 MB" },
      { label: "Brand assets", value: "420 MB" },
    ],
    goalLabel: "Storage used",
    goalValue: "2.4 GB",
    goalTarget: "10 GB",
    goalPercent: 24,
    message: "You have 7.6 GB of workspace storage left.",
  },
  analytics: {
    mode: "chart",
    featureLabel: "Conversion funnel",
    featureMeta: "Last 30 days",
    progress: 68,
    kicker: "Analytics",
    headline: "See exactly where people convert or drop away.",
    panelTitle: "68% completion",
    panelDescription: "Up 7.4% from last month",
    action: "Explore report",
    nextTitle: "Funnel stages",
    nextAction: "View full analytics",
    rows: [
      { label: "Visitors", value: "6,420" },
      { label: "Started", value: "4,810" },
      { label: "Completed", value: "3,274" },
    ],
    goalLabel: "Conversion goal",
    goalValue: "68%",
    goalTarget: "75%",
    goalPercent: 68,
    message: "Mobile completion improved by 9.2%.",
  },
  ai: {
    mode: "editor",
    featureLabel: "Max AI",
    featureMeta: "24 generations this month",
    progress: 80,
    kicker: "AI workspace",
    headline: "Describe the outcome. Max AI builds the form.",
    panelTitle: "Create a lead qualification form for a design studio",
    panelDescription: "Tone: concise and professional",
    action: "Generate form",
    nextTitle: "Recent generations",
    nextAction: "Open AI workspace",
    rows: [
      { label: "Lead qualification", value: "Ready" },
      { label: "Customer survey", value: "Draft" },
      { label: "Event flow", value: "Published" },
    ],
    goalLabel: "AI credits",
    goalValue: "24",
    goalTarget: "30",
    goalPercent: 80,
    message: "Six AI generations remain in this cycle.",
  },
  emails: {
    mode: "chart",
    featureLabel: "Onboarding campaign",
    featureMeta: "1,248 recipients",
    progress: 84,
    kicker: "Email delivery",
    headline: "Send the right message the moment data arrives.",
    panelTitle: "42% open rate",
    panelDescription: "98.4% delivered successfully",
    action: "View campaign",
    nextTitle: "Email automations",
    nextAction: "Open email center",
    rows: [
      { label: "Welcome sequence", value: "42% opens" },
      { label: "Booking reminders", value: "68% opens" },
      { label: "Payment receipts", value: "100% delivered" },
    ],
    goalLabel: "Delivery goal",
    goalValue: "98.4%",
    goalTarget: "99%",
    goalPercent: 98,
    message: "Email identity and domain health look strong.",
  },
  orders: {
    mode: "list",
    featureLabel: "Workspace orders",
    featureMeta: "Every source in one ledger",
    progress: 0,
    kicker: "Orders",
    headline: "Every sale the workspace has taken, in one ledger.",
    panelTitle: "Recent orders",
    panelDescription: "Filter by source, status or customer",
    action: "View orders",
    nextTitle: "Order sources",
    nextAction: "Open orders",
    rows: [
      { label: "Forms", value: "Product and cart checkout" },
      { label: "Events", value: "Ticket sales" },
      { label: "Invoices", value: "Billed directly" },
    ],
    goalLabel: "Settled revenue",
    goalValue: "$0.00",
    goalTarget: "$0.00",
    goalPercent: 0,
    message: "Orders appear as soon as a form, event or invoice takes payment.",
  },
  stores: {
    mode: "list",
    featureLabel: "Connected stores",
    featureMeta: "Shopify and WooCommerce",
    progress: 0,
    kicker: "Commerce command center",
    headline: "Manage every connected store from one workspace.",
    panelTitle: "Store operations",
    panelDescription: "Products, categories, orders and live sync",
    action: "Open stores",
    nextTitle: "Connected sites",
    nextAction: "View connected sites",
    rows: [
      { label: "Products", value: "Synced from your stores" },
      { label: "Orders", value: "One operations view" },
      { label: "Sync", value: "Webhooks and reconciliation" },
    ],
    goalLabel: "Store health",
    goalValue: "Ready",
    goalTarget: "Connect a site",
    goalPercent: 0,
    message: "Connect Shopify or WooCommerce to begin managing commerce here.",
  },
  documents: {
    mode: "editor",
    featureLabel: "Service agreement",
    featureMeta: "18 signatures collected",
    progress: 82,
    kicker: "Documents",
    headline: "Generate polished documents from every response.",
    panelTitle: "Service Agreement - Acme Studio",
    panelDescription: "2 signature fields · Ready to send",
    action: "Review document",
    nextTitle: "Document templates",
    nextAction: "View documents",
    rows: [
      { label: "Service agreement", value: "18 signed" },
      { label: "Offer letter", value: "7 signed" },
      { label: "Consent form", value: "32 signed" },
    ],
    goalLabel: "Signature goal",
    goalValue: "57",
    goalTarget: "70",
    goalPercent: 81,
    message: "Five documents are awaiting a signature.",
  },
  settings: {
    mode: "editor",
    featureLabel: "Workspace identity",
    featureMeta: "Last updated today",
    progress: 88,
    kicker: "Settings",
    headline: "Keep the whole workspace secure and on brand.",
    panelTitle: "MaxForm Studio",
    panelDescription: "Primary domain: forms.maxform.co",
    action: "Edit settings",
    nextTitle: "Workspace setup",
    nextAction: "Open all settings",
    rows: [
      { label: "Branding", value: "Complete" },
      { label: "Team", value: "8 members" },
      { label: "Domains", value: "2 verified" },
    ],
    goalLabel: "Setup progress",
    goalValue: "88%",
    goalTarget: "100%",
    goalPercent: 88,
    message: "Add a backup admin to finish workspace setup.",
  },
  integrations: {
    mode: "list",
    featureLabel: "Integration hub",
    featureMeta: "Central workspace connections",
    progress: 0,
    kicker: "Integrations",
    headline: "One secure connection layer for every MaxForm module.",
    panelTitle: "Connected apps",
    panelDescription: "Connect providers once and monitor their health in one place.",
    action: "Open integrations",
    nextTitle: "Workspace tools",
    nextAction: "Manage connections",
    rows: [
      { label: "Provider directory", value: "Central" },
      { label: "Automatic availability", value: "Connected" },
      { label: "Activity & health", value: "Audited" },
    ],
    goalLabel: "Connection coverage",
    goalValue: "0",
    goalTarget: "0",
    goalPercent: 0,
    message: "Connect a provider to make it available to your modules.",
  },
  store_connector: {
    mode: "list",
    featureLabel: "Store connector",
    featureMeta: "Shopify, WooCommerce and more",
    progress: 0,
    kicker: "Commerce connection layer",
    headline: "Connect store platforms once and use them everywhere.",
    panelTitle: "Provider connections",
    panelDescription: "Encrypted, workspace-scoped and shared across modules",
    action: "Browse providers",
    nextTitle: "Connected stores",
    nextAction: "Manage synced commerce",
    rows: [
      { label: "Available now", value: "Shopify and WooCommerce" },
      { label: "Shared data", value: "CRM, orders, analytics, workflows" },
      { label: "Sync", value: "Webhooks and reconciliation" },
    ],
    goalLabel: "Connection health",
    goalValue: "Ready",
    goalTarget: "Connect a provider",
    goalPercent: 0,
    message: "Connect a store platform to make its data available throughout the workspace.",
  },
};

const miniAccents = ["bg-primary", "bg-foreground", "bg-primary/60"];
const miniFields = [
  ["w-3/4", "w-full", "w-2/3"],
  ["w-full", "w-4/5", "w-1/2"],
  ["w-2/3", "w-full", "w-3/4"],
];

function MiniForm({
  accent,
  fields,
}: {
  accent: string;
  fields: string[];
}) {
  return (
    <div className="relative mx-auto h-[82px] w-full max-w-[116px] overflow-hidden rounded-md border border-border bg-card px-3 py-3 shadow-[0_12px_24px_rgba(31,38,61,0.08)] dark:shadow-none">
      <div className={cn("absolute inset-x-0 top-0 h-1", accent)} />
      <div className="mb-2 h-1.5 w-10 rounded-full bg-foreground" />
      <div className="space-y-2">
        {fields.map((field, index) => (
          <div key={`${field}-${index}`} className={cn("h-1 rounded-full bg-muted", field)} />
        ))}
      </div>
      <div className={cn("mt-2 h-2 w-8 rounded-sm", accent)} />
    </div>
  );
}

function PreviewPanel({
  view,
  icon: Icon,
  onAction,
}: {
  view: WorkspaceView;
  icon: LucideIcon;
  onAction: () => void;
}) {
  const panelContent = (() => {
    if (view.mode === "form") {
      return (
        <>
          <p className="text-[13px] font-medium text-muted-foreground">04 / 06</p>
          <h3 className="mt-3 text-[19px] font-semibold leading-6 text-foreground">
            {view.panelTitle}
          </h3>
          <div className="mt-6 flex min-w-0 justify-between gap-1">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((score) => (
              <span
                key={score}
                className={cn(
                  "flex h-8 min-w-0 flex-1 items-center justify-center rounded-sm border text-[12px]",
                  score === 9
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground",
                )}
              >
                {score}
              </span>
            ))}
          </div>
          <div className="mt-3 flex justify-between text-[12px] text-muted-foreground">
            <span>Not likely</span>
            <span>Very likely</span>
          </div>
        </>
      );
    }

    if (view.mode === "flow") {
      return (
        <>
          <p className="text-[13px] font-medium uppercase text-primary">Live automation</p>
          <h3 className="mt-3 text-[19px] font-semibold text-foreground">{view.panelTitle}</h3>
          <div className="mt-7 flex items-center">
            {[ClipboardList, Workflow, Check].map((StepIcon, index) => (
              <div key={index} className="flex min-w-0 flex-1 items-center">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-background text-primary">
                  <StepIcon className="h-4 w-4" />
                </span>
                {index < 2 && <span className="h-px min-w-3 flex-1 bg-border" />}
              </div>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-[12px] text-muted-foreground">
            <span>Capture</span>
            <span>Route</span>
            <span>Complete</span>
          </div>
        </>
      );
    }

    if (view.mode === "chart") {
      return (
        <>
          <p className="text-[13px] font-medium uppercase text-primary">Performance</p>
          <h3 className="mt-2 text-[22px] font-semibold text-foreground">{view.panelTitle}</h3>
          <p className="mt-1 text-[12px] text-muted-foreground">{view.panelDescription}</p>
          <div className="mt-6 flex h-20 items-end gap-2">
            {[38, 52, 44, 68, 58, 78, 72, 92, 84, view.goalPercent].map((height, index) => (
              <span
                key={index}
                className={cn(
                  "min-w-0 flex-1 rounded-t-sm",
                  index === 9 ? "bg-primary" : "bg-muted",
                )}
                style={{ height: `${Math.max(18, height)}%` }}
              />
            ))}
          </div>
        </>
      );
    }

    if (view.mode === "editor") {
      return (
        <>
          <p className="text-[13px] font-medium uppercase text-primary">Workspace draft</p>
          <div className="mt-3 rounded-md border border-border bg-muted/60 p-4">
            <h3 className="text-[16px] font-semibold leading-5 text-foreground">{view.panelTitle}</h3>
            <p className="mt-2 text-[12px] leading-5 text-muted-foreground">{view.panelDescription}</p>
          </div>
          {view.kicker === "Settings" ? (
            <div className="mt-4 flex items-center gap-2">
              {["#171717", "#64748b", "#cbd5e1", "#f8fafc"].map((color) => (
                <span
                  key={color}
                  className="h-5 w-5 rounded-full border border-border"
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          ) : (
            <div className="mt-4 flex gap-2">
              {view.rows.map((row) => (
                <span
                  key={row.label}
                  className="truncate rounded-sm border border-border px-2 py-1.5 text-[12px] text-primary"
                >
                  {row.label}
                </span>
              ))}
            </div>
          )}
        </>
      );
    }

    return (
      <>
        <p className="text-[13px] font-medium uppercase text-primary">{view.panelTitle}</p>
        <p className="mt-2 text-[12px] text-muted-foreground">{view.panelDescription}</p>
        <div className="mt-5 space-y-2.5">
          {view.rows.map((row, index) => (
            <div
              key={row.label}
              className="flex items-center gap-3 rounded-md border border-border px-3 py-2.5"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-[12px] font-semibold text-primary">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground">
                {row.label}
              </span>
              <span className="shrink-0 text-[12px] text-muted-foreground">{row.value}</span>
            </div>
          ))}
        </div>
      </>
    );
  })();

  return (
    <div className="group absolute bottom-3 left-1/2 w-[88%] max-w-[590px] -translate-x-1/2 text-left">
      <span className="absolute -left-9 top-[104px] hidden h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_12px_28px_rgba(100,116,139,0.3)] transition-transform group-hover:-translate-y-1 sm:flex">
        <MousePointer2 className="h-4 w-4" />
      </span>
      <div className="overflow-hidden rounded-md border border-border bg-card shadow-[0_30px_55px_rgba(36,42,67,0.12)] transition-transform duration-300 group-hover:-translate-y-1 dark:shadow-none">
        <div className="h-2 bg-primary" />
        <div className="grid min-h-[220px] sm:grid-cols-[0.42fr_0.58fr]">
          <div className="hidden bg-muted p-7 sm:block">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Icon className="h-5 w-5" />
            </span>
            <p className="mt-7 text-[13px] font-semibold uppercase text-primary">{view.kicker}</p>
            <p className="mt-2 text-[19px] font-medium leading-6 text-foreground">{view.headline}</p>
            <div className="mt-4 h-1 w-full rounded-full bg-background">
              <div
                className="h-full rounded-full bg-foreground"
                style={{ width: `${view.progress}%` }}
              />
            </div>
            <p className="mt-2 text-[12px] text-muted-foreground">{view.panelDescription}</p>
          </div>

          <div className="flex min-w-0 flex-col p-7 sm:p-8">
            <div className="min-h-0 flex-1">{panelContent}</div>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={onAction}
                className="flex h-9 items-center gap-2 rounded-sm bg-foreground px-4 text-[12px] font-medium text-background transition-colors hover:bg-primary hover:text-primary-foreground"
              >
                {view.action}
                <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Shown once, to a member signing in with the password their workspace owner
 * had generated for them. Dismissing it is allowed -- the account already
 * works -- but the prompt returns on the next visit until the password is
 * replaced, and the "Temporary password" badge stays on the members list until
 * then too.
 */
function TemporaryPasswordDialog() {
  const { refreshProfile, updatePassword } = useAuth();
  const [open, setOpen] = useState(true);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (newPassword.length < 8) {
      toast.error("Choose a password of at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("The two new passwords do not match.");
      return;
    }
    setSaving(true);
    try {
      await updatePassword(currentPassword, newPassword);
      await refreshProfile();
      toast.success("Password updated. Use it from now on.");
      setOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "The password was not changed.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-[460px]">
        <DialogHeader>
          <span className="mb-2 flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
            <KeyRound className="h-5 w-5" />
          </span>
          <DialogTitle>Choose your own password</DialogTitle>
          <DialogDescription>
            You signed in with the temporary password from your invitation
            email. Replace it with one only you know.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="temp-current">Temporary password</Label>
            <Input
              id="temp-current"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="temp-new">New password</Label>
            <Input
              id="temp-new"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="temp-confirm">Confirm new password</Label>
            <Input
              id="temp-confirm"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={saving}
            >
              Later
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Update password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Dashboard() {
  const { profile, signOut, user, workspace } = useAuth();
  const { resolvedTheme, setTheme } = useTheme();
  const queryClient = useQueryClient();
  useEffect(() => {
    const refreshWorkspace = () => {
      void queryClient.invalidateQueries();
    };
    window.addEventListener("maxform:workspace-changed", refreshWorkspace);
    return () =>
      window.removeEventListener("maxform:workspace-changed", refreshWorkspace);
  }, [queryClient]);
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const onboardingKey = useMemo(
    () => ["onboarding", user?.id || "anonymous"],
    [user?.id],
  );
  const onboardingQuery = useQuery({
    enabled: Boolean(user?.id),
    queryKey: onboardingKey,
    queryFn: getOnboardingState,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  const [searchParams, setSearchParams] = useSearchParams();
  const [sidebarProfileOpen, setSidebarProfileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    readCollapsedPreference,
  );
  const sidebarScrollRef = useRef<HTMLDivElement | null>(null);
  const activeModuleRef = useRef<HTMLButtonElement | null>(null);
  const [headerProfileOpen, setHeaderProfileOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<
    (() => void) | null
  >(null);
  const [navigationSaving, setNavigationSaving] = useState(false);
  const formDraftGuard = useRef<FormDraftGuard | null>(null);
  const workspaceIdentity = useWorkspaceIdentity();
  const workspaceLogo = workspaceIdentity.logoUrl;

  const requestedWorkspaceKey = searchParams.get("tab");
  const selectedKey = (
    requestedWorkspaceKey === "contacts"
      ? "crm"
      : requestedWorkspaceKey
  ) as WorkspaceKey | null;
  // What this account may open. An owner is unrestricted; a member sees only
  // the tabs their workspace owner granted, and a link to anything else lands
  // on Home rather than on a module that would fail its first request.
  const grantedModules = workspace.allowedModules;
  const canOpen = useCallback(
    (key: WorkspaceKey) => moduleAccessAllows(grantedModules, key),
    [grantedModules],
  );
  const permittedModules = useMemo(
    () => allModules.filter((item) => canOpen(item.key)),
    [canOpen],
  );

  const requestedKey = allModules.some((module) => module.key === selectedKey)
    ? selectedKey!
    : "home";
  const activeKey = canOpen(requestedKey) ? requestedKey : "home";
  const requestedAiTab = searchParams.get("section") as AIWorkspaceTab | null;
  const aiTabs: AIWorkspaceTab[] = [
    "home",
    "chat",
    "generators",
    "insights",
    "history",
    "settings",
  ];
  const initialAiTab = aiTabs.includes(requestedAiTab as AIWorkspaceTab)
    ? requestedAiTab!
    : "home";

  const activeModule = useMemo(
    () =>
      allModules.find((item) => item.key === activeKey) || primaryModules[0],
    [activeKey],
  );
  // What the assistant can see. Derived from the address bar rather than from
  // each module's own state, so a module added later is covered without
  // touching this: `tab` is the module, `section` the tab within it, and
  // `project` the only record the shell itself keeps open.
  const assistantContext = useMemo<AssistantScreenContext>(() => {
    const projectId = searchParams.get("project") || "";
    return {
      module: activeKey,
      section: searchParams.get("section") || "",
      ...(projectId ? { recordType: "project", recordId: projectId } : {}),
    };
  }, [activeKey, searchParams]);

  const navModules = useMemo(
    () => primaryModules.filter((item) => canOpen(item.key)),
    [canOpen],
  );
  const visibleUtilityModules = useMemo(
    () => utilityModules.filter((item) => canOpen(item.key)),
    [canOpen],
  );
  const menuModules = permittedModules;

  // A member following a stale bookmark should not be left staring at a tab
  // that silently rewrote itself; the address bar is corrected too.
  useEffect(() => {
    if (requestedKey !== activeKey) {
      setSearchParams({ tab: activeKey, view: "overview" }, { replace: true });
    }
  }, [activeKey, requestedKey, setSearchParams]);
  // Runs before paint, so a reload lands with the active module already in
  // view — there is no scroll for the user to notice. `behavior: "instant"` is
  // required: `.dashboard-scroll` sets `scroll-behavior: smooth`, which would
  // otherwise animate this and defeat the point.
  useLayoutEffect(() => {
    const scroller = sidebarScrollRef.current;
    const active = activeModuleRef.current;
    if (!scroller || !active) return;

    const scrollerBox = scroller.getBoundingClientRect();
    const activeBox = active.getBoundingClientRect();
    const margin = 12;

    let delta = 0;
    if (activeBox.top < scrollerBox.top + margin) {
      delta = activeBox.top - scrollerBox.top - margin;
    } else if (activeBox.bottom > scrollerBox.bottom - margin) {
      delta = activeBox.bottom - scrollerBox.bottom + margin;
    }
    if (delta === 0) return;

    const top = scroller.scrollTop + delta;
    if (typeof scroller.scrollTo === "function") {
      scroller.scrollTo({ top, behavior: "instant" as ScrollBehavior });
    } else {
      scroller.scrollTop = top;
    }
  }, [activeKey, sidebarCollapsed]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        SIDEBAR_COLLAPSED_KEY,
        String(sidebarCollapsed),
      );
    } catch {
      // Private mode blocks storage; collapsing still works for the session.
    }
  }, [sidebarCollapsed]);

  const activeView = workspaceViews[activeKey];
  const requestedFormTab = searchParams.get("section") as FormsTab | null;
  const activeFormTab = formTabs.includes(requestedFormTab as FormsTab)
    ? requestedFormTab!
    : DEFAULT_FORMS_TAB;
  const requestedEventTab = searchParams.get("section") as EventsTab | null;
  const activeEventTab = eventTabs.includes(requestedEventTab as EventsTab)
    ? requestedEventTab!
    : "all";
  const requestedFilesTab = searchParams.get("section") as FilesTab | null;
  const activeFilesTab = filesTabs.includes(requestedFilesTab as FilesTab)
    ? requestedFilesTab!
    : "all";
  const requestedDocumentsTab = searchParams.get(
    "section",
  ) as DocumentsTab | null;
  const activeDocumentsTab = documentsTabs.includes(
    requestedDocumentsTab as DocumentsTab,
  )
    ? requestedDocumentsTab!
    : "templates";
  const requestedOrdersTab = searchParams.get("section");
  const activeOrdersTab: OrdersTab = isOrdersTab(requestedOrdersTab)
    ? requestedOrdersTab
    : DEFAULT_ORDERS_TAB;
  const activeOrdersSite = searchParams.get("site") || undefined;
  const requestedAppointmentsTab = searchParams.get("section") as AppointmentsTab | null;
  const appointmentsTabs: AppointmentsTab[] = [
    "overview",
    "booking-pages",
    "routing-forms",
    "calendar",
    "appointments",
    "availability",
    "integrations",
    "email_templates",
    "analytics",
    "settings",
  ];
  const activeAppointmentsTab = appointmentsTabs.includes(
    requestedAppointmentsTab as AppointmentsTab,
  )
    ? requestedAppointmentsTab!
    : "overview";
  // Deep links into Email, so "Manage in Email" from the campaign flow lands
  // on the identity tab rather than dropping the user on the overview.
  const requestedEmailTab = searchParams.get("section") as EmailTab | null;
  const emailTabs: EmailTab[] = [
    "overview",
    "analytics",
    "providers",
    "identity",
    "domains",
    "templates",
    "sent",
    "received",
    "logs",
    "settings",
  ];
  const activeEmailTab = emailTabs.includes(requestedEmailTab as EmailTab)
    ? requestedEmailTab!
    : "overview";
  const requestedCampaignTab = searchParams.get("section") as CampaignTab | null;
  const campaignTabs: CampaignTab[] = [
    "overview",
    "campaigns",
    "ai",
    "analytics",
    "suppressions",
    "settings",
  ];
  const activeCampaignTab = campaignTabs.includes(
    requestedCampaignTab as CampaignTab,
  )
    ? requestedCampaignTab!
    : "overview";
  const requestedIntegrationsTab = searchParams.get(
    "section",
  ) as IntegrationsTab | null;
  const integrationsTabs: IntegrationsTab[] = [
    "directory",
    "connections",
    "activity",
  ];
  const activeIntegrationsTab = integrationsTabs.includes(
    requestedIntegrationsTab as IntegrationsTab,
  )
    ? requestedIntegrationsTab!
    : "directory";
  const requestedCmsStoresTab = searchParams.get("section") as CmsStoresTab | null;
  const cmsStoresTabs: CmsStoresTab[] = [
    "overview",
    "analytics",
    "sites",
    "products",
    "categories",
    "activity",
    "settings",
  ];
  const activeCmsStoresTab = cmsStoresTabs.includes(
    requestedCmsStoresTab as CmsStoresTab,
  )
    ? requestedCmsStoresTab!
    : "overview";
  const requestedStoreConnectorTab = searchParams.get("section") as StoreConnectorTab | null;
  const storeConnectorTabs: StoreConnectorTab[] = [
    "overview",
    "providers",
    "connections",
    "activity",
    "settings",
  ];
  const activeStoreConnectorTab = storeConnectorTabs.includes(
    requestedStoreConnectorTab as StoreConnectorTab,
  )
    ? requestedStoreConnectorTab!
    : "overview";
  const requestedProjectsTab = searchParams.get("section") as ProjectsTab | null;
  const activeProjectsTab = PROJECT_TABS.includes(
    requestedProjectsTab as ProjectsTab,
  )
    ? requestedProjectsTab!
    : "overview";
  const activeProjectId = searchParams.get("project") || null;
  const requestedCrmTab = searchParams.get("section") as CrmTab | null;
  const crmTabs: CrmTab[] = [
    "overview",
    "contacts",
    "customer360",
    "command-center",
    "companies",
    "leads",
    "deals",
    "pipelines",
    "activities",
    "tasks",
    "calendar",
    "reports",
    "import",
    "ai",
    "settings",
  ];
  const activeCrmTab = crmTabs.includes(requestedCrmTab as CrmTab)
    ? requestedCrmTab!
    : "overview";

  useEffect(() => {
    scrollDashboardToTop("auto");
  }, [
    activeDocumentsTab,
    activeEventTab,
    activeFilesTab,
    activeFormTab,
    activeCrmTab,
    activeAppointmentsTab,
    activeCampaignTab,
    activeIntegrationsTab,
    activeCmsStoresTab,
    activeStoreConnectorTab,
    activeProjectsTab,
    activeProjectId,
    activeKey,
  ]);

  useEffect(() => {
    if (!user?.id) return;

    let cancelled = false;
    const warmDashboardModules = async () => {
      for (const batch of dashboardWarmupBatches) {
        if (cancelled) return;
        await Promise.allSettled(
          batch.map((key) => warmWorkspaceModule(key, user.id)),
        );
      }
    };

    const idleWindow = window as IdleWindow;
    const startWarmup = () => {
      void warmDashboardModules();
    };
    const idleHandle = idleWindow.requestIdleCallback?.(startWarmup, {
      timeout: 1_200,
    });
    const timeoutHandle =
      idleHandle === undefined
        ? window.setTimeout(startWarmup, 350)
        : undefined;

    return () => {
      cancelled = true;
      if (idleHandle !== undefined) {
        idleWindow.cancelIdleCallback?.(idleHandle);
      }
      if (timeoutHandle !== undefined) {
        window.clearTimeout(timeoutHandle);
      }
    };
  }, [user?.id]);

  const activeTopTab =
    activeKey === "forms"
      ? activeFormTab === "responses"
        ? "responses"
        : activeFormTab === "automations"
          ? "automations"
          : ""
      : topTabs.find((tab) => tab.module === activeKey)?.key || "";
  const requestedContextView = searchParams.get("view");
  const activeContextView: ContextView =
    requestedContextView === "work" || requestedContextView === "goal"
      ? requestedContextView
      : "overview";

  const fullName =
    profile?.full_name?.trim() || user?.full_name?.trim() || "User";
  const firstName = fullName.split(" ")[0];
  const workspaceName =
    workspaceIdentity.workspaceName.trim() || "Workspace";
  const initials = fullName
    ? fullName
        .split(" ")
        .map((name) => name[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "MF";

  const runDashboardTransition = useCallback(
    (_destination: string, _message: string, complete: () => void) => {
      complete();
    },
    [],
  );

  const handleFormDraftGuard = useCallback(
    (guard: FormDraftGuard | null) => {
      formDraftGuard.current = guard;
    },
    [],
  );

  const requestDashboardTransition = (
    destination: string,
    message: string,
    complete: () => void,
  ) => {
    if (
      formDraftGuard.current?.hasUnsavedChanges ||
      formDraftGuard.current?.requiresUpdate
    ) {
      setPendingNavigation(
        () => () => runDashboardTransition(destination, message, complete),
      );
      return;
    }
    runDashboardTransition(destination, message, complete);
  };

  const saveDraftAndContinue = async () => {
    if (!pendingNavigation || !formDraftGuard.current) return;
    setNavigationSaving(true);
    try {
      const saved = await formDraftGuard.current.saveChanges();
      if (!saved) return;
      const navigate = pendingNavigation;
      setPendingNavigation(null);
      navigate();
    } finally {
      setNavigationSaving(false);
    }
  };

  const discardChangesAndContinue = async () => {
    if (!pendingNavigation || !formDraftGuard.current) return;
    setNavigationSaving(true);
    try {
      const discarded = await formDraftGuard.current.discardChanges();
      if (!discarded) return;
      const navigate = pendingNavigation;
      setPendingNavigation(null);
      navigate();
    } finally {
      setNavigationSaving(false);
    }
  };

  const selectModule = (key: WorkspaceKey) => {
    if (!canOpen(key)) return;
    if (key === activeKey) {
      if (key === "crm" && activeCrmTab !== "overview") {
        setSearchParams({ tab: "crm", section: "overview" });
      }
      return;
    }
    preloadWorkspaceModule(key, user?.id);
    const label =
      allModules.find((module) => module.key === key)?.label || "workspace";
    requestDashboardTransition(
      `module:${key}`,
      `Opening ${label}`,
      () => setSearchParams({ tab: key, view: "overview" }),
    );
  };

  const openAiSettings = () => {
    if (!canOpen("ai")) return;
    preloadWorkspaceModule("ai", user?.id);
    requestDashboardTransition(
      "module:ai-settings",
      "Opening MaxAI settings",
      () => setSearchParams({ tab: "ai", section: "settings", view: "overview" }),
    );
  };

  const selectContextView = (view: ContextView) => {
    setSearchParams({ tab: activeKey, view });
  };

  const selectSettingsSection = (section: string) => {
    setSidebarProfileOpen(false);
    setHeaderProfileOpen(false);
    preloadWorkspaceModule("settings", user?.id);
    requestDashboardTransition(
      `settings:${section}`,
      "Opening workspace settings",
      () => setSearchParams({ tab: "settings", section }),
    );
  };

  const selectFormTab = (section: FormsTab) => {
    setSearchParams({ tab: "forms", section });
  };

  const selectCrmTab = (section: CrmTab) => {
    setSearchParams({ tab: "crm", section });
  };

  const selectAppointmentsTab = (section: AppointmentsTab) => {
    setSearchParams({ tab: "appointments", section });
  };

  // Stable identities: ProjectsModule keeps these in an effect's dependency
  // list, and a fresh closure on every render would re-run it on every render.
  const selectProjectsTab = useCallback(
    (section: ProjectsTab) => {
      setSearchParams(
        activeProjectId
          ? { tab: "projects", section, project: activeProjectId }
          : { tab: "projects", section },
      );
    },
    [activeProjectId, setSearchParams],
  );

  const openProject = useCallback(
    (projectId: string | null) => {
      setSearchParams(
        projectId
          ? { tab: "projects", section: "overview", project: projectId }
          : { tab: "projects" },
      );
    },
    [setSearchParams],
  );

  const requestSignOut = () => {
    requestDashboardTransition(
      "sign-out",
      "Signing out",
      () => void signOut(),
    );
  };

  const navigateFromHome = (destination: HomeDestination) => {
    if (destination === "form-templates") {
      requestDashboardTransition(
        "forms:templates",
        "Opening form templates",
        () => selectFormTab("templates"),
      );
      return;
    }
    if (destination === "form-ai") {
      requestDashboardTransition(
        "forms:ai",
        "Opening Max Builder",
        () => selectFormTab("ai"),
      );
      return;
    }
    if (destination === "events") {
      requestDashboardTransition(
        "module:events",
        "Opening Events",
        () => setSearchParams({ tab: "events", section: "templates" }),
      );
      return;
    }
    if (destination === "contacts") {
      selectModule("crm");
      return;
    }
    selectModule(destination);
  };

  const cycleContextView = (direction: -1 | 1) => {
    const views: ContextView[] = ["overview", "work", "goal"];
    const currentIndex = views.indexOf(activeContextView);
    const nextIndex = (currentIndex + direction + views.length) % views.length;
    selectContextView(views[nextIndex]);
  };

  // A brand-new account answers a handful of questions before the dashboard
  // appears. It is shown in place of the shell rather than over it, so the
  // first thing someone sees is one clear task instead of an empty workspace
  // behind a modal.
  if (onboardingQuery.data && !onboardingDismissed) {
    const state = onboardingQuery.data;
    if (!state.completed && !state.skipped) {
      return (
        <OnboardingFlow
          initial={state}
          fullName={profile?.full_name || user?.full_name || ""}
          onSaveStep={async (answers) => {
            const saved = await saveOnboardingStep(answers);
            queryClient.setQueryData(onboardingKey, saved);
          }}
          onComplete={async (answers) => {
            const saved = await completeOnboarding(answers);
            queryClient.setQueryData(onboardingKey, saved);
            // Campaign settings may now carry the address that onboarding
            // supplied, so anything reading them is refetched.
            await queryClient.invalidateQueries({ queryKey: ["campaigns"] });
            setOnboardingDismissed(true);
            toast.success("Your workspace is ready.");
          }}
          onSkip={async () => {
            const saved = await skipOnboarding();
            queryClient.setQueryData(onboardingKey, saved);
            setOnboardingDismissed(true);
          }}
        />
      );
    }
  }

  return (
    // Wraps the whole dashboard so the AI Workspace tab and the floating
    // assistant share one controller: the tab asks, the assistant answers.
    <AssistantControllerProvider>
      <DashboardLiveSync userId={user?.id} />
      {workspace.mustChangePassword && <TemporaryPasswordDialog />}
      {workspace.suspended && (
        <div
          role="status"
          className="flex items-center justify-center gap-2 bg-destructive px-4 py-2 text-center text-[13px] font-medium text-destructive-foreground"
        >
          <ShieldAlert className="h-4 w-4 shrink-0" />
          Your access to {workspace.name} is suspended. Contact the workspace
          owner to have it restored.
        </div>
      )}
      <div
        className="dashboard-shell h-dvh overflow-hidden bg-background text-foreground selection:bg-primary/20"
        style={{ fontFamily: "'Geist', -apple-system, BlinkMacSystemFont, system-ui, sans-serif" }}
      >
      <Dialog
        open={Boolean(pendingNavigation)}
        onOpenChange={(open) => {
          if (!open && !navigationSaving) setPendingNavigation(null);
        }}
      >
        <DialogContent className="w-[calc(100%-24px)] max-w-[620px] gap-0 overflow-hidden p-0">
          <DialogHeader className="items-center px-6 pb-6 pt-7 text-center sm:px-8 sm:text-center">
            <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <FileCheck2 className="h-5 w-5" />
            </span>
            <DialogTitle>
              {formDraftGuard.current?.requiresUpdate
                ? "Save or discard this update?"
                : "Save changes before leaving?"}
            </DialogTitle>
            <DialogDescription className="max-w-[520px] leading-6">
              {formDraftGuard.current?.requiresUpdate
                ? "This published form has changes that are not live yet. Save changes to make the update live, discard changes to restore the last live version, or return to the builder."
                : "The builder still has unsaved changes. Save them, discard them, or return to the builder."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="grid w-full grid-cols-1 gap-2 border-t border-border p-4 sm:grid-cols-3 sm:flex-none sm:space-x-0 sm:p-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => setPendingNavigation(null)}
              disabled={navigationSaving}
              className="w-full min-w-0 justify-center whitespace-normal text-center text-[12px] sm:text-[13px]"
            >
              Return to builder
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void discardChangesAndContinue()}
              disabled={navigationSaving}
              className="w-full min-w-0 justify-center whitespace-normal border-destructive/40 text-center text-destructive hover:bg-destructive/10 hover:text-destructive sm:text-[13px]"
            >
              <Trash2 className="h-4 w-4" />
              Discard changes
            </Button>
            <Button
              type="button"
              onClick={() => void saveDraftAndContinue()}
              disabled={navigationSaving}
              className="w-full min-w-0 justify-center whitespace-normal text-center text-[12px] sm:text-[13px]"
            >
              {navigationSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <div className="relative flex h-full min-h-0 w-full overflow-hidden bg-background">
        <aside
          data-collapsed={sidebarCollapsed}
          className={cn(
            "hidden shrink-0 border-r border-border bg-background transition-[width] duration-200 ease-out lg:flex lg:flex-col",
            sidebarCollapsed ? "w-[64px]" : "w-[208px]",
          )}
        >
          <div
            className={cn(
              "flex h-[112px] shrink-0 items-center",
              sidebarCollapsed ? "flex-col justify-center gap-2.5 px-0" : "gap-1 px-5",
            )}
          >
            <button
              type="button"
              onClick={() => selectModule("home")}
              className={cn(
                "flex min-w-0 items-center gap-3 text-foreground",
                !sidebarCollapsed && "flex-1",
              )}
              aria-label="Go to MaxForm home"
            >
              <BrandLogo
                className="gap-3"
                markSize={20}
                showWordmark={!sidebarCollapsed}
                wordmarkClassName="text-[14px]"
              />
            </button>
            <SidebarHint label="Expand menu" show={sidebarCollapsed}>
              <button
                type="button"
                onClick={() => setSidebarCollapsed((current) => !current)}
                aria-label={sidebarCollapsed ? "Expand menu" : "Collapse menu"}
                aria-expanded={!sidebarCollapsed}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {sidebarCollapsed ? (
                  <ArrowRightToLine className="h-[18px] w-[18px]" strokeWidth={1.8} />
                ) : (
                  <ArrowLeftToLine className="h-[18px] w-[18px]" strokeWidth={1.8} />
                )}
              </button>
            </SidebarHint>
          </div>

          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col pb-6",
              sidebarCollapsed ? "px-2.5" : "px-4",
            )}
          >
            <div ref={sidebarScrollRef} className="dashboard-scroll min-h-0 overflow-y-auto">
              <nav className="space-y-1">
                {navModules.map((item) => {
                  const Icon = item.icon;
                  const active = activeKey === item.key;
                  return (
                    <div key={item.key}>
                      <SidebarHint label={item.label} show={sidebarCollapsed}>
                        <button
                          type="button"
                          ref={active ? activeModuleRef : undefined}
                          onClick={() => selectModule(item.key)}
                          onFocus={() =>
                            preloadWorkspaceModule(item.key, user?.id)
                          }
                          onMouseEnter={() =>
                            preloadWorkspaceModule(item.key, user?.id)
                          }
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "group flex h-11 w-full items-center rounded-md text-left text-[14px] transition-colors",
                            sidebarCollapsed
                              ? "justify-center px-0"
                              : "gap-3 px-1",
                            active
                              ? "font-medium text-foreground"
                              : "text-muted-foreground hover:text-foreground",
                            sidebarCollapsed && active && "bg-accent",
                          )}
                        >
                          <span
                            className={cn(
                              "flex h-6 w-6 items-center justify-center transition-colors",
                              active
                                ? "text-primary"
                                : "text-muted-foreground group-hover:text-primary",
                            )}
                          >
                            <Icon
                              className="h-[18px] w-[18px]"
                              strokeWidth={1.7}
                            />
                          </span>
                          {!sidebarCollapsed && <span>{item.label}</span>}
                        </button>
                      </SidebarHint>
                    </div>
                  );
                })}
              </nav>

              <div className="my-5 h-px bg-border" />
              {!sidebarCollapsed && (
                <p className="mb-2 px-1 text-[12px] font-medium uppercase text-muted-foreground">Workspace tools</p>
              )}
              <nav className="space-y-0.5">
                {visibleUtilityModules.map((item) => {
                  const Icon = item.icon;
                  const active = activeKey === item.key;
                  return (
                  <SidebarHint key={item.key} label={item.label} show={sidebarCollapsed}>
                  <button
                    type="button"
                    ref={active ? activeModuleRef : undefined}
                    onClick={() => selectModule(item.key)}
                    onFocus={() => preloadWorkspaceModule(item.key, user?.id)}
                    onMouseEnter={() => preloadWorkspaceModule(item.key, user?.id)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group flex h-9 w-full items-center rounded-md text-left text-[13px] transition-colors",
                      sidebarCollapsed ? "justify-center px-0" : "gap-3 px-1",
                      active
                        ? "font-medium text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                      sidebarCollapsed && active && "bg-accent",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-5 w-5 items-center justify-center",
                        !sidebarCollapsed && "ml-1",
                        active ? "text-primary" : "text-muted-foreground group-hover:text-primary",
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" strokeWidth={1.7} />
                    </span>
                    {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                  </button>
                  </SidebarHint>
                  );
                })}
              </nav>
            </div>
          </div>

          <div className={cn("pb-8", sidebarCollapsed ? "px-2.5" : "px-4")}>
            <div className="relative">
              <SidebarHint label={firstName} show={sidebarCollapsed}>
                <button
                  type="button"
                  onClick={() => setSidebarProfileOpen((current) => !current)}
                  className={cn(
                    "flex w-full items-center rounded-md bg-muted py-2.5 text-left",
                    sidebarCollapsed ? "justify-center px-0" : "gap-3 px-2",
                  )}
                  aria-label="Open workspace menu"
                  aria-expanded={sidebarProfileOpen}
                >
                  <Avatar className="h-8 w-8 shrink-0 border border-border">
                    <AvatarImage
                      src={workspaceLogo || ""}
                      className="object-cover"
                    />
                    <AvatarFallback className="bg-primary/15 text-[12px] font-semibold text-primary">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  {!sidebarCollapsed && (
                    <>
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
                        {firstName}
                      </span>
                      <ChevronDown className="h-4 w-4 text-primary" />
                    </>
                  )}
                </button>
              </SidebarHint>

              {sidebarProfileOpen && (
                <div
                  className={cn(
                    "absolute bottom-[52px] left-0 z-20 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg",
                    // The rail is too narrow to host the menu at its own width.
                    sidebarCollapsed ? "w-56" : "w-full",
                  )}
                >
                  <div className="flex items-center gap-2 border-b border-border px-2 py-2.5">
                    <Avatar className="h-8 w-8 shrink-0">
                      <AvatarImage
                        src={workspaceLogo || ""}
                        className="object-cover"
                      />
                      <AvatarFallback className="bg-primary/15 text-[11px] font-semibold text-primary">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-medium">
                        {profile?.full_name || "User"}
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {workspaceName}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => selectSettingsSection("workspace")}
                    className="flex w-full items-center gap-2 rounded px-2 py-2.5 text-[13px] text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  >
                    <Settings className="h-3.5 w-3.5" />
                    Workspace settings
                  </button>
                  <button
                    type="button"
                    onClick={requestSignOut}
                    className="flex w-full items-center gap-2 rounded px-2 py-2.5 text-[13px] text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col bg-background">
          <header
            className="dashboard-app-header flex h-[74px] shrink-0 items-center border-b border-border bg-background px-4 sm:px-7 lg:h-[112px] xl:pl-16 xl:pr-11"
          >
            <button
              type="button"
              onClick={() => selectModule("home")}
              className="mr-5 flex items-center gap-2 lg:hidden"
              aria-label="Go to dashboard home"
            >
              <BrandLogo markSize={18} wordmarkClassName="text-[14px]" />
            </button>

            <nav className="dashboard-scroll dashboard-scroll-x flex min-w-0 flex-1 items-stretch gap-5 overflow-x-auto sm:gap-8">
              {topTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onFocus={() => preloadWorkspaceModule(tab.module, user?.id)}
                  onMouseEnter={() => preloadWorkspaceModule(tab.module, user?.id)}
                  onClick={() =>
                    tab.key === "responses"
                      ? requestDashboardTransition(
                          "forms:responses",
                          "Opening responses",
                          () => selectFormTab("responses"),
                        )
                      : tab.key === "automations"
                        ? requestDashboardTransition(
                            "forms:automations",
                            "Opening form automations",
                            () => selectFormTab("automations"),
                          )
                      : selectModule(tab.module)
                  }
                  className={cn(
                    "relative h-[74px] shrink-0 text-[14px] capitalize transition-colors lg:h-[112px]",
                    tab.key !== "overview" && "hidden sm:block",
                    activeTopTab === tab.key ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tab.label}
                  {activeTopTab === tab.key && (
                    <span className="absolute inset-x-0 bottom-[18px] h-[2px] bg-foreground lg:bottom-[28px]" />
                  )}
                </button>
              ))}
            </nav>

            <div className="ml-5 flex shrink-0 items-center gap-1 sm:gap-3">
              <NotificationCenter userId={user?.id} />
              <button
                type="button"
                onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
                className="relative flex h-9 w-9 items-center justify-center rounded-full text-foreground hover:bg-accent"
                aria-label={`Switch to ${resolvedTheme === "dark" ? "light" : "dark"} mode`}
              >
                <Sun className="h-[18px] w-[18px] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                <Moon className="absolute h-[18px] w-[18px] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
              </button>
              <button
                type="button"
                onClick={() => selectSettingsSection("workspace")}
                className="hidden h-9 w-9 items-center justify-center rounded-full text-foreground hover:bg-accent sm:flex"
                aria-label="General settings"
              >
                <Settings className="h-[18px] w-[18px]" strokeWidth={1.7} />
              </button>
              <button
                type="button"
                onClick={() => setHeaderProfileOpen((current) => !current)}
                className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-primary/15 text-[12px] font-semibold text-primary ring-2 ring-background"
                aria-label="Open profile menu"
                aria-expanded={headerProfileOpen}
              >
                <Avatar className="h-9 w-9">
                  <AvatarImage
                    src={workspaceLogo || ""}
                    className="object-cover"
                  />
                  <AvatarFallback className="bg-primary/15 text-[12px] font-semibold text-primary">
                    {initials}
                  </AvatarFallback>
                </Avatar>
              </button>
            </div>

            {headerProfileOpen && (
              <div className="absolute right-4 top-[66px] z-30 w-[230px] rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-xl lg:right-11 lg:top-[88px]">
                <div className="flex items-center gap-3 border-b border-border px-3 py-3">
                  <Avatar className="h-9 w-9 shrink-0">
                    <AvatarImage
                      src={workspaceLogo || ""}
                      className="object-cover"
                    />
                    <AvatarFallback className="bg-primary/15 text-[12px] font-semibold text-primary">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="truncate text-[13px] font-medium">
                      {profile?.full_name || "User"}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {workspaceName}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    selectSettingsSection("workspace");
                  }}
                  className="flex w-full items-center gap-2 rounded px-3 py-2.5 text-[13px] text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                >
                  <Settings className="h-3.5 w-3.5" />
                  Workspace settings
                </button>
                <button
                  type="button"
                  onClick={requestSignOut}
                  className="flex w-full items-center gap-2 rounded px-3 py-2.5 text-[13px] text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Sign out
                </button>
              </div>
            )}
          </header>

          <div className="relative min-h-0 flex-1">
            <div
              className="dashboard-scroll dashboard-viewport h-full overflow-y-auto px-4 py-7 sm:px-7 xl:py-9 xl:pl-16 xl:pr-11"
              data-dashboard-scroll-root="true"
            >
              <main
                className={cn(
                  "mx-auto min-w-0",
                  // Modules share one working width. Home and Settings stay
                  // narrower because they are reading pages, not workspaces.
                  activeKey === "home" || activeKey === "settings"
                    ? "max-w-[1110px]"
                    : "max-w-[1380px]",
                )}
              >
              {/* One module crashing must not blank the whole dashboard. The
                  boundary resets on tab change, so switching away and back is
                  enough to retry. */}
              <ErrorBoundary title={activeModule.label} resetKey={activeKey}>
              <Suspense fallback={<DashboardModuleFallback />}>
              {activeKey === "settings" ? (
                <SettingsContent />
              ) : activeKey === "home" ? (
                <HomeDashboard
                  fullName={fullName}
                  userId={user?.id}
                  workspaceLogo={workspaceLogo}
                  workspaceName={workspaceIdentity.workspaceName}
                  onNavigate={navigateFromHome}
                  onNotice={(message) => toast.info(message)}
                />
              ) : activeKey === "forms" ? (
                <FormsModule
                  activeTab={activeFormTab}
                  fullName={fullName}
                  onDraftGuardChange={handleFormDraftGuard}
                  userId={user?.id}
                  onTabChange={selectFormTab}
                />
              ) : activeKey === "events" ? (
                <EventsModule
                  initialTab={activeEventTab}
                  onTabChange={(tab) =>
                    setSearchParams({ tab: "events", section: tab })
                  }
                  userId={user?.id}
                />
              ) : activeKey === "appointments" ? (
                <AppointmentsModule
                  initialTab={activeAppointmentsTab}
                  onTabChange={selectAppointmentsTab}
                  userId={user?.id}
                />
              ) : activeKey === "workflows" ? (
                <WorkflowsModule />
              ) : activeKey === "crm" ? (
                <CrmModule
                  initialTab={activeCrmTab}
                  onTabChange={selectCrmTab}
                  userId={user?.id}
                />
              ) : activeKey === "campaigns" ? (
                <CampaignsModule
                  userId={user?.id}
                  initialTab={activeCampaignTab}
                  onTabChange={(tab) =>
                    setSearchParams({ tab: "campaigns", section: tab })
                  }
                />
              ) : activeKey === "payments" ? (
                <PaymentsModule userId={user?.id} />
              ) : activeKey === "analytics" ? (
                <AnalyticsModule userId={user?.id} />
              ) : activeKey === "emails" ? (
                <EmailModule
                  userId={user?.id}
                  initialTab={activeEmailTab}
                  onTabChange={(tab) =>
                    setSearchParams({ tab: "emails", section: tab })
                  }
                />
              ) : activeKey === "files" ? (
                <FilesModule
                  userId={user?.id}
                  initialTab={activeFilesTab}
                  onTabChange={(tab) =>
                    setSearchParams({ tab: "files", section: tab })
                  }
                />
              ) : activeKey === "orders" ? (
                <OrdersModule
                  userId={user?.id}
                  initialTab={activeOrdersTab}
                  initialSite={activeOrdersSite}
                  onTabChange={(tab) =>
                    setSearchParams({ tab: "orders", section: tab })
                  }
                />
              ) : activeKey === "documents" ? (
                <DocumentsModule
                  userId={user?.id}
                  initialTab={activeDocumentsTab}
                  onTabChange={(tab) =>
                    setSearchParams({ tab: "documents", section: tab })
                  }
                />
              ) : activeKey === "integrations" ? (
                <IntegrationsHub
                  userId={user?.id}
                  initialTab={activeIntegrationsTab}
                  onTabChange={(tab) =>
                    setSearchParams({ tab: "integrations", section: tab })
                  }
                />
              ) : activeKey === "stores" ? (
                <CmsStoresModule
                  initialTab={activeCmsStoresTab}
                  onTabChange={(tab) =>
                    setSearchParams({ tab: "stores", section: tab })
                  }
                  onOpenConnector={(section = "providers") =>
                    setSearchParams({ tab: "store_connector", section })
                  }
                  onOpenOrders={(connectionId) =>
                    setSearchParams({
                      tab: "orders",
                      section: "store_orders",
                      site: connectionId,
                    })
                  }
                />
              ) : activeKey === "store_connector" ? (
                <StoreConnectorModule
                  initialTab={activeStoreConnectorTab}
                  onTabChange={(tab) =>
                    setSearchParams({ tab: "store_connector", section: tab })
                  }
                  onOpenStores={(tab = "overview") =>
                    setSearchParams({ tab: "stores", section: tab })
                  }
                />
              ) : activeKey === "ai" ? (
                <AIWorkspaceModule userId={user?.id} initialTab={initialAiTab} workspaceLogo={workspaceLogo} />
              ) : activeKey === "projects" ? (
                <ProjectsModule
                  activeTab={activeProjectsTab}
                  fullName={fullName}
                  onOpenProject={openProject}
                  onTabChange={selectProjectsTab}
                  projectId={activeProjectId}
                  userId={user?.id}
                />
              ) : (
                <>
                  <div className="flex min-h-[78px] items-start justify-between gap-5">
                <div>
                  <h1 className="max-w-[760px] text-[34px] font-[500] leading-[1.06] text-foreground sm:text-[44px]">
                    {activeModule.title}
                  </h1>
                  <p className="mt-2 text-[16px] text-muted-foreground">{activeModule.subtitle}</p>
                </div>

                <div className="mt-2 hidden items-center gap-2 sm:flex">
                  <button
                    type="button"
                    onClick={() => cycleContextView(-1)}
                    className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-[0_10px_24px_rgba(37,44,64,0.08)] hover:text-primary dark:shadow-none"
                    aria-label="Previous view"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => cycleContextView(1)}
                    className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-[0_10px_24px_rgba(37,44,64,0.08)] hover:text-primary dark:shadow-none"
                    aria-label="Next view"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <nav
                className="dashboard-scroll dashboard-scroll-x mt-5 flex gap-7 overflow-x-auto border-b border-border"
                aria-label={`${activeModule.label} views`}
              >
                {[
                  { key: "overview" as const, label: "Overview" },
                  { key: "work" as const, label: activeView.nextTitle },
                  { key: "goal" as const, label: activeView.goalLabel },
                ].map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => selectContextView(item.key)}
                    className={cn(
                      "relative h-12 shrink-0 text-[14px] transition-colors",
                      activeContextView === item.key
                        ? "font-medium text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {item.label}
                    {activeContextView === item.key && (
                      <span className="absolute inset-x-0 bottom-0 h-[2px] bg-primary" />
                    )}
                  </button>
                ))}
              </nav>

              {activeContextView === "overview" && (
                <div>
                  <section
                    className="relative mt-6 min-h-[430px]"
                    aria-label={`${activeModule.label} overview`}
                  >
                    <div className="absolute left-0 top-9 z-10 flex items-center gap-6">
                      <div
                        className="flex h-12 w-12 items-center justify-center rounded-full p-[4px]"
                        style={{
                          background: `conic-gradient(hsl(var(--primary)) 0deg ${activeView.progress * 3.6}deg, hsl(var(--border)) ${activeView.progress * 3.6}deg 360deg)`,
                        }}
                      >
                        <span className="flex h-full w-full items-center justify-center rounded-full bg-background text-[12px] font-semibold text-foreground">
                          {activeView.progress}%
                        </span>
                      </div>
                      <div>
                        <h2 className="text-[20px] font-semibold text-foreground">
                          {activeView.featureLabel}
                        </h2>
                        <p className="mt-1 text-[14px] text-muted-foreground">{activeView.featureMeta}</p>
                      </div>
                    </div>

                    <PreviewPanel
                      view={activeView}
                      icon={activeModule.icon}
                      onAction={() => toast.info(`${activeView.action} is ready.`)}
                    />
                  </section>

                  <div className="mt-3 grid grid-cols-5 gap-3">
                    {[true, true, true, false, false].map((complete, index) => (
                      <button
                        key={index}
                        type="button"
                        className={cn(
                          "h-[3px] rounded-full transition-colors",
                          complete ? "bg-primary/70" : "bg-muted hover:bg-primary/30",
                        )}
                        aria-label={`Dashboard section ${index + 1}`}
                      />
                    ))}
                  </div>
                </div>
              )}

              {activeContextView === "work" && (
                <section className="min-h-[500px] pt-10" aria-label={activeView.nextTitle}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[12px] font-medium uppercase text-primary">
                        {activeModule.label}
                      </p>
                      <h2 className="mt-2 text-[26px] font-semibold text-foreground">
                        {activeView.nextTitle}
                      </h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => toast.info(`${activeView.nextAction} opened.`)}
                      className="text-[13px] font-medium text-primary hover:text-foreground"
                    >
                      {activeView.nextAction}
                    </button>
                  </div>

                  <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-6">
                    {activeView.rows.map((item, index) => (
                      <button
                        key={item.label}
                        type="button"
                        onClick={() => toast.info(`${item.label} opened.`)}
                        className="min-w-0 rounded-md border border-border bg-card p-6 text-left transition-colors hover:border-primary"
                      >
                        <MiniForm accent={miniAccents[index]} fields={miniFields[index]} />
                        <span className="mt-5 block truncate text-[15px] font-medium text-card-foreground">
                          {item.label}
                        </span>
                        <span className="mt-1.5 block truncate text-[12px] text-muted-foreground">
                          {item.value}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {activeContextView === "goal" && (
                <section
                  className="flex min-h-[500px] items-center justify-center py-12 text-center"
                  aria-label={activeView.goalLabel}
                >
                  <div className="w-full max-w-[430px]">
                    <p className="text-[12px] font-medium uppercase text-primary">
                      {activeModule.label}
                    </p>
                    <h2 className="mt-3 text-[26px] font-semibold text-foreground">
                      {activeView.goalLabel}
                    </h2>
                    <p className="mt-2 text-[20px] font-semibold text-foreground">
                      {activeView.goalValue}{" "}
                      <span className="font-normal text-muted-foreground">/ {activeView.goalTarget}</span>
                    </p>

                    <div className="relative mx-auto mt-8 h-[108px] w-[260px] overflow-hidden">
                      <div
                        className="absolute inset-x-0 top-0 h-[260px] w-[260px] rounded-full"
                        style={{
                          background: `conic-gradient(from 270deg, hsl(var(--primary)) 0deg ${Math.min(180, activeView.goalPercent * 1.8)}deg, hsl(var(--muted)) ${Math.min(180, activeView.goalPercent * 1.8)}deg 180deg, transparent 180deg 360deg)`,
                        }}
                      />
                      <div className="absolute bottom-0 left-[40px] h-[86px] w-[180px] rounded-t-full bg-background" />
                      <span className="absolute bottom-0 left-1/2 h-3 w-3 -translate-x-1/2 rounded-full bg-primary" />
                      <span
                        className="absolute bottom-[5px] left-1/2 h-[2px] w-12 origin-left bg-primary"
                        style={{ transform: `rotate(${activeView.goalPercent * 1.8 - 180}deg)` }}
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => toast.info(activeView.message)}
                      className="mt-8 flex w-full items-center gap-3 rounded-md bg-muted px-4 py-3.5 text-left text-[13px] leading-5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
                        <Check className="h-3.5 w-3.5" />
                      </span>
                      {activeView.message}
                    </button>
                  </div>
                </section>
              )}
                </>
              )}
              </Suspense>
              </ErrorBoundary>
              </main>
            </div>
          </div>

          <nav className="grid shrink-0 grid-cols-5 border-t border-border bg-background lg:hidden">
            {navModules.slice(0, 4).map((item) => {
              const Icon = item.icon;
              const active = activeKey === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onFocus={() => preloadWorkspaceModule(item.key, user?.id)}
                  onClick={() => selectModule(item.key)}
                  className={cn(
                    "flex h-16 flex-col items-center justify-center gap-1 text-[12px]",
                    active ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="flex h-16 flex-col items-center justify-center gap-1 text-[12px] text-muted-foreground"
            >
              <LayoutTemplate className="h-4 w-4" />
              More
            </button>
          </nav>

          {mobileMenuOpen && (
            <div className="fixed inset-0 z-50 flex items-end bg-foreground/20 lg:hidden">
              <button
                type="button"
                className="absolute inset-0 cursor-default"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close workspace menu"
              />
              <div className="relative w-full rounded-t-lg bg-background px-5 pb-7 pt-5 text-foreground shadow-2xl">
                <div className="mb-5 flex items-center justify-between">
                  <p className="text-[16px] font-semibold text-foreground">Workspace</p>
                  <button
                    type="button"
                    onClick={() => setMobileMenuOpen(false)}
                    className="text-[13px] font-medium text-primary"
                  >
                    Close
                  </button>
                </div>
                <div className="grid grid-cols-4 gap-x-3 gap-y-5">
                  {menuModules.map((item) => {
                    const Icon = item.icon;
                    return (
                      <div className="contents" key={item.key}>
                        <button
                          type="button"
                          onFocus={() =>
                            preloadWorkspaceModule(item.key, user?.id)
                          }
                          onMouseEnter={() =>
                            preloadWorkspaceModule(item.key, user?.id)
                          }
                          onClick={() => {
                            selectModule(item.key);
                            setMobileMenuOpen(false);
                          }}
                          className={cn(
                            "flex min-w-0 flex-col items-center gap-2 text-[12px] text-muted-foreground",
                            activeKey === item.key && "text-primary",
                          )}
                        >
                          <span className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
                            <Icon className="h-4 w-4" />
                          </span>
                          <span className="w-full truncate text-center">
                            {item.label}
                          </span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
      </div>

      {/* Mounted once at the shell, outside the module switch, so it follows
          the person across tabs instead of restarting on every change. */}
      <FloatingAssistant
        context={assistantContext}
        fullName={fullName}
        workspaceLogo={workspaceLogo}
        onOpenSettings={openAiSettings}
      />
    </AssistantControllerProvider>
  );
}

export default Dashboard;

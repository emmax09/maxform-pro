/**
 * MaxAI's full workspace surface.
 *
 * The floating assistant is still useful for quick questions, but this page is
 * the durable home for AI work: conversation on the left, an editable module
 * canvas on the right, explainable insights, history, and workspace controls.
 * Drafts are deliberately saved as AI canvas sessions first. A person chooses
 * when a generated form, event, or booking page is copied into its owning
 * module.
 */
import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUp,
  ArrowUpRight,
  BarChart3,
  BrainCircuit,
  Bookmark,
  BookmarkX,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Copy,
  Eye,
  EyeOff,
  FileText,
  History,
  KeyRound,
  LayoutDashboard,
  Link2,
  Lightbulb,
  Loader2,
  LockKeyhole,
  Mail,
  MessageSquare,
  Plus,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
  Ticket,
  Trash2,
  Workflow,
} from "lucide-react";
import { toast } from "sonner";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";

import { BrandLogo } from "@/components/BrandLogo";
import { AssistantRichText } from "@/components/assistant/AssistantRichText";
import { emptyBookingPage } from "@/components/appointments/appointment-format";
import { BookingPageBuilder } from "@/components/appointments/BookingPageBuilder";
import type { BookingPage } from "@/lib/appointments";
import { FormBuilder } from "@/components/forms/FormBuilder";
import { generateFormFromPrompt } from "@/components/forms/ai-form-generator";
import {
  createId,
  defaultFormSettings,
  type FormRecord,
} from "@/components/forms/form-types";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { createEvent, saveEvent } from "@/lib/events";
import {
  createWorkspaceForm,
  saveWorkspaceForm,
} from "@/lib/forms";
import {
  deleteSavedGeneration,
  listAiInsights,
  listAiCanvasSessions,
  listAssistantConversations,
  listSavedGenerations,
  loadAssistantCapabilities,
  loadAiWorkspaceSettings,
  notifyWorkspaceChanged,
  saveAiCanvasSession,
  saveAiModuleAccess,
  saveAiProviderConfig,
  activateAiProviderConnection,
  disconnectAiProviderConnection,
  saveGeneration,
  sendAssistantMessage,
  testAiProviderConnection,
  updateAiInsight,
  type AiCanvasType,
  type AiCanvasSession,
  type AiInsight,
  type AiModuleAccessSetting,
  type AiWorkspaceSettings,
  type AiProviderConnection,
  type AssistantCapabilities,
  type AssistantConversationSummary,
  type PendingConfirmation,
  type SavedGeneration,
} from "@/lib/ai-assistant";

import { AssistantMessageAvatar } from "./AssistantPanel";
import { ConfirmationCard } from "./ConfirmationCard";
import { useAssistantController } from "./assistant-controller";

const EventsModule = lazy(() =>
  import("@/components/events/EventsModule").then((module) => ({
    default: module.EventsModule,
  })),
);
const AppointmentsModule = lazy(() =>
  import("@/components/appointments/AppointmentsModule").then((module) => ({
    default: module.AppointmentsModule,
  })),
);
const AnalyticsModule = lazy(() =>
  import("@/components/analytics/AnalyticsModule").then((module) => ({
    default: module.AnalyticsModule,
  })),
);
const CrmModule = lazy(() =>
  import("@/components/crm/CrmModule").then((module) => ({
    default: module.CrmModule,
  })),
);
const CampaignsModule = lazy(() =>
  import("@/components/campaigns/CampaignsModule").then((module) => ({
    default: module.CampaignsModule,
  })),
);
const DocumentsModule = lazy(() =>
  import("@/components/documents/DocumentsModule").then((module) => ({
    default: module.DocumentsModule,
  })),
);
const FilesModule = lazy(() =>
  import("@/components/files/FilesModule").then((module) => ({
    default: module.FilesModule,
  })),
);
const IntegrationsHub = lazy(() =>
  import("@/components/integrations/IntegrationsHub").then((module) => ({
    default: module.IntegrationsHub,
  })),
);
const FormsModule = lazy(() =>
  import("@/components/forms/FormsModule").then((module) => ({
    default: module.FormsModule,
  })),
);
const PaymentsModule = lazy(() =>
  import("@/components/payments/PaymentsModule").then((module) => ({
    default: module.PaymentsModule,
  })),
);
const OrdersModule = lazy(() =>
  import("@/components/orders/OrdersModule").then((module) => ({
    default: module.OrdersModule,
  })),
);
const ProjectsModule = lazy(() =>
  import("@/components/projects/ProjectsModule").then((module) => ({
    default: module.ProjectsModule,
  })),
);
const EmailModule = lazy(() =>
  import("@/components/email/EmailModule").then((module) => ({
    default: module.EmailModule,
  })),
);

const quickGenerators = [
  {
    key: "form",
    label: "Draft a form",
    description: "Build fields, validation, styling, and payment settings.",
    icon: FileText,
    prompt:
      "Help me design a form. Ask me what it is for, then propose the fields and settings.",
  },
  {
    key: "workflow",
    label: "Plan an automation",
    description: "Turn a trigger and outcome into a workflow brief.",
    icon: Workflow,
    prompt:
      "Help me plan an automation for this workspace. Ask what should trigger it and what should happen.",
  },
  {
    key: "email",
    label: "Write an email",
    description: "Create a reusable email brief with a clear audience and goal.",
    icon: Mail,
    prompt:
      "Help me write an email to a contact. Ask who it is for and what it needs to say before drafting.",
  },
  {
    key: "summary",
    label: "Summarise the month",
    description: "Review analytics and highlight what needs attention.",
    icon: BarChart3,
    prompt:
      "Summarise how this workspace has done over the last 30 days: revenue, orders and anything that needs attention.",
  },
  {
    key: "event",
    label: "Plan an event",
    description: "Start an event brief that can move into Events when ready.",
    icon: Ticket,
    prompt:
      "Help me plan an event in this workspace. Ask about the date, capacity and ticketing before suggesting anything.",
  },
] as const;

type QuickGenerator = (typeof quickGenerators)[number];
export type AIWorkspaceTab =
  | "home"
  | "chat"
  | "generators"
  | "insights"
  | "history"
  | "settings";
type WorkspaceTab = AIWorkspaceTab;
type WorkspaceModuleKey =
  | "home"
  | "analytics"
  | "projects"
  | "crm"
  | "campaigns"
  | "forms"
  | "events"
  | "appointments"
  | "workflows"
  | "files"
  | "documents"
  | "payments"
  | "orders"
  | "ai"
  | "emails"
  | "integrations"
  | "settings";

type CanvasDraft = {
  sessionId: string | null;
  conversationId: string | null;
  canvasType: AiCanvasType;
  module: WorkspaceModuleKey;
  title: string;
  sourcePrompt: string;
  state: Record<string, unknown>;
};

type WorkspaceChatTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  messageId?: string;
  saved?: boolean;
};

const moduleLabels: Record<WorkspaceModuleKey, string> = {
  home: "Home",
  analytics: "Analytics",
  projects: "Projects",
  crm: "CRM",
  campaigns: "Campaigns",
  forms: "Forms",
  events: "Events",
  appointments: "Appointments",
  workflows: "Workflows",
  files: "Files",
  documents: "Documents",
  payments: "Payments",
  orders: "Orders",
  ai: "MaxAI",
  emails: "Email",
  integrations: "Integrations",
  settings: "Settings",
};

const moduleDescriptions: Record<WorkspaceModuleKey, string> = {
  home: "Workspace activity and attention signals.",
  analytics: "Response, conversion, and revenue reporting.",
  projects: "Project folders and shared work.",
  crm: "Contacts, companies, deals, and tasks.",
  campaigns: "Audience messaging and campaign delivery.",
  forms: "Form builder, responses, and sharing.",
  events: "Events, registration, tickets, and check-in.",
  appointments: "Booking pages, availability, and appointments.",
  workflows: "Automations that run on submissions.",
  files: "Uploaded files and folders.",
  documents: "Templates, documents, and signatures.",
  payments: "Checkout, transactions, and payouts.",
  orders: "Every sale the workspace has taken.",
  ai: "AI conversations and generated drafts.",
  emails: "Sending identities, templates, and logs.",
  integrations: "Connected third-party services.",
  settings: "Workspace and personal settings.",
};

const tabDefinitions: Array<{ key: WorkspaceTab; label: string; icon: typeof BrainCircuit }> = [
  { key: "home", label: "Overview", icon: LayoutDashboard },
  { key: "generators", label: "Generators", icon: BrainCircuit },
  { key: "insights", label: "Insights", icon: Lightbulb },
  { key: "history", label: "History", icon: History },
  { key: "settings", label: "Settings", icon: Settings2 },
];

type AiProviderId = "anthropic" | "openai" | "gemini" | "openai-compatible";
type AiProviderCardId = AiProviderId | "groq" | "custom";

type AiProviderCard = {
  id: AiProviderCardId;
  provider: AiProviderId;
  name: string;
  description: string;
  bestFor: string;
  setupGuide: string;
  setupUrl: string;
  setupLabel: string;
  defaultModel: string;
  defaultBaseUrl: string;
  logoSrc?: string;
  customEndpoint?: boolean;
};

const aiProviderCards: AiProviderCard[] = [
  {
    id: "gemini",
    provider: "gemini",
    name: "Google Gemini",
    description: "Fast multimodal models from Google AI Studio.",
    bestFor: "A strong default for everyday workspace help.",
    setupGuide: "Create a key in Google AI Studio, then paste it below. MaxAI encrypts it before saving.",
    setupUrl: "https://aistudio.google.com/app/apikey",
    setupLabel: "Get a Gemini API key",
    defaultModel: "gemini-2.5-flash",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    logoSrc: "/images/ai/google-gemini.svg",
  },
  {
    id: "anthropic",
    provider: "anthropic",
    name: "Anthropic",
    description: "Claude models with strong reasoning and writing quality.",
    bestFor: "Long-form reasoning and careful drafting.",
    setupGuide: "Create a key in the Anthropic Console, then paste it below. MaxAI encrypts it before saving.",
    setupUrl: "https://console.anthropic.com/settings/keys",
    setupLabel: "Get an Anthropic API key",
    defaultModel: "claude-opus-5",
    defaultBaseUrl: "https://api.anthropic.com",
    logoSrc: "/images/ai/anthropic.svg",
  },
  {
    id: "openai",
    provider: "openai",
    name: "OpenAI",
    description: "OpenAI models through the Chat Completions API.",
    bestFor: "General-purpose generation and tool calling.",
    setupGuide: "Create a secret key on the OpenAI API keys page, then paste it below. MaxAI encrypts it before saving.",
    setupUrl: "https://platform.openai.com/api-keys",
    setupLabel: "Get an OpenAI API key",
    defaultModel: "gpt-4.1",
    defaultBaseUrl: "https://api.openai.com/v1",
    logoSrc: "/images/ai/openai.svg",
  },
  {
    id: "groq",
    provider: "openai-compatible",
    name: "Groq",
    description: "Fast hosted models through Groq's OpenAI-compatible API.",
    bestFor: "Low-latency workspace assistance and tool calling.",
    setupGuide: "Create a Groq API key, then paste it into the secure connection form.",
    setupUrl: "https://console.groq.com/keys",
    setupLabel: "Get a Groq API key",
    defaultModel: "llama-3.3-70b-versatile",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    logoSrc: "/images/ai/groq.svg",
  },
  {
    id: "custom",
    provider: "openai-compatible",
    name: "Custom endpoint",
    description: "Connect any OpenAI-compatible API, proxy, or local runtime.",
    bestFor: "OpenRouter, Together, Ollama, vLLM, or your own gateway.",
    setupGuide: "Enter the endpoint name, base URL, model, and API key for your compatible service.",
    setupUrl: "https://platform.openai.com/docs/api-reference",
    setupLabel: "Open a compatible provider guide",
    defaultModel: "",
    defaultBaseUrl: "",
    customEndpoint: true,
  },
];

const ProviderLogo = ({
  card,
  className,
}: {
  card: AiProviderCard;
  className?: string;
}) => (
  <span
    className={cn(
      "inline-flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[13px] bg-white shadow-sm ring-1 ring-black/5 dark:ring-white/10",
      className,
    )}
  >
    {card.logoSrc ? <img src={card.logoSrc} alt={`${card.name} official logo`} className="h-full w-full object-contain" /> : <Link2 className="h-5 w-5 text-primary" aria-hidden="true" />}
  </span>
);

const aiProviderCard = (providerOrCard: string) =>
  aiProviderCards.find(
    (card) => card.id === providerOrCard || card.provider === providerOrCard,
  ) || aiProviderCards[0];

const relativeTime = (iso: string, now = Date.now()) => {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const minutes = Math.round((now - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
};

const navigateToModule = (module: WorkspaceModuleKey, section?: string) => {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("tab", module);
  if (section) url.searchParams.set("section", section);
  else url.searchParams.delete("section");
  window.history.pushState({}, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
};

const titleFromPrompt = (prompt: string, fallback: string) => {
  const named = prompt.match(/\b(?:called|named|titled)\s+["']?([^"',.!?]{2,64})/i)?.[1];
  return named?.trim() || fallback;
};

const formCanvas = (prompt: string): CanvasDraft => {
  const generated = generateFormFromPrompt(prompt);
  const settings = defaultFormSettings();
  if (generated.paymentRequested) {
    settings.payment = { ...settings.payment, enabled: true };
  }
  const now = new Date().toISOString();
  const form: FormRecord = {
    id: createId("ai-form"),
    slug: "",
    projectId: null,
    title: generated.title,
    description: generated.description,
    fields: generated.fields,
    settings,
    status: "draft",
    createdBy: "",
    createdAt: now,
    updatedAt: now,
    responseCount: 0,
  };
  return {
    sessionId: null,
    conversationId: null,
    canvasType: "form_builder",
    module: "forms",
    title: generated.title,
    sourcePrompt: prompt,
    state: { form, sourceLabel: generated.sourceLabel },
  };
};

const eventCanvas = (prompt: string): CanvasDraft => ({
  sessionId: null,
  conversationId: null,
  canvasType: "event_builder",
  module: "events",
  title: titleFromPrompt(prompt, "New event plan"),
  sourcePrompt: prompt,
  state: {
    title: titleFromPrompt(prompt, "New event plan"),
    description: "",
    eventDate: "",
    startTime: "",
    endTime: "",
    timezone: "UTC",
    capacity: 0,
    ticketingEnabled: /\b(ticket|paid|price|sell)\b/i.test(prompt),
    currency: "USD",
  },
});

const appointmentCanvas = (prompt: string): CanvasDraft => {
  const page = {
    ...emptyBookingPage(),
    id: createId("ai-booking"),
    slug: "",
    name: titleFromPrompt(prompt, "New booking page"),
    description: "",
    updatedAt: null,
    bookings: 0,
    views: 0,
  };
  return {
    sessionId: null,
    conversationId: null,
    canvasType: "appointment_booking_page",
    module: "appointments",
    title: page.name || "New booking page",
    sourcePrompt: prompt,
    state: { bookingPage: page },
  };
};

const genericCanvas = (
  prompt: string,
  module: WorkspaceModuleKey,
  canvasType: AiCanvasType = "generic_module",
): CanvasDraft => ({
  sessionId: null,
  conversationId: null,
  canvasType,
  module,
  title: `${moduleLabels[module]} draft`,
  sourcePrompt: prompt,
  state: {
    module,
    brief: prompt,
    status: "draft",
    nextStep: `Review this brief in ${moduleLabels[module]}.`,
  },
});

const canvasForGenerator = (generator: QuickGenerator): CanvasDraft => {
  if (generator.key === "form") return formCanvas(generator.prompt);
  if (generator.key === "event") return eventCanvas(generator.prompt);
  if (generator.key === "summary") {
    return genericCanvas(generator.prompt, "analytics", "analytics_chart");
  }
  if (generator.key === "workflow") return genericCanvas(generator.prompt, "workflows");
  return genericCanvas(generator.prompt, "emails");
};

const canvasForInsight = (insight: AiInsight): CanvasDraft => {
  if (insight.module === "forms") return formCanvas(insight.explanation);
  if (insight.module === "events") return eventCanvas(insight.explanation);
  if (insight.module === "appointments") return appointmentCanvas(insight.explanation);
  if (insight.module === "analytics") {
    return genericCanvas(insight.explanation, "analytics", "analytics_chart");
  }
  if (insight.module === "crm") return genericCanvas(insight.explanation, "crm", "crm_table");
  if (insight.module === "campaigns") {
    return genericCanvas(insight.explanation, "campaigns", "campaign_builder");
  }
  if (insight.module === "documents") {
    return genericCanvas(insight.explanation, "documents", "document_template");
  }
  const module = insight.module as WorkspaceModuleKey;
  return genericCanvas(insight.explanation, module);
};

const moduleForCanvas = (session: AiCanvasSession): WorkspaceModuleKey => {
  const fixed: Partial<Record<AiCanvasType, WorkspaceModuleKey>> = {
    form_builder: "forms",
    event_builder: "events",
    appointment_booking_page: "appointments",
    analytics_chart: "analytics",
    crm_table: "crm",
    campaign_builder: "campaigns",
    document_template: "documents",
  };
  if (fixed[session.canvasType]) return fixed[session.canvasType]!;
  const candidate = String(session.canvasState.module || "");
  return candidate in moduleLabels ? (candidate as WorkspaceModuleKey) : "ai";
};

const canvasFromSession = (session: AiCanvasSession): CanvasDraft => ({
  sessionId: session.id,
  conversationId: session.conversationId,
  canvasType: session.canvasType,
  module: moduleForCanvas(session),
  title: session.title,
  sourcePrompt: String(session.canvasState.prompt || session.title),
  state: session.canvasState,
});

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
      <p className="mt-0.5 text-[12.5px] text-muted-foreground">{description}</p>
    </div>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-[12.5px] text-muted-foreground">
      {children}
    </p>
  );
}

function QuickGenerators({ onStart }: { onStart: (generator: QuickGenerator) => void }) {
  return (
    <section aria-label="Quick generators">
      <SectionHeading
        title="Start something"
        description="Generate a real editable draft, then refine it with MaxAI."
      />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {quickGenerators.map((generator) => {
          const Icon = generator.icon;
          return (
            <button
              key={generator.key}
              type="button"
              onClick={() => onStart(generator)}
              className={cn(
                "flex flex-col items-start gap-2 rounded-xl border border-border bg-card p-3 text-left transition",
                "hover:border-primary/40 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="h-4 w-4" />
              </span>
              <span className="text-[12.5px] font-medium text-foreground">
                {generator.label}
              </span>
              <span className="text-[11px] leading-4 text-muted-foreground">
                {generator.description}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ConversationHistory({
  conversations,
  loading,
  onOpen,
}: {
  conversations: AssistantConversationSummary[];
  loading: boolean;
  onOpen: (id: string) => void;
}) {
  return (
    <section aria-label="Conversation history">
      <SectionHeading
        title="Your conversations"
        description="Only yours — a teammate in this workspace cannot read them."
      />
      {loading ? (
        <p className="flex items-center gap-2 px-1 text-[12.5px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
        </p>
      ) : conversations.length === 0 ? (
        <EmptyState>Nothing yet. Ask the assistant something and it will show up here.</EmptyState>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {conversations.map((conversation) => (
            <li key={conversation.id}>
              <button
                type="button"
                onClick={() => onOpen(conversation.id)}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <MessageSquare className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-foreground">
                    {conversation.title || "Untitled conversation"}
                  </span>
                  <span className="block text-[11.5px] text-muted-foreground">
                    {conversation.messageCount} message{conversation.messageCount === 1 ? "" : "s"} · {relativeTime(conversation.updatedAt)}
                    {conversation.context?.module ? ` · ${conversation.context.module}` : ""}
                  </span>
                </span>
                {conversation.status === "escalated" ? (
                  <span className="shrink-0 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10.5px] font-medium text-amber-700 dark:text-amber-300">
                    With a person
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SavedGenerations({
  generations,
  loading,
  onOpen,
  onDelete,
  deletingId,
}: {
  generations: SavedGeneration[];
  loading: boolean;
  onOpen: (conversationId: string) => void;
  onDelete: (id: string) => void;
  deletingId: string | null;
}) {
  const copy = async (generation: SavedGeneration) => {
    try {
      await navigator.clipboard.writeText(generation.content);
      toast.success("Copied.");
    } catch {
      toast.error("Could not copy that.");
    }
  };

  return (
    <section aria-label="Saved generations">
      <SectionHeading
        title="Saved"
        description="Kept as its own copy, so it survives the conversation being cleared."
      />
      {loading ? (
        <p className="flex items-center gap-2 px-1 text-[12.5px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
        </p>
      ) : generations.length === 0 ? (
        <EmptyState>Nothing saved yet. Keep an answer from a conversation and it will appear here.</EmptyState>
      ) : (
        <ul className="space-y-2">
          {generations.map((generation) => (
            <li key={generation.id} className="rounded-xl border border-border bg-card p-3">
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Bookmark className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-foreground">{generation.title}</p>
                  <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted-foreground">
                    {generation.content}
                  </p>
                  <p className="mt-1.5 text-[11px] text-muted-foreground">Saved {relativeTime(generation.createdAt)}</p>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-1">
                <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px]" onClick={() => void copy(generation)}>
                  <Copy className="mr-1 h-3.5 w-3.5" /> Copy
                </Button>
                {generation.conversationId ? (
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-[12px]" onClick={() => onOpen(generation.conversationId!)}>
                    <MessageSquare className="mr-1 h-3.5 w-3.5" /> Open conversation
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-7 px-2 text-[12px] text-muted-foreground"
                  onClick={() => onDelete(generation.id)}
                  disabled={deletingId === generation.id}
                >
                  {deletingId === generation.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <BookmarkX className="mr-1 h-3.5 w-3.5" />}
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CanvasHistory({
  sessions,
  loading,
  onOpen,
}: {
  sessions: AiCanvasSession[];
  loading: boolean;
  onOpen: (session: AiCanvasSession) => void;
}) {
  return (
    <section aria-label="AI canvas history">
      <SectionHeading title="Canvas drafts" description="Editable drafts saved separately from the owning module." />
      {loading ? (
        <p className="flex items-center gap-2 px-1 text-[12.5px] text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</p>
      ) : sessions.length === 0 ? (
        <EmptyState>No canvas drafts saved yet.</EmptyState>
      ) : (
        <ul className="space-y-2">
          {sessions.map((session) => (
            <li key={session.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><ClipboardList className="h-3.5 w-3.5" /></span>
              <div className="min-w-0 flex-1"><p className="truncate text-[12.5px] font-semibold text-foreground">{session.title}</p><p className="text-[11px] text-muted-foreground">{moduleLabels[moduleForCanvas(session)]} · Updated {relativeTime(session.updatedAt)}</p></div>
              <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[11.5px]" onClick={() => onOpen(session)}>Open</Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function WorkspaceChatPane({
  module,
  canvas,
  workspaceLogo,
  onConversation,
  available,
  availabilityError,
  availabilityReason,
  onRetry,
  onConfigure,
}: {
  module: WorkspaceModuleKey;
  canvas: CanvasDraft | null;
  workspaceLogo?: string | null;
  onConversation: (id: string) => void;
  available: boolean | null;
  availabilityError: boolean;
  availabilityReason?: string;
  onRetry: () => void;
  onConfigure: () => void;
}) {
  const [turns, setTurns] = useState<WorkspaceChatTurn[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [pendingConfirmations, setPendingConfirmations] = useState<PendingConfirmation[]>([]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const endRef = useRef<HTMLDivElement | null>(null);
  const lastMessageRef = useRef("");
  const requestInFlightRef = useRef(false);
  const checking = available === null && !availabilityError;
  const unavailable = availabilityError || available === false;

  useEffect(() => {
    setTurns([]);
    setConversationId(null);
    setPendingConfirmations([]);
    setError("");
  }, [canvas?.sourcePrompt, canvas?.canvasType]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, thinking, pendingConfirmations.length]);

  const send = async (messageOverride?: string) => {
    const message = (messageOverride ?? draft).trim();
    if (!message || thinking || unavailable || requestInFlightRef.current) return;
    requestInFlightRef.current = true;
    lastMessageRef.current = message;
    setDraft("");
    setError("");
    setTurns((current) => [
      ...current,
      { id: `${Date.now()}-user`, role: "user", content: message },
    ]);
    setThinking(true);
    try {
      const result = await sendAssistantMessage({
        message,
        conversationId,
        surface: "workspace",
        context: { module, section: canvas?.canvasType || "home" },
      });
      setConversationId(result.conversationId);
      onConversation(result.conversationId);
      setPendingConfirmations(result.pendingConfirmations || []);
      notifyWorkspaceChanged(result.workspaceChanges || []);
      if (result.workspaceChanges?.length) {
        void queryClient.invalidateQueries();
      }
      setTurns((current) => [
        ...current,
        {
          id: result.messageId || `${Date.now()}-assistant`,
          role: "assistant",
          content: result.message,
          messageId: result.messageId || undefined,
        },
      ]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "MaxAI could not answer that.");
    } finally {
      requestInFlightRef.current = false;
      setThinking(false);
    }
  };

  const keepAnswer = async (turn: WorkspaceChatTurn) => {
    if (!turn.messageId || savingId) return;
    setSavingId(turn.messageId);
    try {
      await saveGeneration({ messageId: turn.messageId });
      setTurns((current) => current.map((item) => (item.id === turn.id ? { ...item, saved: true } : item)));
      toast.success("Answer saved.");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "That answer could not be saved.");
    } finally {
      setSavingId(null);
    }
  };

  const settle = (id: string, outcome: "confirmed" | "declined", message: string) => {
    setPendingConfirmations((current) => current.filter((item) => item.id !== id));
    setTurns((current) => [
      ...current,
      { id: `${Date.now()}-${outcome}`, role: "assistant", content: message },
    ]);
  };

  return (
    <section className="flex min-h-[580px] flex-col overflow-hidden rounded-[26px] border border-border/80 bg-background shadow-[0_20px_60px_-34px_rgba(15,23,42,0.42)]" aria-label="Workspace chat">
      <header className="flex shrink-0 items-center gap-3 border-b border-border/80 bg-gradient-to-r from-primary/[0.08] via-background/95 to-background/95 px-4 py-3.5">
        <span className="flex h-10 w-10 items-center justify-center rounded-[15px] border border-primary/20 bg-background/80 text-primary shadow-sm"><BrandLogo markSize={21} showWordmark={false} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-semibold tracking-[-0.01em] text-foreground">MaxAI workspace chat</p>
          <p className="truncate text-[11px] text-muted-foreground">Context: {moduleLabels[module]}{canvas ? ` · ${canvas.title}` : ""}</p>
        </div>
        <span className="hidden items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/[0.06] px-2 py-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-300 sm:flex"><ShieldCheck className="h-3.5 w-3.5" /> Workspace scoped</span>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-gradient-to-b from-muted/[0.16] via-background to-background px-4 py-5" aria-busy={checking || thinking}>
        {checking ? (
          <div className="rounded-[20px] border border-primary/20 bg-card/80 p-4 text-[12px] text-muted-foreground shadow-sm">
            <div className="flex items-center gap-2 font-medium text-foreground"><Loader2 className="h-4 w-4 animate-spin text-primary" /> Connecting to MaxAI…</div>
            <p className="mt-1 pl-6">Checking the workspace AI connection.</p>
          </div>
        ) : unavailable ? (
          <div className="rounded-[20px] border border-amber-500/30 bg-amber-500/[0.06] p-4 text-[12px] text-muted-foreground shadow-sm">
            <div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" /><div><p className="font-medium text-foreground">MaxAI needs a provider connection.</p><p className="mt-1">{availabilityReason || "Connect an AI provider in MaxAI Settings. Your API key stays server-side."}</p><div className="mt-3 flex flex-wrap items-center gap-1.5"><Button type="button" size="sm" className="h-7 px-2 text-[11.5px]" onClick={onConfigure}><Settings2 className="mr-1.5 h-3.5 w-3.5" /> Open AI settings</Button><Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[11.5px]" onClick={onRetry}><RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Retry connection</Button></div></div></div>
          </div>
        ) : turns.length === 0 ? (
          <div className="rounded-[20px] border border-border/80 bg-card/75 p-5 text-[12px] text-muted-foreground shadow-sm">
            <p className="font-medium text-foreground">Describe what you want to change.</p>
            <p className="mt-1 leading-relaxed">MaxAI can inspect the selected module, explain the data it used, and help refine the draft on the right.</p>
          </div>
        ) : null}
        {turns.map((turn) => (
          <div key={turn.id} className={cn("group flex items-end gap-2.5", turn.role === "user" && "flex-row-reverse")}>
            <AssistantMessageAvatar role={turn.role} workspaceLogo={workspaceLogo} />
            <div className="max-w-[88%] min-w-0">
              <p className={cn("mb-1 px-1 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground", turn.role === "user" && "text-right")}>{turn.role === "user" ? "You" : "MaxAI"}</p>
              <div className={cn("rounded-[18px] px-3.5 py-2.5 text-[13px] leading-[1.55] shadow-[0_5px_18px_-14px_rgba(15,23,42,0.45)]", turn.role === "user" ? "rounded-br-[6px] bg-primary text-primary-foreground" : "rounded-bl-[6px] border border-border/90 bg-card text-foreground")}>{turn.role === "assistant" ? <AssistantRichText content={turn.content} /> : <span className="whitespace-pre-wrap">{turn.content}</span>}</div>
              {turn.role === "assistant" && turn.messageId ? (
                <button type="button" className="mt-1 text-[11px] text-muted-foreground hover:text-foreground" onClick={() => void keepAnswer(turn)} disabled={savingId === turn.messageId || turn.saved}>
                  {savingId === turn.messageId ? "Saving…" : turn.saved ? "Saved" : "Save answer"}
                </button>
              ) : null}
            </div>
          </div>
        ))}
        {pendingConfirmations.map((confirmation) => (
          <ConfirmationCard key={confirmation.id} confirmation={confirmation} onSettled={settle} />
        ))}
        {thinking ? (
          <div className="flex items-start gap-2.5" role="status">
            <AssistantMessageAvatar role="assistant" />
            <div className="rounded-[18px] rounded-bl-[6px] border border-border/90 bg-card px-3.5 py-2.5 shadow-sm">
              <div className="flex items-center gap-2 text-[11.5px] font-medium text-muted-foreground">
                <span className="flex gap-1" aria-hidden="true">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary [animation-delay:120ms]" />
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary [animation-delay:240ms]" />
                </span>
                MaxAI is working with your workspace...
              </div>
            </div>
          </div>
        ) : null}
        {error ? (
          <div role="alert" className="flex items-start justify-between gap-3 rounded-[16px] border border-destructive/30 bg-destructive/10 px-3.5 py-3 text-[12px] text-destructive">
            <p className="min-w-0 leading-relaxed">{error}</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="-mr-1 -mt-1 h-7 shrink-0 px-2 text-[11px] text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => void send(lastMessageRef.current)}
              disabled={thinking || !lastMessageRef.current}
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Try again
            </Button>
          </div>
        ) : null}
        <div ref={endRef} />
      </div>
      <form className="shrink-0 border-t border-border/80 bg-background/95 px-3.5 pb-3.5 pt-2.5" onSubmit={(event) => { event.preventDefault(); void send(); }}>
        <div className="mb-1.5 flex items-center justify-between gap-2 px-1.5">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-primary"><ShieldCheck className="h-3 w-3" /> Workspace chat</span>
          <span className="text-[10px] text-muted-foreground">Enter to send · Shift + Enter for a line</span>
        </div>
        <div className="flex items-end gap-2 rounded-[22px] border border-border bg-card p-2 shadow-[0_8px_24px_-18px_rgba(15,23,42,0.55)] focus-within:border-primary/45 focus-within:ring-2 focus-within:ring-primary/10">
          <Textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder={checking ? "Connecting to MaxAI…" : unavailable ? "Open AI settings to connect MaxAI" : "Ask MaxAI to refine this draft…"} aria-label="Message workspace MaxAI" rows={2} className="max-h-32 min-h-[46px] resize-none border-0 bg-transparent px-2 py-2.5 text-[13px] leading-relaxed shadow-none focus-visible:ring-0" disabled={thinking || unavailable} />
          <Button type="submit" size="icon" className="h-10 w-10 shrink-0 rounded-[14px] shadow-sm" disabled={!draft.trim() || thinking || unavailable} aria-label="Send message">
            {thinking ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          </Button>
        </div>
        <p className="mt-1.5 px-1 text-[10px] leading-4 text-muted-foreground">MaxAI only uses data and actions available in this workspace. Consequential actions pause for approval.</p>
      </form>
    </section>
  );
}

function EventDraftEditor({ state, onChange }: { state: Record<string, unknown>; onChange: (next: Record<string, unknown>) => void }) {
  const update = (key: string, value: unknown) => onChange({ ...state, [key]: value });
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-primary/20 bg-primary/[0.035] p-3 text-[12px] text-muted-foreground">This is a real event draft. Edit the brief here, then create it in Events when the details are ready.</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5 text-[12px] font-medium text-foreground sm:col-span-2">Event name<Input value={String(state.title || "")} onChange={(event) => update("title", event.target.value)} placeholder="Product launch" /></label>
        <label className="space-y-1.5 text-[12px] font-medium text-foreground sm:col-span-2">Description<textarea className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring" value={String(state.description || "")} onChange={(event) => update("description", event.target.value)} placeholder="What should attendees know?" /></label>
        <label className="space-y-1.5 text-[12px] font-medium text-foreground">Date<Input type="date" value={String(state.eventDate || "")} onChange={(event) => update("eventDate", event.target.value)} /></label>
        <label className="space-y-1.5 text-[12px] font-medium text-foreground">Timezone<Input value={String(state.timezone || "UTC")} onChange={(event) => update("timezone", event.target.value)} /></label>
        <label className="space-y-1.5 text-[12px] font-medium text-foreground">Start time<Input type="time" value={String(state.startTime || "")} onChange={(event) => update("startTime", event.target.value)} /></label>
        <label className="space-y-1.5 text-[12px] font-medium text-foreground">End time<Input type="time" value={String(state.endTime || "")} onChange={(event) => update("endTime", event.target.value)} /></label>
        <label className="space-y-1.5 text-[12px] font-medium text-foreground">Capacity<Input type="number" min={0} value={Number(state.capacity || 0)} onChange={(event) => update("capacity", Number(event.target.value) || 0)} /></label>
        <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-[12px] font-medium text-foreground">Ticketing enabled<Switch checked={Boolean(state.ticketingEnabled)} onCheckedChange={(checked) => update("ticketingEnabled", checked)} /></label>
      </div>
    </div>
  );
}

function AppointmentDraftEditor({ state, onChange }: { state: Record<string, unknown>; onChange: (next: Record<string, unknown>) => void }) {
  const page = (state.bookingPage || {}) as Record<string, unknown>;
  const update = (key: string, value: unknown) => onChange({ ...state, bookingPage: { ...page, [key]: value } });
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-primary/20 bg-primary/[0.035] p-3 text-[12px] text-muted-foreground">This draft uses the same booking-page fields as Appointments. You can save it into the live booking-page list when it is ready.</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5 text-[12px] font-medium text-foreground sm:col-span-2">Booking page name<Input value={String(page.name || "")} onChange={(event) => update("name", event.target.value)} placeholder="30-minute consultation" /></label>
        <label className="space-y-1.5 text-[12px] font-medium text-foreground sm:col-span-2">Description<textarea className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring" value={String(page.description || "")} onChange={(event) => update("description", event.target.value)} placeholder="What will this appointment cover?" /></label>
        <label className="space-y-1.5 text-[12px] font-medium text-foreground">Duration in minutes<Input type="number" min={5} value={Number(page.durationMinutes || 30)} onChange={(event) => update("durationMinutes", Number(event.target.value) || 30)} /></label>
        <label className="space-y-1.5 text-[12px] font-medium text-foreground">Location<Input value={String(page.locationDetail || "")} onChange={(event) => update("locationDetail", event.target.value)} placeholder="Video link or address" /></label>
        <label className="space-y-1.5 text-[12px] font-medium text-foreground">Price in cents<Input type="number" min={0} value={Number(page.priceCents || 0)} onChange={(event) => update("priceCents", Number(event.target.value) || 0)} /></label>
        <label className="space-y-1.5 text-[12px] font-medium text-foreground">Status<Input value={String(page.status || "draft")} readOnly /></label>
      </div>
    </div>
  );
}

function LiveModule({ module, userId }: { module: WorkspaceModuleKey; userId?: string }) {
  if (!userId) {
    return <p className="rounded-lg border border-dashed border-border p-4 text-[12px] text-muted-foreground">Sign in with a workspace session to open the live {moduleLabels[module]} module.</p>;
  }
  if (module === "events") return <EventsModule userId={userId} initialTab="all" embedded />;
  if (module === "appointments") return <AppointmentsModule userId={userId} initialTab="booking-pages" />;
  if (module === "analytics") return <AnalyticsModule userId={userId} />;
  if (module === "crm") return <CrmModule userId={userId} initialTab="overview" />;
  if (module === "campaigns") return <CampaignsModule userId={userId} initialTab="overview" />;
  if (module === "documents") return <DocumentsModule userId={userId} initialTab="templates" />;
  if (module === "files") return <FilesModule userId={userId} initialTab="all" />;
  if (module === "integrations") return <IntegrationsHub userId={userId} initialTab="directory" />;
  if (module === "emails") return <EmailModule userId={userId} initialTab="overview" />;
  if (module === "workflows") return <FormsModule userId={userId} activeTab="ai" fullName="" onTabChange={() => undefined} />;
  if (module === "payments") return <PaymentsModule userId={userId} />;
  if (module === "orders") return <OrdersModule userId={userId} initialTab="overview" />;
  if (module === "projects") return <ProjectsModule userId={userId} activeTab="overview" fullName="" onOpenProject={() => undefined} onTabChange={() => undefined} />;
  return <p className="rounded-lg border border-dashed border-border p-4 text-[12px] text-muted-foreground">Open {moduleLabels[module]} from the workspace rail to continue this draft.</p>;
}

function CanvasEditor({
  canvas,
  userId,
  savingSession,
  savingModule,
  onChange,
  onSaveSession,
  onSaveModule,
  onOpenModule,
}: {
  canvas: CanvasDraft;
  userId?: string;
  savingSession: boolean;
  savingModule: boolean;
  onChange: (next: CanvasDraft) => void;
  onSaveSession: () => void;
  onSaveModule: () => void;
  onOpenModule: () => void;
}) {
  const [liveOpen, setLiveOpen] = useState(false);
  const [bookingBuilderOpen, setBookingBuilderOpen] = useState(false);
  const setState = (state: Record<string, unknown>) => onChange({ ...canvas, state });
  const form = canvas.state.form as FormRecord | undefined;
  const bookingPage = canvas.state.bookingPage as Record<string, unknown> | undefined;
  const moduleSaveLabel = canvas.module === "forms" ? "Save to Forms" : canvas.module === "events" ? "Create in Events" : canvas.module === "appointments" ? "Save to Appointments" : `Open ${moduleLabels[canvas.module]}`;

  if (bookingBuilderOpen && bookingPage) {
    return (
      <BookingPageBuilder
        connections={[]}
        page={bookingPage as unknown as BookingPage}
        saving={savingModule}
        onClose={() => setBookingBuilderOpen(false)}
        onSave={(next) => {
          setState({ ...canvas.state, bookingPage: next });
          setBookingBuilderOpen(false);
        }}
      />
    );
  }

  return (
    <section className="flex min-h-[580px] min-w-0 flex-col overflow-hidden rounded-2xl border border-border bg-card" aria-label="Generative canvas">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><BrainCircuit className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-foreground">{canvas.title}</p>
          <p className="text-[11px] text-muted-foreground">Editable {moduleLabels[canvas.module]} canvas</p>
        </div>
        <Button type="button" variant="outline" size="sm" className="h-8 text-[11.5px]" onClick={onSaveSession} disabled={savingSession}>
          {savingSession ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
          Save AI draft
        </Button>
        <Button type="button" size="sm" className="h-8 text-[11.5px]" onClick={onSaveModule} disabled={savingModule || !userId}>
          {savingModule ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
          {moduleSaveLabel}
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {canvas.canvasType === "form_builder" && form ? (
          <FormBuilder
            form={form}
            userId={userId}
            onChange={(next) => setState({ ...canvas.state, form: next })}
            onPreview={() => toast.message("Preview is available after the draft is saved to Forms.")}
            onRestoreVersion={() => undefined}
            onSaveDraft={onSaveModule}
            saveState={savingModule ? "saving" : "dirty"}
            manualDraftSaving={savingModule}
            showToolbarActions={false}
            showHistoryControls
          />
        ) : canvas.canvasType === "event_builder" ? (
          <EventDraftEditor state={canvas.state} onChange={setState} />
        ) : canvas.canvasType === "appointment_booking_page" && bookingPage ? (
          <div className="space-y-3"><AppointmentDraftEditor state={canvas.state} onChange={setState} /><Button type="button" variant="outline" size="sm" className="h-8 text-[11.5px]" onClick={() => setBookingBuilderOpen(true)}><CalendarClock className="mr-1.5 h-3.5 w-3.5" /> Edit in booking-page builder</Button></div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-primary/20 bg-primary/[0.035] p-4">
              <p className="text-[12px] font-semibold text-foreground">AI working brief</p>
              <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted-foreground">{String(canvas.state.brief || canvas.sourcePrompt)}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-border bg-background p-3"><p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Module</p><p className="mt-1 text-[13px] font-semibold text-foreground">{moduleLabels[canvas.module]}</p></div>
              <div className="rounded-xl border border-border bg-background p-3"><p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Next step</p><p className="mt-1 text-[13px] font-semibold text-foreground">{String(canvas.state.nextStep || "Review and apply")}</p></div>
            </div>
          </div>
        )}
        {canvas.canvasType !== "form_builder" ? (
          <div className="mt-4 border-t border-border pt-4">
            <Button type="button" variant="outline" size="sm" className="h-8 text-[11.5px]" onClick={() => setLiveOpen((open) => !open)}>
              {liveOpen ? "Hide" : "Open"} live {moduleLabels[canvas.module]} module
            </Button>
            <Button type="button" variant="ghost" size="sm" className="ml-2 h-8 text-[11.5px]" onClick={onOpenModule}>Go to module</Button>
            {liveOpen ? <div className="mt-4 rounded-xl border border-border bg-background p-2"><Suspense fallback={<p className="p-4 text-[12px] text-muted-foreground">Loading the live module…</p>}><LiveModule module={canvas.module} userId={userId} /></Suspense></div> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function InsightsList({
  insights,
  loading,
  onAction,
  onOpen,
  compact = false,
}: {
  insights: AiInsight[];
  loading: boolean;
  onAction: (id: string, action: "dismiss" | "snooze" | "resolve") => void;
  onOpen: (insight: AiInsight) => void;
  compact?: boolean;
}) {
  if (loading) return <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Scanning workspace signals…</p>;
  if (!insights.length) return <EmptyState>No open signals right now. MaxAI will look again as your workspace changes.</EmptyState>;
  return (
    <div className="space-y-2">
      {insights.slice(0, compact ? 3 : undefined).map((insight) => (
        <article key={insight.id} className="rounded-xl border border-border bg-card p-3">
          <div className="flex items-start gap-2.5">
            <span className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", insight.severity === "critical" ? "bg-destructive/10 text-destructive" : insight.severity === "warning" ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : "bg-primary/10 text-primary")}>
              {insight.severity === "critical" || insight.severity === "warning" ? <AlertTriangle className="h-3.5 w-3.5" /> : <Lightbulb className="h-3.5 w-3.5" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2"><p className="text-[12.5px] font-semibold text-foreground">{moduleLabels[insight.module as WorkspaceModuleKey] || insight.module}</p><span className="text-[10.5px] text-muted-foreground">{relativeTime(insight.updatedAt)}</span></div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{insight.explanation}</p>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-9">
            <Button type="button" size="sm" className="h-7 px-2 text-[11.5px]" onClick={() => onOpen(insight)}>Look into it</Button>
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[11.5px]" onClick={() => onAction(insight.id, "snooze")}>Snooze 24h</Button>
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[11.5px]" onClick={() => onAction(insight.id, "dismiss")}>Dismiss</Button>
          </div>
        </article>
      ))}
    </div>
  );
}

type ProviderSaveInput = {
  provider: string;
  model: string;
  baseUrl: string;
  label: string;
  apiKey: string;
  clearApiKey: boolean;
  connectionId?: string;
  setActive: boolean;
};

const groqBaseUrl = aiProviderCards.find((card) => card.id === "groq")?.defaultBaseUrl || "";

const cardConnections = (card: AiProviderCard, connections: AiProviderConnection[]) =>
  connections.filter((connection) => {
    if (connection.provider !== card.provider) return false;
    if (card.id === "groq") return connection.baseUrl === groqBaseUrl;
    if (card.customEndpoint) return connection.baseUrl !== groqBaseUrl;
    return true;
  });

const cardForConnection = (connection: AiProviderConnection) =>
  connection.provider === "openai-compatible" && connection.baseUrl !== groqBaseUrl
    ? aiProviderCard("custom")
    : aiProviderCard(connection.provider);

function ProviderConnectDialog({
  card,
  connection,
  open,
  canManage,
  saving,
  onOpenChange,
  onSave,
  onDisconnect,
}: {
  card: AiProviderCard | null;
  connection: AiProviderConnection | null;
  open: boolean;
  canManage: boolean;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (input: ProviderSaveInput) => Promise<void> | void;
  onDisconnect: (connectionId: string) => Promise<void> | void;
}) {
  const selectedCard = card || aiProviderCards[0];
  const isEditing = Boolean(connection);
  const isCustom = Boolean(selectedCard.customEndpoint);
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);

  useEffect(() => {
    if (!open) return;
    setModel(connection?.model || selectedCard.defaultModel);
    setBaseUrl(connection?.baseUrl || selectedCard.defaultBaseUrl);
    setLabel(connection?.label || selectedCard.name);
    setApiKey("");
    setShowApiKey(false);
  }, [connection, open, selectedCard]);

  const savedKey = Boolean(connection?.apiKeyConfigured);
  const canSubmit = canManage && !saving && Boolean(model.trim()) && Boolean(baseUrl.trim()) && Boolean(apiKey.trim() || savedKey);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(720px,calc(100dvh-1.5rem))] w-[calc(100vw-1.5rem)] max-w-[560px] overflow-y-auto p-0">
        <DialogHeader className="border-b border-border px-5 pb-4 pt-5 sm:px-6">
          <div className="flex items-start gap-3 pr-6">
            <ProviderLogo card={selectedCard} className="h-11 w-11 rounded-xl" />
            <div className="min-w-0">
              <DialogTitle>{isEditing ? `Manage ${selectedCard.name}` : `Connect ${selectedCard.name}`}</DialogTitle>
              <DialogDescription className="mt-1">{isCustom ? "Use any OpenAI-compatible endpoint. Your key is encrypted before it reaches the database." : `Connect ${selectedCard.name} with the API key from its official console.`}</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="space-y-4 px-5 py-5 sm:px-6">
          <div className="rounded-xl border border-primary/20 bg-primary/[0.035] p-3 text-[11px] leading-5 text-muted-foreground">
            <div className="flex items-start gap-2"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" /><span>Credentials stay scoped to this workspace. MaxAI never sends a key to the browser after it is saved.</span></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="ai-provider-name" className="text-[11.5px]">Provider name</Label><div className="relative"><Input id="ai-provider-name" value={label} readOnly={!isCustom} onChange={(event) => setLabel(event.target.value)} disabled={!canManage || saving} className={cn(!isCustom && "bg-muted/50 pr-9")} /><LockKeyhole className={cn("pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground", isCustom && "hidden")} /></div></div>
            <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="ai-provider-base-url" className="text-[11.5px]">Base URL</Label><div className="relative"><Input id="ai-provider-base-url" value={baseUrl} readOnly={!isCustom} onChange={(event) => setBaseUrl(event.target.value)} disabled={!canManage || saving} className={cn("font-mono text-[11px]", !isCustom && "bg-muted/50 pr-9")} placeholder="https://your-provider.example/v1" /><LockKeyhole className={cn("pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground", isCustom && "hidden")} /></div></div>
            <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="ai-provider-model" className="text-[11.5px]">Model</Label><Input id="ai-provider-model" value={model} readOnly={!isCustom} onChange={(event) => setModel(event.target.value)} disabled={!canManage || saving} className={cn(!isCustom && "bg-muted/50")} placeholder="model-name" /></div>
            <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="ai-provider-key" className="flex items-center gap-1.5 text-[11.5px]"><KeyRound className="h-3.5 w-3.5 text-primary" /> API key</Label><div className="relative"><Input id="ai-provider-key" type={showApiKey ? "text" : "password"} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={savedKey ? `Saved key active${connection?.apiKeyHint ? ` · ${connection.apiKeyHint}` : " · paste to replace"}` : "Paste your provider API key"} autoComplete="new-password" className="pr-10" disabled={!canManage || saving} /><button type="button" aria-label={showApiKey ? "Hide API key" : "Show API key"} onClick={() => setShowApiKey((visible) => !visible)} disabled={!canManage || saving} className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-50">{showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div><p className="text-[10.5px] font-normal leading-4 text-muted-foreground">Leave blank to keep the encrypted key already connected.</p></div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-[10.5px] text-muted-foreground"><a href={selectedCard.setupUrl} target="_blank" rel="noopener noreferrer" className="group inline-flex items-center gap-1 font-medium text-primary hover:underline">{selectedCard.setupLabel}<ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden="true" /></a><span>{isCustom ? "The endpoint must use HTTP or HTTPS." : "Provider name and base URL are fixed."}</span></div>
        </div>
        <DialogFooter className="border-t border-border px-5 py-4 sm:px-6"><div className="flex flex-1 items-center justify-start">{connection ? <Button type="button" variant="ghost" className="px-0 text-[11px] text-destructive hover:bg-transparent hover:text-destructive" disabled={saving} onClick={() => { if (!window.confirm(`Disconnect ${connection.label || selectedCard.name}?`)) return; void Promise.resolve().then(() => onDisconnect(connection.id)).then(() => onOpenChange(false)).catch(() => undefined); }}><Trash2 className="mr-1.5 h-3.5 w-3.5" /> Disconnect</Button> : null}</div><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button><Button type="button" disabled={!canSubmit} onClick={() => void onSave({ provider: selectedCard.provider, model: model.trim(), baseUrl: baseUrl.trim(), label: label.trim() || selectedCard.name, apiKey: apiKey.trim(), clearApiKey: false, ...(connection?.id ? { connectionId: connection.id } : {}), setActive: false })}>{saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Link2 className="mr-1.5 h-3.5 w-3.5" />}{saving ? "Connecting…" : isEditing ? "Save connection" : "Connect provider"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SettingsPanel({
  settings,
  loading,
  onSave,
  savingModule,
  onProviderSave,
  savingProvider,
  onProviderTest,
  testingProvider,
  onProviderActivate,
  onProviderDisconnect,
}: {
  settings: AiWorkspaceSettings | undefined;
  loading: boolean;
  onSave: (setting: AiModuleAccessSetting, accessEnabled: boolean) => void;
  savingModule: string | null;
  onProviderSave: (input: ProviderSaveInput) => Promise<void> | void;
  savingProvider: boolean;
  onProviderTest: (connectionId: string) => Promise<void> | void;
  testingProvider: boolean;
  onProviderActivate: (connectionId: string) => Promise<void> | void;
  onProviderDisconnect: (connectionId: string) => Promise<void> | void;
}) {
  const [connectCard, setConnectCard] = useState<AiProviderCard | null>(null);
  const [editConnection, setEditConnection] = useState<AiProviderConnection | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const configuredActiveConnectionId = settings?.providers?.find((connection) => connection.isActive)?.id
    || (settings?.provider?.configured ? settings.provider.connectionId || "environment-provider" : "none");
  const [selectedActiveConnectionId, setSelectedActiveConnectionId] = useState(configuredActiveConnectionId);

  useEffect(() => {
    setSelectedActiveConnectionId(configuredActiveConnectionId);
  }, [configuredActiveConnectionId]);
  if (loading) return <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading AI settings…</p>;
  if (!settings) return <EmptyState>AI settings could not be loaded. Refresh and try again.</EmptyState>;

  const savedConnections = settings.providers || [];
  const legacyConnection = settings.provider?.configured || settings.provider?.apiKeyConfigured
    ? [{
        id: settings.provider.connectionId || "environment-provider",
        connectionId: settings.provider.connectionId,
        configured: settings.provider.configured,
        provider: settings.provider.provider,
        model: settings.provider.model,
        baseUrl: settings.provider.baseUrl,
        label: settings.provider.label,
        source: settings.provider.source,
        apiKeyConfigured: settings.provider.apiKeyConfigured,
        apiKeyHint: settings.provider.apiKeyHint,
        isActive: true,
        updatedAt: null,
        reason: settings.provider.reason,
      } satisfies AiProviderConnection] : [];
  const connections = savedConnections.length ? savedConnections : legacyConnection;
  const activeConnection = connections.find((connection) => connection.isActive);
  const activeCard = activeConnection ? cardForConnection(activeConnection) : aiProviderCards[0];
  const activeConnectionValue = activeConnection?.id || "none";
  const selectedActiveConnection = connections.find((connection) => connection.id === selectedActiveConnectionId);
  const selectedActiveCard = selectedActiveConnection ? cardForConnection(selectedActiveConnection) : activeCard;
  const canSetActiveProvider = Boolean(
    settings.canManage
      && selectedActiveConnection
      && selectedActiveConnection.configured
      && selectedActiveConnection.id !== activeConnectionValue
      && !savingProvider,
  );
  const openNewConnection = (card: AiProviderCard) => {
    setEditConnection(null);
    setConnectCard(card);
  };
  const openExistingConnection = (connection: AiProviderConnection) => {
    setConnectCard(cardForConnection(connection));
    setEditConnection(connection);
  };
  const closeDialog = (open: boolean) => {
    if (!open && !savingProvider) {
      setConnectCard(null);
      setEditConnection(null);
    }
  };
  const testConnection = async (connection: AiProviderConnection) => {
    setTestingId(connection.id);
    try {
      await onProviderTest(connection.id);
    } finally {
      setTestingId(null);
    }
  };
  const disconnectActiveProvider = () => {
    if (!activeConnection || !settings.canManage || savingProvider) return;
    if (!window.confirm(`Disconnect ${activeConnection.label || activeCard.name}?`)) return;
    void Promise.resolve().then(() => onProviderDisconnect(activeConnection.id)).catch(() => undefined);
  };

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/[0.08] via-card to-card p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-3"><ProviderLogo card={selectedActiveCard} className="h-11 w-11 rounded-xl" /><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="text-[13px] font-semibold text-foreground">Active AI provider</p>{activeConnection ? <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">{activeConnection.label || activeCard.name} is active</span> : <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">No active provider</span>}</div><p className="mt-1 max-w-2xl text-[11.5px] leading-5 text-muted-foreground">Choose the single provider MaxAI uses for this workspace. Connecting a provider does not activate it automatically.</p></div></div>
          <div className="flex w-full flex-col gap-2 lg:w-[500px]">
            <div className="flex flex-wrap gap-2">
              <Select value={selectedActiveConnectionId || "none"} onValueChange={setSelectedActiveConnectionId} disabled={!settings.canManage || savingProvider || !connections.length}>
                <SelectTrigger aria-label="Active AI provider" className="h-10 min-w-[220px] flex-1 bg-background text-[12px]"><SelectValue placeholder="Choose a provider" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none" disabled>No active provider selected</SelectItem>
                  {connections.map((connection) => <SelectItem key={connection.id} value={connection.id} disabled={!connection.configured && connection.id !== activeConnectionValue}><span className="flex items-center justify-between gap-5"><span className="max-w-[230px] truncate">{connection.label || cardForConnection(connection).name}</span><span className={cn("text-[10px]", connection.isActive ? "text-primary" : connection.configured ? "text-emerald-600 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300")}>{connection.isActive ? "Active" : connection.configured ? "Connected" : "Needs key"}</span></span></SelectItem>)}
                </SelectContent>
              </Select>
              <Button type="button" className="h-10 shrink-0" disabled={!canSetActiveProvider} loading={savingProvider} onClick={() => void onProviderActivate(selectedActiveConnectionId)} aria-label="Set active AI provider"><CheckCircle2 className="h-3.5 w-3.5" />{savingProvider ? "Saving" : selectedActiveConnectionId === activeConnectionValue && activeConnectionValue !== "none" ? "Active" : "Set active"}</Button>
              {activeConnection ? <Button type="button" variant="outline" className="h-10 shrink-0 border-destructive/30 px-3 text-destructive hover:bg-destructive/10 hover:text-destructive" disabled={!settings.canManage || savingProvider} onClick={disconnectActiveProvider} aria-label="Disconnect active AI provider"><Trash2 className="h-3.5 w-3.5" /> Disconnect</Button> : null}
            </div>
            {!connections.length ? <p className="text-[10px] text-muted-foreground">Connect a provider below, then select it here.</p> : null}
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" /> Encrypted workspace keys · one active route at a time</div>
          </div>
        </div>
      </section>
      <section>
        <div className="mb-3 flex items-end justify-between gap-3"><SectionHeading title="Provider directory" description="Official providers use fixed names and endpoints. Custom endpoints let you connect any compatible API." /><span className="shrink-0 text-[10.5px] text-muted-foreground">{connections.length} connected</span></div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {aiProviderCards.map((card) => {
            const matches = cardConnections(card, connections);
            const hasActive = matches.some((connection) => connection.isActive);
            return <article key={card.id} className={cn("flex min-h-[286px] flex-col rounded-2xl border bg-card p-4 transition-all", hasActive ? "border-primary/45 shadow-md shadow-primary/5" : "border-border hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-sm")}>
              <button type="button" aria-label={card.name} aria-pressed={hasActive} disabled={!settings.canManage || savingProvider} onClick={() => { const current = matches.find((connection) => connection.isActive) || matches[0]; if (current) openExistingConnection(current); else openNewConnection(card); }} className="flex items-start gap-3 text-left disabled:cursor-not-allowed disabled:opacity-60"><ProviderLogo card={card} className="h-10 w-10 rounded-xl" /><span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className="truncate text-[13px] font-semibold text-foreground">{card.name}</span>{hasActive ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" /> : null}</span><span className="mt-1 block text-[10.5px] leading-4 text-muted-foreground">{card.description}</span></span></button>
              <div className="mt-4 space-y-2 border-t border-border pt-3 text-[10.5px] leading-4 text-muted-foreground"><p><span className="font-medium text-foreground">Best for:</span> {card.bestFor}</p><div className="flex items-start gap-2"><span className="shrink-0 font-medium text-foreground">Base URL</span><code className="min-w-0 break-all rounded-md bg-muted px-1.5 py-1 text-[9.5px]">{card.defaultBaseUrl || "Set in the custom connection form"}</code></div><a href={card.setupUrl} target="_blank" rel="noopener noreferrer" aria-label={card.setupLabel} className="group inline-flex items-center gap-1 font-medium text-primary hover:underline">{card.setupLabel}<ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden="true" /></a></div>
              <div className="mt-auto space-y-2 pt-4">{matches.length ? matches.map((connection) => <div key={connection.id} className="rounded-xl border border-border bg-background/70 p-2.5"><div className="flex items-start gap-2"><span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", connection.configured ? "bg-emerald-500" : "bg-amber-500")} /><div className="min-w-0 flex-1"><p className="truncate text-[10.5px] font-medium text-foreground">{connection.label || card.name}</p><p className="mt-0.5 truncate text-[9.5px] text-muted-foreground">{connection.model || "Model not configured"}{connection.apiKeyHint ? ` · ${connection.apiKeyHint}` : ""}</p></div>{connection.isActive ? <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary">Active</span> : null}</div><div className="mt-2 flex items-center justify-end gap-1.5">{!connection.isActive ? <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-[10px]" disabled={!settings.canManage || savingProvider || !connection.configured} onClick={() => void onProviderActivate(connection.id)}>Set active</Button> : null}<Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[10px]" disabled={!settings.canManage || savingProvider} onClick={() => openExistingConnection(connection)}>Manage</Button><Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[10px]" disabled={!settings.canManage || savingProvider || testingProvider || testingId === connection.id} onClick={() => void testConnection(connection)}>{testingId === connection.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Check</Button></div></div>) : <Button type="button" className="w-full" size="sm" disabled={!settings.canManage || savingProvider} onClick={() => openNewConnection(card)}><Plus className="mr-1.5 h-3.5 w-3.5" /> Connect</Button>}{card.customEndpoint ? <Button type="button" variant="outline" className="w-full" size="sm" disabled={!settings.canManage || savingProvider} onClick={() => openNewConnection(card)}><Plus className="mr-1.5 h-3.5 w-3.5" /> Add another endpoint</Button> : null}</div>
            </article>;
          })}
        </div>
        {!settings.canManage ? <p className="mt-3 text-[11px] text-muted-foreground">Only a workspace owner or admin can connect providers or change the active route.</p> : null}
      </section>
      <section>
        <SectionHeading title="Module access" description="AI follows the same dashboard permissions, with a separate workspace-level off switch." />
        <div className="space-y-2">
          {settings.settings.filter((setting) => !["home", "settings", "ai"].includes(setting.module)).map((setting) => <div key={setting.module} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3"><div className="min-w-0 flex-1"><p className="text-[12.5px] font-semibold text-foreground">{setting.label}</p><p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{setting.description}</p><p className="mt-1 text-[10.5px] text-muted-foreground">Approval categories: {setting.requiresConfirmationFor.length ? setting.requiresConfirmationFor.join(", ") : "none configured"}</p></div><div className="flex shrink-0 items-center gap-2"><span className="text-[10.5px] text-muted-foreground">{setting.dashboardAllowed ? "Available" : "Not in your role"}</span><Switch checked={setting.accessEnabled && setting.dashboardAllowed} disabled={!settings.canManage || !setting.dashboardAllowed || savingModule === setting.module} onCheckedChange={(checked) => onSave(setting, checked)} aria-label={`Allow MaxAI in ${setting.label}`} /></div></div>)}
        </div>
      </section>
      <ProviderConnectDialog card={connectCard} connection={editConnection} open={Boolean(connectCard)} canManage={settings.canManage} saving={savingProvider} onOpenChange={closeDialog} onSave={async (input) => { await onProviderSave(input); setConnectCard(null); setEditConnection(null); }} onDisconnect={async (connectionId) => { await onProviderDisconnect(connectionId); setConnectCard(null); setEditConnection(null); }} />
    </div>
  );
}

const compactNumber = (value: number) =>
  new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value);

const analyticsTooltipStyle = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 10,
  color: "hsl(var(--foreground))",
  fontSize: 11,
};

type AiHomeAnalyticsData = {
  rangeDays: number;
  summary: {
    conversations: number;
    turns: number;
    savedOutputs: number;
    providerReady: boolean;
    providerLabel: string;
    providerModel: string;
    toolCount: number;
  };
  daily: Array<{ date: string; conversations: number; turns: number }>;
  contexts: Array<{ title: string; conversations: number }>;
};

const displayProviderName = (provider: string) => {
  if (!provider) return "AI provider";
  if (provider === "openai-compatible") return "Compatible API";
  return provider
    .split(/[-_]/g)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

const localDateKey = (date: Date) => {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
};

const contextLabel = (module: string | undefined) => {
  if (!module) return "Workspace";
  return moduleLabels[module as WorkspaceModuleKey] || displayProviderName(module);
};

const buildAiHomeAnalytics = (
  conversations: AssistantConversationSummary[],
  generations: SavedGeneration[],
  capabilities: AssistantCapabilities | undefined,
): AiHomeAnalyticsData => {
  const rangeDays = 30;
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const start = new Date(today);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (rangeDays - 1));

  const dailyMap = new Map<string, { date: string; conversations: number; turns: number }>();
  for (let offset = rangeDays - 1; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - offset);
    const key = localDateKey(date);
    dailyMap.set(key, { date: key, conversations: 0, turns: 0 });
  }

  const contextMap = new Map<string, number>();
  let turns = 0;
  let recentConversations = 0;
  for (const conversation of conversations) {
    const updatedAt = new Date(conversation.updatedAt);
    if (Number.isNaN(updatedAt.getTime()) || updatedAt < start || updatedAt > today) continue;
    recentConversations += 1;
    turns += conversation.messageCount;
    const day = dailyMap.get(localDateKey(updatedAt));
    if (day) {
      day.conversations += 1;
      day.turns += conversation.messageCount;
    }
    const context = contextLabel(conversation.context?.module);
    contextMap.set(context, (contextMap.get(context) || 0) + 1);
  }

  const recentSavedOutputs = generations.filter((generation) => {
    const createdAt = new Date(generation.createdAt);
    return !Number.isNaN(createdAt.getTime()) && createdAt >= start && createdAt <= today;
  }).length;

  return {
    rangeDays,
    summary: {
      conversations: recentConversations,
      turns,
      savedOutputs: recentSavedOutputs,
      providerReady: Boolean(capabilities?.available),
      providerLabel: displayProviderName(capabilities?.provider || ""),
      providerModel: capabilities?.model || "Connect a provider in Settings",
      toolCount: capabilities?.tools.length || 0,
    },
    daily: Array.from(dailyMap.values()),
    contexts: Array.from(contextMap.entries())
      .map(([title, count]) => ({ title, conversations: count }))
      .sort((left, right) => right.conversations - left.conversations)
      .slice(0, 5),
  };
};

function MaxAIHomeAnalytics({
  conversations,
  generations,
  capabilities,
  loading,
  error,
  onRefresh,
}: {
  conversations: AssistantConversationSummary[];
  generations: SavedGeneration[];
  capabilities: AssistantCapabilities | undefined;
  loading: boolean;
  error: boolean;
  onRefresh: () => void;
}) {
  const data = useMemo(
    () => buildAiHomeAnalytics(conversations, generations, capabilities),
    [capabilities, conversations, generations],
  );

  return (
    <section className="space-y-3" aria-label="MaxAI analytics">
      <div className="flex flex-wrap items-end justify-between gap-3"><SectionHeading title="MaxAI pulse" description="Usage and capability signals from the assistant itself." /><Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[11.5px]" onClick={onRefresh} disabled={loading}>{loading ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />} Refresh</Button></div>
      {loading ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><div className="h-20 animate-pulse rounded-2xl bg-muted" /><div className="h-20 animate-pulse rounded-2xl bg-muted" /><div className="h-20 animate-pulse rounded-2xl bg-muted" /><div className="h-20 animate-pulse rounded-2xl bg-muted" /><div className="h-[260px] animate-pulse rounded-2xl bg-muted sm:col-span-2" /><div className="h-[260px] animate-pulse rounded-2xl bg-muted" /></div> : error ? <div className="rounded-2xl border border-dashed border-border bg-card p-5 text-[12px] text-muted-foreground">MaxAI activity is unavailable right now. Your assistant and connected provider remain separate from workspace business data.</div> : <><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><div className="rounded-2xl border border-border bg-card p-3.5"><p className="text-[10.5px] text-muted-foreground">AI conversations</p><p className="mt-1 text-[22px] font-semibold tracking-tight text-foreground">{compactNumber(data.summary.conversations)}</p><p className="mt-1 text-[10px] text-muted-foreground">Last {data.rangeDays} days</p></div><div className="rounded-2xl border border-border bg-card p-3.5"><p className="text-[10.5px] text-muted-foreground">Assistant turns</p><p className="mt-1 text-[22px] font-semibold tracking-tight text-foreground">{compactNumber(data.summary.turns)}</p><p className="mt-1 text-[10px] text-muted-foreground">Across recent conversations</p></div><div className="rounded-2xl border border-border bg-card p-3.5"><p className="text-[10.5px] text-muted-foreground">Saved AI outputs</p><p className="mt-1 text-[22px] font-semibold tracking-tight text-foreground">{compactNumber(data.summary.savedOutputs)}</p><p className="mt-1 text-[10px] text-muted-foreground">Drafts saved in MaxAI</p></div><div className="rounded-2xl border border-border bg-card p-3.5"><p className="text-[10.5px] text-muted-foreground">AI provider</p><p className="mt-1 truncate text-[22px] font-semibold tracking-tight text-foreground">{data.summary.providerReady ? "Ready" : "Setup needed"}</p><p className="mt-1 truncate text-[10px] text-muted-foreground">{data.summary.providerReady ? `${data.summary.providerLabel} · ${data.summary.providerModel} · ${data.summary.toolCount} workspace actions` : "Connect a provider in Settings"}</p></div></div><div className="grid gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]"><div className="rounded-2xl border border-border bg-card p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-[12.5px] font-semibold text-foreground">Assistant activity</p><p className="mt-1 text-[10.5px] text-muted-foreground">Conversations and turns handled by MaxAI</p></div><span className="text-[10px] text-muted-foreground">{data.rangeDays} days</span></div><div className="mt-3 h-[220px]">{data.daily.some((day) => day.conversations || day.turns) ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={data.daily} margin={{ top: 8, right: 8, bottom: 0, left: -22 }}><defs><linearGradient id="maxAiConversationActivity" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.25} /><stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} /></linearGradient></defs><CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 4" vertical={false} /><XAxis dataKey="date" axisLine={false} tickLine={false} fontSize={9} minTickGap={28} tickFormatter={(value) => String(value).slice(5)} /><YAxis axisLine={false} tickLine={false} fontSize={9} allowDecimals={false} tickFormatter={(value) => compactNumber(Number(value))} /><RechartsTooltip contentStyle={analyticsTooltipStyle} /><Area type="monotone" dataKey="conversations" name="AI conversations" stroke="hsl(var(--primary))" strokeWidth={2.2} fill="url(#maxAiConversationActivity)" /><Area type="monotone" dataKey="turns" name="Assistant turns" stroke="#7c3aed" strokeWidth={1.7} fill="none" /></AreaChart></ResponsiveContainer> : <div className="flex h-full items-center justify-center text-center text-[11px] text-muted-foreground">Start a MaxAI conversation to see assistant activity here.</div>}</div></div><div className="rounded-2xl border border-border bg-card p-4"><p className="text-[12.5px] font-semibold text-foreground">AI usage by context</p><p className="mt-1 text-[10.5px] text-muted-foreground">Where conversations are starting</p><div className="mt-3 h-[220px]">{data.contexts.length ? <ResponsiveContainer width="100%" height="100%"><BarChart data={data.contexts} layout="vertical" margin={{ top: 4, right: 8, bottom: 0, left: 4 }}><CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 4" horizontal={false} /><XAxis type="number" dataKey="conversations" axisLine={false} tickLine={false} allowDecimals={false} fontSize={9} /><YAxis type="category" dataKey="title" axisLine={false} tickLine={false} fontSize={9} width={88} tickFormatter={(value) => String(value).slice(0, 15)} /><RechartsTooltip contentStyle={analyticsTooltipStyle} /><Bar dataKey="conversations" name="AI conversations" fill="hsl(var(--primary))" radius={[0, 5, 5, 0]} barSize={15} /></BarChart></ResponsiveContainer> : <div className="flex h-full items-center justify-center text-center text-[11px] text-muted-foreground">Use MaxAI from a module or the workspace to see context usage.</div>}</div></div></div></>}
    </section>
  );
}

export function AIWorkspaceModule({
  userId,
  initialTab = "home",
  workspaceLogo,
}: {
  userId?: string;
  initialTab?: AIWorkspaceTab;
  workspaceLogo?: string | null;
} = {}) {
  const controller = useAssistantController();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(initialTab);
  const [canvas, setCanvas] = useState<CanvasDraft | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [savingSession, setSavingSession] = useState(false);
  const [savingModule, setSavingModule] = useState(false);
  const [savingAccessModule, setSavingAccessModule] = useState<string | null>(null);
  const [savingProvider, setSavingProvider] = useState(false);
  const [testingProvider, setTestingProvider] = useState(false);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const capabilities = useQuery({
    queryKey: ["ai-assistant", "capabilities"],
    queryFn: loadAssistantCapabilities,
    enabled: activeTab === "home" || activeTab === "chat",
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const conversations = useQuery({ queryKey: ["ai-assistant", "conversations"], queryFn: listAssistantConversations, retry: false });
  const generations = useQuery({ queryKey: ["ai-assistant", "generations"], queryFn: listSavedGenerations, retry: false });
  const canvasSessions = useQuery({
    queryKey: ["ai-assistant", "canvases"],
    queryFn: listAiCanvasSessions,
    enabled: activeTab === "history",
    retry: false,
  });
  const insights = useQuery({
    queryKey: ["ai-assistant", "insights"],
    queryFn: () => listAiInsights(),
    enabled: activeTab === "insights",
    retry: false,
  });
  const settings = useQuery({
    queryKey: ["ai-assistant", "settings"],
    queryFn: loadAiWorkspaceSettings,
    enabled: activeTab === "settings",
    retry: false,
  });

  const remove = useMutation({
    mutationFn: deleteSavedGeneration,
    onMutate: (id: string) => setDeletingId(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ai-assistant", "generations"] });
      toast.success("Removed.");
    },
    onError: (error: Error) => toast.error(error.message || "That could not be removed."),
    onSettled: () => setDeletingId(null),
  });

  const insightMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "dismiss" | "snooze" | "resolve" }) => updateAiInsight(id, action),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["ai-assistant", "insights"] }),
    onError: (error: Error) => toast.error(error.message || "That insight could not be updated."),
  });

  const startGenerator = (generator: QuickGenerator) => {
    const next = canvasForGenerator(generator);
    setCanvas(next);
    setActiveTab("chat");
    // Keep the established floating surface as the quick-start companion. It
    // is a no-op when the bubble is not mounted, which also makes this page
    // useful in a focused embed and keeps one conversation engine everywhere.
    controller.open({ prompt: generator.prompt });
  };

  const openInsight = (insight: AiInsight) => {
    setCanvas(canvasForInsight(insight));
    setActiveTab("chat");
  };

  const saveSession = async () => {
    if (!canvas) return;
    setSavingSession(true);
    try {
      const saved = await saveAiCanvasSession({
        id: canvas.sessionId,
        conversationId: conversationId || canvas.conversationId,
        canvasType: canvas.canvasType,
        title: canvas.title,
        canvasState: canvas.state,
      });
      setCanvas((current) => current ? { ...current, sessionId: saved.id, conversationId: saved.conversationId } : current);
      toast.success("AI draft saved.");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "The AI draft could not be saved.");
    } finally {
      setSavingSession(false);
    }
  };

  const saveToModule = async () => {
    if (!canvas || !userId) {
      toast.error("A signed-in workspace is required to save this draft.");
      return;
    }
    setSavingModule(true);
    try {
      if (canvas.module === "forms" && canvas.state.form) {
        const form = canvas.state.form as FormRecord;
        const saved = form.id.startsWith("ai-form-")
          ? await createWorkspaceForm(userId, { title: form.title, description: form.description, fields: form.fields, settings: form.settings })
          : await saveWorkspaceForm(userId, form);
        setCanvas((current) => current ? { ...current, state: { ...current.state, form: saved }, title: saved.title } : current);
        notifyWorkspaceChanged([{ module: "forms", action: "created", recordId: saved.id, label: saved.title }]);
        toast.success("Draft saved to Forms.");
        navigateToModule("forms", "all");
      } else if (canvas.module === "events") {
        const state = canvas.state as Record<string, unknown>;
        const created = await createEvent(userId, {
          title: String(state.title || canvas.title),
          currency: String(state.currency || "USD"),
          timezone: String(state.timezone || "UTC"),
          ticketingEnabled: Boolean(state.ticketingEnabled),
        });
        const completed = await saveEvent(
          userId,
          {
            ...created,
            description: String(state.description || ""),
            eventDate: String(state.eventDate || created.eventDate || ""),
            startTime: String(state.startTime || created.startTime || ""),
            endTime: String(state.endTime || created.endTime || ""),
            timezone: String(state.timezone || created.timezone || "UTC"),
            capacityTotal: Number(state.capacity || 0) > 0 ? Number(state.capacity) : null,
          },
          { syncRegistration: true },
        );
        try {
          sessionStorage.setItem(`maxform:active-event:${userId}`, completed.id);
          sessionStorage.setItem(`maxform:active-event-tab:${userId}`, "details");
        } catch {
          // The Events module remains available even when session storage is blocked.
        }
        setCanvas((current) => current ? { ...current, state: { ...current.state, eventId: completed.id } } : current);
        notifyWorkspaceChanged([{ module: "events", action: "created", recordId: completed.id, label: completed.title }]);
        toast.success("Event created. Finishing it in Events is ready.");
        navigateToModule("events", "all");
      } else if (canvas.module === "appointments" && canvas.state.bookingPage) {
        const { saveBookingPage } = await import("@/lib/appointments");
        const result = await saveBookingPage(canvas.state.bookingPage as never);
        setCanvas((current) => current ? { ...current, state: { ...current.state, bookingPage: result.bookingPage } } : current);
        notifyWorkspaceChanged([{ module: "appointments", action: "created", recordId: result.bookingPage.id, label: result.bookingPage.name }]);
        toast.success("Booking page saved to Appointments.");
        navigateToModule("appointments", "booking-pages");
      } else {
        toast.message(`Review this draft in ${moduleLabels[canvas.module]}.`);
        navigateToModule(canvas.module);
      }
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "The module draft could not be saved.");
    } finally {
      setSavingModule(false);
    }
  };

  const handleProviderSave = async (input: ProviderSaveInput) => {
    setSavingProvider(true);
    try {
      await saveAiProviderConfig(input);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["ai-assistant", "settings"] }),
        queryClient.invalidateQueries({ queryKey: ["ai-assistant", "capabilities"] }),
      ]);
      toast.success("AI provider connected.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The AI provider could not be saved.");
      throw error;
    } finally {
      setSavingProvider(false);
    }
  };

  const handleProviderTest = async (connectionId: string) => {
    setTestingProvider(true);
    try {
      const result = await testAiProviderConnection(connectionId);
      toast.success(result.modelAvailable === false ? `Connection verified, but ${result.model} was not listed by the provider.` : "AI provider connection verified.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The AI provider connection could not be verified.");
      throw error;
    } finally {
      setTestingProvider(false);
    }
  };

  const handleProviderActivate = async (connectionId: string) => {
    setSavingProvider(true);
    try {
      await activateAiProviderConnection(connectionId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["ai-assistant", "settings"] }),
        queryClient.invalidateQueries({ queryKey: ["ai-assistant", "capabilities"] }),
      ]);
      toast.success("Active AI provider updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The active AI provider could not be changed.");
      throw error;
    } finally {
      setSavingProvider(false);
    }
  };

  const handleProviderDisconnect = async (connectionId: string) => {
    setSavingProvider(true);
    try {
      await disconnectAiProviderConnection(connectionId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["ai-assistant", "settings"] }),
        queryClient.invalidateQueries({ queryKey: ["ai-assistant", "capabilities"] }),
      ]);
      toast.success("AI provider disconnected.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The AI provider could not be disconnected.");
      throw error;
    } finally {
      setSavingProvider(false);
    }
  };

  const hasLoadError = conversations.isError || generations.isError;
  const aiConnectionLabel = capabilities.isLoading
    ? "Checking AI connection"
    : capabilities.data?.available
      ? `Connected · ${capabilities.data.provider}`
      : "Provider setup needed";

  return (
    <div className="min-h-[calc(100vh-8rem)] space-y-6 pb-8">
      <header className="overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/[0.08] via-card to-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/[0.08] text-primary ring-1 ring-inset ring-primary/15"><BrandLogo markSize={23} showWordmark={false} /></span>
            <h1 className="mt-3 text-[21px] font-semibold text-foreground">MaxAI workspace</h1>
            <p className="mt-1 max-w-[720px] text-[13px] leading-relaxed text-muted-foreground">Build alongside your real workspace modules. MaxAI can inspect Forms, Events, Appointments, CRM, Payments, Campaigns, Workflows, Files, Documents, and Email — and it asks before anything consequential happens.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("rounded-full border px-2.5 py-1 text-[10.5px] font-medium", capabilities.data?.available ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300")}>
              {aiConnectionLabel}
            </span>
            <Button size="sm" className="h-8 rounded-xl text-[12.5px]" onClick={() => controller.open({})}><MessageSquare className="mr-1.5 h-3.5 w-3.5" /> Open assistant</Button>
          </div>
        </div>
      </header>

      <nav className="flex gap-1 overflow-x-auto border-b border-border pb-px" aria-label="MaxAI sections">
        {tabDefinitions.map((tab) => {
          const Icon = tab.icon;
          const active = tab.key === activeTab;
          return <button key={tab.key} type="button" onClick={() => setActiveTab(tab.key)} className={cn("flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-[12.5px] font-medium transition", active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:border-border hover:text-foreground")} aria-current={active ? "page" : undefined}><Icon className="h-3.5 w-3.5" />{tab.label}{tab.key === "insights" && insights.data?.length ? <span className="rounded-full bg-primary/10 px-1.5 text-[10px] text-primary">{insights.data.length}</span> : null}</button>;
        })}
      </nav>

      {activeTab === "home" ? (
        <div className="space-y-7">
          <MaxAIHomeAnalytics conversations={conversations.data || []} generations={generations.data || []} capabilities={capabilities.data} loading={conversations.isLoading || generations.isLoading} error={conversations.isError || generations.isError} onRefresh={() => { void Promise.all([conversations.refetch(), generations.refetch(), capabilities.refetch()]); }} />
          <QuickGenerators onStart={startGenerator} />
          <div className="grid gap-7 lg:grid-cols-2">
            <ConversationHistory conversations={conversations.data || []} loading={conversations.isLoading} onOpen={(id) => controller.open({ conversationId: id })} />
            <SavedGenerations generations={generations.data || []} loading={generations.isLoading} onOpen={(id) => controller.open({ conversationId: id })} onDelete={(id) => remove.mutate(id)} deletingId={deletingId} />
          </div>
        </div>
      ) : null}

      {activeTab === "generators" ? <div className="space-y-6"><QuickGenerators onStart={startGenerator} /><div className="rounded-xl border border-border bg-card p-4"><p className="text-[12.5px] font-semibold text-foreground">How generation works</p><p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-muted-foreground">Each generator creates a local, editable draft using the same field and module models as the owning workspace. Save the AI canvas for later, or apply it to the module only when you are satisfied.</p></div></div> : null}

      {activeTab === "chat" ? (
        <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(280px,0.38fr)_minmax(0,0.62fr)]">
          <WorkspaceChatPane module={canvas?.module || "ai"} canvas={canvas} workspaceLogo={workspaceLogo} available={capabilities.data?.available ?? null} availabilityError={capabilities.isError} availabilityReason={capabilities.data?.reason} onRetry={() => void capabilities.refetch()} onConfigure={() => setActiveTab("settings")} onConversation={(id) => { setConversationId(id); setCanvas((current) => current ? { ...current, conversationId: id } : current); }} />
          {canvas ? <CanvasEditor canvas={canvas} userId={userId} savingSession={savingSession} savingModule={savingModule} onChange={setCanvas} onSaveSession={() => void saveSession()} onSaveModule={() => void saveToModule()} onOpenModule={() => navigateToModule(canvas.module)} /> : <section className="flex min-h-[580px] items-center justify-center rounded-2xl border border-dashed border-border bg-card p-8 text-center"><div className="max-w-sm"><span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><ClipboardList className="h-5 w-5" /></span><h2 className="mt-4 text-[15px] font-semibold text-foreground">Choose a generator to open a canvas</h2><p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">The conversation stays on the left and the real editable draft appears here.</p><Button type="button" className="mt-4 h-8 text-[12px]" onClick={() => setActiveTab("generators")}>Browse generators</Button></div></section>}
        </div>
      ) : null}

      {activeTab === "insights" ? <section><div className="mb-4 flex items-end justify-between gap-3"><SectionHeading title="Insights" description="Signals are explainable, scoped to this workspace, and yours to dismiss or snooze." /><Button type="button" variant="outline" size="sm" className="h-8 text-[11.5px]" onClick={() => void queryClient.invalidateQueries({ queryKey: ["ai-assistant", "insights"] })}><RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Scan again</Button></div><InsightsList insights={insights.data || []} loading={insights.isLoading} onAction={(id, action) => insightMutation.mutate({ id, action })} onOpen={openInsight} /></section> : null}

      {activeTab === "history" ? <div className="space-y-7"><div className="grid gap-7 lg:grid-cols-2"><ConversationHistory conversations={conversations.data || []} loading={conversations.isLoading} onOpen={(id) => controller.open({ conversationId: id })} /><SavedGenerations generations={generations.data || []} loading={generations.isLoading} onOpen={(id) => controller.open({ conversationId: id })} onDelete={(id) => remove.mutate(id)} deletingId={deletingId} /></div><CanvasHistory sessions={canvasSessions.data || []} loading={canvasSessions.isLoading} onOpen={(session) => { setCanvas(canvasFromSession(session)); setConversationId(session.conversationId); setActiveTab("chat"); }} /></div> : null}

      {activeTab === "settings" ? <SettingsPanel settings={settings.data} loading={settings.isLoading} savingModule={savingAccessModule} savingProvider={savingProvider} testingProvider={testingProvider} onProviderSave={handleProviderSave} onProviderTest={handleProviderTest} onProviderActivate={handleProviderActivate} onProviderDisconnect={handleProviderDisconnect} onSave={(setting, accessEnabled) => { setSavingAccessModule(setting.module); void saveAiModuleAccess({ module: setting.module, accessEnabled, requiresConfirmationFor: setting.requiresConfirmationFor }).then((saved) => { queryClient.setQueryData<AiWorkspaceSettings>(["ai-assistant", "settings"], (current) => current ? { ...current, settings: current.settings.map((item) => item.module === setting.module ? { ...item, ...saved } : item) } : current); toast.success(`${setting.label} AI access ${accessEnabled ? "enabled" : "disabled"}.`); }).catch((error: unknown) => toast.error(error instanceof Error ? error.message : "That setting could not be saved.")).finally(() => setSavingAccessModule(null)); }} /> : null}

      {hasLoadError ? <p role="alert" className="text-[12.5px] text-destructive">Some of this could not be loaded. Refresh to try again.</p> : null}
    </div>
  );
}

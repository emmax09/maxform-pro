import { useEffect, useState, type ChangeEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowUpRight,
  BarChart3,
  Braces,
  Check,
  CheckCircle2,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Copy,
  Clock3,
  Download,
  FileText,
  Globe2,
  KeyRound,
  LayoutTemplate,
  ListChecks,
  Loader2,
  Mail,
  MousePointerClick,
  MoreHorizontal,
  Palette,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  RotateCcw,
  Send,
  ServerCog,
  Settings2,
  ShieldCheck,
  Trash2,
  TrendingUp,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import {
  EMAIL_TEMPLATES_UPDATED_EVENT,
  addEmailSendingDomain,
  connectEmailProvider,
  connectManagedEmailProvider,
  checkEmailProviderHealth,
  createEmailAnalyticsWebhook,
  disconnectEmailProvider,
  disconnectManagedEmailProvider,
  deleteEmailSendingDomain,
  createEmailInboundWebhook,
  deleteEmailLogs,
  deleteEmailIdentity,
  getEmailProviderSchemas,
  getEmailAnalytics,
  getEmailWorkspace,
  isWorkspaceEmailTemplate,
  retryEmailLog,
  saveEmailIdentity,
  saveEmailSettings,
  saveEmailTemplate,
  sendEmailTest,
  setEmailProviderRole,
  verifyEmailSendingDomain,
  type EmailConnection,
  type EmailAnalytics,
  type EmailIdentity,
  type InboundEmail,
  type EmailLog,
  type EmailSendingDomain,
  type EmailProviderId,
  type EmailProviderSchema,
  type EmailTemplate,
  type EmailWorkspace,
} from "@/lib/email";
import {
  managedSenderPrefixError,
  normalizeManagedSenderPrefix,
} from "@/lib/email-sender";
import { CampaignBuilder } from "@/components/campaigns/CampaignBuilder";
import { useDesignHistory } from "@/components/campaigns/use-design-history";
import { useScrollLock } from "@/hooks/use-scroll-lock";
import { cn } from "@/lib/utils";
import {
  campaignBlocksPayload,
  campaignDesignFromBlocks,
  campaignPlainText,
  composeCampaignHtml,
  createCampaignBlock,
  emptyCampaignDesign,
  type CampaignBlock,
  type CampaignBlockType,
  type CampaignDesign,
  type CampaignPreviewDevice,
} from "@/components/campaigns/campaign-blocks";
import { templateAccents, templateArtwork } from "./email-artwork";
import { VariableText } from "@/components/ui/variable-text";
import { variablePlainText } from "@/lib/template-variables";
import { formatEmailError } from "@/lib/email-errors";
import {
  activeEmailProviderChoiceValue,
  buildEmailProviderChoices,
  parseEmailProviderChoiceValue,
} from "@/lib/email-provider-state";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import tosendLogo from "@/assets/email-providers/tosend.svg";
import resendLogo from "@/assets/email-providers/resend.svg";
import sendgridLogo from "@/assets/email-providers/sendgrid.ico";
import postmarkLogo from "@/assets/email-providers/postmark.svg";
import mailgunLogo from "@/assets/email-providers/mailgun.svg";
import amazonSesLogo from "@/assets/email-providers/amazon-ses.ico";
import senderLogo from "@/assets/email-providers/sender.svg";
import { usePersistentQuery } from "@/hooks/use-persistent-query";
import {
  TableFilterBar,
  TableFilterSelect,
  TableRowSelect,
  TableSearchField,
  TableSelectionBar,
} from "@/components/shared/TableFilters";
import { CardGrid } from "@/components/shared/CardGrid";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  emailAnalyticsQueryKey,
  emailProviderSchemasQueryKey,
  emailWorkspaceQueryKey,
} from "@/lib/performance/email-module-preload";
import { SERVER_STATE_STALE_TIME } from "@/lib/performance/query-client";
import { downloadCsvFile } from "@/lib/csv";
import { useTableSelection } from "@/hooks/use-table-selection";
import { uploadFileToStorage } from "@/lib/storage";

export type EmailTab = "overview" | "analytics" | "providers" | "identity" | "domains" | "templates" | "sent" | "received" | "logs" | "settings";

type ConfirmationRequest = {
  title: string;
  description: string;
  confirmLabel: string;
  action: () => Promise<boolean>;
};

const tabs: Array<{ value: EmailTab; label: string; icon: typeof Mail }> = [
  { value: "overview", label: "Overview", icon: Mail },
  { value: "analytics", label: "Analytics", icon: BarChart3 },
  { value: "providers", label: "Providers", icon: ServerCog },
  { value: "identity", label: "Identity", icon: ShieldCheck },
  { value: "templates", label: "Templates", icon: FileText },
  { value: "sent", label: "Sent", icon: Send },
  { value: "logs", label: "Logs", icon: Clock3 },
  { value: "settings", label: "Settings", icon: Settings2 },
];

const providerIds: EmailProviderId[] = ["tosend", "resend", "sender", "smtp", "sendgrid", "postmark", "mailgun", "ses"];

const providerLogo: Partial<Record<EmailProviderId, string>> = {
  tosend: tosendLogo,
  resend: resendLogo,
  sender: senderLogo,
  sendgrid: sendgridLogo,
  postmark: postmarkLogo,
  mailgun: mailgunLogo,
  ses: amazonSesLogo,
};

const providerAccent: Record<EmailProviderId, string> = {
  tosend: "#0f766e",
  resend: "#0f172a",
  sender: "#161616",
  smtp: "#0369a1",
  sendgrid: "#0ea5e9",
  postmark: "#f97316",
  mailgun: "#be123c",
  ses: "#f59e0b",
};

const providerSetupLinks: Partial<Record<EmailProviderId, string>> = {
  tosend: "https://dash.tosend.com",
  resend: "https://resend.com/api-keys",
  sender: "https://api.sender.net/login",
  smtp: "https://support.google.com/a/answer/176600",
  sendgrid: "https://app.sendgrid.com/guide/integrate",
  postmark: "https://account.postmarkapp.com/servers",
  mailgun: "https://app.mailgun.com/app/account/security/api_keys",
  ses: "https://console.aws.amazon.com/ses/",
};

const providerCardNotes: Record<EmailProviderId, string> = {
  tosend: "Batch API - delivery webhooks",
  resend: "Managed or custom API delivery",
  sender: "API delivery - sender verification",
  smtp: "Mailbox relay - SMTP credentials",
  sendgrid: "Transactional API - event webhooks",
  postmark: "Transactional API - delivery events",
  mailgun: "Flexible API - sending domains",
  ses: "AWS delivery - high-volume sending",
};

const providerCardDetails: Record<EmailProviderId, { bestFor: string; setup: string }> = {
  tosend: {
    bestFor: "Fast batch delivery for campaign sends.",
    setup: "Connect a ToSend API key and verified sender.",
  },
  resend: {
    bestFor: "Managed or customer-owned transactional delivery.",
    setup: "Choose Managed Sending or connect a Resend API key.",
  },
  sender: {
    bestFor: "Straightforward API delivery for campaigns.",
    setup: "Connect an API token and verify the sender identity.",
  },
  smtp: {
    bestFor: "Existing Google, Microsoft, Zoho, or SMTP relays.",
    setup: "Provide the relay host, port, username, and password.",
  },
  sendgrid: {
    bestFor: "Scalable API sending with delivery events.",
    setup: "Connect an API key and verified sender domain.",
  },
  postmark: {
    bestFor: "Reliable transactional delivery and events.",
    setup: "Connect a server token and approved sender.",
  },
  mailgun: {
    bestFor: "Flexible API sending across verified domains.",
    setup: "Connect an API key and sending domain.",
  },
  ses: {
    bestFor: "AWS-native delivery at high volume.",
    setup: "Provide AWS credentials, region, and verified identity.",
  },
};

const consumerMailboxDomains = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "mail.com",
  "yandex.com",
]);

const emailDomain = (value: string) => value.trim().toLowerCase().split("@")[1] || "";
const isConsumerMailbox = (value: string) => consumerMailboxDomains.has(emailDomain(value));
const isResendSandboxSender = (value: string) => value.trim().toLowerCase() === "onboarding@resend.dev";
const needsResendSenderSetup = (value: string) => isConsumerMailbox(value) || isResendSandboxSender(value);

const moduleLabel: Record<string, string> = {
  forms: "Forms",
  events: "Events",
  payments: "Payments",
  documents: "Documents",
  contacts: "Contacts & campaigns",
  appointments: "Appointments",
  workflows: "Workflows",
};

const ticketAuditLabel = (ids: string[]) => ids.length
  ? `${ids.length} · ${ids.slice(0, 2).map((id) => id.slice(0, 8)).join(", ")}${ids.length > 2 ? "…" : ""}`
  : "—";

type VisualTemplateDesign = {
  eyebrow: string;
  heading: string;
  body: string;
  ctaLabel: string;
  ctaUrl: string;
  accent: string;
};

type EmailBuilderBlockType = "label" | "heading" | "text" | "button" | "image" | "divider" | "spacer";
type EmailBuilderBlock = {
  id: string;
  type: EmailBuilderBlockType;
  content?: string;
  href?: string;
  alt?: string;
  src?: string;
  align?: "left" | "center";
  size?: "small" | "medium" | "large";
  height?: number;
};
type EmailBuilderDesign = {
  accent: string;
  pageBackground: string;
  cardBackground: string;
  footerText: string;
  blocks: EmailBuilderBlock[];
};

const escapeEmailText = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character);
const plainTemplateText = (value: string) => value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const templateSlug = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 96) || "email_template";

const designForTemplate = (template: EmailTemplate | null): VisualTemplateDesign => {
  const saved = template?.blocks.find((block) => block && typeof block === "object" && !Array.isArray(block) && (block as Record<string, unknown>).type === "email_design") as Record<string, unknown> | undefined;
  const palette = templateAccents[template?.module || "workflows"] || templateAccents.workflows;
  return {
    eyebrow: String(saved?.eyebrow || moduleLabel[template?.module || "workflows"] || "MaxForm"),
    heading: String(saved?.heading || template?.subject || "A thoughtful update"),
    body: String(saved?.body || plainTemplateText(template?.textBody || "") || "Share a clear next step with your audience."),
    ctaLabel: String(saved?.ctaLabel || "View details"),
    ctaUrl: String(saved?.ctaUrl || "{{action.url}}"),
    accent: String(saved?.accent || palette.accent),
  };
};

const emailBlockId = () => crypto.randomUUID?.() || `email-block-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const createEmailBuilderBlock = (type: EmailBuilderBlockType): EmailBuilderBlock => {
  const id = emailBlockId();
  if (type === "label") return { id, type, content: "Email update", align: "left" };
  if (type === "heading") return { id, type, content: "A clear, helpful headline", align: "left", size: "large" };
  if (type === "text") return { id, type, content: "Write a thoughtful message that explains what happens next.", align: "left" };
  if (type === "button") return { id, type, content: "View details", href: "{{action.url}}", align: "left" };
  if (type === "image") return { id, type, alt: "Email image", src: "", align: "center" };
  if (type === "divider") return { id, type };
  return { id, type, height: 24 };
};

const isEmailBuilderBlock = (value: unknown): value is EmailBuilderBlock => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const block = value as Record<string, unknown>;
  return typeof block.id === "string" && ["label", "heading", "text", "button", "image", "divider", "spacer"].includes(String(block.type));
};

const builderDesignForTemplate = (template: EmailTemplate | null): EmailBuilderDesign => {
  const saved = template?.blocks.find((block) => block && typeof block === "object" && !Array.isArray(block) && (block as Record<string, unknown>).type === "email_design") as Record<string, unknown> | undefined;
  const visual = designForTemplate(template);
  const savedBlocks = Array.isArray(saved?.blocks) ? saved?.blocks.filter(isEmailBuilderBlock) : [];
  return {
    accent: String(saved?.accent || visual.accent),
    pageBackground: String(saved?.pageBackground || "#F5F7FB"),
    cardBackground: String(saved?.cardBackground || "#FFFFFF"),
    footerText: String(saved?.footerText || "Sent by {{workspace.name}}"),
    blocks: savedBlocks.length ? savedBlocks.map((block) => ({ ...block })) : [
      { ...createEmailBuilderBlock("label"), content: visual.eyebrow },
      { ...createEmailBuilderBlock("heading"), content: visual.heading },
      { ...createEmailBuilderBlock("text"), content: visual.body },
      { ...createEmailBuilderBlock("button"), content: visual.ctaLabel, href: visual.ctaUrl },
    ],
  };
};

const safeActionUrl = (value: string) => /^(https?:|mailto:|\{\{)/i.test(value.trim()) ? value.trim() : "";


const emailBuilderColor = (value: string, fallback: string) => /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
const safeEmailImageSource = (value: string) => /^(https:\/\/|data:image\/(?:png|jpe?g|webp|gif);base64,)/i.test(value.trim()) ? value.trim() : "";
const emailBuilderText = (block: EmailBuilderBlock) => {
  if (block.type === "image") return block.alt || "Image";
  if (block.type === "divider" || block.type === "spacer") return "";
  return block.content?.trim() || "";
};



const formatDate = (value: string | null) => {
  if (!value) return "Not yet";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "Not yet";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(date);
};

const percentage = (part: number, total: number) =>
  total ? `${Math.min(100, (part / total) * 100).toFixed(1)}%` : "0%";

const analyticsDate = (value: string) => {
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(date);
};
const analyticsPercent = (value: number) => `${value.toFixed(1)}%`;
const analyticsLabel = (value: string) => value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const csvValue = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;

const exportEmailAnalytics = (analytics: EmailAnalytics) => {
  const rows = [
    ["Date", "Emails", "Accepted", "Opened", "Clicked", "Failures"],
    ...analytics.trend.map((day) => [day.date, day.total, day.accepted, day.opened, day.clicked, day.failed]),
    [],
    ["Provider", "Emails", "Accepted", "Opened", "Clicked", "Failures"],
    ...analytics.providers.map((provider) => [provider.provider, provider.total, provider.accepted, provider.opened, provider.clicked, provider.failed]),
    [],
    ["Template", "Module", "Emails", "Accepted", "Opened", "Clicked", "Failures"],
    ...analytics.templates.map((template) => [template.key, template.module, template.total, template.accepted, template.opened, template.clicked, template.failed]),
  ];
  const blob = new Blob([rows.map((row) => row.map((value) => csvValue(value)).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `email-analytics-${analytics.rangeDays}d.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
};

function EmptyState({ description, icon: Icon, title }: { description: string; icon: typeof Mail; title: string }) {
  return (
    <div className="flex min-h-[180px] flex-col items-center justify-center border border-dashed border-border bg-muted/20 px-6 text-center">
      <Icon className="h-5 w-5 text-muted-foreground" />
      <h3 className="mt-3 text-[14px] font-semibold text-foreground">{title}</h3>
      <p className="mt-1 max-w-sm text-[12px] leading-5 text-muted-foreground">{description}</p>
    </div>
  );
}

const statusClass = (status: string) => {
  if (["sent", "delivered", "opened", "clicked", "verified", "connected"].includes(status)) {
    return "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  }
  if (["failed", "bounced", "complained", "attention", "unverified"].includes(status)) {
    return "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300";
  }
  if (status === "skipped") {
    return "border-slate-500/25 bg-slate-500/10 text-slate-600 dark:text-slate-300";
  }
  return "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300";
};

function StatusBadge({ status }: { status: string }) {
  return <Badge className={`rounded-md border px-2 py-0.5 text-[10px] capitalize ${statusClass(status)}`} variant="outline">{status.replace(/_/g, " ")}</Badge>;
}

function ConfirmActionDialog({ request, working, onConfirm, onOpenChange }: { request: ConfirmationRequest | null; working: boolean; onConfirm: () => void; onOpenChange: (open: boolean) => void }) {
  return <Dialog open={Boolean(request)} onOpenChange={(open) => { if (!working) onOpenChange(open); }}><DialogContent className="max-w-[440px]"><DialogHeader><DialogTitle>{request?.title || "Confirm action"}</DialogTitle><DialogDescription>{request?.description || "This action cannot be undone."}</DialogDescription></DialogHeader><DialogFooter><Button type="button" variant="outline" disabled={working} onClick={() => onOpenChange(false)}>Cancel</Button><Button type="button" variant="destructive" disabled={working || !request} onClick={onConfirm}>{working && <Loader2 className="h-4 w-4 animate-spin" />}{request?.confirmLabel || "Confirm"}</Button></DialogFooter></DialogContent></Dialog>;
}

function EmailLoading() {
  return (
    <div className="space-y-7" role="status" aria-label="Loading email settings">
      <div className="space-y-2"><Skeleton className="h-8 w-52" /><Skeleton className="h-4 w-80 max-w-full" /></div>
      <Skeleton className="h-11 w-full" />
      <div className="grid gap-4 md:grid-cols-3"><Skeleton className="h-32" /><Skeleton className="h-32" /><Skeleton className="h-32" /></div>
      <Skeleton className="h-[280px]" />
    </div>
  );
}

function ProviderDialog({
  onOpenChange,
  onSave,
  open,
  provider,
  schema,
  working,
}: {
  onOpenChange: (open: boolean) => void;
  onSave: (credentials: Record<string, string>) => void;
  open: boolean;
  provider: EmailProviderId | null;
  schema?: EmailProviderSchema;
  working: boolean;
}) {
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  useEffect(() => {
    if (open) setCredentials({});
  }, [open, provider]);
  const smtpPresets: Record<string, Record<string, string>> = {
    "Google Workspace": { host: "smtp.gmail.com", port: "587", encryption: "STARTTLS" },
    "Microsoft 365": { host: "smtp.office365.com", port: "587", encryption: "STARTTLS" },
    "Zoho Mail": { host: "smtp.zoho.com", port: "587", encryption: "STARTTLS" },
    "Custom SMTP": {},
  };
  const updateCredential = (key: string, value: string) => {
    const preset = provider === "smtp" && key === "preset" ? smtpPresets[value] || {} : {};
    setCredentials((current) => ({ ...current, ...preset, [key]: value }));
  };
  const reset = (nextOpen: boolean) => {
    if (!nextOpen) setCredentials({});
    onOpenChange(nextOpen);
  };
  const fields = schema?.fields || [];
  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogContent className="flex max-h-[min(780px,calc(100dvh-1.5rem))] w-[calc(100vw-1.5rem)] max-w-[540px] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 px-5 pb-3 pt-5 pr-12">
          <div className="mb-3 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary"><KeyRound className="h-4 w-4" /></span>
            <span className="text-[11px] font-medium text-emerald-700 dark:text-emerald-300">Encrypted before storage</span>
          </div>
          <DialogTitle>Connect {schema?.name || "email provider"}</DialogTitle>
          <DialogDescription>
            Credentials are encrypted server-side and never returned to this browser. Provider access is checked where supported; send-only keys are validated when the first message is delivered.
          </DialogDescription>
          {provider !== "smtp" ? <div className="mt-3 rounded-md border border-primary/20 bg-primary/[0.035] px-3 py-2 text-[11px] leading-5 text-muted-foreground">Outbound sending is the primary capability. Send-only API keys are supported. Custom From addresses need provider domain verification; MaxForm Managed Sending uses the platform sender and does not require the workspace owner to own a domain.</div> : null}
        </DialogHeader>
        <div className="dashboard-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {fields.map((field) => (
            <div key={field.key} className="space-y-2">
              <Label htmlFor={`email-provider-${field.key}`}>{field.label}</Label>
              {field.type === "select" ? (
                <Select value={credentials[field.key] || field.default || ""} onValueChange={(value) => updateCredential(field.key, value)}>
                  <SelectTrigger id={`email-provider-${field.key}`}><SelectValue /></SelectTrigger>
                  <SelectContent>{field.options?.map((option) => <SelectItem key={option} value={option}>{field.key === "access_mode" ? option === "send_receive" ? "Send and receive email" : "Send email only" : option}</SelectItem>)}</SelectContent>
                </Select>
              ) : (
                <Input
                  autoComplete="off"
                  id={`email-provider-${field.key}`}
                  onChange={(event) => updateCredential(field.key, event.target.value)}
                  placeholder={field.default || ""}
                  type={field.type === "secret" ? "password" : field.type}
                  value={credentials[field.key] || ""}
                />
              )}
            </div>
          ))}
          {provider === "smtp" && credentials.preset && credentials.preset !== "Custom SMTP" ? <div className="rounded-md border border-primary/20 bg-primary/[0.035] px-3 py-2 text-[11px] leading-5 text-muted-foreground">Connection details were filled for {credentials.preset}. Use an app password or SMTP password issued by that service.</div> : null}
          {provider !== "smtp" ? <p className="text-[10px] leading-4 text-muted-foreground">Send email only is the recommended least-privilege choice. Choose Send and receive only when this provider connection also needs inbound mailbox/webhook capabilities; domain-management permissions are still separate.</p> : null}
        </div>
        <DialogFooter className="shrink-0 border-t border-border px-5 py-4">
          <Button type="button" variant="outline" onClick={() => reset(false)}>Cancel</Button>
          <Button type="button" disabled={working || !provider || fields.some((field) => !(credentials[field.key] || field.default))} onClick={() => onSave(credentials)}>
            {working && <Loader2 className="h-4 w-4 animate-spin" />} {working ? "Testing credentials…" : "Connect provider"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IdentityDialog({ activeProvider, identity, managedSendingDomain, onOpenChange, onSave, open, working }: { activeProvider: EmailWorkspace["activeProvider"]; identity: EmailIdentity | null; managedSendingDomain: string; onOpenChange: (open: boolean) => void; onSave: (input: Partial<EmailIdentity>) => void; open: boolean; working: boolean }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Partial<EmailIdentity>>({});
  const [prefixTouched, setPrefixTouched] = useState(false);
  const [domainWorking, setDomainWorking] = useState(false);
  const [copiedRecord, setCopiedRecord] = useState("");
  const active = identity ? { ...identity, ...draft } : draft;
  useEffect(() => {
    if (open) {
      setDraft(identity ? {
        ...identity,
        managedDomain: activeProvider?.mode === "managed" ? identity.managedDomain || managedSendingDomain : identity.managedDomain,
      } : {
        senderName: "",
        replyTo: "",
        senderPrefix: "",
        managedDomain: activeProvider?.mode === "managed" ? managedSendingDomain : "",
        generatedSenderEmail: "",
        managedSenderEmail: "",
        customSenderEmail: "",
        customDomain: "",
      });
      setPrefixTouched(Boolean(identity?.senderPrefix));
    }
  }, [activeProvider, identity, managedSendingDomain, open]);
  const activeProviderId = activeProvider?.provider;
  const mode = activeProvider?.mode || null;
  const managedDomain = active.managedDomain?.trim().toLowerCase() || "";
  const senderPrefix = active.senderPrefix?.trim() || "";
  const prefixError = mode === "managed" ? managedSenderPrefixError(senderPrefix) : "";
  const managedPreviewEmail = senderPrefix ? `${senderPrefix}@${managedDomain}` : `prefix@${managedDomain}`;
  const customSender = active.customSenderEmail?.trim().toLowerCase() || "";
  const customDomain = active.customDomain?.trim().toLowerCase() || customSender.split("@")[1] || "";
  const replyTo = active.replyTo?.trim().toLowerCase() || "";
  const validEmailValue = (value: string) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
  const validDomainValue = (value: string) => /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(value);
  const workspaceCache = queryClient.getQueriesData<EmailWorkspace>({ queryKey: ["email", "workspace"] });
  const cachedWorkspace = workspaceCache.map(([, value]) => value).find((value): value is EmailWorkspace => Boolean(value));
  const customDomainProvider = mode === "custom" && activeProviderId !== "smtp" && activeProviderId !== "sender";
  const providerDomains = customDomainProvider ? (cachedWorkspace?.domains || []).filter((item) => item.provider === activeProviderId) : [];
  const selectedDomain = providerDomains.find((item) => item.domain === customDomain);
  const domainVerified = activeProviderId === "smtp" || activeProviderId === "sender" || selectedDomain?.status === "verified";
  const customReady = validEmailValue(customSender) && validDomainValue(customDomain) && customSender.split("@")[1] === customDomain && Boolean(domainVerified);
  const canSave = Boolean(mode && active.senderName?.trim() && validEmailValue(replyTo) && (mode === "managed" ? Boolean(managedDomain && !prefixError) : customReady));
  const domainBusy = working || domainWorking;
  const update = (key: keyof EmailIdentity, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const updateSenderName = (value: string) => setDraft((current) => ({
    ...current,
    senderName: value,
    ...(!prefixTouched ? { senderPrefix: normalizeManagedSenderPrefix(value) } : {}),
  }));
  const updatePrefix = (value: string) => {
    setPrefixTouched(true);
    update("senderPrefix", value);
  };
  const updateCustomSender = (value: string) => setDraft((current) => ({
    ...current,
    customSenderEmail: value,
    customDomain: value.includes("@") ? value.split("@")[1].toLowerCase() : current.customDomain,
  }));
  const invalidateWorkspace = async () => {
    await queryClient.invalidateQueries({ queryKey: ["email", "workspace"] });
  };
  const addDomain = async () => {
    if (!customDomainProvider || !validDomainValue(customDomain)) return;
    setDomainWorking(true);
    try {
      await addEmailSendingDomain(customDomain);
      await invalidateWorkspace();
      toast.success("Sending domain added. Publish the DNS records shown below.");
    } catch (error) {
      toast.error(formatEmailError(error, "The sending domain could not be added. Check the domain and try again."));
    } finally {
      setDomainWorking(false);
    }
  };
  const verifyDomain = async (domainId: string) => {
    setDomainWorking(true);
    try {
      const result = await verifyEmailSendingDomain(domainId);
      await invalidateWorkspace();
      toast.success(result.domain.status === "verified" ? "Sending domain verified." : "Domain checked; DNS records still need attention.");
    } catch (error) {
      await invalidateWorkspace().catch(() => undefined);
      toast.error(formatEmailError(error, "The sending domain could not be verified. Check the DNS records and try again."));
    } finally {
      setDomainWorking(false);
    }
  };
  const deleteDomain = async (domain: EmailSendingDomain) => {
    if (!window.confirm(`Delete ${domain.domain}? This removes the verification record and pauses custom sending for identities using it.`)) return;
    setDomainWorking(true);
    try {
      await deleteEmailSendingDomain(domain.id);
      await invalidateWorkspace();
      toast.success("Sending domain deleted.");
    } catch (error) {
      toast.error(formatEmailError(error, "The sending domain could not be deleted. Please try again."));
    } finally {
      setDomainWorking(false);
    }
  };
  const copyRecord = async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedRecord(key);
      window.setTimeout(() => setCopiedRecord((current) => current === key ? "" : current), 1500);
    } catch {
      toast.error("The DNS value could not be copied.");
    }
  };
  const start = (nextOpen: boolean) => onOpenChange(nextOpen);
  const domainInstruction = selectedDomain?.status === "failed"
    ? formatEmailError(selectedDomain.lastError, "The provider could not verify this domain. Check the DNS records and try again.")
    : selectedDomain?.status === "verified"
      ? "This domain is verified by the active provider and can be used in the From address."
      : "Add the domain to the active provider, publish every DNS record shown, then check verification again.";
  return (
    <Dialog open={open} onOpenChange={start}>
      <DialogContent className="dashboard-scroll max-h-[94dvh] max-w-[680px] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{identity ? "Edit sender identity" : "Set sender identity"}</DialogTitle>
          <DialogDescription>Configure the single sender used by campaigns, forms, automations, appointments, and transactional email.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="rounded-md border border-primary/20 bg-primary/[0.035] px-3 py-2 text-[10px] leading-4 text-muted-foreground">
            Active provider: <strong className="text-foreground">{activeProvider ? activeProvider.mode === "managed" ? "Resend Managed" : providerSetupNames[activeProvider.provider] : "Not selected"}</strong>. Sender fields below are determined by that active provider.
          </div>
          {!activeProvider ? (
            <div className="flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/6 p-4 text-[11px] leading-5 text-amber-800 dark:text-amber-200">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Choose and activate a delivery provider first. The sender fields will then update automatically for Managed or Custom sending.</span>
            </div>
          ) : <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label>Sender name</Label><Input value={active.senderName || ""} onChange={(event) => updateSenderName(event.target.value)} placeholder="Acme Clinic" /></div>
              <div className="space-y-2"><Label>Reply-to address</Label><Input type="email" value={active.replyTo || ""} onChange={(event) => update("replyTo", event.target.value)} placeholder="support@example.com" /></div>
            </div>
            {mode === "managed" ? (
            <div className="space-y-4 rounded-lg border border-primary/20 bg-primary/[0.035] p-4">
              <div className="space-y-2">
                <Label>Your sending address</Label>
                <div className="flex items-center rounded-md border border-input bg-background px-3 transition-colors focus-within:border-primary/60 focus-within:ring-1 focus-within:ring-primary/25 focus-within:ring-offset-0">
                  <Input aria-label="Sender prefix" value={senderPrefix} onChange={(event) => updatePrefix(event.target.value)} placeholder="testspace" className="h-9 border-0 px-0 shadow-none focus:border-0 focus-visible:border-0 focus-visible:outline-hidden focus-visible:ring-0 focus-visible:ring-offset-0" />
                  <span className="shrink-0 text-[12px] text-muted-foreground">@{managedDomain}</span>
                </div>
                {prefixError ? <p className="text-[10px] leading-4 text-destructive">{prefixError}</p> : null}
                <p className="text-[10px] leading-4 text-muted-foreground">This is the address recipients will see. You can customize the prefix, but the @{managedDomain} domain is managed and verified by MaxForm.</p>
              </div>
              <div className="rounded-md border border-border bg-background p-3 text-[11px] leading-5">
                <p className="font-medium">Recipients will see:</p>
                <p className="text-muted-foreground">{active.senderName?.trim() || "Your business"} &lt;{managedPreviewEmail}&gt;</p>
                <p className="mt-2 font-medium">Replies will go to:</p>
                <p className="text-muted-foreground">{replyTo || "Enter a Reply-to address"}</p>
              </div>
            </div>
            ) : (
            <div className="space-y-4 rounded-lg border border-border p-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label>From address</Label><Input type="email" value={active.customSenderEmail || ""} onChange={(event) => updateCustomSender(event.target.value)} placeholder={activeProviderId === "smtp" ? "you@example.com" : "hello@mail.example.com"} /></div>
                <div className="space-y-2"><Label>Sending domain</Label><Input value={customDomain} onChange={(event) => update("customDomain", event.target.value.toLowerCase())} placeholder="mail.example.com" disabled={!customDomainProvider} /></div>
              </div>
              {customDomainProvider ? (
                <section className="space-y-3 rounded-md border border-primary/20 bg-primary/[0.035] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div><p className="text-[12px] font-semibold">Verify this sending domain</p><p className="mt-1 text-[10px] leading-4 text-muted-foreground">{providerSetupNames[activeProviderId as EmailProviderId]} requires a verified sender domain before it will accept this From address.</p></div>
                    <StatusBadge status={selectedDomain?.status || "pending"} />
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input value={customDomain} onChange={(event) => update("customDomain", event.target.value.toLowerCase())} placeholder="mail.example.com" aria-label="Sending domain to verify" />
                    <Button type="button" variant="outline" disabled={domainBusy || !validDomainValue(customDomain)} onClick={() => void addDomain()}><Plus className="h-3.5 w-3.5" /> {selectedDomain ? "Refresh domain" : "Add domain"}</Button>
                  </div>
                  <p className={`text-[10px] leading-4 ${selectedDomain?.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}>{domainInstruction}</p>
                  {providerDomains.length ? <div className="space-y-2">
                    {providerDomains.map((item) => <div key={item.id} className="rounded-md border border-border bg-background p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex min-w-0 items-center gap-2"><button type="button" className="truncate text-left text-[11px] font-semibold hover:text-primary" onClick={() => update("customDomain", item.domain)}>{item.domain}</button><StatusBadge status={item.status} /></div><div className="flex flex-wrap gap-1"><Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[10px]" onClick={() => update("customDomain", item.domain)}>Use</Button><Button type="button" size="sm" variant="outline" className="h-7 px-2 text-[10px]" disabled={domainBusy} onClick={() => void verifyDomain(item.id)}><RefreshCw className="h-3 w-3" /> Check</Button><Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[10px] text-destructive" disabled={domainBusy} onClick={() => void deleteDomain(item)}><Trash2 className="h-3 w-3" /> Delete</Button></div></div>
                      {item.lastError ? <p className="mt-2 text-[10px] leading-4 text-destructive">{formatEmailError(item.lastError, "The provider could not verify this domain. Check the DNS records and try again.")}</p> : null}
                      {item.domain === customDomain && item.records.length ? <div className="mt-3 overflow-x-auto rounded border border-border"><table className="w-full min-w-[510px] text-left text-[10px]"><thead className="border-b border-border text-muted-foreground"><tr><th className="px-2 py-2 font-medium">Type</th><th className="px-2 py-2 font-medium">Name</th><th className="px-2 py-2 font-medium">Value</th><th className="px-2 py-2" /></tr></thead><tbody className="divide-y divide-border">{item.records.map((record, index) => { const key = `${item.id}-${index}`; return <tr key={key} className="align-top"><td className="px-2 py-2 font-medium">{record.type}</td><td className="max-w-[180px] break-all px-2 py-2 font-mono text-muted-foreground">{record.name}</td><td className="max-w-[260px] break-all px-2 py-2 font-mono text-muted-foreground">{record.value}</td><td className="px-2 py-2 text-right"><Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => void copyRecord(record.value, key)} aria-label="Copy DNS value"><Copy className="h-3 w-3" /></Button>{copiedRecord === key ? <span className="ml-1 text-[9px] text-emerald-600">Copied</span> : null}</td></tr>; })}</tbody></table></div> : null}
                    </div>)}
                  </div> : <p className="text-[10px] text-muted-foreground">No domains are connected to this provider yet. Add one above to import it and receive the provider&apos;s DNS records.</p>}
                </section>
              ) : <p className="text-[10px] leading-4 text-muted-foreground">{activeProviderId === "sender" ? "Verify the From domain in Sender first. Sender's API confirms the identity when MaxForm delivers the message." : "Use the mailbox authenticated by your SMTP connection. Custom domain DNS management is not required for SMTP."}</p>}
            </div>
            )}
            <div className="flex items-center justify-between border border-border px-3 py-3"><div><p className="text-[12px] font-medium">Workspace-wide system sender</p><p className="mt-0.5 text-[10px] text-muted-foreground">Feature modules do not collect their own sender email.</p></div><Badge variant="outline" className="border-primary/25 bg-primary/10 text-primary">Always used</Badge></div>
          </>}
        </div>
        {!canSave && activeProvider && mode === "custom" && customDomainProvider ? <p className="text-[10px] leading-4 text-amber-700 dark:text-amber-300">Save is available after the From address, Reply-to address, and provider domain verification are complete.</p> : null}
        <DialogFooter><Button type="button" variant="outline" onClick={() => start(false)}>Cancel</Button><Button type="button" disabled={domainBusy || !activeProvider || !canSave} onClick={() => onSave({ id: identity?.id, senderName: active.senderName?.trim(), replyTo, senderPrefix: mode === "managed" ? senderPrefix : "", customSenderEmail: mode === "custom" ? customSender : "", customDomain: mode === "custom" ? customDomain : "" })}>{domainBusy && <Loader2 className="h-4 w-4 animate-spin" />} Save identity</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


function TestEmailDialog({ onOpenChange, onSend, open, template, working }: { onOpenChange: (open: boolean) => void; onSend: (to: string) => void; open: boolean; template: EmailTemplate | null; working: boolean }) {
  const [to, setTo] = useState("");
  return <Dialog open={open} onOpenChange={(value) => { if (!value) setTo(""); onOpenChange(value); }}><DialogContent className="max-w-[470px]"><DialogHeader><DialogTitle>Send a test email</DialogTitle><DialogDescription>Sends a test of {template?.name || "the selected template"} through your active provider.</DialogDescription></DialogHeader><div className="space-y-2 py-3"><Label>Recipient email</Label><Input type="email" value={to} onChange={(event) => setTo(event.target.value)} placeholder="you@example.com" /></div><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="button" disabled={working || !to.trim()} onClick={() => onSend(to)}>{working && <Loader2 className="h-4 w-4 animate-spin" />} Send test now</Button></DialogFooter></DialogContent></Dialog>;
}

function LegacyOverviewPanel({ data, onNavigate, onTest }: { data: EmailWorkspace; onNavigate: (tab: EmailTab) => void; onTest: () => void }) {
  const primary = data.connections.find((connection) => connection.role === "primary" && connection.status !== "disconnected");
  const hasAvailableProvider = data.connections.some((connection) => connection.status !== "disconnected");
  const defaultIdentity = data.identities.find((identity) => identity.isDefault);
  const senderReady = Boolean(defaultIdentity?.senderReady);
  const managedActive = data.activeProvider?.provider === "resend" && data.activeProvider.mode === "managed";
  const deliveryReady = (managedActive && data.managedSendingConfigured) || Boolean(primary?.status === "connected" && primary.healthOk);
  const total = data.overview.sent30d + data.overview.negative30d + data.overview.failed30d;
  const setup = [
    { done: deliveryReady, label: managedActive ? "MaxForm Managed Sending" : hasAvailableProvider ? "Set an active provider" : "Connect a provider", action: () => onNavigate(managedActive ? "identity" : "providers") },
    { done: senderReady, label: "Set a sender identity", action: () => onNavigate("identity") },
    { done: data.templates.length > 0, label: "Review your templates", action: () => onNavigate("templates") },
  ];
  return <div className="space-y-6">
    <div className="grid gap-4 md:grid-cols-3">
      <section className="border border-border bg-card p-5"><p className="text-[11px] font-medium text-muted-foreground">Deliverability health</p><div className="mt-4 flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${deliveryReady ? "bg-emerald-500" : "bg-amber-500"}`} /><p className="text-[18px] font-semibold">{managedActive ? data.managedSendingConfigured ? "Managed Sending ready" : "Managed Sending unavailable" : primary?.healthOk ? "Healthy" : primary ? "Needs attention" : "Needs setup"}</p></div><p className="mt-2 text-[11px] text-muted-foreground">{managedActive ? "MaxForm Managed Sending is active; users do not need to connect a provider." : primary ? `${primary.provider} is assigned as the active provider.` : "Choose an active provider to start sending."}</p></section>
      <section className="border border-border bg-card p-5"><p className="text-[11px] font-medium text-muted-foreground">Sender identity</p><p className="mt-4 text-[18px] font-semibold">{senderReady ? "Ready" : defaultIdentity ? "Needs setup" : "No sender"}</p><p className="mt-2 text-[11px] text-muted-foreground">{defaultIdentity?.senderEmail || (defaultIdentity?.senderError ? formatEmailError(defaultIdentity.senderError, "Finish sender identity setup before sending.") : "Configure a workspace identity.")}</p></section>
      <section className="border border-border bg-card p-5"><p className="text-[11px] font-medium text-muted-foreground">30-day risk rate</p><p className="mt-4 text-[18px] font-semibold">{percentage(data.overview.negative30d, total)}</p><p className="mt-2 text-[11px] text-muted-foreground">{data.overview.negative30d} bounces or complaints · {data.overview.suppressions} suppressed</p></section>
    </div>
    {!deliveryReady || !senderReady ? <section className="border border-primary/20 bg-primary/[0.035] p-5"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><h2 className="text-[16px] font-semibold">Finish your sending setup</h2><p className="mt-1 text-[12px] text-muted-foreground">Complete these steps so transactional emails have a sender and delivery route.</p></div><Button size="sm" type="button" onClick={() => onNavigate(!deliveryReady ? managedActive ? "identity" : "providers" : "identity")}>Continue setup <ChevronRight className="h-4 w-4" /></Button></div><div className="mt-5 grid gap-3 md:grid-cols-3">{setup.map((item, index) => <button key={item.label} type="button" onClick={item.action} className="flex items-center gap-3 border border-border bg-background px-3 py-3 text-left transition-colors hover:border-primary/40"><span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] ${item.done ? "bg-emerald-500 text-white" : "bg-muted text-muted-foreground"}`}>{item.done ? <Check className="h-3.5 w-3.5" /> : index + 1}</span><span className="text-[12px] font-medium">{item.label}</span></button>)}</div></section> : null}
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]"><section className="border border-border bg-card p-5"><div className="flex items-start justify-between border-b border-border pb-4"><div><h2 className="text-[16px] font-semibold">Recent delivery activity</h2><p className="mt-1 text-[11px] text-muted-foreground">Latest transactional and workflow emails.</p></div><Button type="button" variant="ghost" size="sm" onClick={() => onNavigate("logs")}>View logs</Button></div>{data.logs.length ? <div className="divide-y divide-border">{data.logs.slice(0, 6).map((log) => <div key={log.id} className="flex items-center gap-3 py-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"><Mail className="h-3.5 w-3.5" /></span><div className="min-w-0 flex-1"><p className="truncate text-[12px] font-medium">{log.subject || log.templateKey}</p><p className="mt-0.5 truncate text-[10px] text-muted-foreground">{log.recipient} · {formatDate(log.createdAt)}</p></div><StatusBadge status={log.status} /></div>)}</div> : <EmptyState icon={Mail} title="No delivery activity yet" description="Test emails and platform notifications will appear here." />}</section><section className="border border-border bg-card p-5"><h2 className="text-[16px] font-semibold">Quick actions</h2><p className="mt-1 text-[11px] text-muted-foreground">Test delivery and maintain your sending setup.</p><div className="mt-5 space-y-2"><Button type="button" className="w-full justify-start" variant="outline" onClick={onTest}><Send className="h-4 w-4" /> Send a test email</Button><Button type="button" className="w-full justify-start" variant="outline" onClick={() => onNavigate("identity")}><Globe2 className="h-4 w-4" /> Manage sender identity</Button><Button type="button" className="w-full justify-start" variant="outline" onClick={() => onNavigate("templates")}><Plus className="h-4 w-4" /> Create a template</Button></div></section></div>
  </div>;
}

const providerSetupNames: Record<EmailProviderId, string> = {
  tosend: "ToSend", resend: "Resend", sender: "Sender", smtp: "SMTP", sendgrid: "SendGrid", postmark: "Postmark", mailgun: "Mailgun", ses: "Amazon SES",
};

type ProviderSetupStep = { title: string; detail: string };

const providerSetupSteps: Record<EmailProviderId, ProviderSetupStep[]> = {
  tosend: [
    { title: "Connect ToSend securely", detail: "Enter the ToSend API key in this provider connection form. It is encrypted with the workspace credentials and is never required in the deployment environment." },
    { title: "Verify a sending domain", detail: "Add and verify the sending domain in ToSend first. MaxForm imports the verified domain and uses ToSend as the delivery authority." },
    { title: "Configure the webhook", detail: "Create an HTTPS ToSend webhook for bounced and complaint events, set TOSEND_WEBHOOK_SECRET, and use /api/webhooks/email/tosend as the endpoint." },
    { title: "Connect and activate", detail: "Connect ToSend here, then choose it in Active delivery provider and click Set active. Campaign waves use ToSend's ordered batch response and preserve partial successes." },
    { title: "Save the sender identity", detail: "Use a From address on the verified ToSend domain and a valid Reply-to address. A provider acceptance is recorded immediately; bounces and complaints arrive asynchronously through the webhook." },
  ],
  resend: [
    { title: "Choose Managed or Custom", detail: "Managed Sending uses MaxForm's verified Resend account. It needs no user API key, connected provider account, or custom sending domain. Choose Custom when the workspace should send through the user's own Resend account." },
    { title: "Prepare Custom Resend", detail: "For Custom mode, create an API key with email send permission. If you want to add or verify domains from MaxForm, the key also needs the provider permission required for domain management." },
    { title: "Verify the From domain", detail: "Custom Resend From addresses must use a domain verified in that Resend account, for example hello@mail.example.com. Consumer addresses such as gmail.com are not valid Custom Resend From domains; use them as Reply-to instead." },
    { title: "Connect the selected mode", detail: "Choose the Resend mode on the provider card and complete its connection step. A successful connection is only available for activation; it does not change the active provider automatically." },
    { title: "Set active and configure identity", detail: "In Active delivery provider, select the connected Resend mode and click Set active. MaxForm then opens the provider-specific identity form. Managed uses an editable prefix with the MaxForm-managed domain; Custom uses the verified From address." },
    { title: "Know the Resend test sender", detail: "onboarding@resend.dev is a Resend sandbox sender for account testing only. It is not a production workspace sender and is limited to the email address on that Resend account." },
  ],
  sender: [
    { title: "Create a Sender API token", detail: "In Sender, open Settings → API access tokens and create a token with the least privilege required for transactional sending." },
    { title: "Verify the sending domain in Sender", detail: "Sender requires the From address to belong to a verified domain. Complete Sender's domain authentication before sending production mail." },
    { title: "Connect and activate", detail: "Paste the API access token, connect Sender, then select it in Active delivery provider and click Set active. Connecting alone does not change the active route." },
    { title: "Save the sender identity", detail: "Use the verified Sender From address and a valid Reply-to address in Identity. MaxForm sends through Sender's documented transactional endpoint and records the returned email ID." },
  ],
  smtp: [
    { title: "Collect SMTP details", detail: "Prepare the SMTP host, port, encryption mode, username, and password for Google Workspace, Microsoft 365, Zoho, or another mail service. MaxForm uses these credentials for outbound mail." },
    { title: "Use a dedicated password", detail: "Use an app password or provider-specific SMTP password where available. Do not use a normal account password if the provider supports app passwords, and confirm SMTP access is enabled." },
    { title: "Match the sender mailbox", detail: "Use the authenticated mailbox, or an address that mailbox is explicitly allowed to send as. Gmail addresses belong here—not in the Resend sender field." },
    { title: "Connect, activate, and set identity", detail: "Connect SMTP, then select it in Active delivery provider and click Set active. The identity form will use the authenticated mailbox rules; configure the sender name and Reply-to before sending." },
  ],
  sendgrid: [
    { title: "Authenticate the sender", detail: "Complete SendGrid Single Sender Verification or Domain Authentication first. The From address must belong to the authenticated sender or domain; consumer addresses are not a substitute for sender authentication." },
    { title: "Create a least-privilege key", detail: "Create an API key with Mail Send permission for MaxForm. Keep unrelated permissions disabled and store the key only in the secure connection form." },
    { title: "Connect and activate", detail: "Connect SendGrid, then select it in Active delivery provider and click Set active. MaxForm never activates a newly connected provider automatically." },
    { title: "Finish identity and optional events", detail: "Save the provider-specific sender identity after activation. For delivery, open/click analytics, generate the SendGrid event endpoint in Email Analytics, and paste it into SendGrid's event webhook settings." },
  ],
  postmark: [
    { title: "Choose the transactional server", detail: "Open the Postmark server that should deliver this workspace's transactional email. Keep the server token scoped to that server." },
    { title: "Approve the sender", detail: "Verify the From address or its sending domain in Postmark. The workspace From address must be an approved sender signature; Gmail can be used as Reply-to." },
    { title: "Connect and activate", detail: "Paste the server token, connect Postmark, then select it in Active delivery provider and click Set active. Connecting alone does not make it active." },
    { title: "Finish identity and optional events", detail: "Save the sender identity after activation. If delivery analytics are needed, generate the provider endpoint in Email Analytics and add it to the provider's webhook configuration." },
  ],
  mailgun: [
    { title: "Verify a sending domain", detail: "Add a domain you own to Mailgun and publish every DNS record it provides until the domain is verified. Mailgun domain verification is required for the workspace From address." },
    { title: "Prepare the credentials", detail: "Use a Mailgun API key with send permission and enter the same verified sending domain in MaxForm. The credential and domain must refer to the same Mailgun account." },
    { title: "Connect and activate", detail: "Connect Mailgun, then select it in Active delivery provider and click Set active. The provider card can be connected without becoming the active delivery route." },
    { title: "Finish identity and optional events", detail: "Use a From address on the verified Mailgun domain and save the identity after activation. Generate and configure the Mailgun delivery-event endpoint in Email Analytics if analytics are required." },
  ],
  ses: [
    { title: "Choose one SES region", detail: "Select the AWS region where this workspace will send. SES identities, sandbox status, and sending limits are region-specific." },
    { title: "Verify the sender", detail: "Verify the From email address or domain in that same SES region. While the account is in the SES sandbox, recipients may also need verification." },
    { title: "Create limited IAM credentials", detail: "Use credentials limited to SES sending and the selected region. Do not give MaxForm unrelated AWS permissions; rotate credentials through AWS when needed." },
    { title: "Connect, activate, and finish identity", detail: "Connect SES, select it in Active delivery provider, and click Set active. Then save the verified SES From address and Reply-to in the identity form. Configure the SES event endpoint in Email Analytics if needed." },
  ],
};

function ProviderSetupGuide({ onConnect, onOpenChange, open }: { onConnect: (provider: EmailProviderId) => void; onOpenChange: (open: boolean) => void; open: boolean }) {
  const [provider, setProvider] = useState<EmailProviderId>("resend");
  const [step, setStep] = useState(0);
  useEffect(() => { if (open) setStep(0); }, [open]);
  const steps = providerSetupSteps[provider];
  const detailsOpen = step > 0;
  const close = (value: boolean) => { if (!value) setStep(0); onOpenChange(value); };
  return <Dialog open={open} onOpenChange={close}><DialogContent className="flex max-h-[min(720px,calc(100dvh-1.5rem))] w-[calc(100vw-1.5rem)] max-w-[720px] flex-col gap-0 overflow-hidden p-0"><DialogHeader className="shrink-0 border-b border-border px-5 pb-4 pt-5 sm:px-7"><div className="flex items-start gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><ListChecks className="h-5 w-5" /></span><div><DialogTitle>Guided email setup</DialogTitle><DialogDescription className="mt-1">Choose a provider and follow a short, secure setup checklist. You can return to this guide anytime.</DialogDescription></div></div></DialogHeader><div className="dashboard-scroll min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7"><div className="mb-5 rounded-lg border border-primary/20 bg-primary/[0.035] p-3 text-[11px] leading-5 text-muted-foreground"><strong className="text-foreground">No domain? You can still send.</strong> Choose <strong className="text-foreground">Managed Sending</strong> on the Resend card for MaxForm-managed delivery; it needs no user API key or custom domain. For a customer-owned sender, connect a provider and complete its sender or domain verification. Every connection must still be selected in <strong className="text-foreground">Active delivery provider</strong> and saved with <strong className="text-foreground">Set active</strong>. Identity setup opens after activation.</div>{!detailsOpen ? <div className="animate-in fade-in-50 space-y-4 duration-300"><div><p className="text-[13px] font-semibold">Which provider do you want to use?</p><p className="mt-1 text-[11px] text-muted-foreground">You can connect more providers later, but only one is active for delivery at a time.</p></div><div className="grid gap-3 sm:grid-cols-2">{providerIds.map((item) => <button key={item} type="button" onClick={() => setProvider(item)} className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-all ${provider === item ? "border-primary bg-primary/4.5 shadow-xs" : "border-border bg-card hover:border-primary/40"}`}><ProviderMark provider={item} name={providerSetupNames[item]} /><span className="min-w-0 flex-1"><span className="block text-[12px] font-semibold">{providerSetupNames[item]}</span><span className="mt-0.5 block text-[10px] text-muted-foreground">{item === "smtp" ? "Your existing mail service" : "Transactional email provider"}</span></span><CheckCircle2 className={`h-4 w-4 ${provider === item ? "text-primary" : "text-transparent"}`} /></button>)}</div></div> : <div className="animate-in fade-in-50 slide-in-from-right-2 duration-300"><div className="flex items-center gap-3"><ProviderMark provider={provider} name={providerSetupNames[provider]} /><div><p className="text-[13px] font-semibold">Set up {providerSetupNames[provider]}</p><p className="mt-0.5 text-[11px] text-muted-foreground">Step {step} of {steps.length}</p></div></div><div className="mt-6 space-y-3">{steps.map((item, index) => <div key={item.title} className={`rounded-lg border p-4 ${index + 1 === step ? "border-primary/40 bg-primary/[0.035]" : index + 1 < step ? "border-emerald-500/25 bg-emerald-500/[0.035]" : "border-border bg-card"}`}><div className="flex gap-3"><span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${index + 1 < step ? "bg-emerald-500 text-white" : index + 1 === step ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{index + 1 < step ? <Check className="h-3.5 w-3.5" /> : index + 1}</span><div><p className="text-[12px] font-semibold">{item.title}</p><p className="mt-1 text-[11px] leading-5 text-muted-foreground">{item.detail}</p></div></div></div>)}</div><div className="mt-5 rounded-lg border border-amber-500/25 bg-amber-500/4.5 p-3 text-[11px] leading-5 text-muted-foreground"><ShieldCheck className="mr-2 inline h-3.5 w-3.5 text-amber-700" />Only enter provider credentials in the secure connection form. They are encrypted server-side and never shown in this guide.</div></div>}</div><DialogFooter className="shrink-0 border-t border-border px-5 py-4 sm:px-7"><Button type="button" variant="outline" onClick={() => detailsOpen ? setStep(Math.max(0, step - 1)) : close(false)}>{detailsOpen ? "Back" : "Close"}</Button>{!detailsOpen ? <Button type="button" onClick={() => setStep(1)}>Start guide <ChevronRight className="h-4 w-4" /></Button> : step < steps.length ? <Button type="button" onClick={() => setStep(step + 1)}>Continue <ChevronRight className="h-4 w-4" /></Button> : <Button type="button" onClick={() => { close(false); onConnect(provider); }}>Open provider settings <ChevronRight className="h-4 w-4" /></Button>}</DialogFooter></DialogContent></Dialog>;
}

function OverviewPanel({ data, onNavigate, onTest }: { data: EmailWorkspace; onNavigate: (tab: EmailTab) => void; onTest: () => void }) {
  const [guideOpen, setGuideOpen] = useState(false);
  return <div className="space-y-6"><section className="flex flex-col gap-4 rounded-xl border border-primary/20 bg-linear-to-br from-primary/8 via-card to-card p-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-xs"><ListChecks className="h-5 w-5" /></span><div><p className="text-[14px] font-semibold">Set up email with a guided checklist</p><p className="mt-1 max-w-2xl text-[11px] leading-5 text-muted-foreground">Choose a provider, see exactly what to prepare, and connect it through the secure provider form.</p></div></div><Button type="button" onClick={() => setGuideOpen(true)}>Open setup guide <ChevronRight className="h-4 w-4" /></Button></section><LegacyOverviewPanel data={data} onNavigate={onNavigate} onTest={onTest} /><ProviderSetupGuide open={guideOpen} onOpenChange={setGuideOpen} onConnect={() => onNavigate("providers")} /></div>;
}

function ProviderMark({ provider, name }: { provider: EmailProviderId; name: string }) {
  const logo = providerLogo[provider];
  return <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border p-1.5" style={{ backgroundColor: provider === "sender" ? "#161616" : "#ffffff" }}>{logo ? <img src={logo} alt={`${name} logo`} className="max-h-full max-w-full object-contain" /> : <ServerCog className="h-5 w-5" style={{ color: providerAccent[provider] }} aria-label={`${name} provider`} />}</span>;
}

function ProviderSetupLink({ provider, name }: { provider: EmailProviderId; name: string }) {
  const href = providerSetupLinks[provider];
  if (!href) return null;
  return <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`Open ${name} setup guide`} title={`Open ${name} setup guide`} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary"><ArrowUpRight className="h-4 w-4" aria-hidden="true" /><span className="sr-only">Open {name} setup guide</span></a>;
}

export function ActiveProvidersPanel({ connections, managedConnection: configuredManagedConnection, identity, schemas, onConnect, onDisconnect, onHealth, onRole, onManagedConnect: configuredManagedConnect, onManagedRole, onManagedDisconnect: configuredManagedDisconnect, working }: { connections: EmailConnection[]; managedConnection?: EmailConnection; identity?: EmailIdentity; schemas: Record<EmailProviderId, EmailProviderSchema>; onConnect: (provider: EmailProviderId) => void; onDisconnect: (provider: EmailProviderId) => void; onHealth: (provider: EmailProviderId) => void; onRole?: (provider: EmailProviderId, role: EmailConnection["role"] | "active") => Promise<void>; onManagedConnect?: () => Promise<void> | void; onManagedRole: () => Promise<void>; onManagedDisconnect?: () => Promise<void>; working: boolean }) {
  const providerQueryClient = useQueryClient();
  const [managedDisconnecting, setManagedDisconnecting] = useState(false);
  const [managedConnectingRequest, setManagedConnectingRequest] = useState(false);
  const [activeProviderSaving, setActiveProviderSaving] = useState(false);
  const [pendingMode, setPendingMode] = useState<"managed" | "custom" | null>(null);
  const managedConnection = configuredManagedConnection || { id: "managed-resend", provider: "resend" as const, mode: "managed" as const, credentialHint: "MaxForm verified account", role: "none" as const, isActive: false, status: "attention" as const, healthOk: false, validationMode: "api" as const, accessMode: "send" as const, lastHealthCheckAt: null, lastVerifiedAt: null, lastError: "MaxForm Managed Sending is temporarily unavailable. Contact your workspace administrator or choose another connected provider.", createdAt: null, inboundEnabled: false, eventsEnabled: false };
  const onManagedDisconnect = configuredManagedDisconnect || (async () => {
    await disconnectManagedEmailProvider();
    await providerQueryClient.invalidateQueries({ queryKey: ["email", "workspace"] });
    toast.success("Managed Sending disconnected.");
  });
  const onManagedConnect = configuredManagedConnect || (async () => {
    await connectManagedEmailProvider();
    await providerQueryClient.invalidateQueries({ queryKey: ["email", "workspace"] });
    toast.success("Managed Sending connected. Select it above when you want to make it active.");
  });
  const disconnectManaged = async () => {
    setManagedDisconnecting(true);
    try {
      await onManagedDisconnect();
    } catch (error) {
      toast.error(formatEmailError(error, "Managed Sending could not be disconnected. Please try again."));
    } finally {
      setManagedDisconnecting(false);
    }
  };
  const availableProviders = connections.filter((connection) => connection.mode === "custom" && connection.status !== "disconnected");
  const customResendConnection = connections.find((connection) => connection.provider === "resend" && connection.mode === "custom" && connection.status !== "disconnected");
  const activeCustomConnection = availableProviders.find((connection) => connection.isActive || connection.role === "primary");
  const activeProvider: EmailWorkspace["activeProvider"] = managedConnection.isActive
    ? { provider: "resend", mode: "managed" }
    : activeCustomConnection
      ? { provider: activeCustomConnection.provider, mode: "custom" }
      : null;
  const activeConnection = activeProvider?.mode === "managed" ? managedConnection : activeCustomConnection;
  const fallbackConnection = availableProviders.find((connection) => connection.role === "fallback");
  const managedModeConnected = managedConnection.status !== "disconnected";
  const customModeConnected = Boolean(customResendConnection);
  const providerBusy = working || managedConnectingRequest || managedDisconnecting || activeProviderSaving;
  const managedTabLocked = customModeConnected && !managedModeConnected;
  const customTabLocked = managedModeConnected;
  const managedConnecting = managedConnectingRequest && !managedModeConnected;
  const customConnecting = pendingMode === "custom" && !customModeConnected;
  useEffect(() => {
    if (!working && !managedConnectingRequest && pendingMode) setPendingMode(null);
  }, [managedConnectingRequest, pendingMode, working]);
  const connectManagedTab = async () => {
    if (managedModeConnected || managedTabLocked || providerBusy) return;
    setPendingMode("managed");
    setManagedConnectingRequest(true);
    try {
      await onManagedConnect();
    } catch (error) {
      toast.error(formatEmailError(error, "Managed Sending could not be connected. Please try again."));
    } finally {
      setManagedConnectingRequest(false);
      setPendingMode(null);
    }
  };
  const connectCustomTab = () => {
    if (customModeConnected || customTabLocked || providerBusy) return;
    setPendingMode("custom");
    onConnect("resend");
  };
  const activeIsHealthy = Boolean(activeConnection?.status === "connected" && activeConnection.healthOk);
  const activeSenderNeedsSetup = Boolean(activeConnection && (!identity || identity.senderReady === false));
  const activeReady = activeIsHealthy && !activeSenderNeedsSetup;
  const providerChoices = buildEmailProviderChoices(managedConnection, connections, Object.fromEntries(Object.entries(schemas).map(([provider, schema]) => [provider, schema.name])));
  const activeProviderValue = activeEmailProviderChoiceValue(activeProvider);
  const [selectedProviderValue, setSelectedProviderValue] = useState(activeProviderValue);
  useEffect(() => {
    setSelectedProviderValue(activeProviderValue);
  }, [activeProviderValue]);
  const selectedProvider = providerChoices.find((choice) => choice.value === selectedProviderValue);
  const setActiveProvider = async () => {
    const choice = parseEmailProviderChoiceValue(selectedProviderValue);
    if (!choice || !canSetActiveProvider) return;
    setActiveProviderSaving(true);
    try {
      if (choice.mode === "managed") {
        if (managedConnection.healthOk) await onManagedRole();
        return;
      }
      const connection = availableProviders.find((item) => item.provider === choice.provider);
      if (connection?.status === "connected" && connection.healthOk) {
        if (onRole) {
          await onRole(connection.provider, "active");
        } else {
          await setEmailProviderRole(connection.provider, "active", "custom");
          await providerQueryClient.invalidateQueries({ queryKey: ["email", "workspace"] });
          toast.success("Active delivery provider updated.");
        }
      }
    } catch (error) {
      toast.error(formatEmailError(error, "The active provider could not be updated. Please try again."));
    } finally {
      setActiveProviderSaving(false);
    }
  };
  const canSetActiveProvider = Boolean(selectedProvider?.healthy && selectedProviderValue !== activeProviderValue && !providerBusy);
  return (
    <div>
      <div className="mb-5">
        <h2 className="text-[17px] font-semibold">Delivery providers</h2>
        <p className="mt-1 text-[12px] text-muted-foreground">Connect as many providers as you need, then choose exactly one active provider for this workspace.</p>
      </div>
      <section className="mb-5 rounded-xl border border-primary/20 bg-primary/[0.035] p-4 shadow-xs">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><ServerCog className="h-4 w-4" /></span>
            <div>
              <p className="text-[12px] font-semibold">Active delivery provider</p>
              <p className="mt-1 max-w-xl text-[11px] leading-5 text-muted-foreground">Choose one provider for workspace delivery. Connecting a provider alone does not activate it.</p>
            </div>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-[360px]">
            <div className="flex gap-2">
            <Select value={selectedProviderValue} onValueChange={setSelectedProviderValue} disabled={providerBusy || !providerChoices.length}>
              <SelectTrigger aria-label="Active delivery provider" className="h-10 w-full bg-background text-[12px]"><SelectValue placeholder="Choose a provider" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none" disabled>No active provider selected</SelectItem>
                {providerChoices.map((choice) => {
                  const isCurrent = choice.value === activeProviderValue;
                  return <SelectItem key={choice.value} value={choice.value} disabled={!choice.healthy && !isCurrent}><span className="flex items-center justify-between gap-5"><span>{choice.label}</span><span className={`text-[10px] ${choice.healthy ? "text-emerald-600 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}>{isCurrent ? "Active" : choice.healthy ? "Connected" : "Unavailable"}</span></span></SelectItem>;
                })}
              </SelectContent>
            </Select>
            <Button type="button" className="h-10 shrink-0" disabled={!canSetActiveProvider} loading={activeProviderSaving} onClick={() => void setActiveProvider()} aria-busy={activeProviderSaving}>{activeProviderSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} {activeProviderSaving ? "Saving..." : selectedProviderValue === activeProviderValue && activeProviderValue !== "none" ? "Active" : "Set active"}</Button>
            </div>
            {!providerChoices.length ? <p className="text-[10px] text-muted-foreground">Connect at least one provider below, then select it here.</p> : null}
            {activeConnection && activeProvider?.mode === "custom" && !activeIsHealthy ? <Button type="button" size="sm" variant="outline" className="h-8 w-full text-[11px]" disabled={providerBusy} onClick={() => onHealth(activeConnection.provider)}><RefreshCw className="h-3.5 w-3.5" /> Check active provider health</Button> : null}
          </div>
        </div>
        <div className={`mt-3 flex items-center gap-2 text-[10px] ${activeConnection && !activeReady ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${activeReady ? "bg-emerald-500" : activeConnection ? "bg-amber-500" : "bg-muted-foreground"}`} />
           <span>{activeConnection ? activeSenderNeedsSetup ? formatEmailError(identity?.senderError, "Set a sender identity before sending workspace email.") : activeIsHealthy ? `Ready to send workspace email.${fallbackConnection ? ` ${providerSetupNames[fallbackConnection.provider]} is configured as the retry fallback.` : ""}` : activeProvider?.mode === "managed" ? "MaxForm Managed Sending is temporarily unavailable. Contact your workspace administrator or choose another connected provider." : "Active assignment is saved, but sending is paused until the provider is healthy." : "No provider is selected for workspace delivery."}</span>
        </div>
        {activeSenderNeedsSetup ? <div className="mt-3 flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/6 px-3 py-2 text-[11px] leading-5 text-amber-800 dark:text-amber-200"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>Finish the sender identity setup before sending. The active provider remains saved and can be changed independently.</span></div> : null}
      </section>
      <CardGrid className="provider-card-grid items-stretch">
        <section className="flex h-full min-h-[280px] min-w-0 flex-col border border-border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <ProviderMark provider="resend" name="Resend" />
            <div className="flex items-center gap-1">
              <ProviderSetupLink provider="resend" name="Resend" />
              {managedConnecting || customConnecting ? (
                <Badge className="rounded-md border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] text-primary" variant="outline"><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Connecting</Badge>
              ) : managedModeConnected ? <StatusBadge status={managedConnection.status === "connected" && managedConnection.healthOk ? "connected" : managedConnection.status} /> : customResendConnection ? <StatusBadge status={customResendConnection.status === "connected" && customResendConnection.healthOk ? "connected" : customResendConnection.status} /> : <span className="text-[10px] text-muted-foreground">Not connected</span>}
            </div>
          </div>
          <div className="mt-4 flex min-h-0 flex-1 flex-col">
            <h3 className="text-[14px] font-semibold">Resend</h3>
            <p className="mt-1 min-h-9 text-[11px] leading-4 text-muted-foreground">Send through MaxForm&apos;s verified Resend infrastructure or connect your own Resend account.</p>
            <div className="mt-auto pt-4">
            {managedModeConnected ? <div className="mb-3 flex items-center justify-between gap-3 border-b border-border pb-2"><span className="text-[10px] text-muted-foreground">Managed Sending is connected</span><Button type="button" size="sm" variant="ghost" className="h-8 text-[10px] text-destructive" disabled={providerBusy} onClick={() => void disconnectManaged()}>{managedDisconnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Disconnect</Button></div> : null}
            <div className="grid grid-cols-2 gap-2 rounded-xl border border-border p-1.5" role="tablist" aria-label="Resend sending mode">
              <button type="button" role="tab" aria-selected={managedModeConnected} className={`group relative flex min-h-16 items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-all ${managedModeConnected ? "border-primary bg-primary text-primary-foreground shadow-md" : managedTabLocked ? "cursor-not-allowed border-border bg-muted/40 text-muted-foreground" : managedConnecting ? "border-primary/60 bg-transparent text-foreground" : "border-border bg-transparent text-foreground hover:border-primary/40"}`} disabled={providerBusy || managedTabLocked} onClick={() => void connectManagedTab()}>
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${managedModeConnected ? "bg-white/15" : "bg-muted text-muted-foreground"}`}>{managedConnecting ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : <ShieldCheck className="h-4 w-4" />}</span>
                <span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-semibold">Managed</span><span className={`mt-0.5 block truncate text-[9px] ${managedModeConnected ? "text-primary-foreground/75" : "text-muted-foreground"}`}>{managedConnecting ? "Connecting..." : managedModeConnected ? "Connected" : managedTabLocked ? "Disconnect Custom first" : "MaxForm delivery"}</span></span>
                {managedModeConnected ? <CheckCircle2 className="absolute right-2 top-2 h-3.5 w-3.5" /> : null}
              </button>
              <button type="button" role="tab" aria-selected={customModeConnected} className={`group relative flex min-h-16 items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-all ${customModeConnected ? "border-primary bg-primary text-primary-foreground shadow-md" : customTabLocked ? "cursor-not-allowed border-border bg-muted/40 text-muted-foreground" : customConnecting ? "border-primary/60 bg-transparent text-foreground" : "border-border bg-transparent text-foreground hover:border-primary/40"}`} disabled={providerBusy || customTabLocked} onClick={connectCustomTab}>
                <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${customModeConnected ? "bg-white/15" : "bg-muted text-muted-foreground"}`}>{customConnecting ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : <KeyRound className="h-4 w-4" />}</span>
                <span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-semibold">Custom</span><span className={`mt-0.5 block truncate text-[9px] ${customModeConnected ? "text-primary-foreground/75" : "text-muted-foreground"}`}>{customConnecting ? "Connecting..." : customModeConnected ? "Connected" : customTabLocked ? "Disconnect Managed first" : "Your Resend account"}</span></span>
                {customModeConnected ? <CheckCircle2 className="absolute right-2 top-2 h-3.5 w-3.5" /> : null}
              </button>
            </div>
            <p className="mt-2 text-[10px] leading-4 text-muted-foreground">{managedModeConnected ? "Managed Sending is connected. Select it in Active delivery provider above when you want to use it." : customResendConnection ? "Your Resend account is connected. Disconnect it before switching this card to Managed Sending." : "Connect a Resend mode here, then explicitly set it as the active delivery provider above."}</p>
            {managedModeConnected ? <p className="mt-2 truncate text-[10px] text-muted-foreground">{managedConnection.credentialHint}</p> : null}
            {customResendConnection ? <div className="mt-3 border-t border-border pt-2"><div className="mt-2 flex items-center justify-between gap-2"><span className="truncate text-[10px] text-muted-foreground">{customResendConnection.credentialHint}</span><Button type="button" size="sm" variant="ghost" className="h-8 shrink-0 text-[10px] text-destructive" disabled={providerBusy} onClick={() => onDisconnect("resend")}>Disconnect</Button></div></div> : null}
            </div>
          </div>
        </section>
        {providerIds.filter((provider) => provider !== "resend").map((provider) => {
          const connection = connections.find((item) => item.provider === provider && item.status !== "disconnected");
          const schema = schemas[provider];
          const healthy = connection?.status === "connected" && connection.healthOk;
            return <section key={provider} className="flex h-full min-h-[280px] min-w-0 flex-col border border-border bg-card p-4"><div className="flex items-start justify-between gap-3"><ProviderMark provider={provider} name={schema?.name || provider} /><div className="flex items-center gap-1"><ProviderSetupLink provider={provider} name={schema?.name || provider} />{connection ? <StatusBadge status={healthy ? "connected" : connection.status} /> : <span className="text-[10px] text-muted-foreground">Not connected</span>}</div></div><div className="mt-4 flex min-h-0 flex-1 flex-col"><h3 className="text-[14px] font-semibold">{schema?.name || provider}</h3><p className="mt-1 min-h-9 text-[11px] leading-4 text-muted-foreground">{schema?.description}</p><p className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-primary/70" />{providerCardNotes[provider]}</p><div className="mt-2 space-y-1 text-[10px] leading-4 text-muted-foreground"><p><span className="font-medium text-foreground">Best for:</span> {providerCardDetails[provider].bestFor}</p><p><span className="font-medium text-foreground">Setup:</span> {providerCardDetails[provider].setup}</p></div>{connection ? <div className="mt-auto flex flex-col pt-4">{connection.lastError ? <p className="line-clamp-2 text-[10px] leading-4 text-amber-700 dark:text-amber-300">{formatEmailError(connection.lastError, "This provider needs attention. Check the connection and try again.")}</p> : null}<p className="mt-3 truncate text-[10px] text-muted-foreground">{connection.credentialHint}</p><div className="mt-2 flex items-center justify-between gap-2"><span className="text-[10px] text-muted-foreground">Connected provider</span><Button type="button" size="sm" variant="ghost" className="h-7 shrink-0 px-2 text-[10px] text-destructive" disabled={providerBusy} onClick={() => onDisconnect(provider)}><Trash2 className="h-3.5 w-3.5" /> Disconnect</Button></div><div className="mt-2 flex justify-end"><Button type="button" size="sm" variant="outline" className="h-8 text-[10px]" disabled={providerBusy} onClick={() => onHealth(provider)}><RefreshCw className="h-3.5 w-3.5" /> Check health</Button></div></div> : <div className="mt-auto pt-4"><Button type="button" className="w-full" size="sm" variant="outline" disabled={providerBusy} onClick={() => onConnect(provider)}><Plus className="h-3.5 w-3.5" /> Connect</Button></div>}</div></section>;
        })}
      </CardGrid>
    </div>
  );
}

function SingleIdentityPanel({ activeProvider, identity, onCreate, onDelete, onEdit, working }: { activeProvider?: { provider: EmailProviderId; mode: "managed" | "custom" }; identity?: EmailIdentity; onCreate: () => void; onDelete: (identity: EmailIdentity) => void; onEdit: (identity: EmailIdentity) => void; working: boolean }) {
  const activeLabel = activeProvider?.mode === "managed" ? "Resend Managed" : activeProvider ? providerSetupNames[activeProvider.provider] : "No active provider";
  const identityReady = Boolean(activeProvider && identity?.senderReady);
  return <div><div className="flex items-end justify-between gap-4 border-b border-border pb-4"><div><h2 className="text-[17px] font-semibold">Sender identity</h2><p className="mt-1 text-[12px] text-muted-foreground">Identity fields adapt to the active provider: {activeLabel}.</p></div>{identity ? <Button type="button" size="sm" variant="outline" disabled={!activeProvider || working} onClick={() => onEdit(identity)}><Pencil className="h-4 w-4" /> Edit identity</Button> : <Button type="button" size="sm" onClick={onCreate} disabled={!activeProvider}><Plus className="h-4 w-4" /> Set identity</Button>}</div>{identity ? <section className="mt-5 max-w-2xl border border-border bg-card p-5"><div className="flex items-start justify-between gap-4"><div className="min-w-0"><div className="flex items-center gap-2"><h3 className="truncate text-[14px] font-semibold">{identity.senderName}</h3><Badge variant="outline" className="rounded-md border-primary/25 bg-primary/10 px-1.5 py-0.5 text-[9px] text-primary">{activeLabel}</Badge></div><p className="mt-1 truncate text-[11px] text-muted-foreground">From: {activeProvider ? identity.senderEmail || "Sender is not configured yet" : "Choose an active provider"}</p><p className="mt-1 truncate text-[10px] text-muted-foreground">Reply-to: {identity.replyTo || "Not configured"}</p></div><StatusBadge status={identityReady ? "verified" : "pending"} /></div>{!identityReady ? <div className="mt-4 flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/6 px-3 py-2 text-[11px] leading-5 text-amber-800 dark:text-amber-200"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{activeProvider ? formatEmailError(identity.senderError, "Finish sender setup before sending.") : "Choose and activate a delivery provider. Identity fields will update for that provider."}</span></div> : null}<div className="mt-4 flex flex-wrap justify-end gap-2"><Button type="button" size="sm" variant="outline" disabled={working || !activeProvider} onClick={() => onEdit(identity)}><Pencil className="h-3.5 w-3.5" /> Edit</Button><Button type="button" size="sm" variant="ghost" className="text-destructive" disabled={working} onClick={() => onDelete(identity)}><Trash2 className="h-3.5 w-3.5" /> Delete</Button></div></section> : <div className="mt-5"><EmptyState icon={ShieldCheck} title="No sender identity" description={activeProvider ? "Set a sender name and Reply-to address for the active provider." : "Choose and activate a delivery provider first."} /></div>}</div>;
}




/**
 * Template editor.
 *
 * Templates and campaigns are the same artefact — a block design that has to
 * survive an inbox — so they share one editor rather than drifting apart. The
 * campaign block model is a superset of the old email one, which makes the
 * upgrade a straight widening: every legacy block has a campaign equivalent.
 */
const legacyBlockToCampaign = (block: EmailBuilderBlock): CampaignBlock => {
  const base = createCampaignBlock(block.type as CampaignBlockType);
  return {
    ...base,
    ...(block.content === undefined ? {} : { content: block.content }),
    ...(block.href === undefined ? {} : { href: block.href }),
    ...(block.src === undefined ? {} : { src: block.src }),
    ...(block.alt === undefined ? {} : { alt: block.alt }),
    ...(block.align === undefined ? {} : { align: block.align }),
    ...(block.size === undefined ? {} : { size: block.size }),
    ...(block.height === undefined ? {} : { height: block.height }),
  };
};

/**
 * Loads a template into the campaign design model. A template saved by the
 * previous editor has no `campaign_design` envelope, so its `email_design` one
 * is widened here instead of being dropped on the floor.
 */
const campaignDesignForTemplate = (template: EmailTemplate | null): CampaignDesign => {
  const { design } = campaignDesignFromBlocks(template?.blocks || []);
  if (design.blocks.length) return design;

  const legacy = builderDesignForTemplate(template);
  if (!legacy.blocks.length) return { ...emptyCampaignDesign(), accent: legacy.accent };
  return {
    accent: legacy.accent,
    pageBackground: legacy.pageBackground,
    cardBackground: legacy.cardBackground,
    footerText: legacy.footerText,
    blocks: legacy.blocks.map(legacyBlockToCampaign),
  };
};

/**
 * Parked builder drafts.
 *
 * Editing lives in memory until Save, so a refresh used to lose everything a
 * user had typed. The draft is mirrored to storage while it is dirty and read
 * back on open; saving or discarding removes it.
 */
const templateDraftKey = (id: string) => `maxform.email.template-draft.${id}`;

type ParkedTemplateDraft = {
  name: string;
  module: string;
  subject: string;
  previewText: string;
  design: CampaignDesign;
};

const readTemplateDraft = (id: string): ParkedTemplateDraft | null => {
  try {
    const raw = window.localStorage.getItem(templateDraftKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ParkedTemplateDraft;
    // A draft with no blocks is indistinguishable from a fresh start and would
    // only strand the user on an empty canvas.
    if (!parsed?.design?.blocks?.length) return null;
    return parsed;
  } catch {
    return null;
  }
};

const writeTemplateDraft = (id: string, draft: ParkedTemplateDraft) => {
  try {
    window.localStorage.setItem(templateDraftKey(id), JSON.stringify(draft));
  } catch {
    // Storage can be full or blocked; the session keeps working regardless.
  }
};

const clearTemplateDraft = (id: string) => {
  try {
    window.localStorage.removeItem(templateDraftKey(id));
  } catch {
    // Nothing to recover from — the draft simply stays until storage allows.
  }
};

function TemplateBuilderScreen({
  onOpenChange,
  onSave,
  onSendTest,
  open,
  template,
  working,
}: {
  identities?: EmailIdentity[];
  onOpenChange: (open: boolean) => void;
  onSave: (input: Partial<EmailTemplate>) => void;
  onSendTest: (template: EmailTemplate) => void;
  open: boolean;
  template: EmailTemplate | null;
  working: boolean;
}) {
  const [name, setName] = useState("");
  const [module, setModule] = useState("workflows");
  const [subject, setSubject] = useState("");
  const [previewText, setPreviewText] = useState("");
  const history = useDesignHistory<CampaignDesign>(emptyCampaignDesign());
  const design = history.value;
  const [device, setDevice] = useState<CampaignPreviewDevice>("desktop");
  const [leaving, setLeaving] = useState(false);

  // The overlay covers the dashboard; without this the page behind scrolls.
  useScrollLock(open);
  // The builder is a heavy mount. Opening straight into a half-painted canvas
  // reads as a glitch, so the overlay holds a loading state until it is ready.
  const [ready, setReady] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmingExit, setConfirmingExit] = useState(false);

  useEffect(() => {
    if (!open) return;
    setReady(false);
    setDirty(false);
    setConfirmingExit(false);
    setLeaving(false);
    // A draft parked by a refresh wins over the stored template, so reloading
    // mid-edit returns to the work rather than to the last save.
    const parked = readTemplateDraft(template?.id || "new");
    setName(parked?.name ?? template?.name ?? "");
    setModule(parked?.module ?? template?.module ?? "workflows");
    setSubject(parked?.subject ?? template?.subject ?? "");
    setPreviewText(parked?.previewText ?? "");
    history.reset(parked?.design ?? campaignDesignForTemplate(template));
    if (parked) setDirty(true);
    setDevice("desktop");
    const timer = setTimeout(() => setReady(true), 420);
    return () => clearTimeout(timer);
    // `history` is stable enough for this: reset is a useCallback with no deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, template]);

  // Park the in-progress draft so a refresh, a crash, or a closed tab does not
  // lose the work. Cleared once it is saved or explicitly discarded.
  useEffect(() => {
    if (!open || !ready || !dirty) return;
    const timer = setTimeout(
      () => writeTemplateDraft(template?.id || "new", { name, module, subject, previewText, design }),
      400,
    );
    return () => clearTimeout(timer);
  }, [design, dirty, module, name, open, previewText, ready, subject, template?.id]);

  if (!open) return null;

  const resolvedName = name.trim() || "Untitled template";
  /** Wraps a setter so any edit flags unsaved work for the exit guard. */
  const edit = <T,>(setter: (value: T) => void) => (value: T) => {
    setDirty(true);
    setter(value);
  };
  /** Closes behind a brief loader, so leaving reads as a transition. */
  const leave = () => {
    setLeaving(true);
    setTimeout(() => {
      setLeaving(false);
      onOpenChange(false);
    }, 340);
  };
  const discardAndLeave = () => {
    clearTemplateDraft(template?.id || "new");
    setDirty(false);
    leave();
  };
  const requestClose = () => {
    if (dirty) {
      setConfirmingExit(true);
      return;
    }
    leave();
  };
  const save = () => {
    clearTemplateDraft(template?.id || "new");
    setDirty(false);
    return onSave({
      id: template?.id,
      key: template?.key || templateSlug(resolvedName),
      module,
      name: resolvedName,
      subject: subject.trim() || resolvedName,
      htmlBody: composeCampaignHtml(design),
      textBody: campaignPlainText(design),
      blocks: campaignBlocksPayload(design),
    });
  };

  return (
    // Same shell as the campaign builder: a dimmed surround with the builder as
    // a focused card inside it, rather than raw edge-to-edge chrome.
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-2 backdrop-blur-xs transition-opacity duration-200 sm:p-4 lg:p-6",
        leaving ? "opacity-0" : "opacity-100",
      )}
    >
    <div
      role="region"
      aria-label="Email template builder"
      className={cn(
        "flex h-full max-h-[min(940px,100%)] w-full max-w-[1500px] flex-col overflow-hidden rounded-xl border border-border bg-background text-foreground shadow-2xl transition-all duration-200",
        leaving ? "scale-[.985] opacity-0" : "scale-100 opacity-100",
      )}
    >
      {!ready ? (
        <div
          role="status"
          aria-label="Opening the email template builder"
          className="flex flex-1 flex-col items-center justify-center gap-3"
        >
          <span className="relative flex h-10 w-10 items-center justify-center">
            <span className="absolute inset-0 animate-ping rounded-full bg-primary/20" />
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </span>
          <p className="text-[12px] font-medium text-muted-foreground">
            Opening {template ? variablePlainText(template.name) : "the builder"}…
          </p>
        </div>
      ) : (
        <>
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-2.5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0"
          aria-label="Back to templates"
          onClick={requestClose}
        >
          <ArrowLeft className="h-4.5 w-4.5" />
        </Button>
        <div className="min-w-0 flex-1">
          <Input
            aria-label="Template name"
            value={name}
            onChange={(event) => edit(setName)(event.target.value)}
            placeholder="Welcome new customers"
            className="h-8 border-0 px-0 text-[15px] font-semibold shadow-none focus-visible:ring-0"
          />
          <p className="text-[11px] text-muted-foreground">
            {template ? "Editing template" : "New template"} · same builder as campaigns
            {dirty ? <span className="ml-1.5 text-amber-600 dark:text-amber-400">· Unsaved changes</span> : null}
          </p>
        </div>
        <Select value={module} onValueChange={edit(setModule)}>
          <SelectTrigger className="h-9 w-[190px] text-[12px]" aria-label="Use for">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(moduleLabel).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="button" variant="outline" size="sm" onClick={requestClose}>
          Cancel
        </Button>
        {template ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              onSendTest({ ...template, name: resolvedName, module, subject: subject || template.subject } as EmailTemplate)
            }
          >
            <Send className="h-4 w-4" /> Send test
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          disabled={working || !name.trim() || !design.blocks.length}
          onClick={save}
        >
          {working && <Loader2 className="h-4 w-4 animate-spin" />} Save template
        </Button>
      </header>

      <CampaignBuilder
          design={design}
          onDesignChange={edit(history.set)}
          canUndo={history.canUndo}
          canRedo={history.canRedo}
          onUndo={history.undo}
          onRedo={history.redo}
          subject={subject}
          onSubjectChange={edit(setSubject)}
          previewText={previewText}
          onPreviewTextChange={edit(setPreviewText)}
          onSendTest={
            template
              ? () => onSendTest({ ...template, name: resolvedName, module, subject: subject || template.subject } as EmailTemplate)
              : undefined
          }
          mailingAddress=""
          products={[]}
          immersive
          device={device}
          onDeviceChange={setDevice}
      />
        </>
      )}

      <Dialog open={confirmingExit} onOpenChange={(value) => { if (!value) setConfirmingExit(false); }}>
        <DialogContent className="max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Leave without saving?</DialogTitle>
            <DialogDescription>
              You have unsaved changes to {resolvedName}. Closing now discards them.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={() => setConfirmingExit(false)}>
              Keep editing
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => { setConfirmingExit(false); discardAndLeave(); }}
            >
              Discard changes
            </Button>
            <Button
              type="button"
              disabled={working || !name.trim() || !design.blocks.length}
              onClick={() => { setConfirmingExit(false); save(); }}
            >
              {working && <Loader2 className="h-4 w-4 animate-spin" />} Save and close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </div>
  );
}

export const TemplateDialog = TemplateBuilderScreen;

const TEMPLATES_PER_PAGE = 12;

function TemplateGallery({ onCreate, onEdit, templates }: { onCreate: () => void; onEdit: (template: EmailTemplate) => void; templates: EmailTemplate[] }) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const modules = Array.from(new Set(templates.map((template) => template.module))).sort();
  const query = search.trim().toLowerCase();
  const visible = templates.filter((template) => {
    if (filter !== "all" && template.module !== filter) return false;
    if (!query) return true;
    // Searched against the readable form, so typing "event name" finds a
    // template whose subject stores {{event.name}}.
    return [
      template.name,
      variablePlainText(template.subject),
      template.subject,
      moduleLabel[template.module] || template.module,
    ]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
  const pageCount = Math.max(1, Math.ceil(visible.length / TEMPLATES_PER_PAGE));
  // A filter change can leave the reader on a page that no longer exists.
  const currentPage = Math.min(page, pageCount);
  const start = (currentPage - 1) * TEMPLATES_PER_PAGE;
  const pageItems = visible.slice(start, start + TEMPLATES_PER_PAGE);
  const changeFilter = (value: string) => { setFilter(value); setPage(1); };
  const changeSearch = (value: string) => { setSearch(value); setPage(1); };

  return (
    <div>
      <div className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-primary">
            <LayoutTemplate className="h-4 w-4" />
            <span className="text-[11px] font-semibold uppercase tracking-[.12em]">Email studio</span>
          </div>
          <h2 className="mt-2 text-[20px] font-semibold">Polished templates, ready to use</h2>
          <p className="mt-1 text-[12px] text-muted-foreground">Fixed system messages and flexible templates for forms, events, payment, and automation-designed to feel at home beside the best product emails.</p>
        </div>
        <Button type="button" onClick={onCreate}><Plus className="h-4 w-4" /> Create template</Button>
      </div>

      <div className="relative mt-5">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={search}
          onChange={(event) => changeSearch(event.target.value)}
          placeholder="Search templates by name, subject, or activity"
          aria-label="Search templates"
          className="h-9 pl-9 text-[12px]"
        />
      </div>

      <div className="dashboard-scroll mt-3 flex gap-2 overflow-x-auto pb-1">
        <Button type="button" size="sm" variant={filter === "all" ? "default" : "outline"} onClick={() => changeFilter("all")}>All templates</Button>
        {modules.map((module) => (
          <Button key={module} type="button" size="sm" variant={filter === module ? "default" : "outline"} onClick={() => changeFilter(module)}>{moduleLabel[module] || module}</Button>
        ))}
      </div>

      {visible.length ? (
        <>
          <CardGrid className="mt-5">
            {pageItems.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => onEdit(template)}
                className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card text-left transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg"
              >
                <div className="relative overflow-hidden border-b border-border">
                  <img
                    src={templateArtwork(template)}
                    alt={`${variablePlainText(template.name)} email preview`}
                    loading="lazy"
                    className="aspect-[1.62/1] w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                  />
                  <span className="absolute left-3 top-3 rounded-md bg-white/92 px-2 py-1 text-[9px] font-semibold text-slate-700 shadow-xs backdrop-blur-xs">
                    {moduleLabel[template.module] || template.module}
                  </span>
                </div>
                <div className="flex min-h-0 flex-1 flex-col p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">{template.name}</p>
                    <Badge variant="outline" className={`shrink-0 text-[9px] ${template.isCustom ? "border-primary/25 bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>{template.isCustom ? "Custom" : "Ready"}</Badge>
                  </div>
                  <VariableText
                    value={template.subject}
                    className="mt-1 line-clamp-2 block text-[11px] leading-4 text-muted-foreground"
                  />
                  <div className="mt-auto flex items-center justify-between pt-3 text-[10px] text-muted-foreground">
                    <span>{template.module === "workflows" ? "Automation-ready" : "System template"}</span>
                    <span className="font-medium text-primary">Edit design →</span>
                  </div>
                </div>
              </button>
            ))}
          </CardGrid>

          {pageCount > 1 && (
            <nav className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4" aria-label="Template pages">
              <p className="text-[11px] text-muted-foreground">
                Showing {start + 1}–{start + pageItems.length} of {visible.length} templates
              </p>
              <div className="flex items-center gap-1.5">
                <Button type="button" size="sm" variant="outline" className="h-8" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>
                  <ChevronLeft className="h-3.5 w-3.5" /> Previous
                </Button>
                {Array.from({ length: pageCount }, (_unused, index) => index + 1).map((number) => (
                  <Button
                    key={number}
                    type="button"
                    size="sm"
                    variant={number === currentPage ? "default" : "outline"}
                    aria-current={number === currentPage ? "page" : undefined}
                    className="h-8 w-8 p-0 text-[11px]"
                    onClick={() => setPage(number)}
                  >
                    {number}
                  </Button>
                ))}
                <Button type="button" size="sm" variant="outline" className="h-8" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}>
                  Next <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </nav>
          )}
        </>
      ) : (
        <div className="mt-5">
          <EmptyState
            icon={FileText}
            title={query ? `No templates match "${search.trim()}"` : "No templates in this group"}
            description={query ? "Try a different word, or clear the search to see everything." : "Choose another activity or create a new visual email template."}
          />
        </div>
      )}
    </div>
  );
}

function TemplatesPanel({ identities, onCreate, onEdit, templates }: { identities: EmailIdentity[]; onCreate: () => void; onEdit: (template: EmailTemplate) => void; templates: EmailTemplate[] }) {
  void identities;
  return <TemplateGallery templates={templates.filter(isWorkspaceEmailTemplate)} onCreate={onCreate} onEdit={onEdit} />;
}

function LegacyLogsPanel({ logs, onRetry, onStatusChange, onSearchChange, search, status, working }: { logs: EmailLog[]; onRetry: (log: EmailLog) => void; onStatusChange: (value: string) => void; onSearchChange: (value: string) => void; search: string; status: string; working: boolean }) {
  return <div><div className="flex flex-col gap-3 border-b border-border pb-4 lg:flex-row lg:items-end lg:justify-between"><div><h2 className="text-[17px] font-semibold">Delivery logs</h2><p className="mt-1 text-[12px] text-muted-foreground">Every workspace email, including retries and provider used. Sensitive provider responses are never shown here.</p></div><div className="flex gap-2"><Input className="h-9 w-[210px] text-[12px]" value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Search recipient or subject" /><Select value={status || "all"} onValueChange={(value) => onStatusChange(value === "all" ? "" : value)}><SelectTrigger className="h-9 w-[130px] text-[12px]"><SelectValue placeholder="All statuses" /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem>{["queued", "sent", "delivered", "opened", "bounced", "complained", "failed"].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div></div>{logs.length ? <div className="dashboard-scroll mt-1 overflow-x-auto"><table className="w-full min-w-[780px] text-left"><thead className="border-b border-border text-[10px] uppercase tracking-[0.08em] text-muted-foreground"><tr><th className="py-3 font-medium">Recipient</th><th className="py-3 font-medium">Template</th><th className="py-3 font-medium">Provider</th><th className="py-3 font-medium">Status</th><th className="py-3 font-medium">Time</th><th className="py-3" /></tr></thead><tbody className="divide-y divide-border">{logs.map((log) => <tr key={log.id} className="text-[12px]"><td className="max-w-[220px] py-3 pr-4"><p className="truncate font-medium">{log.recipient}</p><p className="mt-0.5 truncate text-[10px] text-muted-foreground">{log.subject}</p></td><td className="py-3 pr-4 text-muted-foreground">{log.templateKey || "Custom"}</td><td className="py-3 pr-4 capitalize text-muted-foreground">{log.provider || "Pending"}</td><td className="py-3 pr-4"><StatusBadge status={log.status} />{log.error && <p className="mt-1 max-w-[180px] text-[10px] text-rose-600 dark:text-rose-300">{formatEmailError(log.error, "This delivery needs attention.")}</p>}</td><td className="whitespace-nowrap py-3 pr-4 text-[11px] text-muted-foreground">{formatDate(log.createdAt)}</td><td className="py-3 text-right">{log.status === "failed" && <Button type="button" size="sm" variant="outline" className="h-7 text-[10px]" disabled={working} onClick={() => onRetry(log)}><RotateCcw className="h-3 w-3" /> Retry</Button>}</td></tr>)}</tbody></table></div> : <div className="mt-5"><EmptyState icon={Clock3} title="No matching email logs" description="Use the filters to find a delivery, or send a test email to create the first log." /></div>}</div>;
}

function LogsPanel({
  logs,
  onClearAll,
  onDeleteSingle,
  onDeleteSelected,
  onRetry,
  onStatusChange,
  onSearchChange,
  search,
  status,
  working,
}: {
  logs: EmailLog[];
  onClearAll: () => void;
  onDeleteSingle: (log: EmailLog) => void;
  onDeleteSelected: (ids: string[]) => void;
  onRetry: (log: EmailLog) => void;
  onStatusChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  search: string;
  status: string;
  working: boolean;
}) {
  const selection = useTableSelection(logs.map((log) => log.id));
  const selectedLogs = logs.filter((log) =>
    selection.selectedVisibleIds.includes(log.id),
  );

  return (
    <div>
      <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-[17px] font-semibold">Delivery logs</h2>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Every workspace email, including retries and provider used. A retry
            uses the current sender identity. Sensitive provider responses are
            never shown here.
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" className="shrink-0 text-destructive hover:text-destructive" disabled={working || !logs.length} onClick={onClearAll}>
          <Trash2 className="h-3.5 w-3.5" />
          Clear all logs
        </Button>
      </div>
      <TableFilterBar className="mt-4">
        <TableSearchField
          value={search}
          onValueChange={onSearchChange}
          placeholder="Search recipient or subject"
          aria-label="Search email delivery logs"
        />
        <TableFilterSelect
          value={status || "all"}
          onValueChange={(value) =>
            onStatusChange(value === "all" ? "" : value)
          }
          label="Filter email logs by status"
          options={[
            { value: "all", label: "All statuses" },
            { value: "queued", label: "Queued" },
            { value: "sent", label: "Sent" },
            { value: "delivered", label: "Delivered" },
            { value: "opened", label: "Opened" },
            { value: "bounced", label: "Bounced" },
            { value: "complained", label: "Complained" },
            { value: "skipped", label: "Skipped" },
            { value: "failed", label: "Failed" },
          ]}
        />
      </TableFilterBar>
      <TableSelectionBar
        className="mt-3"
        totalCount={logs.length}
        selectedCount={selection.selectedVisibleIds.length}
        allSelected={selection.allSelected}
        partiallySelected={selection.partiallySelected}
        onToggleAll={selection.toggleAll}
        onClear={selection.clearSelection}
        itemLabel="email logs"
      >
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="text-destructive hover:text-destructive"
          disabled={working}
          onClick={() => onDeleteSelected(selectedLogs.map((log) => log.id))}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete selected
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            downloadCsvFile(
              "maxform-email-logs-selected.csv",
              [
                "Recipient",
                "Subject",
                "Template",
                "Provider",
                "Status",
                "Related ticket instances",
                "Created",
              ],
              selectedLogs.map((log) => [
                log.recipient,
                log.subject,
                log.templateKey,
                log.provider,
                log.status,
                log.relatedTicketIds.join(" | "),
                log.createdAt,
              ]),
            )
          }
        >
          <Download className="h-3.5 w-3.5" />
          Export selected
        </Button>
      </TableSelectionBar>
      {logs.length ? (
        <div className="dashboard-scroll mt-1 overflow-x-auto">
          <table className="w-full min-w-[820px] text-left">
            <thead className="border-b border-border text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
              <tr>
                <th className="w-11 py-3 font-medium" />
                <th className="py-3 font-medium">Recipient</th>
                <th className="py-3 font-medium">Template</th>
                <th className="py-3 font-medium">Provider</th>
                <th className="py-3 font-medium">Ticket instances</th>
                <th className="py-3 font-medium">Status</th>
                <th className="py-3 font-medium">Time</th>
                <th className="py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {logs.map((log) => (
                <tr key={log.id} className="text-[12px] hover:bg-muted/25">
                  <td className="py-2 pr-2">
                    <TableRowSelect
                      checked={selection.isSelected(log.id)}
                      onCheckedChange={(checked) =>
                        selection.toggle(log.id, checked)
                      }
                      label={`Select email to ${log.recipient}`}
                    />
                  </td>
                  <td className="max-w-[220px] py-3 pr-4">
                    <p className="truncate font-medium">{log.recipient}</p>
                    <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                      {log.subject}
                    </p>
                  </td>
                  <td className="py-3 pr-4 text-muted-foreground">
                    {log.templateKey || "Custom"}
                  </td>
                  <td className="py-3 pr-4 capitalize text-muted-foreground">
                    {log.provider || "Pending"}
                  </td>
                  <td className="py-3 pr-4 font-mono text-[10px] text-muted-foreground" title={log.relatedTicketIds.join(", ") || "No ticket instances linked"}>
                    {ticketAuditLabel(log.relatedTicketIds)}
                  </td>
                  <td className="py-3 pr-4">
                    <StatusBadge status={log.status} />
                    {log.error ? (
                      <p className="mt-1 max-w-[180px] text-[10px] text-rose-600 dark:text-rose-300">
                        {formatEmailError(log.error, "This delivery needs attention.")}
                      </p>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap py-3 pr-4 text-[11px] text-muted-foreground">
                    {formatDate(log.createdAt)}
                  </td>
                  <td className="py-3 text-right">
                    <div className="flex justify-end gap-2">
                      {log.status === "failed" ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 text-[10px]"
                          disabled={working}
                          onClick={() => onRetry(log)}
                        >
                          <RotateCcw className="h-3 w-3" />
                          Retry
                        </Button>
                      ) : null}
                      <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" disabled={working} onClick={() => onDeleteSingle(log)} aria-label={`Delete email log for ${log.recipient}`}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-5">
          <EmptyState
            icon={Clock3}
            title="No matching email logs"
            description="Use the filters to find a delivery, or send a test email to create the first log."
          />
        </div>
      )}
    </div>
  );
}

function SentPanel({ logs }: { logs: EmailLog[] }) {
  return <div><div className="border-b border-border pb-4"><h2 className="text-[17px] font-semibold">Sent mail</h2><p className="mt-1 text-[12px] text-muted-foreground">Every message sent by forms, events, payments, templates, and automations.</p></div>{logs.length ? <div className="dashboard-scroll mt-1 overflow-x-auto"><table className="w-full min-w-[720px] text-left"><thead className="border-b border-border text-[10px] uppercase tracking-[0.08em] text-muted-foreground"><tr><th className="py-3 font-medium">To</th><th className="py-3 font-medium">Subject</th><th className="py-3 font-medium">Module</th><th className="py-3 font-medium">Status</th><th className="py-3 font-medium">Sent</th></tr></thead><tbody className="divide-y divide-border">{logs.map((log) => <tr key={log.id} className="text-[12px]"><td className="max-w-[220px] truncate py-3 pr-4 font-medium">{log.recipient}</td><td className="max-w-[260px] truncate py-3 pr-4 text-muted-foreground">{log.subject || log.templateKey}</td><td className="py-3 pr-4 capitalize text-muted-foreground">{log.module}</td><td className="py-3 pr-4"><StatusBadge status={log.status} /></td><td className="whitespace-nowrap py-3 text-[11px] text-muted-foreground">{formatDate(log.sentAt || log.createdAt)}</td></tr>)}</tbody></table></div> : <div className="mt-5"><EmptyState icon={Send} title="No sent mail yet" description="System and workflow emails will be listed here after the provider accepts them." /></div>}</div>;
}

const emailTrendConfig = {
  total: { label: "Created", color: "#94A3B8" },
  accepted: { label: "Accepted", color: "#635BFF" },
  failed: { label: "Failed", color: "#E11D48" },
} satisfies ChartConfig;

const emailModuleConfig = {
  total: { label: "Created", color: "#635BFF" },
  accepted: { label: "Accepted", color: "#0F766E" },
} satisfies ChartConfig;

function EmailAnalyticsPanel({ analytics, days, loading, onDaysChange }: { analytics?: EmailAnalytics; days: number; loading: boolean; onDaysChange: (days: number) => void }) {
  if (!analytics && loading) return <div className="space-y-5"><Skeleton className="h-14 w-full" /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /></div><Skeleton className="h-[320px]" /></div>;
  if (!analytics) return <EmptyState icon={BarChart3} title="Email analytics are unavailable" description="Refresh the page to load the latest delivery, engagement, and provider activity." />;
  const risk = analytics.totals.bounced + analytics.totals.complained;
  const metrics = [
    { label: "Emails created", value: analytics.totals.total, detail: `Last ${analytics.rangeDays} days`, icon: Mail, tone: "text-primary" },
    { label: "Provider accepted", value: analytics.totals.accepted, detail: `${analyticsPercent(analytics.rates.acceptance)} acceptance rate`, icon: CheckCircle2, tone: "text-emerald-600" },
    { label: "Opened", value: analytics.totals.opened, detail: `${analyticsPercent(analytics.rates.open)} of accepted`, icon: TrendingUp, tone: "text-sky-600" },
    { label: "Clicked", value: analytics.totals.clicked, detail: `${analyticsPercent(analytics.rates.click)} of accepted`, icon: MousePointerClick, tone: "text-violet-600" },
    { label: "Reputation risk", value: risk, detail: `${analyticsPercent(analytics.rates.risk)} bounce or complaint rate`, icon: AlertCircle, tone: risk ? "text-rose-600" : "text-emerald-600" },
  ];
  return <div className="space-y-6"><section className="flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:items-end lg:justify-between"><div><div className="flex items-center gap-2 text-primary"><BarChart3 className="h-4 w-4" /><span className="text-[11px] font-semibold uppercase tracking-[.12em]">Delivery intelligence</span></div><h2 className="mt-2 text-[22px] font-semibold">Email analytics</h2><p className="mt-1 max-w-2xl text-[12px] leading-5 text-muted-foreground">Trace delivery volume, provider acceptance, engagement events, failures, and the templates driving your workspace mail.</p></div><div className="flex flex-wrap gap-2"><Select value={String(days)} onValueChange={(value) => onDaysChange(Number(value))}><SelectTrigger className="h-9 w-[138px] text-[11px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="7">Last 7 days</SelectItem><SelectItem value="30">Last 30 days</SelectItem><SelectItem value="90">Last 90 days</SelectItem><SelectItem value="365">Last 12 months</SelectItem></SelectContent></Select><Button type="button" size="sm" variant="outline" disabled={!analytics.totals.total} onClick={() => exportEmailAnalytics(analytics)}><Download className="h-3.5 w-3.5" /> Export CSV</Button></div></section><section className="rounded-lg border border-primary/20 bg-primary/[0.035] px-4 py-3"><p className="text-[11px] leading-5 text-muted-foreground"><strong className="text-foreground">How these metrics work:</strong> Provider accepted means the provider accepted the message for delivery. Opens and clicks appear when your provider sends those event updates; messages and recipient details are never included in this view or export.</p></section><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">{metrics.map((metric) => { const Icon = metric.icon; return <section key={metric.label} className="border border-border bg-card p-4"><div className="flex items-start justify-between gap-3"><p className="text-[11px] font-medium text-muted-foreground">{metric.label}</p><Icon className={`h-4 w-4 ${metric.tone}`} /></div><p className="mt-5 text-[25px] font-semibold tracking-tight tabular-nums">{metric.value.toLocaleString()}</p><p className="mt-1 text-[10px] text-muted-foreground">{metric.detail}</p></section>; })}</div>{analytics.totals.total ? <><div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(330px,.65fr)]"><section className="border border-border bg-card p-5"><div><h3 className="text-[14px] font-semibold">Daily email activity</h3><p className="mt-1 text-[11px] text-muted-foreground">Created, provider-accepted, and failed messages over the selected period.</p></div><ChartContainer config={emailTrendConfig} className="mt-5 h-[290px] w-full"><AreaChart data={analytics.trend} margin={{ left: -22, right: 8, top: 8, bottom: 0 }}><defs><linearGradient id="email-accepted-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="5%" stopColor="var(--color-accepted)" stopOpacity={0.25} /><stop offset="95%" stopColor="var(--color-accepted)" stopOpacity={0} /></linearGradient></defs><CartesianGrid vertical={false} strokeDasharray="3 3" /><XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={28} tickFormatter={analyticsDate} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} tickMargin={8} /><ChartTooltip content={<ChartTooltipContent indicator="line" labelFormatter={(value) => analyticsDate(String(value))} />} /><Area dataKey="total" type="monotone" stroke="var(--color-total)" strokeWidth={2} fill="none" /><Area dataKey="accepted" type="monotone" stroke="var(--color-accepted)" strokeWidth={2.5} fill="url(#email-accepted-fill)" /><Area dataKey="failed" type="monotone" stroke="var(--color-failed)" strokeWidth={2} fill="none" /></AreaChart></ChartContainer></section><section className="border border-border bg-card p-5"><h3 className="text-[14px] font-semibold">Delivery health</h3><p className="mt-1 text-[11px] text-muted-foreground">Operational signals for the same date range.</p><div className="mt-5 space-y-4">{[{ label: "Provider accepted", value: analytics.rates.acceptance, detail: `${analytics.totals.accepted.toLocaleString()} of ${analytics.totals.total.toLocaleString()} messages` }, { label: "Failed", value: analytics.rates.failure, detail: `${analytics.totals.failed.toLocaleString()} messages need attention` }, { label: "Bounced or complained", value: analytics.rates.risk, detail: `${risk.toLocaleString()} reputation events` }, { label: "Still queued", value: analytics.totals.total ? (analytics.totals.queued / analytics.totals.total) * 100 : 0, detail: `${analytics.totals.queued.toLocaleString()} messages awaiting a send attempt` }].map((item) => <div key={item.label}><div className="flex items-center justify-between gap-4 text-[11px]"><span className="font-medium">{item.label}</span><span className="font-mono text-muted-foreground">{analyticsPercent(item.value)}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(item.value, 100)}%` }} /></div><p className="mt-1.5 text-[10px] text-muted-foreground">{item.detail}</p></div>)}</div></section></div><div className="grid gap-5 xl:grid-cols-2"><section className="border border-border bg-card p-5"><h3 className="text-[14px] font-semibold">Email volume by activity</h3><p className="mt-1 text-[11px] text-muted-foreground">Which areas of the workspace are creating email activity.</p><ChartContainer config={emailModuleConfig} className="mt-5 h-[290px] w-full"><BarChart data={analytics.modules.map((module) => ({ ...module, label: moduleLabel[module.module] || analyticsLabel(module.module) }))} layout="vertical" margin={{ left: 12, right: 12, top: 4, bottom: 4 }}><CartesianGrid horizontal={false} strokeDasharray="3 3" /><XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} /><YAxis dataKey="label" type="category" width={106} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} /><ChartTooltip content={<ChartTooltipContent indicator="line" />} /><Bar dataKey="total" fill="var(--color-total)" radius={[4, 4, 4, 4]} /><Bar dataKey="accepted" fill="var(--color-accepted)" radius={[4, 4, 4, 4]} /></BarChart></ChartContainer></section><section className="border border-border bg-card p-5"><h3 className="text-[14px] font-semibold">Provider performance</h3><p className="mt-1 text-[11px] text-muted-foreground">Compare reliable sending outcomes without exposing credentials or recipient data.</p>{analytics.providers.length ? <div className="dashboard-scroll mt-4 overflow-x-auto"><table className="w-full min-w-[470px] text-left"><thead className="border-b border-border text-[10px] uppercase tracking-[.08em] text-muted-foreground"><tr><th className="pb-3 font-medium">Provider</th><th className="pb-3 text-right font-medium">Created</th><th className="pb-3 text-right font-medium">Accepted</th><th className="pb-3 text-right font-medium">Engagement</th><th className="pb-3 text-right font-medium">Failed</th></tr></thead><tbody className="divide-y divide-border">{analytics.providers.map((provider) => <tr key={provider.provider} className="text-[11px]"><td className="py-3 font-medium capitalize">{provider.provider}</td><td className="py-3 text-right font-mono text-muted-foreground">{provider.total.toLocaleString()}</td><td className="py-3 text-right"><span className="font-mono">{percentage(provider.accepted, provider.total)}</span></td><td className="py-3 text-right"><span className="font-mono">{percentage(provider.opened + provider.clicked, provider.accepted)}</span></td><td className="py-3 text-right font-mono text-muted-foreground">{provider.failed.toLocaleString()}</td></tr>)}</tbody></table></div> : <EmptyState icon={ServerCog} title="No provider activity yet" description="Provider performance appears after an email is queued for delivery." />}</section></div><section className="border border-border bg-card p-5"><div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><h3 className="text-[14px] font-semibold">Top email templates</h3><p className="mt-1 text-[11px] text-muted-foreground">The templates and custom messages generating the most activity.</p></div><p className="text-[10px] text-muted-foreground">Updated {formatDate(analytics.generatedAt)}</p></div>{analytics.templates.length ? <div className="dashboard-scroll mt-4 overflow-x-auto"><table className="w-full min-w-[680px] text-left"><thead className="border-b border-border text-[10px] uppercase tracking-[.08em] text-muted-foreground"><tr><th className="pb-3 font-medium">Template</th><th className="pb-3 font-medium">Activity</th><th className="pb-3 text-right font-medium">Created</th><th className="pb-3 text-right font-medium">Accepted</th><th className="pb-3 text-right font-medium">Opened</th><th className="pb-3 text-right font-medium">Clicked</th><th className="pb-3 text-right font-medium">Failed</th></tr></thead><tbody className="divide-y divide-border">{analytics.templates.map((template) => <tr key={`${template.module}-${template.key}`} className="text-[11px]"><td className="max-w-[280px] truncate py-3 font-medium">{analyticsLabel(template.key)}</td><td className="py-3 text-muted-foreground">{moduleLabel[template.module] || analyticsLabel(template.module)}</td><td className="py-3 text-right font-mono text-muted-foreground">{template.total.toLocaleString()}</td><td className="py-3 text-right font-mono">{percentage(template.accepted, template.total)}</td><td className="py-3 text-right font-mono">{percentage(template.opened, template.accepted)}</td><td className="py-3 text-right font-mono">{percentage(template.clicked, template.accepted)}</td><td className="py-3 text-right font-mono text-muted-foreground">{template.failed.toLocaleString()}</td></tr>)}</tbody></table></div> : <EmptyState icon={FileText} title="No template activity yet" description="Template performance appears after the first email is sent." />}</section></> : <EmptyState icon={Mail} title="No email activity in this period" description="Send a test email or wait for a form, event, payment, or automation message to create analytics." />}</div>;
}

function LegacyEmailAnalyticsPage({ analytics, days, loading, onDaysChange, onNavigate, onRefresh }: { analytics?: EmailAnalytics; days: number; loading: boolean; onDaysChange: (days: number) => void; onNavigate: (tab: EmailTab) => void; onRefresh: () => void }) {
  return <div className="space-y-6 pb-5"><header className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between"><div><div className="flex items-center gap-2 text-primary"><span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10"><Mail className="h-3.5 w-3.5" /></span><span className="text-[11px] font-semibold uppercase tracking-[0.12em]">Workspace delivery</span></div><h1 className="mt-3 text-[30px] font-semibold tracking-tight sm:text-[34px]">Email settings</h1><p className="mt-1.5 text-[13px] text-muted-foreground">Providers, identity, mailboxes, templates, delivery logs, and safety controls in one workspace.</p></div><Button type="button" variant="outline" size="sm" disabled={loading} onClick={onRefresh}>{loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Refresh</Button></header><nav className="dashboard-scroll dashboard-scroll-x flex gap-1 overflow-x-auto border-b border-border" aria-label="Email settings sections">{tabs.map((item) => { const Icon = item.icon; const active = item.value === "analytics"; return <button key={item.value} type="button" onClick={() => onNavigate(item.value)} className={active ? "relative flex h-10 shrink-0 items-center gap-1.5 border-b-2 border-primary px-3 text-[12px] font-semibold" : "relative flex h-10 shrink-0 items-center gap-1.5 border-b-2 border-transparent px-3 text-[12px] text-muted-foreground hover:text-foreground"}><Icon className="h-3.5 w-3.5" />{item.label}</button>; })}</nav><EmailAnalyticsPanel analytics={analytics} days={days} loading={loading} onDaysChange={onDaysChange} /></div>;
}

function DeliveryEventTracking({ connections }: { connections: EmailConnection[] }) {
  const tosend = connections.find((connection) => connection.provider === "tosend" && connection.status === "connected");
  const eligible = connections.filter((connection) => connection.mode === "custom" && connection.status === "connected" && connection.provider !== "tosend" && connection.provider !== "smtp" && connection.provider !== "sender");
  const [provider, setProvider] = useState<EmailProviderId | "">("");
  const [endpoint, setEndpoint] = useState("");
  const [working, setWorking] = useState(false);
  useEffect(() => { if (!provider && eligible[0]) setProvider(eligible[0].provider); }, [eligible, provider]);
  const tosendNotice = tosend ? <section className="border border-teal-500/25 bg-teal-500/4.5 p-4"><div className="flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-600/10 text-teal-700 dark:text-teal-300"><ServerCog className="h-4 w-4" /></span><div><p className="text-[13px] font-semibold">ToSend provider events</p><p className="mt-1 text-[11px] leading-5 text-muted-foreground">ToSend sends bounce and complaint callbacks through its signed deployment webhook. Configure <code className="rounded bg-background px-1 py-0.5 font-mono text-[10px]">TOSEND_WEBHOOK_SECRET</code>, then paste this HTTPS endpoint into ToSend:</p><div className="mt-2 rounded border border-border bg-background px-3 py-2 font-mono text-[10px]">/api/webhooks/email/tosend</div><p className="mt-2 text-[10px] text-muted-foreground">ToSend&apos;s documented webhook does not provide open or click callbacks; MaxForm campaign open/click tracking remains first-party through the links and pixel in the message.</p></div></div></section> : null;
  if (!eligible.length) return <div className="space-y-4">{tosendNotice}<section className="border border-border bg-card p-5"><div className="flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><BarChart3 className="h-4 w-4" /></span><div><p className="text-[13px] font-semibold">Enable delivery-event tracking</p><p className="mt-1 text-[11px] leading-5 text-muted-foreground">Connect Resend, SendGrid, Postmark, Mailgun, or Amazon SES to capture delivery, open, click, bounce, and complaint events.</p></div></div></section></div>;
  const selected = eligible.find((connection) => connection.provider === provider);
  const create = async () => {
    if (!provider) return;
    setWorking(true);
    try {
      const result = await createEmailAnalyticsWebhook(provider);
      setEndpoint(`${window.location.origin}${result.webhook.path}`);
      toast.success("Private delivery-event endpoint generated.");
    } catch (error) {
      toast.error(formatEmailError(error, "The delivery-event endpoint could not be created. Please try again."));
    } finally {
      setWorking(false);
    }
  };
  return <div className="space-y-4">{tosendNotice}<section className="border border-border bg-card p-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div><div className="flex items-center gap-2"><BarChart3 className="h-4 w-4 text-primary" /><h3 className="text-[14px] font-semibold">Enable delivery-event tracking</h3>{selected?.eventsEnabled ? <Badge variant="outline" className="border-emerald-500/25 bg-emerald-500/10 text-[9px] text-emerald-700 dark:text-emerald-300">Tracking active</Badge> : null}</div><p className="mt-1 max-w-2xl text-[11px] leading-5 text-muted-foreground">Paste this private endpoint into your provider&apos;s delivery-event webhook settings to populate delivered, opened, clicked, bounced, and complaint analytics. Select those event types in the provider.</p></div><div className="flex w-full gap-2 lg:w-auto"><Select value={provider || "none"} onValueChange={(value) => setProvider(value === "none" ? "" : value as EmailProviderId)}><SelectTrigger className="h-9 flex-1 text-[11px] lg:w-[180px]"><SelectValue /></SelectTrigger><SelectContent>{eligible.map((connection) => <SelectItem key={connection.id} value={connection.provider}>{providerSetupNames[connection.provider]}{connection.eventsEnabled ? " · active" : ""}</SelectItem>)}</SelectContent></Select><Button type="button" size="sm" disabled={!provider || working} onClick={() => void create()}>{working && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{selected?.eventsEnabled ? "Rotate endpoint" : "Create endpoint"}</Button></div></div>{endpoint ? <div className="mt-4 rounded-lg border border-primary/20 bg-primary/[0.035] p-3"><div className="flex items-start justify-between gap-3"><div><p className="text-[11px] font-medium">Copy this endpoint now</p><p className="mt-1 text-[10px] text-muted-foreground">For security, the secret is shown only after it is generated. Rotating affects only delivery tracking, not inbound mail.</p></div><Button type="button" size="icon" variant="outline" className="h-8 w-8 shrink-0" onClick={() => { void navigator.clipboard.writeText(endpoint); toast.success("Delivery-event endpoint copied."); }} aria-label="Copy delivery-event endpoint"><Copy className="h-3.5 w-3.5" /></Button></div><Input readOnly value={endpoint} className="mt-3 font-mono text-[10px]" /></div> : null}</section></div>;
}

function EmailAnalyticsPage({ analytics, connections, days, loading, onDaysChange, onNavigate, onRefresh }: { analytics?: EmailAnalytics; connections: EmailConnection[]; days: number; loading: boolean; onDaysChange: (days: number) => void; onNavigate: (tab: EmailTab) => void; onRefresh: () => void }) {
  return <div className="space-y-6"><LegacyEmailAnalyticsPage analytics={analytics} days={days} loading={loading} onDaysChange={onDaysChange} onNavigate={onNavigate} onRefresh={onRefresh} /><DeliveryEventTracking connections={connections} /></div>;
}

function ReceivedPanel({ connections, messages, onCreateWebhook, working }: { connections: EmailConnection[]; messages: InboundEmail[]; onCreateWebhook: (provider: EmailProviderId) => void; working: boolean }) {
  const inboundConnections = connections.filter((connection) => connection.mode === "custom" && connection.status === "connected" && connection.provider !== "tosend" && connection.provider !== "smtp" && connection.provider !== "sender");
  const hasSmtp = connections.some((connection) => connection.mode === "custom" && connection.status === "connected" && connection.provider === "smtp");
  return <div><div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-[17px] font-semibold">Received mail</h2><p className="mt-1 text-[12px] text-muted-foreground">Capture replies and inbound messages in a secure workspace inbox.</p></div></div><section className="mt-5 border border-primary/20 bg-primary/[0.035] p-4"><p className="text-[12px] font-medium">Inbound webhook setup</p><p className="mt-1 text-[11px] leading-5 text-muted-foreground">Generate a private endpoint for a connected provider, then paste it into that provider&apos;s inbound or reply webhook configuration. The secret is only shown when generated.</p><div className="mt-3 flex flex-wrap gap-2">{inboundConnections.map((connection) => <Button key={connection.id} type="button" size="sm" variant="outline" disabled={working} onClick={() => onCreateWebhook(connection.provider)}><Mail className="h-3.5 w-3.5" /> {connection.inboundEnabled ? `Rotate ${connection.provider} endpoint` : `Set up ${connection.provider}`}</Button>)}</div>{hasSmtp ? <p className="mt-3 text-[11px] text-muted-foreground">Custom SMTP is send-only here; use mailbox forwarding to one of the webhook-capable providers to capture replies.</p> : null}{connections.some((connection) => connection.provider === "sender" && connection.status === "connected") ? <p className="mt-3 text-[11px] text-muted-foreground">Sender is connected for outbound transactional delivery. Its connection is not offered here because this module does not have a documented Sender inbound webhook flow.</p> : null}{!connections.length ? <p className="mt-3 text-[11px] text-muted-foreground">Connect a provider first to set up inbound mail.</p> : null}</section>{messages.length ? <div className="dashboard-scroll mt-5 overflow-x-auto"><table className="w-full min-w-[720px] text-left"><thead className="border-b border-border text-[10px] uppercase tracking-[0.08em] text-muted-foreground"><tr><th className="py-3 font-medium">From</th><th className="py-3 font-medium">Subject</th><th className="py-3 font-medium">Provider</th><th className="py-3 font-medium">Received</th></tr></thead><tbody className="divide-y divide-border">{messages.map((message) => <tr key={message.id} className="text-[12px]"><td className="max-w-[220px] truncate py-3 pr-4 font-medium">{message.sender}</td><td className="max-w-[320px] truncate py-3 pr-4 text-muted-foreground">{message.subject || "(No subject)"}</td><td className="py-3 pr-4 capitalize text-muted-foreground">{message.provider}</td><td className="whitespace-nowrap py-3 text-[11px] text-muted-foreground">{formatDate(message.receivedAt)}</td></tr>)}</tbody></table></div> : <div className="mt-5"><EmptyState icon={Mail} title="No received mail yet" description="Replies and inbound provider messages will appear here after the inbound endpoint is configured." /></div>}</div>;
}

function SendingDomainsPanel({ activeProvider, domains, onAdd, onVerify, onDelete: configuredOnDelete, working }: { activeProvider?: EmailProviderId; domains: EmailSendingDomain[]; onAdd: (domain: string) => Promise<boolean>; onVerify: (id: string) => Promise<boolean>; onDelete?: (domain: EmailSendingDomain) => void; working: boolean }) {
  const queryClient = useQueryClient();
  const [domain, setDomain] = useState("");
  const [copying, setCopying] = useState("");
  const onDelete = configuredOnDelete || (async (item: EmailSendingDomain) => {
    if (!window.confirm(`Delete ${item.domain}? This removes it from MaxForm and marks custom identities using it as unverified.`)) return;
    try {
      await deleteEmailSendingDomain(item.id);
      await queryClient.invalidateQueries({ queryKey: ["email", "workspace"] });
      toast.success("Sending domain deleted.");
    } catch (error) {
      toast.error(formatEmailError(error, "The sending domain could not be deleted. Please try again."));
    }
  });
  const copyRecord = async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopying(key);
      toast.success("DNS value copied.");
      window.setTimeout(() => setCopying(""), 1200);
    } catch {
      toast.error("The DNS value could not be copied.");
    }
  };
  const add = async () => {
    if (await onAdd(domain)) setDomain("");
  };
  return <div className="max-w-4xl space-y-5"><div className="border-b border-border pb-4"><div className="flex items-center gap-2"><Globe2 className="h-4 w-4 text-primary" /><h2 className="text-[17px] font-semibold">Sending domains</h2></div><p className="mt-1 text-[12px] leading-5 text-muted-foreground">Custom From addresses require a verified domain in the active provider. This is separate from connecting a provider and is never required for MaxForm Managed Sending.</p></div><section className="rounded-xl border border-primary/20 bg-primary/[0.035] p-4"><p className="text-[12px] font-semibold">Add a domain to the active provider</p><p className="mt-1 text-[11px] leading-5 text-muted-foreground">{activeProvider ? `New domains are added to ${activeProvider}. Your provider key may need domain-management permission; send-only keys remain valid for Managed Sending.` : "Choose an active provider first."}</p><div className="mt-4 flex flex-col gap-2 sm:flex-row"><Input value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="mail.example.com" aria-label="Custom sending domain" /><Button type="button" disabled={working || !activeProvider || !domain.trim()} onClick={() => void add()}><Plus className="h-4 w-4" /> Add domain</Button></div></section>{domains.length ? <div className="space-y-4">{domains.map((item) => <section key={item.id} className="border border-border bg-card p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex items-center gap-2"><h3 className="text-[14px] font-semibold">{item.domain}</h3><StatusBadge status={item.status} /></div><p className="mt-1 text-[10px] text-muted-foreground">Provider: {item.provider} · Last checked {formatDate(item.lastCheckedAt)}</p></div><div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" disabled={working || item.status === "verified"} onClick={() => void onVerify(item.id)}><RefreshCw className="h-3.5 w-3.5" /> Check verification</Button><Button type="button" size="sm" variant="ghost" className="text-destructive" disabled={working} onClick={() => onDelete(item)}><Trash2 className="h-3.5 w-3.5" /> Delete</Button></div></div>{item.lastError ? <p className="mt-3 rounded-md border border-amber-500/25 bg-amber-500/4.5 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-200">{formatEmailError(item.lastError, "The provider could not verify this domain. Check the DNS records and try again.")}</p> : null}{item.records.length ? <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[620px] text-left"><thead className="border-b border-border text-[10px] uppercase tracking-[.08em] text-muted-foreground"><tr><th className="py-2 pr-3 font-medium">Type</th><th className="py-2 pr-3 font-medium">Name</th><th className="py-2 pr-3 font-medium">Value</th><th className="py-2" /></tr></thead><tbody className="divide-y divide-border">{item.records.map((record, index) => { const key = `${item.id}-${index}`; return <tr key={key} className="align-top text-[11px]"><td className="py-3 pr-3 font-medium">{record.type}</td><td className="max-w-[220px] break-all py-3 pr-3 font-mono text-[10px] text-muted-foreground">{record.name}</td><td className="max-w-[360px] break-all py-3 pr-3 font-mono text-[10px] text-muted-foreground">{record.value}</td><td className="py-2 text-right"><Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => void copyRecord(record.value, key)} aria-label="Copy DNS value"><Copy className="h-3.5 w-3.5" /></Button>{copying === key ? <span className="ml-1 text-[9px] text-emerald-600">Copied</span> : null}</td></tr>; })}</tbody></table><p className="mt-3 text-[10px] leading-4 text-muted-foreground">Publish these records at your DNS host, wait for propagation, then check verification again. DNS verification is only for custom domains; it is not required to connect or use a provider with Managed Sending.</p></div> : <p className="mt-4 text-[11px] text-muted-foreground">The provider has not returned DNS records yet. Finish domain authentication in the provider, then check again.</p>}</section>)}</div> : <EmptyState icon={Globe2} title="No custom sending domains" description="Managed Sending works without a workspace domain. Add a domain here only when you want a custom From address." />}</div>;
}

function SettingsPanel({ data, onSave, working }: { data: EmailWorkspace; onSave: (settings: EmailWorkspace["settings"]) => void; working: boolean }) {
  const [draft, setDraft] = useState<EmailWorkspace["settings"]>(data.settings);
  const update = <K extends keyof EmailWorkspace["settings"]>(key: K, value: EmailWorkspace["settings"][K]) => setDraft((current) => ({ ...current, [key]: value }));
  return <div className="max-w-3xl"><div className="border-b border-border pb-4"><h2 className="text-[17px] font-semibold">Email safety settings</h2><p className="mt-1 text-[12px] text-muted-foreground">Set workspace defaults, delivery limits, and bounce handling for transactional and workflow email.</p></div><div className="mt-5 space-y-5"><section className="border border-border bg-card p-5"><h3 className="text-[14px] font-semibold">Default sender</h3><p className="mt-1 text-[11px] text-muted-foreground">Used by templates that do not specify an identity.</p><Select value={draft.defaultIdentityId || "none"} onValueChange={(value) => update("defaultIdentityId", value === "none" ? null : value)}><SelectTrigger className="mt-4 max-w-md"><SelectValue placeholder="Select sender" /></SelectTrigger><SelectContent><SelectItem value="none">Platform fallback</SelectItem>{data.identities.map((identity) => <SelectItem key={identity.id} value={identity.id}>{identity.senderName} · {identity.senderEmail}</SelectItem>)}</SelectContent></Select></section><section className="border border-border bg-card p-5"><h3 className="text-[14px] font-semibold">Rate limit</h3><p className="mt-1 text-[11px] text-muted-foreground">Protects transactional and workflow email from accidental loops. Campaigns use their own provider-aware delivery limits.</p><div className="mt-4 flex max-w-md items-center gap-3"><Input type="number" min={10} max={100000} value={draft.rateLimitPerHour} onChange={(event) => update("rateLimitPerHour", Number(event.target.value))} /><span className="shrink-0 text-[11px] text-muted-foreground">emails per hour</span></div></section><section className="border border-border bg-card p-5"><h3 className="text-[14px] font-semibold">Bounce and complaint handling</h3><p className="mt-1 text-[11px] text-muted-foreground">Hard bounces and complaints are immediately suppressed across this workspace.</p><div className="mt-4 grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label>Risk threshold (%)</Label><Input type="number" min={0.1} max={100} step={0.1} value={draft.suppressionThreshold} onChange={(event) => update("suppressionThreshold", Number(event.target.value))} /></div><div className="space-y-2"><Label>When threshold is crossed</Label><Select value={draft.suppressionBehavior} onValueChange={(value) => update("suppressionBehavior", value as EmailWorkspace["settings"]["suppressionBehavior"])}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="suppress">Suppress affected recipients</SelectItem><SelectItem value="pause_campaigns">Pause campaign sending</SelectItem></SelectContent></Select></div></div></section><div className="flex justify-end"><Button type="button" disabled={working} onClick={() => onSave(draft)}>{working && <Loader2 className="h-4 w-4 animate-spin" />} Save email settings</Button></div></div></div>;
}

export function EmailModule({ initialTab = "overview", onTabChange, userId }: { initialTab?: EmailTab; onTabChange?: (tab: EmailTab) => void; userId?: string }) {
  const queryClient = useQueryClient();
  const [tab, setTabState] = useState<EmailTab>(initialTab);
  const [provider, setProvider] = useState<EmailProviderId | null>(null);
  const [providerOpen, setProviderOpen] = useState(false);
  const [identityOpen, setIdentityOpen] = useState(false);
  const [editingIdentity, setEditingIdentity] = useState<EmailIdentity | null>(null);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [testTemplate, setTestTemplate] = useState<EmailTemplate | null>(null);
  const [inboundWebhook, setInboundWebhook] = useState("");
  const [working, setWorking] = useState(false);
  const [confirmation, setConfirmation] = useState<ConfirmationRequest | null>(null);
  const [logStatus, setLogStatus] = useState("");
  const [logSearch, setLogSearch] = useState("");
  const [analyticsDays, setAnalyticsDays] = useState(30);
  useEffect(() => {
    setTabState(initialTab);
  }, [initialTab]);
  const setTab = (nextTab: EmailTab) => {
    setTabState(nextTab);
    onTabChange?.(nextTab);
  };
  const queryUserId = userId || "anonymous";
  const workspaceQueryKey = emailWorkspaceQueryKey(queryUserId, logStatus, logSearch);
  const workspaceQuery = usePersistentQuery({ cacheKey: `email:workspace:${queryUserId}:${logStatus}:${logSearch}`, cacheScope: queryUserId, enabled: Boolean(userId), persist: false, queryKey: workspaceQueryKey, queryFn: () => getEmailWorkspace({ status: logStatus, search: logSearch }), refetchOnMount: false, staleTime: SERVER_STATE_STALE_TIME, tags: ["email", "workspace"] });
  const analyticsQuery = usePersistentQuery({ cacheKey: `email:analytics:${queryUserId}:${analyticsDays}`, cacheScope: queryUserId, enabled: Boolean(userId), persist: false, queryKey: emailAnalyticsQueryKey(queryUserId, analyticsDays), queryFn: () => getEmailAnalytics(analyticsDays), refetchOnMount: false, staleTime: SERVER_STATE_STALE_TIME, tags: ["email", "analytics"] });
  const schemaQuery = usePersistentQuery({ cacheKey: "email:provider-schemas", cacheScope: queryUserId, enabled: Boolean(userId), persist: false, queryKey: emailProviderSchemasQueryKey, queryFn: getEmailProviderSchemas, refetchOnMount: false, staleTime: Infinity, tags: ["email"] });
  const data = workspaceQuery.data;
  const refetchWorkspace = workspaceQuery.refetch;
  const schemas = schemaQuery.data || {} as Record<EmailProviderId, EmailProviderSchema>;
  const updateWorkspace = (updater: (current: EmailWorkspace | undefined) => EmailWorkspace | undefined) => {
    queryClient.setQueryData<EmailWorkspace>(workspaceQueryKey, updater);
  };
  const refresh = async (includeAnalytics = true) => {
    if (includeAnalytics) {
      await Promise.all([workspaceQuery.refetch(), analyticsQuery.refetch()]);
      return;
    }
    await workspaceQuery.refetch();
  };
  useEffect(() => {
    if (!userId) return;
    const onTemplatesUpdated = () => {
      void refetchWorkspace().catch(() => undefined);
    };
    window.addEventListener(EMAIL_TEMPLATES_UPDATED_EVENT, onTemplatesUpdated);
    return () => window.removeEventListener(EMAIL_TEMPLATES_UPDATED_EVENT, onTemplatesUpdated);
  }, [userId, refetchWorkspace]);
  const mutate = async (work: () => Promise<unknown>, success: string) => {
    setWorking(true);
    try {
      await work();
      toast.success(success);
      void refresh(false).catch(() => undefined);
    } catch (error) {
      toast.error(formatEmailError(error, "Email settings could not be updated. Please try again."));
    } finally {
      setWorking(false);
    }
  };
  const createInboundWebhook = async (providerValue: EmailProviderId) => {
    setWorking(true);
    try {
      const result = await createEmailInboundWebhook(providerValue);
      setInboundWebhook(`${window.location.origin}${result.webhook.path}`);
      toast.success("Private inbound endpoint generated.");
      void refresh(false).catch(() => undefined);
    } catch (error) {
      toast.error(formatEmailError(error, "The inbound email endpoint could not be created. Please try again."));
    } finally {
      setWorking(false);
    }
  };
  const connectProvider = async (providerValue: EmailProviderId, credentials: Record<string, string>) => {
    setWorking(true);
    try {
      const result = await connectEmailProvider(providerValue, credentials);
      updateWorkspace((current) => current
        ? { ...current, connections: [result.connection, ...current.connections.filter((connection) => connection.provider !== providerValue)] }
        : current);
      setProviderOpen(false);
      toast.success("Provider connected.");
    } catch (error) {
      toast.error(formatEmailError(error, "The provider could not be connected. Check the connection details and try again."));
    } finally {
      setWorking(false);
    }
  };
  const disconnectProvider = async (providerValue: EmailProviderId) => {
    setWorking(true);
    try {
      await disconnectEmailProvider(providerValue);
      updateWorkspace((current) => current
        ? {
          ...current,
          activeProvider: current.activeProvider?.mode === "custom" && current.activeProvider.provider === providerValue ? null : current.activeProvider,
          connections: current.connections.map((connection) => connection.provider === providerValue
            ? { ...connection, role: "none", isActive: false, status: "disconnected", healthOk: false, lastError: "" }
            : connection),
        }
        : current);
      toast.success("Provider disconnected.");
      return true;
    } catch (error) {
      toast.error(formatEmailError(error, "The provider could not be disconnected. Please try again."));
      return false;
    } finally {
      setWorking(false);
    }
  };
  const checkProviderHealth = async (providerValue: EmailProviderId) => {
    setWorking(true);
    try {
      const result = await checkEmailProviderHealth(providerValue);
      updateWorkspace((current) => current
        ? { ...current, connections: current.connections.map((connection) => connection.provider === providerValue ? { ...connection, status: result.health.ok ? "connected" : "attention", healthOk: result.health.ok, lastHealthCheckAt: result.health.checkedAt, lastError: result.health.error } : connection) }
        : current);
      toast.success(result.health.ok ? "Provider health checked." : "Provider still needs attention.");
    } catch (error) {
      toast.error(formatEmailError(error, "The provider health check could not be completed. Please try again."));
    } finally {
      setWorking(false);
    }
  };
  const addSendingDomain = async (domain: string) => {
    setWorking(true);
    try {
      const result = await addEmailSendingDomain(domain);
      updateWorkspace((current) => current ? { ...current, domains: [result.domain, ...current.domains.filter((item) => item.id !== result.domain.id)] } : current);
      toast.success("Sending domain added.");
      return true;
    } catch (error) {
      toast.error(formatEmailError(error, "The sending domain could not be added. Check the domain and try again."));
      return false;
    } finally {
      setWorking(false);
    }
  };
  const verifySendingDomain = async (domainId: string) => {
    setWorking(true);
    try {
      const result = await verifyEmailSendingDomain(domainId);
      updateWorkspace((current) => current ? { ...current, domains: current.domains.map((item) => item.id === domainId ? result.domain : item), identities: current.identities.map((identity) => identity.customDomain === result.domain.domain ? { ...identity, domainVerified: result.domain.status === "verified", senderReady: identity.sendingMode === "managed" || result.domain.status === "verified", senderError: result.domain.status === "verified" ? "" : identity.senderError } : identity) } : current);
      toast.success(result.domain.status === "verified" ? "Sending domain verified." : "Domain checked; DNS records still need attention.");
      return true;
    } catch (error) {
      toast.error(formatEmailError(error, "The sending domain could not be verified. Check the DNS records and try again."));
      return false;
    } finally {
      setWorking(false);
    }
  };
  const updateActiveProviderLocally = (providerValue: EmailProviderId, mode: "managed" | "custom") => {
    updateWorkspace((current) => {
      if (!current) return current;
      const managedActive = mode === "managed";
      return {
        ...current,
        activeProvider: { provider: providerValue, mode },
        managedConnection: {
          ...current.managedConnection,
          role: managedActive ? "primary" : "none",
          isActive: managedActive,
        },
        connections: current.connections.map((connection) => ({
          ...connection,
          role: !managedActive && connection.provider === providerValue ? "primary" : "none",
          isActive: !managedActive && connection.provider === providerValue,
        })),
        identities: current.identities.map((identity) => {
          if (!managedActive) {
            return {
              ...identity,
              sendingMode: "custom",
              senderPrefix: "",
              domainVerified: false,
              domainVerificationStatus: "pending",
              senderReady: false,
              status: "pending",
              senderError: "",
            };
          }
          const managedDomain = current.managedSendingDomain || identity.managedDomain;
          const senderPrefix = identity.senderPrefix || normalizeManagedSenderPrefix(identity.senderName);
          const managedEmail = managedDomain && senderPrefix ? `${senderPrefix}@${managedDomain}` : identity.managedSenderEmail;
          return {
            ...identity,
            sendingMode: "managed",
            senderPrefix,
            managedDomain,
            generatedSenderEmail: managedEmail,
            managedSenderEmail: managedEmail,
            senderEmail: managedEmail,
            domainVerified: false,
            domainVerificationStatus: "not_required",
            senderReady: Boolean(managedEmail),
            senderError: "",
          };
        }),
      };
    });
  };
  const activateProvider = async (providerValue: EmailProviderId, mode: "managed" | "custom" = "custom") => {
    setWorking(true);
    try {
      await setEmailProviderRole(providerValue, "active", mode);
      updateActiveProviderLocally(providerValue, mode);
      const optimistic = queryClient.getQueryData<EmailWorkspace>(workspaceQueryKey);
      setEditingIdentity(optimistic?.identities[0] || null);
      setIdentityOpen(true);
      toast.success("Active delivery provider updated.");
      void workspaceQuery.refetch().then((result) => {
        if (result.data?.identities[0]) setEditingIdentity(result.data.identities[0]);
      }).catch(() => undefined);
    } catch (error) {
      toast.error(formatEmailError(error, "The active provider could not be updated. Please try again."));
    } finally {
      setWorking(false);
    }
  };
  const removeLogs = async (input: { ids?: string[]; all?: boolean }) => {
    setWorking(true);
    try {
      const result = await deleteEmailLogs(input);
      const deletedIds = new Set(result.ids);
      updateWorkspace((current) => current ? { ...current, logs: current.logs.filter((log) => !deletedIds.has(log.id)) } : current);
      toast.success(result.deleted ? `${result.deleted} email log${result.deleted === 1 ? "" : "s"} deleted.` : "No email logs were deleted.");
      if (result.skippedActive) toast.info("Queued or sending logs were kept until delivery finishes.");
      void analyticsQuery.refetch().catch(() => undefined);
      return true;
    } catch (error) {
      toast.error(formatEmailError(error, "The email logs could not be deleted. Please try again."));
      return false;
    } finally {
      setWorking(false);
    }
  };
  if (workspaceQuery.isInitialLoading || !data) return <EmailLoading />;
  const openProvider = (value: EmailProviderId) => { setProvider(value); setProviderOpen(true); };
  const openTemplate = (value: EmailTemplate | null) => { setEditingTemplate(value); setTemplateOpen(true); };
  const openTest = (value?: EmailTemplate | null) => { setTestTemplate(value || data.templates[0] || null); setTestOpen(true); };
  const requestDisconnect = (providerValue: EmailProviderId) => {
    const providerName = schemas[providerValue]?.name || providerValue;
    setConfirmation({
      title: `Disconnect ${providerName}?`,
      description: "This removes the provider from workspace delivery. Existing delivery logs stay available, but new email will not use this provider until it is connected again.",
      confirmLabel: "Disconnect provider",
      action: () => disconnectProvider(providerValue),
    });
  };
  const requestDeleteLog = (log: EmailLog) => {
    setConfirmation({
      title: "Delete this email log?",
      description: `Delete the delivery record for ${log.recipient}? This cannot be undone. Queued or sending records are protected until delivery finishes.`,
      confirmLabel: "Delete log",
      action: () => removeLogs({ ids: [log.id] }),
    });
  };
  const requestDeleteSelected = (ids: string[]) => {
    setConfirmation({
      title: "Delete selected email logs?",
      description: `Delete ${ids.length} selected delivery record${ids.length === 1 ? "" : "s"}? This cannot be undone. Queued or sending records are protected until delivery finishes.`,
      confirmLabel: "Delete selected",
      action: () => removeLogs({ ids }),
    });
  };
  const requestClearLogs = () => {
    setConfirmation({
      title: "Clear all email logs?",
      description: "This permanently removes the workspace delivery history. Queued or sending records are protected until delivery finishes.",
      confirmLabel: "Clear all logs",
      action: () => removeLogs({ all: true }),
    });
  };
  const confirmAction = async () => {
    if (!confirmation) return;
    if (await confirmation.action()) setConfirmation(null);
  };
  if (tab === "analytics") return <EmailAnalyticsPage analytics={analyticsQuery.data} connections={data.connections} days={analyticsDays} loading={analyticsQuery.isFetching} onDaysChange={setAnalyticsDays} onNavigate={setTab} onRefresh={() => void refresh()} />;
  return <div className="space-y-6 pb-5"><header className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between"><div><div className="flex items-center gap-2 text-primary"><span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10"><Mail className="h-3.5 w-3.5" /></span><span className="text-[11px] font-semibold uppercase tracking-[0.12em]">Workspace delivery</span></div><h1 className="mt-3 text-[30px] font-semibold tracking-tight sm:text-[34px]">Email settings</h1><p className="mt-1.5 text-[13px] text-muted-foreground">Providers, identity, provider verification, delivery logs, and safety controls in one workspace.</p></div><Button type="button" variant="outline" size="sm" disabled={workspaceQuery.isFetching} onClick={() => void refresh()}>{workspaceQuery.isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Refresh</Button></header><nav className="dashboard-scroll dashboard-scroll-x flex gap-1 overflow-x-auto border-b border-border" aria-label="Email settings sections">{tabs.map((item) => { const Icon = item.icon; const active = tab === item.value; return <button key={item.value} type="button" onClick={() => setTab(item.value)} className={active ? "relative flex h-10 shrink-0 items-center gap-1.5 border-b-2 border-primary px-3 text-[12px] font-semibold" : "relative flex h-10 shrink-0 items-center gap-1.5 border-b-2 border-transparent px-3 text-[12px] text-muted-foreground hover:text-foreground"}><Icon className="h-3.5 w-3.5" />{item.label}</button>; })}</nav>{!data && !workspaceQuery.isError ? <section className="flex min-h-[320px] flex-col items-center justify-center gap-3 p-6 text-center" role="status" aria-live="polite"><Loader2 className="h-5 w-5 animate-spin text-primary" /><p className="text-[12px] text-muted-foreground">Loading email settings…</p></section> : workspaceQuery.isError || !data ? <section className="border border-destructive/30 bg-destructive/5 p-6 text-center"><CircleAlert className="mx-auto h-5 w-5 text-destructive" /><h2 className="mt-3 text-[15px] font-semibold">Email settings could not be loaded</h2><p className="mt-1 text-[12px] text-muted-foreground">{formatEmailError(workspaceQuery.error, "Email settings are temporarily unavailable. Please try again shortly.")}</p><Button type="button" size="sm" className="mt-4" onClick={() => void refresh()}>Try again</Button></section> : <>{tab === "overview" && <OverviewPanel data={data} onNavigate={setTab} onTest={() => openTest()} />}{tab === "providers" && <ActiveProvidersPanel connections={data.connections} managedConnection={data.managedConnection} identity={data.identities[0]} schemas={schemas} working={working} onConnect={openProvider} onDisconnect={requestDisconnect} onHealth={checkProviderHealth} onManagedRole={() => activateProvider("resend", "managed")} />}{tab === "identity" && <SingleIdentityPanel activeProvider={data.activeProvider || undefined} identity={data.identities[0]} working={working} onCreate={() => { setEditingIdentity(null); setIdentityOpen(true); }} onEdit={(value) => { setEditingIdentity(value); setIdentityOpen(true); }} onDelete={(value) => { setConfirmation({ title: "Delete sender identity?", description: "This removes the workspace sender. Email delivery will pause until a new identity is configured.", confirmLabel: "Delete identity", action: () => mutate(() => deleteEmailIdentity(value.id), "Sender identity deleted.").then(() => true).catch(() => false) }); }} />}{tab === "domains" && <SendingDomainsPanel activeProvider={data.activeProvider?.mode === "custom" ? data.activeProvider.provider : undefined} domains={data.domains} working={working} onAdd={addSendingDomain} onVerify={verifySendingDomain} />}{tab === "templates" && <TemplatesPanel identities={data.identities} templates={data.templates} onCreate={() => openTemplate(null)} onEdit={openTemplate} />}{tab === "sent" && <SentPanel logs={data.logs} />}{tab === "received" && <ReceivedPanel connections={data.connections} messages={data.received} working={working} onCreateWebhook={(value) => void createInboundWebhook(value)} />}{tab === "logs" && <LogsPanel logs={data.logs} search={logSearch} status={logStatus} working={working} onSearchChange={setLogSearch} onStatusChange={setLogStatus} onRetry={(value) => void mutate(() => retryEmailLog(value.id), "Email sent now.")} onDeleteSingle={requestDeleteLog} onDeleteSelected={requestDeleteSelected} onClearAll={requestClearLogs} />}{tab === "settings" && <SettingsPanel data={data} working={working} onSave={(value) => void mutate(() => saveEmailSettings(value), "Email safety settings saved.")} />}</>}<ProviderDialog open={providerOpen} onOpenChange={setProviderOpen} provider={provider} schema={provider ? schemas[provider] : undefined} working={working} onSave={(credentials) => { if (provider) void connectProvider(provider, credentials); }} /><IdentityDialog activeProvider={data.activeProvider} managedSendingDomain={data.managedSendingDomain} open={identityOpen} onOpenChange={setIdentityOpen} identity={editingIdentity} working={working} onSave={(input) => void mutate(async () => { await saveEmailIdentity(input); setIdentityOpen(false); }, "Sender identity saved.")} /><TemplateDialog open={templateOpen} onOpenChange={setTemplateOpen} template={editingTemplate} identities={data.identities} working={working} onSendTest={(value) => { setTemplateOpen(false); openTest(value); }} onSave={(input) => void mutate(async () => { await saveEmailTemplate(input); setTemplateOpen(false); }, "Template saved.")} /><TestEmailDialog open={testOpen} onOpenChange={setTestOpen} template={testTemplate} working={working} onSend={(to) => { if (!testTemplate) { toast.error("Choose a template first."); return; } void mutate(async () => { await sendEmailTest({ to, templateKey: testTemplate.key, identityId: testTemplate.identityId }); setTestOpen(false); }, "Test email sent now. Check delivery logs for provider status."); }} /><Dialog open={Boolean(inboundWebhook)} onOpenChange={(open) => { if (!open) setInboundWebhook(""); }}><DialogContent className="max-w-[720px]"><DialogHeader><DialogTitle>Private inbound email endpoint</DialogTitle><DialogDescription>Copy this URL into your provider&apos;s inbound or reply webhook setup now. Generating another endpoint rotates this secret.</DialogDescription></DialogHeader><div className="flex gap-2"><Input readOnly value={inboundWebhook} className="font-mono text-[11px]" /><Button type="button" size="icon" variant="outline" onClick={() => { void navigator.clipboard.writeText(inboundWebhook); toast.success("Inbound endpoint copied."); }} aria-label="Copy inbound endpoint"><Copy className="h-4 w-4" /></Button></div><DialogFooter><Button type="button" onClick={() => setInboundWebhook("")}>Done</Button></DialogFooter></DialogContent></Dialog><ConfirmActionDialog request={confirmation} working={working} onConfirm={() => void confirmAction()} onOpenChange={(open) => { if (!open && !working) setConfirmation(null); }} /></div>;
}
